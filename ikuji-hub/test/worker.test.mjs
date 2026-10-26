// Cloudflare版（src/worker.js）の動作確認。Notion API とカレンダーは偽物に差し替える。 npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { parseIcs } from "../src/worker.js";

const KEY = "test-key-0123456789";
const DS = { task: "task-ds", memo: "memo-ds", aid: "aid-ds", sleep: "sleep-ds" };
const env = {
  NOTION_TOKEN: "ntn_fake",
  APP_KEY: KEY,
  TASK_DS_ID: DS.task,
  MEMO_DS_ID: DS.memo,
  AID_DS_ID: DS.aid,
  SLEEP_DS_ID: DS.sleep,
  CHILD_NAME: "奏輔",
  CHILD_BIRTH: "2026-01-19",
  BACK_TO_WORK: "2027-01-19",
  CALENDAR_ICS_URLS: "https://cal.test/me.ics, https://cal.test/family.ics",
  NOTION_API_BASE: "https://notion.test/v1",
  ASSETS: { fetch: async () => new Response("asset") },
};

const hex = (n) => n.toString(16).padStart(32, "0");
const rt = (s) => [{ plain_text: s }];
const page = (n, ds, properties) => ({ object: "page", id: hex(n), url: `https://www.notion.so/${hex(n)}`, parent: { type: "data_source_id", data_source_id: ds }, properties });
const title = (s) => ({ type: "title", title: rt(s) });
const sel = (s) => ({ type: "select", select: s ? { name: s } : null });
const status = (s) => ({ type: "status", status: { name: s } });
const text = (s) => ({ type: "rich_text", rich_text: s ? rt(s) : [] });
const num = (n) => ({ type: "number", number: n });
const date = (d) => ({ type: "date", date: d ? { start: d } : null });

// 予定の日付は今日（日本時間）からの相対で作る
const jstDay = (n) => new Date(Date.now() + 9 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const ymd8 = (n) => jstDay(n).replace(/-/g, "");
let pages, blocks, calls, ics;
beforeEach(() => {
  calls = [];
  pages = [
    page(1, DS.task, { 名前: title("離乳食の本を読む"), ステータス: status("⏭ NEXT"), 分類タグ: sel("CHILD"), NEXT: text("2章から"), 枠: sel("☼ 朝"), 重さ: sel("M"), 実行日: date("2026-11-02") }),
    page(2, DS.task, { 名前: title("抱っこひもの比較"), ステータス: status("📚 REFERENCE"), 分類タグ: sel("CHILD") }),
    page(3, DS.task, { 名前: title("仕事の資料"), ステータス: status("⏭ NEXT"), 分類タグ: sel("WORK") }),
    page(4, DS.task, { 名前: title("済んだ育児タスク"), ステータス: status("✅ DONE"), 分類タグ: sel("CHILD") }),
    page(11, DS.memo, { 名前: title("ミルクの量"), "": status("継続"), 分類タグ: sel("授乳/ミルク"), Star: sel("☆") }),
    page(21, DS.aid, { 名前: title("子ども医療費"), 申請状況: status("取得済み"), ステータス: status("完了"), 申請先: sel("高崎市"), 助成内容: text("通院・入院"), 期限: date(null) }),
    page(31, DS.sleep, { 名前: title("生後8か月"), 月齢: num(8), 記録日: date("2026-09-20"), 寝る場所: sel("ベビーベッド"), 寝かしつけ: { type: "multi_select", multi_select: [{ name: "抱っこ" }] }, 寝る時刻: text("20:00"), 夜中に起きる回数: num(3) }),
    page(32, DS.sleep, { 名前: title("生後9か月"), 月齢: num(9), 記録日: date("2026-10-26") }),
  ];
  blocks = {
    [hex(31)]: [{ id: "b1", type: "paragraph", has_children: false, paragraph: { rich_text: rt("絵本1冊") } }, { id: "b2", type: "bulleted_list_item", has_children: false, bulleted_list_item: { rich_text: rt("電気は真っ暗") } }],
    [hex(32)]: [{ id: "b3", type: "table", has_children: true, table: {} }],
  };
  ics = {
    "https://cal.test/me.ics": [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:9か月検診", `DTSTART;TZID=Asia/Tokyo:${ymd8(10)}T090000`, "END:VEVENT",
      "BEGIN:VEVENT", "SUMMARY:美容室", `DTSTART:${ymd8(5)}T033000Z`, "END:VEVENT",
      "BEGIN:VEVENT", "SUMMARY:昔の検診", "DTSTART;VALUE=DATE:20200101", "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n"),
    "https://cal.test/family.ics": [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:面談", "DESCRIPTION:保育園\\, 持ち物", `DTSTART:${ymd8(30)}T010000Z`, "END:VEVENT",
      "BEGIN:VEVENT", "SUMMARY:保育園 見学", "STATUS:CANCELLED", `DTSTART;VALUE=DATE:${ymd8(31)}`, "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n"),
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method || "GET", path: u.pathname + u.search, body });
    if (u.host === "cal.test") return new Response(ics[url] || "", { status: ics[url] ? 200 : 404 });
    const p = u.pathname.replace("/v1", "");
    let m;
    if ((m = p.match(/^\/data_sources\/([^/]+)\/query$/))) {
      let rows = pages.filter((x) => x.parent.data_source_id === m[1]);
      const f = body.filter;
      const match = (row, f) => {
        if (!f) return true;
        if (f.and) return f.and.every((g) => match(row, g));
        const v = row.properties[f.property];
        if (f.select) return v?.select?.name === f.select.equals;
        if (f.status) return v?.status?.name !== f.status.does_not_equal;
        if (f.number) return v?.number === f.number.equals;
        return true;
      };
      rows = rows.filter((r) => match(r, f));
      return Response.json({ results: rows, has_more: false });
    }
    if ((m = p.match(/^\/data_sources\/([^/]+)$/))) {
      return Response.json({ properties: {
        寝る場所: { type: "select", select: { options: [{ name: "ベビーベッド" }, { name: "布団（親と一緒）" }] } },
        寝かしつけ: { type: "multi_select", multi_select: { options: [{ name: "抱っこ" }, { name: "ひとりで" }] } },
        寝かしつけ担当: { type: "select", select: { options: [{ name: "自分" }, { name: "妻" }] } },
      } });
    }
    if ((m = p.match(/^\/pages\/([^/]+)$/))) {
      const pg = pages.find((x) => x.id === m[1]);
      if (!pg) return Response.json({ code: "object_not_found" }, { status: 404 });
      if (init.method === "PATCH") {
        for (const [k, v] of Object.entries(body.properties)) pg.properties[k] = { type: Object.keys(v)[0], ...v };
      }
      return Response.json(pg);
    }
    if (p === "/pages" && init.method === "POST") {
      const pg = page(100 + calls.length, body.parent.data_source_id, Object.fromEntries(Object.entries(body.properties).map(([k, v]) => [k, { type: Object.keys(v)[0], ...v }])));
      pages.push(pg);
      if (body.children) blocks[pg.id] = body.children;
      return Response.json(pg);
    }
    if ((m = p.match(/^\/blocks\/([^/]+)\/children$/))) {
      if (init.method === "PATCH") { blocks[m[1]] = [...(blocks[m[1]] || []), ...body.children]; return Response.json({}); }
      return Response.json({ results: blocks[m[1]] || [], has_more: false });
    }
    if ((m = p.match(/^\/blocks\/([^/]+)$/)) && init.method === "DELETE") {
      for (const k of Object.keys(blocks)) blocks[k] = blocks[k].filter((b) => b.id !== m[1]);
      return Response.json({});
    }
    return Response.json({ code: "not_found" }, { status: 404 });
  };
});

