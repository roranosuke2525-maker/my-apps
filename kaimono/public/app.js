// かいもの：買い物リスト（DB_タスク管理の BUY タスクの本文の ToDo）・在庫と補充（DB_Daily）・切れそうな在庫の通知。
// /api は Cloudflare Worker（src/worker.js）が Notion API で答える。開くには合言葉（APP_KEY）が要る。
// 品目の書き込みは端末に順番待ちで貯め、電波が戻ったら順に送る（お店の中で圏外になっても使える）。
const A = window.KaimonoAisle;
const PRESETS = ["スーパー", "ドラッグストア", "ネット注文", "100均", "コンビニ"];
const CATS = ["日用品", "消耗品", "食品", "育児", "サプリ", "美容"];
const FREQS = ["毎日", "毎週", "毎月"];
const SOON_DAYS = 7; // 補充の画面で「そろそろ」に数える日数
const KEY_STORAGE = "key";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k, d = "") { try { const v = localStorage.getItem(`kaimono:${k}`); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`kaimono:${k}`, v); } catch { /* 保存できなくても動く */ } },
  json(k, d) { try { return JSON.parse(store.get(k, "")) ?? d; } catch { return d; } },
};

const S = {
  tab: "list", lists: [], stock: [], today: "", loadedAt: "", cur: store.get("cur"), sort: store.get("sort", "aisle"),
  showBasket: false, edit: "", newList: false, stockCat: "", stockForm: false, alertDays: 3, push: null, loading: false,
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

const saveSnap = () => store.set("snap", JSON.stringify({ lists: S.lists, stock: S.stock, today: S.today, loadedAt: S.loadedAt }));
const saveQueue = () => store.set("queue", JSON.stringify(Q));
const saveHist = () => store.set("hist", JSON.stringify(hist));

// ---------- データ ----------
const shopLists = () => S.lists.filter((t) => !t.refill.length);
const refillTasks = () => S.lists.filter((t) => t.refill.length);
const listOf = (id) => S.lists.find((t) => t.id === id);
const leftOf = (t) => (t.items || []).filter((i) => !i.checked).length;
const soonStock = (days = S.alertDays) => S.stock.filter((x) => x.left != null && x.left <= days && !x.open?.length);
const leftTx = (n) => (n == null ? "" : n < 0 ? `切れて${-n}日` : n === 0 ? "今日切れる" : `あと${n}日`);
const leftColor = (x) => (x.left == null ? "var(--mute)" : x.left <= 0 ? "var(--bad)" : x.left <= 3 ? "var(--warn)" : x.left <= SOON_DAYS ? "var(--soon)" : "var(--ok)");
const md = (d) => (d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : "");
const kana = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

async function load({ quiet = false } = {}) {
  if (Q.length) { pendingReload = true; flush(); return; } // 送り終えてから読み直す
  if (S.loading) return;
  S.loading = true;
  if (!quiet) setStatus("Notion から読みこみ中…");
  try {
    const st = await api("GET", "/api/state");
    Object.assign(S, { lists: st.lists, stock: st.stock, today: st.today, loadedAt: st.loadedAt });
    for (const t of shopLists()) for (const i of t.items || []) remember(A.splitQty(i.text).name, false);
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
      for (const t of S.lists) for (const i of t.items || []) if (i.id === tid) i.id = real;
      for (const q of Q) if (q.item === tid) q.item = real;
      if (S.edit === tid) S.edit = real;
    });
    render();
  } else if (op.k === "check") await api("PATCH", `/api/items/${op.item}`, { checked: op.checked });
  else if (op.k === "text") await api("PATCH", `/api/items/${op.item}`, { text: op.text });
  else if (op.k === "del") await api("DELETE", `/api/items/${op.item}`);
}
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
  let t = listOf(S.cur);
  if (!t || t.refill.length) t = shopLists()[0];
  if (!t) {
    // リストがまだなければ、入れた品目ごと新しく作る
    try {
      setSync("busy");
      const res = await api("POST", "/api/lists", { name: "買い物リスト", items: texts });
      S.lists.unshift(res.list);
      S.cur = res.list.id; store.set("cur", S.cur);
      texts.forEach((s) => remember(A.splitQty(s).name));
      saveHist(); saveSnap(); setSync("ok"); render();
      toast(`買い物リストを作って ${texts.length}品 入れました`);
    } catch (err) { setSync("err"); toast(`作れませんでした：${err.message}`); }
    return;
  }
  S.cur = t.id;
  const temps = texts.map(() => `tmp${Date.now()}${tmpN++}`);
  t.items = t.items || [];
  texts.forEach((s, n) => t.items.push({ id: temps[n], text: s, checked: false, group: "" }));
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
  render();
  enqueue({ k: "check", item: id, checked: i.checked });
}
function renameItem(id, text) {
  const [, i] = findItem(id); if (!i) return;
  text = text.replace(/\s+/g, " ").trim();
  S.edit = "";
  if (!text || text === i.text) { render(); return; }
  i.text = text; render();
  enqueue({ k: "text", item: id, text });
}
function removeItem(id) {
  const [t] = findItem(id); if (!t) return;
  t.items = t.items.filter((i) => i.id !== id);
  S.edit = ""; render();
  enqueue({ k: "del", item: id });
}
function clearBasket(t) {
  const done = (t.items || []).filter((i) => i.checked);
  if (!done.length) return;
  t.items = t.items.filter((i) => !i.checked);
  render();
  for (const i of done) enqueue({ k: "del", item: i.id });
  toast(`かごの ${done.length}品 をリストから消しました`);
}
async function finishList(t, label = "買い物おわり") {
  if (Q.length) { toast("保存が終わってからもう一度押してください"); flush(); return; }
  try {
    setSync("busy");
    await api("POST", `/api/lists/${t.id}/done`);
    S.lists = S.lists.filter((x) => x.id !== t.id);
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
    S.cur = res.list.id; store.set("cur", S.cur); S.newList = false;
    saveSnap(); setSync("ok"); render();
    $("#addin")?.focus();
  } catch (err) { setSync("err"); toast(`作れませんでした：${err.message}`); }
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
async function restock(id, btn) {
  const x = S.stock.find((s) => s.id === id); if (!x) return;
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
async function addStock(form) {
  const f = new FormData(form);
  const body = Object.fromEntries(f.entries());
  try {
    setSync("busy");
    const res = await api("POST", "/api/stock", body);
    S.stock.push(res.stock); S.stockForm = false;
    saveSnap(); setSync("ok"); render();
    toast(`「${res.stock.name}」を在庫に登録しました`);
  } catch (err) { setSync("err"); toast(`登録できませんでした：${err.message}`); }
}

// ---------- 描く ----------
function render() {
  if (!memoryKey) return;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === S.tab)));
  const left = shopLists().reduce((n, t) => n + leftOf(t), 0) + refillTasks().length;
  const soon = soonStock().length;
  badge("#b-list", left); badge("#b-stock", soon);
  appBadge(soon);
  const v = $("#view");
  const keep = document.activeElement?.id === "addin" ? { v: $("#addin").value, s: $("#addin").selectionStart } : null;
  if (S.tab === "list") v.innerHTML = renderList();
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
  const lists = shopLists(); const refills = refillTasks();
  if (S.cur !== "refill" && !listOf(S.cur)) S.cur = lists[0]?.id || (refills.length ? "refill" : "");
  const soon = soonStock();
  const banner = soon.length ? `<button type="button" class="banner" data-go="stock"><span class="bi">⚠️</span><span><b>切れそうな在庫が${soon.length}品</b><small>${esc(soon.slice(0, 3).map((x) => `${x.name}（${leftTx(x.left)}）`).join("・"))}</small></span><span class="go">補充へ ›</span></button>` : "";
  const chips = lists.map((t) => `<button type="button" class="lchip" data-cur="${t.id}" aria-pressed="${S.cur === t.id}">${esc(t.name)}<span class="n">${leftOf(t)}</span></button>`).join("")
    + (refills.length ? `<button type="button" class="lchip refill" data-cur="refill" aria-pressed="${S.cur === "refill"}">📦 補充<span class="n">${refills.length}</span></button>` : "")
    + `<button type="button" class="lchip add" data-newlist="1" aria-label="新しいリスト">＋</button>`;
  const newList = S.newList ? `<form class="card newlist" id="newlist"><input id="newname" maxlength="100" placeholder="リストの名前（例：スーパー）" aria-label="リストの名前" autocomplete="off" enterkeyhint="done">
    <div class="presets">${PRESETS.map((p) => `<button type="button" class="chip" data-preset="${esc(p)}">${esc(p)}</button>`).join("")}</div>
    <div class="row-end"><button type="button" class="btn ghost" data-newlist="0">やめる</button><button type="submit" class="btn pri">作る</button></div></form>` : "";
  const head = `${banner}<div class="lchips" role="tablist" aria-label="リスト">${chips}</div>${newList}`;
  if (S.cur === "refill") return head + renderRefills(refills);
  const t = listOf(S.cur);
  const add = `<form class="addbox" id="addform"><input id="addin" type="text" maxlength="400" autocomplete="off" enterkeyhint="done" placeholder="${t ? `「${esc(t.name)}」に入れる` : "買うものを入れる"}（牛乳、卵、パン）" aria-label="買うもの"><button type="submit" class="btn pri">入れる</button></form><div class="suggest" id="suggest"></div>`;
  if (!t) return head + add + `<div class="empty">まだリストがありません。<br>上の欄に入れると「買い物リスト」を作ります。</div>`;
  const items = t.items || [];
  const todo = items.filter((i) => !i.checked); const basket = items.filter((i) => i.checked);
  const tools = `<div class="ltools"><div class="seg"><button type="button" data-sort="aisle" aria-pressed="${S.sort === "aisle"}">売り場順</button><button type="button" data-sort="added" aria-pressed="${S.sort === "added"}">入れた順</button></div>
    <span class="mute">${todo.length ? `あと${todo.length}品` : items.length ? "ぜんぶかごに入りました" : ""}</span>${t.link ? `<a class="btn ghost sm" href="${esc(t.link)}" target="_blank" rel="noopener">🛒 開く</a>` : ""}<a class="btn ghost sm" href="${esc(t.url)}" target="_blank" rel="noopener" aria-label="Notion で開く">↗</a></div>`;
  const prog = items.length ? `<div class="prog"><i style="width:${Math.round((basket.length / items.length) * 100)}%"></i></div>` : "";
  const body = todo.length ? groups(todo) : `<div class="empty small">${items.length ? "🎉 ぜんぶかごに入りました" : "上の欄から入れてください。<br>「、」で区切ると一度にたくさん入れられます"}</div>`;
  const bk = basket.length ? `<div class="basket"><button type="button" class="bhead" data-basket="1" aria-expanded="${S.showBasket}">🧺 かごの中 ${basket.length}品 <span>${S.showBasket ? "▲" : "▼"}</span></button>${S.showBasket ? basket.map(itemRow).join("") : ""}</div>` : "";
  const foot = `<div class="lfoot">${basket.length ? `<button type="button" class="btn" data-clear="${t.id}">かごの${basket.length}品をリストから消す</button>` : ""}${items.length && !todo.length ? `<button type="button" class="btn ok" data-finish="${t.id}">買い物おわり（済みにする）</button>` : ""}${t.more ? `<p class="note">本文の ToDo が100個を超えています。続きは Notion で見てください</p>` : ""}</div>`;
  return head + add + `<div class="card list">${tools}${prog}${body}${bk}</div>` + foot;
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
  if (S.edit === i.id) {
    return `<form class="item editing" data-editform="${i.id}"><input id="editin" value="${esc(i.text)}" maxlength="200" aria-label="品目の名前" enterkeyhint="done"><button type="submit" class="btn pri sm">直す</button><button type="button" class="btn danger sm" data-del="${i.id}">消す</button></form>`;
  }
  const q = A.splitQty(i.text);
  return `<div class="item${i.checked ? " on" : ""}${i.id.startsWith("tmp") ? " pending" : ""}"><button type="button" class="tick" data-toggle="${i.id}" aria-pressed="${i.checked}"><span class="box" aria-hidden="true"></span><span class="tx">${esc(q.name)}</span>${q.qty ? `<span class="qty">${esc(q.qty)}</span>` : ""}</button><button type="button" class="more" data-edit="${i.id}" aria-label="「${esc(q.name)}」を直す">⋯</button></div>`;
}
function renderRefills(ts) {
  if (!ts.length) return `<div class="empty">補充のタスクはありません</div>`;
  return `<p class="note pad">在庫（DB_Daily）から作った補充タスク。買えたら ✓ で済みにすると、最終補充日が今日になります。</p><div class="card list">${ts.map((t) => {
    const x = S.stock.find((s) => t.refill.includes(s.id));
    return `<div class="item"><button type="button" class="tick" data-finish="${t.id}" aria-label="「${esc(t.name)}」を買えた"><span class="box" aria-hidden="true"></span><span class="tx">${esc(t.name.replace(/^補充:/, ""))}</span>${x ? `<span class="qty" style="color:${leftColor(x)}">${esc(leftTx(x.left))}</span>` : ""}</button>${t.link ? `<a class="more" href="${esc(t.link)}" target="_blank" rel="noopener" aria-label="注文ページを開く">🛒</a>` : ""}</div>`;
  }).join("")}</div>`;
}

