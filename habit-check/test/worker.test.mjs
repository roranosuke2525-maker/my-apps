// Worker の動作確認。Notion API は偽物に差し替える。 npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const DS = "e730b8b2-bb41-491d-9382-a296c40e6deb";
const KEY = "test-key-0123456789";
const env = {
  NOTION_TOKEN: "ntn_fake",
  APP_KEY: KEY,
  DATA_SOURCE_ID: DS,
  PLAYER_PAGE_ID: "player1",
  NOTION_API_BASE: "https://notion.test/v1",
  ASSETS: { fetch: async () => new Response("asset") },
};

const schema = {
  "◆☼ 起床": { name: "◆☼ 起床", type: "checkbox", description: "" },
  "◇☀︎ プロテイン": { name: "◇☀︎ プロテイン", type: "checkbox", description: "" },
  "◇☾プロテインの準備": { name: "◇☾プロテインの準備", type: "checkbox", description: "" },
  "◇☼ 新聞": { name: "◇☼ 新聞", type: "checkbox", description: "最小版：見出しだけ" },
  ひとこと: { name: "ひとこと", type: "rich_text", description: "" },
  日: { name: "日", type: "title" },
  プレイヤー: { name: "プレイヤー", type: "relation" },
  いまのLv: { name: "いまのLv", type: "rollup" },
};

let pages;
let calls;

function page(id, created, extra = {}) {
  return {
    object: "page",
    id,
    url: `https://www.notion.so/${id}`,
    created_time: created,
    parent: { type: "data_source_id", data_source_id: DS },
    properties: {
      "◆☼ 起床": { type: "checkbox", checkbox: false },
      "◇☀︎ プロテイン": { type: "checkbox", checkbox: false },
      "◇☾プロテインの準備": { type: "checkbox", checkbox: false },
      "◇☼ 新聞": { type: "checkbox", checkbox: false },
      ひとこと: { type: "rich_text", rich_text: [] },
      いまのLv: { type: "rollup", rollup: { type: "number", number: 7 } },
      ...extra,
    },
  };
}

beforeEach(() => {
  calls = [];
  pages = [
    page("day20", "2026-10-19T15:00:10.000Z"),
    page("day21", "2026-10-20T15:00:05.000Z"),
    { ...page("other", "2026-10-21T01:00:00.000Z"), parent: { type: "data_source_id", data_source_id: "someone-else" } },
  ];
  globalThis.fetch = async (url, init = {}) => {
    const path = url.replace(env.NOTION_API_BASE, "");
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path, body, headers: init.headers });
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (init.method === "GET" && path === `/data_sources/${DS}`) return ok({ properties: schema });
    if (init.method === "POST" && path === `/data_sources/${DS}/query`) {
      const from = Date.parse(body.filter.created_time.on_or_after);
      const results = pages
        .filter((p) => p.parent.data_source_id === DS && Date.parse(p.created_time) >= from)
        .sort((a, b) => Date.parse(a.created_time) - Date.parse(b.created_time));
      return ok({ results });
    }
    if (init.method === "POST" && path === "/pages") {
      const p = page("new1", "2026-10-22T03:00:00.000Z");
      pages.push(p);
      return ok(p);
    }
    const m = path.match(/^\/pages\/(.+)$/);
    const p = m && pages.find((x) => x.id === m[1]);
    if (!p) return new Response(JSON.stringify({ code: "object_not_found" }), { status: 404 });
    if (init.method === "GET") return ok(p);
    if (init.method === "PATCH") {
      for (const [k, v] of Object.entries(body.properties)) {
        p.properties[k] = v.checkbox !== undefined
          ? { type: "checkbox", checkbox: v.checkbox }
          : { type: "rich_text", rich_text: v.rich_text.map((t) => ({ plain_text: t.text.content })) };
      }
      return ok(p);
    }
    throw new Error(`unexpected ${init.method} ${path}`);
  };
});

function req(method, path, body, key = KEY) {
  return worker.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
  );
}

