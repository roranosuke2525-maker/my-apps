import test from "node:test";
import assert from "node:assert/strict";
import worker, { toFilter, flatPage } from "../src/worker.js";
import { fakeNotion } from "./fake-notion.mjs";

const KEY = "k".repeat(20);
function setup() {
  const fake = fakeNotion();
  const env = { NOTION_TOKEN: "ntn_test", APP_KEY: KEY, NOTION_API_BASE: "https://api.test/v1", ASSETS: { fetch: () => new Response("assets") } };
  const realFetch = globalThis.fetch; globalThis.fetch = fake.fetch;
  const call = async (tool, input, key = KEY) => {
    const res = await worker.fetch(new Request("https://app.test/api/notion", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ tool, input }) }), env);
    return { status: res.status, data: await res.json() };
  };
  return { fake, env, call, done: () => { globalThis.fetch = realFetch; } };
}

test("合言葉がないと 401、画面はそのまま配る", async () => {
  const s = setup();
  try {
    assert.equal((await s.call("notion-fetch", { id: "x" }, "wrong")).status, 401);
    const page = await worker.fetch(new Request("https://app.test/"), s.env);
    assert.equal(await page.text(), "assets");
  } finally { s.done(); }
});

test("行を MCP の rows と同じ平らな形で返す", async () => {
  const s = setup();
  try {
    const { status, data } = await s.call("notion-query-data-sources", { data: { mode: "rows", data_source_url: `collection://21762844-acbe-8075-bbe6-000bcaf22801`, filter: { type: "group", operator: "and", filters: [{ type: "property", property: "ステータス", propertyType: "status", operator: "status_is", value: { type: "is_option", value: "🤖 AI" } }] }, sort: [{ property: "最終更新日時", direction: "descending" }], limit: 100 } });
    assert.equal(status, 200);
    const r = data.results[0];
    assert.equal(r["名前"], "<b>食洗機の比較</b>");
    assert.equal(r["ステータス"], "🤖 AI");
    assert.equal(r["AIアクション"], "🔍✅");
    assert.equal(r["date:実行日:start"], null);
    assert.equal(r["userDefined:URL"], "https://x.example");
    assert.equal(r["今どこ"], "AI");
    assert.deepEqual(JSON.parse(r["プレイヤー"]), ["https://www.notion.so/3e962844acbe81b0843ff78fe19791fa"]);
    const q = s.fake.calls.find((c) => c.path.endsWith("/query"));
    assert.deepEqual(q.body.filter, { and: [{ property: "ステータス", status: { equals: "🤖 AI" } }] });
    assert.deepEqual(q.body.sorts, [{ timestamp: "last_edited_time", direction: "descending" }]);
    assert.equal(q.version, "2025-09-03");
  } finally { s.done(); }
});

test("今日の絞り込みは日本時間の1日で比べる", () => {
  const f = toFilter({ type: "group", operator: "or", filters: [{ type: "property", property: "実行日", propertyType: "date", operator: "date_is", value: { type: "relative", value: "today" } }, { type: "property", property: "最終更新日時", propertyType: "last_edited_time", operator: "date_is", value: { type: "exact", value: "2026-10-27" } }] });
  assert.ok(f.or[0].date.equals.match(/^\d{4}-\d{2}-\d{2}$/));
  assert.deepEqual(f.or[1], { and: [{ timestamp: "last_edited_time", last_edited_time: { on_or_after: "2026-10-27T00:00:00+09:00" } }, { timestamp: "last_edited_time", last_edited_time: { before: "2026-10-28T00:00:00+09:00" } }] });
});

