// かいもの：買い物リスト（DB_タスク管理の BUY タスクの本文の ToDo）・在庫と補充（DB_Daily）・切れそうな在庫と買い物の時刻の通知。
// リストは3つに分ける：🛒 いつもの（DB_買い物テンプレートから数を決めて作る）／⚡ ちょい買い（突発の品を足す1枚）／📦 そのほか（ネット注文などの BUY タスクと補充）。
// /api は Cloudflare Worker（src/worker.js）が Notion API で答える。開くには合言葉（APP_KEY）が要る。
// 品目の書き込みは端末に順番待ちで貯め、電波が戻ったら順に送る（お店の中で圏外になっても使える）。
const A = window.KaimonoAisle;
const CATS = ["日用品", "消耗品", "食品", "育児", "サプリ", "美容"];
const FREQS = ["毎日", "毎週", "毎月"];
const SOON_DAYS = 7; // 補充の画面で「そろそろ」に数える日数
const KEY_STORAGE = "key";
const QUICK = "⚡ ちょい買い";
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const REMIND_CHOICES = [[1440, "前日"], [180, "3時間前"], [60, "1時間前"], [30, "30分前"], [10, "10分前"], [0, "ちょうど"]];
const REMIND_DEFAULT = [30, 0];

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k, d = "") { try { const v = localStorage.getItem(`kaimono:${k}`); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`kaimono:${k}`, v); } catch { /* 保存できなくても動く */ } },
  json(k, d) { try { return JSON.parse(store.get(k, "")) ?? d; } catch { return d; } },
};

const S = {
  tab: "list", lists: [], stock: [], today: "", loadedAt: "", cur: store.get("cur"), sort: store.get("sort", "aisle"),
  showBasket: false, edit: "", sheet: null, act: null, sites: [], sets: [], setAdded: store.json("setAdded", {}), stores: ["ヤオコー", "ヤクルト", "ドラッグストア"], maint: false, msearch: null, over: store.json("over", {}), // over：Notion に書いたばかりの品（id → 手元の値）、setAdded：セットで足した品（"リスト|セット" → 品の id） lpick: null, // lpick：リストで選んで消す品の id pick: null, // pick：補充でまとめて操作するときに選んだ品の id stockCat: "", alertDays: 3, push: null, loading: false,
  seg: store.get("seg", "usual"), templates: [], templateErr: "", planning: false, whenFor: "", openOther: "", wantList: "",
  reminders: {}, // タスク id → 何分前に知らせるか（決めていないタスクは REMIND_DEFAULT）
  plan: { counts: {}, extra: [], at: "", store: "", before: [30, 0], ...store.json("plan", {}) }, // いつもの買い物の下書き（端末に残す）
};
let memoryKey = store.get(KEY_STORAGE);
let Q = store.json("queue", []); // 送る前の書き込み
let hist = store.json("hist", {}); // 品目の名前 → { n: 入れた回数, last: 最後に入れた日 }

