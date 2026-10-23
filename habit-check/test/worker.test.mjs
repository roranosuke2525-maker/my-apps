// Worker の動作確認。Notion API は偽物に差し替える。 npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const DS = "e730b8b2-bb41-491d-9382-a296c40e6deb";
const PARTY = "party-ds";
const GUILD = "guild-ds";
const REPORT = "report-ds";
const STORY = "story-ds";
const KEY = "test-key-0123456789";
const env = {
  NOTION_TOKEN: "ntn_fake",
  APP_KEY: KEY,
  DATA_SOURCE_ID: DS,
  PLAYER_PAGE_ID: "player1",
  PARTY_DS_ID: PARTY,
  GUILD_DS_ID: GUILD,
  REPORT_DS_ID: REPORT,
  STORY_DS_ID: STORY,
  NOTION_API_BASE: "https://notion.test/v1",
  ASSETS: { fetch: async () => new Response("asset") },
};

const text = (s) => [{ plain_text: s }];
const formula = (v) => ({ type: "formula", formula: typeof v === "number" ? { type: "number", number: v } : typeof v === "boolean" ? { type: "boolean", boolean: v } : { type: "string", string: v } });
const rollupNum = (n) => ({ type: "rollup", rollup: { type: "number", number: n } });
const QID = "1".repeat(32);
const SID_OPEN = "2".repeat(32);
const SID_LOCKED = "3".repeat(32);

function other(id, ds, properties, created = "2026-10-20T00:00:00.000Z") {
  return { object: "page", id, url: `https://www.notion.so/${id}`, created_time: created, parent: { type: "data_source_id", data_source_id: ds }, properties };
}

function extraPages() {
  return [
    other("player1", "player-ds", {
      名前: { type: "title", title: text("Satoshi") },
      レベル: formula(8),
      次のレベルまで: formula(35),
      総EXP: formula(1265),
      ステータス: formula("ちから 12"),
    }),
    other("m1", PARTY, { なまえ: { type: "title", title: text("さとし（かけだし）") }, しゅるい: { type: "select", select: { name: "しゅじんこう" } }, ひつようLv: { type: "number", number: 4 }, つぎLv: { type: "number", number: 7 }, ひょうじ: formula(true) }),
    other("m2", PARTY, { なまえ: { type: "title", title: text("ゼニ") }, しゅるい: { type: "select", select: { name: "なかま" } }, ひつようLv: { type: "number", number: 15 }, つぎLv: { type: "number", number: 999 }, ひょうじ: formula(false) }),
    other(QID, GUILD, {
      依頼: { type: "title", title: text("固定費のみなおし") },
      カテゴリ: { type: "select", select: { name: "お金" } },
      ランク: { type: "select", select: { name: "C" } },
      受注Lv: { type: "number", number: 3 },
      基本EXP: { type: "number", number: 60 },
      段階: { type: "rich_text", rich_text: text("サブスクを1つ確認する｜通信費を見直す｜保険を見直す") },
      けいじばん: formula("★☆☆"),
      達成回数: formula(1),
    }),
    other("r1", REPORT, { ひとこと: { type: "title", title: text("全館空調掃除") }, 依頼: { type: "relation", relation: [{ id: QID }] } }, "2026-10-02T04:03:51.835Z"),
    other(SID_OPEN, STORY, { しょう: { type: "title", title: text("第1章") }, しゅるい: { type: "select", select: { name: "ほんぺん" } }, じゅんばん: { type: "number", number: 1 }, かいほうLv: { type: "number", number: 1 }, よんだ: { type: "checkbox", checkbox: false }, いまのLv: rollupNum(8), じょうたい: formula("よめる") }),
    other(SID_LOCKED, STORY, { しょう: { type: "title", title: text("最終章") }, しゅるい: { type: "select", select: { name: "ほんぺん" } }, じゅんばん: { type: "number", number: 9 }, かいほうLv: { type: "number", number: 20 }, よんだ: { type: "checkbox", checkbox: false }, いまのLv: rollupNum(8), じょうたい: formula("🔒") }),
  ];
}

