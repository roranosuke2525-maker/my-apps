// Worker の動作確認。Gemini API は偽物に差し替える（値はすべて作りもの）。 npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const TOKEN = "test-path-token-0123456789";
let kv, calls, reply;
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
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  };
});

const rpc = (method, params = {}, e = env(), token = TOKEN) =>
  worker
    .fetch(new Request(`https://w.test/mcp/${token}`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), e)
    .then((r) => r.json());

const answer = (text, chunks = []) => ({
  candidates: [{ content: { parts: [{ text }] }, groundingMetadata: { groundingChunks: chunks, webSearchQueries: ["洗濯機 おすすめ"] } }],
});

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