// ---------- 通信 ----------
async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, { method, headers: { Authorization: `Bearer ${memoryKey}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error("電波がありません"), { network: true });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    memoryKey = "";
    store.set(KEY_STORAGE, "");
    showLogin();
    throw Object.assign(new Error(data.error || "合言葉が違います"), { auth: true });
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `通信エラー（${res.status}）`), { status: res.status });
  return data;
}

let toastTimer = 0;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}
function setSync(kind) {
  const s = $("#sync");
  const n = Q.length;
  s.className = `sync ${kind}`;
  s.textContent = kind === "busy" ? "保存中…" : kind === "offline" ? `圏外・${n}件待ち` : kind === "err" ? "保存できませんでした" : "";
}
function setStatus(msg, err = false) {
  const s = $("#status");
  s.textContent = msg || "";
  s.classList.toggle("err", !!err);
}

const saveSnap = () => store.set("snap", JSON.stringify({ lists: S.lists, stock: S.stock, today: S.today, loadedAt: S.loadedAt, templates: S.templates, templateErr: S.templateErr, stores: S.stores, sites: S.sites, sets: S.sets }));
const savePlan = () => store.set("plan", JSON.stringify(S.plan));
const saveQueue = () => store.set("queue", JSON.stringify(Q));
const saveHist = () => store.set("hist", JSON.stringify(hist));

// ---------- データ ----------
const shopLists = () => S.lists.filter((t) => !t.refill.length);
const storeNames = () => [...new Set(S.templates.map((x) => x.store))].filter((x) => x && x !== "その他");
// リストの種類はタスク名の頭の印で分ける（DB_タスク管理に列は足さない）
function kindOf(t) {
  if (t.refill.length) return "other";
  if (/^⚡/.test(t.name)) return "quick";
  if (/^🛒/.test(t.name) || /^(買い物|買い物リスト|スーパー)$/.test(t.name) || storeNames().some((n) => t.name.includes(n))) return "usual";
  return "other";
}
const byAt = (a, b) => (a.at || a.date || "9999").localeCompare(b.at || b.date || "9999");
const usualLists = () => S.lists.filter((t) => kindOf(t) === "usual").sort(byAt);
const quickList = () => S.lists.find((t) => kindOf(t) === "quick");
const otherTasks = () => S.lists.filter((t) => kindOf(t) === "other").sort(byAt);
const listOf = (id) => S.lists.find((t) => t.id === id);
const leftOf = (t) => (t.items || []).filter((i) => !i.checked).length;
const soonStock = (days = S.alertDays) => S.stock.filter((x) => x.left != null && x.left <= days && !x.open?.length);
const leftTx = (n) => (n == null ? "" : n < 0 ? `切れて${-n}日` : n === 0 ? "今日切れる" : `あと${n}日`);
const leftColor = (x) => (x.left == null ? "var(--mute)" : x.left <= 0 ? "var(--bad)" : x.left <= 3 ? "var(--warn)" : x.left <= SOON_DAYS ? "var(--soon)" : "var(--ok)");
const md = (d) => (d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : "");
const jstDay = (ms = Date.now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
function fmtAt(at) {
  if (!at) return "";
  const d = at.slice(0, 10); const today = jstDay();
  const day = d === today ? "今日" : d === addDays(today, 1) ? "明日" : `${md(d)}(${WD[dow(d)]})`;
  return `${day} ${at.slice(11, 16)}`;
}
const kana = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

async function load({ quiet = false } = {}) {
  if (Q.length) { pendingReload = true; flush(); return; } // 送り終えてから読み直す
  if (S.loading) return;
  S.loading = true;
  if (!quiet) setStatus("Notion から読みこみ中…");
  try {
    const st = await api("GET", "/api/state");
    Object.assign(S, { lists: st.lists, stock: st.stock, today: st.today, loadedAt: st.loadedAt, templates: st.templates || [], templateErr: st.templateErr || "", reminders: st.reminders || {}, stores: st.stores || S.stores, sites: st.sites || S.sites, sets: st.sets || [] });
    applyOver();
    if (S.wantList) { const t = listOf(S.wantList); if (t) { S.seg = kindOf(t); S.cur = t.id; S.tab = "list"; } S.wantList = ""; }
    for (const t of S.lists.filter((x) => kindOf(x) !== "other")) for (const i of t.items || []) remember(A.splitQty(i.text).name, false);
    saveSnap(); saveHist();
    setStatus("");
  } catch (err) {
    if (!err.auth) setStatus(S.loadedAt ? `前回の内容を出しています（${err.message}）` : err.message, !err.network);
  } finally {
    S.loading = false;
    render();
  }
}
let pendingReload = false;

function remember(name, count = true) {
  if (!name) return;
  const h = hist[name] || { n: 0, last: "" };
  if (count) { h.n += 1; h.last = S.today || new Date().toISOString().slice(0, 10); } else if (hist[name]) return;
  hist[name] = h;
}

// ---------- 書き込みの順番待ち ----------
let flushing = false;
let retryTimer = 0;
function enqueue(op) { Q.push(op); saveQueue(); flush(); }
async function flush() {
  if (flushing) return;
  flushing = true;
  clearTimeout(retryTimer);
  while (Q.length) {
    const op = Q[0];
    setSync("busy");
    try {
      await runOp(op);
      Q.shift();
      saveQueue();
    } catch (err) {
      if (err.network) { setSync("offline"); retryTimer = setTimeout(flush, 15000); flushing = false; return; }
      if (err.auth) { flushing = false; return; }
      Q.shift();
      dropTemps(op);
      saveQueue();
      toast(`保存できませんでした：${err.message}`);
      pendingReload = true;
    }
  }
  flushing = false;
  setSync("ok");
  saveSnap();
  if (pendingReload) { pendingReload = false; load({ quiet: true }); }
}
async function runOp(op) {
  if (op.item?.startsWith("tmp")) return; // 足すのに失敗した品目への操作は捨てる
  if (op.k === "add") {
    const res = await api("POST", `/api/lists/${op.list}/items`, { items: op.texts });
    op.temps.forEach((tid, n) => {
      const real = res.items[n]?.id;
      if (!real) return;
      for (const t of S.lists) for (const i of t.items || []) if (i.id === tid) { i.id = real; i.kind = res.items[n].kind || "todo"; }
      if (S.over[tid]) { S.over[real] = { ...S.over[tid], item: { ...S.over[tid].item, id: real, kind: res.items[n].kind } }; delete S.over[tid]; }
      for (const q of Q) if (q.item === tid) q.item = real;
      for (const ids of Object.values(S.setAdded)) { const k = ids.indexOf(tid); if (k >= 0) ids[k] = real; }
      saveSetAdded();
      if (S.edit === tid) S.edit = real;
    });
    render();
  } else if (op.k === "check") await api("PATCH", itemPath(op), { checked: op.checked });
  else if (op.k === "text") await api("PATCH", itemPath(op), { text: op.text });
  else if (op.k === "del") await api("DELETE", itemPath(op));
}
// 品ごとの子タスクは /api/subtasks、前からのリストの本文の ToDo は /api/items
const itemPath = (op) => `/api/${op.kind === "task" ? "subtasks" : "items"}/${op.item}`;
const kindOf_ = (id) => findItem(id)[1]?.kind || "todo";
function dropTemps(op) {
  if (op.k !== "add") return;
  for (const t of S.lists) if (t.items) t.items = t.items.filter((i) => !op.temps.includes(i.id));
  render();
}
window.addEventListener("online", () => flush());

// ---------- リスト：操作 ----------
let tmpN = 0;
async function addTexts(texts) {
  texts = texts.map((s) => s.trim()).filter(Boolean);
  if (!texts.length) return;
  let t = S.seg === "quick" ? quickList() : listOf(S.cur);
  if (t && kindOf(t) !== S.seg) t = null;
  if (!t) {
    // リストがまだなければ、入れた品目ごと新しく作る（ちょい買いは1枚だけ）
    const name = S.seg === "quick" ? QUICK : `🛒 買い物 ${md(jstDay())}`;
    try {
      setSync("busy");
      const res = await api("POST", "/api/lists", { name, items: texts });
      S.lists.unshift(res.list); markAdded(res.list);
      if (S.seg !== "quick") { S.cur = res.list.id; store.set("cur", S.cur); }
      texts.forEach((s) => remember(A.splitQty(s).name));
      saveHist(); saveSnap(); setSync("ok"); render();
      toast(`「${name}」を作って ${texts.length}品 入れました`);
    } catch (err) { setSync("err"); toast(`作れませんでした：${err.message}`); }
    return;
  }
  if (S.seg !== "quick") S.cur = t.id;
  const temps = texts.map(() => `tmp${Date.now()}${tmpN++}`);
  t.items = t.items || [];
  texts.forEach((s, n) => { const it = { id: temps[n], text: s, checked: false, group: "", kind: "task" }; t.items.push(it); S.over[temps[n]] = { add: true, list: t.id, item: it, at: Date.now() }; });
  saveOver();
  texts.forEach((s) => remember(A.splitQty(s).name));
  saveHist();
  render();
  enqueue({ k: "add", list: t.id, texts, temps });
  if (texts.length > 1) toast(`${texts.length}品 入れました`);
}
function findItem(id) {
  for (const t of S.lists) for (const i of t.items || []) if (i.id === id) return [t, i];
  return [];
}
function toggle(id) {
  const [, i] = findItem(id); if (!i) return;
  i.checked = !i.checked;
  if (navigator.vibrate) navigator.vibrate(8);
  overWrite(id, { checked: i.checked });
  render();
  enqueue({ k: "check", item: id, checked: i.checked, kind: i.kind });
}
// ---------- チェックが戻らないように：書いた内容は Notion が追いつくまで（3分）手元を優先 ----------
const OVER_MS = 3 * 60e3;
// 作ったばかりのリストの品も、Notion の検索に出てくるまで手元から出す
function markAdded(list) { S.over[`list:${list.id}`] = { newList: { ...list, items: [] }, at: Date.now() }; for (const it of list.items || []) S.over[it.id] = { add: true, list: list.id, item: it, at: Date.now() }; saveOver(); }
function overWrite(id, patch) { S.over[id] = { ...(S.over[id] || {}), ...patch, at: Date.now() }; saveOver(); }
const saveOver = () => store.set("over", JSON.stringify(S.over));
function applyOver() {
  const now = Date.now();
  for (const [id, o] of Object.entries(S.over)) if (now - o.at > OVER_MS && !Q.some((q) => q.item === id)) delete S.over[id];
  for (const o of Object.values(S.over)) if (o.newList && !S.lists.some((t) => t.id === o.newList.id)) S.lists.unshift({ ...o.newList, items: [] });
  for (const t of S.lists) {
    if (!t.items) t.items = t.refill?.length ? undefined : [];
    if (!t.items) continue;
    t.items = t.items.filter((i) => !S.over[i.id]?.del);
    for (const i of t.items) { const o = S.over[i.id]; if (!o) continue; if ("checked" in o) i.checked = o.checked; if (o.text) i.text = o.text; }
    // 足した直後でまだ読み込みに出てこない品は手元から足す
    for (const [id, o] of Object.entries(S.over)) if (o.add && o.list === t.id && !o.del && !t.items.some((i) => i.id === id)) t.items.push({ ...o.item, checked: "checked" in o ? o.checked : false, text: o.text || o.item.text });
  }
  saveOver();
}
function renameItem(id, text) {
  const [, i] = findItem(id); if (!i) return;
  text = text.replace(/\s+/g, " ").trim();
  S.edit = "";
  if (!text || text === i.text) { render(); return; }
  i.text = text; overWrite(id, { text }); render();
  enqueue({ k: "text", item: id, text, kind: i.kind });
}
function removeItem(id) {
  const [t] = findItem(id); if (!t) return;
  const kind = kindOf_(id);
  t.items = t.items.filter((i) => i.id !== id);
  overWrite(id, { del: true });
  S.edit = ""; render();
  enqueue({ k: "del", item: id, kind });
}
// 選んだ品をまとめてリストから消す（チェックの有無は問わない。圏外でも順番待ちで消す）
function deletePicked(t) {
  const ids = [...(S.lpick || [])].filter((id) => (t.items || []).some((i) => i.id === id));
  if (!ids.length) return;
  const kinds = Object.fromEntries(ids.map((id) => [id, kindOf_(id)]));
  t.items = t.items.filter((i) => !ids.includes(i.id));
  ids.forEach((id) => overWrite(id, { del: true }));
  S.lpick = null; render();
  for (const id of ids) enqueue({ k: "del", item: id, kind: kinds[id] });
  toast(`${ids.length}品をリストから消しました`);
}
function clearBasket(t) {
  const done = (t.items || []).filter((i) => i.checked);
  if (!done.length) return;
  t.items = t.items.filter((i) => !i.checked);
  done.forEach((i) => overWrite(i.id, { del: true }));
  render();
  for (const i of done) enqueue({ k: "del", item: i.id, kind: i.kind });
  toast(`かごの ${done.length}品 をリストから消しました`);
}
async function finishList(t, label = "買い物おわり") {
  if (Q.length) { toast("保存が終わってからもう一度押してください"); flush(); return; }
  try {
    setSync("busy");
    await api("POST", `/api/lists/${t.id}/done`);
    S.lists = S.lists.filter((x) => x.id !== t.id);
    delete S.over[`list:${t.id}`]; saveOver();
    for (const x of S.stock) if (x.open?.includes(t.id)) { x.open = x.open.filter((y) => y !== t.id); if (t.refill.includes(x.id)) markRestocked(x); }
    if (S.cur === t.id) S.cur = shopLists()[0]?.id || "";
    saveSnap(); setSync("ok"); render();
    toast(`「${t.name}」を済みにしました（${label}）`);
  } catch (err) { setSync("err"); toast(`済みにできませんでした：${err.message}`); }
}
function markRestocked(x) {
  // Notion の計算式が追いつくまで、補充した日を今日として残りを出し直す
  x.base = S.today; x.rollup = S.today;
  if (x.days != null) { x.end = addDays(S.today, x.days); x.left = x.days; } else { x.end = null; x.left = null; }
}
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

async function createList(name) {
  name = name.replace(/\s+/g, " ").trim() || "買い物リスト";
  try {
    setSync("busy");
    const res = await api("POST", "/api/lists", { name });
    S.lists.unshift(res.list);
    S.cur = res.list.id; store.set("cur", S.cur); S.planning = false;
    saveSnap(); setSync("ok"); render();
    $("#addin")?.focus();
  } catch (err) { setSync("err"); toast(`作れませんでした：${err.message}`); }
}

// ---------- 買い物の時刻 ----------
// ---------- 補充の品ごとの操作（補充する・リストから外す・直す・別の商品にする・ネットで買う） ----------
function openAct(id) { S.act = { id, mode: "act", q: "", results: null, pick: null, today: true }; renderAct(); }
function closeAct() { S.act = null; closeSheet(); }
const siteUrl = (site, q) => site.url.replace("{q}", encodeURIComponent(q));
function siteBtns(q) {
  return `${S.sites.map((st) => `<a class="btn ghost sm" href="${esc(siteUrl(st, q))}" target="_blank" rel="noopener">${esc(st.name)}</a>`).join("")}<button type="button" class="btn ghost sm" data-siteadd="1">＋ サイト</button>`;
}
function renderAct() {
  const a = S.act; const x = S.stock.find((s) => s.id === a.id); if (!x) { closeAct(); return; }
  const open = x.open?.length;
  const head = `<div class="sh-head"><b>${a.mode === "change" ? "🔄 別の商品に変える" : a.mode === "hist" ? "🕘 補充の履歴" : "補充"}</b><button type="button" class="more" data-actclose="1" aria-label="閉じる">×</button></div>
    <div class="sc-row">${thumb(x, "big")}<div><b>${esc(x.name)}</b><small>${esc([leftTx(x.left), x.store, open ? "補充リストに入っています" : ""].filter(Boolean).join("・"))}</small></div></div>`;
  let body;
  if (a.mode === "hist") {
    if (!H.list && !H.loading) loadHistory().then(() => S.act && renderAct());
    body = `${histRows(x.id)}<div class="row-end"><button type="button" class="btn ghost sm" data-actmode="act">戻る</button></div>`;
  } else if (a.mode === "change") {
    const pick = a.pick ? `<div class="card pickcard"><div class="sc-row">${thumb({ image: a.pick.image })}<div><b>${esc(a.pick.name)}</b><small>${esc(a.pick.link || "")}</small></div></div>
      <label class="check"><input type="checkbox" id="acttoday" ${a.today ? "checked" : ""}> 新しく買った（買った日を今日にする）</label>
      <div class="row-end"><button type="button" class="btn ghost sm" data-actpick="">選び直す</button><button type="button" class="btn pri" data-actapply="1">この商品に変える</button></div></div>` : "";
    const res = a.results === "loading" ? `<p class="note">🔎 探しています…</p>` : Array.isArray(a.results) ? (a.results.length ? `<p class="note">${esc(a.source || "")}の候補（タップで選ぶ）</p>${a.results.map((r, k) => `<button type="button" class="mres" data-actpick="${k}">${thumb({ image: r.image })}<span>${esc(r.name)}${r.price ? `<small>${esc(r.price)}</small>` : ""}</span></button>`).join("")}` : `<p class="note">見つかりませんでした。言葉を変えてみてください</p>`) : "";
    body = `${pick || `<form id="actsearch" class="maintadd"><input id="actq" type="search" enterkeyhint="search" value="${esc(a.q || x.name)}" placeholder="商品名で探す（URL を貼ってもよい）" autocomplete="off" data-sug="act">
      <div class="sugs" id="sug-act"></div>
      <div class="row-end"><button type="button" class="btn ghost sm" data-actpaste="1">📋 URL を貼る</button><button type="submit" class="btn pri sm">🔎 探す</button></div></form>${res}
      <p class="note">ほかのサイトで見る：</p><div class="glinks">${siteBtns(a.q || x.name)}</div>`}
      <div class="row-end"><button type="button" class="btn ghost sm" data-actmode="act">戻る</button></div>`;
  } else {
    body = `<div class="actgrid">
      <button type="button" class="btn ok" data-actdo="restock">✓ 補充した<small>最終補充日を今日に</small></button>
      ${open ? `<button type="button" class="btn danger" data-actdo="cancel">✖ 補充リストから外す<small>今回は買わない</small></button>` : `<button type="button" class="btn" data-actdo="tolist">🛒 補充リストへ<small>補充タスクを作る</small></button>`}
      <button type="button" class="btn" data-actdo="edit">✏️ 直す<small>使う数・頻度・店など</small></button>
      <button type="button" class="btn" data-actmode="change">🔄 別の商品に変える<small>ネットで探して入れ替え</small></button>
      <button type="button" class="btn ghost" data-actmode="hist">🕘 この品の補充の履歴<small>日付を直す・取り消す</small></button></div>
      <p class="note">買う：</p><div class="glinks">${x.link ? `<a class="btn pri sm" href="${esc(x.link)}" target="_blank" rel="noopener">🛒 いつもの注文ページ</a>` : ""}${siteBtns(x.name)}</div>`;
  }
  const el = $("#sheet");
  el.innerHTML = `<div class="sheet-bg" data-actclose="1"></div><div class="sheet">${head}${body}</div>`;
  el.hidden = false; document.body.classList.add("modal");
}
async function actDo(kind, btn) {
  const id = S.act.id; const x = S.stock.find((s) => s.id === id); if (!x) return;
  if (kind === "edit") { S.act = null; openSheet(id); return; }
  if (kind === "restock") { closeAct(); H.list = null; restock(id); return; }
  if (kind === "tolist") { closeAct(); if (await toList(id)) toast(`「${x.name}」を補充リストに入れました`); return; }
  if (kind === "cancel") {
    btn.disabled = true;
    try {
      for (const tid of x.open || []) { await api("POST", `/api/lists/${tid}/cancel`); S.lists = S.lists.filter((t) => t.id !== tid); }
      x.open = []; saveSnap(); closeAct(); render(); toast(`「${x.name}」を補充リストから外しました`);
    } catch (err) { btn.disabled = false; toast(`外せませんでした：${err.message}`); }
  }
}
async function actSearch() {
  const q = $("#actq").value.trim(); if (!q) return;
  S.act.q = q;
  if (/^https:\/\//.test(q)) { await actFromUrl(q); return; }
  S.act.results = "loading"; renderAct();
  try {
    const r = await api("GET", `/api/search?q=${encodeURIComponent(q)}`);
    if (!r.configured) { S.act.results = null; renderAct(); toast("いまはアプリ内で探せませんでした。下のサイトのボタンで探して URL を貼ってください"); return; }
    S.act.results = r.items.map((i) => ({ name: i.name, image: i.image, link: i.url, jan: i.jan, price: i.price })); S.act.source = r.source;
  } catch (err) { S.act.results = null; toast(err.message); }
  renderAct();
}
async function actFromUrl(url) {
  S.act.results = "loading"; renderAct();
  try { const g = await api("POST", "/api/lookup", { url }); S.act.pick = { name: (g.title || "").replace(/\s*[|｜:：].*$/, "").slice(0, 80) || S.stock.find((s) => s.id === S.act.id)?.name, image: g.image, link: url }; }
  catch { S.act.pick = { name: S.stock.find((s) => s.id === S.act.id)?.name || "", image: "", link: url }; toast("ページから画像は取れませんでした。名前はあとで直せます"); }
  S.act.results = null; renderAct();
}
async function actApply(btn) {
  const a = S.act; const x = S.stock.find((s) => s.id === a.id); if (!x || !a.pick) return;
  btn.disabled = true;
  try {
    const body = { name: a.pick.name, image: a.pick.image || "", link: a.pick.link || "", jan: a.pick.jan || "" };
    if ($("#acttoday")?.checked) body.bought = jstDay();
    const res = await api("PATCH", `/api/stock/${x.id}`, body);
    Object.assign(x, res.stock, { open: x.open });
    for (const r of res.renamed || []) { const t = S.lists.find((l) => l.id === r.id); if (t) Object.assign(t, { name: r.name, link: r.link }); }
    saveSnap(); closeAct(); render(); toast(`「${x.name}」に変えました`);
  } catch (err) { btn.disabled = false; toast(`変えられませんでした：${err.message}`); }
}
async function addSitePrompt() {
  const name = (prompt("サイトの名前（例：クスリのアオキ、IKEA）") || "").trim(); if (!name) return;
  const url = (prompt("そのサイトで何か検索した結果のページの URL を貼ってください（トップページの URL でも可）") || "").trim(); if (!url) return;
  try { S.sites = (await api("POST", "/api/sites", { name, url })).sites; saveSnap(); toast(`「${name}」を購入サイトに登録しました`); if (S.act) renderAct(); else render(); }
  catch (err) { toast(`登録できませんでした：${err.message}`); }
}
document.addEventListener("submit", (e) => { if (e.target.id === "actsearch") { e.preventDefault(); $("#sug-act") && ($("#sug-act").innerHTML = ""); actSearch(); } });
// 打ちかけの言葉から検索の候補を出す（0.25秒待ってから・URL のときは出さない）
let sugTimer = 0; let sugSeq = 0;
document.addEventListener("input", (e) => {
  const kind = e.target.dataset?.sug; if (!kind) return;
  clearTimeout(sugTimer);
  const q = e.target.value.trim(); const box = $(`#sug-${kind}`); if (!box) return;
  if (!q || /^https?:/.test(q)) { box.innerHTML = ""; return; }
  sugTimer = setTimeout(async () => {
    const seq = ++sugSeq;
    try {
      const r = await api("GET", `/api/suggest?q=${encodeURIComponent(q)}`);
      if (seq !== sugSeq || !$(`#sug-${kind}`)) return;
      $(`#sug-${kind}`).innerHTML = r.words.map((w) => `<button type="button" class="chip" data-sugq="${esc(w)}" data-sugfor="${kind}">🔎 ${esc(w)}</button>`).join("");
    } catch { /* 候補が出なくても検索はできる */ }
  }, 250);
});

const TIMES = Array.from({ length: 48 }, (_, k) => `${String(Math.floor(k / 2)).padStart(2, "0")}:${k % 2 ? "30" : "00"}`);
// 日付・時刻の欄から買い物の日時を組み立てる（日付だけなら 10:00、時刻だけなら今日）
function whenFromFields(target) {
  const box = document.querySelector(`[data-wdate="${target}"]`)?.closest(".when"); if (!box) return;
  const date = box.querySelector("[data-wdate]").value;
  const time = (box.querySelector("[data-wtimefine]") || box.querySelector("[data-wtime]"))?.value || "";
  if (!date && !time) return;
  setWhen(target, `${date || jstDay()}T${time || "10:00"}:00+09:00`);
}
const remindsOf = (target) => (target === "plan" ? S.plan.before : S.reminders[target]) ?? REMIND_DEFAULT;
const remindText = (b) => (b.length ? REMIND_CHOICES.filter(([m]) => b.includes(m)).map(([, n]) => n).join("・") : "知らせない");
// タスクごとの「いつ買う・何分前に知らせる」の行と、開いたときの選択肢
function whenBar(target, at, { open = S.whenFor === target, label = "" } = {}) {
  const b = remindsOf(target);
  // 日付と時刻（30分刻み）の欄はいつも出す。分まで決めたいときだけ「細かく」で分単位の欄を出す。通知のタイミングは「🔔」で開く
  const date = at ? at.slice(0, 10) : ""; const hm = at ? at.slice(11, 16) : "";
  const fine = S.wfine === target || (hm && !TIMES.includes(hm));
  const times = `<option value="">時刻</option>${TIMES.map((t) => `<option ${t === hm ? "selected" : ""}>${t}</option>`).join("")}`;
  const head = `<div class="when"><span class="whenin">⏰ ${label}<input type="date" data-wdate="${target}" value="${date}" aria-label="買い物の日付">${fine ? `<input type="time" step="60" data-wtimefine="${target}" value="${hm}" aria-label="時刻（分まで）">` : `<select data-wtime="${target}" aria-label="時刻（30分刻み）">${times}</select>`}<button type="button" class="btn ghost sm" data-wfine="${target}">${fine ? "30分刻み" : "細かく"}</button></span>${target === "plan" ? "" : `<button type="button" class="btn ghost sm" data-whenopen="${target}" aria-expanded="${open}">${open ? "閉じる" : `🔔${at ? ` ${esc(remindText(b))}` : ""}`}</button>`}</div>`;
  if (!open) return head;
  const noPush = S.push && !S.push.subscribed && !S.push.unsupported;
  return `${head}<div class="whenpanel">${at ? `<div class="whens"><button type="button" class="chip" data-when="${target}|">時刻を外す</button></div>` : ""}
    <div class="remrow"><span class="mute">🔔 知らせる</span>${REMIND_CHOICES.map(([m, n]) => `<button type="button" class="chip${b.includes(m) ? " on" : ""}" data-remind="${target}|${m}" aria-pressed="${b.includes(m)}">${n}</button>`).join("")}</div>
    ${noPush ? `<p class="note">この端末は通知がオフです。🔔 通知タブでオンにすると届きます</p>` : ""}</div>`;
}
async function toggleRemind(target, m) {
  const cur = remindsOf(target);
  const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => b - a);
  if (target === "plan") { S.plan.before = next; savePlan(); render(); return; }
  const prev = S.reminders[target];
  S.reminders[target] = next; render();
  try { await api("PUT", `/api/lists/${target}/remind`, { before: next }); saveSnap(); toast(next.length ? `このタスクは ${remindText(next)} に知らせます` : "このタスクは知らせません"); }
  catch (err) { if (prev) S.reminders[target] = prev; else delete S.reminders[target]; render(); toast(`変えられませんでした：${err.message}`); }
}
async function setWhen(target, at) {
  if (target === "plan") { S.plan.at = at; savePlan(); render(); return; }
  const t = listOf(target); if (!t) return;
  const prev = t.at;
  t.at = at || null; render();
  try {
    setSync("busy");
    await api("PATCH", `/api/lists/${t.id}/when`, { at: at || null });
    saveSnap(); setSync("ok");
    toast(at ? `${fmtAt(at)}・🔔 ${remindText(remindsOf(t.id))}` : "時刻を外しました");
  } catch (err) { t.at = prev; setSync("err"); render(); toast(`時刻を入れられませんでした：${err.message}`); }
}