test("合言葉が違うと 401 で、Notion には問い合わせない", async () => {
  const res = await req("GET", "/api/day?date=2026-10-21", null, "wrong-key-0123456789");
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("/api 以外は画面ファイルを返す", async () => {
  const res = await worker.fetch(new Request("https://app.test/"), env);
  assert.equal(await res.text(), "asset");
});

test("習慣の一覧を列名から読み取り、日本時間のその日の行を返す", async () => {
  const res = await req("GET", "/api/day?date=2026-10-21");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.row.id, "day21");
  assert.equal(data.row.stats["いまのLv"], 7);
  const byName = Object.fromEntries(data.habits.map((h) => [h.name, h]));
  assert.deepEqual(byName["◆☼ 起床"], { name: "◆☼ 起床", label: "起床", must: true, slot: "morning", hint: "" });
  assert.equal(byName["◇☀︎ プロテイン"].slot, "noon");
  assert.equal(byName["◇☀︎ プロテイン"].label, "プロテイン");
  assert.equal(byName["◇☾プロテインの準備"].slot, "night");
  assert.equal(byName["◇☼ 新聞"].hint, "最小版：見出しだけ");
  assert.equal(data.habits.length, 4);
  const q = calls.find((c) => c.path.endsWith("/query"));
  assert.equal(q.body.filter.created_time.on_or_after, "2026-10-21T00:00:00+09:00");
  assert.equal(q.headers["Notion-Version"], "2025-09-03");
});

test("行が無い日は row: null、POST で作るとプレイヤー付きの行ができる", async () => {
  const empty = await (await req("GET", "/api/day?date=2026-10-22")).json();
  assert.equal(empty.row, null);
  const created = await (await req("POST", "/api/day", { date: "2026-10-22" })).json();
  assert.equal(created.row.id, "new1");
  const post = calls.find((c) => c.method === "POST" && c.path === "/pages");
  assert.deepEqual(post.body.parent, { type: "data_source_id", data_source_id: DS });
  assert.deepEqual(post.body.properties["プレイヤー"], { relation: [{ id: "player1" }] });
  assert.equal(post.body.properties["日"].title[0].mention.date.start, "2026-10-22");
});

test("既に行がある日に POST しても二重には作らない", async () => {
  const data = await (await req("POST", "/api/day", { date: "2026-10-21" })).json();
  assert.equal(data.row.id, "day21");
  assert.equal(calls.filter((c) => c.path === "/pages").length, 0);
});

test("チェックとひとことを書き込める", async () => {
  let res = await req("PATCH", `/api/pages/${"a".repeat(32)}`, { name: "◆☼ 起床", value: true });
  assert.equal(res.status, 502); // 存在しないページ
  pages[1].id = "b".repeat(32);
  res = await req("PATCH", `/api/pages/${"b".repeat(32)}`, { name: "◆☼ 起床", value: true });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).row.checks["◆☼ 起床"], true);
  res = await req("PATCH", `/api/pages/${"b".repeat(32)}`, { name: "ひとこと", value: "散歩した" });
  assert.equal((await res.json()).row.note, "散歩した");
});

test("習慣以外の列や他のDBのページは書き換えない", async () => {
  pages[1].id = "c".repeat(32);
  pages[2].id = "d".repeat(32);
  let res = await req("PATCH", `/api/pages/${"c".repeat(32)}`, { name: "プレイヤー", value: true });
  assert.equal(res.status, 400);
  res = await req("PATCH", `/api/pages/${"c".repeat(32)}`, { name: "◆☼ 起床", value: "yes" });
  assert.equal(res.status, 400);
  res = await req("PATCH", `/api/pages/${"d".repeat(32)}`, { name: "◆☼ 起床", value: true });
  assert.equal(res.status, 403);
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
});

test("日付の形式が違うと 400", async () => {
  const res = await req("GET", "/api/day?date=2026-1-1");
  assert.equal(res.status, 400);
});