async function api(method, path, body, key = KEY) {
  const req = new Request(`https://hub.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await worker.fetch(req, env);
  return { status: res.status, data: await res.json() };
}

test("合言葉が違えば 401、画面のファイルは合言葉なしで配る", async () => {
  assert.equal((await api("GET", "/api/hub", null, "wrong-key-0123456789")).status, 401);
  const res = await worker.fetch(new Request("https://hub.test/index.html"), env);
  assert.equal(await res.text(), "asset");
});

test("3つのDBから育児の項目だけを、アーティファクト版と同じ形で返す", async () => {
  const { status, data } = await api("GET", "/api/hub");
  assert.equal(status, 200);
  assert.deepEqual(data.child, { name: "奏輔", birth: "2026-01-19", backToWork: "2027-01-19" });
  const by = Object.fromEntries(data.items.map((i) => [i.title, i]));
  assert.ok(!by["仕事の資料"] && !by["済んだ育児タスク"]);
  assert.deepEqual(by["離乳食の本を読む"], {
    id: hex(1), url: `https://www.notion.so/${hex(1)}`, src: "task", title: "離乳食の本を読む", status: "⏭ NEXT",
    note: "2章から", date: "2026-11-02", tag: "", meta: ["☼ 朝", "M"], star: false, done: false,
  });
  assert.equal(by["抱っこひもの比較"].src, "ref");
  assert.deepEqual([by["ミルクの量"].star, by["ミルクの量"].tag, by["ミルクの量"].done], [true, "授乳/ミルク", false]);
  assert.deepEqual([by["子ども医療費"].done, by["子ども医療費"].note, by["子ども医療費"].meta], [true, "通院・入院", ["高崎市"]]);
});

