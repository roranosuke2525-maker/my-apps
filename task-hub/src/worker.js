// 今どこ：画面の配信と Notion API の中継（Cloudflare Worker）
// Notion のトークンはこの Worker の secret にだけ置き、ブラウザには渡さない。
// 画面（public/index.html）はアーティファクト版と同じもの。画面が Notion の MCP に出す4つの道具
// （fetch・query・update・create）を、ここで Notion API に置き換えて、MCP と同じ形で返す。

const NOTION_BASE = "https://api.notion.com/v1";
const API_VERSION = "2025-09-03"; // データソース・ページのプロパティ
const MD_VERSION = "2026-03-11"; // 本文の Markdown（Notion-flavored Markdown＝markdown_version v2）

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      checkConfig(env);
      if (!authorized(request, env)) return json({ error: "合言葉が違います", code: "bad_key" }, 401);
      if (url.pathname === "/api/ping" && request.method === "GET") return json({ ok: true });
      if (url.pathname === "/api/notion" && request.method === "POST") {
        const body = await readJson(request);
        return json(await runTool(notionClient(env), body.tool, body.input || {}));
      }
      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: err.publicMessage || "サーバーでエラーが起きました", code: err.code || "server_error" }, err.status || 500);
    }
  },
};

// ---------- 設定・合言葉 ----------
function checkConfig(env) {
  if (!env.NOTION_TOKEN || !env.APP_KEY || env.APP_KEY.length < 16) throw httpError(500, "Worker の設定（NOTION_TOKEN / APP_KEY）が足りません", "config");
}
function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  return constantTimeEqual(header.startsWith("Bearer ") ? header.slice(7) : "", env.APP_KEY);
}
function constantTimeEqual(a, b) {
  const enc = new TextEncoder(); const x = enc.encode(a); const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) diff |= (x[i] ?? 0) ^ y[i];
  return diff === 0;
}
function httpError(status, publicMessage, code) { return Object.assign(new Error(publicMessage), { status, publicMessage, code }); }
async function readJson(request) { try { return await request.json(); } catch { throw httpError(400, "JSON が読めません", "bad_request"); } }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }); }

function notionClient(env) {
  const base = env.NOTION_API_BASE || NOTION_BASE;
  return async (method, path, body, version = API_VERSION) => {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, "Notion-Version": version, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.code === "object_not_found" ? "Notion でこのページ・データベースにインテグレーションが接続されていません（README の手順1）"
        : data.code === "unauthorized" ? "Notion のトークンが正しくありません"
        : data.code === "rate_limited" ? "Notion が混み合っています。少し待ってください"
        : data.code === "restricted_resource" ? "インテグレーションに読み取り・更新・挿入の機能がありません（README の手順1）"
        : String(data.message || `Notion エラー（${data.code || res.status}）`).slice(0, 300);
      throw httpError(res.status === 429 ? 429 : res.status === 400 ? 400 : 502, msg, data.code === "rate_limited" ? "rate_limited" : "tool_error");
    }
    return data;
  };
}

