// かいもの：画面の配信と Notion API の中継・在庫アラートの通知（Cloudflare Worker）
// Notion のトークンはこの Worker の secret にだけ置き、ブラウザには渡さない。
// 書き換えるのは DB_タスク管理 の買い物タスク（分類タグ BUY か 補充対象つき）とその本文の ToDo、DB_Daily への行の追加だけ。
import { sendPush, b64u } from "./webpush.js";

const NOTION_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const ST = { next: "⏭ NEXT", doing: "▶️ DOING", wait: "⏳ WAITING", inbox: "📥 INBOX", done: "✅ DONE" };
const OPEN = [ST.next, ST.doing, ST.inbox, ST.wait];
const CATS = ["日用品", "消耗品", "食品", "育児", "サプリ", "美容"];
const FREQS = ["毎日", "毎週", "毎月"];
const PER_DAYS = { 毎日: 1, 毎週: 7, 毎月: 30 };
const WAKU_HOME = "🏠 家・外";
const WAKU_NET = "☼ 朝";
const ITEM_MAX = 200;
const ADD_MAX = 50; // 1回で足せる品目
const LIST_MAX = 20; // 本文まで読むリストの数（無料プランの Worker は1回の通信が50件まで）
const CLEAR_MAX = 40;
const NAME_MAX = 100;
const MAX_QUERY_PAGES = 3;
const PUSH_HOSTS = /(^|\.)push\.apple\.com$|^fcm\.googleapis\.com$|^android\.googleapis\.com$|(^|\.)push\.services\.mozilla\.com$|(^|\.)notify\.windows\.com$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      checkConfig(env);
      if (!authorized(request, env)) return json({ error: "合言葉が違います" }, 401);
      const notion = notionClient(env);
      const p = url.pathname;
      const m = request.method;
      const list = p.match(/^\/api\/lists\/([0-9a-f-]{32,36})\/(items|clear|done)$/i);
      const item = p.match(/^\/api\/items\/([0-9a-f-]{32,36})$/i);
      const stock = p.match(/^\/api\/stock\/([0-9a-f-]{32,36})\/(refill|restocked)$/i);

      if (p === "/api/state" && m === "GET") return json(await loadState(notion, env));
      if (p === "/api/lists" && m === "POST") return json(await createList(notion, env, await readJson(request)));
      if (list?.[2] === "items" && m === "POST") return json(await addItems(notion, env, list[1], await readJson(request)));
      if (list?.[2] === "clear" && m === "POST") return json(await clearChecked(notion, env, list[1]));
      if (list?.[2] === "done" && m === "POST") return json(await finishList(notion, env, list[1]));
      if (item && m === "PATCH") return json(await updateItem(notion, env, item[1], await readJson(request)));
      if (item && m === "DELETE") return json(await removeItem(notion, env, item[1]));
      if (p === "/api/stock" && m === "POST") return json(await addStock(notion, env, await readJson(request)));
      if (stock?.[2] === "refill" && m === "POST") return json(await refill(notion, env, stock[1]));
      if (stock?.[2] === "restocked" && m === "POST") return json(await restocked(notion, env, stock[1]));
      if (p === "/api/push" && m === "GET") return json(pushReady(env) ? { publicKey: (await vapidOf(env)).publicKey, ready: true } : { publicKey: "", ready: false });
      if (p === "/api/push/status" && m === "POST") return json(await pushStatus(env, await readJson(request)));
      if (p === "/api/push" && m === "PUT") return json(await pushSubscribe(env, await readJson(request)));
      if (p === "/api/push" && m === "DELETE") return json(await pushUnsubscribe(env, await readJson(request)));
      if (p === "/api/push/test" && m === "POST") return json(await pushTest(notion, env, await readJson(request)));
      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: err.publicMessage || "サーバーでエラーが起きました" }, err.status || 500);
    }
  },

  // 毎時0分に動き、通知の時刻を選んだ端末にだけ在庫アラートを送る
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runAlerts(env, controller.scheduledTime || Date.now()));
  },
};

function checkConfig(env) {
  if (!env.NOTION_TOKEN || !env.APP_KEY || env.APP_KEY.length < 16 || !env.TASK_DS_ID || !env.DAILY_DS_ID) {
    throw httpError(500, "Worker の設定（NOTION_TOKEN / APP_KEY / TASK_DS_ID / DAILY_DS_ID）が足りません");
  }
}

