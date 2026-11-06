// しおり：画面の配信と Notion API の中継（Cloudflare Worker）
// Notion のトークンはこの Worker の secret にだけ置き、ブラウザには渡さない。
// 書き換えるのは 読書メモ_DB（本）と DB_読書ハイライト の行だけ。

const NOTION_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const BOOK_STATUSES = ["未読", "読中", "読了"];
const RATINGS = ["★★★★★", "★★★★", "★★★", "★★", "★"];
const SOURCES = ["📷 付箋写真", "📱 Kindle", "✍️ 手入力"];
const KINDS = ["📍 舞台", "🌿 植物", "👥 人物・距離感", "🍽 食・道具", "📖 言葉", "✦ その他"];
const TERM_MAX = 100;
const RESEARCH_PROP = "🔍 背景を調べる"; // 読書メモ_DB のチェック。付けると次の「読書辞典の下準備」が背景を調べる
const LOOKUP_MAX = 6;
const NDL_BASE = "https://ndlsearch.ndl.go.jp/api/opensearch";
const DESC_MAX = 1000;
const TITLE_MAX = 200;
const QUOTE_MAX = 1900; // Notion のタイトルは 2000 文字まで
const MEMO_MAX = 1000;
const CONTEXT_MAX = 6000;
const REVIEW_MAX = 255; // 読書メーターの感想の上限
const SAVE_MAX = 40; // 1回で足すハイライトの数（無料プランの Worker は1回の通信が50件まで）
const LEGACY_MAX = 20; // 前の形（本のページの下の子ページ）を読む数。1件で2回通信する
const RICH_MAX = 2000;
const MAX_QUERY_PAGES = 5;
const LEGACY_REL = "読書メモ_DBからのリレーション";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      // Safari のブックマーク「しおりへ同期」が Amazon のページから送るフォーム。合言葉は持たないので、受け取った中身を画面に渡すだけ（Notion には触らない）
      if (url.pathname === "/api/kindle-sync") return await kindleSyncPage(request, url);
      checkConfig(env);
      if (!authorized(request, env)) return json({ error: "合言葉が違います" }, 401);
      const notion = notionClient(env);
      const p = url.pathname;
      const m = request.method;
      const book = p.match(/^\/api\/books\/([0-9a-f-]{32,36})(\/highlights)?$/i);
      const hl = p.match(/^\/api\/highlights\/([0-9a-f-]{32,36})$/i);
      const terms = p.match(/^\/api\/books\/([0-9a-f-]{32,36})\/terms$/i);
      const term = p.match(/^\/api\/terms\/([0-9a-f-]{32,36})$/i);

      if (p === "/api/books" && m === "GET") return json(await getBooks(notion, env));
      if (p === "/api/lookup" && m === "GET") return json(await lookupBooks(url.searchParams.get("q")));
      if (p === "/api/books" && m === "POST") return json(await addBook(notion, env, await readJson(request)));
      if (book && book[2] && m === "GET") return json(await getHighlights(notion, env, book[1]));
      if (book && !book[2] && m === "PATCH") return json(await updateBook(notion, env, book[1], await readJson(request)));
      if (p === "/api/highlights" && m === "POST") return json(await addHighlights(notion, env, await readJson(request)));
      if (hl && m === "PATCH") return json(await updateHighlight(notion, env, hl[1], await readJson(request)));
      if (terms && m === "GET") return json(await getTerms(notion, env, terms[1]));
      if (p === "/api/terms" && m === "POST") return json(await addTerm(notion, env, await readJson(request)));
      if (term && m === "PATCH") return json(await updateTerm(notion, env, term[1], await readJson(request)));
      if (term && m === "DELETE") return json(await removeTerm(notion, env, term[1]));
      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: err.publicMessage || "サーバーでエラーが起きました" }, err.status || 500);
    }
  },
};

function checkConfig(env) {
  if (!env.NOTION_TOKEN || !env.APP_KEY || env.APP_KEY.length < 16 || !env.BOOK_DS_ID || !env.HIGHLIGHT_DS_ID) {
    throw httpError(500, "Worker の設定（NOTION_TOKEN / APP_KEY / BOOK_DS_ID / HIGHLIGHT_DS_ID）が足りません");
  }
}