// ---------- いつもの買い物の準備（テンプレートから数を決める） ----------
const AISLE_ORDER = Object.fromEntries(A.AISLES.map((a) => [a.name, a.order]));
const aisleOfTpl = (x) => (x.aisle && x.aisle in AISLE_ORDER ? A.AISLES[AISLE_ORDER[x.aisle]] : A.aisleOf(x.name));
const tplText = (x, n) => (x.unit ? `${x.name} ${n}${x.unit}` : n > 1 ? `${x.name} ${n}` : x.name);
function planPicked() {
  return S.templates.filter((x) => S.plan.counts[x.id] > 0)
    .sort((a, b) => aisleOfTpl(a).order - aisleOfTpl(b).order || a.order - b.order)
    .map((x) => tplText(x, S.plan.counts[x.id]));
}
function planStep(id, d) {
  const x = S.templates.find((t) => t.id === id); if (!x) return;
  const n = Math.max(0, Math.min(99, (S.plan.counts[id] || 0) + d));
  if (n) S.plan.counts[id] = n; else delete S.plan.counts[id];
  savePlan(); render();
}
function planToggle(id) {
  const x = S.templates.find((t) => t.id === id); if (!x) return;
  if (S.plan.counts[id]) delete S.plan.counts[id]; else S.plan.counts[id] = x.qty || 1;
  savePlan(); render();
}
async function createPlan(btn) {
  const texts = [...planPicked(), ...S.plan.extra];
  if (!texts.length) { toast("買うものを選んでください"); return; }
  if (texts.length > 40) { toast("一度に作れるのは40品までです"); return; }
  const day = S.plan.at ? S.plan.at.slice(0, 10) : jstDay();
  const name = `🛒 ${S.plan.store || "買い物"} ${md(day)}`;
  btn.disabled = true;
  try {
    setSync("busy");
    const res = await api("POST", "/api/lists", { name, items: texts, at: S.plan.at || null });
    S.lists.unshift(res.list); markAdded(res.list);
    S.cur = res.list.id; store.set("cur", S.cur); S.planning = false;
    texts.forEach((t) => remember(A.splitQty(t).name));
    const before = S.plan.before;
    if (res.list.at && JSON.stringify(before) !== JSON.stringify(REMIND_DEFAULT)) {
      S.reminders[res.list.id] = before;
      api("PUT", `/api/lists/${res.list.id}/remind`, { before }).catch((err) => toast(`知らせ方を保存できませんでした：${err.message}`));
    }
    S.plan = { counts: {}, extra: [], at: "", store: S.plan.store, before }; savePlan(); saveHist(); saveSnap(); setSync("ok"); render();
    toast(`「${name}」を作りました（${texts.length}品${res.list.at ? `・${fmtAt(res.list.at)} 🔔 ${remindText(before)}` : ""}）`);
  } catch (err) { btn.disabled = false; setSync("err"); toast(`作れませんでした：${err.message}`); }
}
async function addToTemplate(k, btn) {
  const text = S.plan.extra[k]; if (!text) return;
  const q = A.splitQty(text); const a = A.aisleOf(q.name);
  btn.disabled = true;
  try {
    const res = await api("POST", "/api/templates", { name: q.name, store: S.plan.store || "その他", aisle: a.order < A.AISLES.length - 1 ? a.name : "", qty: parseFloat(q.qty) || 1, unit: q.qty.replace(/^[\d.]+/, "") });
    S.templates.push(res.template);
    S.plan.extra.splice(k, 1); S.plan.counts[res.template.id] = res.template.qty;
    savePlan(); saveSnap(); render();
    toast(`「${q.name}」をテンプレートに足しました`);
  } catch (err) { btn.disabled = false; toast(`足せませんでした：${err.message}`); }
}

// ---------- 在庫・補充：操作 ----------
async function toList(id, btn) {
  const x = S.stock.find((s) => s.id === id); if (!x || x.open?.length) return;
  if (btn) btn.disabled = true;
  try {
    setSync("busy");
    const res = await api("POST", `/api/stock/${id}/refill`);
    if (!S.lists.some((t) => t.id === res.task.id)) S.lists.push(res.task);
    x.open = [res.task.id];
    saveSnap(); setSync("ok"); render();
    return true;
  } catch (err) { setSync("err"); if (btn) btn.disabled = false; toast(`入れられませんでした：${err.message}`); return false; }
}
async function allToList() {
  const soon = soonStock(SOON_DAYS);
  if (!soon.length) return;
  let ok = 0;
  for (const x of soon) if (await toList(x.id)) ok++;
  toast(`${ok}品を補充リストに入れました`);
}
// 「補充した」は取り消しが面倒なので、いつも確かめてから記録する
const okRestock = (names) => confirm(`${names.length > 1 ? `${names.length}品（${names.slice(0, 3).join("・")}${names.length > 3 ? "…" : ""}）` : `「${names[0]}」`}を補充した（買った）として記録しますか？\n最終補充日が今日になります。`);
async function restock(id, btn) {
  const x = S.stock.find((s) => s.id === id); if (!x) return;
  if (!okRestock([x.name])) return;
  if (btn) btn.disabled = true;
  try {
    setSync("busy");
    const res = await api("POST", `/api/stock/${id}/restocked`);
    S.lists = S.lists.filter((t) => !res.done.includes(t.id));
    Object.assign(x, res.stock);
    saveSnap(); setSync("ok"); render();
    toast(`「${x.name}」を補充しました${x.left != null ? `（${leftTx(x.left)}）` : ""}`);
  } catch (err) { setSync("err"); if (btn) btn.disabled = false; toast(`記録できませんでした：${err.message}`); }
}
// ---------- 補充：選んでまとめて操作 ----------
async function bulk(kind, btn) {
  const ids = [...(S.pick || [])]; const xs = S.stock.filter((x) => ids.includes(x.id));
  if (!xs.length) { toast("品を選んでください"); return; }
  if (kind === "trash" && !confirm(`${xs.length}品を在庫から消しますか？\n（Notion のゴミ箱に入り、30日はそこから戻せます）`)) return;
  if (kind === "restock" && !okRestock(xs.map((x) => x.name))) return;
  btn.disabled = true; let ok = 0;
  for (const x of xs) {
    btn.textContent = `${ok + 1}/${xs.length}…`;
    try {
      if (kind === "list") { if (!x.open?.length && (await toList(x.id))) ok++; else if (x.open?.length) ok++; }
      else if (kind === "restock") { await api("POST", `/api/stock/${x.id}/restocked`).then((res) => { S.lists = S.lists.filter((t) => !res.done.includes(t.id)); Object.assign(x, res.stock); }); ok++; }
      else if (kind === "trash") { await api("DELETE", `/api/stock/${x.id}`); S.stock = S.stock.filter((s) => s.id !== x.id); ok++; }
    } catch (err) { toast(`「${x.name}」：${err.message}`); }
  }
  S.pick = null; saveSnap(); setSync("ok"); render();
  toast(`${ok}品を${{ list: "補充リストに入れました", restock: "補充した記録にしました", trash: "消しました（Notion のゴミ箱から戻せます）" }[kind]}`);
}

// Google で調べる（新しいタブで開く。キーや設定は要らない）
const googleUrl = (q, images = false) => `https://www.google.com/search?q=${encodeURIComponent(q)}${images ? "&tbm=isch" : ""}`;
const googleBtns = (q) => (q ? `<a class="btn ghost sm" href="${esc(googleUrl(q))}" target="_blank" rel="noopener">🔎 Google</a><a class="btn ghost sm" href="${esc(googleUrl(q, true))}" target="_blank" rel="noopener">🖼 画像検索</a>` : "");

// ---------- 店 ----------
// 店を選ぶ欄。いちばん下の「＋ 店を追加…」で名前を入れて増やせる
function storeSelect(name, cur, { blank = true } = {}) {
  const list = [...new Set([...S.stores, cur].filter(Boolean))];
  return `<select name="${name}" data-storesel="1">${blank ? `<option value="">—</option>` : ""}${list.map((n) => `<option ${n === cur ? "selected" : ""}>${esc(n)}</option>`).join("")}<option value="__add">＋ 店を追加…</option></select>`;
}
async function addStorePrompt() {
  const name = (prompt("店の名前（例：ベイシア、カインズ）") || "").replace(/\s+/g, " ").trim();
  if (!name) return "";
  try { S.stores = (await api("POST", "/api/stores", { name })).stores; saveSnap(); toast(`「${name}」を店に足しました`); return name; }
  catch (err) { toast(`足せませんでした：${err.message}`); return ""; }
}
document.addEventListener("change", async (e) => {
  const sel = e.target; if (!sel.dataset?.storesel || sel.value !== "__add") return;
  const name = await addStorePrompt();
  if (!name) { sel.value = ""; return; }
  sel.insertAdjacentHTML("afterbegin", `<option>${esc(name)}</option>`); sel.value = name;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});

