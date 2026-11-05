// Worker の動作確認。Notion API は偽物に差し替える（値はすべて作りもの）。 npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const BOOK_DS = "23362844-acbe-80b5-a2b4-000b59e31cdf";
const HL_DS = "1f6f7d77-b234-4b5b-8e15-4afcf2097567";
const TERM_DS = "3e91760e-bd33-497a-8db0-4a08b618331b";
const KEY = "test-key-0123456789";
const env = {
  NOTION_TOKEN: "ntn_fake",
  APP_KEY: KEY,
  BOOK_DS_ID: BOOK_DS,
  HIGHLIGHT_DS_ID: HL_DS,
  TERM_DS_ID: TERM_DS,
  NOTION_API_BASE: "https://notion.test/v1",
  ASSETS: { fetch: async () => new Response("asset") },
};
const hex = (n) => n.toString(16).padStart(32, "0");
const rt = (s) => [{ plain_text: s }];
const B1 = hex(1);
const B2 = hex(2);
const B3 = hex(3);

function row(id, ds, properties) {
  return { object: "page", id, url: `https://www.notion.so/${id}`, parent: { type: "data_source_id", data_source_id: ds }, properties };
}
function book(id, { title, author, status, legacy = [], hls = [], ...more }) {
  return row(id, BOOK_DS, {
    書籍名: { type: "title", title: rt(title) },
    著者名: { type: "select", select: author ? { name: author } : null },
    出版社: { type: "select", select: null },
    ステータス: { type: "status", status: { name: status } },
    読了日: { type: "date", date: more.finished ? { start: more.finished } : null },
    評価: { type: "select", select: more.rating ? { name: more.rating } : null },
    感想: { type: "rich_text", rich_text: [] },
    読書メーター: { type: "checkbox", checkbox: !!more.meter },
    NotebookLM: { type: "checkbox", checkbox: false },
    "ファイル&メディア": { type: "files", files: more.cover ? [{ type: "external", external: { url: more.cover } }] : [] },
    ハイライト: { type: "relation", relation: hls.map((id) => ({ id })), has_more: false },
    読書メモ_DBからのリレーション: { type: "relation", relation: legacy.map((id) => ({ id })) },
  });
}
function hl(id, bookId, quote, page, more = {}) {
  return row(id, HL_DS, {
    引用: { type: "title", title: rt(quote) },
    本: { type: "relation", relation: [{ id: bookId }] },
    ページ: { type: "number", number: page },
    位置: { type: "rich_text", rich_text: more.loc ? rt(more.loc) : [] },
    出どころ: { type: "select", select: { name: more.source || "📷 付箋写真" } },
    メモ: { type: "rich_text", rich_text: [] },
    記録日: { type: "date", date: { start: "2026-10-20" } },
  });
}

const NDL_XML = `<rss><channel>
<item><title>白鳥とコウモリ</title><dc:title>白鳥とコウモリ</dc:title><dc:creator>東野, 圭吾, 1958-2026</dc:creator><dcndl:volume>上</dcndl:volume><dcndl:seriesTitle>幻冬舎文庫 ; ひ-17-3</dcndl:seriesTitle><dc:publisher>幻冬舎</dc:publisher><dcterms:issued>2024.4</dcterms:issued><dc:identifier xsi:type="dcndl:TOHANMARCNO">34584545</dc:identifier><dc:identifier xsi:type="dcndl:ISBN">978-4-344-43370-0</dc:identifier></item>
<item><title>白鳥とコウモリ</title><dc:title>白鳥とコウモリ</dc:title><dc:publisher>松竹事業推進部</dc:publisher><dcterms:issued>2026.9</dcterms:issued><dc:identifier xsi:type="dcndl:JPNO">24302830</dc:identifier></item>
<item><dc:title>地下室の手記</dc:title><dc:creator>Dostoyevsky, Fyodor, 1821-1881</dc:creator><dc:creator>江川, 卓, 1927-2001 訳</dc:creator><dc:publisher>新潮社</dc:publisher><dcndl:seriesTitle>新潮文庫</dcndl:seriesTitle><dcterms:issued>1969</dcterms:issued><dc:identifier xsi:type="dcndl:ISBN">9784102010112</dc:identifier></item>
<item><dc:title>白鳥とコウモリ</dc:title><dc:creator>東野, 圭吾, 1958-2026</dc:creator><dcndl:volume>上</dcndl:volume><dc:identifier xsi:type="dcndl:ISBN">978-4-344-43370-0</dc:identifier></item>
<item><dc:title>Swan and Bat</dc:title><dc:creator>Higashino, Keigo</dc:creator><dc:publisher>Overseas</dc:publisher><dc:identifier xsi:type="dcndl:ISBN">9786020670690</dc:identifier></item>
<item><dc:title>ほか &amp; 本</dc:title><dc:creator>作家 著</dc:creator><dc:publisher>見本社</dc:publisher><dc:identifier xsi:type="dcndl:ISBN">4-00-000000-9</dc:identifier></item>
</channel></rss>`;