// 入力中の候補：入れたことのある品目・在庫の名前・定番から
function renderSuggest() {
  const box = $("#suggest"); if (!box) return;
  const raw = $("#addin").value; const parts = A.splitInput(raw); const q = /[、,，;\n]\s*$/.test(raw) ? "" : parts.at(-1) || "";
  const t = listOf(S.cur);
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
  const soon = soonStock(SOON_DAYS).filter((x) => !onList.has(x.name)).slice(0, 4);
  for (const x of soon) names.delete(x.name);
  out = [...names].filter(([n]) => hist[n]?.n >= 1).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (out.length < 6) out = out.concat([...names].filter(([n]) => !hist[n]?.n && !out.some(([m]) => m === n)).sort((a, b) => b[1] - a[1]).slice(0, 8 - out.length));
  box.innerHTML = (soon.length ? `<div class="sgl">📦 切れそう</div>${soon.map((x) => `<button type="button" class="chip warn" data-sug="${esc(x.name)}">＋ ${esc(x.name)}<small>${esc(leftTx(x.left))}</small></button>`).join("")}` : "")
    + (out.length ? `<div class="sgl">${Object.keys(hist).length ? "よく買う" : "定番"}</div>${out.map(([n]) => `<button type="button" class="chip" data-sug="${esc(n)}">＋ ${esc(n)}</button>`).join("")}` : "");
}

