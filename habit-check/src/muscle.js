// 💪 からだチェック：写真を Claude に判定してもらい、DB_筋肉チェック に1行残す。
// 写真は Notion にだけ保存する（Worker には残さない・ログにも出さない）。
// 書き込むのは DB_筋肉チェック への行の追加だけ。

import { MUSCLE_TYPE, BASE_DAMAGE, WEEKLY_LIMIT, COMPARE_DAYS, DEFAULT_MODEL, PARTS, VIEWS, improveBonus } from "./muscle-config.js";

const NOTION_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const HISTORY = 60;
const MAX_IMAGE = 4_000_000; // base64 の長さ（約3MB）。画面側で長辺1280pxに縮めて送る

export { MUSCLE_TYPE };

function httpError(status, publicMessage) {
  return Object.assign(new Error(publicMessage), { status, publicMessage });
}
const normalizeId = (id) => (id || "").replace(/-/g, "").toLowerCase();
const jstStamp = (ms) => new Date(ms + 9 * 3600e3).toISOString();
const jstDate = (iso) => jstStamp(Date.parse(iso)).slice(0, 10);
const rich = (s) => [{ type: "text", text: { content: String(s).slice(0, 2000) } }];

// 日本時間のその日が入る週の月曜
export function weekOf(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function configured(env) {
  return { notion: !!env.MUSCLE_DS_ID, ai: !!env.ANTHROPIC_API_KEY };
}

// ---------- 読む ----------
function val(p) {
  if (!p) return null;
  switch (p.type) {
    case "title": return (p.title || []).map((t) => t.plain_text).join("");
    case "rich_text": return (p.rich_text || []).map((t) => t.plain_text).join("");
    case "number": return p.number;
    case "select": return p.select?.name || null;
    case "date": return p.date?.start || null;
    case "files": return (p.files || []).map((f) => f.file?.url || f.external?.url).filter(Boolean);
    case "relation": return (p.relation || []).map((r) => normalizeId(r.id));
    default: return null;
  }
}

export function summarizeRecord(page) {
  const P = page.properties || {};
  const at = val(P["撮影日時"]) || page.created_time;
  return {
    id: normalizeId(page.id),
    url: page.url,
    title: val(P["名前"]) || "",
    at,
    date: jstDate(at),
    score: val(P["総合スコア"]),
    parts: Object.fromEntries(PARTS.map(([k, name]) => [k, val(P[name])])),
    diff: val(P["前回比"]),
    comment: val(P["AIコメント"]) || "",
    confidence: val(P["自信度"]),
    match: val(P["条件一致度"]),
    weight: val(P["体重"]),
    fat: val(P["体脂肪率"]),
    damage: val(P["ボスダメージ"]) || 0,
    compared: val(P["比較した記録"]) || "",
    model: val(P["使ったモデル"]) || "",
    photos: Object.fromEntries(VIEWS.map(([k, , col]) => [k, (val(P[col]) || [])[0] || null])),
  };
}

async function loadRecords(notion, env) {
  const out = [];
  let cursor;
  for (let i = 0; i < 3; i++) {
    const res = await notion("POST", `/data_sources/${env.MUSCLE_DS_ID}/query`, {
      sorts: [{ property: "撮影日時", direction: "descending" }],
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    out.push(...(res.results || []));
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return out.map(summarizeRecord).sort((a, b) => (a.at < b.at ? 1 : -1));
}

// ぼうけん用：ダメージの入った記録（日付と素のダメージ）。DB が読めなければ空
export async function muscleHits(notion, env) {
  if (!env.MUSCLE_DS_ID) return [];
  try {
    return (await loadRecords(notion, env)).filter((r) => r.damage > 0).map((r) => ({ date: r.date, damage: r.damage, score: r.score, diff: r.diff }));
  } catch {
    return [];
  }
}

// 比べる記録：COMPARE_DAYS 日以上前のうち一番新しいもの（なければ null）
export function compareTarget(records, now = Date.now()) {
  const limit = jstStamp(now - COMPARE_DAYS * 864e5).slice(0, 10);
  return records.find((r) => r.date <= limit && typeof r.score === "number") || null;
}

function weekUsed(records, now = Date.now()) {
  const week = weekOf(jstStamp(now).slice(0, 10));
  return records.filter((r) => r.damage > 0 && weekOf(r.date) === week).length >= WEEKLY_LIMIT;
}

export async function getBody(notion, env) {
  const conf = configured(env);
  if (!conf.notion) return { configured: conf, records: [], compare: null, weekUsed: false };
  const records = await loadRecords(notion, env);
  return {
    configured: conf,
    model: env.MUSCLE_MODEL || DEFAULT_MODEL,
    records: records.slice(0, HISTORY),
    compare: compareTarget(records),
    weekUsed: weekUsed(records),
    rules: { base: BASE_DAMAGE, weekly: WEEKLY_LIMIT, compareDays: COMPARE_DAYS, type: MUSCLE_TYPE },
  };
}

// ---------- 判定して残す ----------
function imageData(raw, label) {
  const m = String(raw || "").match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[2].length > MAX_IMAGE) throw httpError(400, `${label}の写真が正しくないか大きすぎます`);
  return { type: m[1], b64: m[2] };
}

function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// 前の写真（Notion の一時URL）を取ってくる。取れなければ比べずに判定する
async function fetchPhoto(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "image/jpeg").match(/image\/(jpeg|png|webp)/)?.[1] || "jpeg";
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE * 0.75) return null;
    return { type, b64: toB64(buf) };
  } catch {
    return null;
  }
}

