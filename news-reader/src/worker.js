// 新聞アプリ：画面の配信と Notion API の中継、記事本文の取り込み（Cloudflare Worker）
// Notion のトークンはこの Worker の secret にだけ置き、ブラウザには渡さない。

import { extractArticle, hostOf } from "./extract.js";
import { pushEnabled, publicKey, saveSubscription, removeSubscription, sendToAll } from "./push.js";

const NOTION_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const STATES = new Set(["未読", "読んだ", "📚 送る"]);
const DEFAULT_HOSTS = "nikkei.com,jiji.com,tokyo-np.co.jp,jomo-news.co.jp,asahi.com,yomiuri.co.jp,mainichi.jp";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAX_HTML = 3_000_000;
const FETCH_TIMEOUT = 10e3;
const READ_CACHE_SEC = 6 * 3600;
const RECENT_DAYS = 3;
const SENT_DAYS = 30;
const TOPIC = /^\s*(\d+)\s*社\s*[｜|]\s*(.+)$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      checkConfig(env);
      if (!authorized(request, env)) return json({ error: "合言葉が違います" }, 401);
      const notion = notionClient(env);

      if (url.pathname === "/api/articles" && request.method === "GET") {
        return json(await listArticles(notion, env, url.searchParams.get("scope") || "unread"));
      }
      if (url.pathname === "/api/unread" && request.method === "GET") {
        return json(await unreadSummary(notion, env));
      }
      const readMatch = url.pathname.match(/^\/api\/articles\/([0-9a-f-]{32,36})\/body$/i);
      if (readMatch && request.method === "GET") {
        return json(await readArticle(notion, env, readMatch[1], url.searchParams.has("fresh")));
      }
      const pageMatch = url.pathname.match(/^\/api\/articles\/([0-9a-f-]{32,36})$/i);
      if (pageMatch && request.method === "PATCH") {
        const body = await readJson(request);
        return json(await updateState(notion, env, pageMatch[1], body));
      }
      if (url.pathname === "/api/push/key" && request.method === "GET") {
        if (!pushEnabled(env)) return json({ enabled: false });
        return json({ enabled: true, publicKey: await publicKey(env) });
      }
      if (url.pathname === "/api/push/subscribe" && request.method === "POST") {
        const body = await readJson(request);
        await saveSubscription(env, body.subscription, url.origin);
        return json({ ok: true });
      }
      if (url.pathname === "/api/push/unsubscribe" && request.method === "POST") {
        const body = await readJson(request);
        await removeSubscription(env, body.endpoint);
        return json({ ok: true });
      }
      if (url.pathname === "/api/push/test" && request.method === "POST") {
        return json(await sendToAll(env));
      }
      return json({ error: "not found" }, 404);
    } catch (err) {
      const status = err.status || 500;
      return json({ error: err.publicMessage || "サーバーでエラーが起きました" }, status);
    }
  },

  // 朝のニュース収集のあとに、未読があればホーム画面のアイコンの数字を更新する通知を送る
  async scheduled(_event, env, ctx) {
    if (!pushEnabled(env) || !env.NOTION_TOKEN || !env.NEWS_DS_ID) return;
    ctx.waitUntil(
      (async () => {
        const { unread } = await unreadSummary(notionClient(env), env);
        if (unread > 0) await sendToAll(env);
      })(),
    );
  },
};

function checkConfig(env) {
  if (!env.NOTION_TOKEN || !env.APP_KEY || env.APP_KEY.length < 16 || !env.NEWS_DS_ID) {
    throw httpError(500, "Worker の設定（NOTION_TOKEN / APP_KEY / NEWS_DS_ID）が足りません");
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
          ? "Notion で DB_ニュース にインテグレーションが接続されていません（README の手順1）"
          : data.code === "unauthorized"
            ? "Notion のトークンが正しくありません"
            : data.code === "rate_limited"
              ? "Notion が混み合っています。少し待ってください"
              : `Notion エラー（${data.code || res.status}）`;
      throw httpError(res.status === 429 ? 429 : 502, hint);
    }
    return data;
  };
}

// ---------- 記事の一覧 ----------
async function listArticles(notion, env, scope) {
  const filters = {
    unread: { property: "状態", select: { equals: "未読" } },
    recent: { property: "日付", date: { on_or_after: addDays(todayJst(), -RECENT_DAYS) } },
    sent: {
      and: [
        { property: "日付", date: { on_or_after: addDays(todayJst(), -SENT_DAYS) } },
        { or: [{ property: "状態", select: { equals: "📚 送る" } }, { property: "状態", select: { equals: "📚 送り済" } }] },
      ],
    },
  };
  if (!filters[scope]) throw httpError(400, "表示の種類が正しくありません");
  const [pages, unreadPages] = await Promise.all([
    queryAll(notion, env.NEWS_DS_ID, { filter: filters[scope], sorts: [{ property: "日付", direction: "descending" }] }),
    scope === "unread" ? null : queryUnread(notion, env),
  ]);
  const articles = pages.map(summarize);
  const unread = scope === "unread" ? articles : unreadPages.map(summarize);
  return { scope, articles, ...countUnread(unread) };
}