// ---------- 在庫を直す・登録する（下から出るシート） ----------
const CAT_ICON = { 日用品: "🧻", 消耗品: "🧽", 食品: "🍚", 育児: "👶", サプリ: "💊", 美容: "🧴" };
const thumb = (x, cls = "thumb") => (x.image ? `<img class="${cls}" src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'${cls} ph',textContent:'${CAT_ICON[x.cat] || "📦"}'}))">` : `<span class="${cls} ph">${CAT_ICON[x.cat] || "📦"}</span>`);
// draft: { id（"new" なら新規）, name, cat, use, freq, size, link, memo, jan, image, bought, toList }
function openSheet(id, preset = {}) {
  const x = id === "new" ? {} : S.stock.find((s) => s.id === id);
  if (!x) return;
  S.sheet = { id, name: x.name || "", cat: x.cat || "", use: x.use || "", freq: x.freq || "毎日", size: x.size || "", link: x.link || "", memo: x.memo || "", jan: x.jan || "", image: x.image || "", store: x.store || "", changed: false, toList: id === "new", ...preset };
  renderSheet();
}
function closeSheet() { S.sheet = null; S.act = null; $("#sheet").hidden = true; $("#sheet").innerHTML = ""; document.body.classList.remove("modal"); }
function sheetRead() {
  const f = $("#sheetform"); if (!f) return;
  for (const [k, v] of new FormData(f).entries()) S.sheet[k] = v;
  S.sheet.changed = !!f.elements.changed?.checked;
  S.sheet.toList = !!f.elements.toList?.checked;
}
function perText(d, x) {
  const per = +d.use && +d.size ? Math.floor(d.size / (d.use / ({ 毎日: 1, 毎週: 7, 毎月: 30 }[d.freq] || 1))) : null;
  return (per != null ? `→ 1個で約${per}日もつ` : "例：1日1粒で30粒入り → 使う数 1・毎日・1個の量 30（同じ単位で）") + (x?.end ? `・いまは ${md(x.end)} まで（${leftTx(x.left)}）` : "");
}
function updSheet() {
  sheetRead();
  const x = S.stock.find((s) => s.id === S.sheet.id);
  $("#shper").textContent = perText(S.sheet, x);
  $("[data-sheetimg]").disabled = !S.sheet.link;
  $("#glinks").innerHTML = googleBtns(S.sheet.name || S.sheet.jan);
}
function renderSheet() {
  const d = S.sheet; const el = $("#sheet");
  const x = d.id === "new" ? null : S.stock.find((s) => s.id === d.id);
  el.innerHTML = `<div class="sheet-bg" data-sheetclose="1"></div><form class="sheet" id="sheetform">
    <div class="sh-head"><b>${d.id === "new" ? "在庫を登録" : "在庫を直す"}</b><button type="button" class="more" data-sheetclose="1" aria-label="閉じる">×</button></div>
    <div class="sh-top">${thumb({ image: d.image, cat: d.cat }, "big")}
      <div class="sh-img"><input name="image" type="url" inputmode="url" placeholder="画像の URL（自動でも入る）" value="${esc(d.image)}">
      <button type="button" class="btn sm" data-sheetimg="1" ${d.link ? "" : "disabled"}>🖼 商品ページから画像を取る</button></div></div>
    <div class="glinks" id="glinks">${googleBtns(d.name || d.jan)}</div>
    <label>名前<input name="name" required maxlength="100" value="${esc(d.name)}" autocomplete="off"></label>
    <div class="row2"><label>いつも買う店${storeSelect("store", d.store)}</label><label>メモ<input name="memo" maxlength="300" value="${esc(d.memo)}" autocomplete="off"></label></div>
    <div class="row2"><label>カテゴリ<select name="cat"><option value="">—</option>${CATS.map((c) => `<option ${c === d.cat ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <label>バーコード（JAN）<span class="inrow"><input name="jan" inputmode="numeric" maxlength="13" value="${esc(d.jan)}" placeholder="13桁"><button type="button" class="btn sm" data-scanjan="1" aria-label="バーコードを読む">📷</button></span></label></div>
    <div class="row3"><label>使う数<input name="use" type="number" inputmode="decimal" min="0" step="any" value="${esc(d.use)}" placeholder="1"></label>
      <label>あたり<select name="freq">${FREQS.map((f) => `<option ${f === d.freq ? "selected" : ""}>${f}</option>`).join("")}</select></label>
      <label>1個の量<input name="size" type="number" inputmode="decimal" min="0" step="any" value="${esc(d.size)}" placeholder="30"></label></div>
    <p class="note" id="shper">${perText(d, x)}</p>
    <label>注文ページ<input name="link" type="url" inputmode="url" value="${esc(d.link)}" placeholder="https://"></label>
    ${d.id === "new" ? `<label class="check"><input type="checkbox" name="toList" ${d.toList ? "checked" : ""}> 登録したら補充リストにも入れる</label>` : `<label class="check"><input type="checkbox" name="changed" ${d.changed ? "checked" : ""}> 商品を変えた・新しく買った（買った日を今日にする）</label>`}
    <div class="row-end">${x ? `<a class="btn ghost sm" href="${esc(x.url)}" target="_blank" rel="noopener">Notion ↗</a>` : ""}<button type="submit" class="btn pri">${d.id === "new" ? "登録する" : "保存"}</button></div></form>`;
  el.hidden = false; document.body.classList.add("modal");
}
async function sheetImage(btn) {
  sheetRead();
  if (!S.sheet.link) return;
  btn.disabled = true; btn.textContent = "探しています…";
  try {
    const got = await api("POST", "/api/lookup", { url: S.sheet.link });
    S.sheet.image = got.image; if (!S.sheet.name && got.title) S.sheet.name = got.title.slice(0, 80);
    renderSheet(); toast("商品ページの画像を入れました（保存で決定）");
  } catch (err) { btn.disabled = false; btn.textContent = "🖼 商品ページから画像を取る"; toast(err.message); }
}
async function saveSheet() {
  sheetRead();
  const d = S.sheet;
  const body = { name: d.name, cat: d.cat, use: d.use, freq: d.freq, size: d.size, link: d.link, memo: d.memo, jan: d.jan, image: d.image, store: d.store === "__add" ? "" : d.store };
  try {
    setSync("busy");
    if (d.id === "new") {
      const res = await api("POST", "/api/stock", body);
      S.stock.push(res.stock); closeSheet(); saveSnap(); setSync("ok");
      if (d.toList) await toList(res.stock.id);
      render(); toast(`「${res.stock.name}」を登録しました${d.toList ? "（補充リストにも入れました）" : ""}`);
    } else {
      if (d.changed) body.bought = jstDay();
      const res = await api("PATCH", `/api/stock/${d.id}`, body);
      const x = S.stock.find((s) => s.id === d.id);
      Object.assign(x, res.stock, { open: x.open });
      closeSheet(); saveSnap(); setSync("ok"); render(); toast("保存しました");
    }
  } catch (err) { setSync("err"); toast(`保存できませんでした：${err.message}`); }
}
// 注文ページがあって画像のない品に、商品ページの画像をまとめて入れる
async function fillImages(btn) {
  const xs = S.stock.filter((x) => x.link && !x.image);
  btn.disabled = true; let ok = 0;
  for (const [k, x] of xs.entries()) {
    btn.textContent = `画像を取っています… ${k + 1}/${xs.length}`;
    try {
      const got = await api("POST", "/api/lookup", { url: x.link });
      const res = await api("PATCH", `/api/stock/${x.id}`, { image: got.image });
      Object.assign(x, { image: res.stock.image }); ok++; render();
    } catch { /* 取れない店は飛ばす */ }
  }
  saveSnap(); render(); toast(`${ok}/${xs.length}品の画像を入れました${ok < xs.length ? "（取れなかった品は シートで画像の URL を貼れます）" : ""}`);
}

// ---------- カメラ：バーコードを読む・写真から当てる ----------
// mode: "add"（補充リストに入れる品を探す）か "jan"（シートの JAN 欄に入れる）
let scan = null;
function loadZxing() {
  if (window.ZXing) return Promise.resolve();
  return new Promise((ok, ng) => { const sc = document.createElement("script"); sc.src = "vendor/zxing.min.js"; sc.onload = ok; sc.onerror = () => ng(new Error("バーコードの部品を読めませんでした")); document.head.append(sc); });
}
const eanOk = (c) => { if (!/^(\d{8}|\d{12,13})$/.test(c)) return false; const d = c.padStart(13, "0").split("").map(Number); const sum = d.slice(0, 12).reduce((n, v, i) => n + v * (i % 2 ? 3 : 1), 0); return (10 - (sum % 10)) % 10 === d[12]; };
async function openScanner(mode) {
  if (!navigator.mediaDevices?.getUserMedia) { toast("この端末ではカメラを使えません"); return; }
  const el = $("#scanner");
  el.innerHTML = `<video playsinline muted></video><div class="scan-guide"></div>
    <div class="scan-top"><span id="scanmsg">${mode === "jan" ? "バーコードを枠に入れてください" : "バーコードか、商品の正面を写してください"}</span><button type="button" class="more" data-scanclose="1" aria-label="閉じる">×</button></div>
    <div class="scan-tools"><button type="button" class="btn sm" data-torch="1" hidden>🔦 ライト</button><label class="btn pri sm">📸 撮って読む<input type="file" accept="image/*" capture="environment" id="scanshot" hidden></label>${mode === "add" ? `<button type="button" class="btn sm" data-scanguess="1">🤖 いま予測</button>` : ""}</div>
    <div class="scan-card" id="scancard" hidden></div>`;
  el.hidden = false; document.body.classList.add("modal");
  scan = { mode, stop: false, guessN: 0, busy: false, found: false };
  try {
    scan.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch { closeScanner(); toast("カメラを使えませんでした（設定でカメラを許可してください）"); return; }
  // ピントを合わせ続ける・ライトがあればボタンを出す（対応している端末だけ）
  const track = scan.stream.getVideoTracks()[0]; scan.track = track;
  const caps = track.getCapabilities?.() || {};
  if (caps.focusMode?.includes("continuous")) track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
  if (caps.torch) { const t = el.querySelector("[data-torch]"); if (t) t.hidden = false; }
  const v = el.querySelector("video"); v.srcObject = scan.stream; await v.play().catch(() => {});
  scan.video = v; scan.started = Date.now();
  if ("BarcodeDetector" in window) { try { scan.detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a"] }); } catch { /* 下の ZXing で読む */ } }
  if (!scan.detector) { try { await loadZxing(); } catch (err) { $("#scanmsg").textContent = err.message; } }
  scanLoop();
}
function closeScanner() {
  if (scan) { scan.stop = true; scan.stream?.getTracks().forEach((t) => t.stop()); }
  scan = null; const el = $("#scanner"); el.hidden = true; el.innerHTML = "";
  if (!S.sheet) document.body.classList.remove("modal");
}
// 映像（か写真）の一部を切り出す。crop は [左, 上, 幅, 高さ] の割合、rotate で縦向きのバーコードも読む
function frame(w, { src = scan.video, crop = [0, 0, 1, 1], rotate = false } = {}) {
  const sw = src.videoWidth || src.naturalWidth || src.width || w; const sh = src.videoHeight || src.naturalHeight || src.height || w;
  const [cx, cy, cw, ch] = [crop[0] * sw, crop[1] * sh, crop[2] * sw, crop[3] * sh];
  const sc = Math.min(1, w / cw); const c = document.createElement("canvas"); const g = c.getContext("2d");
  const W = Math.round(cw * sc), H = Math.round(ch * sc);
  if (rotate) { c.width = H; c.height = W; g.translate(H, 0); g.rotate(Math.PI / 2); } else { c.width = W; c.height = H; }
  g.drawImage(src, cx, cy, cw, ch, 0, 0, W, H); return c;
}
const CROPS = [{ crop: [0.05, 0.2, 0.9, 0.6] }, { crop: [0, 0, 1, 1] }, { crop: [0.3, 0.1, 0.4, 0.8], rotate: true }];
function zxDecode(canvas) {
  const Z = window.ZXing; if (!Z) return "";
  scan.hints ||= new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A]], [Z.DecodeHintType.TRY_HARDER, true]]);
  scan.reader ||= new Z.MultiFormatReader();
  try { return scan.reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas))), scan.hints).getText(); } catch { return ""; }
}
async function readBarcode() {
  if (scan.detector) { const r = await scan.detector.detect(scan.video).catch(() => []); return r[0]?.rawValue || ""; }
  // 枠の中を高い解像度で → 全体 → 縦向き の順に、回ごとに切り替えて読む
  scan.tick = (scan.tick || 0) + 1;
  const o = CROPS[scan.tick % CROPS.length];
  return zxDecode(frame(o.crop[2] === 1 ? 1000 : 1280, o));
}
// 読み違いを避けるため、同じ番号を2回続けて読めたら決める
function confirmCode(code) {
  const now = Date.now();
  if (scan.last === code && now - scan.lastAt < 2000) return true;
  scan.last = code; scan.lastAt = now; return false;
}
// 撮った写真（ピントの合った静止画）からバーコードを読み、なければ写真から予測する
async function readShot(file) {
  if (!scan || !file) return;
  scan.found = true; $("#scanmsg").textContent = "写真を読んでいます…";
  const img = new Image(); const url = URL.createObjectURL(file);
  try {
    await new Promise((ok, ng) => { img.onload = ok; img.onerror = ng; img.src = url; });
    await loadZxing().catch(() => {});
    let code = "";
    if (scan.detector) { const r = await scan.detector.detect(img).catch(() => []); code = r[0]?.rawValue || ""; }
    const tries = [{ crop: [0, 0, 1, 1], w: 1600 }, { crop: [0.1, 0.25, 0.8, 0.5], w: 1600 }, { crop: [0, 0, 1, 1], w: 2400 }, { crop: [0.25, 0.05, 0.5, 0.9], w: 1600, rotate: true }, { crop: [0, 0, 1, 1], w: 1600, rotate: true }];
    for (const t of tries) { if (code) break; code = zxDecode(frame(t.w, { src: img, crop: t.crop, rotate: t.rotate })); }
    if (code.length === 12) code = `0${code}`;
    if (code && eanOk(code)) { scan.found = false; onBarcode(code); return; }
    if (scan.mode === "jan") { scan.found = false; $("#scanmsg").textContent = "バーコードが読めませんでした。近づけて、もう一度撮ってください"; return; }
    scan.found = false; await guess(frame(1280, { src: img }));
  } catch { if (scan) { scan.found = false; $("#scanmsg").textContent = "写真を読めませんでした"; } } finally { URL.revokeObjectURL(url); }
}
async function scanLoop() {
  while (scan && !scan.stop) {
    if (!scan.found && scan.video.readyState >= 2) {
      let code = await readBarcode();
      if (!scan || scan.stop) return;
      if (code.length === 12) code = `0${code}`;
      if (code && eanOk(code) && confirmCode(code)) { onBarcode(code); continue; }
      // バーコードが見つからなければ、かざしているだけで写真から当てる（2.5秒後・その後8秒ごと・3回まで）
      const t = Date.now() - scan.started;
      if (scan.mode === "add" && !scan.busy && scan.guessN < 3 && t > 2500 + scan.guessN * 8000) guess();
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}
function scanCard(html) { const c = $("#scancard"); if (!c) return; c.innerHTML = html; c.hidden = false; }
async function onBarcode(code) {
  scan.found = true;
  if (navigator.vibrate) navigator.vibrate(30);
  if (scan.mode === "jan") { closeScanner(); if (S.sheet) { sheetRead(); S.sheet.jan = code; renderSheet(); } toast(`バーコード ${code} を入れました`); return; }
  const hit = S.stock.find((x) => x.jan === code);
  if (hit) { foundCard(hit, `バーコード ${code}`); return; }
  $("#scanmsg").textContent = `バーコード ${code} を調べています…`;
  let info = {};
  try { info = await api("GET", `/api/jan/${code}`); } catch { /* 調べられなくても登録はできる */ }
  if (!scan) return;
  const pre = { jan: code, name: info.name || "", image: info.image || "", link: info.url || "" };
  scan.pre = pre;
  scanCard(`<div class="sc-row">${thumb({ image: pre.image })}<div><b>${esc(pre.name || "名前が分からない商品")}</b><small>新しい商品・バーコード ${code}${info.configured === false ? "（名前の検索は未設定）" : ""}</small></div></div>
    <div class="row-end">${pre.name ? `<button type="button" class="btn pri sm" data-scanreg="list">登録して補充リストへ</button>` : ""}<button type="button" class="btn sm" data-scanreg="edit">${pre.name ? "直して登録" : "名前を入れて登録"}</button><a class="btn ghost sm" href="${esc(googleUrl(pre.name || code))}" target="_blank" rel="noopener">🔎 Google</a><button type="button" class="btn ghost sm" data-scanagain="1">読み直す</button></div>`);
}
function foundCard(x, why) {
  scan.found = true; scan.hit = x.id;
  $("#scanmsg").textContent = why;
  scanCard(`<div class="sc-row">${thumb(x)}<div><b>${esc(x.name)}</b><small>${esc([x.cat, leftTx(x.left), x.open?.length ? "リスト済み" : ""].filter(Boolean).join("・"))}</small></div></div>
    <div class="row-end">${x.open?.length ? "" : `<button type="button" class="btn pri sm" data-scanact="list">🛒 補充リストへ</button>`}<button type="button" class="btn ok sm" data-scanact="restock">✓ 補充した</button><button type="button" class="btn sm" data-scanact="edit">直す</button><button type="button" class="btn ghost sm" data-scanagain="1">ちがう</button></div>`);
}
async function guess(canvas) {
  if (!scan || scan.busy) return;
  scan.busy = true; scan.guessN++;
  $("#scanmsg").textContent = "写真から商品を予測しています…";
  try {
    const img = (canvas || frame(1024)).toDataURL("image/jpeg", 0.8);
    const r = await api("POST", "/api/identify", { image: img, names: S.stock.map((x) => x.name) });
    if (!scan || scan.found) return;
    // 写真にバーコードの数字が読めたら、そちらで調べる
    if (r.jan && eanOk(r.jan) && !scan.found) { onBarcode(r.jan); return; }
    const hit = r.match && S.stock.find((x) => x.name === r.match);
    if (hit) { foundCard(hit, `写真から：たぶん「${hit.name}」`); return; }
    if (!r.name) { $("#scanmsg").textContent = "分かりませんでした。バーコードを写すか、もう一度"; return; }
    scan.pre = { name: r.name, cat: r.category };
    $("#scanmsg").textContent = "写真から予測しました";
    scanCard(`<div class="sc-row">${thumb({ cat: r.category })}<div><b>${esc(r.name)}</b><small>写真からの予測・在庫にない品</small></div></div>
      <div class="row-end"><button type="button" class="btn pri sm" data-scanreg="list">登録して補充リストへ</button><button type="button" class="btn sm" data-scanreg="edit">直して登録</button><a class="btn ghost sm" href="${esc(googleUrl(r.name))}" target="_blank" rel="noopener">🔎 Google</a><button type="button" class="btn ghost sm" data-scanguess="1">もう一度</button></div>`);
  } catch (err) { if (scan) $("#scanmsg").textContent = `予測できませんでした（${err.message}）。バーコードを写してください`; } finally { if (scan) scan.busy = false; }
}
async function scanRegister(how, btn) {
  const pre = scan?.pre || {}; closeScanner();
  if (how === "edit") { openSheet("new", { ...pre, toList: true }); return; }
  btn.disabled = true;
  try {
    setSync("busy");
    const res = await api("POST", "/api/stock", { name: pre.name, cat: pre.cat || "", jan: pre.jan || "", image: pre.image || "", link: pre.link || "" });
    S.stock.push(res.stock); saveSnap();
    await toList(res.stock.id);
    toast(`「${res.stock.name}」を登録して補充リストに入れました`);
  } catch (err) { setSync("err"); toast(`登録できませんでした：${err.message}`); }
}
async function scanAct(kind) {
  const id = scan?.hit; const x = S.stock.find((s) => s.id === id); closeScanner(); if (!x) return;
  if (kind === "list") { if (await toList(id)) toast(`「${x.name}」を補充リストに入れました`); }
  else if (kind === "restock") restock(id);
  else openSheet(id);
}

// ---------- 描く ----------
function render() {
  if (!memoryKey) return;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === S.tab)));
  const left = usualLists().reduce((n, t) => n + leftOf(t), 0) + (quickList() ? leftOf(quickList()) : 0);
  const soon = soonStock().length;
  badge("#b-list", left); badge("#b-stock", soon);
  appBadge(soon);
  const v = $("#view");
  const keep = document.activeElement?.id === "addin" ? { v: $("#addin").value, s: $("#addin").selectionStart } : null;
  if (S.tab === "price") v.innerHTML = renderPrices();
  else if (S.tab === "list") v.innerHTML = renderList();
  else if (S.tab === "stock") v.innerHTML = renderStock();
  else v.innerHTML = renderAlert();
  if (keep && $("#addin")) { const i = $("#addin"); i.value = keep.v; i.focus(); i.setSelectionRange(keep.s, keep.s); renderSuggest(); }
  else if ($("#addin")) renderSuggest();
  if (S.edit) { const e = $("#editin"); if (e) { e.focus(); e.select(); } }
}
function badge(sel, n) { const b = $(sel); b.hidden = !n; b.textContent = n > 99 ? "99+" : n; }
function appBadge(n) {
  try { if (n) navigator.setAppBadge?.(n); else navigator.clearAppBadge?.(); } catch { /* 対応していない端末 */ }
}

function renderList() {
  const soon = soonStock();
  const banner = soon.length ? `<button type="button" class="banner" data-go="stock"><span class="bi">⚠️</span><span><b>切れそうな在庫が${soon.length}品</b><small>${esc(soon.slice(0, 3).map((x) => `${x.name}（${leftTx(x.left)}）`).join("・"))}</small></span><span class="go">補充へ ›</span></button>` : "";
  const q = quickList();
  const segs = [["usual", "🛒 いつもの", usualLists().reduce((n, t) => n + leftOf(t), 0)], ["quick", "⚡ ちょい買い", q ? leftOf(q) : 0], ["other", "📦 そのほか", otherTasks().length]];
  const head = `${banner}<div class="kinds" role="tablist">${segs.map(([k, n, c]) => `<button type="button" data-seg="${k}" aria-pressed="${S.seg === k}">${n}${c ? `<span class="n">${c}</span>` : ""}</button>`).join("")}</div>`;
  if (S.seg === "quick") return head + renderQuick();
  if (S.seg === "other") return head + renderOther();
  return head + renderUsual();
}
// ---------- 買い物セット：ボタンで明細に足す・もう一度押すと取り消す ----------
const saveSetAdded = () => store.set("setAdded", JSON.stringify(S.setAdded));
// where は "plan"（準備画面）かリストの id
function setOn(where, id) { return where === "plan" ? !!S.plan.sets?.[id] : !!S.setAdded[`${where}|${id}`]?.length; }
function setChips(where) {
  const store_ = where === "plan" ? S.plan.store : "";
  const sets = S.sets.filter((x) => !store_ || !x.store || x.store === store_);
  return `<div class="chips setchips"><span class="mute">セット：</span>${sets.map((x) => { const on = setOn(where, x.id); return `<button type="button" class="chip${on ? " on" : ""}" data-setgo="${where}|${x.id}" aria-pressed="${on}" title="${esc(x.items.join("・"))}">${on ? "✓ " : "＋ "}${esc(x.name)}<small>${on ? "取り消す" : `${x.items.length}品`}</small></button>`; }).join("")}${where === "plan" ? `<button type="button" class="chip" data-setsave="1">💾 今の明細をセットに</button>` : ""}<button type="button" class="chip" data-setedit="1">⚙️</button></div>`;
}
function tplFor(name) { const k = kana(name).replace(/\s/g, ""); return S.templates.find((t) => t.store === S.plan.store && kana(t.name).replace(/\s/g, "") === k) || S.templates.find((t) => kana(t.name).replace(/\s/g, "") === k); }
function toggleSet(where, id) {
  const set = S.sets.find((x) => x.id === id); if (!set) return;
  if (where === "plan") {
    S.plan.sets ||= {};
    const rec = S.plan.sets[id];
    if (rec) {
      // 取り消す：数を入れる前に戻し、足した品を外す
      for (const [tid, prev] of Object.entries(rec.counts)) { if (prev) S.plan.counts[tid] = prev; else delete S.plan.counts[tid]; }
      for (const e of rec.extra) { const k = S.plan.extra.indexOf(e); if (k >= 0) S.plan.extra.splice(k, 1); }
      delete S.plan.sets[id]; savePlan(); render(); toast(`「${set.name}」を取り消しました`); return;
    }
    const r = { counts: {}, extra: [] };
    for (const item of set.items) {
      const q = A.splitQty(item); const tpl = tplFor(q.name);
      if (tpl) {
        if (!(tpl.id in r.counts)) r.counts[tpl.id] = S.plan.counts[tpl.id] || 0;
        const n = parseFloat(q.qty) || tpl.qty || 1;
        S.plan.counts[tpl.id] = Math.max(S.plan.counts[tpl.id] || 0, n);
      } else if (!S.plan.extra.includes(item)) { S.plan.extra.push(item); r.extra.push(item); }
    }
    S.plan.sets[id] = r; savePlan(); render(); toast(`「${set.name}」の${set.items.length}品を入れました（もう一度押すと取り消し）`); return;
  }
  const key = `${where}|${id}`; const t = listOf(where); if (!t) return;
  if (S.setAdded[key]?.length) {
    const ids = S.setAdded[key]; delete S.setAdded[key]; saveSetAdded();
    for (const iid of ids) if (findItem(iid)[1]) removeItem(iid);
    toast(`「${set.name}」で入れた品を取り消しました`); return;
  }
  // リストにまだない品だけ足す
  const have = new Set((t.items || []).map((i) => kana(A.splitQty(i.text).name).replace(/\s/g, "")));
  const texts = set.items.filter((x) => !have.has(kana(A.splitQty(x).name).replace(/\s/g, "")));
  if (!texts.length) { toast("セットの品はもうリストに入っています"); return; }
  const before = new Set((t.items || []).map((i) => i.id));
  S.cur = t.id; addTexts(texts);
  S.setAdded[key] = (t.items || []).filter((i) => !before.has(i.id)).map((i) => i.id); saveSetAdded(); render();
  toast(`「${set.name}」から${texts.length}品入れました（もう一度押すと取り消し）`);
}
async function savePlanAsSet() {
  const items = [...planPicked(), ...S.plan.extra];
  if (!items.length) { toast("先に明細に品を入れてください"); return; }
  const name = (prompt(`今の明細（${items.length}品）をセットにします。名前は？（例：蒸籠蒸しの材料）`) || "").trim(); if (!name) return;
  try { const r = await api("POST", "/api/sets", { name, store: S.plan.store, items }); S.sets.push(r.set); saveSnap(); render(); toast(`セット「${name}」を作りました`); }
  catch (err) { toast(`作れませんでした：${err.message}`); }
}
// セットを直すシート：名前・店・品（1行1品）・消す・新しく作る
function openSetSheet() { S.setSheetNew = false; renderSetSheet(); }
function renderSetSheet() {
  const el = $("#sheet");
  const form = (x) => `<form class="setform card" data-setform="${x ? x.id : "new"}"><input name="name" value="${esc(x?.name || "")}" placeholder="セットの名前（例：蒸籠蒸しの材料）" maxlength="100" required>
    <label class="mute">よく買う店 ${storeSelect("store", x?.store || "")}</label>
    <textarea name="items" rows="${Math.min(10, Math.max(4, (x?.items.length || 0) + 1))}" placeholder="1行に1品（例：もやし 3袋）">${esc((x?.items || []).join("\n"))}</textarea>
    <div class="row-end">${x ? `<button type="button" class="btn danger sm" data-setdel="${x.id}">🗑 消す</button>` : ""}<button type="submit" class="btn pri sm">${x ? "保存" : "作る"}</button></div></form>`;
  el.innerHTML = `<div class="sheet-bg" data-setsheetclose="1"></div><div class="sheet"><div class="sh-head"><b>⚙️ 買い物セット</b><button type="button" class="more" data-setsheetclose="1" aria-label="閉じる">×</button></div>
    <p class="note">Notion の DB_買い物セット と同じ中身です。品は1行に1品、数は「もやし 3袋」のように後ろに書きます。</p>
    ${S.sets.map(form).join("")}${S.setSheetNew ? form(null) : `<div class="row-end"><button type="button" class="btn" data-setnew="1">＋ 新しいセット</button></div>`}</div>`;
  el.hidden = false; document.body.classList.add("modal");
}
async function saveSetForm(f) {
  const id = f.dataset.setform; const body = { name: f.elements.name.value, store: f.elements.store.value === "__add" ? "" : f.elements.store.value, items: f.elements.items.value.split("\n") };
  try {
    const r = id === "new" ? await api("POST", "/api/sets", body) : await api("PATCH", `/api/sets/${id}`, body);
    const k = S.sets.findIndex((x) => x.id === r.set.id); if (k >= 0) S.sets[k] = r.set; else S.sets.push(r.set);
    S.setSheetNew = false; saveSnap(); renderSetSheet(); toast(`セット「${r.set.name}」を保存しました`);
  } catch (err) { toast(`保存できませんでした：${err.message}`); }
}
async function deleteSet(id) {
  const x = S.sets.find((s) => s.id === id); if (!x || !confirm(`セット「${x.name}」を消しますか？（Notion のゴミ箱から戻せます）`)) return;
  try { await api("DELETE", `/api/sets/${id}`); S.sets = S.sets.filter((s) => s.id !== id); saveSnap(); renderSetSheet(); toast("消しました"); }
  catch (err) { toast(`消せませんでした：${err.message}`); }
}
document.addEventListener("submit", (e) => { if (e.target.dataset?.setform) { e.preventDefault(); saveSetForm(e.target); } });

const addBox = (ph) => `<form class="addbox" id="addform"><input id="addin" type="text" maxlength="400" autocomplete="off" enterkeyhint="done" placeholder="${esc(ph)}" aria-label="買うもの"><button type="submit" class="btn pri">入れる</button></form><div class="suggest" id="suggest"></div>`;

function renderUsual() {
  const lists = usualLists();
  if (S.planning || !lists.length) return renderPlan(lists.length > 0);
  if (!lists.some((t) => t.id === S.cur)) S.cur = lists[0].id;
  const t = listOf(S.cur);
  const chips = lists.map((x) => `<button type="button" class="lchip" data-cur="${x.id}" aria-pressed="${S.cur === x.id}">${esc(x.name.replace(/^🛒\s*/, ""))}<span class="n">${leftOf(x)}</span></button>`).join("")
    + `<button type="button" class="lchip add" data-plan="1">＋ 準備する</button>`;
  return `<div class="lchips">${chips}</div>${listView(t, "その場で足す（牛乳、卵）")}`;
}
function renderQuick() {
  const t = quickList();
  const note = `<p class="note pad">思いついた品をサッと足す1枚。ついでの買い物でまとめて買えます。</p>`;
  return note + (t ? listView(t, "思いついたら入れる（電池、洗剤）") : `${addBox("思いついたら入れる（電池、洗剤）")}<div class="empty small">まだ何もありません</div>`);
}

function listView(t, ph) {
  const items = t.items || [];
  const todo = items.filter((i) => !i.checked); const basket = items.filter((i) => i.checked);
  const when = whenBar(t.id, t.at);
  const tools = `<div class="ltools"><div class="seg"><button type="button" data-sort="aisle" aria-pressed="${S.sort === "aisle"}">売り場順</button><button type="button" data-sort="added" aria-pressed="${S.sort === "added"}">入れた順</button></div>
    <span class="mute">${todo.length ? `あと${todo.length}品` : items.length ? "ぜんぶかごに入りました" : ""}</span>${basket.length && !S.lpick ? `<button type="button" class="btn ghost sm" data-clear="${t.id}">🗑 チェック済み${basket.length}品を消す</button>` : ""}${items.length ? `<button type="button" class="btn ${S.lpick ? "pri" : "ghost"} sm" data-lpickmode="1">${S.lpick ? "選ぶのをやめる" : "☑ 選んで消す"}</button>` : ""}${t.link ? `<a class="btn ghost sm" href="${esc(t.link)}" target="_blank" rel="noopener">🛒 開く</a>` : ""}<a class="btn ghost sm" href="${esc(t.url)}" target="_blank" rel="noopener" aria-label="Notion で開く">↗</a></div>`;
  const prog = items.length ? `<div class="prog"><i style="width:${Math.round((basket.length / items.length) * 100)}%"></i></div>` : "";
  if (S.lpick) {
    const all = items.every((i) => S.lpick.has(i.id));
    return `${when}<div class="card list">${tools}${groups(items)}</div>
      <div class="card bulkbar"><b>${S.lpick.size}品を選択中</b><div class="row-end"><button type="button" class="btn ghost sm" data-lpickall="${t.id}">${all ? "全部外す" : "全部選ぶ"}</button><button type="button" class="btn danger sm" data-lpickdel="${t.id}" ${S.lpick.size ? "" : "disabled"}>🗑 選んだ${S.lpick.size}品を消す</button></div></div>`;
  }
  // チェックした品は消さずに、その場で色を反転して残す（並びは変えない）
  const body = items.length ? groups(items) : `<div class="empty small">上の欄から入れてください。「、」で区切るとまとめて入ります</div>`;
  const bk = items.length && !todo.length ? `<div class="empty small">🎉 ぜんぶかごに入りました</div>` : "";
  const foot = `<div class="lfoot">${basket.length ? `<button type="button" class="btn" data-clear="${t.id}">チェック済み${basket.length}品をリストから消す</button>` : ""}${items.length && !todo.length ? `<button type="button" class="btn ok" data-finish="${t.id}">買い物おわり（済みにする）</button>` : ""}${t.more ? `<p class="note">本文の ToDo が100個を超えています。続きは Notion で見てください</p>` : ""}</div>`;
  return `${when}${addBox(ph)}${setChips(t.id)}<div class="card list">${tools}${prog}${body}${bk}</div>${foot}`;
}

function renderPlan(canBack) {
  if (!S.templates.length) {
    return `<div class="card"><h2>🛒 いつもの買い物</h2><p class="note">${S.templateErr ? `テンプレートを読めませんでした（${esc(S.templateErr)}）。Notion の DB_買い物テンプレート を開き、「•••」→「接続」→「かいもの」を追加してください。` : "DB_買い物テンプレート に品がありません。Notion で足してください。"}</p></div>
      <div class="row-end"><button type="button" class="btn" data-plannew="1">テンプレートなしで空のリストを作る</button></div>`;
  }
  const stores = [...new Set([...S.templates.map((x) => x.store), ...S.stores])];
  if (!stores.includes(S.plan.store)) S.plan.store = stores[0];
  const xs = S.templates.filter((x) => x.store === S.plan.store).sort((a, b) => aisleOfTpl(a).order - aisleOfTpl(b).order || a.order - b.order || a.name.localeCompare(b.name, "ja"));
  let g = null;
  const rows = xs.map((x) => {
    const a = aisleOfTpl(x); const n = S.plan.counts[x.id] || 0;
    const h = a.name !== g ? `<div class="ghead"><span>${a.icon}</span>${esc((g = a.name))}</div>` : "";
    return `${h}<div class="prow${n ? " on" : ""}"><button type="button" class="pname" data-ptoggle="${x.id}"><span class="box" aria-hidden="true"></span><span class="tx">${esc(x.name)}</span><small>いつも ${x.qty}${esc(x.unit)}</small></button>
      <div class="step"><button type="button" data-pstep="${x.id}|-1" aria-label="${esc(x.name)}を1つ減らす">−</button><b>${n}${n && x.unit ? `<small>${esc(x.unit)}</small>` : ""}</b><button type="button" data-pstep="${x.id}|1" aria-label="${esc(x.name)}を1つ増やす">＋</button></div></div>`;
  }).join("");
  const extra = S.plan.extra.map((e, k) => `<div class="prow on"><span class="pname"><span class="tx">${esc(e)}</span><small>今回だけ</small></span><button type="button" class="btn ghost sm" data-tpladd="${k}">＋テンプレへ</button><button type="button" class="more" data-pextradel="${k}" aria-label="外す">×</button></div>`).join("");
  const picked = planPicked().length + S.plan.extra.length;
  return `<div class="card plan"><div class="phead"><h2>🛒 準備：今回なにを何個？</h2>${canBack ? `<button type="button" class="btn ghost sm" data-plan="0">やめる</button>` : ""}</div>
    <p class="note">名前をタップでいつもの数、−／＋で数を決めます。品は Notion の DB_買い物テンプレート で整えられます。</p>
    <div class="chips">${stores.map((n) => `<button type="button" class="chip" data-pstore="${esc(n)}" aria-pressed="${n === S.plan.store}">${esc(n)}</button>`).join("")}<button type="button" class="chip" data-storeadd="plan">＋ 店</button></div>
    ${setChips("plan")}
    ${xs.length ? "" : `<p class="note">「${esc(S.plan.store)}」のテンプレートはまだありません。下の欄に入れて「＋テンプレへ」で増やせます</p>`}
    <div class="list">${rows}</div>
    ${extra ? `<div class="ghead"><span>✍️</span>今回だけ</div>${extra}` : ""}
    <form class="addbox" id="planextra"><input id="pextra" type="text" maxlength="200" autocomplete="off" enterkeyhint="done" placeholder="テンプレにない品（例：ケーキ）" aria-label="テンプレにない品"><button type="submit" class="btn">足す</button></form></div>
    <div class="card pfoot">${whenBar("plan", S.plan.at, { open: true, label: "いつ買う？ " })}
    <div class="row-end">${picked ? `<button type="button" class="btn ghost" data-planclear="1">選び直す</button>` : ""}<button type="button" class="btn pri" data-plancreate="1" ${picked ? "" : "disabled"}>${picked}品でリストを作る</button></div></div>`;
}

function renderOther() {
  const ts = otherTasks(); const refills = ts.filter((t) => t.refill.length); const rest = ts.filter((t) => !t.refill.length);
  if (!ts.length) return `<div class="empty">ネット注文などの買い物タスクはありません</div>`;
  const card = (t) => {
    const items = t.items || []; const done = items.filter((i) => i.checked).length; const open = S.openOther === t.id;
    const meta = t.at ? fmtAt(t.at) : t.date ? md(t.date) : "";
    return `<div class="card ocard"><div class="ohead"><button type="button" class="oname" data-oopen="${t.id}">${esc(t.name)}</button>${meta ? `<span class="meta">${esc(meta)}</span>` : ""}</div>
      ${t.next ? `<div class="osub">次：${esc(t.next)}</div>` : ""}
      ${items.length ? `<button type="button" class="oprog" data-oopen="${t.id}"><span class="prog"><i style="width:${Math.round((done / items.length) * 100)}%"></i></span><small>${done}/${items.length} ${open ? "▲" : "▼"}</small></button>` : ""}
      ${open && items.length ? `<div class="list">${items.map(itemRow).join("")}</div>` : ""}
      ${whenBar(t.id, t.at)}
      <div class="oacts">${t.link ? `<a class="btn ghost sm" href="${esc(t.link)}" target="_blank" rel="noopener">🛒 開く</a>` : ""}<a class="btn ghost sm" href="${esc(t.url)}" target="_blank" rel="noopener">Notion ↗</a><button type="button" class="btn ok sm" data-finish="${t.id}">✓ 済み</button></div></div>`;
  };
  return rest.map(card).join("") + (refills.length ? `<h3 class="sec">📦 補充（在庫から）</h3>${renderRefills(refills)}` : "");
}
function groups(items) {
  if (S.sort === "added") {
    let g = null;
    return items.map((i) => { const h = i.group !== g ? ((g = i.group) ? `<div class="ghead">${esc(g)}</div>` : "") : ""; return h + itemRow(i); }).join("");
  }
  const by = new Map();
  for (const i of items) { const a = A.aisleOf(A.splitQty(i.text).name); if (!by.has(a.order)) by.set(a.order, { a, items: [] }); by.get(a.order).items.push(i); }
  return [...by.values()].sort((x, y) => x.a.order - y.a.order).map(({ a, items: xs }) => `<div class="ghead"><span>${a.icon}</span>${esc(a.name)}<small>${xs.length}</small></div>${xs.map(itemRow).join("")}`).join("");
}
function itemRow(i) {
  if (S.lpick) {
    const q = A.splitQty(i.text); const on = S.lpick.has(i.id);
    return `<div class="item${on ? " picked" : ""}"><button type="button" class="tick" data-lpick="${i.id}" aria-pressed="${on}"><span class="pickbox${on ? " on" : ""}" aria-hidden="true"></span><span class="tx">${esc(q.name)}</span>${q.qty ? `<span class="qty">${esc(q.qty)}</span>` : ""}${i.checked ? `<small class="mute">かご</small>` : ""}</button></div>`;
  }
  if (S.edit === i.id) {
    return `<form class="item editing" data-editform="${i.id}"><input id="editin" value="${esc(i.text)}" maxlength="200" aria-label="品目の名前" enterkeyhint="done"><button type="submit" class="btn pri sm">直す</button><button type="button" class="btn danger sm" data-del="${i.id}">消す</button></form>`;
  }
  const q = A.splitQty(i.text);
  return `<div class="item${i.checked ? " on" : ""}${i.id.startsWith("tmp") ? " pending" : ""}"><button type="button" class="tick" data-toggle="${i.id}" aria-pressed="${i.checked}"><span class="box" aria-hidden="true"></span><span class="tx">${esc(q.name)}</span>${q.qty ? `<span class="qty">${esc(q.qty)}</span>` : ""}</button><button type="button" class="more" data-edit="${i.id}" aria-label="「${esc(q.name)}」を直す">⋯</button></div>`;
}
function renderRefills(ts) {
  return `<p class="note pad">買えたら ○ で済み（最終補充日が今日に）。名前をタップすると、外す・直す・別の商品に変える・ネットで買う が選べます。</p><div class="card list">${ts.map((t) => {
    const x = S.stock.find((s) => t.refill.includes(s.id));
    return `<div class="item ritem"><button type="button" class="tick" data-finish="${t.id}" aria-label="「${esc(t.name)}」を買えた"><span class="box" aria-hidden="true"></span></button><button type="button" class="tick rname" ${x ? `data-act="${x.id}"` : `data-finish="${t.id}"`}>${x ? thumb(x) : ""}<span class="tx">${esc(t.name.replace(/^補充:/, ""))}</span>${x ? `<span class="qty" style="color:${leftColor(x)}">${esc(leftTx(x.left))}</span>` : ""}</button><button type="button" class="more${t.at ? " on" : ""}" data-whenopen="${t.id}" aria-label="「${esc(t.name)}」の時刻と通知">⏰</button>${t.link ? `<a class="more" href="${esc(t.link)}" target="_blank" rel="noopener" aria-label="注文ページを開く">🛒</a>` : ""}</div>${t.at || S.whenFor === t.id ? `<div class="rwhen">${whenBar(t.id, t.at)}</div>` : ""}`;
  }).join("")}</div>`;
}

// 入力中の候補：入れたことのある品目・在庫の名前・定番から
function renderSuggest() {
  const box = $("#suggest"); if (!box) return;
  const raw = $("#addin").value; const parts = A.splitInput(raw); const q = /[、,，;\n]\s*$/.test(raw) ? "" : parts.at(-1) || "";
  const t = S.seg === "quick" ? quickList() : listOf(S.cur);
  const onList = new Set((t?.items || []).filter((i) => !i.checked).map((i) => A.splitQty(i.text).name));
  const names = new Map();
  const put = (n, score) => { if (n && !onList.has(n) && !parts.slice(0, -1).includes(n)) names.set(n, Math.max(names.get(n) || 0, score)); };
  for (const [n, h] of Object.entries(hist)) put(n, h.n + (h.last === S.today ? 0 : 0.5));
  for (const x of S.stock) put(x.name, 0.3);
  A.STAPLES.forEach((n, k) => put(n, 0.2 - k / 1000));
  let out;
  if (q) {
    const k = kana(q);
    out = [...names].filter(([n]) => kana(n).includes(k) && n !== q).sort((a, b) => (kana(b[0]).startsWith(k) - kana(a[0]).startsWith(k)) || b[1] - a[1]).slice(0, 8);
    box.innerHTML = out.length ? out.map(([n]) => `<button type="button" class="chip" data-sug="${esc(n)}">＋ ${esc(n)}</button>`).join("") : "";
    return;
  }
  if (S.seg !== "quick") { box.innerHTML = ""; return; } // いつものリストでは、打ちかけたときだけ候補を出す
  const soon = soonStock(SOON_DAYS).filter((x) => !onList.has(x.name)).slice(0, 4);
  for (const x of soon) names.delete(x.name);
  out = [...names].filter(([n]) => hist[n]?.n >= 1).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (out.length < 6) out = out.concat([...names].filter(([n]) => !hist[n]?.n && !out.some(([m]) => m === n)).sort((a, b) => b[1] - a[1]).slice(0, 8 - out.length));
  box.innerHTML = (soon.length ? `<div class="sgl">📦 切れそう</div>${soon.map((x) => `<button type="button" class="chip warn" data-sug="${esc(x.name)}">＋ ${esc(x.name)}<small>${esc(leftTx(x.left))}</small></button>`).join("")}` : "")
    + (out.length ? `<div class="sgl">${Object.keys(hist).length ? "よく買う" : "定番"}</div>${out.map(([n]) => `<button type="button" class="chip" data-sug="${esc(n)}">＋ ${esc(n)}</button>`).join("")}` : "");
}

// ---------- 補充の履歴：間違えて補充した記録を直す ----------
const H = { list: null, loading: false };
async function loadHistory() {
  H.loading = true;
  try { H.list = (await api("GET", "/api/refills/history")).history; } catch (err) { H.list = []; toast(`履歴を読めませんでした：${err.message}`); }
  H.loading = false;
}
function histRows(stockId) {
  if (!H.list) return `<p class="note">読みこみ中…</p>`;
  const xs = H.list.filter((h) => !stockId || h.stock === stockId);
  if (!xs.length) return `<p class="note">補充した記録はありません</p>`;
  return `<div class="hist">${xs.map((h) => { const x = S.stock.find((s) => s.id === h.stock); return `<div class="hrow">${stockId ? "" : thumb(x || {})}<span class="hname">${stockId ? "" : esc(h.name)}</span><input type="date" data-hdate="${h.id}" value="${esc(h.date || "")}" max="${jstDay()}" aria-label="補充した日"><button type="button" class="btn ghost sm" data-hfix="reopen|${h.id}" title="まだ買っていなかった">↩ リストに戻す</button><button type="button" class="btn danger sm" data-hfix="trash|${h.id}" title="間違えて補充した">🗑 取り消す</button></div>`; }).join("")}</div>
    <p class="note">日付を変えると最終補充日と切れる予定日が直ります。「↩ リストに戻す」はまだ買っていなかったとき、「🗑 取り消す」は間違えて補充したとき（記録をゴミ箱へ）。</p>`;
}
async function fixHistory(action, id, value) {
  const h = H.list?.find((x) => x.id === id); if (!h) return;
  if (action === "trash" && !confirm(`${md(h.date || "")}の「${h.name}」の補充の記録を取り消しますか？`)) return;
  if (action === "reopen" && !confirm(`「${h.name}」を補充リストに戻しますか？（補充した記録はなくなります）`)) return;
  try {
    const r = await api("PATCH", `/api/refills/${id}`, action === "date" ? { action, date: value } : { action });
    if (action === "date") h.date = r.date;
    else H.list = H.list.filter((x) => x.id !== id);
    if (r.task) { S.lists.push(r.task); const x = S.stock.find((s) => s.id === h.stock); if (x) x.open = [...(x.open || []), r.task.id]; }
    toast(action === "date" ? "補充した日を直しました" : action === "reopen" ? `「${h.name}」を補充リストに戻しました` : "補充の記録を取り消しました");
    // 最終補充日・切れる予定日は Notion の計算で決まるので、少し待って読み直す
    setTimeout(() => load({ quiet: true }), 1500);
    if (S.act) renderAct(); else render();
  } catch (err) { toast(`直せませんでした：${err.message}`); }
}
document.addEventListener("change", (e) => { const id = e.target.dataset?.hdate; if (id && e.target.value) fixHistory("date", id, e.target.value); });
function renderHistoryView() {
  if (!H.list && !H.loading) loadHistory().then(render);
  return `<div class="ltools"><b>🕘 補充の履歴</b><span class="mute">${H.list ? `${H.list.length}件` : ""}</span><button type="button" class="btn pri sm" data-histview="0">おわる</button></div><div class="card">${histRows("")}</div>`;
}

function renderStock() {
  if (S.maint) return renderMaint();
  if (S.histView) return renderHistoryView();
  const all = S.stock;
  const out = all.filter((x) => x.left != null && x.left <= 0).length;
  const week = all.filter((x) => x.left != null && x.left > 0 && x.left <= SOON_DAYS).length;
  const listed = all.filter((x) => x.open?.length).length;
  const soon = soonStock(SOON_DAYS).length;
  const noImg = all.filter((x) => x.link && !x.image).length;
  const unset = all.filter((x) => x.left == null).length;
  const cats = [...new Set(all.map((x) => x.cat).filter(Boolean))];
  const items = all.filter((x) => !S.stockCat || (S.stockCat === "未設定" ? x.left == null : x.cat === S.stockCat)).sort((a, b) => (a.left ?? 1e9) - (b.left ?? 1e9) || a.name.localeCompare(b.name, "ja"));
  const rows = items.map((x) => {
    const pct = x.left != null && x.days ? Math.max(0, Math.min(100, Math.round((x.left / x.days) * 100))) : null;
    const sub = x.left == null ? (x.use ? "買った日が未入力" : "使う数が未入力") : `${md(x.end)}まで${x.days ? `・1個${x.days}日` : ""}`;
    const on = S.pick?.has(x.id);
    const act = S.pick ? `<span class="pickbox${on ? " on" : ""}" aria-hidden="true"></span>`
      : x.open?.length ? `<button type="button" class="ib ok" data-restock="${x.id}" aria-label="「${esc(x.name)}」を補充した" title="補充した">✓</button>`
      : `<button type="button" class="ib" data-tolist="${x.id}" aria-label="「${esc(x.name)}」を補充リストへ" title="補充リストへ">🛒</button>`;
    return `<div class="srow${on ? " picked" : ""}" style="--c:${leftColor(x)}"><button type="button" class="sm-main" ${S.pick ? `data-pick="${x.id}" aria-pressed="${!!on}"` : `data-act="${x.id}"`}>${thumb(x)}<span class="sm-tx"><span class="nm">${esc(x.name)}</span><span class="sub"><b>${esc(leftTx(x.left) || "—")}</b>${x.open?.length ? `<i class="tag">リスト済</i>` : ""} ${esc(sub)}</span>${pct != null ? `<span class="gauge"><i style="width:${pct}%"></i></span>` : ""}</span></button>${act}</div>`;
  }).join("");
  return `<div class="stats1"><span><b style="color:var(--bad)">${out}</b>切れ</span><span><b style="color:var(--warn)">${week}</b>${SOON_DAYS}日内</span><span><b>${listed}</b>リスト済</span><span><b>${all.length}</b>全部</span></div>
    <div class="stock-acts three"><button type="button" class="btn pri" data-scan="add">📷 スキャン</button><button type="button" class="btn" data-sheet="new">＋ 登録</button><button type="button" class="btn" data-maint="1">🛠 整備</button></div>
    <div class="row-end"><button type="button" class="btn ghost sm" data-histview="1">🕘 補充の履歴（間違いを直す）</button></div>
    ${soon || noImg ? `<div class="row-end">${soon ? `<button type="button" class="btn sm" data-alltolist="1">切れそうな${soon}品をまとめてリストへ</button>` : ""}${noImg ? `<button type="button" class="btn ghost sm" data-fillimg="1">🖼 画像をまとめて取る（${noImg}品）</button>` : ""}</div>` : ""}
    ${cats.length ? `<div class="chips"><button type="button" class="chip" data-cat="" aria-pressed="${!S.stockCat}">すべて</button>${cats.map((c) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${S.stockCat === c}">${CAT_ICON[c] || ""}${esc(c)}</button>`).join("")}${unset ? `<button type="button" class="chip" data-cat="未設定" aria-pressed="${S.stockCat === "未設定"}">⚙️ 未設定 ${unset}</button>` : ""}</div>` : ""}
    <div class="ltools pickbar"><span class="mute">${items.length}品</span>${S.pick ? `<button type="button" class="btn ghost sm" data-pickall="1">${items.every((x) => S.pick.has(x.id)) ? "全部外す" : "全部選ぶ"}</button>` : ""}<button type="button" class="btn ${S.pick ? "pri" : "ghost"} sm" data-pickmode="1">${S.pick ? "選ぶのをやめる" : "☑ 選んでまとめて"}</button></div>
    <div class="card list">${rows || `<div class="empty small">${S.loading ? "読みこみ中…" : "在庫の登録がありません"}</div>`}</div>
    ${S.pick ? `<div class="card bulkbar"><b>${S.pick.size}品を選択中</b><div class="row-end"><button type="button" class="btn sm" data-bulk="list" ${S.pick.size ? "" : "disabled"}>🛒 補充リストへ</button><button type="button" class="btn ok sm" data-bulk="restock" ${S.pick.size ? "" : "disabled"}>✓ 補充した</button><button type="button" class="btn danger sm" data-bulk="trash" ${S.pick.size ? "" : "disabled"}>🗑 消す</button></div></div>` : ""}
    <p class="note pad">行をタップすると、補充した・補充リストから外す・直す・別の商品に変える・ネットで買う が選べます。🛒 は補充タスクを作り、✓ で済みにすると最終補充日が今日になります。</p>`;
}

