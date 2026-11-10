// 旅のしおり：画面。Notion のしおりページを読み、チェック・追加を書き戻す。
// 圏外でも開けるよう、最後に読んだしおりと未送信の変更を端末に置いておく。
"use strict";

const KEY_STORAGE = "trip-shiori-key";
const CACHE_STORAGE = "trip-shiori-cache";
const OUTBOX_STORAGE = "trip-shiori-outbox";
const TAB_STORAGE = "trip-shiori-tab";
const WEEK = "日月火水木金土";

const $ = (id) => document.getElementById(id);
const state = {
  trip: load(CACHE_STORAGE, null),
  outbox: load(OUTBOX_STORAGE, []),
  tab: load(TAB_STORAGE, ""),
  syncing: false,
  error: "",
  open: new Set(), // 足す欄を開いているまとまり
};
let memoryKey = loadRaw(KEY_STORAGE);

// ---------- 端末への保存（保存できない端末でも動く） ----------
function loadRaw(k) {
  try { return localStorage.getItem(k) || ""; } catch { return ""; }
}
function load(k, fallback) {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(k, v) {
  try {
    if (v === null || v === "") localStorage.removeItem(k);
    else localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  } catch { /* 保存できなくても画面は動かす */ }
}

// ---------- 通信 ----------
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${memoryKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    memoryKey = "";
    save(KEY_STORAGE, "");
    render();
    throw Object.assign(new Error(data.error || "合言葉が違います"), { fatal: true });
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `通信エラー（${res.status}）`), { fatal: res.status >= 400 && res.status < 500 && res.status !== 429 });
  return data;
}

async function refresh() {
  if (!memoryKey) return;
  await flush();
  if (state.outbox.length) return render(); // 送れていない変更があるうちは読み直さない（上書きしない）
  state.syncing = true;
  renderSync();
  try {
    const trip = await api("GET", "/api/trip");
    state.trip = trip;
    state.error = "";
    save(CACHE_STORAGE, trip);
  } catch (err) {
    state.error = navigator.onLine === false ? "" : err.message;
  } finally {
    state.syncing = false;
  }
  render();
}

// 変更は先に画面へ反映し、順番に Notion へ送る。圏外なら端末に残して後で送る
function queue(op) {
  state.outbox.push(op);
  save(OUTBOX_STORAGE, state.outbox);
  save(CACHE_STORAGE, state.trip);
  render();
  flush();
}

let flushing = null;
function flush() {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; renderSync(); });
  return flushing;
}

async function doFlush() {
  while (state.outbox.length && memoryKey) {
    const op = state.outbox[0];
    if (isTemp(op.id) || isTemp(op.parent)) {
      // 足したばかりで、まだ Notion の番号が無いもの（前の送信が失敗して残った）
      dropOp("足した項目が送れなかったため、この変更は取り消しました");
      continue;
    }
    try {
      if (op.op === "check") await api("PATCH", `/api/blocks/${op.id}`, { checked: op.checked });
      if (op.op === "edit") await api("PATCH", `/api/blocks/${op.id}`, { text: op.text });
      if (op.op === "add") {
        const made = await api("POST", `/api/blocks/${op.parent}/children`, { text: op.text });
        replaceId(op.tempId, made.id);
      }
      if (op.op === "group") {
        const made = await api("POST", "/api/groups", { text: op.text });
        replaceId(op.tempId, made.id);
      }
      state.outbox.shift();
      state.error = "";
    } catch (err) {
      if (err.fatal) { dropOp(err.message); continue; }
      state.error = navigator.onLine === false ? "" : err.message;
      break; // 圏外・混雑：あとでやり直す
    }
    save(OUTBOX_STORAGE, state.outbox);
    save(CACHE_STORAGE, state.trip);
  }
  save(OUTBOX_STORAGE, state.outbox);
  render(); // 送れた項目の「…」を消す
}

function dropOp(message) {
  state.outbox.shift();
  save(OUTBOX_STORAGE, state.outbox);
  toast(message);
}

