// かいもの：画面の配信と Notion API の中継・在庫アラートの通知（Cloudflare Worker）
// Notion のトークンはこの Worker の secret にだけ置き、ブラウザには渡さない。
// 書き換えるのは DB_タスク管理 の買い物タスク（分類タグ BUY か 補充対象つき）とその本文の ToDo、DB_Daily への行の追加だけ。
import Anthropic from "@anthropic-ai/sdk";
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
const ADD_MAX = 40; // 1回で足せる品目（品ごとに子タスクを作るので、無料プランの1回50通信に収める）
const CHILD_DAYS = 60; // 子タスク（買い物の品）を読む期間
const LIST_MAX = 20; // 本文まで読むリストの数（無料プランの Worker は1回の通信が50件まで）
const CLEAR_MAX = 40;
const NAME_MAX = 100;
const MAX_QUERY_PAGES = 3;
const NEST_MAX = 12; // 入れ子の ToDo（「スーパー」の下の品目など）を読む親の数
// 買い物の時刻の何分前に知らせるか。タスクごとに選べる（KV の remcfg:<タスク> に保存。決めていないタスクは 30分前とちょうど）
const REMIND_CHOICES = [0, 10, 30, 60, 180, 1440];
const REMIND_DEFAULT = [30, 0];
const TICK_MIN = 5; // cron の間隔（分）
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
      const list = p.match(/^\/api\/lists\/([0-9a-f-]{32,36})\/(items|clear|done|when|remind|cancel)$/i);
      const item = p.match(/^\/api\/items\/([0-9a-f-]{32,36})$/i);
      const sub = p.match(/^\/api\/subtasks\/([0-9a-f-]{32,36})$/i);
      const stock = p.match(/^\/api\/stock\/([0-9a-f-]{32,36})(?:\/(refill|restocked))?$/i);
      const jan = p.match(/^\/api\/jan\/(\d{8}|\d{12,13})$/);

      if (p === "/api/state" && m === "GET") return json(await loadState(notion, env));
      if (p === "/api/lists" && m === "POST") return json(await createList(notion, env, await readJson(request)));
      if (list?.[2] === "items" && m === "POST") return json(await addItems(notion, env, list[1], await readJson(request)));
      if (list?.[2] === "clear" && m === "POST") return json(await clearChecked(notion, env, list[1]));
      if (list?.[2] === "done" && m === "POST") return json(await finishList(notion, env, list[1]));
      if (list?.[2] === "cancel" && m === "POST") return json(await cancelRefill(notion, env, list[1]));
      if (p === "/api/sites" && m === "POST") return json(await addSite(env, await readJson(request)));
      if (p === "/api/sites" && m === "DELETE") return json(await removeSite(env, await readJson(request)));
      if (list?.[2] === "when" && m === "PATCH") return json(await setWhen(notion, env, list[1], await readJson(request)));
      if (list?.[2] === "remind" && m === "PUT") return json(await setRemind(notion, env, list[1], await readJson(request)));
      if (p === "/api/templates" && m === "POST") return json(await addTemplate(notion, env, await readJson(request)));
      if (item && m === "PATCH") return json(await updateItem(notion, env, item[1], await readJson(request)));
      if (item && m === "DELETE") return json(await removeItem(notion, env, item[1]));
      if (sub && m === "PATCH") return json(await updateSubtask(notion, env, sub[1], await readJson(request)));
      if (sub && m === "DELETE") return json(await removeSubtask(notion, env, sub[1]));
      if (p === "/api/stock" && m === "POST") return json(await addStock(notion, env, await readJson(request)));
      if (stock?.[2] === "refill" && m === "POST") return json(await refill(notion, env, stock[1]));
      if (stock?.[2] === "restocked" && m === "POST") return json(await restocked(notion, env, stock[1]));
      if (stock && !stock[2] && m === "PATCH") return json(await editStock(notion, env, stock[1], await readJson(request)));
      if (stock && !stock[2] && m === "DELETE") return json(await trashStock(notion, env, stock[1]));
      if (p === "/api/lookup" && m === "POST") return json(await lookupPage((await readJson(request))?.url));
      if (jan && m === "GET") return json(await lookupJan(env, jan[1]));
      if (p === "/api/identify" && m === "POST") return json(await identify(env, await readJson(request)));
      if (p === "/api/search" && m === "GET") return json(await searchItems(env, url.searchParams.get("q")));
      if (p === "/api/suggest" && m === "GET") return json(await suggestWords(url.searchParams.get("q")));
      if (p === "/api/stores" && m === "POST") return json(await addStore(env, await readJson(request)));
      if (p === "/api/stores" && m === "DELETE") return json(await removeStore(env, await readJson(request)));
      if (p === "/api/prices" && m === "GET") return json(await loadPrices(notion, env));
      if (p === "/api/prices" && m === "POST") return json(await addPrices(notion, env, await readJson(request)));
      const price = p.match(/^\/api\/prices\/([0-9a-f-]{32,36})$/i);
      if (price && m === "DELETE") return json(await removePrice(notion, env, price[1]));
      if (p === "/api/receipts/read" && m === "POST") return json(await readReceipt(env, await readJson(request)));
      if (p === "/api/receipts" && m === "POST") return json(await saveReceipt(notion, env, await readJson(request)));
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

  // 15分ごとに動く。買い物の時刻（30分前・ちょうど）のリマインドと、毎時0分台に在庫アラート（時刻を選んだ端末だけ）
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

