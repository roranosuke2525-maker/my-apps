// Gemini の画像生成を、Claude の「カスタムコネクタ」（リモートMCPサーバー）として使えるようにする Worker。
//   POST /mcp/<MCP_PATH_TOKEN>  … MCP（JSON-RPC。Streamable HTTP の JSON 応答だけを使う）
//   GET  /i/<id>.png            … 描いた絵（30日で消える。id は推測できない長さ）
// キーは Worker の secret にだけ置く：GEMINI_API_KEY（Google AI Studio のキー）、MCP_PATH_TOKEN（URLの合言葉）

const SERVER = { name: "gemini-art", version: "1.0.0" };
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_MODEL = "gemini-2.5-flash-image";
const RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2"];
const KEEP_SECONDS = 30 * 24 * 60 * 60;
const MAX_INLINE = 1_500_000; // base64 がこれより大きい絵は、チャットには載せずリンクだけ返す

const TOOLS = [
  {
    name: "generate_image",
    description:
      "Google Gemini で絵を1枚描く。日本語の指示でもよいが、英語のほうが狙いどおりになりやすい。" +
      "前に描いた絵（このツールが返した URL）を reference_image_urls に渡すと、同じキャラ・絵柄のまま描き直せる。" +
      "返り値に絵と、30日間ひらける URL が入る。1枚あたり数円かかる。",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "描きたいもの（絵柄・構図・背景まで書くとよい）" },
        aspect_ratio: { type: "string", enum: RATIOS, description: "縦横比（省略時 1:1）" },
        reference_image_urls: {
          type: "array",
          items: { type: "string" },
          maxItems: 3,
          description: "見本にする絵の URL（https。最大3枚）",
        },
      },
      required: ["prompt"],
    },
  },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const img = url.pathname.match(/^\/i\/([0-9a-f]{32})\.png$/);
    if (img && request.method === "GET") return serveImage(env, img[1]);

    const m = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
    if (!m || !env.MCP_PATH_TOKEN || !safeEqual(m[1], env.MCP_PATH_TOKEN)) {
      return new Response("not found", { status: 404 });
    }
    if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });

    let body;
    try {
      body = await request.json();
    } catch {
      return json(rpcError(null, -32700, "parse error"));
    }
    const origin = url.origin;
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((msg) => handle(msg, env, origin)))).filter(Boolean);
      return out.length ? json(out) : new Response(null, { status: 202 });
    }
    const out = await handle(body, env, origin);
    return out ? json(out) : new Response(null, { status: 202 });
  },
};

async function handle(msg, env, origin) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return msg && "id" in msg ? rpcError(msg.id, -32600, "invalid request") : null;
  }
  const isNotice = !("id" in msg);
  if (isNotice) return null; // notifications/initialized など。返事はいらない
  const { id, method, params = {} } = msg;
  switch (method) {
    case "initialize": {
      const v = PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0];
      return result(id, {
        protocolVersion: v,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: "絵が必要なときは generate_image を使う。返ってきた URL を見本に渡すと、同じキャラで描き直せる。",
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: TOOLS });
    case "tools/call": {
      if (params.name !== "generate_image") return rpcError(id, -32602, `unknown tool: ${params.name}`);
      try {
        return result(id, await generateImage(params.arguments || {}, env, origin));
      } catch (e) {
        return result(id, { isError: true, content: [{ type: "text", text: `絵を描けませんでした：${e.message}` }] });
      }
    }
    default:
      return rpcError(id, -32601, `method not found: ${method}`);
  }
}

export async function generateImage(args, env, origin) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY が Worker に登録されていません");
  const prompt = String(args.prompt || "").trim();
  if (!prompt) throw new Error("prompt が空です");
  const ratio = RATIOS.includes(args.aspect_ratio) ? args.aspect_ratio : "1:1";
  const refs = Array.isArray(args.reference_image_urls) ? args.reference_image_urls.slice(0, 3) : [];

  const parts = [{ text: prompt }];
  for (const ref of refs) parts.push(await refPart(ref, env, origin));

  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: ratio } },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data.error?.message || "エラー"}`);
  const got = data.candidates?.[0]?.content?.parts || [];
  const pic = got.find((p) => p.inlineData || p.inline_data);
  if (!pic) {
    const why = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || "絵が返ってきませんでした";
    const said = got.map((p) => p.text).filter(Boolean).join(" ");
    throw new Error(`${why}${said ? `（${said.slice(0, 200)}）` : ""}`);
  }
  const inline = pic.inlineData || pic.inline_data;
  const mime = inline.mimeType || inline.mime_type || "image/png";

  const id = randomId();
  await env.IMAGES.put(id, base64ToBytes(inline.data), { expirationTtl: KEEP_SECONDS, metadata: { mime } });
  const link = `${origin}/i/${id}.png`;
  const note = got.map((p) => p.text).filter(Boolean).join(" ").trim();

  const content = [{ type: "text", text: `描けました：${link}（30日間ひらけます）${note ? `\n${note}` : ""}` }];
  if (inline.data.length <= MAX_INLINE) content.unshift({ type: "image", data: inline.data, mimeType: mime });
  return { content };
}

// 見本の絵：この Worker の絵なら KV から直接、ほかの https はダウンロードして渡す
async function refPart(ref, env, origin) {
  let u;
  try {
    u = new URL(ref);
  } catch {
    throw new Error(`見本の URL が読めません：${ref}`);
  }
  const own = u.origin === origin && u.pathname.match(/^\/i\/([0-9a-f]{32})\.png$/);
  if (own) {
    const hit = await env.IMAGES.getWithMetadata(own[1], { type: "arrayBuffer" });
    if (!hit.value) throw new Error(`見本の絵が見つかりません（30日で消えます）：${ref}`);
    return { inline_data: { mime_type: hit.metadata?.mime || "image/png", data: bytesToBase64(hit.value) } };
  }
  if (u.protocol !== "https:") throw new Error("見本の URL は https だけです");
  const res = await fetch(u);
  const type = (res.headers.get("content-type") || "").split(";")[0];
  if (!res.ok || !type.startsWith("image/")) throw new Error(`見本の絵を取れませんでした：${ref}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 7_000_000) throw new Error("見本の絵が大きすぎます（7MBまで）");
  return { inline_data: { mime_type: type, data: bytesToBase64(buf) } };
}

async function serveImage(env, id) {
  const hit = await env.IMAGES.getWithMetadata(id, { type: "arrayBuffer" });
  if (!hit.value) return new Response("not found", { status: 404 });
  return new Response(hit.value, {
    headers: { "Content-Type": hit.metadata?.mime || "image/png", "Cache-Control": "private, max-age=86400" },
  });
}

const json = (v) => new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
const result = (id, r) => ({ jsonrpc: "2.0", id, result: r });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

function randomId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function base64ToBytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(buf) {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