let pages;
let calls;
let next;
beforeEach(() => {
  next = 100;
  calls = [];
  pages = new Map([
    [B1, book(B1, { title: "見本の本", author: "作家　一", status: "読中", hls: [hex(21)], cover: "https://example.test/c.jpg" })],
    [B2, book(B2, { title: "読んだ本", status: "読了", finished: "2026-09-01", rating: "★★★★", meter: true, legacy: [hex(31), hex(32)] })],
    [B3, book(B3, { title: "まだの本", status: "未読" })],
    [hex(21), hl(hex(21), B1, "見本のハイライト。", 12)],
    [hex(22), hl(hex(22), B1, "前のページ", 3, { loc: "40", source: "📱 Kindle" })],
    [hex(31), { object: "page", id: hex(31), url: "https://www.notion.so/legacy31", parent: { type: "page_id", page_id: B2 }, properties: { title: { type: "title", title: rt("前の形の引用") } } }],
    [hex(32), { object: "page", id: hex(32), url: "https://www.notion.so/legacy32", parent: { type: "page_id", page_id: B2 }, properties: { title: { type: "title", title: rt("もう一つ") } } }],
    [hex(41), row(hex(41), TERM_DS, { 語: { type: "title", title: rt("ドクダミ") }, 本: { type: "relation", relation: [{ id: B1 }] }, 種別: { type: "select", select: { name: "🌿 植物" } }, 書いた人: { type: "select", select: { name: "🤖 Claude" } }, ページ: { type: "number", number: 30 }, 説明: { type: "rich_text", rich_text: rt("白い花の野草") }, メモ: { type: "rich_text", rich_text: [] }, 記録日: { type: "date", date: { start: "2026-10-28" } } })],
    [hex(42), row(hex(42), TERM_DS, { 語: { type: "title", title: rt("鎌倉") }, 本: { type: "relation", relation: [{ id: B1 }] }, 種別: { type: "select", select: { name: "📍 舞台" } }, ページ: { type: "number", number: 5 }, 説明: { type: "rich_text", rich_text: [] }, メモ: { type: "rich_text", rich_text: [] } })],
    [hex(9), row(hex(9), "other-ds", { 名前: { type: "title", title: rt("ほかのDB") } })],
  ]);
  const children = {
    [hex(31)]: [{ type: "image", image: {} }, { type: "paragraph", paragraph: { rich_text: rt("大事な一文") } }],
    [hex(32)]: [],
    [B2]: [{ type: "child_page", id: hex(31), child_page: { title: "前の形の引用" } }, { type: "paragraph", paragraph: { rich_text: rt("本の感想") } }],
    [hex(33)]: [{ type: "paragraph", paragraph: { rich_text: rt("関連にない子ページ") } }],
  };
  children[B3] = [{ type: "child_page", id: hex(33), child_page: { title: "子ページだけ" } }];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    // 本を Web で探す：国立国会図書館の書誌と表紙の画像は偽物で答える
    if (u.hostname === "ndlsearch.ndl.go.jp") {
      calls.push({ method: "GET", path: u.pathname, body: Object.fromEntries(u.searchParams), headers: {} });
      return new Response(NDL_XML, { status: 200, headers: { "content-type": "application/xml" } });
    }
    if (u.hostname === "images-na.ssl-images-amazon.com") {
      const hit = u.pathname.includes("/434443370X.");
      return new Response("", { status: 200, headers: { "content-type": hit ? "image/jpeg" : "image/gif" } });
    }
    if (u.hostname === "books.google.com") {
      const hit = u.search.includes("ISBN9784102010112");
      return new Response("", { status: 200, headers: { "content-type": hit ? "image/jpeg" : "image/png" } });
    }
    const path = u.pathname.replace(/^\/v1/, "");
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path, body, headers: init.headers });
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    let m;
    if (init.method === "GET" && path === `/data_sources/${BOOK_DS}`) {
      return ok({ properties: { 著者名: { type: "select", select: { options: [{ name: "作家　一" }, { name: "作家　二" }] } }, 出版社: { type: "select", select: { options: [{ name: "見本文庫" }] } } } });
    }
    if ((m = path.match(/^\/data_sources\/([^/]+)\/query$/))) {
      let rows = [...pages.values()].filter((p) => p.parent.data_source_id === m[1]);
      const rel = body?.filter?.relation?.contains;
      if (rel) rows = rows.filter((p) => p.properties["本"].relation.some((r) => r.id === rel));
      return ok({ results: rows, has_more: false });
    }
    if ((m = path.match(/^\/blocks\/([^/]+)\/children$/))) return ok({ results: children[m[1]] || [], has_more: false });
    if ((m = path.match(/^\/pages\/([^/]+)$/))) {
      const p = pages.get(m[1]);
      if (!p) return new Response(JSON.stringify({ code: "object_not_found" }), { status: 404 });
      if (init.method === "PATCH") {
        for (const [k, v] of Object.entries(body.properties || {})) p.properties[k] = { ...p.properties[k], ...v };
        if (body.in_trash) p.in_trash = true;
      }
      return ok(p);
    }
    if (path === "/pages" && init.method === "POST") {
      const id = hex(next++);
      const props = Object.fromEntries(Object.entries(body.properties).map(([k, v]) => [k, { type: Object.keys(v)[0], ...v }]));
      for (const v of Object.values(props)) if (v.title) v.title = v.title.map((t) => ({ plain_text: t.text.content }));
      const p = row(id, body.parent.data_source_id, props);
      pages.set(id, p);
      return ok(p);
    }
    return new Response("{}", { status: 404 });
  };
});

