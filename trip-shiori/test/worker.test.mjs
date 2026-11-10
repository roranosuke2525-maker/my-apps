// Worker の動作確認。Notion API は偽物に差し替える。 npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { mapQuery, sortByTime, poiKind } from "../src/worker.js";

const PAGE = "41362844acbe805e80edd37ae516ecda";
const KEY = "test-key-0123456789";
const env = {
  NOTION_TOKEN: "ntn_fake",
  APP_KEY: KEY,
  PAGE_ID: PAGE,
  TRIP_YEAR: "2026",
  MAP_AREA: "舞浜",
  HIDE_GROUPS: "Notionにしおりとしてまとめる",
  NOTION_API_BASE: "https://notion.test/v1",
  OVERPASS_URL: "https://overpass.test/api",
  THEMEPARKS_URL: "https://themeparks.test/v1",
  ASSETS: { fetch: async () => new Response("asset") },
};

let blocks; // id -> block
let kids; // parent id -> [child ids]
let calls;
let seq;

const rt = (s) => [{ plain_text: s, text: { content: s } }];

function add(parent, type, text, extra = {}) {
  const id = `b${String(++seq).padStart(31, "0")}`;
  const parentRef = parent === PAGE ? { type: "page_id", page_id: PAGE } : { type: "block_id", block_id: parent };
  blocks[id] = { object: "block", id, type, parent: parentRef, has_children: false, [type]: { rich_text: rt(text), ...(type === "to_do" ? { checked: false } : {}) }, ...extra };
  (kids[parent] ||= []).push(id);
  if (blocks[parent]) blocks[parent].has_children = true;
  return id;
}