test("タスクの追加とステータス変更は DB_タスク管理 の CHILD だけ", async () => {
  const add = await api("POST", "/api/tasks", { title: "  保育園の  持ち物 " });
  assert.equal(add.status, 200);
  const post = calls.find((c) => c.method === "POST" && c.path === "/v1/pages");
  assert.deepEqual(post.body.properties, { 名前: { title: [{ text: { content: "保育園の 持ち物" } }] }, ステータス: { status: { name: "📥 INBOX" } }, 分類タグ: { select: { name: "CHILD" } } });
  assert.equal(post.body.parent.data_source_id, DS.task);

  const ok = await api("PATCH", `/api/tasks/${hex(1)}`, { status: "✅ DONE" });
  assert.deepEqual([ok.status, ok.data.item.done], [200, true]);
  assert.equal((await api("PATCH", `/api/tasks/${hex(3)}`, { status: "✅ DONE" })).status, 403, "WORK のタスク");
  assert.equal((await api("PATCH", `/api/tasks/${hex(2)}`, { status: "✅ DONE" })).status, 403, "しらべた");
  assert.equal((await api("PATCH", `/api/tasks/${hex(11)}`, { status: "✅ DONE" })).status, 403, "育児メモ");
  assert.equal((await api("PATCH", `/api/tasks/${hex(1)}`, { status: "📚 REFERENCE" })).status, 400);
  assert.equal((await api("POST", "/api/tasks", { title: "" })).status, 400);
});

test("ねんね記録：選択肢は DB の設定から、記録は月齢の新しい順", async () => {
  const { data } = await api("GET", "/api/sleep");
  assert.deepEqual(data.options, { place: ["ベビーベッド", "布団（親と一緒）"], methods: ["抱っこ", "ひとりで"], who: ["自分", "妻"] });
  assert.deepEqual(data.records.map((r) => r.month), [9, 8]);
  const r8 = data.records[1];
  assert.deepEqual([r8.place, r8.methods, r8.bed, r8.night, r8.naps], ["ベビーベッド", ["抱っこ"], "20:00", 3, null]);
});

test("ねんね記録：同じ月齢は書き換え、なければ本文ごと1行足す。おかしな値は書かない", async () => {
  const up = await api("PUT", "/api/sleep", { month: 8, place: "布団（親と一緒）", methods: ["ひとりで"], bed: "20:30", night: "1", good: "よく寝た", body: "絵本1冊\n- 電気は真っ暗" });
  assert.equal(up.status, 200);
  const patch = calls.find((c) => c.method === "PATCH" && c.path === `/v1/pages/${hex(31)}`);
  assert.deepEqual(patch.body.properties.寝かしつけ, { multi_select: [{ name: "ひとりで" }] });
  assert.deepEqual(patch.body.properties.夜中に起きる回数, { number: 1 });
  assert.equal(patch.body.properties.名前.title[0].text.content, "生後8か月");
  assert.ok(!calls.some((c) => c.method === "DELETE"), "本文が同じなら消さない");

  await api("PUT", "/api/sleep", { month: 8, body: "21時に就寝" });
  assert.deepEqual(blocks[hex(31)].map((b) => [b.type, b.paragraph?.rich_text[0].text.content]), [["paragraph", "21時に就寝"]]);
  assert.equal((await api("PUT", "/api/sleep", { month: 9, body: "表を消す" })).status, 409, "表を含む本文は書き換えない");

  const add = await api("PUT", "/api/sleep", { month: 13, methods: [], body: "## 寝返り\n1. 右から" });
  assert.equal(add.status, 200);
  const created = pages.at(-1);
  assert.equal(created.parent.data_source_id, DS.sleep);
  assert.equal(created.properties.名前.title[0].text.content, "1歳1か月");
  assert.deepEqual(blocks[created.id].map((b) => b.type), ["heading_2", "numbered_list_item"]);

  for (const b of [{ month: 8, place: "ハンモック" }, { month: 8, methods: ["魔法"] }, { month: 8, bed: "25:00" }, { month: 8, night: -1 }, { month: 1.5 }, { month: 8, body: "あ".repeat(5001) }]) {
    assert.equal((await api("PUT", "/api/sleep", b)).status, 400, JSON.stringify(b));
  }
});

test("ねんね記録の本文を読む（ほかのDBのページは読まない）", async () => {
  assert.deepEqual((await api("GET", `/api/sleep/${hex(31)}/body`)).data, { body: "絵本1冊\n- 電気は真っ暗", editable: true });
  assert.equal((await api("GET", `/api/sleep/${hex(32)}/body`)).data.editable, false);
  assert.equal((await api("GET", `/api/sleep/${hex(1)}/body`)).status, 403);
});

test("カレンダーは非公開アドレスから、育児の言葉を含むこれからの予定だけ", async () => {
  const { status, data } = await api("GET", "/api/calendar");
  assert.equal(status, 200);
  assert.deepEqual(data.events.map((e) => [e.date, e.time, e.title]), [
    [jstDay(10), "09:00", "9か月検診"],
    [jstDay(30), "10:00", "面談"],
  ]);
  const noCal = await worker.fetch(new Request("https://hub.test/api/calendar", { headers: { Authorization: `Bearer ${KEY}` } }), { ...env, CALENDAR_ICS_URLS: "" });
  assert.equal(noCal.status, 503);
});

test("iCal の読み取り：折り返し行・終日・UTC", () => {
  const ev = parseIcs("BEGIN:VEVENT\r\nSUMMARY:長い名前の\r\n 予定\r\nDTSTART:20261231T150000Z\r\nEND:VEVENT");
  assert.deepEqual(ev.map((e) => [e.title, e.date, e.time]), [["長い名前の予定", "2027-01-01", "00:00"]]);
});