function isTemp(id) {
  return typeof id === "string" && id.startsWith("tmp-");
}

function replaceId(tempId, realId) {
  const node = findNode(tempId);
  if (node) node.id = realId;
  for (const o of state.outbox) {
    if (o.id === tempId) o.id = realId;
    if (o.parent === tempId) o.parent = realId;
  }
}

// ---------- データの操作 ----------
function allLists() {
  if (!state.trip) return [];
  return [...state.trip.days, ...state.trip.groups];
}

function findNode(id, list = null) {
  const roots = list || allLists();
  for (const n of roots) {
    if (n.id === id) return n;
    const found = findNode(id, n.items || n.children || []);
    if (found) return found;
  }
  return null;
}

function toggle(item) {
  item.checked = !item.checked;
  queue({ op: "check", id: item.id, checked: item.checked });
}

function addItem(parent, text, withTime) {
  const t = withTime ? text.match(/^(\d{1,2}[:：]\d{2})[\s　]*(.*)$/u) : null;
  const item = { id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, label: t ? t[2] : text, time: t ? t[1].replace("：", ":") : null, checked: false, children: [] };
  const list = parent.items || parent.children;
  list.push(item);
  if (withTime) list.sort(byTime);
  queue({ op: "add", parent: parent.id, text, tempId: item.id });
}

function addGroup(text) {
  const g = { id: `tmp-${Date.now()}`, label: text, items: [] };
  state.trip.groups.push(g);
  state.open.add(g.id);
  queue({ op: "group", text, tempId: g.id });
}

function editItem(item) {
  const text = prompt("文字を直す", item.text);
  if (text === null) return;
  const s = text.replace(/[\r\n]+/g, " ").trim();
  if (!s || s === item.text) return;
  item.text = s;
  const t = item.time !== null ? s.match(/^(\d{1,2}[:：]\d{2})[\s　]*(.*)$/u) : null;
  item.label = t ? t[2] : s;
  if (t) item.time = t[1].replace("：", ":");
  queue({ op: "edit", id: item.id, text: s });
}

function byTime(a, b) {
  if (!a.time || !b.time) return 0;
  return minutes(a.time) - minutes(b.time);
}

function minutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// ---------- 日付 ----------
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayDiff(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}

function shortDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return { md: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, w: WEEK[d.getUTCDay()] };
}

function defaultTab() {
  const days = state.trip?.days || [];
  const today = todayStr();
  const hit = days.find((d) => d.date === today);
  if (hit) return hit.id;
  if (days.length && today > days.at(-1).date) return days.at(-1).id;
  return "prep";
}

function headline() {
  const days = state.trip?.days || [];
  if (!days.length) return "旅のしおり";
  const today = todayStr();
  const first = days[0].date;
  const last = days.at(-1).date;
  if (today < first) {
    const n = dayDiff(today, first);
    return n === 1 ? "出発はあした" : `出発まであと${n}日`;
  }
  if (today <= last) return `${dayDiff(first, today) + 1}日目／${dayDiff(first, last) + 1}日`;
  return "おかえりなさい";
}

// ---------- 描画 ----------
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

function render() {
  const loggedIn = !!memoryKey;
  $("login").hidden = loggedIn;
  $("view").hidden = !loggedIn;
  $("foot").hidden = !loggedIn;
  $("tabs").hidden = !loggedIn;
  $("reload").hidden = !loggedIn;
  if (!loggedIn) return;

  $("head-title").textContent = state.trip?.title || "旅のしおり";
  $("head-sub").textContent = headline();
  if (state.trip?.pageUrl) $("notion-link").href = state.trip.pageUrl;

  if (!state.trip) {
    $("tabs").replaceChildren();
    $("view").replaceChildren(el("div", { class: "card empty" }, state.error || "しおりを読み込んでいます…"));
    renderSync();
    return;
  }
  const ids = [...state.trip.days.map((d) => d.id), "prep"];
  if (!ids.includes(state.tab)) state.tab = defaultTab();
  renderTabs();
  const day = state.trip.days.find((d) => d.id === state.tab);
  const scroll = $("main").scrollTop;
  $("view").replaceChildren(...(day ? renderDay(day) : renderPrep()));
  $("main").scrollTop = scroll;
  renderSync();
}