function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  return constantTimeEqual(given, env.APP_KEY);
}

function constantTimeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) diff |= (x[i] ?? 0) ^ y[i];
  return diff === 0;
}

function notionClient(env) {
  const base = env.NOTION_API_BASE || NOTION_BASE;
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const hint =
        data.code === "object_not_found"
          ? "Notion で 読書メモ_DB・DB_読書ハイライト・DB_読書辞典 のどれかにインテグレーションが接続されていません（README の手順1）"
          : data.code === "unauthorized"
            ? "Notion のトークンが正しくありません"
            : data.code === "rate_limited"
              ? "Notion が混み合っています。少し待ってください"
              : `Notion エラー（${data.code || res.status}）`;
      throw httpError(res.status === 429 ? 429 : 502, hint);
    }
    return data;
  };
}

// ---------- Notion のページを読む ----------
const plain = (rich) => (rich || []).map((t) => t.plain_text ?? t.text?.content ?? "").join("");

function propText(prop) {
  if (!prop) return "";
  switch (prop.type) {
    case "title": return plain(prop.title);
    case "rich_text": return plain(prop.rich_text);
    case "select": return prop.select?.name || "";
    case "status": return prop.status?.name || "";
    case "number": return prop.number == null ? "" : String(prop.number);
    default: return "";
  }
}
const propDate = (prop) => (prop?.date?.start ? prop.date.start.slice(0, 10) : null);
const propNum = (prop) => (typeof prop?.number === "number" ? prop.number : null);
const relIds = (prop) => (prop?.relation || []).map((r) => normalizeId(r.id));

