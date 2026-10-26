// しおり：claude.ai のアーティファクトで動かすときの /api。
// 見ている人の Notion 連携（MCP）で、読書メモ_DB（本）と DB_読書ハイライト を読み書きする。トークンは使わない。
(() => {
  // 連携のツール名。先頭が見つからなければ次を試す
  const TOOLS = {
    fetch: ["Notion", "notion-fetch", "fetch"],
    query: ["Notion", "notion-query-data-sources", "query-data-sources"],
    update: ["Notion", "notion-update-page", "update-page"],
    create: ["Notion", "notion-create-pages", "create-pages"],
  };
  const DS = {
    book: "23362844-acbe-80b5-a2b4-000b59e31cdf", // 読書メモ_DB（1行＝1冊）
    hl: "1f6f7d77-b234-4b5b-8e15-4afcf2097567", // DB_読書ハイライト（1行＝1つのハイライト）
  };
  const BOOK_STATUSES = ["未読", "読中", "読了"];
  const RATINGS = ["★★★★★", "★★★★", "★★★", "★★", "★"];
  const SOURCES = ["📷 付箋写真", "📱 Kindle", "✍️ 手入力"];
  const TITLE_MAX = 200;
  const QUOTE_MAX = 1900; // Notion のタイトルは 2000 文字まで
  const MEMO_MAX = 1000;
  const CONTEXT_MAX = 6000;
  const REVIEW_MAX = 255; // 読書メーターの感想の上限
  const SAVE_MAX = 100; // 1回で足すハイライトの数
  const LEGACY_MAX = 40; // 前の形（本のページの下の子ページ）を読む数

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
  const checked = (v) => v === "__YES__" || v === true;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const list = (v) => {
    if (Array.isArray(v)) return v.map(String);
    try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
  };

  async function queryRows(dsId, { filters, sort, limit = 100 } = {}) {
    const data = { mode: "rows", data_source_url: `collection://${dsId}`, limit };
    if (filters?.length) data.filter = { type: "group", operator: "and", filters };
    if (sort) data.sort = sort;
    const res = await call("query", { data }, { read: true });
    return res.results || [];
  }

  // ---------- 本（読書メモ_DB） ----------
  const knownBooks = new Map(); // id → 本（書き換え・ハイライトの追加は読み込んだ本だけに限る）
  let bookOptions = null;

  // 表紙は外部の画像URLのときだけ使う（Notion にアップロードした画像は期限つきなので出さない）
  function coverOf(v) {
    for (const f of list(v)) {
      const m = f.match(/^file:\/\/(.+)$/);
      let src = f;
      if (m) { try { src = JSON.parse(decodeURIComponent(m[1])).source || ""; } catch { src = ""; } }
      if (/^https:\/\//.test(src)) return src;
    }
    return "";
  }

  function bookRow(r) {
    return {
      id: idOf(r.url),
      url: r.url,
      title: text(r["書籍名"]) || "（無題）",
      author: text(r["著者名"]),
      publisher: text(r["出版社"]),
      status: text(r["ステータス"]) || "未読",
      finished: dateOf(r, "読了日"),
      rating: text(r["評価"]),
      review: text(r["感想"]),
      meter: checked(r["読書メーター"]),
      notebooklm: checked(r["NotebookLM"]),
      cover: coverOf(r["ファイル&メディア"]),
      highlightCount: list(r["ハイライト"]).length,
      legacyCount: list(r["読書メモ_DBからのリレーション"]).length,
      legacy: list(r["読書メモ_DBからのリレーション"]),
    };
  }

  // 著者名・出版社の選択肢は DB の設定から読む（新しい名前は書くときに Notion が選択肢を足す）
  async function loadBookOptions() {
    const res = await call("fetch", { id: `collection://${DS.book}` }, { read: true });
    const schema = JSON.parse(between(res.text, "data-source-state") || "{}").schema || {};
    const names = (p) => (schema[p]?.options || []).map((o) => o.name);
    bookOptions = { authors: names("著者名"), publishers: names("出版社") };
    return bookOptions;
  }

  async function getBooks() {
    const [options, rows] = await Promise.all([loadBookOptions(), queryRows(DS.book)]);
    knownBooks.clear();
    // 子ページ（前の形のハイライト）も同じDBの行として返るので、書籍名のある本だけを並べる
    const legacyIds = new Set(rows.flatMap((r) => list(r["読書メモ_DBからのリレーション"]).map(idOf)));
    const books = rows.map(bookRow).filter((b) => b.id && !legacyIds.has(b.id));
    for (const b of books) knownBooks.set(b.id, b);
    return { books: books.map(publicBook), options, loadedAt: new Date().toISOString() };
  }

  const publicBook = ({ legacy, ...b }) => b;

  function clean(v, max, label) {
    const t = String(v ?? "").replace(/\r\n/g, "\n").trim();
    if (t.length > max) throw apiError(400, `${label}は${max}文字までです`);
    return t;
  }

  async function addBook(body) {
    const title = clean(body?.title, TITLE_MAX, "書籍名").replace(/\s+/g, " ");
    if (!title) throw apiError(400, "書籍名を入れてください");
    const author = clean(body?.author, 60, "著者名").replace(/\s+/g, " ");
    const publisher = clean(body?.publisher, 60, "出版社").replace(/\s+/g, " ");
    const status = BOOK_STATUSES.includes(body?.status) ? body.status : "読中";
    const properties = { 書籍名: title, ステータス: status };
    if (author) properties["著者名"] = author;
    if (publisher) properties["出版社"] = publisher;
    const res = await call("create", { parent: { type: "data_source_id", data_source_id: DS.book }, pages: [{ properties }], allow_async: false });
    const url = res?.pages?.[0]?.url || "";
    if (!idOf(url)) throw apiError(502, "本を足せたか確かめられませんでした。読み直してください");
    const book = bookRow({ url, 書籍名: title, 著者名: author, 出版社: publisher, ステータス: status });
    knownBooks.set(book.id, book);
    return { book: publicBook(book) };
  }

  async function updateBook(id, body) {
    const book = knownBooks.get(id);
    if (!book) throw apiError(403, "この画面で読み込んだ本だけ変更できます");
    const properties = {};
    if ("status" in body) {
      if (!BOOK_STATUSES.includes(body.status)) throw apiError(400, "変更できないステータスです");
      properties["ステータス"] = body.status;
    }
    if ("finished" in body) {
      const d = body.finished ? String(body.finished) : "";
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw apiError(400, "読了日は 2026-10-26 の形で入れてください");
      properties["date:読了日:start"] = d || null;
      if (d) properties["date:読了日:is_datetime"] = 0;
    }
    if ("rating" in body) {
      if (body.rating && !RATINGS.includes(body.rating)) throw apiError(400, "評価は★1〜5で選んでください");
      properties["評価"] = body.rating || null;
    }
    if ("review" in body) properties["感想"] = clean(body.review, REVIEW_MAX, "感想");
    if ("meter" in body) properties["読書メーター"] = body.meter ? "__YES__" : "__NO__";
    if ("notebooklm" in body) properties["NotebookLM"] = body.notebooklm ? "__YES__" : "__NO__";
    if (!Object.keys(properties).length) throw apiError(400, "変更する項目がありません");
    await call("update", { page_id: id, command: "update_properties", properties, allow_async: false });
    const map = { ステータス: "status", "date:読了日:start": "finished", 評価: "rating", 感想: "review" };
    for (const [k, v] of Object.entries(properties)) if (map[k]) book[map[k]] = v ?? (k === "評価" ? "" : null);
    if ("meter" in body) book.meter = !!body.meter;
    if ("notebooklm" in body) book.notebooklm = !!body.notebooklm;
    return { book: publicBook(book) };
  }

  // ---------- ハイライト（DB_読書ハイライト） ----------
  const knownHl = new Map(); // id → 本のID（メモの書き換えは読み込んだハイライトだけ）

  function hlRow(r) {
    return {
      id: idOf(r.url),
      url: r.url,
      text: text(r["引用"]),
      page: num(r["ページ"]),
      loc: text(r["位置"]),
      source: text(r["出どころ"]),
      memo: text(r["メモ"]),
      date: dateOf(r, "記録日"),
    };
  }

  async function getHighlights(bookId) {
    const book = knownBooks.get(bookId);
    if (!book) throw apiError(403, "この画面で読み込んだ本だけ開けます");
    const [rows, legacy] = await Promise.all([
      queryRows(DS.hl, {
        filters: [{ type: "property", property: "本", propertyType: "relation", operator: "relation_contains", value: { type: "exact", value: book.url } }],
      }),
      getLegacy(book),
    ]);
    const highlights = rows.map(hlRow).filter((h) => h.id);
    for (const h of highlights) knownHl.set(h.id, bookId);
    // ページ順（ページの無いものは記録順のまま後ろへ）
    highlights.sort((a, b) => (a.page ?? 1e9) - (b.page ?? 1e9) || String(a.loc).localeCompare(String(b.loc), "ja", { numeric: true }));
    return { highlights, legacy };
  }

  // 前の形：本のページの下の子ページ（タイトル＝引用、本文＝写真とひとこと）。読むだけ
  async function getLegacy(book) {
    const urls = book.legacy.slice(0, LEGACY_MAX);
    const pages = await Promise.all(urls.map((u) => call("fetch", { id: u }, { read: true }).then((res) => {
      const content = between(res.text, "content") || "";
      return {
        id: idOf(u),
        url: u,
        text: text(res.title) || "（無題）",
        memo: text(content.replace(/<image[^>]*\/>/g, "")),
        hasPhoto: /<image /.test(content),
      };
    }, () => null)));
    return pages.filter(Boolean);
  }

  // 本文に書く文字。< > はタグと読まれないよう全角に、Markdown の記号は打ち消す
  const md = (t) => String(t).replace(/</g, "＜").replace(/>/g, "＞").replace(/([\\*_`~[\]])/g, "\\$1");

  // 写真から読んだときは、ページの文のなかでこのハイライトの所に色を付けて本文に残す
  function contextBody(context, quote) {
    const paras = context.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    const lines = paras.map((p) => {
      const at = p.indexOf(quote);
      if (at < 0) return md(p);
      return `${md(p.slice(0, at))}<span color="yellow_bg">${md(quote)}</span>${md(p.slice(at + quote.length))}`;
    });
    return `## ページの文\n\n${lines.join("\n\n")}`;
  }

  async function addHighlights(body) {
    const book = knownBooks.get(String(body?.bookId || ""));
    if (!book) throw apiError(403, "この画面で読み込んだ本だけにハイライトを足せます");
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) throw apiError(400, "足すハイライトがありません");
    if (items.length > SAVE_MAX) throw apiError(400, `一度に足せるのは${SAVE_MAX}件までです`);
    const today = jstToday();
    const pages = items.map((it) => {
      const quote = clean(it?.text, QUOTE_MAX, "ハイライト").replace(/\s*\n\s*/g, " ");
      if (!quote) throw apiError(400, "空のハイライトがあります");
      const source = SOURCES.includes(it?.source) ? it.source : "✍️ 手入力";
      const page = it?.page === "" || it?.page == null ? null : Number(it.page);
      if (page != null && (!Number.isInteger(page) || page < 0 || page > 99999)) throw apiError(400, "ページは数字で入れてください");
      const properties = {
        引用: quote,
        本: [book.url],
        出どころ: source,
        ページ: page,
        位置: clean(it?.loc, 40, "位置"),
        メモ: clean(it?.memo, MEMO_MAX, "メモ"),
        "date:記録日:start": today,
        "date:記録日:is_datetime": 0,
      };
      for (const k of Object.keys(properties)) if (properties[k] == null || properties[k] === "") delete properties[k];
      const context = clean(it?.context, CONTEXT_MAX, "ページの文");
      const p = { properties };
      if (context) p.content = contextBody(context, quote);
      return p;
    });
    const res = await call("create", { parent: { type: "data_source_id", data_source_id: DS.hl }, pages, allow_async: false });
    const added = (res?.pages || []).length || pages.length;
    book.highlightCount += added;
    // 読み始めた本は「読中」にする
    if (book.status === "未読") {
      await call("update", { page_id: book.id, command: "update_properties", properties: { ステータス: "読中" }, allow_async: false });
      book.status = "読中";
    }
    return { added, book: publicBook(book) };
  }

  async function updateHighlight(id, body) {
    if (!knownHl.has(id)) throw apiError(403, "この画面で読み込んだハイライトだけ変更できます");
    const memo = clean(body?.memo, MEMO_MAX, "メモ");
    await call("update", { page_id: id, command: "update_properties", properties: { メモ: memo }, allow_async: false });
    return { id, memo };
  }

  const jstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

  // ---------- 共通 ----------
  function apiError(status, message) {
    return Object.assign(new Error(message), { status, apiMessage: message });
  }

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  async function route(method, url, body) {
    const p = url.pathname;
    const book = p.match(/^\/api\/books\/([0-9a-f]{32})(\/highlights)?$/i);
    const hl = p.match(/^\/api\/highlights\/([0-9a-f]{32})$/i);
    if (p === "/api/books" && method === "GET") return getBooks();
    if (p === "/api/books" && method === "POST") return addBook(body);
    if (book && book[2] && method === "GET") return getHighlights(book[1].toLowerCase());
    if (book && !book[2] && method === "PATCH") return updateBook(book[1].toLowerCase(), body);
    if (p === "/api/highlights" && method === "POST") return addHighlights(body);
    if (hl && method === "PATCH") return updateHighlight(hl[1].toLowerCase(), body);
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