function imageOf(prop) {
  for (const f of prop?.files || []) {
    const src = f.type === "external" ? f.external?.url : f.file?.url;
    if (/^https:\/\//.test(src || "")) return src;
  }
  return "";
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
    at: /T\d\d:\d\d/.test(p["実行日"]?.date?.start || "") ? p["実行日"].date.start : null, // 時刻つきの実行日＝買い物の時刻
    refill: relIds(p["補充対象"]),
    parent: relIds(p["親タスク"]),
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
    jan: propText(p.JAN),
    image: imageOf(p["画像"]),
    store: propText(p["店"]),
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

// 本文の ToDo を品目にする。子を持つ ToDo（「スーパー」の下に品目を書く形）は見出しとして扱い、子を品目にする
function itemsOf(blocks, kids = {}) {
  const items = [];
  let group = "";
  for (const b of blocks) {
    if (/^heading_[123]$/.test(b.type)) group = plain(b[b.type]?.rich_text).trim();
    else if (b.type === "to_do" && kids[normalizeId(b.id)]) {
      const g = plain(b.to_do?.rich_text).trim();
      for (const c of kids[normalizeId(b.id)]) if (c.type === "to_do") items.push(itemOf(c, g));
    } else if (b.type === "to_do") items.push(itemOf(b, group));
  }
  return items;
}
const itemOf = (b, group) => ({ id: normalizeId(b.id), text: plain(b.to_do?.rich_text).trim() || "（空）", checked: !!b.to_do?.checked, group });

// 買い物の品（子タスク）。済んだ品もかごに入れた印として出すので、最近作ったものを状態を問わず読む
async function childTasks(notion, env, parentId) {
  const since = new Date(Date.now() - CHILD_DAYS * 864e5).toISOString().slice(0, 10);
  const pages = await queryAll(notion, env.TASK_DS_ID, {
    filter: { and: [parentId ? { property: "親タスク", relation: { contains: parentId } } : { property: "親タスク", relation: { is_not_empty: true } }, { timestamp: "created_time", created_time: { on_or_after: since } }] },
    sorts: [{ timestamp: "created_time", direction: "ascending" }],
  });
  return pages.map(taskOf);
}
const subItemOf = (k) => ({ id: k.id, text: k.name, checked: k.status === ST.done, group: "", kind: "task" });

async function readItems(notion, t, budget) {
  const res = await notion("GET", `/blocks/${t.id}/children?page_size=100`);
  const blocks = res.results || [];
  const kids = {};
  for (const b of blocks.filter((x) => x.type === "to_do" && x.has_children)) {
    if (budget.n-- <= 0) break;
    kids[normalizeId(b.id)] = (await notion("GET", `/blocks/${normalizeId(b.id)}/children?page_size=100`)).results || [];
  }
  t.items = itemsOf(blocks, kids);
  t.more = !!res.has_more;
}

function templateOf(page) {
  const p = page.properties || {};
  return {
    id: normalizeId(page.id),
    url: page.url,
    name: propText(p["名前"]),
    store: propText(p["店"]) || "その他",
    aisle: propText(p["売り場"]),
    qty: propNum(p["いつもの数"]) || 1,
    unit: propText(p["単位"]),
    order: typeof p["並び"]?.number === "number" ? p["並び"].number : 999,
    memo: propText(p["メモ"]),
  };
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
  const [tasks, stockPages, templates] = await Promise.all([
    queryAll(notion, env.TASK_DS_ID, {
      filter: { and: [openFilter, { property: "親タスク", relation: { is_empty: true } }, { or: [{ property: "分類タグ", select: { equals: "BUY" } }, { property: "補充対象", relation: { is_not_empty: true } }] }] },
      sorts: recent,
    }),
    queryAll(notion, env.DAILY_DS_ID, {}),
    // テンプレートは読めなくても（DB が未接続でも）ほかの画面は出す
    env.TEMPLATE_DS_ID
      ? queryAll(notion, env.TEMPLATE_DS_ID, { filter: { property: "使う", checkbox: { equals: true } } }).then((r) => ({ ok: r }), (err) => ({ err: err.publicMessage || "読めませんでした" }))
      : { err: "TEMPLATE_DS_ID が設定されていません" },
  ]);
  const lists = tasks.map(taskOf);
  // チェックリストとして使うのは補充タスク以外。本文の ToDo を読む
  const bodies = lists.filter((t) => !t.refill.length).slice(0, LIST_MAX);
  const budget = { n: NEST_MAX };
  const [, kids] = await Promise.all([Promise.all(bodies.map((t) => readItems(notion, t, budget))), childTasks(notion, env)]);
  // 品ごとの子タスクを、本文の ToDo の後ろに並べる
  for (const t of lists.filter((x) => !x.refill.length)) {
    const mine = kids.filter((k) => k.parent.includes(t.id)).map(subItemOf);
    if (mine.length) t.items = [...(t.items || []), ...mine];
  }
  const stock = stockPages.map((pg) => stockOf(pg, today));
  for (const x of stock) x.open = lists.filter((t) => t.refill.includes(x.id)).map((t) => t.id);
  return {
    lists, stock, today, loadedAt: new Date().toISOString(),
    templates: (templates.ok || []).map(templateOf).filter((x) => x.name),
    sites: await siteList(env),
    stores: await storeList(env, [...(templates.ok || []).map((pg) => propText(pg.properties?.["店"])), ...stockPages.map((pg) => propText(pg.properties?.["店"]))]),
    templateErr: templates.err || "",
    reminders: await remindMap(env, lists.map((t) => t.id)),
  };
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
  if (block.type !== "to_do") throw httpError(403, "買い物リストの品目ではありません");
  let pageId = block.parent?.type === "page_id" ? block.parent.page_id : null;
  if (block.parent?.type === "block_id") {
    // 1段の入れ子まで（「スーパー」の ToDo の下の品目）
    const up = await notion("GET", `/blocks/${normalizeId(block.parent.block_id)}`);
    if (up.type === "to_do" && up.parent?.type === "page_id") pageId = up.parent.page_id;
  }
  if (!pageId) throw httpError(403, "買い物リストの品目ではありません");
  await listPage(notion, env, pageId);
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
  const at = whenOf(body?.at);
  const page = await createTask(notion, env, {
    "名前": { title: rich(name) },
    "分類タグ": { select: { name: "BUY" } },
    "枠": { select: { name: WAKU_HOME } },
    ...(at ? { "実行日": { date: { start: at } } } : {}),
  });
  const t = taskOf(page);
  t.items = texts.length ? await createSubtasks(notion, env, t.id, texts) : [];
  return { list: t };
}

// 品を1つずつ DB_タスク管理 の子タスクにする（プレイヤーなし＝EXP なし、親タスクでつなぐ）。3件ずつ並べて作り、順番は入れたとおり
async function createSubtasks(notion, env, parentId, texts) {
  const out = new Array(texts.length);
  let next = 0;
  const worker = async () => {
    for (let k; (k = next++) < texts.length;) {
      const page = await notion("POST", "/pages", {
        parent: { type: "data_source_id", data_source_id: env.TASK_DS_ID },
        properties: {
          "名前": { title: rich(texts[k]) },
          "ステータス": { status: { name: ST.next } },
          "分類タグ": { select: { name: "BUY" } },
          "重さ": { select: { name: "S" } },
          "枠": { select: { name: WAKU_HOME } },
          "親タスク": { relation: [{ id: parentId }] },
        },
      });
      out[k] = subItemOf(taskOf(page));
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}

async function subtaskPage(notion, env, id) {
  const page = await notion("GET", `/pages/${normalizeId(id)}`);
  if (normalizeId(page.parent?.data_source_id) !== normalizeId(env.TASK_DS_ID)) throw httpError(403, "DB_タスク管理 の行ではありません");
  const k = taskOf(page);
  if (!k.parent.length) throw httpError(403, "買い物の品（子タスク）ではありません");
  await listPage(notion, env, k.parent[0]);
  return k;
}
async function updateSubtask(notion, env, id, body) {
  const k = await subtaskPage(notion, env, id);
  const props = {};
  if (typeof body?.checked === "boolean") props["ステータス"] = { status: { name: body.checked ? ST.done : ST.next } };
  if (body?.text !== undefined) {
    const s = clean(body.text, ITEM_MAX, "品目");
    if (!s) throw httpError(400, "品目が空です");
    props["名前"] = { title: rich(s) };
  }
  if (!Object.keys(props).length) throw httpError(400, "変える内容がありません");
  const page = await notion("PATCH", `/pages/${k.id}`, { properties: props });
  return { item: subItemOf(taskOf(page)) };
}
async function removeSubtask(notion, env, id) {
  const k = await subtaskPage(notion, env, id);
  await notion("PATCH", `/pages/${k.id}`, { in_trash: true });
  return { removed: [k.id] };
}

function itemTexts(raw) {
  const arr = (Array.isArray(raw) ? raw : [raw]).map((s) => clean(s, ITEM_MAX, "品目")).filter(Boolean);
  if (arr.length > ADD_MAX) throw httpError(400, `一度に足せるのは${ADD_MAX}品までです`);
  return arr;
}

async function addItems(notion, env, id, body) {
  const texts = itemTexts(body?.items);
  if (!texts.length) throw httpError(400, "買うものを入れてください");
  const t = await listPage(notion, env, id);
  if (t.refill.length) throw httpError(403, "補充タスクには品目を足せません");
  if (t.parent.length) throw httpError(403, "買い物の品には品目を足せません");
  return { items: await createSubtasks(notion, env, t.id, texts) };
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

// 買い物の時刻（日本時間・15分きざみに丸めない。null で外す）
function whenOf(v) {
  if (v == null || v === "") return null;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?\+09:00$/.test(s) || Number.isNaN(Date.parse(s))) throw httpError(400, "時刻の形が正しくありません");
  return s.slice(0, 16) + ":00+09:00";
}
// タスクごとの知らせ方（何分前に知らせるか）。決めていないタスクは返さない（画面は既定の 30分前・ちょうど を出す）
async function remindMap(env, ids) {
  if (!env.SUBS) return {};
  const out = {};
  await Promise.all(ids.map(async (id) => { const v = await env.SUBS.get(`remcfg:${id}`, "json"); if (v) out[id] = v; }));
  return out;
}
const remindOf = async (env, id) => (env.SUBS && (await env.SUBS.get(`remcfg:${id}`, "json"))) || REMIND_DEFAULT;
async function setRemind(notion, env, id, body) {
  needPush(env);
  const t = await listPage(notion, env, id);
  if (!Array.isArray(body?.before)) throw httpError(400, "知らせる時刻を選んでください");
  const before = [...new Set(body.before.map(Number))].filter((n) => REMIND_CHOICES.includes(n)).sort((a, b) => b - a);
  await env.SUBS.put(`remcfg:${t.id}`, JSON.stringify(before));
  return { before };
}

async function setWhen(notion, env, id, body) {
  const t = await listPage(notion, env, id);
  const at = whenOf(body?.at);
  await notion("PATCH", `/pages/${t.id}`, { properties: { "実行日": { date: at ? { start: at } : null } } });
  return { at };
}

async function addTemplate(notion, env, body) {
  if (!env.TEMPLATE_DS_ID) throw httpError(500, "TEMPLATE_DS_ID が設定されていません");
  const name = clean(body?.name, NAME_MAX, "名前");
  if (!name) throw httpError(400, "名前を入れてください");
  const store = clean(body?.store, 30, "店") || "その他";
  const aisle = clean(body?.aisle, 30, "売り場");
  const qty = Number(body?.qty) > 0 && Number(body.qty) < 1000 ? Number(body.qty) : 1;
  const unit = clean(body?.unit, 10, "単位");
  const page = await notion("POST", "/pages", {
    parent: { type: "data_source_id", data_source_id: env.TEMPLATE_DS_ID },
    properties: {
      "名前": { title: rich(name) },
      "店": { select: { name: store } },
      ...(aisle ? { "売り場": { select: { name: aisle } } } : {}),
      "いつもの数": { number: qty },
      ...(unit ? { "単位": { rich_text: rich(unit) } } : {}),
      "使う": { checkbox: true },
    },
  });
  return { template: templateOf(page) };
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

// 在庫の列を body から組み立てる（edit のときは送られてきた項目だけ）
function stockProps(body, { edit = false } = {}) {
  const has = (k) => !edit || (body && Object.prototype.hasOwnProperty.call(body, k));
  const props = {};
  if (has("name")) {
    const name = clean(body?.name, NAME_MAX, "名前");
    if (!name) throw httpError(400, "名前を入れてください");
    props["名前"] = { title: rich(name) };
  }
  if (has("cat")) props["カテゴリ"] = { select: CATS.includes(body?.cat) ? { name: body.cat } : null };
  if (has("freq")) props["使う頻度"] = { select: FREQS.includes(body?.freq) ? { name: body.freq } : null };
  const num = (v, label) => {
    if (v === "" || v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) throw httpError(400, `${label}の数が正しくありません`);
    return n;
  };
  if (has("use")) props["使う数"] = { number: num(body?.use, "使う数") };
  if (has("size")) props["内容量"] = { number: num(body?.size, "内容量") };
  if (has("link")) {
    const link = String(body?.link || "").trim();
    if (link && !/^https:\/\/\S{1,1900}$/.test(link)) throw httpError(400, "URL は https:// で始めてください");
    props["URL"] = { url: link || null };
  }
  if (has("memo")) props["メモ"] = { rich_text: clean(body?.memo, 1000, "メモ") ? rich(clean(body.memo, 1000, "メモ")) : [] };
  if (has("store")) {
    const st = clean(body?.store, 30, "店");
    props["店"] = { select: st ? { name: st } : null };
  }
  if (has("jan")) {
    const j = String(body?.jan || "").replace(/\D/g, "");
    if (j && !/^(\d{8}|\d{12,13})$/.test(j)) throw httpError(400, "バーコードは8桁か13桁の数字です");
    props.JAN = { rich_text: j ? rich(j) : [] };
  }
  if (has("image")) {
    const img = String(body?.image || "").trim();
    if (img && !/^https:\/\/\S{1,1900}$/.test(img)) throw httpError(400, "画像の URL は https:// で始めてください");
    props["画像"] = { files: img ? [{ name: "商品画像", type: "external", external: { url: img } }] : [] };
  }
  if (!edit || body?.bought) props["購入日（手入力）"] = { date: { start: dateOf(body?.bought) || todayJst() } };
  // 空の値は作るときには送らない
  if (!edit) for (const [k, v] of Object.entries(props)) if (v.select === null || v.number === null || v.url === null || v.files?.length === 0 || v.rich_text?.length === 0) delete props[k];
  return props;
}

async function addStock(notion, env, body) {
  const page = await notion("POST", "/pages", { parent: { type: "data_source_id", data_source_id: env.DAILY_DS_ID }, properties: stockProps(body) });
  const x = stockOf(page, todayJst());
  x.open = [];
  return { stock: x };
}

// 名前・使う頻度・商品（URL・画像・JAN）などを直す。商品を変えたときは bought で買った日も今日にできる
async function editStock(notion, env, id, body) {
  const page = await stockPage(notion, env, id);
  const props = stockProps(body, { edit: true });
  if (!Object.keys(props).length) throw httpError(400, "変える内容がありません");
  const after = await notion("PATCH", `/pages/${normalizeId(page.id)}`, { properties: props });
  const x = stockOf(after, todayJst());
  // 名前・注文ページが変わったら、開いている補充タスクの名前と URL も合わせる
  const renamed = [];
  if (props["名前"] || props.URL) {
    for (const t of await openRefills(notion, env, x.id)) {
      const tp = { "名前": { title: rich(`補充:${x.name}`) }, ...(props.URL ? { "URL": { url: x.link || null } } : {}) };
      await notion("PATCH", `/pages/${t.id}`, { properties: tp });
      renamed.push({ id: t.id, name: `補充:${x.name}`, link: x.link });
    }
  }
  return { stock: x, renamed };
}

// 補充リストから外す：補充タスクをゴミ箱へ（在庫の品はそのまま。最終補充日も変えない）
async function cancelRefill(notion, env, id) {
  const t = await listPage(notion, env, id);
  if (!t.refill.length) throw httpError(403, "補充タスクではありません");
  await notion("PATCH", `/pages/${t.id}`, { in_trash: true });
  return { cancelled: t.id };
}

// 在庫の品を消す（Notion のゴミ箱へ。30日はゴミ箱から戻せる）。開いている補充タスクは残す
async function trashStock(notion, env, id) {
  const page = await stockPage(notion, env, id);
  await notion("PATCH", `/pages/${normalizeId(page.id)}`, { in_trash: true });
  return { trashed: normalizeId(page.id) };
}

// ---------- 商品ページ・バーコード・写真から商品を調べる ----------
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
function publicHttps(raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch { throw httpError(400, "URL が正しくありません"); }
  if (u.protocol !== "https:" || /^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(u.hostname) || !u.hostname.includes(".")) throw httpError(400, "https の商品ページを指定してください");
  return u;
}
const decodeHtml = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x2F;/g, "/");
// 商品ページの og:image（Amazon は商品画像の URL）と名前を拾う
export function pickMeta(html, base) {
  const meta = (key) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    return tag ? decodeHtml(tag.match(/content=["']([^"']*)["']/i)?.[1] || "") : "";
  };
  let image = meta("og:image") || meta("twitter:image") || html.match(/data-old-hires=["'](https:[^"']+)["']/)?.[1] || html.match(/"hiRes":"(https:[^"]+)"/)?.[1] || html.match(/https:\/\/m\.media-amazon\.com\/images\/I\/[\w.%-]+\.jpg/)?.[0] || "";
  if (image) { try { image = new URL(image, base).href; } catch { image = ""; } }
  if (!/^https:/.test(image)) image = "";
  const title = (meta("og:title") || decodeHtml(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "")).replace(/\s+/g, " ").trim().slice(0, 200);
  return { image, title };
}
async function lookupPage(raw) {
  const u = publicHttps(raw);
  let res;
  try { res = await fetch(u.href, { headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.5", Accept: "text/html" }, redirect: "follow" }); } catch { throw httpError(502, "商品ページを開けませんでした"); }
  if (!res.ok) throw httpError(502, `商品ページを開けませんでした（${res.status}）`);
  const html = (await res.text()).slice(0, 600000);
  const got = pickMeta(html, res.url || u.href);
  if (!got.image) throw httpError(404, "このページから画像を見つけられませんでした（画像の URL を直接貼ってもよい）");
  return got;
}

// Yahoo!ショッピングの商品検索で JAN から名前・画像・ページを引く（YAHOO_APPID がなければ使わない）
export function cleanItemName(name) {
  return String(name || "").replace(/【[^】]*】|［[^］]*］|\[[^\]]*\]|★[^★]*★|《[^》]*》/g, " ").replace(/送料無料|ポイント\d+倍|あす楽|まとめ買い/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}
async function lookupJan(env, code) {
  if (!env.YAHOO_APPID) return { configured: false };
  const res = await fetch(`https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${encodeURIComponent(env.YAHOO_APPID)}&jan_code=${code}&results=5`);
  if (!res.ok) throw httpError(502, `商品の検索に失敗しました（${res.status}）`);
  const data = await res.json().catch(() => ({}));
  const hit = (data.hits || []).find((h) => h.name) || null;
  if (!hit) return { configured: true, found: false };
  return { configured: true, found: true, name: cleanItemName(hit.name), image: hit.exImage?.url || hit.image?.medium || "", url: hit.url || "", brand: hit.brand?.name || "" };
}

const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const CLAUDE_MODEL = "claude-opus-5-5";
const IDENTIFY_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "商品名（ブランド・品名・容量・入り数が読めれば入れる。日本語）" },
    category: { type: "string", enum: [...CATS, ""] },
    match: { type: "string", description: "在庫リストに同じ商品があればその名前をそのまま。なければ空文字" },
    jan: { type: "string", description: "写真にバーコードの数字（8桁か13桁）が読めればその数字。なければ空文字" },
  },
  required: ["name", "category", "match", "jan"],
  additionalProperties: false,
};
const identifyPrompt = (names) => `写真の中央に写っている商品を見てください。パッケージの文字（ブランド名・商品名・容量・入り数）をよく読み、商品を特定してください。
在庫リスト：${names.join(" / ") || "（なし）"}`;

// カメラの1枚から商品を当てる。ANTHROPIC_API_KEY があれば Claude、なければ Cloudflare Workers AI
async function identify(env, body) {
  const m = String(body?.image || "").match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[2].length > 1_500_000) throw httpError(400, "画像が正しくないか大きすぎます");
  const names = (Array.isArray(body?.names) ? body.names : []).map((n) => String(n).slice(0, 60)).slice(0, 150);
  const j = env.ANTHROPIC_API_KEY ? await identifyClaude(env, m, names) : await identifyWorkersAI(env, body.image, names);
  const name = String(j.name || "").trim().slice(0, 80);
  const jan = String(j.jan || "").replace(/\D/g, "");
  return { name, category: CATS.includes(j.category) ? j.category : "", match: names.includes(j.match) ? j.match : "", jan: /^(\d{8}|\d{13})$/.test(jan) ? jan : "", by: env.ANTHROPIC_API_KEY ? "claude" : "workers-ai" };
}

async function identifyClaude(env, m, names) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  let res;
  try {
    res = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: { type: "json_schema", schema: IDENTIFY_SCHEMA } },
      // 安全のための判定で断られたときは、Anthropic のおすすめのモデルでやり直す
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: `image/${m[1]}`, data: m[2] } },
        { type: "text", text: identifyPrompt(names) },
      ] }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw httpError(502, "Claude の API キーが正しくありません");
    if (err instanceof Anthropic.RateLimitError) throw httpError(429, "Claude が混み合っています。少し待ってください");
    if (err instanceof Anthropic.APIError) throw httpError(502, `写真から商品を当てられませんでした（Claude ${err.status ?? ""}）`);
    throw httpError(502, "写真から商品を当てられませんでした");
  }
  if (res.stop_reason === "refusal") throw httpError(502, "写真から商品を当てられませんでした（断られました）");
  const text = res.content.filter((x) => x.type === "text").map((x) => x.text).join("");
  try { return JSON.parse(text); } catch { throw httpError(502, "写真から商品を当てられませんでした（返事の形が違いました）"); }
}

