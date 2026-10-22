// 習慣チェック：claude.ai のアーティファクトで動かすときの /api。
// Worker（src/worker.js）と同じ返事を、見ている人の Notion 連携（MCP）経由で作る。トークンも合言葉も使わない。
// Notion の MCP は計算式・ロールアップの値を返さないので、Lv・EXP などは null（画面では「—」）になる。
(() => {
  const SERVER = "Notion";
  // 連携のツール名。先頭が見つからなければ次を試す
  const TOOLS = {
    fetch: ["notion-fetch", "fetch"],
    query: ["notion-query-data-sources", "query-data-sources"],
    update: ["notion-update-page", "update-page"],
    create: ["notion-create-pages", "create-pages"],
  };
  const DS = {
    habit: "e730b8b2-bb41-491d-9382-a296c40e6deb", // DB_習慣チェック
    party: "7ab3aa8b-2f1e-44cb-b2f8-592202bab226", // DB_すがた
    guild: "86ea2c0d-a66a-49e4-9a6b-b287f4f32bbd", // DB_ギルド依頼
    report: "0ea02603-b2dd-4064-bc84-bf02f0e60aca", // DB_ギルド達成記録
    story: "f673bc1a-91b2-467d-bcd3-b2a70bd1bcbd", // DB_ものがたり
  };
  // 「🌅 習慣」ページに置いた DB_習慣チェック のビュー。ここで非表示にした列はアプリにも出さない
  const HABIT_VIEW_DB = "3e962844acbe8135bff2dab4a1157d77";
  const PLAYER_ID = "3e962844acbe81b0843ff78fe19791fa";
  const NOTE = "ひとこと";
  const SLOTS = { "☼": "morning", "☀": "noon", "◷": "timed", "☾": "night", "↻": "anytime" };
  const HABIT_NAME = /^([◆◇])\s*([☼☀◷☾↻])[︎️]?\s*(.+)$/u;
  const SCHEMA_TTL = 60e3;
  const REPORT_LIMIT = 20;
  const REPORT_NOTE_MAX = 200;
  const MAX_RANGE_DAYS = 62;

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
    const names = chosen[kind] ? [chosen[kind]] : TOOLS[kind];
    let last;
    for (const name of names) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await mcp.callTool(SERVER, name, input, read ? undefined : { cache: false });
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
    throw toApiError(last);
  }

  function toApiError(err) {
    const code = err?.code;
    const msg = {
      needs_reauth: "Notion の連携が切れています。claude.ai の 設定 → コネクタ で Notion を再接続してください",
      server_not_connected: "Notion 連携がありません。claude.ai の 設定 → コネクタ で Notion を追加してください",
      selection_required: "Notion 連携が複数あります。どれを使うか選んでください",
      not_in_manifest: "このページで Notion の利用が許可されていません。ページの権限から Notion を許可してください",
      approval_required: "Notion の利用を許可してください（許可の確認が出たら「許可」）",
      consent_required: "Notion の利用を許可してください（許可の確認が出たら「許可」）",
      blocked_by_policy: "組織の設定で Notion 連携が使えません",
      server_unavailable: "Notion が混み合っています。少し待ってから「更新」してください",
      rate_limited: "Notion が混み合っています。少し待ってから「更新」してください",
      not_granted: "このページでは Notion 連携が使えません。claude.ai で開いてください",
      capability_disabled: "このページでは Notion 連携が使えません。claude.ai で開いてください",
      tool_error: `Notion でエラーが起きました${shortMessage(err?.message)}`,
    }[code];
    return apiError(code === "server_unavailable" || code === "rate_limited" ? 503 : 502, msg || "Notion との通信でエラーが起きました");
  }

  function shortMessage(m) {
    const s = String(m || "").replace(/\s+/g, " ").trim();
    return s ? `（${s.slice(0, 80)}）` : "";
  }

  // ---------- Notion の返事を読む ----------
  const idOf = (url) => (String(url || "").match(/([0-9a-f]{32})(?:\?|$)/i) || [])[1]?.toLowerCase() || "";
  const pageUrl = (id) => `https://www.notion.so/${id.replace(/-/g, "")}`;
  const yes = (v) => v === "__YES__" || v === true;
  const isRef = (v) => typeof v === "string" && /^(formula|rollup)Result:\/\//.test(v);
  const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v !== "" && !isRef(v) && Number.isFinite(Number(v)) ? Number(v) : null);
  const ids = (v) => {
    let list = v;
    if (typeof v === "string") {
      try { list = JSON.parse(v); } catch { list = []; }
    }
    return Array.isArray(list) ? list.map(idOf).filter(Boolean) : [];
  };

  function text(v) {
    if (v == null || isRef(v)) return null;
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

  const between = (s, tag) => (String(s || "").match(new RegExp(`<${tag}[^>]*>\\s*([\\s\\S]*?)\\s*</${tag}>`)) || [])[1];

  async function fetchPage(id, extra = {}) {
    const res = await call("fetch", { id, ...extra }, { read: true });
    const props = JSON.parse(between(res.text, "properties") || "{}");
    return { res, props, content: between(res.text, "content") || "" };
  }

  async function queryRows(dsId, { filters, sort, limit = 100 } = {}) {
    const data = { mode: "rows", data_source_url: `collection://${dsId}`, limit };
    if (filters?.length) data.filter = { type: "group", operator: "and", filters };
    if (sort) data.sort = sort;
    const res = await call("query", { data }, { read: true });
    return res.results || [];
  }

  // ---------- 習慣（DB_習慣チェック） ----------
  let schemaCache = null;
  const knownRows = new Map(); // id → 行（書き込みは読み込んだ行だけに限る）

  async function loadSchema() {
    if (schemaCache && Date.now() - schemaCache.at < SCHEMA_TTL) return schemaCache;
    const res = await call("fetch", { id: HABIT_VIEW_DB }, { read: true });
    const state = JSON.parse(between(res.text, "data-source-state") || "{}");
    const props = state.schema || {};
    const shown = viewProperties(res.text);
    const habits = (shown ? shown.map((name) => props[name]) : Object.values(props))
      .filter((p) => p?.type === "checkbox")
      .map((p) => {
        const m = p.name.match(HABIT_NAME);
        return {
          name: p.name,
          label: m ? m[3].trim() : p.name,
          must: m ? m[1] === "◆" : false,
          slot: m ? SLOTS[m[2]] : "anytime",
          hint: p.description || "",
        };
      });
    schemaCache = { at: Date.now(), props, habits };
    return schemaCache;
  }

  // ビューで表示している列（並びもビューのとおり）。ビューが読めなければ null（＝全部出す）
  function viewProperties(text) {
    for (const m of String(text || "").matchAll(/<view [^>]*>\s*(\{[\s\S]*?\})\s*<\/view>/g)) {
      try {
        const view = JSON.parse(m[1]);
        if (String(view.dataSourceUrl).includes(DS.habit) && Array.isArray(view.displayProperties)) return view.displayProperties;
      } catch { /* 読めないビューは飛ばす */ }
    }
    return null;
  }

  function summarizeRow(r, schema) {
    const checks = {};
    for (const h of schema.habits) checks[h.name] = yes(r[h.name]);
    const row = { id: idOf(r.url), url: r.url, checks, note: text(r[NOTE]) || "", stats: {} };
    knownRows.set(row.id, row);
    return row;
  }

  // 日本時間の from〜to の行。作成日時のずれに備えて前後1日広く取ってから絞る
  async function habitRows(from, to) {
    const rows = await queryRows(DS.habit, {
      filters: [
        { type: "property", property: "日付", propertyType: "created_time", operator: "date_is_on_or_after", value: { type: "exact", value: addDays(from, -1) } },
        { type: "property", property: "日付", propertyType: "created_time", operator: "date_is_before", value: { type: "exact", value: addDays(to, 2) } },
      ],
      sort: [{ property: "日付", direction: "ascending" }],
    });
    const byDate = {};
    for (const r of rows) {
      const d = jstDate(r["日付"]);
      if (d >= from && d <= to && !byDate[d]) byDate[d] = r;
    }
    return byDate;
  }

  async function getDay(date) {
    assertDate(date);
    const [schema, byDate] = await Promise.all([loadSchema(), habitRows(date, date)]);
    return { date, habits: schema.habits, row: byDate[date] ? summarizeRow(byDate[date], schema) : null };
  }

  async function createDay(date) {
    assertDate(date);
    const existing = await getDay(date);
    if (existing.row) return existing;
    await call("create", {
      parent: { type: "data_source_id", data_source_id: DS.habit },
      pages: [{ properties: { 日: date, プレイヤー: [pageUrl(PLAYER_ID)] } }],
      allow_async: false,
    });
    return getDay(date);
  }

  async function updateHabit(id, body) {
    const schema = await loadSchema();
    const row = knownRows.get(id);
    if (!row) throw apiError(403, "読み込んだ DB_習慣チェック の行ではありません。「更新」してからやり直してください");
    const { name, value } = body || {};
    let prop;
    if (name === NOTE && schema.props[NOTE]) {
      if (typeof value !== "string" || value.length > 2000) throw apiError(400, "ひとことは2000字までです");
      prop = value;
    } else if (schema.habits.some((h) => h.name === name) && typeof value === "boolean") {
      prop = value ? "__YES__" : "__NO__";
    } else {
      throw apiError(400, "変更できない項目です");
    }
    await call("update", { page_id: id, command: "update_properties", properties: { [name]: prop }, allow_async: false });
    if (name === NOTE) row.note = value;
    else row.checks[name] = value;
    return { row: { ...row, checks: { ...row.checks } } };
  }

  async function getRange(from, to) {
    assertDate(from);
    assertDate(to);
    const span = (Date.parse(to) - Date.parse(from)) / 86400e3;
    if (span < 0 || span > MAX_RANGE_DAYS) throw apiError(400, `期間は${MAX_RANGE_DAYS}日までです`);
    const [schema, byDate] = await Promise.all([loadSchema(), habitRows(from, to)]);
    const days = {};
    for (const [d, r] of Object.entries(byDate)) days[d] = summarizeRow(r, schema);
    return { from, to, habits: schema.habits, days };
  }

  // ---------- きろく（DB_プレイヤー）：計算式の値は取れないので名前だけ ----------
  async function getPlayer() {
    const { props } = await fetchPage(PLAYER_ID);
    return {
      player: {
        id: PLAYER_ID, url: props.url || pageUrl(PLAYER_ID), name: text(props["名前"]) || "",
        level: null, toNext: null, totalExp: null, habitExp: null, taskExp: null, guildExp: null,
        status: null, party: null, spell: null,
      },
    };
  }

  // ---------- パーティー（DB_すがた）：表示条件（計算式）は取れないので全員出す ----------
  async function getParty() {
    const rows = await queryRows(DS.party, { sort: [{ property: "なまえ", direction: "ascending" }] });
    const members = [];
    for (const r of rows) {
      members.push({
        id: idOf(r.url), url: r.url, name: text(r["なまえ"]) || "", kind: text(r["しゅるい"]),
        needLv: num(r["ひつようLv"]), nextLv: num(r["つぎLv"]), image: await firstImage(idOf(r.url)),
      });
    }
    return { members };
  }

  async function firstImage(id) {
    try {
      const { res, content } = await fetchPage(id, { include_file_urls: true });
      const src = (content.match(/<image source="([^"]+)"/) || [])[1];
      if (!src) return null;
      const key = decode(src);
      return res.references?.[key] || res.references?.[src] || (/^https:/.test(key) ? key : null);
    } catch {
      return null;
    }
  }

  // ---------- ギルド（DB_ギルド依頼・DB_ギルド達成記録） ----------
  const knownQuests = new Map();

  async function getGuild() {
    const [quests, reports] = await Promise.all([
      queryRows(DS.guild, { sort: [{ property: "受注Lv", direction: "ascending" }] }),
      queryRows(DS.report, { sort: [{ property: "達成日", direction: "descending" }], limit: REPORT_LIMIT }),
    ]);
    return {
      quests: quests.map((r) => {
        const q = {
          id: idOf(r.url), url: r.url, title: text(r["依頼"]) || "", category: text(r["カテゴリ"]), rank: text(r["ランク"]),
          lv: num(r["受注Lv"]), exp: num(r["基本EXP"]), stages: splitStages(text(r["段階"])),
          board: null, detour: null,
          count: ids(r["記録"]).length, // 達成回数＝達成記録の数
          totalExp: null, playerLv: null,
        };
        knownQuests.set(q.id, q);
        return q;
      }),
      reports: reports.map(summarizeReport),
    };
  }

  function summarizeReport(r) {
    return { id: idOf(r.url), url: r.url, note: text(r[NOTE]) || "", questIds: ids(r["依頼"]), date: r["達成日"] };
  }

  function splitStages(s) {
    return (s || "").split(/[｜|]/).map((x) => x.trim()).filter(Boolean);
  }

  async function createReport(body) {
    const { questId, note } = body || {};
    if (!knownQuests.has(questId)) throw apiError(403, "読み込んだ依頼ではありません。「更新」してからやり直してください");
    if (typeof note !== "string" || !note.trim() || note.length > REPORT_NOTE_MAX) {
      throw apiError(400, `ひとことを${REPORT_NOTE_MAX}字以内で書いてください`);
    }
    await call("create", {
      parent: { type: "data_source_id", data_source_id: DS.report },
      pages: [{ properties: { [NOTE]: note.trim(), 依頼: [pageUrl(questId)] } }],
      allow_async: false,
    });
    return { report: { id: `new-${Date.now()}`, url: "", note: note.trim(), questIds: [questId], date: new Date().toISOString() } };
  }

  // ---------- ものがたり（DB_ものがたり）：Lvでのロックは計算式なので判定しない ----------
  const knownChapters = new Map();

  function summarizeChapter(r) {
    const c = {
      id: idOf(r.url), url: r.url, title: text(r["しょう"]) || "", kind: text(r["しゅるい"]), order: num(r["じゅんばん"]),
      unlockLv: num(r["かいほうLv"]), state: null, read: yes(r["よんだ"]), playerLv: null, locked: false,
    };
    knownChapters.set(c.id, c);
    return c;
  }

  async function getStories() {
    const rows = await queryRows(DS.story, { sort: [{ property: "じゅんばん", direction: "ascending" }] });
    return { chapters: rows.map(summarizeChapter) };
  }

  function chapterOf(id) {
    const c = knownChapters.get(id);
    if (!c) throw apiError(403, "読み込んだ章ではありません。「更新」してからやり直してください");
    return c;
  }

  async function getStory(id) {
    const chapter = chapterOf(id);
    const { content } = await fetchPage(id);
    return { chapter, blocks: storyBlocks(content) };
  }

  // 本文を「段落」「引用（SYSTEM など）」「見出し」の並びにする。トグル（▶ 読む）の中も読む
  function storyBlocks(content) {
    const out = [];
    let afterToggle = false;
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (/^<toggle\b/.test(line)) { afterToggle = true; continue; }
      if (!line) continue;
      if (afterToggle) { afterToggle = false; continue; } // トグルの見出し（▶ 読む）
      if (/^<\/?[a-z-]+[^>]*>$/.test(line)) continue; // 閉じタグ・画像など
      const quote = line.match(/^>\s*(.*)$/);
      const heading = line.match(/^#{1,3}\s+(.*)$/);
      const body = text((quote || heading || [null, line.replace(/^(?:[-*]|\d+\.)\s+/, "")])[1]);
      if (body) out.push({ type: quote ? "quote" : heading ? "heading" : "p", text: body });
    }
    return out;
  }

  async function markStory(id, body) {
    if (typeof body?.read !== "boolean") throw apiError(400, "変更できない項目です");
    const c = chapterOf(id);
    await call("update", { page_id: id, command: "update_properties", properties: { よんだ: body.read ? "__YES__" : "__NO__" }, allow_async: false });
    c.read = body.read;
    return { chapter: { ...c } };
  }

  // ---------- 共通 ----------
  function jstDate(iso) {
    return new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
  }

  function addDays(date, n) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function assertDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || Number.isNaN(Date.parse(date))) throw apiError(400, "日付の形式が正しくありません");
  }

  function apiError(status, message) {
    return Object.assign(new Error(message), { status, apiMessage: message });
  }

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  async function route(method, url, body) {
    const p = url.pathname;
    const idMatch = p.match(/^\/api\/(pages|story)\/([0-9a-f]{32})$/i);
    if (p === "/api/day" && method === "GET") return getDay(url.searchParams.get("date"));
    if (p === "/api/day" && method === "POST") return createDay(body.date);
    if (idMatch?.[1] === "pages" && method === "PATCH") return updateHabit(idMatch[2].toLowerCase(), body);
    if (p === "/api/range" && method === "GET") return getRange(url.searchParams.get("from"), url.searchParams.get("to"));
    if (p === "/api/player" && method === "GET") return getPlayer();
    if (p === "/api/party" && method === "GET") return getParty();
    if (p === "/api/guild" && method === "GET") return getGuild();
    if (p === "/api/guild/reports" && method === "POST") return createReport(body);
    if (p === "/api/story" && method === "GET") return getStories();
    if (idMatch?.[1] === "story" && method === "GET") return getStory(idMatch[2].toLowerCase());
    if (idMatch?.[1] === "story" && method === "PATCH") return markStory(idMatch[2].toLowerCase(), body);
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

  // 合言葉は使わない（Notion へは見ている人の連携で入る）。画面の合言葉チェックを通すための値を画面の中に置く
  const memory = { "habit-check:key": "notion-mcp-connection" };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => (k in memory ? memory[k] : null),
      setItem: (k, v) => { memory[k] = String(v); },
      removeItem: (k) => { delete memory[k]; },
    },
  });

  window.__habitMcpApi = { storyBlocks, text, ids, idOf }; // テスト用
})();
