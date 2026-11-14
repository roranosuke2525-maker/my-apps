// 今どこ：画面の配信と Notion API の中継（Cloudflare Worker）
// Notion のトークンはこの Worker の secret にだけ置き、ブラウザには渡さない。
// 画面（public/index.html）はアーティファクト版と同じもの。画面が Notion の MCP に出す4つの道具
// （fetch・query・update・create）を、ここで Notion API に置き換えて、MCP と同じ形で返す。

const NOTION_BASE = "https://api.notion.com/v1";
const API_VERSION = "2025-09-03"; // データソース・ページのプロパティ
const MD_VERSION = "2026-03-11"; // 本文の Markdown（Notion-flavored Markdown＝markdown_version v2）

import { BUILD, HTML, SW } from "./bundle.js";
// 画面（HTML）と sw.js は Worker の中から配る（資産の置き場の端キャッシュに古い版が残っても、デプロイした版が必ず出る）。保存させない
async function page(request, env, url) {
  const p = url.pathname;
  if (p === "/" || p === "/index.html") return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Build": BUILD } });
  // Notion のリンクの app.notion.com を今どこに差し替えたもの（/p/<ページID>）→ 画面を開いてそのページを出す
  if (p.startsWith("/p/")) { const m = p.slice(3).replace(/-/g, "").match(/([0-9a-f]{32})\/?$/i); if (m) return new Response(null, { status: 302, headers: { Location: `/#open=${m[1].toLowerCase()}`, "Cache-Control": "no-store" } }); }
  if (p === "/sw.js") return new Response(SW, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store", "X-Build": BUILD } });
  if (p === "/api/version") return json({ build: BUILD });
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/w/")) return widgetAct(request, env, url).catch((err) => html(actPage("⚠️", "できませんでした", err.publicMessage || "サーバーでエラーが起きました", url.origin), err.status || 500));
    if (!url.pathname.startsWith("/api/") || url.pathname === "/api/version") return page(request, env, url);
    try {
      checkConfig(env);
      if (!authorized(request, env)) return json({ error: "合言葉が違います", code: "bad_key" }, 401);
      if (url.pathname === "/api/ping" && request.method === "GET") return json({ ok: true });
      if (url.pathname === "/api/widget" && request.method === "GET") return json(await widgetData(env, url.origin));
      if (url.pathname === "/api/notion" && request.method === "POST") {
        const body = await readJson(request);
        return json(await runTool(notionClient(env), body.tool, body.input || {}));
      }
      if (url.pathname === "/api/run" && request.method === "POST") { const body = await request.json().catch(() => ({})); return json(await fireRoutine(env, body?.which === "suggest" ? "suggest" : "research")); }
      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: err.publicMessage || "サーバーでエラーが起きました", code: err.code || "server_error" }, err.status || 500);
    }
  },
};

// ---------- AIリサーチ定時処理を今すぐ動かす（claude.ai の定期実行の API トリガー） ----------
// ROUTINE_TOKEN（secret）：定期実行の編集画面で API トリガーを足して「Generate token」で出したトークン
// ROUTINE_ID（vars）：定期実行の ID（trig_…）。トークンはその定期実行だけを起動できる
const ROUTINE_BASE = "https://api.anthropic.com/v1/claude_code/routines";
// which："research"＝AIリサーチ定時処理（ROUTINE_ID / ROUTINE_TOKEN）、"suggest"＝💡 タスクの提案（SUGGEST_ROUTINE_ID / SUGGEST_ROUTINE_TOKEN）
export async function fireRoutine(env, which = "research") {
  const sug = which === "suggest";
  const id = String((sug ? env.SUGGEST_ROUTINE_ID : env.ROUTINE_ID) || ""); const token = sug ? env.SUGGEST_ROUTINE_TOKEN : env.ROUTINE_TOKEN;
  if (!token || !/^trig_[A-Za-z0-9]+$/.test(id)) throw httpError(500, sug ? "「今すぐ提案」の設定（SUGGEST_ROUTINE_TOKEN / SUGGEST_ROUTINE_ID）がありません。README の「今すぐ実行」を見てください" : "今すぐ実行の設定（ROUTINE_TOKEN / ROUTINE_ID）がありません。README の「今すぐ実行」を見てください", "no_routine");
  const res = await fetch(`${env.ROUTINE_API_BASE || ROUTINE_BASE}/${id}/fire`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "experimental-cc-routine-2026-04-01", "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ text: sug ? "今どこアプリの「今すぐ提案してもらう」から起動" : "今どこアプリの「今すぐ実行」から起動" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = res.status === 401 || res.status === 403 ? "定期実行のトークンが正しくありません（作り直して ROUTINE_TOKEN を入れ直す）"
      : res.status === 429 ? "今すぐ実行は1時間に30回までです。少し待ってください"
      : res.status === 404 ? `定期実行が見つかりません（${sug ? "SUGGEST_ROUTINE_ID" : "ROUTINE_ID"} を確かめる）`
      : `定期実行を起動できませんでした（${res.status}）`;
    throw httpError(res.status === 429 ? 429 : 502, msg, res.status === 429 ? "rate_limited" : "run_error");
  }
  return { ok: true, session_url: typeof data.claude_code_session_url === "string" ? data.claude_code_session_url : "" };
}