async function identifyWorkersAI(env, image, names) {
  if (!env.AI) throw httpError(500, "Workers AI が設定されていません");
  const prompt = `${identifyPrompt(names)}
JSONだけを返してください：{"name":"商品名","category":"日用品|消耗品|食品|育児|サプリ|美容 のどれか","match":"在庫リストの同じ商品の名前か空文字","jan":""}`;
  // 画像はメッセージの中に data URL で渡す（image 引数に分けると "no user-supplied messages" になる）
  const run = () => env.AI.run(VISION_MODEL, { messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: image } }] }], max_tokens: 200 });
  let out;
  try { out = await run(); } catch (err) {
    // はじめて使うときはモデルの利用規約への同意が要る
    if (!/agree/i.test(String(err?.message))) throw httpError(502, `写真から商品を当てられませんでした（${String(err?.message || "").slice(0, 120)}）`);
    await env.AI.run(VISION_MODEL, { prompt: "agree" }).catch(() => {});
    try { out = await run(); } catch (e2) { throw httpError(502, `写真から商品を当てられませんでした（${String(e2?.message || "").slice(0, 120)}）`); }
  }
  const resp = out?.response ?? out?.result?.response ?? "";
  // 返事は JSON の文字列か、すでに読み取られたオブジェクト
  if (resp && typeof resp === "object") return resp;
  const text = String(resp);
  try { return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}"); } catch { return { name: text.replace(/[{}"]/g, "").split("\n")[0] }; }
}