let ids;
beforeEach(() => {
  blocks = {};
  kids = {};
  calls = [];
  seq = 0;
  ids = {};
  add(PAGE, "table_of_contents", "");
  add(PAGE, "heading_2", "☑️ ToDo（11/09 11:55）");
  ids.meta = add(PAGE, "to_do", "Notionにしおりとしてまとめる⇒やはりPWAアプリの方がいいかも");
  add(ids.meta, "to_do", "PWAのデータの置き場を決める");
  ids.decided = add(PAGE, "to_do", "しおりに載せるものを3つに絞る");
  blocks[ids.decided].to_do.checked = true;
  ids.prep = add(PAGE, "to_do", "事前準備");
  add(ids.prep, "to_do", "服");
  ids.pouch = add(ids.prep, "to_do", "ポーチ");
  ids.sunglasses = add(ids.pouch, "to_do", "サングラス");
  ids.d12 = add(PAGE, "to_do", "11/12（木）");
  ids.leave = add(ids.d12, "to_do", "7:00　車で自宅を出発");
  add(ids.d12, "to_do", "7:15　高崎駅でご両親をピックアップ");
  add(ids.d12, "to_do", "13:30　レストラン北斎");
  ids.d14 = add(PAGE, "to_do", "11/14（土）");
  add(ids.d14, "to_do", "7:30　ルームサービス（東京ディズニーランドホテル）");
  ids.lastTodo = add(PAGE, "to_do", "ToDo");
  add(ids.lastTodo, "to_do", "会社へお菓子");
  add(PAGE, "heading_2", "🔍 調査結果");
  ids.outside = add(PAGE, "to_do", "BとDの合算　公式アプリと同期できたりする？");

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith("https://themeparks.test")) {
      const path = String(url).replace("https://themeparks.test/v1", "");
      calls.push({ method: "GET", path: `themeparks${path}` });
      if (path.endsWith("/children")) return new Response(JSON.stringify({ children: [
        { id: "tdl-id", name: "Tokyo Disneyland", entityType: "PARK" },
        { id: "tds-id", name: "Tokyo DisneySea", entityType: "PARK" },
        { id: "hotel", name: "Tokyo Disneyland Hotel", entityType: "HOTEL" },
      ] }));
      if (path === "/entity/tdl-id/schedule") return new Response(JSON.stringify({ schedule: [
        { date: "2026-11-12", type: "OPERATING", openingTime: "2026-11-12T09:00:00+09:00", closingTime: "2026-11-12T21:00:00+09:00" },
        { date: "2026-11-12", type: "EXTRA_HOURS", openingTime: "2026-11-12T08:45:00+09:00", closingTime: "2026-11-12T09:00:00+09:00" },
      ] }));
      return new Response("{}", { status: 404 });
    }
    if (String(url).startsWith("https://overpass.test")) {
      const q = decodeURIComponent(String(init.body).slice(5));
      calls.push({ method: "POST", path: "overpass", body: q });
      // ランドは敷地の形で取れる。シーは形が無い（空）→ 四角で取り直す
      const isSea = q.includes("35.6236") || q.includes("ディズニーシー");
      const areaQuery = q.includes("area.p");
      const elements = !isSea ? [
        { type: "node", lat: 35.633, lon: 139.880, tags: { tourism: "attraction", name: "カリブの海賊" } },
        { type: "way", center: { lat: 35.632, lon: 139.881 }, tags: { amenity: "toilets", changing_table: "yes" } },
        { type: "node", lat: 35.6331, lon: 139.8801, tags: { shop: "gift", name: "東京ディズニーランドホテル ショップ" } },
        { type: "node", tags: { amenity: "cafe", name: "座標なし" } },
      ] : areaQuery ? [] : [
        { type: "node", lat: 35.627, lon: 139.885, tags: { amenity: "restaurant", name: "Cafe", "name:ja": "カフェ・ポルトフィーノ" } },
      ];
      return new Response(JSON.stringify({ elements }), { status: 200 });
    }
    const u = new URL(url.replace(env.NOTION_API_BASE, "https://x"));
    const path = u.pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path, body });
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    const notFound = () => new Response(JSON.stringify({ code: "object_not_found" }), { status: 404 });
    let m;
    if (init.method === "GET" && path === `/pages/${PAGE}`) {
      return ok({ properties: { 名前: { type: "title", title: [{ plain_text: "11/12～11/14 旅行" }] } } });
    }
    if (init.method === "GET" && (m = path.match(/^\/blocks\/(\w+)\/children$/))) {
      return ok({ results: (kids[m[1]] || []).map((id) => blocks[id]), has_more: false });
    }
    if (init.method === "GET" && (m = path.match(/^\/blocks\/(\w+)$/))) {
      return blocks[m[1]] ? ok(blocks[m[1]]) : notFound();
    }
    if (init.method === "PATCH" && (m = path.match(/^\/blocks\/(\w+)\/children$/))) {
      const parent = m[1];
      const made = body.children.map((c) => add(parent, c.type, c[c.type].rich_text[0].text.content));
      if (body.after) {
        const list = kids[parent].filter((id) => !made.includes(id));
        list.splice(list.indexOf(body.after) + 1, 0, ...made);
        kids[parent] = list;
      }
      return ok({ results: made.map((id) => blocks[id]) });
    }
    if (init.method === "DELETE" && (m = path.match(/^\/blocks\/(\w+)$/))) {
      const b = blocks[m[1]];
      const pid = b.parent.page_id || b.parent.block_id;
      kids[pid] = kids[pid].filter((x) => x !== m[1]);
      delete blocks[m[1]];
      return ok({ id: m[1], in_trash: true });
    }
    if (init.method === "PATCH" && (m = path.match(/^\/blocks\/(\w+)$/))) {
      const b = blocks[m[1]];
      if (body.to_do.checked !== undefined) b.to_do.checked = body.to_do.checked;
      if (body.to_do.rich_text) b.to_do.rich_text = rt(body.to_do.rich_text[0].text.content);
      return ok(b);
    }
    return new Response("{}", { status: 500 });
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

