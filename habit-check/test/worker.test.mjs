// Worker の動作確認。Notion API は偽物に差し替える。 npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const DS = "e730b8b2-bb41-491d-9382-a296c40e6deb";
const PARTY = "party-ds";
const GUILD = "guild-ds";
const REPORT = "report-ds";
const STORY = "story-ds";
const AIBOU = "aibou-ds";
const TASKS = "task-ds";
const ITEMS = "item-ds";
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
  AIBOU_DS_ID: AIBOU,
  TASK_DS_ID: TASKS,
  ITEM_DS_ID: ITEMS,
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
    other("m1", PARTY, { なまえ: { type: "title", title: text("さとし（かけだし）") }, しゅるい: { type: "select", select: { name: "しゅじんこう" } }, ひつようLv: { type: "number", number: 4 }, つぎLv: { type: "number", number: 10 }, ひょうじ: formula(true) }),
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

let propertyItems = {};

let testEnv;

beforeEach(() => {
  testEnv = { ...env }; // Worker の1分キャッシュ（env ごと）をテストごとに分ける
  calls = [];
  propertyItems = {};
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
    // プレイヤーで絞る検索（きろくのEXPの合計）
    const mineOf = (f) => JSON.stringify(f || {}).match(/"プレイヤー","relation":\{"contains":"([^"]+)"/)?.[1];
    const qm = path.match(/^\/data_sources\/(.+)\/query$/);
    if (init.method === "POST" && qm && mineOf(body.filter)) {
      const who = mineOf(body.filter);
      return ok({ results: pages.filter((p) => p.parent.data_source_id === qm[1] && (p.properties.プレイヤー?.relation || []).some((r) => r.id === who)) });
    }
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
      const p = ds === DS ? page("new1", "2026-10-22T03:00:00.000Z") : ds === AIBOU || ds === ITEMS ? other(String(pages.length).padStart(32, "a"), ds, fakeProps(body.properties)) : other("new-report", ds, {
        ひとこと: { type: "title", title: text(body.properties.ひとこと.title[0].text.content) },
        依頼: { type: "relation", relation: body.properties.依頼.relation },
      });
      pages.push(p);
      return ok(p);
    }
    const pi = path.match(/^\/pages\/([^/]+)\/properties\/([^?]+)(?:\?(.*))?$/);
    if (init.method === "GET" && pi) {
      const items = propertyItems[decodeURIComponent(pi[2])];
      if (!items) return new Response(JSON.stringify({ code: "object_not_found" }), { status: 404 });
      const cursor = new URLSearchParams(pi[3] || "").get("start_cursor");
      const i = cursor ? Number(cursor) : 0;
      const more = i + 1 < items.length;
      return ok({ object: "list", results: [], has_more: more, next_cursor: more ? String(i + 1) : null, property_item: { type: "rollup", rollup: { type: "number", number: items[i] } } });
    }
    const m = path.match(/^\/pages\/(.+)$/);
    const p = m && pages.find((x) => x.id === m[1]);
    if (!p) return new Response(JSON.stringify({ code: "object_not_found" }), { status: 404 });
    if (init.method === "GET") return ok(p);
    if (init.method === "PATCH") {
      if (p.parent.data_source_id === AIBOU || p.parent.data_source_id === ITEMS) {
        Object.assign(p.properties, fakeProps(body.properties));
        return ok(p);
      }
      for (const [k, v] of Object.entries(body.properties)) {
        p.properties[k] = v.checkbox !== undefined
          ? { type: "checkbox", checkbox: v.checkbox }
          : v.rich_text ? { type: "rich_text", rich_text: v.rich_text.map((t) => ({ plain_text: t.text.content })) } : fakeProps({ [k]: v })[k];
      }
      return ok(p);
    }
    throw new Error(`unexpected ${init.method} ${path}`);
  };
});

