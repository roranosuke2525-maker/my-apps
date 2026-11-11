// Worker の動作確認。Gemini API は偽物に差し替える（値はすべて作りもの）。 npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { addCitations } from "../src/worker.js";

const TOKEN = "test-path-token-0123456789";
let kv, calls, reply, hops;
const env = () => ({
  GEMINI_API_KEY: "fake-key",
  MCP_PATH_TOKEN: TOKEN,
  IMAGES: {
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v) => void kv.set(k, v),
    getWithMetadata: async () => ({ value: null }),
  },
});

beforeEach(() => {
  kv = new Map();
  calls = [];
  reply = { status: 200, body: {} };
  hops = new Map(); // 出典の転送用URL → 行き先（Error を入れるとつながらない扱い。無ければ転送なしの 200）
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.startsWith("https://generativelanguage.googleapis.com/")) {
      calls.push({ url: u, method: init.method, redirect: init.redirect, signal: init.signal });
      const to = hops.get(u);
      if (to instanceof Error) throw to;
      return to ? new Response(null, { status: 302, headers: { Location: to } }) : new Response("page", { status: 200 });
    }
    calls.push({ url: u, body: JSON.parse(init.body), headers: init.headers });
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  };
});

const rpc = (method, params = {}, e = env(), token = TOKEN) =>
  worker
    .fetch(new Request(`https://w.test/mcp/${token}`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), e)
    .then((r) => r.json());

const answer = (text, chunks = [], supports = []) => ({
  candidates: [
    {
      content: { parts: [{ text }] },
      groundingMetadata: { groundingChunks: chunks, groundingSupports: supports, webSearchQueries: ["洗濯機 おすすめ"] },
    },
  ],
});
const R = (id) => `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${id}`;

test("合言葉が違うと 404", async () => {
  const r = await worker.fetch(new Request("https://w.test/mcp/wrong", { method: "POST", body: "{}" }), env());
  assert.equal(r.status, 404);
});

test("道具の一覧に絵と調べ物が出る", async () => {
  const r = await rpc("tools/list");
  assert.deepEqual(r.result.tools.map((t) => t.name), ["generate_image", "research", "research_usage"]);
});

test("research：Google 検索つきで頼み、答えと出典を返し、回数を数える", async () => {
  reply.body = answer("## 結論\nA がよい", [
    { web: { uri: "https://a.example/1", title: "a.example" } },
    { web: { uri: "https://a.example/1", title: "a.example" } },
    { web: { uri: "https://b.example/2", title: "b.example" } },
  ]);
  const r = await rpc("tools/call", { name: "research", arguments: { question: "洗濯機 おすすめ", focus: "静かさ" } });
  const text = r.result.content[0].text;
  assert.ok(!r.result.isError);
  assert.match(text, /A がよい/);
  assert.match(text, /出典（2件）/);
  assert.match(text, /https:\/\/b\.example\/2/);
  assert.match(text, /今月 1／300 回/);
  assert.deepEqual(calls[0].body.tools, [{ google_search: {} }]);
  assert.match(calls[0].url, /gemini-flash-latest:generateContent$/);
  assert.match(calls[0].body.contents[0].parts[0].text, /静かさ/);
  assert.equal(calls[0].headers["x-goog-api-key"], "fake-key");
  assert.equal([...kv.values()][0], "1");
});

test("research：月の上限を超えたら Gemini を呼ばずに isError", async () => {
  const e = { ...env(), RESEARCH_MONTHLY_LIMIT: "2" };
  kv.set(`usage:${new Date().toISOString().slice(0, 7)}`, "2");
  const r = await rpc("tools/call", { name: "research", arguments: { question: "x" } }, e);
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /上限（2回）/);
  assert.equal(calls.length, 0);
});

test("research：Gemini のエラーは isError で返し、回数は数えない", async () => {
  reply = { status: 402, body: { error: { message: "Your prepayment credits are depleted" } } };
  const r = await rpc("tools/call", { name: "research", arguments: { question: "x" } });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /Gemini 402/);
  assert.match(r.result.content[0].text, /自分で調べて/);
  assert.equal(kv.size, 0);
});

test("research：質問が空なら isError", async () => {
  const r = await rpc("tools/call", { name: "research", arguments: { question: " " } });
  assert.equal(r.result.isError, true);
  assert.equal(calls.length, 0);
});

test("research_usage：今月の回数を返す", async () => {
  kv.set(`usage:${new Date().toISOString().slice(0, 7)}`, "7");
  const r = await rpc("tools/call", { name: "research_usage" });
  assert.match(r.result.content[0].text, /7／300 回/);
});

test("道具の一覧：research に rules（育成ノートの注意書き）がある", async () => {
  const r = await rpc("tools/list");
  const research = r.result.tools.find((t) => t.name === "research");
  assert.equal(research.inputSchema.properties.rules.type, "string");
  assert.deepEqual(research.inputSchema.required, ["question"]);
});