function renderTabs() {
  const tabs = state.trip.days.map((d) => {
    const { md, w } = shortDate(d.date);
    const isToday = d.date === todayStr();
    return tabBtn(d.id, el("span", { class: "tab-md" }, md), el("span", { class: "tab-w" }, isToday ? "今日" : w));
  });
  tabs.push(tabBtn("prep", el("span", { class: "tab-md" }, "準備"), el("span", { class: "tab-w" }, "もちもの")));
  $("tabs").replaceChildren(...tabs);
}

function tabBtn(id, ...kids) {
  return el("button", {
    type: "button",
    role: "tab",
    "aria-selected": String(state.tab === id),
    onclick: () => { state.tab = id; save(TAB_STORAGE, id); $("main").scrollTop = 0; render(); },
  }, ...kids);
}

function renderDay(day) {
  const isToday = day.date === todayStr();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nextItem = isToday ? day.items.find((i) => i.time && minutes(i.time) >= nowMin - 15 && !i.checked) : null;
  const done = day.items.filter((i) => i.checked).length;
  const { md, w } = shortDate(day.date);

  const rows = day.items.map((item) => {
    const isNext = item === nextItem;
    return el("li", { class: `tl-row${item.checked ? " done" : ""}${isNext ? " next" : ""}` },
      el("div", { class: "tl-time" }, item.time || "—"),
      el("div", { class: "tl-dot", "aria-hidden": "true" }),
      el("div", { class: "tl-body" },
        isNext ? el("span", { class: "badge" }, "つぎ") : null,
        checkRow(item),
        item.children.length ? renderList(item.children, 1) : null,
        el("div", { class: "tl-actions" },
          item.map ? el("a", { class: "map-btn", href: item.map, target: "_blank", rel: "noopener" }, pinIcon(), "地図") : null,
          item.link ? el("a", { class: "map-btn", href: item.link, target: "_blank", rel: "noopener" }, "リンク") : null,
        ),
      ),
    );
  });

  return [
    el("div", { class: "day-head" },
      el("div", {}, el("b", {}, md), el("span", {}, `（${w}）`), isToday ? el("span", { class: "today" }, "今日") : null),
      el("span", { class: "count" }, `${done}/${day.items.length}`),
    ),
    day.items.length ? el("ol", { class: "timeline" }, rows) : el("div", { class: "card empty" }, "予定はまだありません"),
    addForm(day.id, "例）16:00 ベビーセンター", (text) => addItem(day, text, true)),
    el("p", { class: "hint" }, "丸を押すと済みに。文字を長押しで直せます。地図はGoogleマップで開きます。"),
  ];
}

function renderPrep() {
  const cards = state.trip.groups.map((g) => {
    const flat = flatten(g.items);
    const done = flat.filter((i) => i.checked).length;
    const open = state.open.has(g.id);
    return el("section", { class: "card group" },
      el("div", { class: "group-head" },
        el("h2", {}, g.label),
        el("span", { class: `count${flat.length && done === flat.length ? " all" : ""}` }, `${done}/${flat.length}`),
        el("button", {
          type: "button", class: "plus", "aria-label": `${g.label}に足す`, "aria-expanded": String(open),
          onclick: () => { open ? state.open.delete(g.id) : state.open.add(g.id); render(); if (!open) setTimeout(() => document.querySelector(`[data-for="${g.id}"] input`)?.focus(), 0); },
        }, open ? "×" : "＋"),
      ),
      g.items.length ? renderList(g.items, 0) : el("p", { class: "sub" }, "まだ何もありません"),
      open ? addForm(g.id, "足すものを入れる", (text) => addItem(g, text, false)) : null,
    );
  });
  return [
    ...cards,
    el("section", { class: "card group add-group" },
      el("h2", {}, "まとまりを足す"),
      el("p", { class: "sub" }, "服装・買い物・お土産など。Notion のToDoの最後に入ります。"),
      addForm("new-group", "例）👕 服装", (text) => addGroup(text)),
    ),
  ];
}