test("合言葉が違うと 401", async () => {
  const res = await req("GET", "/api/trip", null, "wrong-key-0123456789");
  assert.equal(res.status, 401);
});

test("画面のファイルは ASSETS から返す", async () => {
  const res = await worker.fetch(new Request("https://app.test/index.html"), env);
  assert.equal(await res.text(), "asset");
});

test("しおりを読む：日付は日程に、ほかは準備に。隠したまとまり・見出しの外は出さない", async () => {
  const res = await req("GET", "/api/trip");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.title, "11/12～11/14 旅行");
  assert.deepEqual(data.parks, ["land", "sea"]);
  const only = await worker.fetch(new Request("https://app.test/api/trip", { headers: { Authorization: `Bearer ${KEY}` } }), { ...env, TRIP_PARKS: "land" });
  assert.deepEqual((await only.json()).parks, ["land"]);
  assert.deepEqual(data.days.map((d) => d.date), ["2026-11-12", "2026-11-14"]);
  const d12 = data.days[0];
  assert.equal(d12.items[0].time, "7:00");
  assert.equal(d12.items[0].label, "車で自宅を出発");
  assert.equal(d12.items[0].map, undefined);
  assert.match(d12.items[1].map, /query=%E9%AB%98%E5%B4%8E%E9%A7%85$/); // 高崎駅（舞浜は足さない）
  assert.match(decodeURIComponent(d12.items[2].map), /レストラン北斎 舞浜$/);
  assert.match(decodeURIComponent(data.days[1].items[0].map), /東京ディズニーランドホテル 舞浜$/);
  assert.deepEqual(data.groups.map((g) => g.label), ["事前準備", "ToDo"]);
  assert.equal(data.groups[0].items[1].children[0].label, "サングラス");
});

test("チェックを付ける", async () => {
  const res = await req("PATCH", `/api/blocks/${ids.sunglasses}`, { checked: true });
  assert.equal(res.status, 200);
  assert.equal(blocks[ids.sunglasses].to_do.checked, true);
});

test("しおりの外（見出しの後・隠したまとまり・別のページ）は書き換えない", async () => {
  for (const id of [ids.outside, ids.meta, ids.decided]) {
    const res = await req("PATCH", `/api/blocks/${id}`, { checked: true });
    assert.equal(res.status, 403);
    assert.equal(blocks[id].to_do.checked, id === ids.decided);
  }
  blocks.cfffffffffffffffffffffffffffffff = { id: "cfffffffffffffffffffffffffffffff", type: "to_do", parent: { type: "page_id", page_id: "otherpage" }, to_do: { rich_text: rt("x"), checked: false } };
  const res = await req("PATCH", "/api/blocks/cfffffffffffffffffffffffffffffff", { checked: true });
  assert.equal(res.status, 403);
  assert.ok(!calls.some((c) => c.method === "PATCH"));
});

test("項目を足す・文字を直す", async () => {
  const res = await req("POST", `/api/blocks/${ids.prep}/children`, { text: "  日焼け止め\n" });
  assert.equal(res.status, 200);
  const item = await res.json();
  assert.equal(item.label, "日焼け止め");
  assert.ok(kids[ids.prep].includes(item.id));
  const fix = await req("PATCH", `/api/blocks/${item.id}`, { text: "日焼け止め（子ども用）" });
  assert.equal(fix.status, 200);
  assert.equal(blocks[item.id].to_do.rich_text[0].plain_text, "日焼け止め（子ども用）");
});

test("空の文字・長すぎる文字は足さない", async () => {
  assert.equal((await req("POST", `/api/blocks/${ids.prep}/children`, { text: "  " })).status, 400);
  assert.equal((await req("POST", `/api/blocks/${ids.prep}/children`, { text: "あ".repeat(201) })).status, 400);
});