// ---------- 店 ----------
// 店の名前は KV（"stores"）に置く。テンプレート・在庫で使っている店も足して返す。Notion の選択肢は書いたときに自動で増える
const DEFAULT_STORES = ["ヤオコー", "ヤクルト", "ドラッグストア"];
async function storeList(env, used = []) {
  const saved = (env.SUBS && (await env.SUBS.get("stores", "json"))) || DEFAULT_STORES;
  return [...new Set([...saved, ...used].filter((x) => x && x !== "その他"))];
}
async function addStore(env, body) {
  needPush(env);
  const name = clean(body?.name, 30, "店の名前");
  if (!name) throw httpError(400, "店の名前を入れてください");
  const list = await storeList(env);
  if (!list.includes(name)) list.push(name);
  await env.SUBS.put("stores", JSON.stringify(list));
  return { stores: list };
}
async function removeStore(env, body) {
  needPush(env);
  const list = (await storeList(env)).filter((x) => x !== body?.name);
  await env.SUBS.put("stores", JSON.stringify(list));
  return { stores: list };
}

// ---------- 購入サイト（名前と検索 URL。{q} に品名が入る）----------
const DEFAULT_SITES = [
  { name: "Amazon", url: "https://www.amazon.co.jp/s?k={q}" },
  { name: "楽天", url: "https://search.rakuten.co.jp/search/mall/{q}/" },
  { name: "Yahoo!", url: "https://shopping.yahoo.co.jp/search?p={q}" },
  { name: "LOHACO", url: "https://lohaco.yahoo.co.jp/search/?p={q}" },
];
const siteList = async (env) => (env.SUBS && (await env.SUBS.get("sites", "json"))) || DEFAULT_SITES;
// 検索したページの URL を貼るだけで登録できるように、検索語の所を {q} にする
export function siteTemplate(raw) {
  const u = publicHttps(raw);
  if (u.href.includes("{q}") || u.href.includes("%7Bq%7D")) return u.href.replace("%7Bq%7D", "{q}");
  for (const k of ["k", "q", "p", "keyword", "keywords", "query", "search", "word", "kw", "sitesearch", "searchWord"]) {
    if (u.searchParams.has(k)) { u.searchParams.set(k, "QQQ"); return u.href.replace("QQQ", "{q}"); }
  }
  return u.href;
}
async function addSite(env, body) {
  needPush(env);
  const name = clean(body?.name, 30, "サイトの名前");
  if (!name) throw httpError(400, "サイトの名前を入れてください");
  const url = siteTemplate(body?.url);
  const list = (await siteList(env)).filter((x) => x.name !== name);
  list.push({ name, url });
  await env.SUBS.put("sites", JSON.stringify(list));
  return { sites: list };
}
async function removeSite(env, body) {
  needPush(env);
  const list = (await siteList(env)).filter((x) => x.name !== body?.name);
  await env.SUBS.put("sites", JSON.stringify(list));
  return { sites: list };
}