function renderStock() {
  const all = S.stock;
  const out = all.filter((x) => x.left != null && x.left <= 0).length;
  const week = all.filter((x) => x.left != null && x.left > 0 && x.left <= SOON_DAYS).length;
  const listed = all.filter((x) => x.open?.length).length;
  const soon = soonStock(SOON_DAYS).length;
  const cats = [...new Set(all.map((x) => x.cat).filter(Boolean))];
  const items = all.filter((x) => !S.stockCat || x.cat === S.stockCat).sort((a, b) => (a.left ?? 1e9) - (b.left ?? 1e9) || a.name.localeCompare(b.name, "ja"));
  const form = S.stockForm ? `<form class="card form" id="stockform"><h2>在庫を登録</h2>
    <label>名前<input name="name" required maxlength="100" autocomplete="off" placeholder="例：洗濯洗剤"></label>
    <div class="row2"><label>カテゴリ<select name="cat"><option value="">—</option>${CATS.map((c) => `<option>${c}</option>`).join("")}</select></label><label>買った日<input name="bought" type="date" value="${esc(S.today)}"></label></div>
    <div class="row3"><label>使う数<input name="use" type="number" inputmode="decimal" min="0" step="any" placeholder="1"></label><label>あたり<select name="freq">${FREQS.map((f) => `<option>${f}</option>`).join("")}</select></label><label>1個の量<input name="size" type="number" inputmode="decimal" min="0" step="any" placeholder="30"></label></div>
    <p class="note">例：1日1粒で30粒入り → 使う数 1・毎日・1個の量 30（同じ単位で）。切れる日を出すのに使います</p>
    <label>注文ページ（あれば）<input name="link" type="url" inputmode="url" placeholder="https://"></label>
    <div class="row-end"><button type="button" class="btn ghost" data-stockform="0">やめる</button><button type="submit" class="btn pri">登録する</button></div></form>` : "";
  const rows = items.map((x) => {
    const pct = x.left != null && x.days ? Math.max(0, Math.min(100, Math.round((x.left / x.days) * 100))) : null;
    const sub = [x.cat, x.end ? `${md(x.end)}まで` : x.use ? "買った日が未入力" : "使う数が未入力", x.days ? `1個で${x.days}日` : ""].filter(Boolean).join("・");
    const act = x.open?.length ? `<span class="tag">リスト済み</span><button type="button" class="btn ok sm" data-restock="${x.id}">補充した</button>`
      : `<button type="button" class="btn sm" data-tolist="${x.id}">🛒 リストへ</button><button type="button" class="btn ghost sm" data-restock="${x.id}" aria-label="「${esc(x.name)}」を補充した">✓</button>`;
    return `<div class="srow" style="--c:${leftColor(x)}"><div class="sm-main"><a class="nm" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a><span class="sub">${esc(sub)}</span>${pct != null ? `<span class="gauge"><i style="width:${pct}%"></i></span>` : ""}</div><span class="left">${esc(leftTx(x.left))}</span><div class="acts">${act}</div></div>`;
  }).join("");
  return `<div class="stats"><div class="card"><b style="color:var(--bad)">${out}</b><span>切れている</span></div><div class="card"><b style="color:var(--warn)">${week}</b><span>${SOON_DAYS}日以内</span></div><div class="card"><b>${listed}</b><span>リスト済み</span></div></div>
    <div class="row-end">${soon ? `<button type="button" class="btn pri" data-alltolist="1">切れそうな${soon}品をまとめてリストへ</button>` : ""}<button type="button" class="btn ghost" data-stockform="1">＋ 在庫を登録</button></div>
    ${form}
    ${cats.length ? `<div class="chips"><button type="button" class="chip" data-cat="" aria-pressed="${!S.stockCat}">すべて ${all.length}</button>${cats.map((c) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${S.stockCat === c}">${esc(c)} ${all.filter((x) => x.cat === c).length}</button>`).join("")}</div>` : ""}
    <div class="card list">${rows || `<div class="empty small">${S.loading ? "読みこみ中…" : "在庫の登録がありません"}</div>`}</div>
    <p class="note pad">「🛒 リストへ」は DB_Daily の補充ボタンと同じ補充タスクを作ります。「✓／補充した」で済みにすると最終補充日が今日になり、切れる予定日が延びます。</p>`;
}

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
    <label class="check"><input type="checkbox" name="list" ${p.list ? "checked" : ""}> 買い物リストに残っている品目も知らせる</label>`;
}
function renderAlert() {
  const p = S.push;
  let body;
  if (!p) body = `<p class="note">確かめています…</p>`;
  else if (p.unsupported) body = `<p class="note">${/iphone|ipad/i.test(navigator.userAgent) && !standalone() ? "iPhone は Safari の共有ボタン →「ホーム画面に追加」で入れたアプリから開くと通知を使えます（iOS 16.4 以上）。" : "このブラウザは通知に対応していません。"}</p>`;
  else if (Notification.permission === "denied") body = `<p class="note">通知が拒否されています。設定アプリ →「通知」→「かいもの」で許可してから開き直してください。</p>`;
  else if (p.subscribed) body = `<p class="ok-line">✅ この端末に毎日 ${p.hour}:00 に知らせます</p><form id="pushform" class="form">${pushForm()}<div class="row-end"><button type="button" class="btn ghost" data-push="off">オフにする</button><button type="button" class="btn" data-push="test">いま試す</button><button type="submit" class="btn pri">保存</button></div></form>`;
  else body = `<form id="pushform" class="form">${pushForm()}<div class="row-end"><button type="submit" class="btn pri">通知をオンにする</button></div></form>${p.err ? `<p class="note err">${esc(p.err)}</p>` : ""}`;
  const soon = soonStock();
  return `<div class="card form"><h2>🔔 在庫アラート</h2><p class="note">DB_Daily の切れる予定日が近づいた品（まだ補充タスクがないもの）を、決めた時刻に通知します。アイコンのバッジにも件数が出ます。</p>${body}</div>
    <div class="card"><h2>いま知らせる内容</h2>${soon.length ? `<ul class="plain">${soon.map((x) => `<li><span style="color:${leftColor(x)}">●</span> ${esc(x.name)}<small>${esc(leftTx(x.left))}</small></li>`).join("")}</ul>` : `<p class="note">切れそうな在庫はありません（${S.alertDays}日前まで）</p>`}</div>
    <div class="card"><h2>この端末</h2><p class="note">合言葉はこの端末にだけ保存しています。</p><div class="row-end"><button type="button" class="btn ghost" data-logout="1">合言葉を消す</button></div></div>`;
}
function urlB64(s) { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
async function pushSave(form) {
  const f = new FormData(form);
  const opts = { hour: +f.get("hour"), days: +f.get("days"), list: f.get("list") === "on" };
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
    toast(`毎日 ${S.push.hour}:00 に知らせます`); render();
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
  const el = e.target.closest("button,[data-go]"); if (!el) return;
  const d = el.dataset;
  if (d.tab) { S.tab = d.tab; S.edit = ""; render(); if (d.tab === "alert") loadPush(); window.scrollTo(0, 0); return; }
  if (d.go) { S.tab = d.go; render(); window.scrollTo(0, 0); return; }
  if (d.cur) { S.cur = d.cur; store.set("cur", d.cur); S.edit = ""; S.newList = false; render(); return; }
  if (d.newlist) { S.newList = d.newlist === "1"; render(); if (S.newList) $("#newname")?.focus(); return; }
  if (d.preset) { createList(d.preset); return; }
  if (d.sort) { S.sort = d.sort; store.set("sort", d.sort); render(); return; }
  if (d.toggle) { toggle(d.toggle); return; }
  if (d.edit) { S.edit = d.edit; render(); return; }
  if (d.del) { removeItem(d.del); return; }
  if (d.basket) { S.showBasket = !S.showBasket; render(); return; }
  if (d.clear) { const t = listOf(d.clear); if (t) clearBasket(t); return; }
  if (d.finish) { const t = listOf(d.finish); if (t) finishList(t, t.refill.length ? "補充した" : "買い物おわり"); return; }
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
  if (d.stockform) { S.stockForm = d.stockform === "1"; render(); return; }
  if (d.cat !== undefined && el.classList.contains("chip")) { S.stockCat = d.cat; render(); return; }
  if (d.push) { pushAction(d.push); return; }
  if (d.logout) { memoryKey = ""; store.set(KEY_STORAGE, ""); showLogin(); return; }
});
document.addEventListener("submit", (e) => {
  const f = e.target; e.preventDefault();
  if (f.id === "addform") { const i = $("#addin"); const texts = A.splitInput(i.value); i.value = ""; addTexts(texts); i.focus(); return; }
  if (f.id === "newlist") { createList($("#newname").value); return; }
  if (f.dataset.editform) { renameItem(f.dataset.editform, $("#editin").value); return; }
  if (f.id === "stockform") { addStock(f); return; }
  if (f.id === "pushform") { pushSave(f); return; }
  if (f.id === "login-form") {
    const k = $("#key").value.trim(); if (k.length < 16) return;
    memoryKey = k; store.set(KEY_STORAGE, k);
    $("#login").hidden = true; $("#view").hidden = false; document.body.classList.remove("locked");
    load();
  }
});
document.addEventListener("input", (e) => { if (e.target.id === "addin") renderSuggest(); });
document.addEventListener("keydown", (e) => { if (e.target.id === "editin" && e.key === "Escape") { S.edit = ""; render(); } });
$("#reload").addEventListener("click", () => load());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && memoryKey && Date.now() - Date.parse(S.loadedAt || 0) > 60e3) load({ quiet: true }); });

function showLogin() {
  $("#login").hidden = false; $("#view").hidden = true; document.body.classList.add("locked");
  setStatus("");
  $("#key")?.focus();
}

// ---------- はじまり ----------
(function boot() {
  const qs = new URLSearchParams(location.search);
  if (["list", "stock", "alert"].includes(qs.get("tab"))) S.tab = qs.get("tab");
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!memoryKey) { showLogin(); return; }
  const snap = store.json("snap", null);
  if (snap) Object.assign(S, snap);
  render();
  if (Q.length) flush();
  load();
  if (pushOk()) loadPush();
})();