// ---------- 補充リストの整備：表でまとめて直す・足す・消す ----------
function renderMaint() {
  const items = [...S.stock].sort((a, b) => (a.left == null) - (b.left == null) || (b.left == null) - (a.left == null) || a.name.localeCompare(b.name, "ja"));
  const unsetFirst = items.sort((a, b) => Number(!!b.use === false) - Number(!!a.use === false));
  const sel = (name, val, opts) => `<select data-mf="${name}"><option value="">—</option>${opts.map((o) => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  const rows = unsetFirst.map((x) => `<tr data-mrow="${x.id}" class="${x.use && x.size ? "" : "unset"}"><td class="mname"><div>${thumb(x)}<input data-mf="name" value="${esc(x.name)}" aria-label="名前"></div></td>
    <td><input data-mf="use" type="number" inputmode="decimal" min="0" step="any" value="${esc(x.use || "")}" aria-label="使う数"></td>
    <td>${sel("freq", x.freq, FREQS)}</td>
    <td><input data-mf="size" type="number" inputmode="decimal" min="0" step="any" value="${esc(x.size || "")}" aria-label="1個の量"></td>
    <td>${sel("cat", x.cat, CATS)}</td>
    <td>${storeSelect("store", x.store).replace('name="store"', 'data-mf="store"')}</td>
    <td><button type="button" class="more" data-mdel="${x.id}" aria-label="「${esc(x.name)}」を消す">🗑</button></td></tr>`).join("");
  const res = S.msearch ? (S.msearch.loading ? `<p class="note">🔎 探しています…</p>` : S.msearch.items.length ? `<p class="note">${esc(S.msearch.source || "")}の候補</p>${S.msearch.items.map((r, k) => `<div class="mres">${thumb({ image: r.image })}<span>${esc(r.name)}${r.price ? `<small>${esc(r.price)}</small>` : ""}</span><button type="button" class="btn sm" data-madd="${k}">＋ 追加</button></div>`).join("")}` : `<p class="note">見つかりませんでした</p>`) : "";
  return `<div class="ltools"><b>🛠 補充リストの整備</b><span class="mute">${S.stock.length}品</span><button type="button" class="btn pri sm" data-maint="0">おわる</button></div>
    <form class="card maintadd" id="maintadd"><input id="maintin" maxlength="300" placeholder="商品名で探す・名前だけ入れる・URL を貼る" autocomplete="off" aria-label="追加する品" data-sug="maint"><div class="sugs" id="sug-maint"></div><div class="row-end"><button type="button" class="btn sm" data-scan="add">📷 写真・バーコード</button><button type="button" class="btn pri sm" data-msearch="1">🔎 探す</button><button type="submit" class="btn sm">名前だけで追加</button></div>${res}</form>
    <div class="card mwrap"><table class="mtable"><thead><tr><th>名前</th><th>使う数</th><th>あたり</th><th>1個の量</th><th>カテゴリ</th><th>店</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note pad">変えたらすぐ Notion に保存します。黄色の行は使う数か1個の量が空で、切れる日が出せない品です。例：1日1粒で30粒入り → 使う数 1・毎日・量 30</p>`;
}
async function maintSave(el) {
  const tr = el.closest("[data-mrow]"); if (!tr) return;
  const id = tr.dataset.mrow; const f = el.dataset.mf; const x = S.stock.find((s) => s.id === id); if (!x) return;
  let v = el.value; if (f === "store" && v === "__add") return;
  if (f === "name" && !v.trim()) { el.value = x.name; return; }
  el.classList.add("saving");
  try {
    const res = await api("PATCH", `/api/stock/${id}`, { [f]: v });
    Object.assign(x, res.stock, { open: x.open });
    el.classList.remove("saving"); el.classList.add("saved"); setTimeout(() => el.classList.remove("saved"), 900);
    saveSnap();
    if (f === "use" || f === "size") tr.classList.toggle("unset", !(x.use && x.size));
  } catch (err) { el.classList.remove("saving"); toast(`保存できませんでした：${err.message}`); }
}
async function maintDelete(id) {
  const x = S.stock.find((s) => s.id === id); if (!x) return;
  if (!confirm(`「${x.name}」を在庫から消しますか？（Notion のゴミ箱から30日は戻せます）`)) return;
  try { await api("DELETE", `/api/stock/${id}`); S.stock = S.stock.filter((s) => s.id !== id); saveSnap(); render(); toast(`「${x.name}」を消しました`); }
  catch (err) { toast(`消せませんでした：${err.message}`); }
}
async function maintAdd() {
  const i = $("#maintin"); const v = i.value.trim(); if (!v) { i.focus(); return; }
  let body = { name: v };
  if (/^https:\/\//.test(v)) {
    toast("商品ページを読んでいます…");
    try { const g = await api("POST", "/api/lookup", { url: v }); body = { name: (g.title || "").replace(/\s*[|｜:：].*$/, "").slice(0, 80) || "（名前を入れてください）", image: g.image, link: v }; }
    catch { body = { name: "（名前を入れてください）", link: v }; }
  }
  try { const res = await api("POST", "/api/stock", body); S.stock.push(res.stock); saveSnap(); render(); toast(`「${res.stock.name}」を足しました。使う数などを入れてください`); }
  catch (err) { toast(`足せませんでした：${err.message}`); }
}
async function maintSearch(btn) {
  const q = $("#maintin").value.trim(); if (!q) { toast("探す品の名前を入れてください"); $("#maintin").focus(); return; }
  S.msearch = { loading: true, items: [] }; render(); $("#maintin").value = q;
  try {
    const r = await api("GET", `/api/search?q=${encodeURIComponent(q)}`);
    if (!r.configured) { S.msearch = null; render(); $("#maintin").value = q; toast("いまはアプリ内で探せませんでした。商品ページの URL を貼ると画像つきで足せます"); return; }
    S.msearch = { loading: false, items: r.items, source: r.source };
  } catch (err) { S.msearch = null; toast(err.message); }
  render(); $("#maintin").value = q;
}
async function maintAddResult(k, btn) {
  const r = S.msearch?.items[k]; if (!r) return;
  btn.disabled = true;
  try { const res = await api("POST", "/api/stock", { name: r.name, image: r.image, link: r.url, jan: r.jan }); S.stock.push(res.stock); saveSnap(); S.msearch = null; render(); toast(`「${res.stock.name}」を足しました`); }
  catch (err) { btn.disabled = false; toast(`足せませんでした：${err.message}`); }
}
document.addEventListener("change", (e) => { if (e.target.dataset?.mf && e.target.closest(".mtable")) maintSave(e.target); });
document.addEventListener("submit", (e) => { if (e.target.id === "maintadd") { e.preventDefault(); maintAdd(); } });