// ---------- 価格・レシート ----------
function priceOf(page) {
  const p = page.properties || {};
  return {
    id: normalizeId(page.id),
    url: page.url,
    name: propText(p["品名"]),
    store: propText(p["店"]),
    price: typeof p["価格"]?.number === "number" ? p["価格"].number : null,
    qty: typeof p["数量"]?.number === "number" && p["数量"].number > 0 ? p["数量"].number : 1,
    date: propDate(p["日付"]),
    receipt: relIds(p["レシート"])[0] || "",
    stock: relIds(p["在庫"])[0] || "",
  };
}
function needPrices(env) {
  if (!env.PRICE_DS_ID || !env.RECEIPT_DS_ID) throw httpError(500, "PRICE_DS_ID / RECEIPT_DS_ID が設定されていません");
}
async function loadPrices(notion, env) {
  needPrices(env);
  const [pages, receipts] = await Promise.all([
    queryAll(notion, env.PRICE_DS_ID, { sorts: [{ property: "日付", direction: "descending" }] }),
    queryAll(notion, env.RECEIPT_DS_ID, { sorts: [{ property: "日付", direction: "descending" }] }),
  ]);
  return {
    prices: pages.map(priceOf).filter((x) => x.name && x.price != null),
    receipts: receipts.map((pg) => ({ id: normalizeId(pg.id), url: pg.url, name: propText(pg.properties?.["名前"]), store: propText(pg.properties?.["店"]), date: propDate(pg.properties?.["日付"]), total: pg.properties?.["合計"]?.number ?? null, photo: imageOf(pg.properties?.["写真"]) })),
  };
}
function priceItems(raw) {
  const arr = (Array.isArray(raw) ? raw : []).map((x) => ({
    name: clean(x?.name, NAME_MAX, "品名"),
    price: Number(x?.price),
    qty: Number(x?.qty) > 0 && Number(x?.qty) < 1000 ? Number(x.qty) : 1,
    stock: /^[0-9a-f-]{32,36}$/i.test(String(x?.stock || "")) ? normalizeId(x.stock) : "",
  })).filter((x) => x.name && Number.isFinite(x.price) && x.price >= 0 && x.price < 1e7);
  if (arr.length > ADD_MAX) throw httpError(400, `一度に入れられるのは${ADD_MAX}品までです`);
  return arr;
}
async function createPrices(notion, env, items, { store, date, receipt }) {
  const out = [];
  let next = 0;
  const worker = async () => {
    for (let k; (k = next++) < items.length;) {
      const x = items[k];
      const page = await notion("POST", "/pages", {
        parent: { type: "data_source_id", data_source_id: env.PRICE_DS_ID },
        properties: {
          "品名": { title: rich(x.name) },
          "価格": { number: x.price },
          "数量": { number: x.qty },
          "日付": { date: { start: date } },
          ...(store ? { "店": { select: { name: store } } } : {}),
          ...(receipt ? { "レシート": { relation: [{ id: receipt }] } } : {}),
          ...(x.stock ? { "在庫": { relation: [{ id: x.stock }] } } : {}),
        },
      });
      out[k] = priceOf(page);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}
async function addPrices(notion, env, body) {
  needPrices(env);
  const items = priceItems(body?.items);
  if (!items.length) throw httpError(400, "品名と価格を入れてください");
  return { prices: await createPrices(notion, env, items, { store: clean(body?.store, 30, "店"), date: dateOf(body?.date) || todayJst() }) };
}
async function removePrice(notion, env, id) {
  needPrices(env);
  const page = await notion("GET", `/pages/${normalizeId(id)}`);
  if (normalizeId(page.parent?.data_source_id) !== normalizeId(env.PRICE_DS_ID)) throw httpError(403, "DB_価格記録 の行ではありません");
  await notion("PATCH", `/pages/${normalizeId(page.id)}`, { in_trash: true });
  return { removed: normalizeId(page.id) };
}

function imageData(raw, max = 3_000_000) {
  const m = String(raw || "").match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[2].length > max) throw httpError(400, "画像が正しくないか大きすぎます");
  return { type: m[1], b64: m[2] };
}
// レシートの写真を Notion に上げる（File Upload API。1枚 20MB まで）
async function uploadToNotion(env, img, filename) {
  const base = env.NOTION_API_BASE || NOTION_BASE;
  const headers = { Authorization: `Bearer ${env.NOTION_TOKEN}`, "Notion-Version": NOTION_VERSION };
  const res = await fetch(`${base}/file_uploads`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ filename, content_type: `image/${img.type}` }) });
  const up = await res.json().catch(() => ({}));
  if (!res.ok || !up.id) throw httpError(502, `写真を Notion に上げられませんでした（${up.code || res.status}）`);
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(atob(img.b64), (c) => c.charCodeAt(0))], { type: `image/${img.type}` }), filename);
  const sent = await fetch(`${base}/file_uploads/${up.id}/send`, { method: "POST", headers, body: form });
  if (!sent.ok) throw httpError(502, `写真を Notion に上げられませんでした（${sent.status}）`);
  return up.id;
}

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    store: { type: "string", description: "店の名前。店の一覧にある店ならその名前をそのまま" },
    date: { type: "string", description: "買った日 YYYY-MM-DD。読めなければ空文字" },
    total: { type: "number", description: "合計金額（税込・円）。読めなければ0" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "品名。略称は分かる範囲で一般的な名前に直す。在庫リストと同じ品ならその名前" },
          price: { type: "number", description: "その行で払った金額（税込・円。値引きがあれば引いた後）" },
          qty: { type: "number", description: "個数。書いていなければ1" },
        },
        required: ["name", "price", "qty"],
        additionalProperties: false,
      },
    },
  },
  required: ["store", "date", "total", "items"],
  additionalProperties: false,
};
// レシートの写真から店・日付・合計・品と価格を読む（Claude。キーがなければ読まない）
async function readReceipt(env, body) {
  const img = imageData(body?.image);
  if (!env.ANTHROPIC_API_KEY) return { configured: false };
  const stores = (Array.isArray(body?.stores) ? body.stores : []).map((n) => String(n).slice(0, 30)).slice(0, 50);
  const names = (Array.isArray(body?.names) ? body.names : []).map((n) => String(n).slice(0, 60)).slice(0, 150);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
  let res;
  try {
    res = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: { type: "json_schema", schema: RECEIPT_SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: `image/${img.type}`, data: img.b64 } },
        { type: "text", text: `このレシートを読み取ってください。小計・合計・税・ポイント・お釣りの行は品に入れないでください。
店の一覧：${stores.join(" / ") || "（なし）"}
在庫リスト：${names.join(" / ") || "（なし）"}` },
      ] }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw httpError(502, "Claude の API キーが正しくありません");
    if (err instanceof Anthropic.APIError) throw httpError(502, `レシートを読めませんでした（Claude ${err.status ?? ""}）`);
    throw httpError(502, "レシートを読めませんでした");
  }
  if (res.stop_reason === "refusal") throw httpError(502, "レシートを読めませんでした（断られました）");
  let j;
  try { j = JSON.parse(res.content.filter((x) => x.type === "text").map((x) => x.text).join("")); } catch { throw httpError(502, "レシートを読めませんでした（返事の形が違いました）"); }
  return { configured: true, store: String(j.store || "").slice(0, 30), date: dateOf(j.date) || "", total: Number(j.total) || null, items: (j.items || []).slice(0, ADD_MAX).map((x) => ({ name: String(x.name || "").slice(0, 80), price: Number(x.price) || 0, qty: Number(x.qty) > 0 ? Number(x.qty) : 1 })) };
}

