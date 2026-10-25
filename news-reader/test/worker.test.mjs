// Worker と本文抽出の動作確認。Notion API・記事のサイト・通知サーバーは偽物に差し替える。 npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { extractArticle } from "../src/extract.js";

const DS = "62ba6b9f-d216-49d8-96b2-cf2ce0e09cdd";
const KEY = "test-key-0123456789";
const A1 = "1".repeat(32);
const A2 = "2".repeat(32);
const A3 = "3".repeat(32);
const EVIL = "4".repeat(32);
const OTHER = "9".repeat(32);

const text = (s) => [{ plain_text: s }];
function news(id, { title, paper, frame = "全国", topic, count, state = "未読", url, paid = false, date = "2026-10-26", ds = DS }) {
  return {
    object: "page",
    id,
    parent: { type: "data_source_id", data_source_id: ds },
    properties: {
      見出し: { type: "title", title: text(title) },
      新聞社: { type: "select", select: { name: paper } },
      枠: { type: "select", select: { name: frame } },
      話題: { type: "rich_text", rich_text: text(topic) },
      社数: { type: "number", number: count },
      一言要約: { type: "rich_text", rich_text: text(`${title}の要約`) },
      "🔒有料": { type: "checkbox", checkbox: paid },
      状態: { type: "select", select: { name: state } },
      日付: { type: "date", date: { start: date } },
      URL: { type: "url", url },
    },
  };
}

class FakeKV {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v) { this.map.set(k, v); }
  async delete(k) { this.map.delete(k); }
  async list({ prefix }) { return { keys: [...this.map.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; }
}

let pages;
let writes;
let siteFetches;
let pushes;
let env;

beforeEach(() => {
  pages = new Map(
    [
      news(A1, { title: "那覇市長に知念氏の再選確実", paper: "東京", topic: "2社｜那覇市長選で知念氏再選", count: 2, url: "https://www.tokyo-np.co.jp/article/1" }),
      news(A2, { title: "【速報】那覇市長選で知念氏の再選確実", paper: "時事", topic: "2社｜那覇市長選で知念氏再選", count: 2, url: "https://www.jiji.com/jc/article?k=1" }),
      news(A3, { title: "健大高崎、決勝へ", paper: "上毛", frame: "地元", topic: "1社｜健大高崎決勝へ", count: 1, state: "読んだ", url: "https://www.jomo-news.co.jp/articles/-/1" }),
      news(EVIL, { title: "あやしいURL", paper: "日経", topic: "1社｜x", count: 1, url: "https://evil.example/article" }),
      news(OTHER, { title: "別のDB", paper: "日経", topic: "1社｜y", count: 1, url: "https://www.nikkei.com/article/x", ds: "other-ds" }),
    ].map((p) => [p.id, p]),
  );
  writes = [];
  siteFetches = [];
  pushes = [];
  env = {
    NOTION_TOKEN: "ntn_fake",
    APP_KEY: KEY,
    NEWS_DS_ID: DS,
    NOTION_API_BASE: "https://notion.test/v1",
    ASSETS: { fetch: async () => new Response("asset") },
  };
});

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const method = init.method || "GET";
  if (url.startsWith("https://notion.test/v1")) {
    const path = url.slice("https://notion.test/v1".length);
    const body = init.body ? JSON.parse(init.body) : null;
    if (method === "POST" && path === `/data_sources/${DS}/query`) {
      let results = [...pages.values()].filter((p) => p.parent.data_source_id === DS);
      const f = body.filter;
      if (f?.select?.equals) results = results.filter((p) => p.properties.状態.select.name === f.select.equals);
      return Response.json({ results, has_more: false });
    }
    const m = path.match(/^\/pages\/(\w+)$/);
    if (m && pages.has(m[1])) {
      const page = pages.get(m[1]);
      if (method === "PATCH") {
        writes.push({ id: m[1], ...body });
        page.properties.状態.select = { name: body.properties.状態.select.name };
      }
      return Response.json(page);
    }
    return Response.json({ code: "object_not_found" }, { status: 404 });
  }
  if (url.startsWith("https://www.jiji.com/")) {
    siteFetches.push(url);
    return new Response(
      `<html><head><meta property="og:title" content="那覇市長選：時事ドットコム"><meta property="og:image" content="https://www.jiji.com/a.jpg"></head>
       <body><div class="ArticleBlock"><p>那覇市長選は２５日投開票され、知念氏が再選を確実にした。</p><p>【図解】選挙結果</p><p>投票率は過去最低だった。</p></div>
       <div class="ranking"><p>ランキングの見出しがここに並ぶ長いテキストです。ランキングの見出し。</p></div></body></html>`,
      { headers: { "Content-Type": "text/html" } },
    );
  }
  if (url.startsWith("https://web.push.apple.com/")) {
    pushes.push({ url, headers: init.headers });
    return new Response(null, { status: url.endsWith("gone") ? 410 : 201 });
  }
  throw new Error(`unexpected fetch ${url}`);
};