async function api(method, path, body, key = KEY) {
  const res = await worker.fetch(new Request(`https://shiori.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }), env);
  return { status: res.status, data: await res.json() };
}
const writes = () => calls.filter((c) => c.method === "POST" && c.path === "/pages" || c.method === "PATCH");

test("合言葉と設定", async () => {
  assert.equal((await api("GET", "/api/books", null, "wrong-key-0123456789")).status, 401);
  const res = await worker.fetch(new Request("https://shiori.test/api/books"), { ...env, APP_KEY: "short" });
  assert.equal(res.status, 500);
  assert.equal(calls.length, 0);
  assert.equal(await (await worker.fetch(new Request("https://shiori.test/"), env)).text(), "asset");
});

test("本の一覧：読書メモ_DB の行と著者・出版社の選択肢", async () => {
  const { status, data } = await api("GET", "/api/books");
  assert.equal(status, 200);
  assert.deepEqual(data.options, { authors: ["作家　一", "作家　二"], publishers: ["見本文庫"] });
  const by = Object.fromEntries(data.books.map((b) => [b.title, b]));
  assert.deepEqual(by["見本の本"], {
    id: B1, url: `https://www.notion.so/${B1}`, title: "見本の本", author: "作家　一", publisher: "", status: "読中", finished: null, rating: "", review: "",
    meter: false, notebooklm: false, cover: "https://example.test/c.jpg", highlightCount: 1, highlightMore: false, legacyCount: 0, termCount: 0, termMore: false, research: false,
  });
  assert.equal(by["読んだ本"].finished, "2026-09-01");
  assert.equal(by["読んだ本"].meter, true);
  assert.equal(by["読んだ本"].legacyCount, 2);
  assert.equal(calls[0].headers["Notion-Version"], "2025-09-03");
});

