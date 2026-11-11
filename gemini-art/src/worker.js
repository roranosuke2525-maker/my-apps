// Gemini の画像生成と調べ物を、Claude の「カスタムコネクタ」（リモートMCPサーバー）として使えるようにする Worker。
//   POST /mcp/<MCP_PATH_TOKEN>  … MCP（JSON-RPC。Streamable HTTP の JSON 応答だけを使う）
//   GET  /i/<id>.png            … 描いた絵（30日で消える。id は推測できない長さ）
// キーは Worker の secret にだけ置く：GEMINI_API_KEY（Google AI Studio のキー）、MCP_PATH_TOKEN（URLの合言葉）
// SCRIPT_TOKEN（任意）：Claude Code のスクリプト用の合言葉。コネクタとは別にしておけば、片方だけ入れ替えられる
// 調べ物（research）：Gemini ＋ Google 検索。月の上限は RESEARCH_MONTHLY_LIMIT（既定300回）、回数は KV（IMAGES）の usage:YYYY-MM
//   答えの文に [出典番号] を付け、出典は Google の転送用URLを本当のページのURLに直して返す（確かめる側の手間を減らす）
//   rules（任意）：Notion の「🔎 Gemini 育成ノート」の注意書き。指示文（systemInstruction）の最後に足す