// レシートを保存：写真つきで DB_レシート に1行、品ごとの価格を DB_価格記録 に（レシートでつなぐ）
async function saveReceipt(notion, env, body) {
  needPrices(env);
  const img = body?.image ? imageData(body.image) : null;
  const store = clean(body?.store, 30, "店");
  const date = dateOf(body?.date) || todayJst();
  const items = priceItems(body?.items);
  const total = Number(body?.total) > 0 ? Number(body.total) : items.reduce((n, x) => n + x.price, 0);
  const fileId = img ? await uploadToNotion(env, img, `receipt-${date}.${img.type === "jpeg" ? "jpg" : img.type}`) : null;
  const page = await notion("POST", "/pages", {
    parent: { type: "data_source_id", data_source_id: env.RECEIPT_DS_ID },
    properties: {
      "名前": { title: rich(`${store || "レシート"} ${date.slice(5).replace("-", "/")} ¥${Math.round(total).toLocaleString("ja-JP")}`) },
      "日付": { date: { start: date } },
      "合計": { number: total },
      ...(store ? { "店": { select: { name: store } } } : {}),
      ...(fileId ? { "写真": { files: [{ type: "file_upload", file_upload: { id: fileId }, name: `receipt-${date}` }] } } : {}),
    },
  });
  const receipt = normalizeId(page.id);
  const prices = items.length ? await createPrices(notion, env, items, { store, date, receipt }) : [];
  return { receipt: { id: receipt, url: page.url }, prices };
}