function coverOf(prop) {
  for (const f of prop?.files || []) {
    const src = f.type === "external" ? f.external?.url : f.file?.url;
    if (/^https:\/\//.test(src || "")) return src;
  }
  return "";
}

function bookOf(page) {
  const p = page.properties || {};
  return {
    id: normalizeId(page.id),
    url: page.url,
    title: propText(p["書籍名"]) || "（無題）",
    author: propText(p["著者名"]),
    publisher: propText(p["出版社"]),
    status: propText(p["ステータス"]) || "未読",
    finished: propDate(p["読了日"]),
    rating: propText(p["評価"]),
    review: propText(p["感想"]),
    meter: !!p["読書メーター"]?.checkbox,
    notebooklm: !!p.NotebookLM?.checkbox,
    cover: coverOf(p["ファイル&メディア"]),
    highlightCount: relIds(p["ハイライト"]).length,
    highlightMore: !!p["ハイライト"]?.has_more,
    legacyCount: relIds(p[LEGACY_REL]).length,
    termCount: relIds(p["読書辞典"]).length,
    termMore: !!p["読書辞典"]?.has_more,
    research: !!p[RESEARCH_PROP]?.checkbox,
  };
}

function highlightOf(page) {
  const p = page.properties || {};
  return {
    id: normalizeId(page.id),
    url: page.url,
    text: propText(p["引用"]),
    page: propNum(p["ページ"]),
    loc: propText(p["位置"]),
    source: propText(p["出どころ"]),
    memo: propText(p["メモ"]),
    date: propDate(p["記録日"]),
  };
}

// 書き換える前に、そのページが決まった DB の行か確かめる（ほかのページには触らない）
async function rowOf(notion, id, dsId, label) {
  const page = await notion("GET", `/pages/${normalizeId(id)}`);
  if (normalizeId(page.parent?.data_source_id) !== normalizeId(dsId)) throw httpError(403, `${label}の行ではありません`);
  return page;
}

// ---------- 本（読書メモ_DB） ----------
async function getBooks(notion, env) {
  const [ds, rows] = await Promise.all([notion("GET", `/data_sources/${env.BOOK_DS_ID}`), queryAll(notion, env.BOOK_DS_ID, {})]);
  const names = (prop) => (ds.properties?.[prop]?.select?.options || []).map((o) => o.name);
  return { books: rows.map(bookOf), options: { authors: names("著者名"), publishers: names("出版社") }, loadedAt: new Date().toISOString() };
}

function clean(v, max, label) {
  const t = String(v ?? "").replace(/\r\n/g, "\n").trim();
  if (t.length > max) throw httpError(400, `${label}は${max}文字までです`);
  return t;
}

const rich = (s) => (s ? chunks(s).map((c) => ({ type: "text", text: { content: c } })) : []);
function chunks(s, n = RICH_MAX) {
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}

async function addBook(notion, env, body) {
  const title = clean(body?.title, TITLE_MAX, "書籍名").replace(/\s+/g, " ");
  if (!title) throw httpError(400, "書籍名を入れてください");
  const author = clean(body?.author, 60, "著者名").replace(/\s+/g, " ");
  const publisher = clean(body?.publisher, 60, "出版社").replace(/\s+/g, " ");
  const status = BOOK_STATUSES.includes(body?.status) ? body.status : "読中";
  // 著者名・出版社は選択肢。新しい名前は Notion が選択肢に足す
  const properties = { 書籍名: { title: rich(title) }, ステータス: { status: { name: status } } };
  if (author) properties["著者名"] = { select: { name: author.replace(/,/g, "，") } };
  if (publisher) properties["出版社"] = { select: { name: publisher.replace(/,/g, "，") } };
  const cover = clean(body?.cover, 500, "表紙のURL");
  if (cover) {
    if (!/^https:\/\/[^\s"<>]+$/.test(cover)) throw httpError(400, "表紙のURLが正しくありません");
    properties["ファイル&メディア"] = { files: [{ type: "external", name: "cover.jpg", external: { url: cover } }] };
  }
  const page = await notion("POST", "/pages", { parent: { type: "data_source_id", data_source_id: env.BOOK_DS_ID }, properties });
  return { book: bookOf(page) };
}

async function updateBook(notion, env, id, body) {
  await rowOf(notion, id, env.BOOK_DS_ID, "読書メモ_DB ");
  const properties = {};
  if ("status" in body) {
    if (!BOOK_STATUSES.includes(body.status)) throw httpError(400, "変更できないステータスです");
    properties["ステータス"] = { status: { name: body.status } };
  }
  if ("finished" in body) {
    const d = body.finished ? String(body.finished) : "";
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw httpError(400, "読了日は 2026-10-26 の形で入れてください");
    properties["読了日"] = { date: d ? { start: d } : null };
  }
  if ("rating" in body) {
    if (body.rating && !RATINGS.includes(body.rating)) throw httpError(400, "評価は★1〜5で選んでください");
    properties["評価"] = { select: body.rating ? { name: body.rating } : null };
  }
  if ("review" in body) properties["感想"] = { rich_text: rich(clean(body.review, REVIEW_MAX, "感想")) };
  if ("meter" in body) properties["読書メーター"] = { checkbox: !!body.meter };
  if ("notebooklm" in body) properties.NotebookLM = { checkbox: !!body.notebooklm };
  if ("research" in body) properties[RESEARCH_PROP] = { checkbox: !!body.research };
  if (!Object.keys(properties).length) throw httpError(400, "変更する項目がありません");
  const page = await notion("PATCH", `/pages/${normalizeId(id)}`, { properties });
  return { book: bookOf(page) };
}

// ---------- 本を Web で探す（国立国会図書館の書誌＋表紙） ----------
// 書名で国立国会図書館サーチ（OpenSearch）を引き、ISBN のある本だけを返す。表紙は Amazon（ISBN-10）→ Google の順で、ある方を使う
const tag = (xml, name) => (xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)<`)) || [])[1]?.trim() || "";
const unescapeXml = (s) => s.replace(/&(lt|gt|amp|quot|apos|#39);/g, (_, e) => ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", "#39": "'" })[e]);

// 「東野, 圭吾, 1958-2026」→「東野　圭吾」。年・役割（著・訳）は落とす。「Dostoyevsky, Fyodor」のような欧文はそのまま
function formatCreator(raw) {
  const first = unescapeXml(raw).split(/\s*;\s*/)[0];
  const parts = first.split(/\s*,\s*/).map((x) => x.replace(/\s*(著|訳|編|監修|作|画)$/u, "").trim()).filter((x) => x && !/^\d{4}/.test(x));
  if (!parts.length) return "";
  return /^[\x20-\x7e]+$/.test(parts.join("")) ? parts.join(", ") : parts.join("　");
}

// 古い本は ISBN-10 で登録されていることがある → 13 桁にそろえる
const isbnTo13 = (raw) => {
  const d = String(raw || "").replace(/[^0-9Xx]/g, "").toUpperCase();
  if (/^97[89]\d{10}$/.test(d)) return d;
  if (!/^\d{9}[\dX]$/.test(d)) return "";
  const core = `978${d.slice(0, 9)}`;
  const sum = [...core].reduce((a, c, i) => a + Number(c) * (i % 2 ? 3 : 1), 0);
  return core + String((10 - (sum % 10)) % 10);
};

const isbn13to10 = (isbn13) => {
  const core = isbn13.slice(3, 12);
  const sum = [...core].reduce((a, c, i) => a + (10 - i) * Number(c), 0);
  const r = (11 - (sum % 11)) % 11;
  return core + (r === 10 ? "X" : String(r));
};

async function coverFor(isbn) {
  const tries = [
    { url: `https://images-na.ssl-images-amazon.com/images/P/${isbn13to10(isbn)}.09.LZZZZZZZ.jpg`, ok: (ct) => /image\/jpe?g/.test(ct) },
    { url: `https://books.google.com/books/content?vid=ISBN${isbn}&printsec=frontcover&img=1&zoom=1`, ok: (ct) => /image\/jpe?g/.test(ct) },
  ];
  for (const t of tries) {
    try {
      const res = await fetch(t.url, { method: "HEAD" });
      if (res.ok && t.ok(res.headers.get("content-type") || "")) return t.url;
    } catch { /* 次を試す */ }
  }
  return "";
}

async function lookupBooks(q) {
  const title = clean(q, TITLE_MAX, "書名").replace(/\s+/g, " ");
  if (title.length < 2) throw httpError(400, "書名を2文字以上入れてください");
  // 混み合うと一時的に失敗することがあるので1回だけやり直す
  const ndl = () => fetch(`${NDL_BASE}?title=${encodeURIComponent(title)}&cnt=50`, { headers: { "User-Agent": "shiori/1.0 (reading-notes app)", Accept: "application/xml" } });
  let res = await ndl();
  if (!res.ok) {
    await new Promise((r) => setTimeout(r, 600));
    res = await ndl();
  }
  if (!res.ok) throw httpError(502, `国立国会図書館サーチにつながりませんでした（${res.status}）。少し待ってからもう一度`);
  const xml = await res.text();
  const seen = new Map();
  const items = [];
  for (const it of xml.match(/<item>[\s\S]*?<\/item>/g) || []) {
    const isbn = isbnTo13(tag(it, 'dc:identifier xsi:type="dcndl:ISBN"'));
    if (!isbn) continue;
    const series = unescapeXml(tag(it, "dcndl:seriesTitle")).split(/\s*;\s*/)[0];
    const publisher = unescapeXml(tag(it, "dc:publisher"));
    // 同じ ISBN が何度も出るときは、文庫名・著者などが埋まっている方を採る
    const dup = seen.get(isbn);
    if (dup) {
      if (!dup.series && series) { dup.series = series; dup.publisher = /文庫|新書/.test(series) ? series : dup.publisher; }
      if (!dup.author) dup.author = formatCreator(tag(it, "dc:creator"));
      if (!dup.volume) dup.volume = unescapeXml(tag(it, "dcndl:volume"));
      continue;
    }
    const item = {
      title: unescapeXml(tag(it, "dc:title")),
      volume: unescapeXml(tag(it, "dcndl:volume")),
      author: formatCreator(tag(it, "dc:creator")),
      publisher: /文庫|新書/.test(series) ? series : publisher,
      series,
      year: (tag(it, "dcterms:issued").match(/\d{4}/) || [""])[0],
      isbn,
      cover: "",
    };
    seen.set(isbn, item);
    items.push(item);
  }
  // 日本の本（978-4）を先に、その中でも文庫・新書を先に。海外の翻訳版は後ろ
  const rank = (b) => (b.isbn.startsWith("9784") ? 0 : 2) + (/文庫|新書/.test(b.series) ? 0 : 1);
  const picked = items.map((b, i) => [rank(b), i, b]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).slice(0, LOOKUP_MAX).map((x) => x[2]);
  await Promise.all(picked.map(async (b) => { b.cover = await coverFor(b.isbn); }));
  return { items: picked };
}

// ---------- ハイライト（DB_読書ハイライト） ----------
async function getHighlights(notion, env, bookId) {
  const book = await rowOf(notion, bookId, env.BOOK_DS_ID, "読書メモ_DB ");
  const [rows, legacy] = await Promise.all([
    queryAll(notion, env.HIGHLIGHT_DS_ID, { filter: { property: "本", relation: { contains: normalizeId(bookId) } } }),
    getLegacy(notion, bookId, relIds(book.properties?.[LEGACY_REL])),
  ]);
  const highlights = rows.map(highlightOf);
  // ページ順（ページの無いものは後ろへ、位置の順）
  highlights.sort((a, b) => (a.page ?? 1e9) - (b.page ?? 1e9) || String(a.loc).localeCompare(String(b.loc), "ja", { numeric: true }));
  return { highlights, legacy };
}

// 前の形：本のページの下の子ページ（タイトル＝引用、本文＝写真とひとこと）。読むだけ。
// 関連の列は API では空のことがあるので、本のページの中の子ページを直接探し、関連にしかないものも足す
async function getLegacy(notion, bookId, relatedIds) {
  const kids = await notion("GET", `/blocks/${normalizeId(bookId)}/children?page_size=100`);
  const found = (kids.results || []).filter((b) => b.type === "child_page").map((b) => ({ id: normalizeId(b.id), title: b.child_page?.title || "" }));
  for (const id of relatedIds) if (!found.some((f) => f.id === id)) found.push({ id, title: null });
  const pages = await Promise.all(found.slice(0, LEGACY_MAX).map(async ({ id, title }) => {
    try {
      const [page, body] = await Promise.all([
        title == null ? notion("GET", `/pages/${id}`) : null,
        notion("GET", `/blocks/${id}/children?page_size=50`),
      ]);
      const t = title ?? plain(Object.values(page?.properties || {}).find((p) => p.type === "title")?.title);
      const blocks = body.results || [];
      return {
        id,
        url: page?.url || `https://www.notion.so/${id}`,
        text: t || "（無題）",
        memo: blocks.map((b) => plain(b[b.type]?.rich_text)).filter(Boolean).join("\n"),
        hasPhoto: blocks.some((b) => b.type === "image"),
      };
    } catch {
      return null;
    }
  }));
  return pages.filter(Boolean);
}

// 写真から読んだときは、ページの文のなかでこのハイライトの所に色を付けて本文に残す
function contextBlocks(context, quote) {
  const paras = context.split(/\n+/).map((p) => p.trim()).filter(Boolean).slice(0, 90);
  const para = (segments) => ({ object: "block", type: "paragraph", paragraph: { rich_text: segments } });
  const seg = (s, mark) => chunks(s).map((c) => ({ type: "text", text: { content: c }, ...(mark ? { annotations: { color: "yellow_background" } } : {}) }));
  return [
    { object: "block", type: "heading_2", heading_2: { rich_text: rich("ページの文") } },
    ...paras.map((p) => {
      const at = p.indexOf(quote);
      if (at < 0) return para(seg(p));
      return para([...seg(p.slice(0, at)), ...seg(quote, true), ...seg(p.slice(at + quote.length))]);
    }),
  ];
}

async function addHighlights(notion, env, body) {
  const bookId = normalizeId(String(body?.bookId || ""));
  if (!/^[0-9a-f]{32}$/.test(bookId)) throw httpError(400, "本を選んでください");
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) throw httpError(400, "足すハイライトがありません");
  if (items.length > SAVE_MAX) throw httpError(400, `一度に足せるのは${SAVE_MAX}件までです`);
  const today = jstDate(new Date().toISOString());
  // 先に全部を確かめてから書く（途中で止まって半端に残らないように）
  const pages = items.map((it) => {
    const quote = clean(it?.text, QUOTE_MAX, "ハイライト").replace(/\s*\n\s*/g, " ");
    if (!quote) throw httpError(400, "空のハイライトがあります");
    const source = SOURCES.includes(it?.source) ? it.source : "✍️ 手入力";
    const page = it?.page === "" || it?.page == null ? null : Number(it.page);
    if (page != null && (!Number.isInteger(page) || page < 0 || page > 99999)) throw httpError(400, "ページは数字で入れてください");
    const loc = clean(it?.loc, 40, "位置");
    const memo = clean(it?.memo, MEMO_MAX, "メモ");
    const properties = {
      引用: { title: rich(quote) },
      本: { relation: [{ id: bookId }] },
      出どころ: { select: { name: source } },
      記録日: { date: { start: today } },
    };
    if (page != null) properties["ページ"] = { number: page };
    if (loc) properties["位置"] = { rich_text: rich(loc) };
    if (memo) properties["メモ"] = { rich_text: rich(memo) };
    const context = clean(it?.context, CONTEXT_MAX, "ページの文");
    return { properties, ...(context ? { children: contextBlocks(context, quote) } : {}) };
  });
  const book = await rowOf(notion, bookId, env.BOOK_DS_ID, "読書メモ_DB ");
  let added = 0;
  for (const p of pages) {
    await notion("POST", "/pages", { parent: { type: "data_source_id", data_source_id: env.HIGHLIGHT_DS_ID }, ...p });
    added++;
  }
  // 読み始めた本は「読中」にする
  let updated = book;
  if (propText(book.properties?.["ステータス"]) === "未読" || !propText(book.properties?.["ステータス"])) {
    updated = await notion("PATCH", `/pages/${bookId}`, { properties: { ステータス: { status: { name: "読中" } } } });
  }
  const out = bookOf(updated);
  // ページの関連は書いた直後に増えていないことがあるので、足した数を加えて返す
  if (out.highlightCount === bookOf(book).highlightCount) out.highlightCount += added;
  return { added, book: out };
}