// 撮影日に一番近い体組成（DB_体組成ログ）。読めなければ null
async function nearestBody(notion, env, now) {
  if (!env.BODY_DS_ID) return null;
  try {
    const res = await notion("POST", `/data_sources/${env.BODY_DS_ID}/query`, {
      sorts: [{ property: "計測日時", direction: "descending" }],
      page_size: 14,
    });
    let best = null;
    for (const p of res.results || []) {
      const at = val(p.properties?.["計測日時"]);
      const weight = val(p.properties?.["体重"]);
      if (!at || typeof weight !== "number") continue;
      const gap = Math.abs(Date.parse(at) - now);
      if (!best || gap < best.gap) best = { gap, weight, fat: val(p.properties?.["体脂肪率"]) };
    }
    return best && best.gap < 7 * 864e5 ? { weight: best.weight, fat: typeof best.fat === "number" ? best.fat : null } : null;
  } catch {
    return null;
  }
}

const LEVEL = ["高", "中", "低"];
const RESULT_TOOL = {
  name: "record_result",
  description: "筋肉のつき具合の判定結果を記録する",
  input_schema: {
    type: "object",
    properties: {
      usable: { type: "boolean", description: "体（上半身）が判定できる写真なら true。人が写っていない・暗すぎる・服で体の線が見えないなら false" },
      reason: { type: "string", description: "usable が false のときの理由（日本語・1文）。true なら空文字" },
      overall: { type: "number", description: "総合スコア 0〜100（筋肉量と引き締まり。一般的な成人男性の平均を50とする）" },
      parts: {
        type: "object",
        properties: Object.fromEntries(PARTS.map(([k, name]) => [k, { type: "number", description: `${name}の発達 1〜10（写っていなければ前回と同じか5）` }])),
        required: PARTS.map(([k]) => k),
        additionalProperties: false,
      },
      confidence: { type: "string", enum: LEVEL, description: "判定の自信度" },
      match: { type: "string", enum: [...LEVEL, "比較なし"], description: "比較用の写真と照明・距離・ポーズ・時間帯がそろっているか。比較用の写真がなければ「比較なし」" },
      comment: { type: "string", description: "日本語で2〜4文。前回より良くなった点（比較があれば）と、次に鍛えるとよい部位。励ますトーンで、断定しすぎない" },
    },
    required: ["usable", "reason", "overall", "parts", "confidence", "match", "comment"],
    additionalProperties: false,
  },
  // 決めた形の答えだけを受け付ける（Sonnet 5.5 などは tool_choice でツールを強制できないため、auto＋strict＋指示で呼ばせる）
  strict: true,
};

function imageBlocks(label, imgs) {
  const out = [];
  for (const [k, name] of VIEWS) {
    if (!imgs[k]) continue;
    out.push({ type: "text", text: `${label}・${name}` });
    out.push({ type: "image", source: { type: "base64", media_type: `image/${imgs[k].type}`, data: imgs[k].b64 } });
  }
  return out;
}

async function judge(env, current, previous, prevRecord, body) {
  const model = env.MUSCLE_MODEL || DEFAULT_MODEL;
  const lines = [
    "筋トレの記録アプリです。本人が自分の体を撮った写真から、筋肉のつき具合を採点してください。医療的な判断はしません。",
    "採点は写真から見える範囲の目安です。照明・ポンプ・むくみで見え方が変わるので、比較用の写真と条件が違うときは match を下げ、スコアは控えめに動かしてください。",
    body ? `撮影日の体重 ${body.weight}kg${typeof body.fat === "number" ? `・体脂肪率 ${body.fat}%` : ""}（参考）。` : "",
    prevRecord
      ? `比較用の写真は ${prevRecord.title} のもので、そのときの総合スコアは ${prevRecord.score} でした。同じ基準で採点し、見た目が変わっていなければ同じ点にしてください。`
      : "比較用の写真はありません（初回など）。match は「比較なし」にしてください。",
    "結果は必ず record_result ツールを1回呼んで返してください。ツールを使わずに文章だけで答えないでください。",
  ].filter(Boolean);
  const content = [...imageBlocks("今回", current), ...(previous ? imageBlocks("比較用", previous) : []), { type: "text", text: lines.join("\n") }];
  let res;
  try {
    res = await fetch(env.ANTHROPIC_API_URL || ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 2000, tools: [RESULT_TOOL], tool_choice: { type: "auto" }, messages: [{ role: "user", content }] }),
    });
  } catch {
    throw httpError(502, "Claude に つながりませんでした");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw httpError(502, "Claude の API キーが正しくありません");
  if (res.status === 429) throw httpError(429, "Claude が混み合っています。少し待ってください");
  if (!res.ok) {
    const why = String(data?.error?.message || "").replace(/\s+/g, " ").slice(0, 140);
    throw httpError(502, `判定できませんでした（Claude ${data?.error?.type || res.status}${why ? `：${why}` : ""}）`);
  }
  if (data.stop_reason === "refusal") throw httpError(502, "判定できませんでした（断られました）。服や写り方を変えて撮り直してください");
  const out = (data.content || []).find((c) => c.type === "tool_use" && c.name === RESULT_TOOL.name)?.input;
  if (!out) throw httpError(502, "判定できませんでした（返事の形が違いました）");
  if (out.usable === false) throw httpError(422, `判定できない写真でした：${String(out.reason || "体が写った写真で撮り直してください").slice(0, 100)}`);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
  return {
    model,
    overall: clamp(out.overall, 0, 100),
    parts: Object.fromEntries(PARTS.map(([k]) => [k, clamp(out.parts?.[k], 1, 10)])),
    confidence: LEVEL.includes(out.confidence) ? out.confidence : "低",
    match: previous ? (LEVEL.includes(out.match) ? out.match : "低") : null,
    comment: String(out.comment || "").slice(0, 1500),
  };
}