test("research：文の後ろに出典番号を付け、出典を本当のURLに直す", async () => {
  reply.body = answer(
    "## 結論\nパナソニックの45cm深型が無難。\n## 要点\n- 工事込みで約15万円（2026年8月時点）\n- 海外製は幅60cmが中心",
    [
      { web: { uri: R("a"), title: "www.seikatsu-do.com" } },
      { web: { uri: R("b"), title: "ビルトイン食洗機のおすすめ" } },
      { web: { uri: R("c"), title: "kakaku.com" } },
      { web: { uri: R("a"), title: "www.seikatsu-do.com" } }, // 同じ URL は同じ番号（1）
    ],
    [
      // startIndex／endIndex はバイト数で日本語の文字位置と合わない。使わずに文を探す
      { segment: { startIndex: 9, endIndex: 63, text: "パナソニックの45cm深型が無難。" }, groundingChunkIndices: [1, 0] },
      { segment: { text: "工事込みで約15万円（2026年8月時点）" }, groundingChunkIndices: [3] },
      { segment: { text: "海外製は幅60cmが中心" }, groundingChunkIndices: [2, 1, 2] },
      { segment: { text: "答えに無い文" }, groundingChunkIndices: [0] },
      { segment: { text: "海外製は幅60cmが中心" }, groundingChunkIndices: [9] }, // 出典に無い番号は付けない
    ],
  );
  hops.set(R("a"), "https://www.seikatsu-do.com/dish");
  hops.set(R("b"), "https://my-best.com/12503");
  hops.set(R("c"), new Error("つながらない")); // 直せないときは転送用URLのまま
  const r = await rpc("tools/call", { name: "research", arguments: { question: "ビルトイン食洗機 45cm 深型 比較" } });
  const text = r.result.content[0].text;
  assert.ok(!r.result.isError);
  assert.match(text, /パナソニックの45cm深型が無難。 \[1,2\]\n## 要点/);
  assert.match(text, /- 工事込みで約15万円（2026年8月時点） \[1\]\n/);
  assert.match(text, /- 海外製は幅60cmが中心 \[2,3\]\n/);
  assert.doesNotMatch(text, /答えに無い文/);
  assert.match(text, /## 出典（3件）\n/);
  assert.match(text, /^\[1\] seikatsu-do\.com：https:\/\/www\.seikatsu-do\.com\/dish$/m);
  assert.match(text, /^\[2\] ビルトイン食洗機のおすすめ（my-best\.com）：https:\/\/my-best\.com\/12503$/m);
  assert.match(text, /^\[3\] kakaku\.com（vertexaisearch\.cloud\.google\.com）：https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/c$/m);
  assert.match(text, /検索した言葉：洗濯機 おすすめ/);
  assert.match(text, /今月 1／300 回/);
  const hopsAsked = calls.filter((c) => c.url.startsWith(R("")));
  assert.equal(hopsAsked.length, 3);
  for (const c of hopsAsked) {
    assert.equal(c.method, "GET");
    assert.equal(c.redirect, "manual");
    assert.ok(c.signal, "時間切れの合図を付ける");
  }
  assert.equal([...kv.values()][0], "1");
});

test("research：転送でない・タイトルが無い出典はサイト名で出す。転送先が相対でも直す", async () => {
  reply.body = answer("## 結論\nA", [
    { web: { uri: R("x") } },
    { web: { uri: R("y"), title: "" } },
  ]);
  hops.set(R("y"), "/redirected/page"); // 相対の行き先は転送用URLを基準に読む
  const r = await rpc("tools/call", { name: "research", arguments: { question: "x" } });
  const text = r.result.content[0].text;
  assert.match(text, /^\[1\] vertexaisearch\.cloud\.google\.com：https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/x$/m);
  assert.match(text, /^\[2\] vertexaisearch\.cloud\.google\.com：https:\/\/vertexaisearch\.cloud\.google\.com\/redirected\/page$/m);
  assert.match(text, /^## 結論\nA\n\n## 出典（2件）/);
});

test("research：rules（育成ノートの注意書き）を指示文の最後に足す。1500字まで", async () => {
  reply.body = answer("## 結論\nA");
  await rpc("tools/call", { name: "research", arguments: { question: "x", rules: "  型番は公式ページにあるものだけ書く。  " } });
  const sys = calls[0].body.systemInstruction.parts[0].text;
  assert.match(sys, /^あなたは調べ物の下調べ係/);
  assert.match(sys, /\n\n## 守ること（育成ノート）\n型番は公式ページにあるものだけ書く。$/);

  calls = [];
  await rpc("tools/call", { name: "research", arguments: { question: "x", rules: "あ".repeat(2000) } });
  assert.equal(calls[0].body.systemInstruction.parts[0].text.split("## 守ること（育成ノート）\n")[1].length, 1500);

  calls = [];
  await rpc("tools/call", { name: "research", arguments: { question: "x" } });
  assert.doesNotMatch(calls[0].body.systemInstruction.parts[0].text, /育成ノート/);
});

test("addCitations：末尾の改行の前に書き、同じ所の番号はまとめる", () => {
  const out = addCitations(
    "## 結論\nAがよい\n## 要点\n- B",
    [
      { segment: { text: "Aがよい\n" }, groundingChunkIndices: [1] },
      { segment: { text: "Aがよい" }, groundingChunkIndices: [0] },
      { segment: { text: "   " }, groundingChunkIndices: [0] },
    ],
    [1, 2],
  );
  assert.equal(out, "## 結論\nAがよい [1,2]\n## 要点\n- B");
});

test("addCitations：同じ文が2回あるときは、前に見つけた所の後ろから探す", () => {
  const out = addCitations(
    "- 静か\n- 安い\n- 静か",
    [
      { segment: { text: "静か" }, grounding_chunk_indices: [0] },
      { segment: { text: "安い" }, grounding_chunk_indices: [1] },
      { segment: { text: "静か" }, grounding_chunk_indices: [1] },
    ],
    [1, 2],
  );
  assert.equal(out, "- 静か [1]\n- 安い [2]\n- 静か [2]");
});