const SERVER = { name: "gemini-art", version: "1.2.0" };
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_MODEL = "gemini-2.5-flash-image";
const RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2"];
const KEEP_SECONDS = 30 * 24 * 60 * 60;
const MAX_INLINE = 1_500_000; // base64 がこれより大きい絵は、チャットには載せずリンクだけ返す
const RESEARCH_MODEL = "gemini-flash-latest";
const RESEARCH_LIMIT = 300;
const RULES_MAX = 1500; // 育成ノートの注意書き（rules）の上限文字数
const RESOLVE_MAX = 15; // 転送用URLを本当のURLに直す出典の数（先頭から）
const RESOLVE_TIMEOUT_MS = 4000;
const RESEARCH_GUIDE = [
  "あなたは調べ物の下調べ係。Google 検索で最新の情報を確かめ、日本語で次の形だけで答える。前置き・あいさつは書かない。",
  "## 結論（1〜2行）",
  "## 要点（箇条書き5つまで。数字・価格・日付には、いつ時点かを付ける）",
  "## 候補（比べるものがあるときだけ。最大5つ。名前／特徴／目安の価格／向いている人 を1行ずつ）",
  "## 注意・不確かなこと（情報が古い・食い違う・見つからない所は、はっきり書く）",
  "分からないことは推測で埋めず「見つからなかった」と書く。",
].join("\n");

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
  {
    name: "research",
    description:
      "Google Gemini に Google 検索つきで調べ物を頼む（下調べ係）。結論・要点・候補・注意と、出典（タイトル・サイト・URL）を日本語で返す。" +
      "文の後ろの [1,3] は、その文の根拠になった出典の番号（出典の一覧の [番号] と対応）。出典の URL は本当のページの URL に直してある（直せなかったものは Google の転送用 URL のまま）。" +
      "Claude は返ってきた内容が足りているか、出典のページで確かめ、足りない所だけ自分で補う。月の上限を超えたときやエラーのときは isError で返るので、そのときは自分で調べる。" +
      "個人名・住所・社内の情報は質問に入れず、一般的な言い方にする。",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "調べたいこと（具体的に。例：『2026年 ドラム式洗濯機 10kg 静音 おすすめ 価格』）" },
        focus: { type: "string", description: "特に知りたい観点（例：価格の相場、比較の候補3つ、手続きの順番）" },
        rules: {
          type: "string",
          description: "Geminiへの注意書き（Notionの🔎 Gemini 育成ノートの『Geminiへの注意書き』をそのまま渡す。1500字まで）",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "research_usage",
    description: "調べ物（research）の今月の使用回数と上限を返す。",
    inputSchema: { type: "object", properties: {} },
  },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const img = url.pathname.match(/^\/i\/([0-9a-f]{32})\.png$/);
    if (img && request.method === "GET") return serveImage(env, img[1]);

    const m = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
    const tokens = [env.MCP_PATH_TOKEN, env.SCRIPT_TOKEN].filter(Boolean);
    if (!m || !tokens.some((t) => safeEqual(m[1], t))) {
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
        instructions:
          "絵が必要なときは generate_image を使う。返ってきた URL を見本に渡すと、同じキャラで描き直せる。" +
          "調べ物はまず research で Gemini に下調べさせ、足りない所だけ自分で補う。" +
          "Notion の「🔎 Gemini 育成ノート」に注意書きがあれば、それを rules に渡す。",
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: TOOLS });
    case "tools/call": {
      const args = params.arguments || {};
      if (params.name === "generate_image") {
        try {
          return result(id, await generateImage(args, env, origin));
        } catch (e) {
          return result(id, { isError: true, content: [{ type: "text", text: `絵を描けませんでした：${e.message}` }] });
        }
      }
      if (params.name === "research") {
        try {
          return result(id, await research(args, env));
        } catch (e) {
          return result(id, { isError: true, content: [{ type: "text", text: `Gemini で調べられませんでした：${e.message}（Claude が自分で調べてください）` }] });
        }
      }
      if (params.name === "research_usage") {
        const { used, limit } = await researchCount(env);
        return result(id, { content: [{ type: "text", text: `今月の調べ物：${used}／${limit} 回` }] });
      }
      return rpcError(id, -32602, `unknown tool: ${params.name}`);
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

// 調べ物：Gemini ＋ Google 検索。成功したときだけ回数を数える
export async function research(args, env) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY が Worker に登録されていません");
  const question = String(args.question || "").trim();
  if (!question) throw new Error("question が空です");
  if (question.length > 2000) throw new Error("question が長すぎます（2000文字まで）");
  const focus = String(args.focus || "").trim().slice(0, 500);
  const rules = String(args.rules || "").trim().slice(0, RULES_MAX);

  const { used, limit, key } = await researchCount(env);
  if (used >= limit) throw new Error(`今月の上限（${limit}回）に達しました`);

  const today = new Date().toISOString().slice(0, 10);
  const text = `今日は ${today}。\n調べたいこと：${question}${focus ? `\n特に知りたいこと：${focus}` : ""}`;
  const guide = rules ? `${RESEARCH_GUIDE}\n\n## 守ること（育成ノート）\n${rules}` : RESEARCH_GUIDE;
  const model = env.RESEARCH_MODEL || RESEARCH_MODEL;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: guide }] },
      contents: [{ role: "user", parts: [{ text }] }],
      tools: [{ google_search: {} }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data.error?.message || "エラー"}`);
  const cand = data.candidates?.[0];
  const answer = (cand?.content?.parts || []).map((p) => p.text).filter(Boolean).join("").trim();
  if (!answer) throw new Error(cand?.finishReason || data.promptFeedback?.blockReason || "答えが返ってきませんでした");

  const meta = cand.groundingMetadata || cand.grounding_metadata || {};
  const { sources, numberOf } = collectSources(meta.groundingChunks || meta.grounding_chunks || []);
  const cited = addCitations(answer, meta.groundingSupports || meta.grounding_supports || [], numberOf);
  await Promise.all(sources.slice(0, RESOLVE_MAX).map(async (s) => void (s.url = await resolveUrl(s.uri))));
  const queries = meta.webSearchQueries || meta.web_search_queries || [];

  await env.IMAGES.put(key, String(used + 1), { expirationTtl: 40 * 24 * 60 * 60 });
  const tail = [
    `## 出典（${sources.length}件）`,
    sources.length ? sources.map(sourceLine).join("\n") : "- （出典が返ってきませんでした）",
    queries.length ? `\n検索した言葉：${queries.join("／")}` : "",
    `\n（Gemini ${model}・今月 ${used + 1}／${limit} 回）`,
  ].filter(Boolean).join("\n");
  return { content: [{ type: "text", text: `${cited}\n\n${tail}` }] };
}