// ---------- 道具（MCP と同じ名前・同じ返事の形） ----------
const ID32 = /([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})(?:[?#].*)?$/i;
export function normalizeId(v) {
  const m = String(v || "").replace(/^collection:\/\//, "").match(ID32);
  if (!m) throw httpError(400, "ページのIDが読めません", "bad_request");
  return m[1].replace(/-/g, "").toLowerCase();
}
const pageUrl = (id) => `https://www.notion.so/${String(id).replace(/-/g, "")}`;

export async function runTool(notion, tool, input) {
  if (tool === "notion-fetch") return fetchTool(notion, input);
  if (tool === "notion-query-data-sources") return queryTool(notion, input);
  if (tool === "notion-update-page") return updateTool(notion, input);
  if (tool === "notion-create-pages") return createTool(notion, input);
  throw httpError(400, "使えない操作です", "bad_request");
}

// fetch：データソースは名前と列の型、ページは本文の Markdown
async function fetchTool(notion, { id }) {
  if (String(id).startsWith("collection://")) {
    const ds = await notion("GET", `/data_sources/${normalizeId(id)}`);
    const title = plain(ds.title);
    const schema = Object.fromEntries(Object.entries(ds.properties || {}).map(([name, p]) => [name, { name, type: p.type }]));
    return { title, text: `The title of this Data Source is: ${title}\n<data-source-state>\n${JSON.stringify({ name: title, schema })}\n</data-source-state>` };
  }
  const pid = normalizeId(id);
  const md = await notion("GET", `/pages/${pid}/markdown?markdown_version=v2`, null, MD_VERSION);
  return { id: pid, truncated: !!md.truncated, unknown_block_ids: md.unknown_block_ids || [], text: `<content>\n${md.markdown || ""}\n</content>` };
}

// query：行を MCP の rows モードと同じ平らな形にする
async function queryTool(notion, { data }) {
  if (!data || data.mode !== "rows") throw httpError(400, "rows モードだけ使えます", "bad_request");
  const body = { page_size: Math.min(100, Math.max(1, data.limit || 50)) };
  if (data.filter) { body.filter = toFilter(data.filter); if (depth(body.filter) > 3) throw httpError(400, "絞り込みの入れ子が深すぎます（Notion API は2段まで）", "bad_request"); }
  if (data.sort?.length) body.sorts = data.sort.map((s) => (s.property === "最終更新日時" ? { timestamp: "last_edited_time", direction: s.direction } : { property: s.property, direction: s.direction }));
  const res = await notion("POST", `/data_sources/${normalizeId(data.data_source_url)}/query`, body);
  return { results: (res.results || []).filter((p) => p.object === "page").map(flatPage), has_more: !!res.has_more };
}
export function jstToday(now = Date.now()) { return new Date(now + 9 * 3600e3).toISOString().slice(0, 10); }
const addDay = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function relDate(v) { const t = jstToday(); return { today: t, tomorrow: addDay(t, 1), yesterday: addDay(t, -1), one_week_ago: addDay(t, -7), one_week_from_now: addDay(t, 7) }[v] || t; }
const depth = (f) => (f.and || f.or ? 1 + Math.max(0, ...(f.and || f.or).map(depth)) : 1);
export function toFilter(f) {
  if (f.type === "group") return { [f.operator === "or" ? "or" : "and"]: f.filters.map(toFilter) };
  const { property, propertyType: t, operator: op } = f; const v = f.value?.value;
  if (op === "is_empty" || op === "is_not_empty") return { property, [t]: { [op]: true } };
  if (t === "status") return { property, status: { [op === "status_is" ? "equals" : "does_not_equal"]: v } };
  if (t === "select") return { property, select: { [op === "enum_is" ? "equals" : "does_not_equal"]: v } };
  if (t === "multi_select") return { property, multi_select: { [op === "enum_contains" ? "contains" : "does_not_contain"]: v } };
  if (t === "checkbox") return { property, checkbox: { [op === "checkbox_is" ? "equals" : "does_not_equal"]: !!v } };
  if (t === "title" || t === "text" || t === "rich_text") { const k = { string_is: "equals", string_is_not: "does_not_equal", string_contains: "contains", string_does_not_contain: "does_not_contain", string_starts_with: "starts_with", string_ends_with: "ends_with" }[op]; return { property, [t === "title" ? "title" : "rich_text"]: { [k]: v } }; }
  if (t === "date" || t === "last_edited_time" || t === "created_time") {
    const d = f.value?.type === "relative" ? relDate(v) : v;
    const k = { date_is: "equals", date_is_before: "before", date_is_after: "after", date_is_on_or_before: "on_or_before", date_is_on_or_after: "on_or_after" }[op];
    if (t === "date") return { property, date: { [k]: d } };
    // 更新日時・作成日時は日本時間の1日で比べる
    const from = `${d}T00:00:00+09:00`, to = `${addDay(d, 1)}T00:00:00+09:00`;
    const cond = k === "equals" ? null : k === "before" ? { before: from } : k === "after" ? { on_or_after: to } : k === "on_or_before" ? { before: to } : { on_or_after: from };
    if (cond) return { timestamp: t, [t]: cond };
    // 今日なら「今日の0時以降」の1条件にする（Notion API の絞り込みの入れ子は2段まで）
    if (d >= jstToday()) return { timestamp: t, [t]: { on_or_after: from } };
    return { and: [{ timestamp: t, [t]: { on_or_after: from } }, { timestamp: t, [t]: { before: to } }] };
  }
  throw httpError(400, `この絞り込みは使えません（${t}）`, "bad_request");
}
// 文字の飾りを Notion-flavored Markdown のタグにする（画面側で飾りを外して読む）
export function richToMd(arr = []) {
  return arr.map((r) => {
    let s = r.type === "mention" && r.mention?.type === "page" ? `<mention url="${pageUrl(r.mention.page.id)}">${esc(r.plain_text)}</mention>`
      : r.type === "mention" && r.mention?.type === "date" ? `<date start="${r.mention.date.start}" />`
      : esc(r.plain_text || "");
    const a = r.annotations || {};
    if (r.href && r.type !== "mention") s = `[${s}](${r.href})`;
    if (a.code) s = `\`${r.plain_text}\``;
    if (a.bold) s = `<b>${s}</b>`; if (a.italic) s = `<i>${s}</i>`; if (a.strikethrough) s = `<s>${s}</s>`; if (a.underline) s = `<u>${s}</u>`;
    return s;
  }).join("");
}
const esc = (s) => String(s).replace(/[<>]/g, (c) => `\\${c}`);
const plain = (arr = []) => arr.map((r) => r.plain_text || "").join("");
export function flatPage(page) {
  const out = { url: page.url || pageUrl(page.id), createdTime: page.created_time };
  for (const [name, p] of Object.entries(page.properties || {})) {
    const key = /^(url|id)$/i.test(name) ? `userDefined:${name}` : name;
    switch (p.type) {
      case "title": case "rich_text": out[key] = richToMd(p[p.type]); break;
      case "status": case "select": out[key] = p[p.type]?.name ?? null; break;
      case "multi_select": out[key] = JSON.stringify((p.multi_select || []).map((o) => o.name)); break;
      case "date": out[`date:${name}:start`] = p.date?.start ?? null; out[`date:${name}:end`] = p.date?.end ?? null; out[`date:${name}:is_datetime`] = p.date?.start?.includes("T") ? 1 : 0; break;
      case "relation": out[key] = JSON.stringify((p.relation || []).map((r) => pageUrl(r.id))); break;
      case "number": out[key] = p.number; break;
      case "checkbox": out[key] = p.checkbox ? "__YES__" : "__NO__"; break;
      case "url": case "email": case "phone_number": out[key] = p[p.type] ?? ""; break;
      case "created_time": case "last_edited_time": out[key] = p[p.type]; break;
      case "formula": { const x = p.formula || {}; out[key] = x.type === "date" ? x.date?.start ?? null : x[x.type] ?? null; break; }
      case "rollup": { const x = p.rollup || {}; out[key] = x.type === "number" ? x.number : x.type === "date" ? x.date?.start ?? null : null; break; }
      case "people": out[key] = JSON.stringify((p.people || []).map((u) => u.name || u.id)); break;
      case "files": out[key] = JSON.stringify((p.files || []).map((f) => f.name)); break;
      case "unique_id": out[key] = `${p.unique_id?.prefix ? `${p.unique_id.prefix}-` : ""}${p.unique_id?.number ?? ""}`; break;
      default: break;
    }
  }
  return out;
}

// update：プロパティ（列の型に合わせて組み立てる）と本文（Markdown の置き換え・追記・全体の置き換え）
async function updateTool(notion, input) {
  const pid = normalizeId(input.page_id);
  const md = (body) => notion("PATCH", `/pages/${pid}/markdown`, { ...body, markdown_version: "v2" }, MD_VERSION);
  switch (input.command) {
    case "update_properties": {
      const page = await notion("GET", `/pages/${pid}`);
      await notion("PATCH", `/pages/${pid}`, { properties: toProps(input.properties || {}, page.properties || {}) });
      return { page_id: pid };
    }
    case "update_content": {
      const res = await md({ type: "update_content", update_content: { content_updates: (input.content_updates || []).map((u) => ({ old_str: u.old_str, new_str: u.new_str })) } });
      return { page_id: pid, ...(res.warnings?.length ? { warnings: res.warnings } : {}) };
    }
    case "insert_content": await md({ type: "insert_content", insert_content: { content: input.content || "", position: { type: input.position?.type === "start" ? "start" : "end" } } }); return { page_id: pid };
    // 子ページ・データベースを消す置き換えは受け付けない（allow_deleting_content は渡さない）
    case "replace_content": await md({ type: "replace_content", replace_content: { new_str: input.new_str || "" } }); return { page_id: pid };
    default: throw httpError(400, "使えない書き換えです", "bad_request");
  }
}
const rich = (s) => (s ? [{ type: "text", text: { content: String(s).slice(0, 2000) } }] : []);
export function toProps(props, schema) {
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (/^date:.+:(is_datetime|end)$/.test(k)) continue;
    const dm = k.match(/^date:(.+):start$/);
    const name = dm ? dm[1] : k.replace(/^userDefined:/, "");
    const type = schema[name]?.type;
    if (!type) throw httpError(400, `列「${name}」がありません`, "bad_request");
    if (type === "title" || type === "rich_text") out[name] = { [type]: rich(v) };
    else if (type === "status") { if (v) out[name] = { status: { name: v } }; }
    else if (type === "select") out[name] = { select: v ? { name: v } : null };
    else if (type === "multi_select") out[name] = { multi_select: (Array.isArray(v) ? v : v ? JSON.parse(v) : []).map((n) => ({ name: n })) };
    else if (type === "date") out[name] = { date: v ? { start: String(v) } : null };
    else if (type === "relation") out[name] = { relation: (Array.isArray(v) ? v : []).map((x) => ({ id: normalizeId(x) })) };
    else if (type === "url" || type === "email" || type === "phone_number") out[name] = { [type]: v || null };
    else if (type === "number") out[name] = { number: v == null || v === "" ? null : Number(v) };
    else if (type === "checkbox") out[name] = { checkbox: v === true || v === "__YES__" };
    else throw httpError(400, `列「${name}」（${type}）は書き換えられません`, "bad_request");
  }
  return out;
}

// create：データソースに1行ずつ作る（本文は Markdown）
async function createTool(notion, { parent, pages }) {
  if (parent?.type !== "data_source_id" || !Array.isArray(pages) || !pages.length || pages.length > 5) throw httpError(400, "データベースへの行の追加だけ使えます（1回5件まで）", "bad_request");
  const dsId = normalizeId(parent.data_source_id);
  const ds = await notion("GET", `/data_sources/${dsId}`);
  const out = [];
  for (const pg of pages) {
    const body = { parent: { type: "data_source_id", data_source_id: dsId }, properties: toProps(pg.properties || {}, ds.properties || {}) };
    if (pg.content) Object.assign(body, { markdown: pg.content, markdown_version: "v2" });
    const res = await notion("POST", "/pages", body, MD_VERSION);
    out.push({ id: res.id, url: res.url || pageUrl(res.id) });
  }
  return { pages: out };
}