test("まとまりを足すと ToDo の最後（見出しの前）に入る", async () => {
  const res = await req("POST", "/api/groups", { text: "👕 服装" });
  assert.equal(res.status, 200);
  const g = await res.json();
  const top = kids[PAGE];
  assert.equal(top.indexOf(g.id), top.indexOf(ids.lastTodo) + 1);
  const trip = await (await req("GET", "/api/trip")).json();
  assert.deepEqual(trip.groups.map((x) => x.label), ["事前準備", "ToDo", "👕 服装"]);
});

test("地図で探す場所の取り出し", () => {
  assert.equal(mapQuery("東京ディズニーランドホテル　チェックイン"), "東京ディズニーランドホテル");
  assert.equal(mapQuery("ポリネシアンテラス・レストラン（どちらか）"), "ポリネシアンテラス・レストラン");
  assert.equal(mapQuery("関越⇒外環でディズニーリゾートへ"), null);
  assert.equal(mapQuery("📍 クリッターカントリー"), "クリッターカントリー");
  assert.equal(mapQuery("センターストリートコーヒーハウス"), "センターストリートコーヒーハウス");
  assert.equal(mapQuery("三芳PA（上り）でトイレ休憩"), "三芳PA 上り");
});

test("予定は時刻順。時刻の無い行は直前の行にくっつく", () => {
  const it = (time, label) => ({ time, label });
  const out = sortByTime([it(null, "メモ"), it("13:30", "北斎"), it("7:15", "駅"), it(null, "ルート"), it("9:05", "PA")]);
  assert.deepEqual(out.map((x) => x.label), ["メモ", "駅", "ルート", "PA", "北斎"]);
});

test("消す：しおりの中の項目はゴミ箱へ。日付のまとまり・しおりの外は消さない", async () => {
  const res = await req("DELETE", `/api/blocks/${ids.sunglasses}`);
  assert.equal(res.status, 200);
  assert.ok(!kids[ids.pouch].includes(ids.sunglasses));
  assert.equal((await req("DELETE", `/api/blocks/${ids.d12}`)).status, 400);
  assert.equal((await req("DELETE", `/api/blocks/${ids.outside}`)).status, 403);
  assert.ok(blocks[ids.d12] && blocks[ids.outside]);
});

test("詳しい地図のデータ：座標の無いものは捨て、日本語名と種類をつける", async () => {
  const res = await req("GET", "/api/pois");
  assert.equal(res.status, 200);
  const data = await res.json();
  // パークの外（ホテル）は捨てる。シーは敷地の形が無いので四角で取り直す
  assert.deepEqual(data.pois.map((p) => [p.n, p.k, p.p]), [["カリブの海賊", "ride", "land"], ["トイレ", "toilet", "land"], ["カフェ・ポルトフィーノ", "food", "sea"]]);
  assert.equal(calls.filter((c) => c.path === "overpass").length, 3);
  assert.equal(data.pois[1].ct, 1);
  assert.match(data.attribution, /OpenStreetMap/);
  assert.equal(poiKind({ shop: "gift" }), "shop");
  // ランドだけの旅行ならシーは取りに行かない
  calls = [];
  const only = await worker.fetch(new Request("https://app.test/api/pois", { headers: { Authorization: `Bearer ${KEY}` } }), { ...env, TRIP_PARKS: "land" });
  assert.deepEqual((await only.json()).pois.map((p) => p.p), ["land", "land"]);
  assert.equal(calls.filter((c) => c.path === "overpass").length, 1);
});

test("開園時間：ランドの予定から開園・閉園・早く入れる時間を返す（今回のパークだけ）", async () => {
  const res = await worker.fetch(new Request("https://app.test/api/hours", { headers: { Authorization: `Bearer ${KEY}` } }), { ...env, TRIP_PARKS: "land" });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.hours.land["2026-11-12"], { open: "9:00", close: "21:00", early: "8:45" });
  assert.equal(data.hours.sea, undefined);
  assert.match(data.attribution, /ThemeParks\.wiki/);
});
