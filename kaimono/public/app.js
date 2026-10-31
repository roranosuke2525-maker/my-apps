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
  showBasket: false, edit: "", sheet: null, lpick: null, // lpick：リストで選んで消す品の id pick: null, // pick：補充でまとめて操作するときに選んだ品の id stockCat: "", alertDays: 3, push: null, loading: false,
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

const saveSnap = () => store.set("snap", JSON.stringify({ lists: S.lists, stock: S.stock, today: S.today, loadedAt: S.loadedAt, templates: S.templates, templateErr: S.templateErr }));
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
    Object.assign(S, { lists: st.lists, stock: st.stock, today: st.today, loadedAt: st.loadedAt, templates: st.templates || [], templateErr: st.templateErr || "", reminders: st.reminders || {} });
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
  let t = S.seg === "quick" ? quickList() : listOf(S.cur);
  if (t && kindOf(t) !== S.seg) t = null;
  if (!t) {
    // リストがまだなければ、入れた品目ごと新しく作る（ちょい買いは1枚だけ）
    const name = S.seg === "quick" ? QUICK : `🛒 買い物 ${md(jstDay())}`;
    try {
      setSync("busy");
      const res = await api("POST", "/api/lists", { name, items: texts });
      S.lists.unshift(res.list);
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
// 選んだ品をまとめてリストから消す（チェックの有無は問わない。圏外でも順番待ちで消す）
function deletePicked(t) {
  const ids = [...(S.lpick || [])].filter((id) => (t.items || []).some((i) => i.id === id));
  if (!ids.length) return;
  t.items = t.items.filter((i) => !ids.includes(i.id));
  S.lpick = null; render();
  for (const id of ids) enqueue({ k: "del", item: id });
  toast(`${ids.length}品をリストから消しました`);
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
    S.cur = res.list.id; store.set("cur", S.cur); S.planning = false;
    saveSnap(); setSync("ok"); render();
    $("#addin")?.focus();
  } catch (err) { setSync("err"); toast(`作れませんでした：${err.message}`); }
}

// ---------- 買い物の時刻 ----------
// ボタン1つで決める候補（過ぎた時刻は出さない）
function whenOptions() {
  const today = jstDay(); const tmr = addDays(today, 1);
  let sat = addDays(today, (6 - dow(today) + 7) % 7 || 7);
  const opts = [["今日 17時", today, 17], ["今日 19時", today, 19], ["明日 10時", tmr, 10], ["明日 17時", tmr, 17], [`土曜 10時（${md(sat)}）`, sat, 10]];
  return opts.map(([label, d, h]) => [label, `${d}T${String(h).padStart(2, "0")}:00:00+09:00`]).filter(([, at]) => Date.parse(at) > Date.now() + 5 * 60e3)
    .filter(([, at], k, a) => a.findIndex(([, b]) => b === at) === k);
}
const remindsOf = (target) => (target === "plan" ? S.plan.before : S.reminders[target]) ?? REMIND_DEFAULT;
const remindText = (b) => (b.length ? REMIND_CHOICES.filter(([m]) => b.includes(m)).map(([, n]) => n).join("・") : "知らせない");
// タスクごとの「いつ買う・何分前に知らせる」の行と、開いたときの選択肢
function whenBar(target, at, { open = S.whenFor === target, label = "" } = {}) {
  const b = remindsOf(target);
  const head = `<div class="when"><span>⏰ ${label}${at ? `<b>${esc(fmtAt(at))}</b>${`<small class="rem">🔔 ${esc(remindText(b))}</small>`}` : `<span class="mute">時刻なし</span>`}</span>${target === "plan" ? "" : `<button type="button" class="btn ghost sm" data-whenopen="${target}">${at ? "変える" : "時刻を決める"}</button>`}</div>`;
  if (!open) return head;
  const noPush = S.push && !S.push.subscribed && !S.push.unsupported;
  return `${head}<div class="whenpanel">${whenChips(target, at)}
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
function whenChips(target, cur) {
  return `<div class="whens">${whenOptions().map(([label, at]) => `<button type="button" class="chip${cur === at ? " on" : ""}" data-when="${target}|${at}">${esc(label)}</button>`).join("")}
    <label class="chip pick">日時を選ぶ<input type="datetime-local" step="900" data-whenpick="${target}" value="${cur ? cur.slice(0, 16) : ""}"></label>
    ${cur ? `<button type="button" class="chip" data-when="${target}|">時刻なし</button>` : ""}</div>`;
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
  if (texts.length > 50) { toast("一度に作れるのは50品までです"); return; }
  const day = S.plan.at ? S.plan.at.slice(0, 10) : jstDay();
  const name = `🛒 ${S.plan.store || "買い物"} ${md(day)}`;
  btn.disabled = true;
  try {
    setSync("busy");
    const res = await api("POST", "/api/lists", { name, items: texts, at: S.plan.at || null });
    S.lists.unshift(res.list);
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
// ---------- 補充：選んでまとめて操作 ----------
async function bulk(kind, btn) {
  const ids = [...(S.pick || [])]; const xs = S.stock.filter((x) => ids.includes(x.id));
  if (!xs.length) { toast("品を選んでください"); return; }
  if (kind === "trash" && !confirm(`${xs.length}品を在庫から消しますか？\n（Notion のゴミ箱に入り、30日はそこから戻せます）`)) return;
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

// ---------- 在庫を直す・登録する（下から出るシート） ----------
const CAT_ICON = { 日用品: "🧻", 消耗品: "🧽", 食品: "🍚", 育児: "👶", サプリ: "💊", 美容: "🧴" };
const thumb = (x, cls = "thumb") => (x.image ? `<img class="${cls}" src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'${cls} ph',textContent:'${CAT_ICON[x.cat] || "📦"}'}))">` : `<span class="${cls} ph">${CAT_ICON[x.cat] || "📦"}</span>`);
// draft: { id（"new" なら新規）, name, cat, use, freq, size, link, memo, jan, image, bought, toList }
function openSheet(id, preset = {}) {
  const x = id === "new" ? {} : S.stock.find((s) => s.id === id);
  if (!x) return;
  S.sheet = { id, name: x.name || "", cat: x.cat || "", use: x.use || "", freq: x.freq || "毎日", size: x.size || "", link: x.link || "", memo: x.memo || "", jan: x.jan || "", image: x.image || "", changed: false, toList: id === "new", ...preset };
  renderSheet();
}
function closeSheet() { S.sheet = null; $("#sheet").hidden = true; $("#sheet").innerHTML = ""; document.body.classList.remove("modal"); }
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
    <div class="row2"><label>カテゴリ<select name="cat"><option value="">—</option>${CATS.map((c) => `<option ${c === d.cat ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <label>バーコード（JAN）<span class="inrow"><input name="jan" inputmode="numeric" maxlength="13" value="${esc(d.jan)}" placeholder="13桁"><button type="button" class="btn sm" data-scanjan="1" aria-label="バーコードを読む">📷</button></span></label></div>
    <div class="row3"><label>使う数<input name="use" type="number" inputmode="decimal" min="0" step="any" value="${esc(d.use)}" placeholder="1"></label>
      <label>あたり<select name="freq">${FREQS.map((f) => `<option ${f === d.freq ? "selected" : ""}>${f}</option>`).join("")}</select></label>
      <label>1個の量<input name="size" type="number" inputmode="decimal" min="0" step="any" value="${esc(d.size)}" placeholder="30"></label></div>
    <p class="note" id="shper">${perText(d, x)}</p>
    <label>注文ページ<input name="link" type="url" inputmode="url" value="${esc(d.link)}" placeholder="https://"></label>
    <label>メモ<input name="memo" maxlength="300" value="${esc(d.memo)}" autocomplete="off"></label>
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
  const body = { name: d.name, cat: d.cat, use: d.use, freq: d.freq, size: d.size, link: d.link, memo: d.memo, jan: d.jan, image: d.image };
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
  const soon = soonStock();
  const banner = soon.length ? `<button type="button" class="banner" data-go="stock"><span class="bi">⚠️</span><span><b>切れそうな在庫が${soon.length}品</b><small>${esc(soon.slice(0, 3).map((x) => `${x.name}（${leftTx(x.left)}）`).join("・"))}</small></span><span class="go">補充へ ›</span></button>` : "";
  const q = quickList();
  const segs = [["usual", "🛒 いつもの", usualLists().reduce((n, t) => n + leftOf(t), 0)], ["quick", "⚡ ちょい買い", q ? leftOf(q) : 0], ["other", "📦 そのほか", otherTasks().length]];
  const head = `${banner}<div class="kinds" role="tablist">${segs.map(([k, n, c]) => `<button type="button" data-seg="${k}" aria-pressed="${S.seg === k}">${n}${c ? `<span class="n">${c}</span>` : ""}</button>`).join("")}</div>`;
  if (S.seg === "quick") return head + renderQuick();
  if (S.seg === "other") return head + renderOther();
  return head + renderUsual();
}
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
  const body = todo.length ? groups(todo) : `<div class="empty small">${items.length ? "🎉 ぜんぶかごに入りました" : "上の欄から入れてください。「、」で区切るとまとめて入ります"}</div>`;
  const bk = basket.length ? `<div class="basket"><button type="button" class="bhead" data-basket="1" aria-expanded="${S.showBasket}">🧺 かごの中 ${basket.length}品 <span>${S.showBasket ? "▲" : "▼"}</span></button>${S.showBasket ? basket.map(itemRow).join("") : ""}</div>` : "";
  const foot = `<div class="lfoot">${basket.length ? `<button type="button" class="btn" data-clear="${t.id}">かごの${basket.length}品をリストから消す</button>` : ""}${items.length && !todo.length ? `<button type="button" class="btn ok" data-finish="${t.id}">買い物おわり（済みにする）</button>` : ""}${t.more ? `<p class="note">本文の ToDo が100個を超えています。続きは Notion で見てください</p>` : ""}</div>`;
  return `${when}${addBox(ph)}<div class="card list">${tools}${prog}${body}${bk}</div>${foot}`;
}

function renderPlan(canBack) {
  if (!S.templates.length) {
    return `<div class="card"><h2>🛒 いつもの買い物</h2><p class="note">${S.templateErr ? `テンプレートを読めませんでした（${esc(S.templateErr)}）。Notion の DB_買い物テンプレート を開き、「•••」→「接続」→「かいもの」を追加してください。` : "DB_買い物テンプレート に品がありません。Notion で足してください。"}</p></div>
      <div class="row-end"><button type="button" class="btn" data-plannew="1">テンプレートなしで空のリストを作る</button></div>`;
  }
  const stores = [...new Set(S.templates.map((x) => x.store))];
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
    ${stores.length > 1 ? `<div class="chips">${stores.map((n) => `<button type="button" class="chip" data-pstore="${esc(n)}" aria-pressed="${n === S.plan.store}">${esc(n)}</button>`).join("")}</div>` : ""}
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
  return `<p class="note pad">買えたら ✓ で済みにすると、DB_Daily の最終補充日が今日になります。</p><div class="card list">${ts.map((t) => {
    const x = S.stock.find((s) => t.refill.includes(s.id));
    return `<div class="item"><button type="button" class="tick" data-finish="${t.id}" aria-label="「${esc(t.name)}」を買えた"><span class="box" aria-hidden="true"></span><span class="tx">${esc(t.name.replace(/^補充:/, ""))}</span>${x ? `<span class="qty" style="color:${leftColor(x)}">${esc(leftTx(x.left))}</span>` : ""}</button><button type="button" class="more${t.at ? " on" : ""}" data-whenopen="${t.id}" aria-label="「${esc(t.name)}」の時刻と通知">⏰</button>${t.link ? `<a class="more" href="${esc(t.link)}" target="_blank" rel="noopener" aria-label="注文ページを開く">🛒</a>` : ""}</div>${t.at || S.whenFor === t.id ? `<div class="rwhen">${whenBar(t.id, t.at)}</div>` : ""}`;
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

function renderStock() {
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
    return `<div class="srow${on ? " picked" : ""}" style="--c:${leftColor(x)}"><button type="button" class="sm-main" ${S.pick ? `data-pick="${x.id}" aria-pressed="${!!on}"` : `data-sheet="${x.id}"`}>${thumb(x)}<span class="sm-tx"><span class="nm">${esc(x.name)}</span><span class="sub"><b>${esc(leftTx(x.left) || "—")}</b>${x.open?.length ? `<i class="tag">リスト済</i>` : ""} ${esc(sub)}</span>${pct != null ? `<span class="gauge"><i style="width:${pct}%"></i></span>` : ""}</span></button>${act}</div>`;
  }).join("");
  return `<div class="stats1"><span><b style="color:var(--bad)">${out}</b>切れ</span><span><b style="color:var(--warn)">${week}</b>${SOON_DAYS}日内</span><span><b>${listed}</b>リスト済</span><span><b>${all.length}</b>全部</span></div>
    <div class="stock-acts"><button type="button" class="btn pri" data-scan="add">📷 スキャンして追加</button><button type="button" class="btn" data-sheet="new">＋ 登録</button></div>
    ${soon || noImg ? `<div class="row-end">${soon ? `<button type="button" class="btn sm" data-alltolist="1">切れそうな${soon}品をまとめてリストへ</button>` : ""}${noImg ? `<button type="button" class="btn ghost sm" data-fillimg="1">🖼 画像をまとめて取る（${noImg}品）</button>` : ""}</div>` : ""}
    ${cats.length ? `<div class="chips"><button type="button" class="chip" data-cat="" aria-pressed="${!S.stockCat}">すべて</button>${cats.map((c) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${S.stockCat === c}">${CAT_ICON[c] || ""}${esc(c)}</button>`).join("")}${unset ? `<button type="button" class="chip" data-cat="未設定" aria-pressed="${S.stockCat === "未設定"}">⚙️ 未設定 ${unset}</button>` : ""}</div>` : ""}
    <div class="ltools pickbar"><span class="mute">${items.length}品</span>${S.pick ? `<button type="button" class="btn ghost sm" data-pickall="1">${items.every((x) => S.pick.has(x.id)) ? "全部外す" : "全部選ぶ"}</button>` : ""}<button type="button" class="btn ${S.pick ? "pri" : "ghost"} sm" data-pickmode="1">${S.pick ? "選ぶのをやめる" : "☑ 選んでまとめて"}</button></div>
    <div class="card list">${rows || `<div class="empty small">${S.loading ? "読みこみ中…" : "在庫の登録がありません"}</div>`}</div>
    ${S.pick ? `<div class="card bulkbar"><b>${S.pick.size}品を選択中</b><div class="row-end"><button type="button" class="btn sm" data-bulk="list" ${S.pick.size ? "" : "disabled"}>🛒 補充リストへ</button><button type="button" class="btn ok sm" data-bulk="restock" ${S.pick.size ? "" : "disabled"}>✓ 補充した</button><button type="button" class="btn danger sm" data-bulk="trash" ${S.pick.size ? "" : "disabled"}>🗑 消す</button></div></div>` : ""}
    <p class="note pad">行をタップで直す（使う頻度・商品の変更・画像・バーコード）。🛒 は補充タスクを作り、✓ で済みにすると最終補充日が今日になります。</p>`;
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
  const el = e.target.closest("button,[data-go],[data-sheetclose]"); if (!el) return;
  const d = el.dataset;
  if (d.tab) { S.tab = d.tab; S.edit = ""; S.pick = null; S.lpick = null; render(); if (d.tab === "alert") loadPush(); window.scrollTo(0, 0); return; }
  if (d.go) { S.tab = d.go; render(); window.scrollTo(0, 0); return; }
  if (d.cur) { S.cur = d.cur; store.set("cur", d.cur); S.edit = ""; S.whenFor = ""; S.lpick = null; render(); return; }
  if (d.seg) { S.seg = d.seg; store.set("seg", d.seg); S.edit = ""; S.whenFor = ""; S.lpick = null; render(); return; }
  if (d.plan) { S.planning = d.plan === "1"; render(); window.scrollTo(0, 0); return; }
  if (d.plannew) { createList(`🛒 買い物 ${md(jstDay())}`); return; }
  if (d.pstore) { S.plan.store = d.pstore; savePlan(); render(); return; }
  if (d.ptoggle) { planToggle(d.ptoggle); return; }
  if (d.pstep) { const [id, n] = d.pstep.split("|"); planStep(id, +n); return; }
  if (d.pextradel) { S.plan.extra.splice(+d.pextradel, 1); savePlan(); render(); return; }
  if (d.tpladd) { addToTemplate(+d.tpladd, el); return; }
  if (d.planclear) { S.plan.counts = {}; S.plan.extra = []; savePlan(); render(); return; }
  if (d.plancreate) { createPlan(el); return; }
  if (d.remind) { const [target, m] = d.remind.split("|"); toggleRemind(target, +m); return; }
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
  if (d.sheet) { openSheet(d.sheet); return; }
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
  const t = e.target.dataset?.whenpick; if (t === undefined || !e.target.value) return;
  setWhen(t, `${e.target.value.slice(0, 16)}:00+09:00`);
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
  if (["list", "stock", "alert"].includes(qs.get("tab"))) S.tab = qs.get("tab");
  if (/^[0-9a-f]{32}$/.test(qs.get("list") || "")) S.wantList = qs.get("list");
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!memoryKey) { showLogin(); return; }
  const snap = store.json("snap", null);
  if (snap) Object.assign(S, snap);
  render();
  if (Q.length) flush();
  load();
  if (pushOk()) loadPush();
})();
