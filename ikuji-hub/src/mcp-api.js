// 育児ハブ：claude.ai のアーティファクトで動かすときの /api。
// 見ている人の Notion 連携（MCP）で、育児まわりの3つのDBを読み、DB_タスク管理 にだけ書く。トークンは使わない。
(() => {
  const SERVER = "Notion";
  // 連携のツール名。先頭が見つからなければ次を試す
  const TOOLS = {
    query: ["notion-query-data-sources", "query-data-sources"],
    update: ["notion-update-page", "update-page"],
    create: ["notion-create-pages", "create-pages"],
  };
  const DS = {
    task: "21762844-acbe-8075-bbe6-000bcaf22801", // DB_タスク管理（分類タグ CHILD だけ読む）
    memo: "2f362844-acbe-804a-9314-000be9fe07fa", // DB_childcare memo
    aid: "21c62844-acbe-800b-8b6b-000b7d8e1e7c", // 支援の申請・給付
  };
  // 「大事な日」の 奏輔誕生日 から。変わることはないのでここに置く
  const CHILD = { name: "奏輔", birth: "2026-01-19" };
  const TASK_TAG = "CHILD";
  const DONE = "✅ DONE";
  const TASK_STATUSES = ["⏭ NEXT", "▶️ DOING", "⏳ WAITING", "🕰 SOMEDAY", "📥 INBOX", DONE];
  const TITLE_MAX = 100;

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
      server_unavailable: "Notion が混み合っています。少し待ってから更新してください",
      rate_limited: "Notion が混み合っています。少し待ってから更新してください",
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