// 出典に groundingChunks の順で 1..n の番号を振る（同じ URL は同じ番号）。numberOf[チャンクの位置] = 出典番号
export function collectSources(chunks) {
  const sources = [];
  const byUri = new Map();
  const numberOf = [];
  chunks.forEach((c, i) => {
    const w = (c && c.web) || {};
    if (!w.uri) return;
    if (!byUri.has(w.uri)) {
      sources.push({ n: sources.length + 1, title: String(w.title || "").trim(), uri: w.uri, url: w.uri });
      byUri.set(w.uri, sources.length);
    }
    numberOf[i] = byUri.get(w.uri);
  });
  return { sources, numberOf };
}

// 根拠（groundingSupports）の出典番号を、その文のすぐ後ろに「 [1,3]」の形で書き込む。
// startIndex／endIndex はバイト数のことがあり日本語ではずれるので使わず、segment.text を答えの中から探す
// （前に見つけた所の後ろから探し、無ければ全体から。見つからなければ書かない）
export function addCitations(answer, supports, numberOf) {
  const at = new Map(); // 書き込む位置 → 出典番号
  let cursor = 0;
  for (const s of supports || []) {
    const raw = String(s?.segment?.text || "");
    const idx = s?.groundingChunkIndices || s?.grounding_chunk_indices || [];
    const nums = [...new Set(idx.map((i) => numberOf[i]).filter(Boolean))];
    if (!raw.trim() || !nums.length) continue;
    let found = null;
    for (const part of raw === raw.trim() ? [raw] : [raw, raw.trim()]) {
      let pos = answer.indexOf(part, cursor);
      if (pos < 0) pos = answer.indexOf(part);
      if (pos >= 0) {
        found = { pos, part };
        break;
      }
    }
    if (!found) continue;
    const end = found.pos + found.part.trimEnd().length; // 末尾の改行の後ろには書かない（見出しが崩れるため）
    cursor = found.pos + found.part.length;
    const set = at.get(end) || new Set();
    for (const n of nums) set.add(n);
    at.set(end, set);
  }
  let out = answer;
  for (const end of [...at.keys()].sort((a, b) => b - a)) {
    out = `${out.slice(0, end)} [${[...at.get(end)].sort((a, b) => a - b).join(",")}]${out.slice(end)}`;
  }
  return out;
}

// Google の転送用URL（vertexaisearch.cloud.google.com/grounding-api-redirect/…）を、行き先の本当のURLに直す。
// 転送を1回だけ見る（中身は読まない）。時間切れ・エラー・転送でないときは元のURLのまま
export async function resolveUrl(uri) {
  try {
    const res = await fetch(uri, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    try {
      res.body?.cancel().catch(() => {});
    } catch {
      // 中身を捨てられなくても答えには関係ない
    }
    if (loc) return new URL(loc, uri).href;
  } catch {
    // つながらない・時間切れ・行き先が読めない
  }
  return uri;
}

// 出典の1行：[n] タイトル（サイト）：URL。タイトルが無い・サイト名と同じなら [n] サイト：URL
function sourceLine(s) {
  const site = siteOf(s.url);
  const title = s.title;
  if (!site) return `[${s.n}] ${title || "（タイトルなし）"}：${s.url}`;
  if (!title || title.toLowerCase().replace(/^www\./, "") === site) return `[${s.n}] ${site}：${s.url}`;
  return `[${s.n}] ${title}（${site}）：${s.url}`;
}

function siteOf(u) {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function researchCount(env) {
  const key = `usage:${new Date().toISOString().slice(0, 7)}`;
  const limit = Number(env.RESEARCH_MONTHLY_LIMIT) || RESEARCH_LIMIT;
  const used = Number(await env.IMAGES.get(key)) || 0;
  return { used, limit, key };
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
