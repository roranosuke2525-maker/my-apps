// アーティファクト版の /api（src/mcp-api.js）の動作確認。Notion 連携は偽物（test/fake-notion-mcp.mjs）。 npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fakeNotionMcp } from "./fake-notion-mcp.mjs";

const source = await readFile(new URL("../src/mcp-api.js", import.meta.url), "utf8");
const hex = (n) => n.toString(16).padStart(32, "0");

function setup() {
  const mcp = fakeNotionMcp();
  const win = { fetch: async () => new Response("asset"), claude: { use: async (name) => (name === "mcp" ? mcp : null) } };
  new Function("window", "location", source)(win, { href: "https://artifact.test/" });
  const api = async (method, path, body) => {
    const res = await win.fetch(path, { method, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
  return { mcp, api };
}

test("3つのDBから育児の項目だけをまとめて返す", async () => {
  const { api, mcp } = setup();
  const { status, data } = await api("GET", "/api/hub");
  assert.equal(status, 200);
  assert.deepEqual(data.child, { name: "奏輔", birth: "2026-01-19", backToWork: "2027-01-19" });
  const titles = data.items.map((i) => i.title);
  assert.ok(!titles.includes("仕事の資料"), "CHILD 以外のタスクは出さない");
  assert.ok(!titles.includes("済んだ育児タスク"), "DONE のタスクは出さない");
  const by = Object.fromEntries(data.items.map((i) => [i.title, i]));
  assert.deepEqual(by["離乳食の本を読む"], {
    id: hex(1), url: `https://app.notion.com/p/${hex(1)}`, src: "task", title: "離乳食の本を読む", status: "⏭ NEXT",
    note: "2章から", date: "2026-11-02", tag: "", meta: ["☼ 朝", "M"], star: false, done: false,
  });
  assert.equal(by["抱っこひもの比較"].src, "ref");
  assert.equal(by["ミルクの量"].star, true);
  assert.equal(by["ミルクの量"].tag, "授乳/ミルク");
  assert.equal(by["肌着のサイズ"].done, true);
  assert.equal(by["子ども医療費の受給者証"].note, "通院・入院の自己負担 & 薬代");
  assert.equal(by["子ども医療費の受給者証"].date, "2026-11-30");
  assert.ok(mcp.calls.every((c) => c.server === "Notion" && c.input.data.mode === "rows")); // SQL は回数制限があるので使わない
});

test("タスクの追加は DB_タスク管理 に INBOX・CHILD で入れる", async () => {
  const { api, mcp } = setup();
  const { status, data } = await api("POST", "/api/tasks", { title: "  保育園の  持ち物 " });
  assert.equal(status, 200);
  assert.equal(data.item.title, "保育園の 持ち物");
  const c = mcp.calls.at(-1);
  assert.equal(c.name, "notion-create-pages");
  assert.equal(c.input.parent.data_source_id, "21762844-acbe-8075-bbe6-000bcaf22801");
  assert.deepEqual(c.input.pages[0].properties, { 名前: "保育園の 持ち物", ステータス: "📥 INBOX", 分類タグ: "CHILD" });
  assert.deepEqual(c.opts, { cache: false });
  assert.equal((await api("POST", "/api/tasks", { title: " " })).status, 400);
  assert.equal((await api("POST", "/api/tasks", { title: "あ".repeat(101) })).status, 400);
});

test("ステータスを変えられるのは読み込んだ育児のタスクだけ", async () => {
  const { api, mcp } = setup();
  await api("GET", "/api/hub");
  const ok = await api("PATCH", `/api/tasks/${hex(1)}`, { status: "✅ DONE" });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.item.done, true);
  assert.equal(mcp.tables["21762844-acbe-8075-bbe6-000bcaf22801"][0].ステータス, "✅ DONE");
  assert.equal((await api("PATCH", `/api/tasks/${hex(4)}`, { status: "✅ DONE" })).status, 403, "WORK のタスク");
  assert.equal((await api("PATCH", `/api/tasks/${hex(11)}`, { status: "✅ DONE" })).status, 403, "育児メモ");
  assert.equal((await api("PATCH", `/api/tasks/${hex(3)}`, { status: "✅ DONE" })).status, 403, "しらべた（REFERENCE）");
  assert.equal((await api("PATCH", `/api/tasks/${hex(2)}`, { status: "🤖 AI" })).status, 400);
  assert.equal((await api("PATCH", `/api/tasks/${hex(2)}`, { status: "📚 REFERENCE" })).status, 400);
});

test("Notion 連携がないときは分かる言葉で返す", async () => {
  const win = { fetch: async () => new Response(""), claude: { use: async () => null } };
  new Function("window", "location", source)(win, { href: "https://artifact.test/" });
  const res = await win.fetch("/api/hub");
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /claude\.ai で開いてください/);
});

test("予定は祝日以外のカレンダーから、育児の言葉を含むものだけを返す", async () => {
  const { api, mcp } = setup();
  const { status, data } = await api("GET", "/api/calendar");
  assert.equal(status, 200);
  assert.deepEqual(data.events.map((e) => [e.date, e.time, e.title]), [
    ["2026-11-19", "09:00", "9か月検診"],
    ["2026-12-01", "", "保育園 面談"],
  ]);
  assert.ok(!JSON.stringify(data).includes("美容室"), "育児と関係ない予定は渡さない");
  const ids = mcp.calls.filter((c) => c.name === "list_events").map((c) => c.input.calendarId);
  assert.deepEqual(ids.sort(), ["family@example.test", "me@example.test"]);
  assert.ok(mcp.calls.filter((c) => c.name.startsWith("list_")).every((c) => c.server === "Google Calendar"));
  assert.match(mcp.calls.find((c) => c.name === "list_events").input.startTime, /^\d{4}-\d{2}-\d{2}T00:00:00$/);
});

test("カレンダー連携がなくても、育児の項目はそのまま読める", async () => {
  const { api, mcp } = setup();
  mcp.noCalendar = true;
  assert.equal((await api("GET", "/api/calendar")).status, 502);
  assert.equal((await api("GET", "/api/hub")).status, 200);
});

test("ねんね記録は月齢の新しい順に、選択肢は DB の設定から返す", async () => {
  const { api } = setup();
  const { status, data } = await api("GET", "/api/sleep");
  assert.equal(status, 200);
  assert.deepEqual(data.options, { place: ["ベビーベッド", "布団（親と一緒）"], methods: ["抱っこ", "トントン", "ひとりで"], who: ["自分", "妻"] });
  assert.deepEqual(data.records.map((r) => r.month), [9, 8, null]);
  const r8 = data.records[1];
  assert.deepEqual([r8.place, r8.methods, r8.bed, r8.night, r8.naps, r8.date], ["ベビーベッド", ["抱っこ", "トントン"], "20:00", 3, null, "2026-09-20"]);
});

test("同じ月齢の行があれば書き換え、なければ1行足す", async () => {
  const { api, mcp } = setup();
  await api("GET", "/api/sleep");
  const body = { month: 9, place: "布団（親と一緒）", methods: ["抱っこ", "ひとりで"], who: "自分", bed: "20:30", wake: "6:30", night: "2", naps: 2, good: "トントンで寝た", trouble: "" };
  const up = await api("PUT", "/api/sleep", body);
  assert.equal(up.status, 200);
  const u = mcp.calls.find((c) => c.name === "notion-update-page");
  assert.equal(u.input.page_id, hex(32));
  assert.equal(u.input.properties.名前, "生後9か月");
  assert.deepEqual(u.input.properties.寝かしつけ, ["抱っこ", "ひとりで"]);
  assert.equal(u.input.properties.夜中に起きる回数, 2);
  assert.equal(up.data.records.find((r) => r.month === 9).place, "布団（親と一緒）");

  const add = await api("PUT", "/api/sleep", { month: 13, methods: [] });
  assert.equal(add.status, 200);
  const c = mcp.calls.find((x) => x.name === "notion-create-pages");
  assert.equal(c.input.parent.data_source_id, "5d665394-581e-4294-9bc1-adb8bad27784");
  assert.equal(c.input.pages[0].properties.名前, "1歳1か月");
  assert.equal(c.input.pages[0].properties.寝る場所, null);
});

test("ねんね記録はおかしな値を書かない", async () => {
  const { api, mcp } = setup();
  await api("GET", "/api/sleep");
  const bad = [
    { month: 9, place: "ハンモック" },
    { month: 9, methods: ["魔法"] },
    { month: 9, bed: "25:00" },
    { month: 9, night: -1 },
    { month: 9, good: "あ".repeat(501) },
    { month: 1.5 },
    { month: 99 },
  ];
  for (const b of bad) assert.equal((await api("PUT", "/api/sleep", b)).status, 400, JSON.stringify(b));
  assert.ok(!mcp.calls.some((c) => c.name === "notion-update-page" || c.name === "notion-create-pages"));
});
