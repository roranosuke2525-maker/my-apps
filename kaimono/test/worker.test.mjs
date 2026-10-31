// Worker の動作確認。Notion API と通知サービスは偽物に差し替える（値はすべて作りもの）。 npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { alertOf, runAlerts, pickMeta, cleanItemName } from "../src/worker.js";
import { b64u } from "../src/webpush.js";

const TASK_DS = "21762844-acbe-8075-bbe6-000bcaf22801";
const DAILY_DS = "53881991-7268-41b5-8954-2bc4b2bf1971";
const TPL_DS = "88548654-76ee-40be-a367-74ccaaa466e1";
const KEY = "test-key-0123456789";
const hex = (n) => n.toString(16).padStart(32, "0");
const rt = (s) => [{ plain_text: s }];
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// 通知の宛先（端末）の鍵
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const uaPublic = b64u.encode(await crypto.subtle.exportKey("raw", ua.publicKey));
const authSecret = b64u.encode(crypto.getRandomValues(new Uint8Array(16)));
const ENDPOINT = "https://web.push.apple.com/QWxhZGRpbjpvcGVuIHNlc2FtZQ";

function kv() {
  const m = new Map();
  return {
    m,
    async get(k, type) { const v = m.get(k); return v == null ? null : type === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix = "" } = {}) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}

let env, pages, blocks, children, calls, pushes, next;
const row = (id, ds, properties, edited = "2026-10-28T00:00:00.000Z") => ({ object: "page", id, url: `https://www.notion.so/${id}`, parent: { type: "data_source_id", data_source_id: ds }, last_edited_time: edited, properties });
function task(id, { name, status = "⏭ NEXT", tag = "BUY", refill = [], url = null, at = null }) {
  return row(id, TASK_DS, {
    名前: { type: "title", title: rt(name) },
    ステータス: { type: "status", status: { name: status } },
    分類タグ: { type: "select", select: tag ? { name: tag } : null },
    NEXT: { type: "rich_text", rich_text: [] },
    URL: { type: "url", url },
    実行日: { type: "date", date: at ? { start: at } : null },
    補充対象: { type: "relation", relation: refill.map((r) => ({ id: r })) },
  });
}
function daily(id, { name, cat = "日用品", use = 1, freq = "毎日", size = 30, bought = null, end = null, rollup = null }) {
  return row(id, DAILY_DS, {
    名前: { type: "title", title: rt(name) },
    カテゴリ: { type: "select", select: { name: cat } },
    メモ: { type: "rich_text", rich_text: [] },
    URL: { type: "url", url: null },
    使う数: { type: "number", number: use },
    使う頻度: { type: "select", select: { name: freq } },
    内容量: { type: "number", number: size },
    "購入日（手入力）": { type: "date", date: bought ? { start: bought } : null },
    最終補充日: { type: "rollup", rollup: { type: "date", date: rollup ? { start: rollup } : null } },
    切れる予定日: { type: "formula", formula: { type: "date", date: end ? { start: end } : null } },
  });
}
const todoBlock = (id, page, text, checked = false) => ({ object: "block", id, type: "to_do", parent: { type: "page_id", page_id: page }, to_do: { rich_text: rt(text), checked }, has_children: false });

const L1 = hex(1), L2 = hex(2), R1 = hex(3), OTHER = hex(4), D1 = hex(11), D2 = hex(12), D3 = hex(13);

function match(p, f) {
  if (!f) return true;
  if (f.and) return f.and.every((g) => match(p, g));
  if (f.or) return f.or.some((g) => match(p, g));
  const prop = p.properties[f.property];
  if (f.status) return prop?.status?.name === f.status.equals;
  if (f.select) return prop?.select?.name === f.select.equals;
  if (f.relation?.is_not_empty) return (prop?.relation || []).length > 0;
  if (f.relation?.contains) return (prop?.relation || []).some((r) => r.id.replace(/-/g, "") === f.relation.contains);
  if (f.checkbox) return !!prop?.checkbox === f.checkbox.equals;
  if (f.date?.on_or_after) return !!prop?.date?.start && prop.date.start.slice(0, 10) >= f.date.on_or_after;
  return true;
}