// 写真を Notion に上げる（File Upload API）
async function upload(env, img, filename) {
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

// bossId：いま戦っているボス（DB_ものがたり のページ）。記録に「対象ボス」としてつなぐ
export async function postBody(notion, env, body, { bossId = null, now = Date.now() } = {}) {
  const conf = configured(env);
  if (!conf.notion) throw httpError(500, "MUSCLE_DS_ID が設定されていません（wrangler.toml）");
  if (!conf.ai) throw httpError(500, "ANTHROPIC_API_KEY が設定されていません（README の「からだチェック」）");
  const current = {};
  for (const [k, name] of VIEWS) if (body?.[k]) current[k] = imageData(body[k], name);
  if (!current.front) throw httpError(400, "正面の写真は必ず撮ってください");

  const records = await loadRecords(notion, env);
  const prevRecord = compareTarget(records, now);
  const [previous, bodyComp] = await Promise.all([
    (async () => {
      if (!prevRecord) return null;
      const imgs = {};
      for (const [k] of VIEWS) if (current[k] && prevRecord.photos[k]) imgs[k] = await fetchPhoto(prevRecord.photos[k]);
      return Object.values(imgs).some(Boolean) ? Object.fromEntries(Object.entries(imgs).filter(([, v]) => v)) : null;
    })(),
    nearestBody(notion, env, now),
  ]);
  const result = await judge(env, current, previous, previous ? prevRecord : null, bodyComp);

  const diff = previous && typeof prevRecord?.score === "number" ? result.overall - prevRecord.score : null;
  const used = weekUsed(records, now);
  const damage = used ? 0 : BASE_DAMAGE + improveBonus(diff, result.match);

  const stamp = jstStamp(now);
  const title = `${stamp.slice(0, 10)} ${stamp.slice(11, 16)}`;
  const files = {};
  for (const [k, , col] of VIEWS) {
    if (!current[k]) continue;
    const ext = current[k].type === "jpeg" ? "jpg" : current[k].type;
    const name = `body-${stamp.slice(0, 10)}-${k}.${ext}`;
    files[col] = { files: [{ type: "file_upload", file_upload: { id: await upload(env, current[k], name) }, name }] };
  }
  const properties = {
    名前: { title: rich(title) },
    撮影日時: { date: { start: `${stamp.slice(0, 19)}+09:00` } },
    ...files,
    総合スコア: { number: result.overall },
    ...Object.fromEntries(PARTS.map(([k, name]) => [name, { number: result.parts[k] }])),
    ...(diff !== null ? { 前回比: { number: diff } } : {}),
    AIコメント: { rich_text: rich(result.comment) },
    自信度: { select: { name: result.confidence } },
    ...(result.match ? { 条件一致度: { select: { name: result.match } } } : {}),
    ...(bodyComp ? { 体重: { number: bodyComp.weight } } : {}),
    ...(typeof bodyComp?.fat === "number" ? { 体脂肪率: { number: bodyComp.fat } } : {}),
    ボスダメージ: { number: damage },
    ...(bossId ? { 対象ボス: { relation: [{ id: bossId }] } } : {}),
    ...(prevRecord && previous ? { 比較した記録: { rich_text: rich(prevRecord.title) } } : {}),
    使ったモデル: { rich_text: rich(result.model) },
  };
  const page = await notion("POST", "/pages", { parent: { type: "data_source_id", data_source_id: env.MUSCLE_DS_ID }, properties });
  if (normalizeId(page.parent?.data_source_id) && normalizeId(page.parent.data_source_id) !== normalizeId(env.MUSCLE_DS_ID)) {
    throw httpError(500, "DB_筋肉チェック 以外に書き込もうとしました");
  }
  return {
    record: { ...summarizeRecord(page), score: result.overall, parts: result.parts, diff, comment: result.comment, confidence: result.confidence, match: result.match, damage },
    weekUsed: used,
    compared: prevRecord && previous ? prevRecord.title : null,
  };
}