function call(path, { method = "GET", body, key = KEY } = {}) {
  return worker.fetch(
    new Request(`https://news.test${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
  );
}

test("合言葉が違うと 401", async () => {
  const res = await call("/api/articles", { key: "wrong-key-000000000" });
  assert.equal(res.status, 401);
});

test("未読の一覧と新聞社ごとの数を返す（他のDBの行は出さない）", async () => {
  const res = await call("/api/articles?scope=unread");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.articles.map((a) => a.id).sort(), [A1, A2, EVIL].sort());
  assert.equal(data.unread, 3);
  assert.deepEqual(data.unreadByPaper, { 東京: 1, 時事: 1, 日経: 1 });
  const a = data.articles.find((x) => x.id === A1);
  assert.equal(a.topicName, "那覇市長選で知念氏再選");
  assert.equal(a.topicCount, 2);
  assert.equal(a.paper, "東京");
  assert.equal(a.url, "https://www.tokyo-np.co.jp/article/1");
});

test("最近の一覧でも未読の数は未読だけで数える", async () => {
  const data = await (await call("/api/articles?scope=recent")).json();
  assert.equal(data.articles.length, 4);
  assert.equal(data.unread, 3);
  assert.deepEqual(data.unreadItems.map((x) => x.id).sort(), [A1, A2, EVIL].sort());
});

test("状態は 未読・読んだ・📚 送る だけに変えられる", async () => {
  let res = await call(`/api/articles/${A1}`, { method: "PATCH", body: { state: "読んだ" } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).article.state, "読んだ");
  res = await call(`/api/articles/${A1}`, { method: "PATCH", body: { state: "📚 送り済" } });
  assert.equal(res.status, 400);
  assert.equal(writes.length, 1);
});

test("DB_ニュース 以外のページは書き換えない・読まない", async () => {
  let res = await call(`/api/articles/${OTHER}`, { method: "PATCH", body: { state: "読んだ" } });
  assert.equal(res.status, 403);
  res = await call(`/api/articles/${OTHER}/body`);
  assert.equal(res.status, 403);
  assert.equal(writes.length, 0);
  assert.equal(siteFetches.length, 0);
});

test("本文：決まったサイトから取り、本文の段落だけを返す", async () => {
  const res = await call(`/api/articles/${A2}/body`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.paragraphs, ["那覇市長選は２５日投開票され、知念氏が再選を確実にした。", "投票率は過去最低だった。"]);
  assert.equal(data.image, "https://www.jiji.com/a.jpg");
  assert.equal(data.article.id, A2);
  assert.deepEqual(siteFetches, ["https://www.jiji.com/jc/article?k=1"]);
});

test("本文：許可していないサイトには取りに行かない", async () => {
  const data = await (await call(`/api/articles/${EVIL}/body`)).json();
  assert.deepEqual(data.paragraphs, []);
  assert.match(data.note, /表示できません/);
  assert.equal(siteFetches.length, 0);
});

test("通知：KV が無ければオフと答える", async () => {
  const data = await (await call("/api/push/key")).json();
  assert.equal(data.enabled, false);
});

test("通知：鍵を作り、登録した端末へ中身の無い通知を送る。消えた宛先は捨てる", async () => {
  env.NEWS_KV = new FakeKV();
  const key = await (await call("/api/push/key")).json();
  assert.equal(key.enabled, true);
  assert.match(key.publicKey, /^[A-Za-z0-9_-]{87}$/);
  assert.equal((await (await call("/api/push/key")).json()).publicKey, key.publicKey);

  let res = await call("/api/push/subscribe", { method: "POST", body: { subscription: { endpoint: "https://evil.example/push" } } });
  assert.equal(res.status, 400);
  await call("/api/push/subscribe", { method: "POST", body: { subscription: { endpoint: "https://web.push.apple.com/abc" } } });
  await call("/api/push/subscribe", { method: "POST", body: { subscription: { endpoint: "https://web.push.apple.com/gone" } } });

  const r = await (await call("/api/push/test", { method: "POST" })).json();
  assert.deepEqual(r, { sent: 1, failed: 1, enabled: true });
  const auth = pushes[0].headers.Authorization;
  assert.match(auth, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
  const claims = JSON.parse(Buffer.from(auth.split(" ")[1].slice(2).split(".")[1], "base64url").toString());
  assert.equal(claims.aud, "https://web.push.apple.com");
  assert.equal(claims.sub, "https://news.test");
  assert.equal([...env.NEWS_KV.map.keys()].filter((k) => k.startsWith("sub:")).length, 1);
});

test("定期実行：未読があるときだけ通知する", async () => {
  env.NEWS_KV = new FakeKV();
  await call("/api/push/subscribe", { method: "POST", body: { subscription: { endpoint: "https://web.push.apple.com/abc" } } });
  const run = async () => {
    const waits = [];
    await worker.scheduled({}, env, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  };
  await run();
  assert.equal(pushes.length, 1);
  for (const p of pages.values()) p.properties.状態.select = { name: "読んだ" };
  await run();
  assert.equal(pushes.length, 1);
});

// ---------- 本文抽出（各社のページの作りを小さく再現） ----------
test("抽出：日経は paragraph_ の段落", () => {
  const html = `<meta property="og:title" content="見出し - 日本経済新聞"><article><p class="item_x">案内文です。案内文です。案内文です。</p>
    <p class="paragraph_p18mfke4">一段落目。</p><figure><figcaption>写真説明</figcaption></figure><p class="paragraph_p18mfke4">二段落目&amp;続き。</p></article>`;
  const a = extractArticle(html, "https://www.nikkei.com/article/x/");
  assert.equal(a.title, "見出し");
  assert.deepEqual(a.paragraphs, ["一段落目。", "二段落目&続き。"]);
});

test("抽出：東京新聞は #entry .block を改行で区切り、写真の説明は除く", () => {
  const html = `<div class="l-container" id="entry"><div class="block">　一段落目の文。<br><div class="hide"><div class="wrap"><p>写真の説明</p></div></div><br>　◆小見出し<br>　二段落目の文。</div></div>
    <div class="other"><p>関係ない文章がここに入っています。関係ない文章。</p></div>`;
  const a = extractArticle(html, "https://www.tokyo-np.co.jp/article/1");
  assert.deepEqual(a.paragraphs, ["一段落目の文。", "◆小見出し", "二段落目の文。"]);
});

test("抽出：上毛は .article-body の段落", () => {
  const html = `<div class="article-body"><p>高校野球の秋季関東大会は25日行われた。</p><script>var p = "<p>x</p>";</script><p>決勝は26日。</p></div>`;
  const a = extractArticle(html, "https://www.jomo-news.co.jp/articles/-/1");
  assert.deepEqual(a.paragraphs, ["高校野球の秋季関東大会は25日行われた。", "決勝は26日。"]);
});

test("抽出：決まりの無いサイトは一番長い段落のまとまり、無ければ説明文", () => {
  const html = `<meta name="description" content="説明文"><nav><p>メニューの文字はここです。メニュー。</p></nav>
    <main><div class="body"><p>本文の一段落目はこれくらいの長さがあります。</p><p>本文の二段落目もこれくらいの長さがあります。</p></div></main>`;
  assert.deepEqual(extractArticle(html, "https://mainichi.jp/articles/1").paragraphs, [
    "本文の一段落目はこれくらいの長さがあります。",
    "本文の二段落目もこれくらいの長さがあります。",
  ]);
  assert.deepEqual(extractArticle(`<meta name="description" content="説明文">`, "https://mainichi.jp/x").paragraphs, ["説明文"]);
});