// ---------- Kindle 同期（ブックマークから受け取る） ----------
const SYNC_MAX = 8 * 1024 * 1024;
async function kindleSyncPage(request, url) {
  if (request.method !== "POST") return Response.redirect(`${url.origin}/sync.html`, 303);
  const type = request.headers.get("Content-Type") || "";
  if (!/application\/x-www-form-urlencoded|multipart\/form-data/.test(type)) throw httpError(400, "フォームからだけ受け取れます");
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > SYNC_MAX) throw httpError(413, "一度に受け取れる量を超えました（8MB）");
  const form = await request.formData().catch(() => null);
  const raw = form?.get("data");
  if (typeof raw !== "string" || !raw) throw httpError(400, "データがありません");
  if (raw.length > SYNC_MAX) throw httpError(413, "一度に受け取れる量を超えました（8MB）");
  let data;
  try { data = JSON.parse(raw); } catch { throw httpError(400, "データの形が読めません"); }
  if (!data || data.v !== 1 || !Array.isArray(data.books)) throw httpError(400, "データの形が読めません");
  // 画面（sync.html）に渡す。</script> で閉じられないように < を逃がす
  const safe = JSON.stringify(data).replace(/</g, "\\u003c");
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>しおりへ同期</title></head><body style="font-family:-apple-system,sans-serif;padding:24px;color:#1f3a3d">
<p id="msg">Kindle のハイライトを受け取りました。しおりを開いています…</p>
<script type="application/json" id="payload">${safe}</script>
<script>
try { sessionStorage.setItem("shiori:kindleSync", document.getElementById("payload").textContent); location.replace("/sync.html"); }
catch (e) { document.getElementById("msg").textContent = "データを受け取れませんでした：" + e.message; }
</script></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function updateHighlight(notion, env, id, body) {
  await rowOf(notion, id, env.HIGHLIGHT_DS_ID, "DB_読書ハイライト ");
  const memo = clean(body?.memo, MEMO_MAX, "メモ");
  await notion("PATCH", `/pages/${normalizeId(id)}`, { properties: { メモ: { rich_text: rich(memo) } } });
  return { id: normalizeId(id), memo };
}

