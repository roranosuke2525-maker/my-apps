  // ================= 小道具 =================
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jst = (ms = Date.now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
  const jstTime = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(11, 16);
  const TODAY = () => jst();
  const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const addMonths = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
  const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
  const diffDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);
  const ageOf = (t) => (t.edited ? diffDays(jst(Date.parse(t.edited)), TODAY()) : 0);
  const WD = "日月火水木金土";
  const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  const idOf = (url) => (String(url || "").replace(/-/g, "").match(/([0-9a-f]{32})(?:\?|$|#)/i) || [])[1]?.toLowerCase() || "";
  const isRef = (v) => typeof v === "string" && /^(formula|rollup)Result:\/\/|^<omitted/.test(v);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(`${STORE}:${k}`)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(`${STORE}:${k}`, JSON.stringify(v)); } catch { /* 保存できなくても動く */ } },
  };
  const decode = (s) => s.replace(/&(lt|gt|amp|quot|#39|nbsp);/g, (_, e) => ({ lt: "<", gt: ">", amp: "&", quot: '"', "#39": "'", nbsp: " " })[e]);
  function text(v) {
    if (v == null || isRef(v)) return "";
    if (typeof v !== "string") return String(v);
    return decode(v.replace(/<date start="([^"]+)"[^>]*\/>/g, (_, d) => md(d)).replace(/<mention[^>]*>([^<]*)<\/mention>/g, "$1").replace(/<mention[^>]*\/>/g, "↗").replace(/<br\s*\/?>/g, " ")
      .replace(/<[^>]+>/g, "").replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1").replace(/\\([_*[\]|<>])/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1")).replace(/\s+/g, " ").trim();
  }
  // 本文の1行を、太字・リンクだけ残して表示用にする
  function inline(s) {
    let h = esc(decode(String(s).replace(/<date start="([^"]+)"[^>]*\/>/g, (_, d) => md(d)).replace(/<mention[^>]*>([^<]*)<\/mention>/g, "↗$1").replace(/<mention[^>]*\/>/g, "↗")
      .replace(/<br\s*\/?>/g, " ").replace(/<(?!\/?b>)[^>]+>/g, "").replace(/\\([_*[\]|<>])/g, "$1")));
    h = h.replace(/&lt;(\/?)b&gt;/g, "<$1b>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
    return h;
  }
  function list(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === "string" && v.startsWith("[")) { try { const a = JSON.parse(v); if (Array.isArray(a)) return a; } catch { /* 文字のまま */ } }
    return null;
  }
  let toastTimer;
  // 下に出るお知らせ。undo を渡すと「取り消す」ボタンが付く
  function toast(msg, undo) {
    const t = $("#toast"); t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" id="undo">取り消す</button>' : ""}`; t.hidden = false;
    if (undo) $("#undo").onclick = () => { t.hidden = true; undo(); };
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 5000 : 2800);
  }

  // ================= Notion へのつなぎ方 =================
  // claude.ai のアーティファクト：見ている人の Notion 連携（MCP）
  // Cloudflare版：同じ画面を Worker が配る。/api/notion に合言葉を付けて送り、Worker が Notion API に中継する（返事は MCP と同じ形）
  let mcpP = null; let VIA = "demo";
  function getMcp() {
    if (!mcpP) mcpP = (async () => {
      if (/^https?:$/.test(location.protocol) && !/[?&]demo\b/.test(location.search)) {
        try { const r = await fetch("/api/ping", { headers: { Authorization: `Bearer ${store.get("key") || ""}` } }); if ([200, 401, 500].includes(r.status) && /json/.test(r.headers.get("content-type") || "")) { VIA = "api"; return apiClient(); } } catch { /* アーティファクトの中では届かない */ }
      }
      for (let i = 0; i < 30 && !window.claude?.use; i++) await sleep(100);
      if (window.claude?.use) { VIA = "mcp"; return window.claude.use("mcp"); }
      return null;
    })().catch(() => null);
    return mcpP;
  }
  // 合言葉を聞く（端末のブラウザにだけ保存）
  function askKey(wrong) {
    return new Promise((done) => {
      const m = $("#modal"); m.hidden = false;
      m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><h3>合言葉</h3><div class="form"><p class="mute" style="margin:0;font-size:12.5px">${wrong ? "合言葉が違います。入れ直してください。" : "Worker に設定した合言葉（APP_KEY）を入れてください。この端末のブラウザにだけ保存されます。"}</p><input id="appkey" type="password" autocomplete="current-password" aria-label="合言葉"><button type="button" class="btn pri" id="keyok">開く</button></div></div>`;
      const i = $("#appkey"); i.focus();
      const ok = () => { const v = i.value.trim(); if (v.length < 16) { i.focus(); return; } store.set("key", v); m.hidden = true; m.innerHTML = ""; done(v); };
      $("#keyok").onclick = ok; i.onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) ok(); };
    });
  }
  function apiClient() {
    return {
      async callTool(server, tool, input) {
        for (let attempt = 0; attempt < 3; attempt++) {
          let key = store.get("key"); if (!key) key = await askKey(false);
          const r = await fetch("/api/notion", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ tool, input }) });
          const data = await r.json().catch(() => ({}));
          if (r.status === 401) { store.set("key", ""); await askKey(true); continue; }
          if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { code: data.code === "rate_limited" ? "rate_limited" : data.code === "config" ? "config" : "tool_error", retryable: r.status === 429 });
          return data;
        }
        throw Object.assign(new Error("合言葉が違います"), { code: "bad_key" });
      },
    };
  }
  const TOOL = { fetch: "notion-fetch", query: "notion-query-data-sources", update: "notion-update-page", create: "notion-create-pages" };
  async function call(kind, input, { read = true } = {}) {
    const mcp = await getMcp();
    if (!mcp) throw Object.assign(new Error("no-mcp"), { code: "not_granted" });
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await mcp.callTool(SERVER, TOOL[kind], input, read ? undefined : { cache: false });
        return res.payload ?? res;
      } catch (err) {
        if (read && attempt === 0 && err?.retryable) { await sleep((err.retryAfterMs ?? 800) + Math.random() * 400); continue; }
        throw err;
      }
    }
  }
  function errText(err) {
    return ({
      needs_reauth: "Notion の連携が切れています。claude.ai の 設定 → コネクタ で Notion を再接続してください",
      server_not_connected: "Notion 連携がありません。claude.ai の 設定 → コネクタ で Notion を追加してください",
      selection_required: "Notion 連携が複数あります。表示された確認でどれを使うか選んでください",
      not_in_manifest: "このページで Notion の利用が許可されていません。ページの権限から Notion を許可してください",
      approval_required: "Notion の利用を許可してください（確認が出たら「許可」）",
      consent_required: "Notion の利用を許可してください（確認が出たら「許可」）",
      blocked_by_policy: "組織の設定で Notion 連携が使えません",
      server_unavailable: "Notion の返事がありません。反映されたかもしれないので「↻」で確かめてください",
      rate_limited: "Notion が混み合っています。少し待ってから「↻」してください",
      tool_error: `Notion がエラーを返しました（${String(err?.message || "").slice(0, 90)}）`,
      config: "Worker の設定（NOTION_TOKEN／APP_KEY）が足りません。README のセットアップを見てください",
      bad_key: "合言葉が違います。入れ直してください",
    })[err?.code] || "Notion との通信でエラーが起きました。「↻」でやり直してください";
  }
  const statusFilter = (s) => ({ type: "property", property: "ステータス", propertyType: "status", operator: "status_is", value: { type: "is_option", value: s } });
  async function rows(ds, { filters, sort, limit = 100 } = {}) {
    const data = { mode: "rows", data_source_url: `collection://${ds}`, limit };
    if (filters?.length) data.filter = { type: "group", operator: "and", filters };
    if (sort) data.sort = sort;
    const res = await call("query", { data });
    return { results: res.results || [], more: !!res.has_more };
  }

  // ================= データ =================
  function toTask(r) {
    const t = {
      id: idOf(r.url), url: r.url, name: text(r["名前"]) || "（無題）", next: text(r.NEXT), status: r["ステータス"] || ST.inbox,
      date: r["date:実行日:start"] ? String(r["date:実行日:start"]).slice(0, 10) : null, waku: r["枠"] || null, weight: r["重さ"] || null,
      tag: r["分類タグ"] || null, ai: r["AIアクション"] || null, edited: r["最終更新日時"] || null, created: r.createdTime || null,
      projects: (list(r["プロジェクト"]) || []).map(idOf).filter(Boolean), link: text(r["userDefined:URL"]),
    };
    known.set(t.id, t);
    return t;
  }
  // GTDの段。今日・予定は DB_タスク管理の「今どこ」と同じく実行日で決める（AI・待ち・いつかは状態のまま）
  function stageOf(t, today = TODAY()) {
    if (t.status === ST.done) return "done";
    if (t.status === ST.ref) return "ref";
    if (t.status === ST.ai) return "ai";
    if (t.status === ST.wait) return "wait";
    if (t.status === ST.some) return "some";
    if (t.date) return t.date <= today ? "today" : "plan";
    if (t.status === ST.next || t.status === ST.doing) return "next";
    return "inbox";
  }
  const inStage = (k) => k === "done" ? S.doneToday : k === "ref" ? S.refs : S.tasks.filter((t) => stageOf(t) === k);
  const lateOf = () => { const d = TODAY(); return inStage("today").filter((t) => t.date < d); };
  // AIアクションの付いた行（状態は問わない・DONE以外）
  const aiItems = () => S.tasks.filter((t) => t.ai && AI_TURN[t.ai]);
  const myTurn = () => aiItems().filter((t) => AI_TURN[t.ai] === "me" && t.status !== ST.ref);
  const aiTurn = () => aiItems().filter((t) => AI_TURN[t.ai] === "ai");
  const saveSnap = () => store.set("snap", { at: S.loadedAt, tasks: S.tasks, refs: S.refs, projects: S.projects, doneToday: S.doneToday, diag: S.diag, logs: S.logs, goals: S.goals });

  async function loadLive() {
    const sortEdited = [{ property: "最終更新日時", direction: "descending" }];
    const jobs = OPEN_STATUSES.map((s) => rows(DS.task, { filters: [statusFilter(s)], sort: sortEdited }));
    // 今日の済み：実行日が今日か、今日更新した DONE（実行日のない行も数える）
    jobs.push(rows(DS.task, { filters: [statusFilter(ST.done), { type: "group", operator: "or", filters: [{ type: "property", property: "実行日", propertyType: "date", operator: "date_is", value: { type: "relative", value: "today" } }, { type: "property", property: "最終更新日時", propertyType: "last_edited_time", operator: "date_is", value: { type: "relative", value: "today" } }] }], limit: 50 }));
    jobs.push(rows(DS.task, { filters: [statusFilter(ST.ref)], sort: sortEdited, limit: 40 }));
    jobs.push(rows(DS.proj, { limit: 100 }));
    const out = await Promise.all(jobs);
    known.clear();
    const n = OPEN_STATUSES.length;
    S.tasks = out.slice(0, n).flatMap((o) => o.results.map(toTask));
    S.more = Object.fromEntries(OPEN_STATUSES.map((s, i) => [s, out[i].more]));
    S.doneToday = out[n].results.map(toTask);
    S.refs = out[n + 1].results.map(toTask); S.refMore = out[n + 1].more;
    S.projects = out[n + 2].results.map((r) => ({
      id: idOf(r.url), url: r.url, name: text(r["名前"]) || "（無題）", status: r["ステータス"] || "", step: text(r["次の一歩"]), now: text(r["今の状態"]),
      total: (list(r["タスク"]) || []).length, edited: r["最終更新"] || null,
    }));
    // 診断・運用ログ・目標は、読めなくてもタスクの画面は出す
    const [diag, logs, goals] = await Promise.allSettled([
      rows(DS.diag, { sort: [{ property: "回", direction: "descending" }], limit: 20 }),
      rows(DS.log, { sort: [{ property: "日時", direction: "descending" }], limit: 60 }),
      rows(DS.goal, { limit: 100 }),
    ]);
    S.extraErr = {};
    if (diag.status === "fulfilled") S.diag = diag.value.results.map((r) => ({
      url: r.url, id: idOf(r.url), name: text(r["名前"]), no: Number(r["回"]) || 0, rate: Number(r["今日やる完了率"]) || 0, done: Number(r["完了件数"]) || 0, inflow: Number(r["流入件数"]) || 0,
      verdict: text(r["判定"]), next: text(r["次の一手"]), from: r["date:期間:start"] || "", to: r["date:期間:end"] || "",
    })).sort((a, b) => a.no - b.no); else S.extraErr.diag = errText(diag.reason);
    if (logs.status === "fulfilled") S.logs = logs.value.results.map((r) => ({ url: r.url, id: idOf(r.url), name: text(r["名前"]), event: text(r["イベント"]), at: r["日時"] || r.createdTime || "", body: text(r["内容"]) }));
    else S.extraErr.log = errText(logs.reason);
    if (goals.status === "fulfilled") S.goals = goals.value.results.map((r) => ({
      url: r.url, id: idOf(r.url), name: text(r["名前"]) || "（無題）", status: text(r["ステータス"]), kind: text(r["種別"]), area: text(r["領域"]), due: r["date:期限:start"] || null,
      why: text(r["なぜ"]), goalBy: text(r["達成の目安"]), projects: (list(r["プロジェクト"]) || []).map(idOf),
    })); else S.extraErr.goal = errText(goals.reason);
    S.loadedAt = Date.now();
    saveSnap();
  }