async function unreadSummary(notion, env) {
  const unread = (await queryUnread(notion, env)).map(summarize);
  const topics = [...new Map(unread.sort((a, b) => b.topicCount - a.topicCount).map((a) => [a.topicName, a])).keys()];
  return { ...countUnread(unread), topics: topics.slice(0, 3) };
}

function queryUnread(notion, env) {
  return queryAll(notion, env.NEWS_DS_ID, { filter: { property: "状態", select: { equals: "未読" } } });
}

function countUnread(list) {
  const byPaper = {};
  for (const a of list) byPaper[a.paper] = (byPaper[a.paper] || 0) + 1;
  return { unread: list.length, unreadByPaper: byPaper, unreadItems: list.map((a) => ({ id: a.id, paper: a.paper })) };
}

function summarize(page) {
  const p = page.properties || {};
  const topic = plain(p["話題"]);
  const m = topic.match(TOPIC);
  return {
    id: page.id,
    title: plain(p["見出し"]),
    url: p.URL?.url || "",
    paper: p["新聞社"]?.select?.name || "",
    frame: p["枠"]?.select?.name || "",
    topic,
    topicName: m ? m[2].trim() : topic || plain(p["見出し"]),
    topicCount: p["社数"]?.number ?? (m ? Number(m[1]) : 1),
    summary: plain(p["一言要約"]),
    paid: p["🔒有料"]?.checkbox === true,
    state: p["状態"]?.select?.name || "",
    date: p["日付"]?.date?.start?.slice(0, 10) || "",
  };
}

function plain(prop) {
  const list = prop?.title || prop?.rich_text || [];
  return list.map((t) => t.plain_text ?? t.text?.content ?? "").join("").trim();
}

// ---------- 状態の書き換え ----------
async function updateState(notion, env, pageId, body) {
  const state = body?.state;
  if (!STATES.has(state)) throw httpError(400, "変更できない状態です");
  await assertNewsPage(notion, env, pageId);
  const updated = await notion("PATCH", `/pages/${pageId}`, { properties: { "状態": { select: { name: state } } } });
  return { article: summarize(updated) };
}

// DB_ニュース の行だけを扱う（他のページには触らない）
async function assertNewsPage(notion, env, pageId) {
  const page = await notion("GET", `/pages/${pageId}`);
  if (normalizeId(page.parent?.data_source_id) !== normalizeId(env.NEWS_DS_ID)) {
    throw httpError(403, "DB_ニュース の記事ではありません");
  }
  return page;
}

// ---------- 記事本文（リーダー表示） ----------
// DB_ニュース にある記事のURLだけを、決まった新聞社のサイトからだけ取りに行く（Notion にも保存しない）
async function readArticle(notion, env, pageId, fresh) {
  const page = await assertNewsPage(notion, env, pageId);
  const article = summarize(page);
  const cacheKey = new Request(`https://news-reader.cache/body/${normalizeId(pageId)}`);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache && !fresh) {
    const hit = await cache.match(cacheKey);
    if (hit) return { article, ...(await hit.json()) };
  }

  const body = await fetchBody(env, article.url);
  if (cache && body.paragraphs.length) {
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${READ_CACHE_SEC}` } }),
    );
  }
  return { article, ...body };
}

async function fetchBody(env, url) {
  if (!allowedHost(env, url)) return { paragraphs: [], note: "このサイトの記事はアプリ内で表示できません。元の記事を開いてください" };
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "ja,en;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
  } catch {
    return { paragraphs: [], note: "記事のサイトにつながりませんでした" };
  }
  if (!res.ok) return { paragraphs: [], note: `記事のサイトが表示を断りました（${res.status}）` };
  if (res.url && !allowedHost(env, res.url)) return { paragraphs: [], note: "記事が別のサイトに移動していました。元の記事を開いてください" };
  const html = (await res.text()).slice(0, MAX_HTML);
  const { title, image, paragraphs } = extractArticle(html, res.url || url);
  return { title, image, paragraphs, note: paragraphs.length ? "" : "本文を読み取れませんでした。元の記事を開いてください" };
}

function allowedHost(env, url) {
  if (!/^https:\/\//i.test(url || "")) return false;
  const host = hostOf(url);
  const allowed = (env.ALLOWED_HOSTS || DEFAULT_HOSTS).split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.some((h) => host === h || host.endsWith("." + h));
}

// ---------- 共通 ----------
const MAX_QUERY_PAGES = 5;

async function queryAll(notion, dataSourceId, body) {
  const out = [];
  let cursor;
  for (let i = 0; i < MAX_QUERY_PAGES; i++) {
    const res = await notion("POST", `/data_sources/${dataSourceId}/query`, {
      ...body,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    out.push(...(res.results || []));
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return out;
}

function todayJst() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