test("本文は Notion-flavored Markdown（v2）で読み、変わった所だけ置き換える", async () => {
  const s = setup();
  try {
    const got = await s.call("notion-fetch", { id: "11111111111111111111111111111111" });
    assert.match(got.data.text, /<content>\n## ☑️ ToDo/);
    const g = s.fake.calls.at(-1); assert.match(g.path, /markdown_version=v2/); assert.equal(g.version, "2026-03-11");
    const up = await s.call("notion-update-page", { page_id: "11111111111111111111111111111111", command: "update_content", content_updates: [{ old_str: "- [ ] 比較表を見て決める", new_str: "- [x] 比較表を見て決める" }] });
    assert.equal(up.status, 200); assert.match(s.fake.md, /- \[x\] 比較表/);
    const p = s.fake.calls.at(-1); assert.equal(p.body.type, "update_content"); assert.equal(p.body.markdown_version, "v2");
    // 食い違い（見つからない）は Notion の文言のまま返す（画面が「最新を読む／上書き」を出す）
    const miss = await s.call("notion-update-page", { page_id: "11111111111111111111111111111111", command: "update_content", content_updates: [{ old_str: "ないもの", new_str: "x" }] });
    assert.equal(miss.status, 400); assert.match(miss.data.error, /No matches found/);
    await s.call("notion-update-page", { page_id: "11111111111111111111111111111111", command: "insert_content", content: "<callout icon=\"✍️\">\nメモ\n</callout>" });
    assert.match(s.fake.md, /<callout icon="✍️">\nメモ/);
  } finally { s.done(); }
});

test("プロパティは列の型に合わせて書く", async () => {
  const s = setup();
  try {
    const r = await s.call("notion-update-page", { page_id: "11111111111111111111111111111111", command: "update_properties", properties: { "ステータス": "⏭ NEXT", "AIアクション": null, "date:実行日:start": "2026-10-28", "date:実行日:is_datetime": 0, NEXT: "寸法を測る" } });
    assert.equal(r.status, 200);
    const patch = s.fake.calls.find((c) => c.method === "PATCH" && /\/pages\/\w+$/.test(c.path));
    assert.deepEqual(patch.body.properties, { "ステータス": { status: { name: "⏭ NEXT" } }, "AIアクション": { select: null }, "実行日": { date: { start: "2026-10-28" } }, NEXT: { rich_text: [{ type: "text", text: { content: "寸法を測る" } }] } });
    const bad = await s.call("notion-update-page", { page_id: "11111111111111111111111111111111", command: "update_properties", properties: { "ない列": "x" } });
    assert.equal(bad.status, 400);
  } finally { s.done(); }
});

test("行の追加は Markdown の本文つきで作る", async () => {
  const s = setup();
  try {
    const r = await s.call("notion-create-pages", { parent: { type: "data_source_id", data_source_id: "21762844-acbe-8075-bbe6-000bcaf22801" }, pages: [{ properties: { "名前": "新しい", "ステータス": "🤖 AI", "AIアクション": "🔍", "userDefined:URL": "https://y.example", "プレイヤー": ["https://www.notion.so/3e962844acbe81b0843ff78fe19791fa"] }, content: "## メモ\n\nあ" }] });
    assert.equal(r.status, 200); assert.equal(r.data.pages.length, 1);
    const post = s.fake.calls.find((c) => c.method === "POST" && c.path === "/pages");
    assert.equal(post.body.markdown, "## メモ\n\nあ"); assert.equal(post.body.markdown_version, "v2"); assert.equal(post.version, "2026-03-11");
    assert.deepEqual(post.body.properties.URL, { url: "https://y.example" });
    assert.deepEqual(post.body.properties["プレイヤー"], { relation: [{ id: "3e962844acbe81b0843ff78fe19791fa" }] });
  } finally { s.done(); }
});

test("flatPage：飾り・リンク・メンション", () => {
  const p = flatPage({ id: "a".repeat(32), url: "u", properties: { n: { type: "rich_text", rich_text: [{ type: "text", plain_text: "x", href: "https://l", annotations: { italic: true } }, { type: "mention", plain_text: "P", mention: { type: "page", page: { id: "b".repeat(32) } }, annotations: {} }] } } });
  assert.equal(p.n, `<i>[x](https://l)</i><mention url="https://www.notion.so/${"b".repeat(32)}">P</mention>`);
});