const blocks = {
  m1: [{ type: "image", image: { type: "file", file: { url: "https://files.test/kakedashi.svg" } } }],
  [SID_OPEN]: [{ id: "tg", type: "toggle", has_children: true, toggle: { rich_text: text("▶ 読む") } }],
  tg: [
    { type: "paragraph", has_children: false, paragraph: { rich_text: text("商業都市コインズは、夜なのに眠っていなかった。") } },
    { type: "quote", has_children: false, quote: { rich_text: text("【SYSTEM】仲間に加わりました") } },
  ],
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
    ...extraPages(),
  ];
  globalThis.fetch = async (url, init = {}) => {
    const path = url.replace(env.NOTION_API_BASE, "");
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path, body, headers: init.headers });
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    if (init.method === "GET" && path === `/data_sources/${DS}`) return ok({ properties: schema });
    if (init.method === "POST" && path === `/data_sources/${DS}/query`) {
      const conds = body.filter.and ? body.filter.and.map((f) => f.created_time) : [body.filter.created_time];
      const from = Date.parse(conds.find((c) => c.on_or_after).on_or_after);
      const before = conds.find((c) => c.before);
      const results = pages
        .filter((p) => p.parent.data_source_id === DS && Date.parse(p.created_time) >= from)
        .filter((p) => !before || Date.parse(p.created_time) < Date.parse(before.before))
        .sort((a, b) => Date.parse(a.created_time) - Date.parse(b.created_time));
      return ok({ results });
    }
    const q = path.match(/^\/data_sources\/(.+)\/query$/);
    if (init.method === "POST" && q) return ok({ results: pages.filter((p) => p.parent.data_source_id === q[1]) });
    const bl = path.match(/^\/blocks\/([^/]+)\/children/);
    if (init.method === "GET" && bl) return ok({ results: blocks[bl[1]] || [], has_more: false });
    if (init.method === "POST" && path === "/pages") {
      const ds = body.parent.data_source_id;
      const p = ds === DS ? page("new1", "2026-10-22T03:00:00.000Z") : other("new-report", ds, {
        ひとこと: { type: "title", title: text(body.properties.ひとこと.title[0].text.content) },
        依頼: { type: "relation", relation: body.properties.依頼.relation },
      });
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

test("期間まとめ読み：日本時間の日付ごとにチェックを返す", async () => {
  const res = await req("GET", "/api/range?from=2026-10-20&to=2026-10-21");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(Object.keys(data.days), ["2026-10-20", "2026-10-21"]);
  assert.equal(data.days["2026-10-21"].id, "day21");
  assert.equal(data.habits.length, 4);
  const q = calls.find((c) => c.path === `/data_sources/${DS}/query`);
  assert.equal(q.body.filter.and[1].created_time.before, "2026-10-22T00:00:00+09:00");
});

test("期間が長すぎる・逆向きなら 400", async () => {
  assert.equal((await req("GET", "/api/range?from=2026-01-01&to=2026-10-21")).status, 400);
  assert.equal((await req("GET", "/api/range?from=2026-10-21&to=2026-10-20")).status, 400);
});

test("きろく：プレイヤーのLv・EXP・ステータスを返す", async () => {
  const { player } = await (await req("GET", "/api/player")).json();
  assert.equal(player.name, "Satoshi");
  assert.equal(player.level, 8);
  assert.equal(player.toNext, 35);
  assert.equal(player.status, "ちから 12");
  assert.equal(player.guildExp, null);
});

test("パーティー：ひょうじ が付いたすがただけ、絵のURLつきで返す", async () => {
  const { members } = await (await req("GET", "/api/party")).json();
  assert.equal(members.length, 1);
  assert.equal(members[0].name, "さとし（かけだし）");
  assert.equal(members[0].kind, "しゅじんこう");
  assert.equal(members[0].image, "https://files.test/kakedashi.svg");
});

test("ギルド：依頼の段階を分けて返し、ほうこくも新しい順に返す", async () => {
  const data = await (await req("GET", "/api/guild")).json();
  assert.equal(data.quests.length, 1);
  assert.deepEqual(data.quests[0].stages, ["サブスクを1つ確認する", "通信費を見直す", "保険を見直す"]);
  assert.equal(data.quests[0].count, 1);
  assert.equal(data.quests[0].board, "★☆☆");
  assert.equal(data.reports[0].note, "全館空調掃除");
  assert.deepEqual(data.reports[0].questIds, [QID]);
});

test("ギルド：ほうこくは依頼に紐づけて DB_ギルド達成記録 に1行足す", async () => {
  const res = await req("POST", "/api/guild/reports", { questId: QID, note: " サブスクを解約した " });
  assert.equal(res.status, 200);
  const post = calls.find((c) => c.method === "POST" && c.path === "/pages");
  assert.deepEqual(post.body.parent, { type: "data_source_id", data_source_id: REPORT });
  assert.equal(post.body.properties.ひとこと.title[0].text.content, "サブスクを解約した");
  assert.deepEqual(post.body.properties.依頼, { relation: [{ id: QID }] });
});

test("ギルド：依頼以外のページや空のひとことは受け付けない", async () => {
  assert.equal((await req("POST", "/api/guild/reports", { questId: SID_OPEN, note: "x" })).status, 403);
  assert.equal((await req("POST", "/api/guild/reports", { questId: QID, note: "  " })).status, 400);
  assert.equal((await req("POST", "/api/guild/reports", { questId: "../pages", note: "x" })).status, 400);
  assert.equal(calls.filter((c) => c.path === "/pages").length, 0);
});

test("ものがたり：じゅんばん順の一覧と、Lvが足りない章のロック", async () => {
  const { chapters } = await (await req("GET", "/api/story")).json();
  assert.deepEqual(chapters.map((c) => [c.title, c.locked]), [["第1章", false], ["最終章", true]]);
  assert.equal((await req("GET", `/api/story/${SID_LOCKED}`)).status, 403);
  assert.equal((await req("PATCH", `/api/story/${SID_LOCKED}`, { read: true })).status, 403);
});

test("ものがたり：トグルの中の本文を読み、よんだ を付けられる", async () => {
  const data = await (await req("GET", `/api/story/${SID_OPEN}`)).json();
  assert.deepEqual(data.blocks, [
    { type: "p", text: "商業都市コインズは、夜なのに眠っていなかった。" },
    { type: "quote", text: "【SYSTEM】仲間に加わりました" },
  ]);
  const res = await req("PATCH", `/api/story/${SID_OPEN}`, { read: true });
  assert.equal((await res.json()).chapter.read, true);
  const patch = calls.find((c) => c.method === "PATCH");
  assert.deepEqual(patch.body, { properties: { よんだ: { checkbox: true } } });
});

test("ものがたり：他のDBのページには触らない", async () => {
  assert.equal((await req("GET", `/api/story/${QID}`)).status, 403);
  assert.equal((await req("PATCH", `/api/story/${SID_OPEN}`, { read: "yes" })).status, 400);
});

test("HIDDEN_HABITS に書いた習慣は出さず、書き換えもしない", async () => {
  const hiddenEnv = { ...env, HIDDEN_HABITS: "◇☼ 新聞, ◇☾プロテインの準備" };
  pages[1].id = "c".repeat(32);
  const call = (method, path, body) =>
    worker.fetch(new Request(`https://app.test${path}`, { method, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), hiddenEnv);
  const data = await (await call("GET", "/api/day?date=2026-10-21")).json();
  const names = data.habits.map((x) => x.name);
  assert.ok(!names.includes("◇☼ 新聞") && !names.includes("◇☾プロテインの準備"));
  assert.ok(names.includes("◆☼ 起床"));
  assert.equal("◇☼ 新聞" in data.row.checks, false);
  const res = await call("PATCH", `/api/pages/${data.row.id}`, { name: "◇☼ 新聞", value: true });
  assert.equal(res.status, 400);
});