// ---------- 読書辞典（DB_読書辞典） ----------
// 読みながら出てきた語を本ごとにためる。説明は自分で書くか、チャットで Claude に頼んで Notion に書き足してもらう
function termOf(page) {
  const p = page.properties || {};
  return {
    id: normalizeId(page.id),
    url: page.url,
    term: propText(p["語"]),
    kind: propText(p["種別"]),
    page: propNum(p["ページ"]),
    desc: propText(p["説明"]),
    memo: propText(p["メモ"]),
    date: propDate(p["記録日"]),
    by: propText(p["書いた人"]),
  };
}

const termDs = (env) => {
  if (!env.TERM_DS_ID) throw httpError(500, "TERM_DS_ID が設定されていません（wrangler.toml）");
  return env.TERM_DS_ID;
};

async function getTerms(notion, env, bookId) {
  await rowOf(notion, bookId, env.BOOK_DS_ID, "読書メモ_DB ");
  const rows = await queryAll(notion, termDs(env), { filter: { property: "本", relation: { contains: normalizeId(bookId) } } });
  const terms = rows.map(termOf);
  // 出てきた順（ページの無いものは後ろ）、同じページなら五十音
  terms.sort((a, b) => (a.page ?? 1e9) - (b.page ?? 1e9) || a.term.localeCompare(b.term, "ja"));
  return { terms };
}