function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  return constantTimeEqual(given, env.APP_KEY);
}

function constantTimeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) diff |= (x[i] ?? 0) ^ y[i];
  return diff === 0;
}

function notionClient(env) {
  const base = env.NOTION_API_BASE || NOTION_BASE;
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const hint =
        data.code === "object_not_found"
          ? "Notion で DB_タスク管理 か DB_Daily にインテグレーションが接続されていません（README の手順1）"
          : data.code === "unauthorized"
            ? "Notion のトークンが正しくありません"
            : data.code === "restricted_resource"
              ? "インテグレーションの機能（読み取り・更新・挿入）が足りません"
              : data.code === "rate_limited"
                ? "Notion が混み合っています。少し待ってください"
                : `Notion エラー（${data.code || res.status}）`;
      throw Object.assign(httpError(res.status === 429 ? 429 : 502, hint), { code: data.code });
    }
    return data;
  };
}

// ---------- Notion のページを読む ----------
const plain = (rich) => (rich || []).map((t) => t.plain_text ?? t.text?.content ?? "").join("");

function propText(prop) {
  if (!prop) return "";
  switch (prop.type) {
    case "title": return plain(prop.title);
    case "rich_text": return plain(prop.rich_text);
    case "select": return prop.select?.name || "";
    case "status": return prop.status?.name || "";
    case "url": return prop.url || "";
    default: return "";
  }
}
const dateOf = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const propDate = (prop) => dateOf(prop?.date?.start);
const propNum = (prop) => (typeof prop?.number === "number" ? prop.number : 0);
const relIds = (prop) => (prop?.relation || []).map((r) => normalizeId(r.id));
function formulaDate(prop) {
  const f = prop?.formula;
  return f?.type === "date" ? dateOf(f.date?.start) : f?.type === "string" ? dateOf(f.string) : null;
}
function rollupDate(prop) {
  const r = prop?.rollup;
  if (!r) return null;
  if (r.type === "date") return dateOf(r.date?.start);
  if (r.type === "array") return r.array.map((x) => dateOf(x.date?.start) || formulaDate(x)).filter(Boolean).sort().at(-1) || null;
  return null;
}

function taskOf(page) {
  const p = page.properties || {};
  return {
    id: normalizeId(page.id),
    url: page.url,
    name: propText(p["名前"]) || "（無題）",
    status: propText(p["ステータス"]),
    tag: propText(p["分類タグ"]),
    next: propText(p.NEXT),
    link: propText(p.URL),
    date: propDate(p["実行日"]),
    refill: relIds(p["補充対象"]),
    edited: page.last_edited_time || null,
  };
}

// 在庫（DB_Daily）の1行。切れる予定日は Notion の計算式が読めればそれ、読めなければ同じ考え方で計算する
function stockOf(page, today, restockedOn) {
  const p = page.properties || {};
  const x = {
    id: normalizeId(page.id),
    url: page.url,
    name: propText(p["名前"]) || "（無題）",
    cat: propText(p["カテゴリ"]),
    memo: propText(p["メモ"]),
    link: propText(p.URL),
    use: propNum(p["使う数"]),
    freq: propText(p["使う頻度"]),
    size: propNum(p["内容量"]),
    bought: propDate(p["購入日（手入力）"]),
    rollup: rollupDate(p["最終補充日"]),
  };
  const formulaEnd = formulaDate(p["切れる予定日"]);
  const base = [x.bought, x.rollup, restockedOn].filter(Boolean).sort().at(-1) || null;
  const perDay = x.use && PER_DAYS[x.freq] ? x.use / PER_DAYS[x.freq] : 0;
  x.days = perDay && x.size ? Math.floor(x.size / perDay) : null;
  x.base = base;
  const fresher = restockedOn && (!x.rollup || restockedOn > x.rollup); // 補充した直後は計算式がまだ古い
  x.end = formulaEnd && !fresher ? formulaEnd : base && x.days != null ? addDays(base, x.days) : null;
  x.left = x.end ? diffDays(today, x.end) : null;
  return x;
}

