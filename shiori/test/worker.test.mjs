// Worker の動作確認。Notion API は偽物に差し替える（値はすべて作りもの）。 npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const BOOK_DS = "23362844-acbe-80b5-a2b4-000b59e31cdf";
const HL_DS = "1f6f7d77-b234-4b5b-8e15-4afcf2097567";
const KEY = "test-key-0123456789";
const env = {
  NOTION_TOKEN: "ntn_fake",
  APP_KEY: KEY,
  BOOK_DS_ID: BOOK_DS,
  HIGHLIGHT_DS_ID: HL_DS,
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
    [hex(9), row(hex(9), "other-ds", { 名前: { type: "title", title: rt("ほかのDB") } })],
  ]);
  const children = {
    [hex(31)]: [{ type: "image", image: {} }, { type: "paragraph", paragraph: { rich_text: rt("大事な一文") } }],
    [hex(32)]: [],
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
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
        for (const [k, v] of Object.entries(body.properties)) p.properties[k] = { ...p.properties[k], ...v };
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
    meter: false, notebooklm: false, cover: "https://example.test/c.jpg", highlightCount: 1, highlightMore: false, legacyCount: 0,
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