// 送られてきた項目だけを Notion の形にする（無い項目は変えない）
function termProps(body, { creating }) {
  const properties = {};
  if (creating || "term" in body) {
    const t = clean(body?.term, TERM_MAX, "語").replace(/\s+/g, " ");
    if (!t) throw httpError(400, "語を入れてください");
    properties["語"] = { title: rich(t) };
  }
  if (creating || "kind" in body) {
    const k = KINDS.includes(body?.kind) ? body.kind : creating ? "✦ その他" : null;
    if (!k) throw httpError(400, "選べない種別です");
    properties["種別"] = { select: { name: k } };
  }
  if ("page" in body) {
    const n = body.page === "" || body.page == null ? null : Number(body.page);
    if (n != null && (!Number.isInteger(n) || n < 0 || n > 99999)) throw httpError(400, "ページは数字で入れてください");
    if (n != null || !creating) properties["ページ"] = { number: n };
  }
  if ("desc" in body) properties["説明"] = { rich_text: rich(clean(body.desc, DESC_MAX, "説明")) };
  if ("memo" in body) properties["メモ"] = { rich_text: rich(clean(body.memo, MEMO_MAX, "メモ")) };
  return properties;
}

async function addTerm(notion, env, body) {
  const bookId = normalizeId(String(body?.bookId || ""));
  if (!/^[0-9a-f]{32}$/.test(bookId)) throw httpError(400, "本を選んでください");
  const properties = termProps(body || {}, { creating: true });
  await rowOf(notion, bookId, env.BOOK_DS_ID, "読書メモ_DB ");
  properties["本"] = { relation: [{ id: bookId }] };
  properties["記録日"] = { date: { start: jstDate(new Date().toISOString()) } };
  properties["書いた人"] = { select: { name: "✍️ 自分" } };
  const page = await notion("POST", "/pages", { parent: { type: "data_source_id", data_source_id: termDs(env) }, properties });
  return { term: termOf(page) };
}

