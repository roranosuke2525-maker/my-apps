// アーティファクト版の /api（src/mcp-api.js）の動作確認。Notion 連携は偽物（test/fake-notion-mcp.mjs）。 npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fakeNotionMcp } from "./fake-notion-mcp.mjs";

const source = await readFile(new URL("../src/mcp-api.js", import.meta.url), "utf8");
const TODAY = "2026-10-23";
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

function setup(opts = {}) {
  const mcp = fakeNotionMcp({ today: TODAY, ...opts });
  const win = { fetch: async () => new Response("asset"), claude: { use: async (name) => (name === "mcp" ? mcp : null) } };
  new Function("window", "location", source)(win, { href: "https://artifact.test/" });
  const api = async (method, path, body) => {
    const res = await win.fetch(path, { method, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
  return { win, mcp, api };
}

test("習慣の一覧を列名から作り、日本時間のその日の行を返す", async () => {
  const { api, mcp } = setup();
  const yesterday = addDays(TODAY, -1);
  const { status, data } = await api("GET", `/api/day?date=${yesterday}`);
  assert.equal(status, 200);
  assert.equal(data.habits.length, 6);
  const byName = Object.fromEntries(data.habits.map((h) => [h.name, h]));
  assert.deepEqual(byName["◆☼ 起床"], { name: "◆☼ 起床", label: "起床", must: true, bonus: false, slot: "morning", days: null, hint: "" });
  assert.equal(byName["◇☀︎ プロテイン"].slot, "noon");
  assert.equal(byName["◇☾プロテインの準備"].label, "プロテインの準備");
  assert.equal(byName["◇↻ 読書"].hint, "最小版：1ページ");
  assert.equal(data.row.note, "散歩した & 早寝");
  assert.deepEqual(data.row.stats, {});
  assert.equal(typeof data.row.checks["◆☼ 起床"], "boolean");
  assert.ok(mcp.calls.every((c) => c.server === "Notion"));
  const q = mcp.calls.find((c) => c.name === "notion-query-data-sources");
  assert.equal(q.input.data.mode, "rows"); // SQL は回数制限があるので使わない
});

test("行が無い日は null、作ると1行でき、二回目は作らない", async () => {
  const { api, mcp } = setup();
  assert.equal((await api("GET", `/api/day?date=${TODAY}`)).data.row, null);
  const created = await api("POST", "/api/day", { date: TODAY });
  assert.ok(created.data.row.id);
  await api("POST", "/api/day", { date: TODAY });
  const creates = mcp.calls.filter((c) => c.name === "notion-create-pages");
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0].input.parent, { type: "data_source_id", data_source_id: "e730b8b2-bb41-491d-9382-a296c40e6deb" });
  assert.equal(creates[0].input.pages[0].properties["日"], TODAY);
});

test("チェックとひとことを書き込み、Notion にも入る", async () => {
  const { api, mcp } = setup();
  const day = addDays(TODAY, -2);
  const { data } = await api("GET", `/api/day?date=${day}`);
  const before = data.row.checks["◇↻ 読書"];
  const r1 = await api("PATCH", `/api/pages/${data.row.id}`, { name: "◇↻ 読書", value: !before });
  assert.equal(r1.data.row.checks["◇↻ 読書"], !before);
  await api("PATCH", `/api/pages/${data.row.id}`, { name: "ひとこと", value: "がんばった" });
  const upd = mcp.calls.filter((c) => c.name === "notion-update-page");
  assert.deepEqual(upd[0].input.properties, { "◇↻ 読書": before ? "__NO__" : "__YES__" });
  assert.equal(upd[0].input.command, "update_properties");
  const again = await api("GET", `/api/day?date=${day}`);
  assert.equal(again.data.row.checks["◇↻ 読書"], !before);
  assert.equal(again.data.row.note, "がんばった");
});

test("読み込んでいない行・習慣以外の列は書き換えない", async () => {
  const { api, mcp } = setup();
  const { data } = await api("GET", `/api/day?date=${addDays(TODAY, -1)}`);
  assert.equal((await api("PATCH", `/api/pages/${"f".repeat(32)}`, { name: "◆☼ 起床", value: true })).status, 403);
  assert.equal((await api("PATCH", `/api/pages/${data.row.id}`, { name: "プレイヤー", value: true })).status, 400);
  assert.equal((await api("PATCH", `/api/pages/${data.row.id}`, { name: "◆☼ 起床", value: "yes" })).status, 400);
  assert.equal(mcp.calls.filter((c) => c.name === "notion-update-page").length, 0);
});

test("週・月のまとめ読みは日ごとに1行", async () => {
  const { api } = setup();
  const { data } = await api("GET", `/api/range?from=${addDays(TODAY, -6)}&to=${TODAY}`);
  assert.deepEqual(Object.keys(data.days).sort(), [-6, -5, -4, -3, -2, -1].map((n) => addDays(TODAY, n)));
});

test("きろく・パーティー・ギルド・ものがたり：計算式の値は null、ふつうの列は読める", async () => {
  const { api } = setup();
  const player = (await api("GET", "/api/player")).data.player;
  assert.equal(player.name, "テストさん");
  assert.equal(player.level, null);

  const party = (await api("GET", "/api/party")).data.members;
  assert.equal(party.length, 2);
  const hero = party.find((m) => m.kind === "しゅじんこう");
  assert.equal(hero.image, "https://files.example/a.svg?sig=1");
  assert.equal(hero.needLv, 1);
  assert.equal(party.find((m) => m.kind === "なかま").image, null);

  const guild = (await api("GET", "/api/guild")).data;
  const q = guild.quests.find((x) => x.title === "朝の霧を晴らせ");
  assert.deepEqual(q.stages, ["3日つづける", "1週間つづける"]);
  assert.equal(q.count, 2); // 達成記録の数
  assert.equal(q.totalExp, null);
  assert.equal(guild.reports[0].note, "6時半に起きた"); // 新しい順
  assert.deepEqual(guild.reports[0].questIds, [q.id]);

  const chapters = (await api("GET", "/api/story")).data.chapters;
  assert.equal(chapters[1].locked, false); // Lv が分からないのでロックしない
  const story = (await api("GET", `/api/story/${chapters[0].id}`)).data;
  assert.deepEqual(story.blocks, [
    { type: "p", text: "「おはよう」と言った。" },
    { type: "quote", text: "【SYSTEM】クエスト開始" },
    { type: "heading", text: "朝" },
    { type: "p", text: "窓をあけた" },
  ]);
});

test("ギルドのほうこくと、ものがたりの「よんだ」を書き込める", async () => {
  const { api, mcp } = setup();
  const guild = (await api("GET", "/api/guild")).data;
  const q = guild.quests[1];
  const res = await api("POST", "/api/guild/reports", { questId: q.id, note: "  引き出しを片づけた " });
  assert.equal(res.data.report.note, "引き出しを片づけた");
  const create = mcp.calls.find((c) => c.name === "notion-create-pages");
  assert.equal(create.input.parent.data_source_id, "0ea02603-b2dd-4064-bc84-bf02f0e60aca");
  assert.deepEqual(create.input.pages[0].properties["依頼"], [`https://www.notion.so/${q.id}`]);
  assert.equal((await api("POST", "/api/guild/reports", { questId: "e".repeat(32), note: "x" })).status, 403);
  const multi = await api("POST", "/api/guild/reports", { questIds: [guild.quests[0].id, q.id], note: "ふたつ" });
  assert.deepEqual(multi.data.report.questIds, [guild.quests[0].id, q.id]);
  assert.equal((await api("POST", "/api/guild/reports", { questIds: [q.id, "e".repeat(32)], note: "x" })).status, 403);

  const chapters = (await api("GET", "/api/story")).data.chapters;
  const marked = await api("PATCH", `/api/story/${chapters[1].id}`, { read: true });
  assert.equal(marked.data.chapter.read, true);
  const again = (await api("GET", "/api/story")).data.chapters;
  assert.equal(again[1].read, true);
});

test("ツール名に notion- が付かない連携でも動く", async () => {
  const { api, mcp } = setup({ bareToolNames: true });
  const { status } = await api("GET", `/api/day?date=${addDays(TODAY, -1)}`);
  assert.equal(status, 200);
  assert.ok(mcp.calls.some((c) => c.name === "fetch"));
});

test("連携が使えないときは理由を返す（合言葉の画面には戻さない）", async () => {
  const win = { fetch: async () => new Response("asset"), claude: { use: async () => null } };
  new Function("window", "location", source)(win, { href: "https://artifact.test/" });
  const res = await win.fetch(`/api/day?date=${TODAY}`);
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /claude\.ai で開いて/);

  const denied = { callTool: async () => Promise.reject({ code: "needs_reauth", message: "x" }) };
  const win2 = { fetch: async () => new Response("asset"), claude: { use: async () => denied } };
  new Function("window", "location", source)(win2, { href: "https://artifact.test/" });
  const res2 = await win2.fetch("/api/player");
  assert.notEqual(res2.status, 401);
  assert.match((await res2.json()).error, /再接続/);
});

test("ビューで非表示の列は出さず、ビューの並びで返す", async () => {
  const { api, mcp } = setup();
  const { data } = await api("GET", `/api/day?date=${addDays(TODAY, -1)}`);
  assert.deepEqual(data.habits.map((h) => h.name), ["◆☼ 起床", "◇↻ 読書", "◆☼ 洗濯", "◇☼ ストレッチ", "◇☀︎ プロテイン", "◇☾プロテインの準備"]);
  assert.equal("◇☾ 仕事の所感を書く" in data.row.checks, false);
  const res = await api("PATCH", `/api/pages/${data.row.id}`, { name: "◇☾ 仕事の所感を書く", value: true });
  assert.equal(res.status, 400);
  assert.equal(mcp.calls.filter((c) => c.name === "notion-update-page").length, 0);
});

test("ビューが読めないときは、チェックの列を全部出す", async () => {
  const { api } = setup({ withView: false });
  const { data } = await api("GET", `/api/day?date=${addDays(TODAY, -1)}`);
  assert.equal(data.habits.length, 7);
  assert.ok(data.habits.some((h) => h.name === "◇☾ 仕事の所感を書く"));
});