function itemsOf(blocks) {
  const items = [];
  let group = "";
  for (const b of blocks) {
    if (/^heading_[123]$/.test(b.type)) group = plain(b[b.type]?.rich_text).trim();
    else if (b.type === "to_do") items.push({ id: normalizeId(b.id), text: plain(b.to_do?.rich_text).trim() || "（空）", checked: !!b.to_do?.checked, group });
  }
  return items;
}

async function queryAll(notion, dataSourceId, body) {
  const out = [];
  let cursor;
  for (let i = 0; i < MAX_QUERY_PAGES; i++) {
    const res = await notion("POST", `/data_sources/${dataSourceId}/query`, { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...(res.results || []));
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return out;
}

const openFilter = { or: OPEN.map((s) => ({ property: "ステータス", status: { equals: s } })) };
const recent = [{ timestamp: "last_edited_time", direction: "descending" }];

async function loadState(notion, env) {
  const today = todayJst();
  const [tasks, stockPages] = await Promise.all([
    queryAll(notion, env.TASK_DS_ID, {
      filter: { and: [openFilter, { or: [{ property: "分類タグ", select: { equals: "BUY" } }, { property: "補充対象", relation: { is_not_empty: true } }] }] },
      sorts: recent,
    }),
    queryAll(notion, env.DAILY_DS_ID, {}),
  ]);
  const lists = tasks.map(taskOf);
  // チェックリストとして使うのは補充タスク以外。本文の ToDo を読む
  const bodies = lists.filter((t) => !t.refill.length).slice(0, LIST_MAX);
  await Promise.all(bodies.map(async (t) => {
    const res = await notion("GET", `/blocks/${t.id}/children?page_size=100`);
    t.items = itemsOf(res.results || []);
    t.more = !!res.has_more;
  }));
  const stock = stockPages.map((pg) => stockOf(pg, today));
  for (const x of stock) x.open = lists.filter((t) => t.refill.includes(x.id)).map((t) => t.id);
  return { lists, stock, today, loadedAt: new Date().toISOString() };
}

// ---------- 書き込みの前の確かめ ----------
async function listPage(notion, env, id) {
  const page = await notion("GET", `/pages/${normalizeId(id)}`);
  if (normalizeId(page.parent?.data_source_id) !== normalizeId(env.TASK_DS_ID)) throw httpError(403, "DB_タスク管理 の行ではありません");
  const t = taskOf(page);
  if (t.tag !== "BUY" && !t.refill.length) throw httpError(403, "買い物のタスク（分類タグ BUY）ではありません");
  return t;
}
async function itemBlock(notion, env, id) {
  const block = await notion("GET", `/blocks/${normalizeId(id)}`);
  if (block.type !== "to_do" || block.parent?.type !== "page_id") throw httpError(403, "買い物リストの品目ではありません");
  await listPage(notion, env, block.parent.page_id);
  return block;
}
async function stockPage(notion, env, id) {
  const page = await notion("GET", `/pages/${normalizeId(id)}`);
  if (normalizeId(page.parent?.data_source_id) !== normalizeId(env.DAILY_DS_ID)) throw httpError(403, "DB_Daily の行ではありません");
  return page;
}

function clean(v, max, label) {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  if (t.length > max) throw httpError(400, `${label}は${max}文字までです`);
  return t;
}
const rich = (s) => [{ type: "text", text: { content: s } }];
const todo = (s) => ({ object: "block", type: "to_do", to_do: { rich_text: rich(s), checked: false } });

// タスクを作る。プレイヤーの関連に届かない（DB_プレイヤーが未接続）ときは、関連なしで作り直す
async function createTask(notion, env, properties) {
  const base = { "ステータス": { status: { name: ST.next } }, "重さ": { select: { name: "S" } }, ...properties };
  const body = (props) => ({ parent: { type: "data_source_id", data_source_id: env.TASK_DS_ID }, properties: props });
  if (env.PLAYER_ID) {
    try {
      return await notion("POST", "/pages", body({ ...base, "プレイヤー": { relation: [{ id: env.PLAYER_ID }] } }));
    } catch (err) {
      if (!["validation_error", "object_not_found"].includes(err.code)) throw err;
    }
  }
  return notion("POST", "/pages", body(base));
}

// ---------- 買い物リスト ----------
async function createList(notion, env, body) {
  const name = clean(body?.name, NAME_MAX, "リストの名前") || "買い物リスト";
  const texts = itemTexts(body?.items ?? []);
  const page = await createTask(notion, env, {
    "名前": { title: rich(name) },
    "分類タグ": { select: { name: "BUY" } },
    "枠": { select: { name: WAKU_HOME } },
  });
  const t = taskOf(page);
  t.items = [];
  if (texts.length) t.items = await appendItems(notion, t.id, texts);
  return { list: t };
}

function itemTexts(raw) {
  const arr = (Array.isArray(raw) ? raw : [raw]).map((s) => clean(s, ITEM_MAX, "品目")).filter(Boolean);
  if (arr.length > ADD_MAX) throw httpError(400, `一度に足せるのは${ADD_MAX}品までです`);
  return arr;
}
async function appendItems(notion, pageId, texts) {
  const res = await notion("PATCH", `/blocks/${pageId}/children`, { children: texts.map(todo) });
  return itemsOf((res.results || []).filter((b) => b.type === "to_do"));
}

async function addItems(notion, env, id, body) {
  const texts = itemTexts(body?.items);
  if (!texts.length) throw httpError(400, "買うものを入れてください");
  const t = await listPage(notion, env, id);
  if (t.refill.length) throw httpError(403, "補充タスクには品目を足せません");
  return { items: await appendItems(notion, t.id, texts) };
}

async function updateItem(notion, env, id, body) {
  const block = await itemBlock(notion, env, id);
  const patch = {};
  if (typeof body?.checked === "boolean") patch.checked = body.checked;
  if (body?.text !== undefined) {
    const s = clean(body.text, ITEM_MAX, "品目");
    if (!s) throw httpError(400, "品目が空です");
    patch.rich_text = rich(s);
  }
  if (!Object.keys(patch).length) throw httpError(400, "変える内容がありません");
  const res = await notion("PATCH", `/blocks/${normalizeId(block.id)}`, { to_do: patch });
  return { item: itemsOf([res])[0] };
}

async function removeItem(notion, env, id) {
  const block = await itemBlock(notion, env, id);
  await notion("DELETE", `/blocks/${normalizeId(block.id)}`);
  return { removed: [normalizeId(block.id)] };
}

async function clearChecked(notion, env, id) {
  const t = await listPage(notion, env, id);
  const res = await notion("GET", `/blocks/${t.id}/children?page_size=100`);
  const done = (res.results || []).filter((b) => b.type === "to_do" && b.to_do?.checked).slice(0, CLEAR_MAX);
  for (const b of done) await notion("DELETE", `/blocks/${normalizeId(b.id)}`);
  return { removed: done.map((b) => normalizeId(b.id)) };
}

async function finishList(notion, env, id) {
  const t = await listPage(notion, env, id);
  await notion("PATCH", `/pages/${t.id}`, { properties: { "ステータス": { status: { name: ST.done } } } });
  return { done: t.id };
}

// ---------- 在庫・補充 ----------
async function openRefills(notion, env, stockId) {
  const pages = await queryAll(notion, env.TASK_DS_ID, { filter: { and: [openFilter, { property: "補充対象", relation: { contains: stockId } }] } });
  return pages.map(taskOf);
}

// DB_Daily の「補充」ボタンと同じ形の補充タスクを作る（補充対象でつなぐと、済みにした日が最終補充日になる）
async function refill(notion, env, id) {
  const page = await stockPage(notion, env, id);
  const x = stockOf(page, todayJst());
  const open = await openRefills(notion, env, x.id);
  if (open.length) return { task: open[0], existed: true };
  const created = await createTask(notion, env, {
    "名前": { title: rich(`補充:${x.name}`) },
    "分類タグ": { select: { name: "BUY" } },
    "NEXT": { rich_text: rich(x.link ? "リンクから注文する" : "買う") },
    "枠": { select: { name: x.link ? WAKU_NET : WAKU_HOME } },
    "補充対象": { relation: [{ id: x.id }] },
    ...(x.link ? { "URL": { url: x.link } } : {}),
  });
  return { task: taskOf(created), existed: false };
}

// 補充した：開いている補充タスクを済みにする（なければ済みの補充タスクを1つ作って、最終補充日を今日にする）
async function restocked(notion, env, id) {
  const page = await stockPage(notion, env, id);
  const today = todayJst();
  const x = stockOf(page, today);
  let open = await openRefills(notion, env, x.id);
  if (!open.length) open = [(await refill(notion, env, x.id)).task];
  for (const t of open) await notion("PATCH", `/pages/${t.id}`, { properties: { "ステータス": { status: { name: ST.done } } } });
  const after = stockOf(page, today, today);
  after.open = [];
  return { stock: after, done: open.map((t) => t.id) };
}

async function addStock(notion, env, body) {
  const name = clean(body?.name, NAME_MAX, "名前");
  if (!name) throw httpError(400, "名前を入れてください");
  const cat = CATS.includes(body?.cat) ? body.cat : null;
  const freq = FREQS.includes(body?.freq) ? body.freq : null;
  const num = (v, label) => {
    if (v === "" || v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) throw httpError(400, `${label}の数が正しくありません`);
    return n;
  };
  const use = num(body?.use, "使う数");
  const size = num(body?.size, "内容量");
  const link = String(body?.link || "").trim();
  if (link && !/^https:\/\/\S{1,1900}$/.test(link)) throw httpError(400, "URL は https:// で始めてください");
  const bought = dateOf(body?.bought) || todayJst();
  const props = {
    "名前": { title: rich(name) },
    "購入日（手入力）": { date: { start: bought } },
    ...(cat ? { "カテゴリ": { select: { name: cat } } } : {}),
    ...(freq ? { "使う頻度": { select: { name: freq } } } : {}),
    ...(use != null ? { "使う数": { number: use } } : {}),
    ...(size != null ? { "内容量": { number: size } } : {}),
    ...(link ? { "URL": { url: link } } : {}),
  };
  const page = await notion("POST", "/pages", { parent: { type: "data_source_id", data_source_id: env.DAILY_DS_ID }, properties: props });
  const x = stockOf(page, todayJst());
  x.open = [];
  return { stock: x };
}

// ---------- アラート ----------
export function alertOf(state, { days = 3, list = false } = {}) {
  const soon = state.stock
    .filter((x) => x.left != null && x.left <= days && !x.open?.length)
    .sort((a, b) => a.left - b.left);
  const left = state.lists.flatMap((t) => (t.items ? t.items.filter((i) => !i.checked).map((i) => i.text) : t.refill.length ? [t.name.replace(/^補充:/, "")] : []));
  const lines = [];
  if (soon.length) {
    const head = soon.slice(0, 3).map((x) => `${x.name}（${leftText(x.left)}）`).join("・");
    lines.push(`切れそう：${head}${soon.length > 3 ? ` ほか${soon.length - 3}品` : ""}`);
  }
  if (list && left.length) lines.push(`リストに${left.length}品：${left.slice(0, 4).join("・")}${left.length > 4 ? "…" : ""}`);
  if (!lines.length) return null;
  const title = soon.length ? `在庫がそろそろ切れます（${soon.length}品）` : `買い物リストに${left.length}品`;
  return { title, body: lines.join("\n"), tag: "kaimono-alert", url: soon.length ? "./?tab=stock" : "./?tab=list", badge: soon.length + (list ? left.length : 0) };
}
const leftText = (n) => (n < 0 ? `切れて${-n}日` : n === 0 ? "今日切れる" : `あと${n}日`);

function pushReady(env) {
  return !!(env.SUBS && env.VAPID_SUBJECT);
}
function needPush(env) {
  if (!pushReady(env)) throw httpError(500, "通知の設定（SUBS の KV・VAPID_SUBJECT）が Worker にありません");
}
// 通知の鍵（VAPID）は、はじめて使うときに Worker が作って KV にしまう（人が秘密鍵を持ち運ばなくてよい）
async function vapidOf(env) {
  let keys = await env.SUBS.get("vapid", "json");
  if (!keys) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    keys = { publicKey: b64u.encode(await crypto.subtle.exportKey("raw", pair.publicKey)), privateKey: (await crypto.subtle.exportKey("jwk", pair.privateKey)).d };
    await env.SUBS.put("vapid", JSON.stringify(keys));
  }
  return { ...keys, subject: env.VAPID_SUBJECT };
}

function checkEndpoint(endpoint) {
  let u;
  try { u = new URL(String(endpoint || "")); } catch { throw httpError(400, "通知の宛先が正しくありません"); }
  if (u.protocol !== "https:" || !PUSH_HOSTS.test(u.hostname)) throw httpError(400, "対応していない通知サービスです");
  return u.href;
}
async function subKey(endpoint) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
  return `sub:${[...h].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
const clampInt = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);

async function pushStatus(env, body) {
  needPush(env);
  const rec = await env.SUBS.get(await subKey(checkEndpoint(body?.endpoint)), "json");
  return rec ? { subscribed: true, hour: rec.hour, days: rec.days, list: rec.list } : { subscribed: false };
}

async function pushSubscribe(env, body) {
  needPush(env);
  const s = body?.subscription || {};
  const endpoint = checkEndpoint(s.endpoint);
  const keys = { p256dh: String(s.keys?.p256dh || ""), auth: String(s.keys?.auth || "") };
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(keys.auth)) throw httpError(400, "通知の鍵が正しくありません");
  const key = await subKey(endpoint);
  const prev = await env.SUBS.get(key, "json");
  const rec = {
    subscription: { endpoint, keys },
    hour: clampInt(body?.hour, 0, 23, 8),
    days: clampInt(body?.days, 0, 14, 3),
    list: !!body?.list,
    lastSent: prev?.lastSent || "",
  };
  await env.SUBS.put(key, JSON.stringify(rec));
  return { subscribed: true, hour: rec.hour, days: rec.days, list: rec.list };
}

async function pushUnsubscribe(env, body) {
  needPush(env);
  await env.SUBS.delete(await subKey(checkEndpoint(body?.endpoint)));
  return { subscribed: false };
}

async function pushTest(notion, env, body) {
  needPush(env);
  const key = await subKey(checkEndpoint(body?.endpoint));
  const rec = await env.SUBS.get(key, "json");
  if (!rec) throw httpError(404, "この端末は通知に登録されていません");
  const state = await loadState(notion, env);
  const msg = alertOf(state, rec) || { title: "かいもの", body: "今は切れそうな在庫はありません（テスト通知）", tag: "kaimono-test", url: "./", badge: 0 };
  const status = await sendPush(rec.subscription, msg, await vapidOf(env));
  if (status === 404 || status === 410) {
    await env.SUBS.delete(key);
    throw httpError(410, "通知の登録が切れていました。もう一度オンにしてください");
  }
  if (status >= 400) throw httpError(502, `通知サービスに断られました（${status}）`);
  return { sent: true, title: msg.title };
}

export async function runAlerts(env, at) {
  if (!pushReady(env) || !env.NOTION_TOKEN || !env.TASK_DS_ID || !env.DAILY_DS_ID) return { sent: 0 };
  const jst = new Date(at + 9 * 3600e3);
  const hour = jst.getUTCHours();
  const today = jst.toISOString().slice(0, 10);
  const due = [];
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix: "sub:", cursor });
    for (const k of page.keys) {
      const rec = await env.SUBS.get(k.name, "json");
      if (rec && rec.hour === hour && rec.lastSent !== today) due.push([k.name, rec]);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  if (!due.length) return { sent: 0 };
  const state = await loadState(notionClient(env), env);
  const vapid = await vapidOf(env);
  let sent = 0;
  for (const [key, rec] of due) {
    const msg = alertOf(state, rec);
    if (!msg) continue;
    try {
      const status = await sendPush(rec.subscription, msg, vapid);
      if (status === 404 || status === 410) { await env.SUBS.delete(key); continue; }
      if (status < 400) { sent++; await env.SUBS.put(key, JSON.stringify({ ...rec, lastSent: today })); }
    } catch { /* 1台に送れなくても、ほかの端末には送る */ }
  }
  return { sent };
}

// ---------- 小物 ----------
function todayJst() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}
function addDays(d, n) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function diffDays(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
}

function normalizeId(id) {
  return (id || "").replace(/-/g, "").toLowerCase();
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError(400, "リクエストの形式が正しくありません");
  }
}

function httpError(status, publicMessage) {
  return Object.assign(new Error(publicMessage), { status, publicMessage });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