test("ハイライト：その本の行をページ順に、前の形の子ページも読む", async () => {
  const a = await api("GET", `/api/books/${B1}/highlights`);
  assert.deepEqual(a.data.highlights.map((h) => [h.text, h.page, h.loc, h.source]), [["前のページ", 3, "40", "📱 Kindle"], ["見本のハイライト。", 12, "", "📷 付箋写真"]]);
  assert.equal(calls.find((c) => c.path.endsWith("/query")).body.filter.relation.contains, B1);
  const b = await api("GET", `/api/books/${B2}/highlights`);
  assert.deepEqual(b.data.legacy.map((l) => [l.text, l.memo, l.hasPhoto]), [["前の形の引用", "大事な一文", true], ["もう一つ", "", false]]);
  const c = await api("GET", `/api/books/${B3}/highlights`);
  assert.deepEqual(c.data.legacy.map((l) => [l.text, l.memo, l.url]), [["子ページだけ", "関連にない子ページ", `https://www.notion.so/${hex(33)}`]]);
  assert.equal((await api("GET", `/api/books/${hex(21)}/highlights`)).status, 403, "本でない行は開かない");
});

test("ハイライトを足す：本に紐づけ、ページの文に色を付けて本文に残す。未読の本は読中にする", async () => {
  const { status, data } = await api("POST", "/api/highlights", { bookId: B3, items: [
    { text: "大事な文。", page: "45", memo: "なるほど", source: "📷 付箋写真", context: "前の文。大事な文。後の文。\n次の段落。" },
    { text: "Kindle の一文", loc: "1,234", source: "📱 Kindle" },
  ] });
  assert.equal(status, 200);
  assert.equal(data.added, 2);
  assert.equal(data.book.status, "読中");
  assert.equal(data.book.highlightCount, 2);
  const [c1, c2, patch] = writes();
  assert.equal(c1.body.parent.data_source_id, HL_DS);
  assert.deepEqual(c1.body.properties["本"], { relation: [{ id: B3 }] });
  assert.deepEqual(c1.body.properties["ページ"], { number: 45 });
  assert.deepEqual(c1.body.properties["出どころ"], { select: { name: "📷 付箋写真" } });
  assert.match(c1.body.properties["記録日"].date.start, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(c1.body.children[0].type, "heading_2");
  assert.deepEqual(c1.body.children[1].paragraph.rich_text, [
    { type: "text", text: { content: "前の文。" } },
    { type: "text", text: { content: "大事な文。" }, annotations: { color: "yellow_background" } },
    { type: "text", text: { content: "後の文。" } },
  ]);
  assert.equal(c1.body.children.length, 3);
  assert.deepEqual(c2.body.properties["位置"], { rich_text: [{ type: "text", text: { content: "1,234" } }] });
  assert.ok(!c2.body.properties["ページ"] && !c2.body.properties["メモ"] && !c2.body.children);
  assert.deepEqual(patch.body, { properties: { ステータス: { status: { name: "読中" } } } });
});

test("ハイライトの値を確かめ、だめなら何も書かない", async () => {
  assert.equal((await api("POST", "/api/highlights", { bookId: B1, items: [] })).status, 400);
  assert.equal((await api("POST", "/api/highlights", { bookId: B1, items: [{ text: "a" }, { text: "  " }] })).status, 400);
  assert.equal((await api("POST", "/api/highlights", { bookId: B1, items: [{ text: "a", page: "12ページ" }] })).status, 400);
  assert.equal((await api("POST", "/api/highlights", { bookId: B1, items: Array.from({ length: 41 }, () => ({ text: "a" })) })).status, 400);
  assert.equal((await api("POST", "/api/highlights", { bookId: hex(9), items: [{ text: "a" }] })).status, 403);
  assert.equal(writes().length, 0);
  const ok = await api("POST", "/api/highlights", { bookId: B1, items: [{ text: "a", source: "どこか" }] });
  assert.equal(writes()[0].body.properties["出どころ"].select.name, "✍️ 手入力");
  assert.equal(ok.data.book.status, "読中");
  assert.equal(writes().length, 1, "読中の本はステータスを書き換えない");
});

test("本を足す・読了にする・印を付ける", async () => {
  const add = await api("POST", "/api/books", { title: " 新しい  本 ", author: "新しい作家" });
  assert.equal(add.status, 200);
  assert.deepEqual(writes()[0].body.properties, {
    書籍名: { title: [{ type: "text", text: { content: "新しい 本" } }] }, ステータス: { status: { name: "読中" } }, 著者名: { select: { name: "新しい作家" } },
  });
  assert.equal((await api("POST", "/api/books", { title: "" })).status, 400);

  const done = await api("PATCH", `/api/books/${B1}`, { status: "読了", finished: "2026-10-26", rating: "★★★★★", review: "おもしろかった" });
  assert.equal(done.status, 200);
  assert.deepEqual(writes()[1].body.properties, {
    ステータス: { status: { name: "読了" } }, 読了日: { date: { start: "2026-10-26" } }, 評価: { select: { name: "★★★★★" } },
    感想: { rich_text: [{ type: "text", text: { content: "おもしろかった" } }] },
  });
  assert.equal(done.data.book.status, "読了");
  await api("PATCH", `/api/books/${B1}`, { meter: true, notebooklm: true, rating: "" });
  assert.deepEqual(writes()[2].body.properties, { 評価: { select: null }, 読書メーター: { checkbox: true }, NotebookLM: { checkbox: true } });

  assert.equal((await api("PATCH", `/api/books/${B1}`, { rating: "★★★★★★" })).status, 400);
  assert.equal((await api("PATCH", `/api/books/${B1}`, { review: "あ".repeat(256) })).status, 400);
  assert.equal((await api("PATCH", `/api/books/${B1}`, { finished: "10/26" })).status, 400);
  assert.equal((await api("PATCH", `/api/books/${B1}`, {})).status, 400);
  assert.equal((await api("PATCH", `/api/books/${hex(21)}`, { status: "読了" })).status, 403, "本でない行は書き換えない");
  assert.equal(writes().length, 3);
});

test("メモは DB_読書ハイライト の行だけ直せる", async () => {
  assert.equal((await api("PATCH", `/api/highlights/${B1}`, { memo: "x" })).status, 403);
  const r = await api("PATCH", `/api/highlights/${hex(21)}`, { memo: " 気づき " });
  assert.equal(r.data.memo, "気づき");
  assert.deepEqual(writes()[0].body.properties, { メモ: { rich_text: [{ type: "text", text: { content: "気づき" } }] } });
});

test("インテグレーション未接続は分かる言葉で返す", async () => {
  const r = await api("PATCH", `/api/highlights/${hex(77)}`, { memo: "x" });
  assert.equal(r.status, 502);
  assert.match(r.data.error, /インテグレーションが接続されていません/);
});

test("読書辞典：本ごとに出てきた順で読む", async () => {
  const { status, data } = await api("GET", `/api/books/${B1}/terms`);
  assert.equal(status, 200);
  assert.deepEqual(data.terms.map((t) => [t.term, t.kind, t.page, t.desc, t.by]), [["鎌倉", "📍 舞台", 5, "", ""], ["ドクダミ", "🌿 植物", 30, "白い花の野草", "🤖 Claude"]]);
  assert.equal(calls.find((c) => c.path === `/data_sources/${TERM_DS}/query`).body.filter.relation.contains, B1);
  assert.deepEqual((await api("GET", `/api/books/${B2}/terms`)).data.terms, []);
  assert.equal((await api("GET", `/api/books/${hex(41)}/terms`)).status, 403);
});

test("読書辞典：足す・直す・消す。種別とページを確かめ、辞典の行だけ書き換える", async () => {
  const add = await api("POST", "/api/terms", { bookId: B3, term: " 叔母  さん ", kind: "👥 人物・距離感", page: "12", memo: "少し距離がある" });
  assert.equal(add.status, 200);
  const [c] = writes();
  assert.equal(c.body.parent.data_source_id, TERM_DS);
  assert.deepEqual(c.body.properties["語"], { title: [{ type: "text", text: { content: "叔母 さん" } }] });
  assert.deepEqual(c.body.properties["本"], { relation: [{ id: B3 }] });
  assert.deepEqual(c.body.properties["種別"], { select: { name: "👥 人物・距離感" } });
  assert.deepEqual(c.body.properties["ページ"], { number: 12 });
  assert.ok(!("説明" in c.body.properties), "送られていない項目は書かない");
  assert.match(c.body.properties["記録日"].date.start, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(c.body.properties["書いた人"], { select: { name: "✍️ 自分" } });
  assert.equal(add.data.term.term, "叔母 さん");

  const noKind = await api("POST", "/api/terms", { bookId: B3, term: "なにか" });
  assert.equal(writes()[1].body.properties["種別"].select.name, "✦ その他");
  assert.equal(noKind.status, 200);

  const fix = await api("PATCH", `/api/terms/${hex(42)}`, { desc: "海に近い古い町", page: "" });
  assert.equal(fix.status, 200);
  assert.deepEqual(writes()[2].body.properties, { ページ: { number: null }, 説明: { rich_text: [{ type: "text", text: { content: "海に近い古い町" } }] } });
  assert.equal(fix.data.term.desc, "海に近い古い町");

  const del = await api("DELETE", `/api/terms/${hex(41)}`);
  assert.deepEqual(del.data, { id: hex(41), removed: true });
  assert.deepEqual(writes()[3].body, { in_trash: true });

  const before = writes().length;
  assert.equal((await api("POST", "/api/terms", { bookId: B3, term: "  " })).status, 400);
  assert.equal((await api("POST", "/api/terms", { bookId: B3, term: "a", page: "三" })).status, 400);
  assert.equal((await api("POST", "/api/terms", { bookId: hex(9), term: "a" })).status, 403);
  assert.equal((await api("PATCH", `/api/terms/${hex(42)}`, { kind: "動物" })).status, 400);
  assert.equal((await api("PATCH", `/api/terms/${hex(42)}`, {})).status, 400);
  assert.equal((await api("PATCH", `/api/terms/${hex(21)}`, { memo: "x" })).status, 403, "ハイライトの行は辞典として書き換えない");
  assert.equal((await api("DELETE", `/api/terms/${B1}`)).status, 403, "本は消さない");
  assert.equal(writes().length, before);
});

test("本を Web で探す：ISBN のある本だけ、重複なし、著者は「姓　名」、文庫は出版社に、表紙は Amazon→Google の順", async () => {
  const { status, data } = await api("GET", "/api/lookup?q=%E7%99%BD%E9%B3%A5%E3%81%A8%E3%82%B3%E3%82%A6%E3%83%A2%E3%83%AA");
  assert.equal(status, 200);
  assert.deepEqual(data.items, [
    { title: "白鳥とコウモリ", volume: "上", author: "東野　圭吾", publisher: "幻冬舎文庫", series: "幻冬舎文庫", year: "2024", isbn: "9784344433700", cover: "https://images-na.ssl-images-amazon.com/images/P/434443370X.09.LZZZZZZZ.jpg" },
    { title: "地下室の手記", volume: "", author: "Dostoyevsky, Fyodor", publisher: "新潮文庫", series: "新潮文庫", year: "1969", isbn: "9784102010112", cover: "https://books.google.com/books/content?vid=ISBN9784102010112&printsec=frontcover&img=1&zoom=1" },
    { title: "ほか & 本", volume: "", author: "作家", publisher: "見本社", series: "", year: "", isbn: "9784000000000", cover: "" },
    { title: "Swan and Bat", volume: "", author: "Higashino, Keigo", publisher: "Overseas", series: "", year: "", isbn: "9786020670690", cover: "" },
  ], "ISBN-10 は 13 桁に、日本の本（文庫を先に）→海外版の順");
  assert.deepEqual(calls.find((c) => c.path === "/api/opensearch").body, { title: "白鳥とコウモリ", cnt: "50" });
  assert.equal((await api("GET", "/api/lookup?q=%E6%9C%AC")).status, 400, "1文字では探さない");
  assert.equal(writes().length, 0);
});

test("本を足すとき表紙も入れられる。背景を調べる印を付け外しできる", async () => {
  const add = await api("POST", "/api/books", { title: "新しい本", cover: "https://images-na.ssl-images-amazon.com/images/P/434443370X.09.LZZZZZZZ.jpg" });
  assert.equal(add.status, 200);
  assert.deepEqual(writes()[0].body.properties["ファイル&メディア"], { files: [{ type: "external", name: "cover.jpg", external: { url: "https://images-na.ssl-images-amazon.com/images/P/434443370X.09.LZZZZZZZ.jpg" } }] });
  assert.equal(add.data.book.cover, "https://images-na.ssl-images-amazon.com/images/P/434443370X.09.LZZZZZZZ.jpg");
  assert.equal((await api("POST", "/api/books", { title: "b", cover: "http://insecure.test/x.jpg" })).status, 400);
  assert.equal((await api("POST", "/api/books", { title: "c", cover: "" })).status, 200);
  assert.ok(!("ファイル&メディア" in writes()[1].body.properties));

  const on = await api("PATCH", `/api/books/${B1}`, { research: true });
  assert.deepEqual(writes()[2].body.properties, { "🔍 背景を調べる": { checkbox: true } });
  assert.equal(on.data.book.research, true);
  const off = await api("PATCH", `/api/books/${B1}`, { research: false });
  assert.equal(off.data.book.research, false);
});

test("Kindle 同期：Amazon からのフォームは合言葉なしで受け取り、画面に渡す HTML を返す", async () => {
  const data = { v: 1, host: "read.amazon.co.jp", books: [{ asin: "B0", title: "本 </script><b>", author: "著者: 人", items: [{ text: "文", note: "", header: "位置: 1", loc: "1" }] }] };
  const form = new URLSearchParams({ data: JSON.stringify(data) });
  const res = await worker.fetch(new Request("https://shiori.test/api/kindle-sync", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() }), env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type"), /text\/html/);
  const html = await res.text();
  assert.ok(html.includes('sessionStorage.setItem("shiori:kindleSync"'));
  assert.ok(html.includes("\\u003c/script>\\u003cb>"), "payload の < は逃がす");
  assert.ok(!html.includes("</script><b>"));
  assert.equal(calls.length, 0, "Notion には触らない");
  const bad = await worker.fetch(new Request("https://shiori.test/api/kindle-sync", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "data=%7Bnope" }), env);
  assert.equal(bad.status, 400);
  const notForm = await worker.fetch(new Request("https://shiori.test/api/kindle-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), env);
  assert.equal(notForm.status, 400);
  const get = await worker.fetch(new Request("https://shiori.test/api/kindle-sync"), env);
  assert.equal(get.status, 303);
  assert.equal(get.headers.get("Location"), "https://shiori.test/sync.html");
});
