// 育児ハブ：claude.ai のアーティファクトで動かすときの /api。
// 見ている人の Notion 連携（MCP）で、育児まわりの3つのDBを読み、DB_タスク管理 にだけ書く。トークンは使わない。
// 予定は Google カレンダー連携から読むだけ（育児の言葉を含む予定だけを画面に渡す）。
(() => {
  // 連携のツール名。先頭が見つからなければ次を試す
  const TOOLS = {
    fetch: ["Notion", "notion-fetch", "fetch"],
    query: ["Notion", "notion-query-data-sources", "query-data-sources"],
    update: ["Notion", "notion-update-page", "update-page"],
    create: ["Notion", "notion-create-pages", "create-pages"],
    calendars: ["Google Calendar", "list_calendars"],
    events: ["Google Calendar", "list_events"],
  };
  const DS = {
    task: "21762844-acbe-8075-bbe6-000bcaf22801", // DB_タスク管理（分類タグ CHILD だけ読む）
    memo: "2f362844-acbe-804a-9314-000be9fe07fa", // DB_childcare memo
    aid: "21c62844-acbe-800b-8b6b-000b7d8e1e7c", // 支援の申請・給付
    sleep: "5d665394-581e-4294-9bc1-adb8bad27784", // DB_ねんね記録（月齢ごとに1行）
  };
  // 「大事な日」の 奏輔誕生日 から。変わることはないのでここに置く
  const CHILD = { name: "奏輔", birth: "2026-01-19", backToWork: "2027-01-19" }; // 妻の復職日（10/26 の棚卸しで 1/19 に統一）
  const CAL_WORDS = /奏輔|そうすけ|検診|健診|接種|ワクチン|保育園|慣らし|離乳食|小児科/;
  const CAL_DAYS = 180;
  const TASK_TAG = "CHILD";
  const DONE = "✅ DONE";
  const TASK_STATUSES = ["⏭ NEXT", "▶️ DOING", "⏳ WAITING", "🕰 SOMEDAY", "📥 INBOX", DONE];
  const TITLE_MAX = 100;
  const SLEEP_TEXT_MAX = 500;
  const SLEEP_MONTH_MAX = 72;
  const SLEEP_BODY_MAX = 5000;

  // ---------- MCP 呼び出し ----------
  let mcpPromise = null;
  const chosen = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 表示直後は window.claude がまだ無いことがあるので少し待つ。使えなかったときは次の呼び出しでもう一度試す
  async function getMcp() {
    if (mcpPromise) return mcpPromise;
    for (let i = 0; i < 30 && !window.claude?.use; i++) await sleep(100);
    if (!window.claude?.use) return null;
    mcpPromise = window.claude.use("mcp").then(
      (m) => { if (!m) mcpPromise = null; return m; },
      () => { mcpPromise = null; return null; },
    );
    return mcpPromise;
  }

  async function call(kind, input, { read = false } = {}) {
    const mcp = await getMcp();
    if (!mcp) throw apiError(503, "このページでは Notion 連携が使えません。claude.ai で開いてください");
    const [server, ...tools] = TOOLS[kind];
    const names = chosen[kind] ? [chosen[kind]] : tools;
    let last;
    for (const name of names) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await mcp.callTool(server, name, input, read ? undefined : { cache: false });
          chosen[kind] = name;
          return res.payload ?? res;
        } catch (err) {
          last = err;
          // 読み取りだけ、再試行してよいと言われたときに1回だけやり直す
          if (read && attempt === 0 && err?.retryable) {
            await sleep((err.retryAfterMs ?? 800) + Math.random() * 400);
            continue;
          }
          break;
        }
      }
      if (!["not_in_manifest", "bad_request"].includes(last?.code) || chosen[kind]) break;
    }
    throw toApiError(last, server);
  }

  function toApiError(err, server) {
    const code = err?.code;
    const msg = {
      needs_reauth: `${server} の連携が切れています。claude.ai の 設定 → コネクタ で ${server} を再接続してください`,
      server_not_connected: `${server} 連携がありません。claude.ai の 設定 → コネクタ で ${server} を追加してください`,
      selection_required: `${server} 連携が複数あります。どれを使うか選んでください`,
      not_in_manifest: `このページで ${server} の利用が許可されていません。ページの権限から ${server} を許可してください`,
      approval_required: `${server} の利用を許可してください（許可の確認が出たら「許可」）`,
      consent_required: `${server} の利用を許可してください（許可の確認が出たら「許可」）`,
      blocked_by_policy: `組織の設定で ${server} 連携が使えません`,
      server_unavailable: `${server} が混み合っています。少し待ってから更新してください`,
      rate_limited: `${server} が混み合っています。少し待ってから更新してください`,
      not_granted: "このページでは連携が使えません。claude.ai で開いてください",
      capability_disabled: "このページでは連携が使えません。claude.ai で開いてください",
      tool_error: `${server} でエラーが起きました${shortMessage(err?.message)}`,
    }[code];
    return apiError(code === "server_unavailable" || code === "rate_limited" ? 503 : 502, msg || "Notion との通信でエラーが起きました");
  }

  function shortMessage(m) {
    const s = String(m || "").replace(/\s+/g, " ").trim();
    return s ? `（${s.slice(0, 80)}）` : "";
  }

  // ---------- Notion の返事を読む ----------
  const idOf = (url) => (String(url || "").match(/([0-9a-f]{32})(?:\?|$)/i) || [])[1]?.toLowerCase() || "";
  const isRef = (v) => typeof v === "string" && /^(formula|rollup)Result:\/\//.test(v);

  function text(v) {
    if (v == null || isRef(v) || v === "<omitted />") return "";
    if (typeof v !== "string") return String(v);
    return decode(
      v.replace(/<date start="([^"]+)"[^>]*\/>/g, "$1")
        .replace(/<br\s*\/?>/g, "\n")
        .replace(/<[^>]+>/g, ""),
    ).trim();
  }

  function decode(s) {
    return s.replace(/&(lt|gt|amp|quot|#39|nbsp);/g, (_, e) => ({ lt: "<", gt: ">", amp: "&", quot: '"', "#39": "'", nbsp: " " })[e]);
  }

  const between = (str, tag) => (String(str || "").match(new RegExp(`<${tag}[^>]*>\\s*([\\s\\S]*?)\\s*</${tag}>`)) || [])[1];
  const dateOf = (r, prop) => String(r[`date:${prop}:start`] || "").slice(0, 10) || null;

  async function queryRows(dsId, { filters, sort, limit = 100 } = {}) {
    const data = { mode: "rows", data_source_url: `collection://${dsId}`, limit };
    if (filters?.length) data.filter = { type: "group", operator: "and", filters };
    if (sort) data.sort = sort;
    const res = await call("query", { data }, { read: true });
    return res.results || [];
  }

  // ---------- 読む ----------
  const knownTasks = new Map(); // id → 項目（書き換えは読み込んだ CHILD のタスクだけに限る）

  function taskItem(r) {
    const status = text(r["ステータス"]);
    const item = {
      id: idOf(r.url),
      url: r.url,
      src: status === "📚 REFERENCE" ? "ref" : "task",
      title: text(r["名前"]) || "（無題）",
      status,
      note: text(r.NEXT),
      date: dateOf(r, "実行日"),
      tag: "",
      meta: [text(r["枠"]), text(r["重さ"])].filter(Boolean),
      star: false,
      done: status === DONE,
    };
    if (item.src === "task") knownTasks.set(item.id, item);
    return item;
  }

  function memoItem(r) {
    const status = text(r[""]); // このDBのステータス列は名前が空
    return {
      id: idOf(r.url),
      url: r.url,
      src: "memo",
      title: text(r["名前"]) || "（無題）",
      status,
      note: "",
      date: dateOf(r, "実行日"),
      tag: text(r["分類タグ"]),
      meta: [],
      star: text(r.Star) === "☆",
      done: status === "完了",
    };
  }

  function aidItem(r) {
    const status = text(r["申請状況"]);
    return {
      id: idOf(r.url),
      url: r.url,
      src: "aid",
      title: text(r["名前"]) || "（無題）",
      status,
      note: text(r["助成内容"]),
      date: dateOf(r, "期限"),
      tag: "",
      meta: [text(r["申請先"])].filter(Boolean),
      star: false,
      done: status === "取得済み" || text(r["ステータス"]) === "完了",
    };
  }

  async function getHub() {
    const [tasks, memos, aids] = await Promise.all([
      queryRows(DS.task, {
        filters: [
          { type: "property", property: "分類タグ", propertyType: "select", operator: "enum_is", value: { type: "exact", value: TASK_TAG } },
          { type: "property", property: "ステータス", propertyType: "status", operator: "status_is_not", value: { type: "is_option", value: DONE } },
        ],
      }),
      queryRows(DS.memo),
      queryRows(DS.aid),
    ]);
    knownTasks.clear();
    return {
      child: CHILD,
      items: [...tasks.map(taskItem), ...memos.map(memoItem), ...aids.map(aidItem)],
      loadedAt: new Date().toISOString(),
    };
  }

  // ---------- ねんね（DB_ねんね記録） ----------
  const knownSleep = new Map(); // 月齢 → 行（書き換えは読み込んだ行だけ。同じ月齢は1行にまとめる）
  const knownBody = new Map(); // ページID → { body, editable }（本文はこの画面で読んだものだけ書き換える）
  let sleepOptions = null;

  const list = (v) => {
    if (Array.isArray(v)) return v.map(String);
    try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
  };
  const count = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  function sleepRow(r) {
    return {
      id: idOf(r.url),
      url: r.url,
      title: text(r["名前"]),
      date: dateOf(r, "記録日"),
      month: count(r["月齢"]),
      place: text(r["寝る場所"]),
      methods: list(r["寝かしつけ"]),
      who: text(r["寝かしつけ担当"]),
      bed: text(r["寝る時刻"]),
      wake: text(r["起きる時刻"]),
      night: count(r["夜中に起きる回数"]),
      naps: count(r["昼寝の回数"]),
      good: text(r["うまくいったこと"]),
      trouble: text(r["困っていること"]),
    };
  }

  // 選択肢は DB の設定から読む（Notion で選択肢を足せばアプリにも出る）
  async function loadSleepOptions() {
    const res = await call("fetch", { id: `collection://${DS.sleep}` }, { read: true });
    const schema = JSON.parse(between(res.text, "data-source-state") || "{}").schema || {};
    const names = (p) => (schema[p]?.options || []).map((o) => o.name);
    sleepOptions = { place: names("寝る場所"), methods: names("寝かしつけ"), who: names("寝かしつけ担当") };
    return sleepOptions;
  }

  async function getSleep() {
    const [options, rows] = await Promise.all([loadSleepOptions(), queryRows(DS.sleep)]);
    knownSleep.clear();
    const records = rows.map(sleepRow).sort((a, b) => (b.month ?? -1) - (a.month ?? -1) || String(b.date).localeCompare(String(a.date)));
    for (const r of records) if (r.month != null && !knownSleep.has(r.month)) knownSleep.set(r.month, r);
    return { records, options };
  }

  // 本文（ページの中身）。表・画像・子ページなど文字だけでないものがあれば、アプリでは書き換えない
  async function getSleepBody(id) {
    if (![...knownSleep.values()].some((r) => r.id === id)) throw apiError(403, "この画面で読み込んだねんね記録だけ開けます");
    const res = await call("fetch", { id }, { read: true });
    const raw = String(res.text || "").includes("<blank-page>") ? "" : (between(res.text, "content") || "");
    const editable = !/<(?!br\s*\/?>)[a-z][^>]*>/i.test(raw);
    const body = editable ? decode(raw.replace(/<br\s*\/?>/g, "\n")).trim() : text(raw);
    knownBody.set(id, { body, editable });
    return { body, editable };
  }

  // 文字はそのまま本文にする。< > はタグと読まれないよう全角にする
  const bodyMarkdown = (t) => t.replace(/</g, "＜").replace(/>/g, "＞");

  async function saveSleep(body) {
    const opts = sleepOptions || (await loadSleepOptions());
    const month = Number(body?.month);
    if (!Number.isInteger(month) || month < 0 || month > SLEEP_MONTH_MAX) throw apiError(400, "月齢が正しくありません");
    const pick = (v, allowed) => {
      const t = String(v || "");
      if (t && !allowed.includes(t)) throw apiError(400, `選べない値です：${t}`);
      return t || null;
    };
    const time = (v) => {
      const t = String(v || "").trim();
      if (t && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) throw apiError(400, "時刻は 20:30 の形で入れてください");
      return t;
    };
    const times = (v) => {
      if (v === "" || v == null) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 20) throw apiError(400, "回数は 0〜20 で入れてください");
      return n;
    };
    const note = (v) => {
      const t = String(v || "").trim();
      if (t.length > SLEEP_TEXT_MAX) throw apiError(400, `メモは${SLEEP_TEXT_MAX}文字までです`);
      return t;
    };
    const methods = Array.isArray(body.methods) ? [...new Set(body.methods.map(String))] : [];
    for (const m of methods) pick(m, opts.methods);
    const title = month < 12 ? `生後${month}か月` : `${Math.floor(month / 12)}歳${month % 12}か月`;
    const properties = {
      名前: title,
      "date:記録日:start": jstToday(),
      "date:記録日:is_datetime": 0,
      月齢: month,
      寝る場所: pick(body.place, opts.place),
      寝かしつけ: methods,
      寝かしつけ担当: pick(body.who, opts.who),
      寝る時刻: time(body.bed),
      起きる時刻: time(body.wake),
      夜中に起きる回数: times(body.night),
      昼寝の回数: times(body.naps),
      うまくいったこと: note(body.good),
      困っていること: note(body.trouble),
    };
    const newBody = typeof body.body === "string" ? body.body.replace(/\r\n/g, "\n").trim() : null;
    if (newBody != null && newBody.length > SLEEP_BODY_MAX) throw apiError(400, `本文は${SLEEP_BODY_MAX}文字までです`);
    const known = knownSleep.get(month);
    if (known) {
      // 本文は、読み込んだ本文から変わったときだけ書き換える（読んでいない・文字だけでない本文は触らない）
      const loaded = knownBody.get(known.id);
      const bodyChanged = newBody != null && loaded && newBody !== loaded.body;
      if (bodyChanged && !loaded.editable) throw apiError(409, "この本文は表や画像などを含むので、Notion で直してください");
      if (newBody != null && !loaded && newBody !== "") throw apiError(409, "本文を読み込んでから保存してください");
      await call("update", { page_id: known.id, command: "update_properties", properties, allow_async: false });
      if (bodyChanged) {
        await call("update", { page_id: known.id, command: "replace_content", new_str: bodyMarkdown(newBody), allow_async: false });
        knownBody.set(known.id, { body: newBody, editable: true });
      }
    } else {
      if (!sleepOptions) throw apiError(409, "先にねんね記録を読み込んでください");
      const page = { properties };
      if (newBody) page.content = bodyMarkdown(newBody);
      await call("create", { parent: { type: "data_source_id", data_source_id: DS.sleep }, pages: [page], allow_async: false });
    }
    return getSleep();
  }

  // ---------- 予定（Google カレンダー・読むだけ） ----------
  // 祝日以外の見えているカレンダーから、育児の言葉を含む予定だけを返す（ほかの予定の名前は画面に渡さない）
  async function getCalendar() {
    const res = await call("calendars", {}, { read: true });
    const cals = (res.calendars || []).filter((c) => c.id && !/#holiday@/.test(c.id));
    const today = jstToday();
    const lists = await Promise.all(cals.map((c) => call("events", {
      calendarId: c.id,
      startTime: `${today}T00:00:00`,
      endTime: `${addDays(today, CAL_DAYS)}T00:00:00`,
      orderBy: "startTime",
      pageSize: 100,
    }, { read: true }).then((r) => r.events || [], () => [])));
    const seen = new Set();
    const events = lists.flat()
      .filter((e) => e.status !== "cancelled" && CAL_WORDS.test(`${e.summary || ""} ${e.description || ""}`))
      .map((e) => ({
        title: String(e.summary || "（予定）"),
        date: (e.start?.dateTime ? jstDate(e.start.dateTime) : String(e.start?.date || "").slice(0, 10)),
        time: e.start?.dateTime ? jstTime(e.start.dateTime) : "",
        url: /^https:\/\/www\.google\.com\/calendar\//.test(e.htmlLink || "") ? e.htmlLink : "",
      }))
      .filter((e) => e.date && !seen.has(`${e.date}|${e.time}|${e.title}`) && seen.add(`${e.date}|${e.time}|${e.title}`))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return { events };
  }

  const jstToday = () => jstDate(new Date().toISOString());
  const jstDate = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
  const jstTime = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(11, 16);
  function addDays(date, n) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // ---------- 書く（DB_タスク管理 だけ） ----------
  async function addTask(body) {
    const title = String(body?.title || "").replace(/\s+/g, " ").trim();
    if (!title) throw apiError(400, "タスクの名前を入れてください");
    if (title.length > TITLE_MAX) throw apiError(400, `タスクの名前は${TITLE_MAX}文字までです`);
    const res = await call("create", {
      parent: { type: "data_source_id", data_source_id: DS.task },
      pages: [{ properties: { 名前: title, ステータス: "📥 INBOX", 分類タグ: TASK_TAG } }],
      allow_async: false,
    });
    const url = res?.pages?.[0]?.url || "";
    const item = { id: idOf(url) || `new-${Date.now()}`, url, src: "task", title, status: "📥 INBOX", note: "", date: null, tag: "", meta: [], star: false, done: false };
    if (idOf(url)) knownTasks.set(item.id, item);
    return { item };
  }

  async function setTaskStatus(id, body) {
    const item = knownTasks.get(id);
    if (!item) throw apiError(403, "この画面で読み込んだ育児のタスクだけ変更できます");
    if (!TASK_STATUSES.includes(body?.status)) throw apiError(400, "変更できないステータスです");
    await call("update", { page_id: id, command: "update_properties", properties: { ステータス: body.status }, allow_async: false });
    item.status = body.status;
    item.done = body.status === DONE;
    return { item: { ...item } };
  }

  // ---------- 共通 ----------
  function apiError(status, message) {
    return Object.assign(new Error(message), { status, apiMessage: message });
  }

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  async function route(method, url, body) {
    const p = url.pathname;
    const task = p.match(/^\/api\/tasks\/([0-9a-f]{32})$/i);
    if (p === "/api/hub" && method === "GET") return getHub();
    if (p === "/api/calendar" && method === "GET") return getCalendar();
    if (p === "/api/sleep" && method === "GET") return getSleep();
    if (p === "/api/sleep" && method === "PUT") return saveSleep(body);
    const sleepBody = p.match(/^\/api\/sleep\/([0-9a-f]{32})\/body$/i);
    if (sleepBody && method === "GET") return getSleepBody(sleepBody[1].toLowerCase());
    if (p === "/api/tasks" && method === "POST") return addTask(body);
    if (task && method === "PATCH") return setTaskStatus(task[1].toLowerCase(), body);
    throw apiError(404, "not found");
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { /* 空のまま */ }
    try {
      return json(await route(init.method || "GET", url, body));
    } catch (err) {
      return json({ error: err.apiMessage || "画面の中でエラーが起きました" }, err.status || 500);
    }
  };
})();
