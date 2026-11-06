import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const PNG = Buffer.from("fake-png").toString("base64");

function kv() {
  const m = new Map();
  return {
    async put(k, v, o) { m.set(k, { v, meta: o?.metadata }); },
    async getWithMetadata(k) { const e = m.get(k); return { value: e ? e.v.buffer.slice(0) : null, metadata: e?.meta }; },
  };
}
const env = () => ({ MCP_PATH_TOKEN: "secret123", GEMINI_API_KEY: "k", IMAGES: kv() });
const call = (e, body, path = "/mcp/secret123") =>
  worker.fetch(new Request(`https://art.example${path}`, { method: "POST", body: JSON.stringify(body) }), e);

test("合言葉が違えば 404", async () => {
  const res = await call(env(), { jsonrpc: "2.0", id: 1, method: "initialize" }, "/mcp/wrong");
  assert.equal(res.status, 404);
});

test("initialize と tools/list", async () => {
  const e = env();
  const init = await (await call(e, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).json();
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.ok(init.result.capabilities.tools);
  const notice = await call(e, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(notice.status, 202);
  const list = await (await call(e, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  assert.deepEqual(list.result.tools.map((t) => t.name), ["generate_image"]);
});

test("generate_image：絵を返して、URL でひらける。見本も渡せる", async () => {
  const e = env();
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG } }] } }] }));
  };
  const r1 = await (await call(e, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "generate_image", arguments: { prompt: "a hero", aspect_ratio: "3:4" } } })).json();
  assert.equal(r1.result.content[0].type, "image");
  const link = r1.result.content[1].text.match(/https:\S+\.png/)[0];
  assert.equal(sent[0].body.generationConfig.imageConfig.aspectRatio, "3:4");

  const img = await worker.fetch(new Request(link), e);
  assert.equal(img.status, 200);
  assert.equal(Buffer.from(await img.arrayBuffer()).toString(), "fake-png");

  await call(e, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "generate_image", arguments: { prompt: "same hero", reference_image_urls: [link] } } });
  assert.equal(sent[1].body.contents[0].parts[1].inline_data.data, PNG);
});

test("Gemini のエラーは isError で返す", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 });
  const r = await (await call(env(), { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "generate_image", arguments: { prompt: "x" } } })).json();
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /429.*quota/);
});