// 書き込みの形（title / rich_text / select / date）を、読み出しの形にする
function fakeProps(props) {
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (v.title) out[k] = { type: "title", title: v.title.map((t) => ({ plain_text: t.text.content })) };
    else if (v.rich_text) out[k] = { type: "rich_text", rich_text: v.rich_text.map((t) => ({ plain_text: t.text.content })) };
    else if (v.select) out[k] = { type: "select", select: { name: v.select.name } };
    else if (v.date) out[k] = { type: "date", date: v.date };
    else if (v.relation) out[k] = { type: "relation", relation: v.relation };
    else if ("number" in v) out[k] = { type: "number", number: v.number };
    else if ("checkbox" in v) out[k] = { type: "checkbox", checkbox: v.checkbox };
  }
  return out;
}

function req(method, path, body, key = KEY) {
  return worker.fetch(
    new Request(`https://app.test${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    testEnv,
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
  assert.deepEqual(byName["◆☼ 起床"], { name: "◆☼ 起床", label: "起床", must: true, bonus: false, slot: "morning", days: null, hint: "", aibou: { type: "しっかり", exp: 5 } });
  assert.deepEqual(byName["◇☼ 新聞"].aibou, { type: "かしこさ", exp: 10 });
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

test("きろく：EXPは全件の合計を取り直し、Lv・次のLvまで・ステータスを Notion と同じ式で計算し直す", async () => {
  const player = pages.find((p) => p.id === "player1");
  const roll = (id, n) => ({ id, type: "rollup", rollup: { type: "number", number: n, function: "sum" } });
  Object.assign(player.properties, { 習慣EXP: roll("h%3C", 100), タスクEXP: roll("t", 10), ギルドEXP: roll("g", 50) });
  // タスクは2ページに分かれ、最後のページが全件の合計（ページの値 10 は先頭25件だけの合計）
  propertyItems = { "h<": [900], t: [10, 2260], g: [650] };
  const lvEnv = { ...env, PLAYER_PAGE_ID: "player1" };
  // プレイヤーの付いた行が検索で見つからないときは、rollup を全件めくる
  const res = await worker.fetch(new Request("https://app.test/api/player", { headers: { Authorization: `Bearer ${KEY}` } }), lvEnv);
  const { player: p } = await res.json();
  assert.deepEqual([p.habitExp, p.taskExp, p.guildExp, p.totalExp], [900, 2260, 650, 3810]);
  assert.equal(p.level, 13); // floor(√(3810/25)) + 1
  assert.equal(p.toNext, 25 * 13 ** 2 - 3810);
  assert.match(p.status, /^▶ Satoshi　Lv 13\nしょくぎょう：ベテラン\n/);

  // ものがたり：Notion の いまのLv(8) ではなく 13 でロックを判定する
  const stories = await (await worker.fetch(new Request("https://app.test/api/story", { headers: { Authorization: `Bearer ${KEY}` } }), lvEnv)).json();
  assert.deepEqual(stories.chapters.map((c) => [c.playerLv, c.locked]), [[13, false], [13, true]]);
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

test("ギルド：questIds で複数の依頼に紐づけられる（重複はまとめ、依頼以外が混ざれば拒否）", async () => {
  const res = await req("POST", "/api/guild/reports", { questIds: [QID, QID], note: "まとめて片づけた" });
  assert.equal(res.status, 200);
  const post = calls.find((c) => c.method === "POST" && c.path === "/pages");
  assert.deepEqual(post.body.properties.依頼, { relation: [{ id: QID }] });
  calls.length = 0;
  assert.equal((await req("POST", "/api/guild/reports", { questIds: [QID, SID_OPEN], note: "x" })).status, 403);
  assert.equal((await req("POST", "/api/guild/reports", { questIds: [], note: "x" })).status, 400);
  assert.equal((await req("POST", "/api/guild/reports", { questIds: Array(6).fill(QID), note: "x" })).status, 400);
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

test("★はボーナス、◐は夕方、（火金）は曜日指定として読む", async () => {
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../src/worker.js", import.meta.url), "utf8"));
  const body = src.slice(src.indexOf("const SLOTS"), src.indexOf("export default"));
  const parseHabit = new Function(`${body}; return parseHabit;`)();
  const a = parseHabit({ name: "★◐ ごはん作り" });
  assert.equal(a.bonus, true); assert.equal(a.slot, "evening"); assert.equal(a.days, null);
  const b = parseHabit({ name: "◇☼ 燃やせるごみ（火金）" });
  assert.deepEqual(b.days, [2, 5]); assert.equal(b.label, "燃やせるごみ（火金）");
  assert.equal(parseHabit({ name: "◇☾ ヤクルト（22時）" }).days, null);
  assert.equal(parseHabit({ name: "◇◷ プロテイン（15時）" }).slot, "noon");
});

// ---------- あいぼう ----------
function pet(props = {}) {
  return other("pet1", AIBOU, {
    名前: { type: "title", title: [] },
    誕生日: { type: "date", date: { start: "2026-10-19" } },
    段階: { type: "select", select: { name: "たまご" } },
    成長期の型: { type: "select", select: null },
    成体の型: { type: "select", select: null },
    進化履歴: { type: "rich_text", rich_text: [] },
    ...props,
  }, "2026-10-19T00:00:00.000Z");
}

function task(id, tag, exp, done) {
  return other(id, TASKS, {
    分類タグ: { type: "select", select: tag ? { name: tag } : null },
    討伐EXP: formula(exp),
    完了日: { type: "formula", formula: { type: "date", date: { start: done } } },
  });
}

const patches = (id) => calls.filter((c) => c.method === "PATCH" && c.path === `/pages/${id}`);

test("あいぼう：まだいなければ pet: null。たまごを受け取ると1体だけ作る", async () => {
  assert.deepEqual(await (await req("GET", "/api/aibou")).json(), { pet: null });
  const data = await (await req("POST", "/api/aibou")).json();
  assert.equal(data.pet.stage, "たまご");
  assert.match(data.pet.birthday, /^\d{4}-\d{2}-\d{2}$/);
  await req("POST", "/api/aibou");
  assert.equal(pages.filter((p) => p.parent.data_source_id === AIBOU).length, 1);
});

test("あいぼう：しきい値を越えた日に進化し、型と日付を Notion に保存する", async () => {
  pages.push(pet());
  // 10/20（日本時間）の行：新聞だけ・EXP 400 → 孵化。10/21 に HEALTH のタスク 4000 → 成長期（幼体の間は ちから が最多）
  const d20 = pages.find((p) => p.id === "day20");
  d20.properties["◇☼ 新聞"].checkbox = true;
  d20.properties.EXP = formula(400);
  pages.push(task("t1", "HEALTH", 4000, "2026-10-21"), task("t-old", "BOOK", 9999, "2026-10-01"));
  const data = await (await req("GET", "/api/aibou")).json();
  assert.equal(data.exp, 4400);
  assert.equal(data.pet.stage, "成長期");
  assert.equal(data.pet.type, "ちから");
  assert.deepEqual(data.points, { ちから: 4000, かしこさ: 400, やさしさ: 0, しっかり: 0 });
  assert.deepEqual(data.next, { stage: "成体", at: 18000 });
  assert.deepEqual(data.evolved.map((e) => e.stage), ["幼体", "成長期"]);
  const [patch] = patches("pet1");
  assert.equal(patch.body.properties.段階.select.name, "成長期");
  assert.equal(patch.body.properties.成長期の型.select.name, "ちから");
  assert.equal(patch.body.properties.進化履歴.rich_text[0].text.content, "2026-10-20 孵化／2026-10-21 成長期（ちから）");
  // 2回目は書かない
  await req("GET", "/api/aibou");
  assert.equal(patches("pet1").length, 1);
});

test("あいぼう：タグのないタスク・どの型でもない習慣は4つに均等割り", async () => {
  pages.push(pet(), task("t1", null, 40, "2026-10-21"));
  pages.find((p) => p.id === "day21").properties.ひとこと = { type: "rich_text", rich_text: text("散歩") };
  const data = await (await req("GET", "/api/aibou")).json();
  assert.equal(data.exp, 45);
  assert.deepEqual(data.points, { ちから: 11, かしこさ: 11, やさしさ: 11, しっかり: 11 });
});

test("あいぼう：保存済みの段階は、EXP が減っても下がらない", async () => {
  pages.push(pet({ 段階: { type: "select", select: { name: "成長期" } }, 成長期の型: { type: "select", select: { name: "やさしさ" } }, 進化履歴: { type: "rich_text", rich_text: text("2026-10-19 孵化／2026-10-20 成長期（やさしさ）") } }));
  const data = await (await req("GET", "/api/aibou")).json();
  assert.equal(data.pet.stage, "成長期");
  assert.equal(data.pet.type, "やさしさ");
  assert.equal(patches("pet1").length, 0);
});

test("あいぼう：成長期の間の4つの型の差が10%以内なら、成体はバランス型", async () => {
  pages.push(pet({ 段階: { type: "select", select: { name: "成長期" } }, 成長期の型: { type: "select", select: { name: "ちから" } }, 進化履歴: { type: "rich_text", rich_text: text("2026-10-19 孵化／2026-10-19 成長期（ちから）") } }));
  ["HEALTH", "BOOK", "HOME", "MONEY"].forEach((tag, i) => pages.push(task(`a${i}`, tag, 4600, "2026-10-21")));
  const data = await (await req("GET", "/api/aibou")).json();
  assert.equal(data.pet.stage, "成体");
  assert.equal(data.pet.type, "バランス");
  assert.equal(patches("pet1")[0].body.properties.成体の型.select.name, "バランス");
  assert.equal(data.next, null);
});

test("あいぼう：名前は1〜20字だけ。DB_あいぼう の行にだけ書く", async () => {
  assert.equal((await req("PATCH", "/api/aibou", { name: "x" })).status, 404);
  pages.push(pet());
  assert.equal((await req("PATCH", "/api/aibou", { name: " " })).status, 400);
  assert.equal((await req("PATCH", "/api/aibou", { name: "あ".repeat(21) })).status, 400);
  const res = await req("PATCH", "/api/aibou", { name: " ぷっちー " });
  assert.equal((await res.json()).pet.name, "ぷっちー");
  assert.deepEqual(patches("pet1").map((c) => Object.keys(c.body.properties)), [["名前"]]);
});

// ---------- ぼうけん・エピソード2 ----------
function ep2(id, order, extra = {}) {
  return other(id, STORY, {
    しょう: { type: "title", title: text(`第${order}話`) },
    しゅるい: { type: "select", select: { name: "エピソード2" } },
    じゅんばん: { type: "number", number: 200 + order },
    かいほうLv: { type: "number", number: 1 },
    よんだ: { type: "checkbox", checkbox: false },
    いまのLv: rollupNum(8),
    ボス: { type: "rich_text", rich_text: text(`ボス${order}`) },
    ボスHP: { type: "number", number: 100 },
    弱点: { type: "select", select: { name: "かしこさ" } },
    ボス開始日: { type: "date", date: null },
    撃破日: { type: "date", date: null },
    ...extra,
  });
}
const E1 = "e".repeat(31) + "1";
const E2 = "e".repeat(31) + "2";

test("エピソード2：前の話のボスを倒すまで次の話は読めない。読んだ日にボス戦が始まる", async () => {
  pages.push(ep2(E1, 1), ep2(E2, 2));
  const { chapters } = await (await req("GET", "/api/story")).json();
  const byId = Object.fromEntries(chapters.map((c) => [c.id, c]));
  assert.equal(byId[E1].locked, false);
  assert.equal(byId[E2].locked, true);
  assert.equal(byId[E2].state, "🔒 前の話のボスを倒すと開く");
  assert.equal((await req("GET", `/api/story/${E2}`)).status, 403);
  const res = await (await req("PATCH", `/api/story/${E1}`, { read: true })).json();
  assert.equal(res.chapter.read, true);
  assert.match(res.chapter.bossStart, /^\d{4}-\d{2}-\d{2}$/);
});

test("ぼうけん：弱点・凶暴化のボーナスでHPを削り、削りきった日を撃破日に書く", async () => {
  pages.push(ep2(E1, 1, { よんだ: { type: "checkbox", checkbox: true }, ボス開始日: { type: "date", date: { start: "2026-10-20" } } }), ep2(E2, 2));
  // 10/20：新聞（かしこさ・弱点）10EXP → 15。10/21：BOOK のタスク 40EXP、9/1 作成で ★3 → 40×1.5×1.6 = 96
  const d20 = pages.find((p) => p.id === "day20");
  d20.properties["◇☼ 新聞"].checkbox = true;
  const t = task("t1", "BOOK", 40, "2026-10-21");
  t.created_time = "2026-09-01T00:00:00.000Z";
  t.properties.名前 = { type: "title", title: text("本を読む") };
  t.properties.重さ = { type: "select", select: { name: "L" } };
  pages.push(t);
  const data = await (await req("GET", "/api/battle")).json();
  assert.equal(data.boss.name, "ボス1");
  assert.equal(data.boss.damage, 100);
  assert.equal(data.boss.defeatedOn, "2026-10-21");
  assert.deepEqual(data.boss.log.map((x) => [x.kind, x.damage]), [["task", 96], ["habit", 15]]);
  assert.equal(data.boss.log[0].name, "モジゴーレム");
  assert.equal(data.boss.log[0].stars, 3);
  const patch = calls.find((c) => c.method === "PATCH" && c.path === `/pages/${E1}`);
  assert.deepEqual(patch.body.properties.撃破日, { date: { start: "2026-10-21" } });
  assert.equal(data.stats.かしこさ, 1); // (10+40)/50
  // 倒したので次の話が開く
  const { chapters } = await (await req("GET", "/api/story")).json();
  assert.equal(chapters.find((c) => c.id === E2).locked, false);
});

test("ぼうけん：あいぼうの型が弱点と同じなら、こうかばつぐん（1.2倍）", async () => {
  pages.push(pet({ 段階: { type: "select", select: { name: "成長期" } }, 成長期の型: { type: "select", select: { name: "かしこさ" } }, 進化履歴: { type: "rich_text", rich_text: text("2026-10-19 孵化／2026-10-19 成長期（かしこさ）") } }));
  pages.push(ep2(E1, 1, { よんだ: { type: "checkbox", checkbox: true }, ボス開始日: { type: "date", date: { start: "2026-10-20" } } }));
  pages.find((p) => p.id === "day20").properties["◇☼ 新聞"].checkbox = true;
  const data = await (await req("GET", "/api/battle")).json();
  assert.equal(data.boss.petHit, true);
  assert.equal(data.boss.damage, 18); // 10 × 1.5 × 1.2
  assert.equal(data.boss.defeatedOn, null);
});

// ---------- そうび ----------
test("そうび：ほうこく1件につき依頼ごとに1つ落ちる。段階でレアが上がり、二重には落ちない", async () => {
  // r1（固定費のみなおし・Cランク・お金）の1回目 → よろい・しっかり・★2（会心なら★3）
  const res = await (await req("GET", "/api/items")).json();
  assert.equal(res.drops.length, 1);
  const it = res.drops[0];
  assert.equal(it.slot, "よろい");
  assert.equal(it.type, "しっかり");
  assert.ok(it.name === "鎖断ちの革よろい");
  assert.ok(it.rarity === 2 || it.rarity === 3);
  assert.equal(it.effect, it.rarity === 2 ? 5 : 8);
  // もう一度読んでも増えない
  const again = await (await req("GET", "/api/items")).json();
  assert.equal(again.drops.length, 0);
  assert.equal(again.items.length, 1);
  // 2回目のほうこく → 段階が1つ進んだ名前
  const rep = await (await req("POST", "/api/guild/reports", { note: "通信費を見た", questId: QID })).json();
  assert.equal(rep.drops.length, 1);
  assert.equal(rep.drops[0].name, "解約のくさりかたびら");
});

test("そうび：装備は部位ごとに1つ。装備中の効果がボスへのダメージに乗る", async () => {
  await req("GET", "/api/items");
  const item = pages.find((p) => p.parent.data_source_id === ITEMS);
  const res = await (await req("PATCH", `/api/items/${item.id}`, { equipped: true })).json();
  assert.equal(res.items[0].equipped, true);
  assert.equal((await req("PATCH", `/api/items/${QID}`, { equipped: true })).status, 403);
  // 弱点しっかりのボス：起床（しっかり・◆5）× 1.5 × (1 + 効果%)
  pages.push(ep2(E1, 1, { よんだ: { type: "checkbox", checkbox: true }, 弱点: { type: "select", select: { name: "しっかり" } }, ボス開始日: { type: "date", date: { start: "2026-10-20" } } }));
  pages.find((p) => p.id === "day20").properties["◆☼ 起床"].checkbox = true;
  const eff = item.properties.効果.number;
  const data = await (await req("GET", "/api/battle")).json();
  assert.equal(data.equip.しっかり, eff);
  assert.equal(data.boss.damage, Math.round(5 * 1.5 * (1 + eff / 100)));
});

test("きろく：EXPはプレイヤーの付いた行を検索してまとめて足す（rollup をめくるより速い）", async () => {
  const mine = { type: "relation", relation: [{ id: "player1" }] };
  pages.find((p) => p.id === "day20").properties.プレイヤー = mine;
  pages.find((p) => p.id === "day20").properties.EXP = formula(300);
  pages.find((p) => p.id === "day21").properties.プレイヤー = mine;
  pages.find((p) => p.id === "day21").properties.EXP = formula(200);
  const t = task("t1", "BOOK", 40, "2026-10-21");
  t.properties.プレイヤー = mine;
  pages.push(t);
  pages.find((p) => p.id === QID).properties.プレイヤー = mine;
  pages.find((p) => p.id === QID).properties.累計EXP = formula(60);
  const res = await worker.fetch(new Request("https://app.test/api/player", { headers: { Authorization: `Bearer ${KEY}` } }), { ...env, PLAYER_PAGE_ID: "player1" });
  const { player: p } = await res.json();
  assert.deepEqual([p.habitExp, p.taskExp, p.guildExp, p.totalExp], [500, 40, 60, 600]);
  assert.equal(calls.filter((c) => c.path.includes("/properties/")).length, 0);
});

test("ぼうけん：前のボスを倒した日のEXPは、次のボスに使い回さない（翌日から戦う）", async () => {
  pages.push(
    ep2(E1, 1, { よんだ: { type: "checkbox", checkbox: true }, ボス開始日: { type: "date", date: { start: "2026-10-20" } }, 撃破日: { type: "date", date: { start: "2026-10-20" } } }),
    ep2(E2, 2, { よんだ: { type: "checkbox", checkbox: true }, ボス開始日: { type: "date", date: { start: "2026-10-20" } } }),
  );
  const d20 = pages.find((p) => p.id === "day20");
  d20.properties["◇☼ 新聞"].checkbox = true;
  d20.properties.EXP = formula(500); // 10/20 の 500 は第1話のボスで使った
  const data = await (await req("GET", "/api/battle")).json();
  assert.equal(data.boss.name, "ボス2");
  assert.equal(data.boss.start, "2026-10-21");
  assert.equal(data.boss.damage, 0);
  assert.equal(data.boss.defeatedOn, null);
});