beforeEach(() => {
  next = 100;
  calls = [];
  pushes = [];
  env = {
    NOTION_TOKEN: "ntn_fake", APP_KEY: KEY, TASK_DS_ID: TASK_DS, DAILY_DS_ID: DAILY_DS, TEMPLATE_DS_ID: TPL_DS, PLAYER_ID: hex(99),
    NOTION_API_BASE: "https://notion.test/v1", ASSETS: { fetch: async () => new Response("asset") },
    SUBS: kv(), VAPID_SUBJECT: "https://kaimono.test",
  };
  pages = new Map([
    [L1, task(L1, { name: "スーパー" })],
    [L2, task(L2, { name: "済んだリスト", status: "✅ DONE" })],
    [R1, task(R1, { name: "補充:洗剤", tag: null, refill: [D2] })],
    [OTHER, task(OTHER, { name: "BUY じゃないタスク", tag: "HOME" })],
    [D1, daily(D1, { name: "トイレットペーパー", size: 10, bought: addDays(today, -9) })], // 10日もつ → あと1日
    [D2, daily(D2, { name: "洗剤", end: addDays(today, -1) })], // 補充タスクあり
    [D3, daily(D3, { name: "サプリ", cat: "サプリ", size: 60, bought: today })],
  ]);
  blocks = new Map();
  children = { [L1]: [], [OTHER]: [] };
  const put = (b) => { blocks.set(b.id, b); children[b.parent.page_id].push(b.id); };
  put({ object: "block", id: hex(51), type: "heading_3", parent: { type: "page_id", page_id: L1 }, heading_3: { rich_text: rt("野菜") } });
  put(todoBlock(hex(52), L1, "キャベツ"));
  put(todoBlock(hex(53), L1, "牛乳 2", true));
  put(todoBlock(hex(54), OTHER, "ほかのタスクの項目"));
  // 「スーパー」の ToDo の下に品目を書く形（1段の入れ子）
  const parent = { ...todoBlock(hex(55), L1, "ヤオコー"), has_children: true };
  put(parent);
  const kid = { ...todoBlock(hex(56), L1, "えのき"), parent: { type: "block_id", block_id: hex(55) } };
  blocks.set(kid.id, kid); children[hex(55)] = [kid.id];
  pages.set(hex(61), row(hex(61), TPL_DS, { 名前: { type: "title", title: rt("もやし") }, 店: { type: "select", select: { name: "ヤオコー" } }, 売り場: { type: "select", select: { name: "野菜・果物" } }, いつもの数: { type: "number", number: 3 }, 単位: { type: "rich_text", rich_text: rt("袋") }, 並び: { type: "number", number: 80 }, 使う: { type: "checkbox", checkbox: true } }));
  pages.set(hex(62), row(hex(62), TPL_DS, { 名前: { type: "title", title: rt("使わない品") }, 店: { type: "select", select: null }, 使う: { type: "checkbox", checkbox: false } }));

  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body && typeof init.body === "string" ? JSON.parse(init.body) : init.body || null;
    if (u.hostname === "shopping.yahooapis.jp") {
      calls.push({ method: "GET", path: "yahoo", url: u.href });
      return new Response(JSON.stringify(u.searchParams.get("jan_code") === "4901234567894" ? { hits: [{ name: "【送料無料】見本洗剤 つめかえ用 400ml", exImage: { url: "https://item-shopping.c.yimg.jp/x.jpg" }, url: "https://store.shopping.yahoo.co.jp/x" }] } : { hits: [] }), { status: 200 });
    }
    if (u.hostname === "shop.example.jp") return new Response(`<html><head><title>見本 | 店</title><meta property="og:image" content="/img/p.jpg"></head></html>`, { status: 200 });
    if (u.hostname.endsWith("push.apple.com")) { pushes.push({ url: u.href, headers: init.headers, body }); return new Response("", { status: 201 }); }
    const path = u.pathname.replace(/^\/v1/, "");
    calls.push({ method: init.method, path, body });
    const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
    const nf = () => new Response(JSON.stringify({ code: "object_not_found" }), { status: 404 });
    let m;
    if ((m = path.match(/^\/data_sources\/([^/]+)\/query$/))) {
      return ok({ results: [...pages.values()].filter((p) => p.parent.data_source_id === m[1] && match(p, body?.filter)), has_more: false });
    }
    if ((m = path.match(/^\/blocks\/([^/]+)\/children$/))) {
      if (!children[m[1]]) children[m[1]] = [];
      if (init.method === "PATCH") {
        const made = body.children.map((c) => { const b = { ...c, id: hex(next++), parent: { type: "page_id", page_id: m[1] }, to_do: { ...c.to_do, rich_text: c.to_do.rich_text.map((t) => ({ plain_text: t.text.content })) } }; blocks.set(b.id, b); children[m[1]].push(b.id); return b; });
        return ok({ results: made });
      }
      return ok({ results: children[m[1]].map((id) => blocks.get(id)), has_more: false });
    }
    if ((m = path.match(/^\/blocks\/([^/]+)$/))) {
      const b = blocks.get(m[1]); if (!b) return nf();
      if (init.method === "DELETE") { blocks.delete(b.id); children[b.parent.page_id] = children[b.parent.page_id].filter((x) => x !== b.id); return ok({ ...b, in_trash: true }); }
      if (init.method === "PATCH") { if ("checked" in body.to_do) b.to_do.checked = body.to_do.checked; if (body.to_do.rich_text) b.to_do.rich_text = body.to_do.rich_text.map((t) => ({ plain_text: t.text.content })); }
      return ok(b);
    }
    if ((m = path.match(/^\/pages\/([^/]+)$/))) {
      const p = pages.get(m[1]); if (!p) return nf();
      if (init.method === "PATCH") for (const [k, v] of Object.entries(body.properties || {})) p.properties[k] = { ...p.properties[k], ...v };
      if (init.method === "PATCH" && body.in_trash) p.in_trash = true;
      return ok(p);
    }
    if (path === "/pages" && init.method === "POST") {
      if (body.properties["プレイヤー"] && env.PLAYER_FAIL) return new Response(JSON.stringify({ code: "validation_error" }), { status: 400 });
      const id = hex(next++);
      const props = Object.fromEntries(Object.entries(body.properties).map(([k, v]) => [k, { type: Object.keys(v)[0], ...v }]));
      for (const v of Object.values(props)) if (v.title) v.title = v.title.map((t) => ({ plain_text: t.text.content }));
      for (const v of Object.values(props)) if (v.rich_text) v.rich_text = v.rich_text.map((t) => ({ plain_text: t.text.content }));
      const p = row(id, body.parent.data_source_id, props);
      pages.set(id, p);
      children[id] = [];
      return ok(p);
    }
    return new Response("{}", { status: 404 });
  };
});

