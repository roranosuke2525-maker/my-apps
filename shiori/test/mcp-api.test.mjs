// アーティファクト版の /api（src/mcp-api.js）の動作確認。Notion 連携は偽物（test/fake-notion-mcp.mjs）。 npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fakeNotionMcp } from "./fake-notion-mcp.mjs";

const source = await readFile(new URL("../src/mcp-api.js", import.meta.url), "utf8");

function setup() {
  const mcp = fakeNotionMcp();
  const win = { fetch: async () => new Response("asset"), claude: { use: async (name) => (name === "mcp" ? mcp : null) } };
  new Function("window", "location", source)(win, { href: "https://artifact.test/" });
  const api = async (method, path, body) => {
    const res = await win.fetch(path, { method, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
  return { mcp, api, hex: mcp.hex };
}
const writes = (mcp) => mcp.calls.filter((c) => c.tool !== "notion-query-data-sources" && c.tool !== "notion-fetch");

test("本の一覧：読書メモ_DB の行と著者・出版社の選択肢", async () => {
  const { api, hex } = setup();
  const { status, data } = await api("GET", "/api/books");
  assert.equal(status, 200);
  assert.deepEqual(data.options, { authors: ["作家　一", "作家　二"], publishers: ["見本文庫"] });
  const by = Object.fromEntries(data.books.map((b) => [b.title, b]));
  assert.deepEqual(by["見本の本"], {
    id: hex(1), url: `https://app.notion.com/p/${hex(1)}`, title: "見本の本", author: "作家　一", publisher: "見本文庫", status: "読中",
    finished: null, rating: "", review: "", meter: false, notebooklm: false, cover: "https://example.test/cover.jpg", highlightCount: 1, legacyCount: 0,
  });
  assert.equal(by["読んだ本"].meter, true);
  assert.equal(by["読んだ本"].finished, "2026-09-01");
  assert.equal(by["読んだ本"].legacyCount, 2);
  assert.equal(by["まだの本"].status, "未読");
});

test("ハイライト：その本の行をページ順に、前の形の子ページも読む", async () => {
  const { api, hex } = setup();
  await api("GET", "/api/books");
  const a = await api("GET", `/api/books/${hex(1)}/highlights`);
  assert.deepEqual(a.data.highlights.map((h) => [h.text, h.page]), [["前のページ", 3], ["見本のハイライト。", 12]]);
  assert.equal(a.data.highlights[0].loc, "40");
  const b = await api("GET", `/api/books/${hex(2)}/highlights`);
  assert.deepEqual(b.data.highlights, []);
  assert.deepEqual(b.data.legacy.map((l) => [l.text, l.memo, l.hasPhoto]), [["前の形の引用", "大事な一文", true], ["もう一つ", "", false]]);
});

test("読み込んでいない本には触れない", async () => {
  const { api, mcp, hex } = setup();
  assert.equal((await api("GET", `/api/books/${hex(1)}/highlights`)).status, 403);
  assert.equal((await api("PATCH", `/api/books/${hex(9)}`, { status: "読了" })).status, 403);
  assert.equal((await api("POST", "/api/highlights", { bookId: hex(9), items: [{ text: "x" }] })).status, 403);
  assert.equal(writes(mcp).length, 0);
});

test("ハイライトを足す：本に紐づけ、写真のときはページの文に色を付けて本文に残す。未読の本は読中にする", async () => {
  const { api, mcp, hex } = setup();
  await api("GET", "/api/books");
  const { status, data } = await api("POST", "/api/highlights", { bookId: hex(3), items: [
    { text: "大事な<文>。", page: "45", memo: "なるほど", source: "📷 付箋写真", context: "前の文。大事な<文>。後の*文*。\n次の段落。" },
    { text: "Kindle の一文", loc: "1,234", source: "📱 Kindle" },
  ] });
  assert.equal(status, 200);
  assert.equal(data.added, 2);
  assert.equal(data.book.status, "読中");
  const [create, update] = writes(mcp);
  assert.equal(create.input.parent.data_source_id, mcp.DS.hl);
  const [p1, p2] = create.input.pages;
  assert.equal(p1.properties["引用"], "大事な<文>。");
  assert.deepEqual(p1.properties["本"], [`https://app.notion.com/p/${hex(3)}`]);
  assert.equal(p1.properties["ページ"], 45);
  assert.equal(p1.properties["メモ"], "なるほど");
  assert.match(p1.properties["date:記録日:start"], /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(p1.content, '## ページの文\n\n前の文。<span color="yellow_bg">大事な＜文＞。</span>後の\\*文\\*。\n\n次の段落。');
  assert.equal(p2.properties["位置"], "1,234");
  assert.ok(!("ページ" in p2.properties) && !("メモ" in p2.properties) && !p2.content);
  assert.deepEqual(update.input, { page_id: hex(3), command: "update_properties", properties: { ステータス: "読中" }, allow_async: false });
});

test("ハイライトの値を確かめる", async () => {
  const { api, mcp, hex } = setup();
  await api("GET", "/api/books");
  assert.equal((await api("POST", "/api/highlights", { bookId: hex(1), items: [] })).status, 400);
  assert.equal((await api("POST", "/api/highlights", { bookId: hex(1), items: [{ text: "  " }] })).status, 400);
  assert.equal((await api("POST", "/api/highlights", { bookId: hex(1), items: [{ text: "a", page: "12ページ" }] })).status, 400);
  assert.equal((await api("POST", "/api/highlights", { bookId: hex(1), items: [{ text: "x".repeat(1901) }] })).status, 400);
  const ok = await api("POST", "/api/highlights", { bookId: hex(1), items: [{ text: "a", source: "どこか" }] });
  assert.equal(writes(mcp)[0].input.pages[0].properties["出どころ"], "✍️ 手入力");
  assert.equal(ok.data.book.status, "読中");
  assert.equal(writes(mcp).length, 1, "読中の本はステータスを書き換えない");
});

test("本を足す・読了にする・印を付ける", async () => {
  const { api, mcp, hex } = setup();
  await api("GET", "/api/books");
  const add = await api("POST", "/api/books", { title: " 新しい  本 ", author: "新しい作家" });
  assert.equal(add.status, 200);
  assert.equal(add.data.book.title, "新しい 本");
  assert.deepEqual(writes(mcp)[0].input.pages[0].properties, { 書籍名: "新しい 本", ステータス: "読中", 著者名: "新しい作家" });
  assert.equal((await api("POST", "/api/books", { title: "" })).status, 400);

  const done = await api("PATCH", `/api/books/${hex(1)}`, { status: "読了", finished: "2026-10-26", rating: "★★★★★", review: "おもしろかった" });
  assert.equal(done.status, 200);
  assert.deepEqual(writes(mcp)[1].input.properties, { ステータス: "読了", "date:読了日:start": "2026-10-26", "date:読了日:is_datetime": 0, 評価: "★★★★★", 感想: "おもしろかった" });
  assert.equal(done.data.book.rating, "★★★★★");
  const mark = await api("PATCH", `/api/books/${hex(1)}`, { meter: true, notebooklm: true });
  assert.deepEqual(writes(mcp)[2].input.properties, { 読書メーター: "__YES__", NotebookLM: "__YES__" });
  assert.equal(mark.data.book.meter, true);

  assert.equal((await api("PATCH", `/api/books/${hex(1)}`, { rating: "★★★★★★" })).status, 400);
  assert.equal((await api("PATCH", `/api/books/${hex(1)}`, { review: "あ".repeat(256) })).status, 400);
  assert.equal((await api("PATCH", `/api/books/${hex(1)}`, { finished: "10/26" })).status, 400);
  assert.equal((await api("PATCH", `/api/books/${hex(1)}`, { status: "途中" })).status, 400);
  assert.equal((await api("PATCH", `/api/books/${hex(1)}`, {})).status, 400);
});

test("メモは読み込んだハイライトだけ直せる", async () => {
  const { api, mcp, hex } = setup();
  await api("GET", "/api/books");
  assert.equal((await api("PATCH", `/api/highlights/${hex(21)}`, { memo: "x" })).status, 403);
  await api("GET", `/api/books/${hex(1)}/highlights`);
  const r = await api("PATCH", `/api/highlights/${hex(21)}`, { memo: " 気づき " });
  assert.equal(r.data.memo, "気づき");
  assert.deepEqual(writes(mcp)[0].input.properties, { メモ: "気づき" });
});

test("連携が無いときは分かる言葉で返す", async () => {
  const win = { fetch: async () => new Response("asset"), claude: { use: async () => null } };
  new Function("window", "location", source)(win, { href: "https://artifact.test/" });
  const res = await win.fetch("/api/books");
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /claude\.ai で開いて/);
});