async function updateTerm(notion, env, id, body) {
  const properties = termProps(body || {}, { creating: false });
  if (!Object.keys(properties).length) throw httpError(400, "変更する項目がありません");
  await rowOf(notion, id, termDs(env), "DB_読書辞典 ");
  const page = await notion("PATCH", `/pages/${normalizeId(id)}`, { properties });
  return { term: termOf(page) };
}

// 消すときはゴミ箱へ（Notion のゴミ箱から戻せる）
async function removeTerm(notion, env, id) {
  await rowOf(notion, id, termDs(env), "DB_読書辞典 ");
  await notion("PATCH", `/pages/${normalizeId(id)}`, { in_trash: true });
  return { id: normalizeId(id), removed: true };
}

// ---------- 共通 ----------
async function queryAll(notion, dataSourceId, body) {
  const out = [];
  let cursor;
  for (let i = 0; i < MAX_QUERY_PAGES; i++) {
    const res = await notion("POST", `/data_sources/${dataSourceId}/query`, {
      ...body,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    out.push(...(res.results || []));
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return out;
}

function jstDate(iso) {
  return new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
}

function normalizeId(id) {
  return (id || "").replace(/-/g, "").toLowerCase();
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError(400, "リクエストの形式が正しくありません");
  }
}

function httpError(status, publicMessage) {
  return Object.assign(new Error(publicMessage), { status, publicMessage });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