function flatten(items) {
  return items.flatMap((i) => [...(i.checked === null ? [] : [i]), ...flatten(i.children || [])]);
}

function renderList(items, depth) {
  return el("ul", { class: `list depth-${depth}` }, items.map((item) =>
    el("li", { class: item.checked ? "done" : "" },
      checkRow(item),
      item.children?.length ? renderList(item.children, depth + 1) : null,
    )));
}

function checkRow(item) {
  if (item.checked === null) return el("div", { class: "note" }, item.label);
  let timer = null;
  let longPressed = false;
  const start = () => { longPressed = false; timer = setTimeout(() => { longPressed = true; editItem(item); }, 550); };
  const cancel = () => clearTimeout(timer);
  return el("button", {
    type: "button",
    class: "check-row",
    role: "checkbox",
    "aria-checked": String(item.checked),
    onpointerdown: start,
    onpointerup: cancel,
    onpointerleave: cancel,
    onpointercancel: cancel,
    oncontextmenu: (e) => e.preventDefault(),
    onclick: () => { if (!longPressed) toggle(item); },
  },
  el("span", { class: "box", "aria-hidden": "true" }, item.checked ? "✓" : ""),
  el("span", { class: "label" }, item.label),
  isTemp(item.id) ? el("span", { class: "pending", title: "未送信" }, "…") : null);
}

function addForm(key, placeholder, onAdd) {
  const input = el("input", { type: "text", placeholder, maxlength: "200", enterkeyhint: "done", "aria-label": placeholder });
  return el("form", {
    class: "add-form",
    "data-for": key,
    onsubmit: (e) => {
      e.preventDefault();
      const text = input.value.replace(/[\r\n]+/g, " ").trim();
      if (!text) return;
      input.value = "";
      onAdd(text);
      setTimeout(() => document.querySelector(`[data-for="${key}"] input`)?.focus(), 0);
    },
  }, input, el("button", { type: "submit", class: "primary small" }, "足す"));
}

function pinIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>';
  return svg;
}

function renderSync() {
  const s = $("sync");
  const n = state.outbox.length;
  s.className = "sync";
  if (state.syncing) s.textContent = "読み込み中…";
  else if (n && (navigator.onLine === false || !flushing)) { s.textContent = `未送信${n}件（電波が戻ったら送ります）`; s.classList.add("warn"); }
  else if (n) { s.textContent = `送信中…（${n}件）`; s.classList.add("warn"); }
  else if (state.error) { s.textContent = state.error; s.classList.add("err"); }
  else if (state.trip?.fetchedAt) {
    const d = new Date(state.trip.fetchedAt);
    s.textContent = `Notionと同期 ${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  } else s.textContent = "";
  $("reload").classList.toggle("spin", state.syncing);
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

// ---------- はじまり ----------
$("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  memoryKey = $("key").value.trim();
  save(KEY_STORAGE, memoryKey);
  $("key").value = "";
  render();
  refresh();
});
$("logout").addEventListener("click", () => {
  if (!confirm("この端末から合言葉を消しますか？（しおりのコピーも消えます）")) return;
  memoryKey = "";
  save(KEY_STORAGE, "");
  save(CACHE_STORAGE, null);
  save(OUTBOX_STORAGE, null);
  state.trip = null;
  state.outbox = [];
  render();
});
$("reload").addEventListener("click", () => refresh());
window.addEventListener("online", () => refresh());
window.addEventListener("offline", () => renderSync());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { render(); refresh(); }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
render();
refresh();