// 名前で商品を探す。Yahoo!ショッピングの Client ID があれば公式の API、なければ Amazon の検索結果のページから拾う
async function searchItems(env, q) {
  const query = clean(q, 100, "検索の言葉");
  if (!query) throw httpError(400, "探す言葉を入れてください");
  if (env.YAHOO_APPID) {
    const res = await fetch(`https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${encodeURIComponent(env.YAHOO_APPID)}&query=${encodeURIComponent(query)}&results=10`);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { configured: true, source: "Yahoo!ショッピング", items: (data.hits || []).filter((h) => h.name).map((h) => ({ name: cleanItemName(h.name), image: h.exImage?.url || h.image?.medium || "", url: h.url || "", price: h.price != null ? `¥${Number(h.price).toLocaleString("ja-JP")}` : "", jan: h.janCode || "" })) };
    }
  }
  try {
    return { configured: true, source: "Amazon", items: await amazonSearch(query) };
  } catch {
    return { configured: false };
  }
}
// Amazon の検索結果のページ（1ページ目）から、商品名・画像・値段・商品ページを拾う
export function parseAmazonSearch(html) {
  const out = [];
  // 結果1件ごとの開始タグ（data-asin はこのタグの中にある）から、次の結果の手前までを1件として読む
  const starts = [...html.matchAll(/<div[^>]+data-component-type="s-search-result"[^>]*>/g)];
  for (const [k, st] of starts.entries()) {
    const b = html.slice(st.index, starts[k + 1]?.index ?? st.index + 60000);
    const asin = st[0].match(/data-asin="([A-Z0-9]{10})"/)?.[1] || b.match(/\/dp\/([A-Z0-9]{10})/)?.[1];
    const name = decodeHtml(b.match(/<h2[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/)?.[1] || "").replace(/\s+/g, " ").trim();
    if (!asin || !name) continue;
    const img = b.match(/class="s-image"[^>]*src="([^"]+)"/)?.[1] || b.match(/src="([^"]+)"[^>]*class="s-image"/)?.[1] || "";
    // 値段：読み上げ用の文字 → 円の数字 → 「￥1,234」の順に探す
    const whole = b.match(/class="a-price-whole">([\d,]+)/)?.[1];
    const price = decodeHtml(b.match(/class="a-offscreen">([^<]+)</)?.[1] || "").trim() || (whole ? `￥${whole}` : "") || (b.match(/[￥¥]\s?[\d,]{2,}/)?.[0] || "").replace(/\s/g, "");
    out.push({ name: cleanItemName(name), image: img.replace(/\._[^/]*_\.(jpg|png)$/, "._AC_SL500_.$1"), url: `https://www.amazon.co.jp/dp/${asin}`, price, jan: "" });
    if (out.length >= 10) break;
  }
  return out;
}
async function amazonSearch(query) {
  // どこから呼んでも円・日本語で出るように通貨と言語のクッキーを付ける
  const res = await fetch(`https://www.amazon.co.jp/s?k=${encodeURIComponent(query)}`, { headers: { "User-Agent": UA, "Accept-Language": "ja-JP,ja;q=0.9", Accept: "text/html", Cookie: "i18n-prefs=JPY; lc-acbjp=ja_JP" } });
  if (!res.ok) throw new Error(String(res.status));
  const items = parseAmazonSearch((await res.text()).slice(0, 2_500_000));
  if (!items.length) throw new Error("no items");
  return items;
}
// 打ちかけの言葉から検索の候補を出す（Amazon の候補。だめなら Google の候補）
async function suggestWords(q) {
  const query = String(q || "").trim().slice(0, 60);
  if (!query) return { words: [] };
  try {
    const res = await fetch(`https://completion.amazon.co.jp/api/2017/suggestions?mid=A1VC38T7YXB528&alias=aps&prefix=${encodeURIComponent(query)}`, { headers: { "User-Agent": UA } });
    const data = await res.json();
    const words = (data.suggestions || []).map((x) => String(x.value || "")).filter(Boolean);
    if (words.length) return { words: [...new Set(words)].slice(0, 8) };
  } catch { /* 次の候補へ */ }
  try {
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=ja&q=${encodeURIComponent(query)}`);
    const data = await res.json();
    return { words: (data[1] || []).slice(0, 8) };
  } catch { return { words: [] }; }
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
  return rec ? { subscribed: true, hour: rec.hour, days: rec.days, list: rec.list, remind: rec.remind !== false } : { subscribed: false };
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
    remind: body?.remind !== false,
    lastSent: prev?.lastSent || "",
  };
  await env.SUBS.put(key, JSON.stringify(rec));
  return { subscribed: true, hour: rec.hour, days: rec.days, list: rec.list, remind: rec.remind };
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
  const subs = [];
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix: "sub:", cursor });
    for (const k of page.keys) {
      const rec = await env.SUBS.get(k.name, "json");
      if (rec) subs.push([k.name, rec]);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  if (!subs.length) return { sent: 0 };
  const notion = notionClient(env);
  const reminded = await runReminders(notion, env, at, subs.filter(([, r]) => r.remind !== false));
  // 在庫アラートは毎時の最初の回（0〜14分）だけ
  const due = jst.getUTCMinutes() < TICK_MIN ? subs.filter(([, r]) => r.hour === hour && r.lastSent !== today) : [];
  if (!due.length) return { sent: reminded };
  const state = await loadState(notion, env);
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
  return { sent: sent + reminded };
}

// 実行日に時刻のある買い物タスクを、タスクごとに決めた時刻（既定は30分前と時刻ちょうど）に知らせる（同じ知らせは1度だけ）
async function runReminders(notion, env, at, subs) {
  if (!subs.length) return 0;
  const pages = await queryAll(notion, env.TASK_DS_ID, {
    filter: { and: [openFilter, { property: "分類タグ", select: { equals: "BUY" } }, { property: "親タスク", relation: { is_empty: true } }, { property: "実行日", date: { on_or_after: new Date(at - 864e5).toISOString().slice(0, 10) } }] },
  });
  let sent = 0;
  const vapid = await vapidOf(env);
  for (const t of pages.map(taskOf).filter((x) => x.at)) {
    const when = Date.parse(t.at);
    for (const before of await remindOf(env, t.id)) {
      const fire = when - before * 60e3;
      if (!(fire <= at && fire > at - TICK_MIN * 60e3)) continue;
      const mark = `rem:${t.id}:${t.at}:${before}`;
      if (await env.SUBS.get(mark)) continue;
      await env.SUBS.put(mark, "1", { expirationTtl: 3 * 86400 });
      await readItems(notion, t, { n: 3 });
      t.items = [...(t.items || []), ...(await childTasks(notion, env, t.id)).map(subItemOf)];
      const left = (t.items || []).filter((i) => !i.checked).map((i) => i.text);
      const hm = t.at.slice(11, 16);
      const msg = {
        title: before ? `🛒 ${before >= 1440 ? "明日" : ""}${hm} から買い物（${beforeText(before)}）` : `🛒 買い物の時間です（${hm}）`,
        body: `${t.name}${left.length ? `：${left.length}品（${left.slice(0, 4).join("・")}${left.length > 4 ? "…" : ""}）` : ""}`,
        tag: `kaimono-${t.id}`,
        url: `./?tab=list&list=${t.id}`,
      };
      for (const [key, rec] of subs) {
        try {
          const status = await sendPush(rec.subscription, msg, vapid, { urgency: "high", ttl: 3600 });
          if (status === 404 || status === 410) await env.SUBS.delete(key);
          else if (status < 400) sent++;
        } catch { /* ほかの端末には送る */ }
      }
    }
  }
  return sent;
}

const beforeText = (m) => (m >= 1440 ? "前日のお知らせ" : m >= 60 ? `あと${m / 60}時間` : `あと${m}分`);

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