// ---------- ウィジェット（iPhone の Scriptable から読む） ----------
// GET /api/widget（合言葉つき）：今日の残り・遅れ・済み・AIの提案の数と、行ごとの「済み」「明日へ」の署名つきURL
// GET /w/act?op=done|tomorrow|undone&id=…&d=YYYY-MM-DD&s=署名：ウィジェットの✓を押したときに Safari で開く。合言葉は URL に出さず、
// 合言葉から作った HMAC（その日と翌日まで有効）で守る
const WAKU_ORDER = ["☼ 朝", "💻 PC", "🏠 家・外", "作業中"];
const SUG_DS = "bceda4df-aaa1-409b-9bb3-93f7ba88fd90";
const TASK_DS = "21762844-acbe-8075-bbe6-000bcaf22801";
async function hmac(key, s) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(s));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}
const signOf = (env, op, id, d) => hmac(env.APP_KEY, `${op}|${id}|${d}`);
async function actUrl(env, origin, op, id, d) { return `${origin}/w/act?op=${op}&id=${id}&d=${d}&s=${await signOf(env, op, id, d)}`; }
const listOf = (v) => { try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
export async function widgetData(env, origin) {
  const notion = notionClient(env); const today = jstToday();
  const q = (ds, filter, sort, limit) => queryTool(notion, { data: { mode: "rows", data_source_url: `collection://${ds}`, filter: { type: "group", operator: "and", filters: filter }, ...(sort ? { sort } : {}), limit } });
  const st = (s) => ({ type: "property", property: "ステータス", propertyType: "status", operator: "status_is", value: { type: "is_option", value: s } });
  const [next, doing, done, sug] = await Promise.all([
    q(TASK_DS, [st("⏭ NEXT"), { type: "property", property: "実行日", propertyType: "date", operator: "date_is_on_or_before", value: { type: "relative", value: "today" } }], [{ property: "実行日", direction: "ascending" }], 100),
    q(TASK_DS, [st("▶️ DOING")], null, 20),
    q(TASK_DS, [st("✅ DONE"), { type: "group", operator: "or", filters: [{ type: "property", property: "実行日", propertyType: "date", operator: "date_is", value: { type: "relative", value: "today" } }, { type: "property", property: "最終更新日時", propertyType: "last_edited_time", operator: "date_is", value: { type: "relative", value: "today" } }] }], null, 100),
    q(SUG_DS, [{ type: "property", property: "状態", propertyType: "select", operator: "enum_is", value: { type: "exact", value: "💡 提案中" } }], null, 30).catch(() => ({ results: [] })),
  ]);
  const own = (r) => !listOf(r["親タスク"]).length;
  const seen = new Set();
  const rows = [...(doing.results || []), ...(next.results || [])].filter(own).filter((r) => !seen.has(r.url) && seen.add(r.url));
  const tasks = [];
  for (const r of rows) {
    const id = normalizeId(r.url); const date = r["date:実行日:start"] ? String(r["date:実行日:start"]).slice(0, 10) : null;
    tasks.push({ id, name: String(r["名前"] || "（無題）").replace(/<[^>]+>/g, ""), next: String(r.NEXT || "").replace(/<[^>]+>/g, "").slice(0, 80), waku: r["枠"] || "", weight: r["重さ"] || "", date, late: !!date && date < today, doing: r["ステータス"] === "▶️ DOING",
      done: await actUrl(env, origin, "done", id, today), tomorrow: await actUrl(env, origin, "tomorrow", id, today), open: `${origin}/#open=${id}` });
  }
  tasks.sort((a, b) => (b.doing - a.doing) || (b.late - a.late) || (WAKU_ORDER.indexOf(a.waku) - WAKU_ORDER.indexOf(b.waku)) || a.name.localeCompare(b.name, "ja"));
  const doneN = (done.results || []).filter(own).length; const total = tasks.length + doneN;
  return { date: today, build: BUILD, remaining: tasks.length, late: tasks.filter((t) => t.late).length, done: doneN, pct: total ? Math.round((doneN / total) * 100) : 0, sugs: (sug.results || []).length, tasks: tasks.slice(0, 12), app: `${origin}/` };
}
function html(body, status = 200) { return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }); }
const escH = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function actPage(mark, title, body, origin, undo) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>今どこ</title><meta name="theme-color" content="#0f1115">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#e8eaee;font-family:-apple-system,"Hiragino Sans",sans-serif;text-align:center}main{padding:24px}b{display:block;font-size:64px;line-height:1}h1{font-size:20px;margin:14px 0 6px}p{color:#9aa0a8;margin:0 0 22px;font-size:15px;overflow-wrap:anywhere}a{display:inline-block;margin:4px;padding:12px 18px;border-radius:12px;background:#1b1f26;color:#e8eaee;text-decoration:none;font-size:15px}a.pri{background:#8fb8a5;color:#0f1115;font-weight:600}</style></head>
<body><main><b>${mark}</b><h1>${escH(title)}</h1><p>${escH(body)}</p><a class="pri" href="${escH(origin)}/">今どこを開く</a>${undo ? `<a href="${escH(undo)}">元に戻す</a>` : ""}</main></body></html>`;
}
async function widgetAct(request, env, url) {
  checkConfig(env);
  if (url.pathname !== "/w/act") throw httpError(404, "ページがありません", "not_found");
  const op = url.searchParams.get("op") || "", id = normalizeId(url.searchParams.get("id") || ""), d = url.searchParams.get("d") || "", s = url.searchParams.get("s") || "";
  const today = jstToday();
  if (!["done", "tomorrow", "undone"].includes(op)) throw httpError(400, "知らない操作です", "bad_request");
  if (![today, addDay(today, -1)].includes(d)) throw httpError(403, "このリンクは期限切れです。ウィジェットを更新してからもう一度押してください", "expired");
  if (!constantTimeEqual(s, await signOf(env, op, id, d))) throw httpError(403, "リンクが正しくありません", "bad_sig");
  const notion = notionClient(env);
  const page = await notion("GET", `/pages/${id}`);
  const name = (page.properties?.["名前"]?.title || []).map((x) => x.plain_text).join("") || "（無題）";
  const props = op === "done" ? { "ステータス": "✅ DONE" } : op === "undone" ? { "ステータス": "⏭ NEXT" } : { "date:実行日:start": addDay(today, 1), "date:実行日:is_datetime": 0 };
  await notion("PATCH", `/pages/${id}`, { properties: toProps(props, page.properties || {}) });
  if (op === "done") return html(actPage("✓", "済みにしました", name, url.origin, await actUrl(env, url.origin, "undone", id, today)));
  if (op === "undone") return html(actPage("↩", "次にやるに戻しました", name, url.origin));
  return html(actPage("→", "明日にずらしました", name, url.origin));
}

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

export function notionClient(env) {
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
  if (tool === "notion-delete-pages") return trashTool(notion, input, true);
  if (tool === "notion-restore-pages") return trashTool(notion, input, false);
  throw httpError(400, "使えない操作です", "bad_request");
}

// delete / restore：ページをゴミ箱へ移す・戻す（Notion のゴミ箱なので 30日は取り戻せる）。一度に 10 件まで
async function trashTool(notion, input, trash) {
  const ids = (input?.page_ids || []).slice(0, 10).map(normalizeId);
  if (!ids.length) throw httpError(400, "ページのIDがありません", "bad_request");
  for (const pid of ids) await notion("PATCH", `/pages/${pid}`, { in_trash: trash });
  return { page_ids: ids, in_trash: trash };
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
  // 本文と一緒にプロパティと親のデータソースも返す（MCP の fetch と同じ形。どのページでも画面の中で開けるように）
  const [md, pg] = await Promise.all([notion("GET", `/pages/${pid}/markdown?markdown_version=v2`, null, MD_VERSION), notion("GET", `/pages/${pid}`).catch(() => null)]);
  const ds = pg?.parent?.data_source_id ? `<ancestor-path>\n<parent-data-source url="collection://${pg.parent.data_source_id}"/>\n</ancestor-path>\n` : "";
  const props = pg ? `<properties>\n${JSON.stringify(flatPage(pg)).replace(/</g, "\\u003c")}\n</properties>\n` : "";
  const title = pg ? plain(Object.values(pg.properties || {}).find((x) => x.type === "title")?.title) : "";
  return { id: pid, title, truncated: !!md.truncated, unknown_block_ids: md.unknown_block_ids || [], text: `<page url="${pageUrl(pid)}">\n${ds}${props}<content>\n${md.markdown || ""}\n</content>\n</page>` };
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