async function api(method, path, body, key = KEY) {
  const res = await worker.fetch(new Request(`https://kaimono.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }), env);
  return { status: res.status, data: await res.json() };
}
const writes = () => calls.filter((c) => c.method !== "GET" && !c.path.endsWith("/query"));

test("合言葉と設定", async () => {
  assert.equal((await api("GET", "/api/state", null, "wrong-key-0123456789")).status, 401);
  const res = await worker.fetch(new Request("https://kaimono.test/api/state"), { ...env, APP_KEY: "short" });
  assert.equal(res.status, 500);
  assert.equal(calls.length, 0);
  assert.equal(await (await worker.fetch(new Request("https://kaimono.test/"), env)).text(), "asset");
});

test("読みこみ：開いている BUY タスクと補充タスク、本文の ToDo、在庫の残り日数", async () => {
  const { status, data } = await api("GET", "/api/state");
  assert.equal(status, 200);
  assert.deepEqual(data.lists.map((t) => t.name).sort(), ["スーパー", "補充:洗剤"]);
  const sup = data.lists.find((t) => t.id === L1);
  assert.deepEqual(sup.items.map((i) => [i.text, i.checked, i.group]), [["キャベツ", false, "野菜"], ["牛乳 2", true, "野菜"], ["えのき", false, "ヤオコー"]]);
  assert.deepEqual(data.templates.map((x) => [x.name, x.store, x.aisle, x.qty, x.unit]), [["もやし", "ヤオコー", "野菜・果物", 3, "袋"]]);
  assert.equal(data.templateErr, "");
  assert.equal(data.lists.find((t) => t.id === R1).items, undefined); // 補充タスクの本文は読まない
  const st = Object.fromEntries(data.stock.map((x) => [x.name, x]));
  assert.equal(st["トイレットペーパー"].left, 1);
  assert.equal(st["洗剤"].left, -1); // 計算式の値を使う
  assert.deepEqual(st["洗剤"].open, [R1]);
  assert.equal(st["サプリ"].left, 60);
  assert.equal(writes().length, 0);
});

test("品目：足す・チェック・名前を直す・消す。買い物タスク以外の ToDo には触らない", async () => {
  const add = await api("POST", `/api/lists/${L1}/items`, { items: ["卵", " ", "食パン 1袋"] });
  assert.equal(add.status, 200);
  assert.deepEqual(add.data.items.map((i) => i.text), ["卵", "食パン 1袋"]);
  const egg = add.data.items[0].id;
  assert.equal((await api("PATCH", `/api/items/${egg}`, { checked: true })).data.item.checked, true);
  assert.equal(blocks.get(egg).to_do.checked, true);
  assert.equal((await api("PATCH", `/api/items/${egg}`, { text: "卵 10個" })).data.item.text, "卵 10個");
  assert.equal((await api("DELETE", `/api/items/${egg}`)).status, 200);
  assert.ok(!blocks.has(egg));

  assert.equal((await api("PATCH", `/api/items/${hex(56)}`, { checked: true })).status, 200); // 入れ子の品目
  assert.equal(blocks.get(hex(56)).to_do.checked, true);
  assert.equal((await api("PATCH", `/api/items/${hex(54)}`, { checked: true })).status, 403);
  assert.equal((await api("POST", `/api/lists/${OTHER}/items`, { items: ["x"] })).status, 403);
  assert.equal((await api("POST", `/api/lists/${R1}/items`, { items: ["x"] })).status, 403);
  assert.equal((await api("POST", `/api/lists/${D1}/items`, { items: ["x"] })).status, 403);
  assert.equal((await api("POST", `/api/lists/${L1}/items`, { items: Array(51).fill("a") })).status, 400);
  assert.equal((await api("PATCH", `/api/items/${hex(51)}`, { checked: true })).status, 403); // 見出しは品目ではない
  assert.equal(blocks.get(hex(54)).to_do.checked, false);
});

test("かごの品を消す・買い物おわり", async () => {
  const res = await api("POST", `/api/lists/${L1}/clear`);
  assert.deepEqual(res.data.removed, [hex(53)]);
  assert.deepEqual(children[L1], [hex(51), hex(52), hex(55)]);
  assert.equal((await api("POST", `/api/lists/${L1}/done`)).status, 200);
  assert.equal(pages.get(L1).properties["ステータス"].status.name, "✅ DONE");
  assert.equal((await api("POST", `/api/lists/${OTHER}/done`)).status, 403);
});

test("新しいリスト：BUY・NEXT・プレイヤーつき。プレイヤーに届かなければ関連なしで作る", async () => {
  const res = await api("POST", "/api/lists", { name: "ドラッグストア", items: ["マスク"] });
  assert.equal(res.status, 200);
  const p = pages.get(res.data.list.id);
  assert.equal(p.properties["分類タグ"].select.name, "BUY");
  assert.equal(p.properties["ステータス"].status.name, "⏭ NEXT");
  assert.deepEqual(p.properties["プレイヤー"].relation, [{ id: hex(99) }]);
  assert.deepEqual(res.data.list.items.map((i) => i.text), ["マスク"]);

  env.PLAYER_FAIL = true;
  const res2 = await api("POST", "/api/lists", { name: "" });
  assert.equal(res2.status, 200);
  assert.equal(res2.data.list.name, "買い物リスト");
  assert.equal(pages.get(res2.data.list.id).properties["プレイヤー"], undefined);
});

test("補充：リストへ（補充タスクを作る・二重に作らない）と補充した（済みにして残りを出し直す）", async () => {
  const r = await api("POST", `/api/stock/${D1}/refill`);
  assert.equal(r.data.existed, false);
  const t = pages.get(r.data.task.id);
  assert.equal(t.properties["名前"].title[0].plain_text, "補充:トイレットペーパー");
  assert.deepEqual(t.properties["補充対象"].relation, [{ id: D1 }]);
  assert.equal((await api("POST", `/api/stock/${D1}/refill`)).data.existed, true);

  const done = await api("POST", `/api/stock/${D1}/restocked`);
  assert.deepEqual(done.data.done, [r.data.task.id]);
  assert.equal(t.properties["ステータス"].status.name, "✅ DONE");
  assert.equal(done.data.stock.left, 10);
  assert.equal(done.data.stock.base, today);

  // 補充タスクがなくても「補充した」は記録できる（済みの補充タスクを作る）
  const d3 = await api("POST", `/api/stock/${D3}/restocked`);
  assert.equal(d3.data.done.length, 1);
  assert.equal(pages.get(d3.data.done[0]).properties["ステータス"].status.name, "✅ DONE");
  assert.equal((await api("POST", `/api/stock/${L1}/refill`)).status, 403);
});

test("在庫の登録", async () => {
  const res = await api("POST", "/api/stock", { name: "ゴミ袋", cat: "日用品", use: "1", freq: "毎週", size: "20" });
  assert.equal(res.status, 200);
  assert.equal(res.data.stock.days, 140);
  assert.equal(res.data.stock.left, 140);
  assert.equal(pages.get(res.data.stock.id).parent.data_source_id, DAILY_DS);
  assert.equal((await api("POST", "/api/stock", { name: "x", link: "javascript:alert(1)" })).status, 400);
  assert.equal((await api("POST", "/api/stock", { name: "" })).status, 400);
});

test("アラートの文：補充タスクのない切れそうな品だけ。リストの残りは選んだときだけ", () => {
  const state = { lists: [{ refill: [], items: [{ text: "牛乳", checked: false }, { text: "卵", checked: true }] }], stock: [{ name: "A", left: 1, open: [] }, { name: "B", left: -2, open: [] }, { name: "C", left: 0, open: ["x"] }, { name: "D", left: 10, open: [] }] };
  const a = alertOf(state, { days: 3 });
  assert.equal(a.title, "在庫がそろそろ切れます（2品）");
  assert.equal(a.body, "切れそう：B（切れて2日）・A（あと1日）");
  assert.equal(alertOf({ ...state, stock: [] }, { days: 3 }), null);
  assert.equal(alertOf({ ...state, stock: [] }, { days: 3, list: true }).body, "リストに1品：牛乳");
});

async function decrypt(body) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const hk = async (s, ikm, info, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info: new TextEncoder().encode(info) }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
  const uaRaw = b64u.decode(uaPublic);
  const info = new Uint8Array([...new TextEncoder().encode("WebPush: info\0"), ...uaRaw, ...asPublic]);
  const ikm = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: b64u.decode(authSecret), info }, await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]), 256));
  const cek = await hk(salt, ikm, "Content-Encoding: aes128gcm\0", 16);
  const nonce = await hk(salt, ikm, "Content-Encoding: nonce\0", 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), cipher));
  assert.equal(plain.at(-1), 2);
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}
const subscription = { endpoint: ENDPOINT, keys: { p256dh: uaPublic, auth: authSecret } };

test("通知：登録・状態・テスト送信（暗号化と VAPID の署名を確かめる）・解除", async () => {
  const key = (await api("GET", "/api/push")).data;
  assert.equal(key.ready, true);
  assert.equal(b64u.decode(key.publicKey).length, 65);
  assert.equal((await api("GET", "/api/push")).data.publicKey, key.publicKey); // 鍵は一度作ったら同じ
  const VAPID_PUBLIC = key.publicKey;
  const vapidKey = await crypto.subtle.importKey("raw", b64u.decode(VAPID_PUBLIC), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.equal((await api("PUT", "/api/push", { subscription: { ...subscription, endpoint: "https://evil.example/x" } })).status, 400);
  const put = await api("PUT", "/api/push", { subscription, hour: 7, days: 2, list: false });
  assert.deepEqual(put.data, { subscribed: true, hour: 7, days: 2, list: false, remind: true });
  assert.equal((await api("POST", "/api/push/status", { endpoint: ENDPOINT })).data.hour, 7);

  const t = await api("POST", "/api/push/test", { endpoint: ENDPOINT });
  assert.equal(t.status, 200);
  assert.equal(pushes.length, 1);
  const sent = pushes[0];
  assert.equal(sent.headers["Content-Encoding"], "aes128gcm");
  const msg = await decrypt(new Uint8Array(sent.body));
  assert.equal(msg.title, "在庫がそろそろ切れます（1品）"); // トイレットペーパー（洗剤は補充タスクあり）
  assert.match(msg.body, /トイレットペーパー（あと1日）/);
  const [, jwt, k] = sent.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, VAPID_PUBLIC);
  const [h, c, s] = jwt.split(".");
  assert.equal(JSON.parse(new TextDecoder().decode(b64u.decode(c))).aud, "https://web.push.apple.com");
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vapidKey, b64u.decode(s), new TextEncoder().encode(`${h}.${c}`)));

  assert.equal((await api("DELETE", "/api/push", { endpoint: ENDPOINT })).data.subscribed, false);
  assert.ok(!env.SUBS.m.has([...env.SUBS.m.keys()].find((k) => k.startsWith("sub:")) ?? "none"));
});

test("定時のアラート：選んだ時刻の端末にだけ、1日1回。切れた購読は消す", async () => {
  await api("PUT", "/api/push", { subscription, hour: 8, days: 3 });
  const other = { endpoint: `${ENDPOINT}2`, keys: subscription.keys };
  await api("PUT", "/api/push", { subscription: other, hour: 9, days: 3 });
  const at8 = Date.parse(`${today}T08:00:00+09:00`);
  assert.equal((await runAlerts(env, at8)).sent, 1);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].url, ENDPOINT);
  assert.equal((await runAlerts(env, at8 + 60e3)).sent, 0); // 同じ日は2回送らない

  const fetch0 = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).startsWith(`${ENDPOINT}2`) ? new Response("", { status: 410 }) : fetch0(url, init));
  await runAlerts(env, at8 + 3600e3);
  assert.equal([...env.SUBS.m.keys()].filter((k) => k.startsWith("sub:")).length, 1);
  globalThis.fetch = fetch0;
});

test("買い物の時刻：リストを作るときと後から。形が違えば断る", async () => {
  const res = await api("POST", "/api/lists", { name: "🛒 ヤオコー 10/31", items: ["もやし 3袋"], at: "2026-10-31T10:00+09:00" });
  assert.equal(res.status, 200);
  assert.equal(pages.get(res.data.list.id).properties["実行日"].date.start, "2026-10-31T10:00:00+09:00");
  assert.equal(res.data.list.at, "2026-10-31T10:00:00+09:00");
  assert.equal((await api("PATCH", `/api/lists/${L1}/when`, { at: "2026-11-01T17:30:00+09:00" })).data.at, "2026-11-01T17:30:00+09:00");
  assert.equal((await api("PATCH", `/api/lists/${L1}/when`, { at: null })).data.at, null);
  assert.equal(pages.get(L1).properties["実行日"].date, null);
  assert.equal((await api("PATCH", `/api/lists/${L1}/when`, { at: "明日" })).status, 400);
  assert.equal((await api("PATCH", `/api/lists/${OTHER}/when`, { at: null })).status, 403);
});

test("テンプレートに足す", async () => {
  const res = await api("POST", "/api/templates", { name: "豆腐", store: "ヤオコー", qty: 2, unit: "丁" });
  assert.equal(res.status, 200);
  assert.deepEqual([res.data.template.name, res.data.template.qty, res.data.template.unit], ["豆腐", 2, "丁"]);
  assert.equal(pages.get(res.data.template.id).parent.data_source_id, TPL_DS);
  assert.equal((await api("POST", "/api/templates", { name: "" })).status, 400);
});

test("買い物のリマインド：30分前と時刻ちょうどに1度ずつ。通知をオフにした端末には送らない", async () => {
  const at = "2026-10-31T10:00:00+09:00";
  pages.set(hex(70), task(hex(70), { name: "🛒 ヤオコー 10/31", at }));
  children[hex(70)] = [];
  const b = todoBlock(hex(71), hex(70), "もやし 3袋"); blocks.set(b.id, b); children[hex(70)].push(b.id);
  await api("PUT", "/api/push", { subscription, hour: 3, days: 3 });
  const other = { endpoint: `${ENDPOINT}9`, keys: subscription.keys };
  await api("PUT", "/api/push", { subscription: other, hour: 3, days: 3, remind: false });
  const t0 = Date.parse(at);
  await runAlerts(env, t0 - 31 * 60e3);
  assert.equal(pushes.length, 0);
  await runAlerts(env, t0 - 25 * 60e3); // 9:35 の回 → 30分前の知らせ
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].url, ENDPOINT);
  const m1 = await decrypt(new Uint8Array(pushes[0].body));
  assert.equal(m1.title, "🛒 10:00 から買い物（あと30分）");
  assert.equal(m1.body, "🛒 ヤオコー 10/31：1品（もやし 3袋）");
  await runAlerts(env, t0 - 20 * 60e3); // 同じ知らせは2度送らない
  assert.equal(pushes.length, 1);
  await runAlerts(env, t0 + 5 * 60e3);
  assert.equal(pushes.length, 2);
  assert.equal((await decrypt(new Uint8Array(pushes[1].body))).title, "🛒 買い物の時間です（10:00）");
});

test("在庫を直す：使う頻度・商品（名前・URL・画像・JAN）。商品を変えたら買った日を今日に", async () => {
  const res = await api("PATCH", `/api/stock/${D1}`, { name: "新しいトイレットペーパー", freq: "毎週", use: 2, image: "https://img.example/p.jpg", jan: "4901234567894", bought: "today" });
  assert.equal(res.status, 200);
  const p = pages.get(D1).properties;
  assert.equal(p["名前"].title[0].text.content, "新しいトイレットペーパー");
  assert.equal(p["使う頻度"].select.name, "毎週");
  assert.equal(p["画像"].files[0].external.url, "https://img.example/p.jpg");
  assert.equal(p.JAN.rich_text[0].text.content, "4901234567894");
  assert.equal(p["購入日（手入力）"].date.start, today);
  assert.equal(p["カテゴリ"].select.name, "日用品"); // 送らなかった列はそのまま
  assert.equal((await api("PATCH", `/api/stock/${D1}`, { jan: "12" })).status, 400);
  assert.equal((await api("PATCH", `/api/stock/${D1}`, { image: "http://x" })).status, 400);
  assert.equal((await api("PATCH", `/api/stock/${L1}`, { name: "x" })).status, 403);
  assert.equal((await api("PATCH", `/api/stock/${D1}`, {})).status, 400);
});

test("商品ページから画像を拾う", async () => {
  assert.deepEqual(pickMeta(`<meta content="https://a.jp/i.jpg" property="og:image"><meta property="og:title" content="商品 &amp; 名前">`, "https://a.jp/p"), { image: "https://a.jp/i.jpg", title: "商品 & 名前" });
  assert.equal(pickMeta(`<img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/81abc.jpg">`, "https://www.amazon.co.jp/dp/x").image, "https://m.media-amazon.com/images/I/81abc.jpg");
  const res = await api("POST", "/api/lookup", { url: "https://shop.example.jp/item/1" });
  assert.deepEqual(res.data, { image: "https://shop.example.jp/img/p.jpg", title: "見本 | 店" });
  assert.equal((await api("POST", "/api/lookup", { url: "http://shop.example.jp/" })).status, 400);
  assert.equal((await api("POST", "/api/lookup", { url: "https://127.0.0.1/" })).status, 400);
});

test("バーコードから商品を引く（Yahoo!ショッピング。Client ID がなければ使わない）", async () => {
  assert.deepEqual((await api("GET", "/api/jan/4901234567894")).data, { configured: false });
  env.YAHOO_APPID = "fake-id";
  const hit = (await api("GET", "/api/jan/4901234567894")).data;
  assert.equal(hit.name, "見本洗剤 つめかえ用 400ml");
  assert.equal(hit.image, "https://item-shopping.c.yimg.jp/x.jpg");
  assert.equal((await api("GET", "/api/jan/4900000000000")).data.found, false);
  assert.equal((await api("GET", "/api/jan/12ab")).status, 404);
  assert.equal(cleanItemName("★ポイント5倍★ 洗剤 【あす楽】"), "洗剤");
});

test("写真から商品を当てる（Workers AI。在庫の中の同じ品を選ばせる）", async () => {
  const seen = [];
  env.AI = { run: async (model, input) => { seen.push(input); if (seen.length === 1) throw new Error("Please agree to the license"); return input.prompt === "agree" ? {} : { response: '{"name":"見本洗剤 400ml","category":"日用品","match":"洗剤"}' }; } };
  const img = "data:image/jpeg;base64," + Buffer.from("fakejpeg").toString("base64");
  const res = await api("POST", "/api/identify", { image: img, names: ["洗剤", "サプリ"] });
  assert.deepEqual(res.data, { name: "見本洗剤 400ml", category: "日用品", match: "洗剤" });
  assert.equal(seen[1].prompt, "agree"); // はじめは規約に同意してからやり直す
  assert.match(seen[2].messages[0].content[0].text, /洗剤 \/ サプリ/);
  assert.equal(seen[2].messages[0].content[1].image_url.url, img);
  env.AI = { run: async () => ({ response: { name: "見本シャンプー", category: "美容", match: "" } }) }; // 読み取り済みで返ることもある
  assert.deepEqual((await api("POST", "/api/identify", { image: img, names: [] })).data, { name: "見本シャンプー", category: "美容", match: "" });
  assert.equal((await api("POST", "/api/identify", { image: "nope" })).status, 400);
});

test("在庫の品を消す（ゴミ箱へ）。DB_Daily の行だけ", async () => {
  assert.equal((await api("DELETE", `/api/stock/${D3}`)).status, 200);
  assert.equal(pages.get(D3).in_trash, true);
  assert.equal((await api("DELETE", `/api/stock/${L1}`)).status, 403);
  assert.ok(!pages.get(L1).in_trash);
});