// ---------- 通知 ----------
const pushOk = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone;
async function pushSub() { const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription(); }
async function loadPush() {
  if (!pushOk()) { S.push = { unsupported: true }; return; }
  try {
    const sub = await pushSub();
    S.push = sub ? { ...(await api("POST", "/api/push/status", { endpoint: sub.endpoint })), endpoint: sub.endpoint } : { subscribed: false };
    if (S.push.subscribed) S.alertDays = S.push.days;
  } catch (err) { S.push = { subscribed: false, err: err.message }; }
  if (S.tab === "alert") render();
}
function pushForm() {
  const p = S.push || {};
  const hour = p.hour ?? 8; const days = p.days ?? 3;
  return `<label>知らせる時刻<select name="hour">${Array.from({ length: 18 }, (_, k) => k + 5).map((h) => `<option value="${h}" ${h === hour ? "selected" : ""}>${h}:00</option>`).join("")}</select></label>
    <label>切れる何日前から<select name="days">${[[0, "切れた日から"], [1, "1日前"], [2, "2日前"], [3, "3日前"], [5, "5日前"], [7, "7日前"]].map(([d, n]) => `<option value="${d}" ${d === days ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <label class="check"><input type="checkbox" name="list" ${p.list ? "checked" : ""}> 在庫と一緒に、リストに残っている品目も知らせる</label>
    <label class="check"><input type="checkbox" name="remind" ${p.remind !== false ? "checked" : ""}> 買い物の時刻を知らせる（タスクごとに決めた何分前に）</label>`;
}
function renderAlert() {
  const p = S.push;
  let body;
  if (!p) body = `<p class="note">確かめています…</p>`;
  else if (p.unsupported) body = `<p class="note">${/iphone|ipad/i.test(navigator.userAgent) && !standalone() ? "iPhone は Safari の共有ボタン →「ホーム画面に追加」で入れたアプリから開くと通知を使えます（iOS 16.4 以上）。" : "このブラウザは通知に対応していません。"}</p>`;
  else if (Notification.permission === "denied") body = `<p class="note">通知が拒否されています。設定アプリ →「通知」→「かいもの」で許可してから開き直してください。</p>`;
  else if (p.subscribed) body = `<p class="ok-line">✅ この端末に通知します（在庫は毎日 ${p.hour}:00${p.remind !== false ? "・買い物の時刻" : ""}）</p><form id="pushform" class="form">${pushForm()}<div class="row-end"><button type="button" class="btn ghost" data-push="off">オフにする</button><button type="button" class="btn" data-push="test">いま試す</button><button type="submit" class="btn pri">保存</button></div></form>`;
  else body = `<form id="pushform" class="form">${pushForm()}<div class="row-end"><button type="submit" class="btn pri">通知をオンにする</button></div></form>${p.err ? `<p class="note err">${esc(p.err)}</p>` : ""}`;
  const soon = soonStock();
  return `<div class="card form"><h2>🔔 通知</h2><p class="note">・在庫：DB_Daily の切れる予定日が近い品（補充タスクがまだないもの）を毎日決めた時刻に。アイコンのバッジにも件数が出ます<br>・買い物の時刻：各タスクの ⏰ で決めた時刻に、そのタスクで選んだタイミング（前日・1時間前・30分前・ちょうど など。決めていなければ30分前とちょうど）で</p>${body}</div>
    <div class="card"><h2>いま知らせる内容</h2>${soon.length ? `<ul class="plain">${soon.map((x) => `<li><span style="color:${leftColor(x)}">●</span> ${esc(x.name)}<small>${esc(leftTx(x.left))}</small></li>`).join("")}</ul>` : `<p class="note">切れそうな在庫はありません（${S.alertDays}日前まで）</p>`}</div>
    <div class="card"><h2>この端末</h2><p class="note">合言葉はこの端末にだけ保存しています。</p><div class="row-end"><button type="button" class="btn ghost" data-logout="1">合言葉を消す</button></div></div>`;
}
function urlB64(s) { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
async function pushSave(form) {
  const f = new FormData(form);
  const opts = { hour: +f.get("hour"), days: +f.get("days"), list: f.get("list") === "on", remind: f.get("remind") === "on" };
  try {
    let sub = await pushSub();
    if (!sub) {
      if ((await Notification.requestPermission()) !== "granted") { toast("通知が許可されませんでした"); render(); return; }
      const { publicKey, ready } = await api("GET", "/api/push");
      if (!ready) throw new Error("Worker に通知の設定がまだありません（README の手順2-5）");
      const reg = await navigator.serviceWorker.ready;
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(publicKey) });
    }
    S.push = { ...(await api("PUT", "/api/push", { subscription: sub.toJSON(), ...opts })), endpoint: sub.endpoint };
    S.alertDays = S.push.days;
    toast("通知の設定を保存しました"); render();
  } catch (err) { toast(`通知をオンにできませんでした：${err.message}`); }
}
async function pushAction(kind) {
  try {
    const sub = await pushSub(); if (!sub) { S.push = { subscribed: false }; render(); return; }
    if (kind === "test") { await api("POST", "/api/push/test", { endpoint: sub.endpoint }); toast("通知を送りました"); return; }
    await api("DELETE", "/api/push", { endpoint: sub.endpoint });
    await sub.unsubscribe().catch(() => {});
    S.push = { subscribed: false }; toast("通知をオフにしました"); render();
  } catch (err) { toast(err.message); }
}

// ---------- 画面の操作 ----------
document.addEventListener("click", (e) => {
  const el = e.target.closest("button,[data-go],[data-sheetclose],[data-actclose],[data-setsheetclose]"); if (!el) return;
  const d = el.dataset;
  if (d.tab) { S.tab = d.tab; S.edit = ""; S.pick = null; S.lpick = null; render(); if (d.tab === "alert") loadPush(); window.scrollTo(0, 0); return; }
  if (d.go) { S.tab = d.go; render(); window.scrollTo(0, 0); return; }
  if (d.cur) { S.cur = d.cur; store.set("cur", d.cur); S.edit = ""; S.whenFor = ""; S.lpick = null; render(); return; }
  if (d.seg) { S.seg = d.seg; store.set("seg", d.seg); S.edit = ""; S.whenFor = ""; S.lpick = null; render(); return; }
  if (d.plan) { S.planning = d.plan === "1"; render(); window.scrollTo(0, 0); return; }
  if (d.plannew) { createList(`🛒 買い物 ${md(jstDay())}`); return; }
  if (d.storeadd) { addStorePrompt().then((n) => { if (n && d.storeadd === "plan") { S.plan.store = n; savePlan(); } render(); }); return; }
  if (d.storedel) {
    if (!confirm(`「${d.storedel}」を店の一覧から外しますか？（記録は消えません）`)) return;
    api("DELETE", "/api/stores", { name: d.storedel }).then((r) => { S.stores = r.stores; saveSnap(); render(); }).catch((err) => toast(err.message)); return;
  }
  if (d.maint) { S.maint = d.maint === "1"; S.pick = null; S.msearch = null; render(); return; }
  if (d.mdel) { maintDelete(d.mdel); return; }
  if (d.msearch) { maintSearch(el); return; }
  if (d.madd !== undefined && d.madd !== "") { maintAddResult(+d.madd, el); return; }
  if (d.pstore) { S.plan.store = d.pstore; savePlan(); render(); return; }
  if (d.ptoggle) { planToggle(d.ptoggle); return; }
  if (d.pstep) { const [id, n] = d.pstep.split("|"); planStep(id, +n); return; }
  if (d.pextradel) { S.plan.extra.splice(+d.pextradel, 1); savePlan(); render(); return; }
  if (d.tpladd) { addToTemplate(+d.tpladd, el); return; }
  if (d.planclear) { S.plan.counts = {}; S.plan.extra = []; S.plan.sets = {}; savePlan(); render(); return; }
  if (d.setgo) { const [where, id] = d.setgo.split("|"); toggleSet(where, id); return; }
  if (d.setsave) { savePlanAsSet(); return; }
  if (d.setedit) { openSetSheet(); return; }
  if (d.setsheetclose) { closeSheet(); return; }
  if (d.setdel) { deleteSet(d.setdel); return; }
  if (d.setnew) { S.setSheetNew = true; renderSetSheet(); return; }
  if (d.plancreate) { createPlan(el); return; }
  if (d.remind) { const [target, m] = d.remind.split("|"); toggleRemind(target, +m); return; }
  if (d.wfine) { S.wfine = S.wfine === d.wfine ? "" : d.wfine; render(); return; }
  if (d.whenopen) { S.whenFor = S.whenFor === d.whenopen ? "" : d.whenopen; render(); return; }
  if (d.when !== undefined && d.when.includes("|")) { const [target, at] = d.when.split("|"); setWhen(target, at); return; }
  if (d.oopen) { S.openOther = S.openOther === d.oopen ? "" : d.oopen; render(); return; }
  if (d.sort) { S.sort = d.sort; store.set("sort", d.sort); render(); return; }
  if (d.toggle) { toggle(d.toggle); return; }
  if (d.lpickmode) { S.lpick = S.lpick ? null : new Set(); S.edit = ""; render(); return; }
  if (d.lpick) { S.lpick.has(d.lpick) ? S.lpick.delete(d.lpick) : S.lpick.add(d.lpick); render(); return; }
  if (d.lpickall) { const t = listOf(d.lpickall); const ids = (t?.items || []).map((i) => i.id); if (ids.every((id) => S.lpick.has(id))) S.lpick.clear(); else ids.forEach((id) => S.lpick.add(id)); render(); return; }
  if (d.lpickdel) { const t = listOf(d.lpickdel); if (t) deletePicked(t); return; }
  if (d.edit) { S.edit = d.edit; render(); return; }
  if (d.del) { removeItem(d.del); return; }
  if (d.basket) { S.showBasket = !S.showBasket; render(); return; }
  if (d.clear) { const t = listOf(d.clear); if (t) clearBasket(t); return; }
  if (d.finish) {
    const t = listOf(d.finish); if (!t) return;
    if (t.refill.length && !okRestock([t.name.replace(/^補充:/, "")])) return;
    finishList(t, t.refill.length ? "補充した" : "買い物おわり"); return;
  }
  if (d.sug) {
    const i = $("#addin"); const parts = A.splitInput(i.value);
    if (!/[、,，;\n]\s*$/.test(i.value)) parts.pop();
    i.value = "";
    addTexts([...parts, d.sug]);
    return;
  }
  if (d.tolist) { toList(d.tolist, el).then((ok) => ok && toast("補充リストに入れました")); return; }
  if (d.alltolist) { el.disabled = true; allToList(); return; }
  if (d.restock) { restock(d.restock, el); return; }
  if (d.histview) { S.histView = d.histview === "1"; if (S.histView) H.list = null; render(); return; }
  if (d.hfix) { const [a, id] = d.hfix.split("|"); fixHistory(a, id); return; }
  if (d.sheet) { openSheet(d.sheet); return; }
  if (d.act) { openAct(d.act); return; }
  if (d.actclose) { closeAct(); return; }
  if (d.actdo) { actDo(d.actdo, el); return; }
  if (d.actmode) {
    S.act.mode = d.actmode; S.act.pick = null; S.act.results = null; renderAct();
    // 開いたらすぐ今の品名で探して候補を並べる
    if (d.actmode === "change") actSearch();
    return;
  }
  if (d.sugq !== undefined) {
    const i = $(d.sugfor === "act" ? "#actq" : "#maintin"); if (!i) return;
    i.value = d.sugq; $(`#sug-${d.sugfor}`).innerHTML = "";
    if (d.sugfor === "act") actSearch(); else maintSearch();
    return;
  }
  if (d.actpick !== undefined) { if (d.actpick === "") S.act.pick = null; else S.act.pick = S.act.results[+d.actpick]; renderAct(); return; }
  if (d.actapply) { actApply(el); return; }
  if (d.actpaste) { navigator.clipboard?.readText?.().then((t) => { $("#actq").value = t.trim(); actSearch(); }).catch(() => toast("貼り付けできませんでした。欄を長押しして貼ってください")); return; }
  if (d.siteadd) { addSitePrompt(); return; }
  if (d.sheetclose) { closeSheet(); return; }
  if (d.sheetimg) { sheetImage(el); return; }
  if (d.scanjan) { sheetRead(); openScanner("jan"); return; }
  if (d.scan) { openScanner(d.scan); return; }
  if (d.scanclose) { closeScanner(); return; }
  if (d.scanagain) { scan.found = false; scan.hit = ""; scan.pre = null; $("#scancard").hidden = true; $("#scanmsg").textContent = "バーコードか、商品の正面を写してください"; scan.started = Date.now(); scan.guessN = 0; return; }
  if (d.scanguess) { $("#scancard").hidden = true; scan.found = false; guess(); return; }
  if (d.torch) { scan.torch = !scan.torch; scan.track?.applyConstraints({ advanced: [{ torch: scan.torch }] }).catch(() => toast("ライトを点けられませんでした")); el.classList.toggle("pri", scan.torch); return; }
  if (d.scanreg) { scanRegister(d.scanreg, el); return; }
  if (d.scanact) { scanAct(d.scanact); return; }
  if (d.fillimg) { fillImages(el); return; }
  if (d.pickmode) { S.pick = S.pick ? null : new Set(); render(); return; }
  if (d.pick) { S.pick.has(d.pick) ? S.pick.delete(d.pick) : S.pick.add(d.pick); render(); return; }
  if (d.pickall) {
    const vis = S.stock.filter((x) => !S.stockCat || (S.stockCat === "未設定" ? x.left == null : x.cat === S.stockCat)).map((x) => x.id);
    if (vis.every((id) => S.pick.has(id))) vis.forEach((id) => S.pick.delete(id)); else vis.forEach((id) => S.pick.add(id));
    render(); return;
  }
  if (d.bulk) { bulk(d.bulk, el); return; }
  if (d.cat !== undefined && el.classList.contains("chip")) { S.stockCat = d.cat; render(); return; }
  if (d.push) { pushAction(d.push); return; }
  if (d.logout) { memoryKey = ""; store.set(KEY_STORAGE, ""); showLogin(); return; }
});
document.addEventListener("submit", (e) => {
  const f = e.target; e.preventDefault();
  if (f.id === "addform") { const i = $("#addin"); const texts = A.splitInput(i.value); i.value = ""; addTexts(texts); i.focus(); return; }
  if (f.id === "planextra") { const v = $("#pextra").value; const add = A.splitInput(v); if (add.length) { S.plan.extra.push(...add); savePlan(); render(); $("#pextra")?.focus(); } return; }
  if (f.dataset.editform) { renameItem(f.dataset.editform, $("#editin").value); return; }
  if (f.id === "sheetform") { saveSheet(); return; }
  if (f.id === "pushform") { pushSave(f); return; }
  if (f.id === "login-form") {
    const k = $("#key").value.trim(); if (k.length < 16) return;
    memoryKey = k; store.set(KEY_STORAGE, k);
    $("#login").hidden = true; $("#view").hidden = false; document.body.classList.remove("locked");
    load();
  }
});
document.addEventListener("input", (e) => { if (e.target.id === "addin") renderSuggest(); });
document.addEventListener("change", (e) => {
  const d = e.target.dataset || {}; const t = d.wdate ?? d.wtime ?? d.wtimefine;
  if (t !== undefined) whenFromFields(t);
});
document.addEventListener("keydown", (e) => { if (e.target.id === "editin" && e.key === "Escape") { S.edit = ""; render(); } });
$("#reload").addEventListener("click", () => load());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && scan) closeScanner(); });
document.addEventListener("input", (e) => { if (S.sheet && e.target.closest("#sheetform") && ["use", "size", "link", "name", "jan"].includes(e.target.name)) updSheet(); });
document.addEventListener("change", (e) => { if (S.sheet && e.target.closest("#sheetform") && e.target.name === "freq") updSheet(); });
document.addEventListener("change", (e) => { if (e.target.id === "scanshot") { readShot(e.target.files?.[0]); e.target.value = ""; } });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && memoryKey && Date.now() - Date.parse(S.loadedAt || 0) > 60e3) load({ quiet: true }); });

function showLogin() {
  $("#login").hidden = false; $("#view").hidden = true; document.body.classList.add("locked");
  setStatus("");
  $("#key")?.focus();
}

// ---------- はじまり ----------
(function boot() {
  const qs = new URLSearchParams(location.search);
  if (["list", "stock", "price", "alert"].includes(qs.get("tab"))) S.tab = qs.get("tab");
  if (/^[0-9a-f]{32}$/.test(qs.get("list") || "")) S.wantList = qs.get("list");
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!memoryKey) { showLogin(); return; }
  const snap = store.json("snap", null);
  if (snap) { Object.assign(S, snap); applyOver(); }
  render();
  if (Q.length) flush();
  load();
  if (pushOk()) loadPush();
})();
