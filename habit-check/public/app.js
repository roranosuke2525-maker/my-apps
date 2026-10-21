// 習慣チェック入力アプリ（画面側）。Notion へは必ず Worker の /api を経由する。

const KEY_STORAGE = "habit-check:key";
const MAX_BACK_DAYS = 6;
const SLOT_LABELS = {
  morning: "☼ 朝",
  noon: "☀︎ 昼",
  timed: "◷ 時間指定",
  night: "☾ 夜",
  anytime: "↻ いつでも",
};

const $ = (id) => document.getElementById(id);
const state = { date: todayJst(), habits: [], row: null, savedNote: "" };
let writeChain = Promise.resolve();
let refreshTimer = null;

// ---------- 日付（日本時間で数える） ----------
function todayJst() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dateLabel(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const w = "日月火水木金土"[d.getUTCDay()];
  const rel = { 0: "今日", [-1]: "昨日", [-2]: "おととい" }[daysFromToday(date)];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${w}）${rel ? " " + rel : ""}`;
}
function daysFromToday(date) {
  return Math.round((Date.parse(date) - Date.parse(todayJst())) / 86400e3);
}
function currentSlot() {
  const h = new Date(Date.now() + 9 * 3600e3).getUTCHours();
  if (h >= 4 && h <= 10) return "morning";
  if (h >= 11 && h <= 17) return "noon";
  return "night";
}

// ---------- 通信 ----------
function getKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ""; } catch { return ""; }
}
function setKey(v) {
  try { v ? localStorage.setItem(KEY_STORAGE, v) : localStorage.removeItem(KEY_STORAGE); } catch { /* 保存できない端末では毎回入力 */ }
}
let memoryKey = getKey();

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${memoryKey}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    memoryKey = "";
    setKey("");
    showLogin();
    throw new Error(data.error || "合言葉が違います");
  }
  if (!res.ok) throw new Error(data.error || `通信エラー（${res.status}）`);
  return data;
}

// ---------- 画面 ----------
function showLogin() {
  $("login").hidden = false;
  $("status").hidden = true;
  $("empty").hidden = true;
  $("note-box").hidden = true;
  $("groups").replaceChildren();
}

async function load({ quiet = false } = {}) {
  if (!memoryKey) return showLogin();
  $("login").hidden = true;
  renderNav();
  if (!quiet) $("groups").innerHTML = '<p class="loading">読み込み中…</p>';
  try {
    const data = await api("GET", `/api/day?date=${state.date}`);
    if (data.date !== state.date) return; // 読み込み中に日付を変えた
    state.habits = data.habits;
    state.row = data.row;
    state.savedNote = data.row?.note || "";
    render();
  } catch (err) {
    if (!quiet) $("groups").innerHTML = "";
    toast(err.message, true);
  }
}

function renderNav() {
  $("date-label").textContent = dateLabel(state.date);
  $("prev").disabled = daysFromToday(state.date) <= -MAX_BACK_DAYS;
  $("next").disabled = daysFromToday(state.date) >= 0;
}

function render() {
  renderNav();
  const row = state.row;
  $("empty").hidden = !!row;
  $("note-box").hidden = !row;
  $("status").hidden = !row;
  $("open-notion").hidden = !row?.url;
  if (row?.url) $("open-notion").href = row.url;
  if (!row) {
    $("groups").replaceChildren();
    return;
  }
  renderStatus();
  renderGroups();
  if (document.activeElement !== $("note")) $("note").value = row.note;
  $("save-note").disabled = $("note").value === state.savedNote;
}

function renderStatus() {
  const { checks, stats } = state.row;
  const total = state.habits.length;
  const done = state.habits.filter((h) => checks[h.name]).length;
  $("count").textContent = `${done} / ${total}`;
  $("fill").style.width = total ? `${(done / total) * 100}%` : "0";

  const lv = stats["いまのLv"];
  const rest = stats["のこりEXP"];
  $("lv").textContent = typeof lv === "number" ? `Lv${lv}` : "Lv—";
  $("rest").textContent = typeof rest === "number" ? `次まで ${rest}EXP` : "";

  const musts = state.habits.filter((h) => h.must);
  const left = musts.filter((h) => !checks[h.name]);
  $("must").textContent = musts.length
    ? left.length
      ? `◆必ず ${musts.length - left.length}/${musts.length}　のこり：${left.map((h) => h.label).join("・")}`
      : `◆必ず ${musts.length}/${musts.length} クリア！`
    : "";
}

function renderGroups() {
  // 今日なら「いまの時間帯 → いつでも → 残り」の順に並べる
  const now = daysFromToday(state.date) === 0 ? currentSlot() : null;
  const nowSlots = now === "noon" ? ["noon", "timed"] : now ? [now] : [];
  const base = ["morning", "noon", "timed", "night", "anytime"];
  const order = now
    ? [...nowSlots, "anytime", ...base.filter((s) => s !== "anytime" && !nowSlots.includes(s))]
    : base;

  const frag = document.createDocumentFragment();
  for (const slot of order) {
    const items = state.habits
      .filter((h) => h.slot === slot)
      .sort((a, b) => Number(b.must) - Number(a.must) || a.label.localeCompare(b.label, "ja"));
    if (!items.length) continue;
    const sec = document.createElement("section");
    sec.className = "group";
    const h2 = document.createElement("h2");
    h2.textContent = SLOT_LABELS[slot];
    if (nowSlots.includes(slot)) {
      const badge = document.createElement("span");
      badge.className = "now";
      badge.textContent = "いま";
      h2.append(badge);
    }
    const list = document.createElement("div");
    list.className = "list";
    for (const h of items) list.append(habitButton(h));
    sec.append(h2, list);
    frag.append(sec);
  }
  $("groups").replaceChildren(frag);
}

function habitButton(h) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "habit";
  btn.setAttribute("aria-pressed", String(!!state.row.checks[h.name]));
  const box = document.createElement("span");
  box.className = "box";
  const text = document.createElement("span");
  text.className = "text";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = h.label;
  text.append(name);
  if (h.hint) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = h.hint;
    text.append(hint);
  }
  btn.append(box, text);
  if (h.must) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = "必ず";
    btn.append(tag);
  }
  btn.addEventListener("click", () => toggle(h, btn));
  return btn;
}

// ---------- 書き込み（1件ずつ順番に送る） ----------
function enqueue(task) {
  writeChain = writeChain.then(task, task);
  return writeChain;
}

function toggle(h, btn) {
  const row = state.row;
  const next = !row.checks[h.name];
  row.checks[h.name] = next;
  btn.setAttribute("aria-pressed", String(next));
  btn.classList.add("pending");
  renderStatus();
  if (next && navigator.vibrate) navigator.vibrate(10);

  enqueue(async () => {
    try {
      const { row: updated } = await api("PATCH", `/api/pages/${row.id}`, { name: h.name, value: next });
      if (state.row?.id === updated.id) state.row.stats = updated.stats;
      toast(next ? `✓ ${h.label}` : `${h.label} を外しました`);
      scheduleRefresh();
    } catch (err) {
      if (state.row?.id === row.id) row.checks[h.name] = !next;
      btn.setAttribute("aria-pressed", String(!next));
      toast(`保存できませんでした：${err.message}`, true);
    } finally {
      btn.classList.remove("pending");
      if (state.row?.id === row.id) renderStatus();
    }
  });
}

function saveNote() {
  const row = state.row;
  const value = $("note").value;
  $("save-note").disabled = true;
  enqueue(async () => {
    try {
      await api("PATCH", `/api/pages/${row.id}`, { name: "ひとこと", value });
      if (state.row?.id === row.id) {
        state.savedNote = value;
        row.note = value;
      }
      toast("ひとことを保存しました");
      scheduleRefresh();
    } catch (err) {
      toast(`保存できませんでした：${err.message}`, true);
    } finally {
      $("save-note").disabled = $("note").value === state.savedNote;
    }
  });
}

// Lv・EXP は Notion 側の計算を待ってから取り直す
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => enqueue(() => load({ quiet: true })), 2500);
}

let toastTimer = null;
function toast(msg, error = false) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.toggle("error", error);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), error ? 4000 : 1600);
}

// ---------- イベント ----------
$("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  memoryKey = $("key").value.trim();
  setKey(memoryKey);
  $("key").value = "";
  load();
});
$("logout").addEventListener("click", () => {
  memoryKey = "";
  setKey("");
  showLogin();
});
$("refresh").addEventListener("click", () => load());
$("prev").addEventListener("click", () => { state.date = addDays(state.date, -1); load(); });
$("next").addEventListener("click", () => { state.date = addDays(state.date, 1); load(); });
$("create").addEventListener("click", async () => {
  $("create").disabled = true;
  try {
    const data = await api("POST", "/api/day", { date: state.date });
    state.habits = data.habits;
    state.row = data.row;
    state.savedNote = data.row?.note || "";
    render();
    toast("行を作りました");
  } catch (err) {
    toast(err.message, true);
  } finally {
    $("create").disabled = false;
  }
});
$("note").addEventListener("input", () => {
  $("save-note").disabled = $("note").value === state.savedNote;
});
$("save-note").addEventListener("click", saveNote);

// アプリに戻ってきたとき、日付が変わっていれば今日に合わせて取り直す
let lastToday = todayJst();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !memoryKey) return;
  const t = todayJst();
  if (t !== lastToday) {
    lastToday = t;
    state.date = t;
    load();
  } else {
    enqueue(() => load({ quiet: true }));
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

load();
