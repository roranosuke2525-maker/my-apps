// 習慣チェック（画面側）。Notion へは必ず Worker の /api を経由する。
// 習慣ページの5つのタブ（習慣チェック・パーティー・ギルド・ものがたり・きろく）を1画面ずつで見せる。

const KEY_STORAGE = "habit-check:key";
const MAX_BACK_DAYS = 6;
const STALE_MS = 60e3;
const REFRESH_DELAY = 2500;
const SLOTS = [
  ["morning", "☼ 朝"],
  ["noon", "☀︎ 日中"],
  ["evening", "◐ 夕方"],
  ["night", "☾ 寝る前"],
  ["anytime", "↻ いつでも"],
];
const WEEK = "月火水木金土日";
const CATEGORY_COLORS = { 家事: "orange", 育児: "pink", 家: "brown", お金: "green", からだ: "red", 学び: "blue", 趣味: "purple" };
const VIEW_TITLES = { habit: "習慣チェック", party: "パーティー", guild: "ギルド", story: "ものがたり", me: "きろく" };
const GRAPH_DAYS = 30;
const BAR_DAYS = 14;

const $ = (id) => document.getElementById(id);
const fmt = (n) => (typeof n === "number" ? n.toLocaleString("ja-JP") : "—");
const pct = (x) => `${Math.round(x * 100)}%`;

// 要素を作る。文字は必ず textContent で入れる（Notion の文字をHTMLとして扱わない）
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const state = {
  view: "habit",
  tab: "day",
  date: todayJst(),
  habits: [],
  row: null,
  savedNote: "",
  dayLoading: false,
  dayError: "",
  weekStart: mondayOf(todayJst()),
  month: todayJst().slice(0, 7),
  ranges: new Map(),
  data: {},
  loadedAt: {},
  errors: {},
  guildTab: "board",
  guildCat: "すべて",
  pending: new Map(), // `${行ID}|${列名}` → 送信中・送信直後のチェック（読み直しで古い値に戻さないため）
};
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
function daysFromToday(date) {
  return Math.round((Date.parse(date) - Date.parse(todayJst())) / 86400e3);
}
function weekIndex(date) {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}
function mondayOf(date) {
  return addDays(date, -weekIndex(date));
}
function md(date) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}
function dateLabel(date) {
  const rel = { 0: "今日", [-1]: "昨日", [-2]: "おととい" }[daysFromToday(date)];
  return `${md(date)}（${WEEK[weekIndex(date)]}）${rel ? " " + rel : ""}`;
}
function jstStamp(iso) {
  const t = new Date(Date.parse(iso) + 9 * 3600e3).toISOString();
  return `${md(t.slice(0, 10))} ${t.slice(11, 16)}`;
}
function editable(date) {
  const d = daysFromToday(date);
  return d <= 0 && d >= -MAX_BACK_DAYS;
}
// 時間帯の区切り（JST）：朝 4:00〜8:00／日中〜17:15／夕方〜21:00／寝る前〜翌4:00
function currentSlot() {
  const d = new Date(Date.now() + 9 * 3600e3);
  const min = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (min >= 240 && min < 480) return "morning";
  if (min >= 480 && min < 1035) return "noon";
  if (min >= 1035 && min < 1260) return "evening";
  return "night";
}

// その日の達成率に数える習慣か（★ボーナスは数えない／曜日指定はその曜日だけ）
function weekday(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
function isOff(x, date) {
  return !!x.days && !x.days.includes(weekday(date));
}
function counts(x, date) {
  return !x.bonus && !isOff(x, date);
}

// 中身を入れ替える。同じ画面（key が同じ）の描き直しなら、スクロール位置をそのまま残す
function swap(body, nodes, key = "") {
  const same = body.dataset.scrollKey === key;
  const tops = same ? [...body.querySelectorAll(".scroll, .tbody")].map((el) => el.scrollTop) : [];
  body.replaceChildren(...nodes.filter(Boolean));
  body.dataset.scrollKey = key;
  if (tops.length) body.querySelectorAll(".scroll, .tbody").forEach((el, i) => { if (tops[i]) el.scrollTop = tops[i]; });
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

function enqueue(task) {
  writeChain = writeChain.then(task, task);
  return writeChain;
}

// パーティー・ギルドなど：開いたときに読み、1分以内なら読み直さない
async function loadData(name, path, { force = false } = {}) {
  if (!force && state.data[name] && Date.now() - state.loadedAt[name] < STALE_MS) return state.data[name];
  try {
    state.data[name] = await api("GET", path);
    state.loadedAt[name] = Date.now();
    state.errors[name] = "";
  } catch (err) {
    state.errors[name] = err.message;
  }
  return state.data[name];
}

async function loadPlayer(opts) {
  await loadData("player", "/api/player", opts);
  renderHeader();
}

// ---------- 画面の切り替え ----------
function showLogin() {
  $("login").hidden = false;
  for (const v of document.querySelectorAll(".view:not(#login)")) v.hidden = true;
  $("bottom-nav").hidden = true;
  $("habit-tabs").hidden = true;
  $("exp-row").hidden = true;
}

function show() {
  if (!memoryKey) return showLogin();
  $("login").hidden = true;
  $("bottom-nav").hidden = false;
  const viewId = state.view === "habit" ? state.tab : state.view;
  for (const id of ["day", "week", "cal", "graph", "party", "guild", "story", "me"]) $(`view-${id}`).hidden = id !== viewId;
  for (const b of document.querySelectorAll("#bottom-nav button")) {
    b.setAttribute("aria-current", b.dataset.view === state.view ? "page" : "false");
  }
  for (const b of document.querySelectorAll("#habit-tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === state.tab));
  renderHeader();
  ({ day: renderDay, week: renderWeek, cal: renderCal, graph: renderGraph, party: renderParty, guild: renderGuild, story: renderStory, me: renderMe })[viewId]();
}

function renderHeader() {
  const player = state.data.player?.player;
  const isHabit = state.view === "habit";
  $("habit-tabs").hidden = !isHabit || !memoryKey;
  $("exp-row").hidden = isHabit || !memoryKey;
  $("head-title").textContent = VIEW_TITLES[state.view];
  const ym = (d) => `${Number(d.slice(0, 4))}年${Number(d.slice(5, 7))}月`;
  $("head-sub").textContent = !isHabit
    ? player?.name || ""
    : { day: ym(state.date), week: ym(state.weekStart), cal: "1か月の達成", graph: `直近${GRAPH_DAYS}日` }[state.tab];
  $("pill-lv").textContent = typeof player?.level === "number" ? player.level : "—";
  $("exp-total").textContent = fmt(player?.totalExp);
  $("exp-next").textContent = typeof player?.toNext === "number" ? `${fmt(player.toNext)} EXP` : "—";
}

function loadingEl(text = "読み込み中…") {
  return h("p", { class: "loading", text });
}

// ================= 習慣：日 =================
async function loadDay({ quiet = false } = {}) {
  const date = state.date;
  if (!quiet) {
    state.dayLoading = true;
    if (state.view === "habit" && state.tab === "day") renderDay();
  }
  try {
    const data = await api("GET", `/api/day?date=${date}`);
    if (data.date !== state.date) return; // 読み込み中に日付を変えた
    state.habits = data.habits;
    state.row = applyPending(data.row);
    state.savedNote = data.row?.note || "";
    state.dayError = "";
  } catch (err) {
    state.dayError = err.message;
    if (quiet) toast(err.message, true);
  } finally {
    state.dayLoading = false;
  }
  if (state.view === "habit" && state.tab === "day") renderDay();
}

// 時間帯ごとのまとまり。時間帯の順は SLOTS、中の並びは届いた順（アーティファクト版は Notion のビューの順）で、◆必ず を先に
const DAY_COLS = 3;

function slotGroups() {
  return SLOTS.map(([slot, label]) => ({
    slot,
    label,
    list: state.habits.filter((x) => x.slot === slot).sort((a, b) => Number(b.must) - Number(a.must)),
  })).filter((g) => g.list.length);
}

function renderDay() {
  $("date-label").textContent = dateLabel(state.date);
  $("go-today").hidden = state.date === todayJst();
  $("next").disabled = daysFromToday(state.date) >= 0;
  const body = $("day-body");
  if (state.dayLoading && !state.row) return body.replaceChildren(loadingEl());
  if (state.dayError && !state.row) return body.replaceChildren(h("p", { class: "err", text: state.dayError }));
  const row = state.row;
  if (!row) {
    const canCreate = editable(state.date);
    return body.replaceChildren(
      h("div", { class: "card" },
        h("h2", { text: "この日の行がまだありません" }),
        h("p", { class: "sub", text: canCreate ? "Notion の DB_習慣チェック に、この日の行を作ってからチェックします。" : "この日は記録がありません。" }),
        canCreate ? h("button", { type: "button", class: "primary", onclick: createDay }, "行を作る") : null,
      ),
    );
  }
  const canEdit = editable(state.date);
  const now = state.date === todayJst() ? currentSlot() : null;
  // 時間帯ごとに「左に見出し・右に3列のタイル」。行数に応じて高さを分け合い、1画面に収める。
  // 1行に満たない時間帯どうし（昼・時間など）は、合わせて3つまでなら同じ行に並べる
  const lines = [];
  for (const g of slotGroups()) {
    const last = lines.at(-1);
    const n = g.list.length;
    if (n < DAY_COLS && last && last.every((x) => x.list.length < DAY_COLS) && last.reduce((a, x) => a + x.list.length, n) <= DAY_COLS) last.push(g);
    else lines.push([g]);
  }
  const slotEl = (g, cols) => h("div", { class: `slot${g.slot === now ? " now" : ""}`, "data-slot": g.slot, style: `--cols:${cols};flex-grow:${cols}` },
    h("div", { class: "slot-label" },
      h("span", { class: "slot-icon", text: g.label.split(" ")[0] }),
      h("span", { class: "slot-name", text: g.label.split(" ")[1] || "" }),
      h("small", { text: (() => { const s = g.list.filter((x) => counts(x, state.date)); return `${s.filter((x) => row.checks[x.name]).length}/${s.length}`; })() }),
    ),
    h("div", { class: "slot-tiles" }, g.list.map((x) => habitTile(x, row, canEdit))),
  );
  const groups = lines.map((line) => {
    const rows = Math.max(...line.map((g) => Math.ceil(g.list.length / DAY_COLS)));
    return h("div", { class: "slot-line", style: `--rows:${rows}` },
      line.length === 1 ? slotEl(line[0], DAY_COLS) : line.map((g) => slotEl(g, g.list.length)));
  });
  swap(body, [
    statusCard(row),
    h("div", { class: "habits scroll fill" }, groups),
    canEdit ? noteRow(row) : h("p", { class: "readonly", text: `${MAX_BACK_DAYS}日より前の日は見るだけです` }),
  ], `day:${state.date}`);
}

function statusCard(row) {
  const scored = state.habits.filter((x) => counts(x, state.date));
  const total = scored.length;
  const done = scored.filter((x) => row.checks[x.name]).length;
  const musts = state.habits.filter((x) => x.must);
  const left = musts.filter((x) => !row.checks[x.name]);
  return h("div", { class: "card", id: "status" },
    h("div", { class: "progress" },
      h("span", { class: "sub", text: "達成" }),
      h("div", { class: "bar" }, h("span", { style: `width:${total ? (done / total) * 100 : 0}%` })),
      h("b", { text: `${done} / ${total}` }),
      musts.length && !left.length ? h("span", { class: "must clear", text: "◆クリア" }) : null,
    ),
    left.length
      ? h("div", { class: "must", text: `◆必ず ${musts.length - left.length}/${musts.length}　のこり：${left.map((x) => x.label).join("・")}` })
      : null,
  );
}

// 木札：表は白木に彫った絵と短い名前、チェックすると くるっと裏返って ウォールナットの面（済）になる。長押しで正式な名前と説明
function habitTile(x, row, canEdit) {
  const art = habitCarving(x.label); // carve.js
  const face = (side) => h("span", { class: `face ${side}` },
    h("span", { class: "hole", "aria-hidden": "true" }),
    art ? carving(art, "ico") : null,
    h("span", { class: `lbl${art ? "" : " only"}`, text: shortName(x.label) }),
    side === "back" ? h("span", { class: "done-mark", "aria-hidden": "true", text: "✓" }) : null,
  );
  const btn = h("button", {
    type: "button", class: "habit", "data-name": x.name, "aria-pressed": String(!!row.checks[x.name]), disabled: !canEdit,
    "aria-label": `${x.must ? "必ず：" : ""}${x.label}${x.hint ? `（${x.hint}）` : ""}`,
  },
    h("span", { class: "flip" }, face("front"), face("back")),
    x.must ? h("span", { class: "must-mark", "aria-hidden": "true", text: "◆" }) : null,
  );
  let pressTimer = null;
  let longPressed = false;
  btn.addEventListener("pointerdown", () => {
    longPressed = false;
    pressTimer = setTimeout(() => { longPressed = true; showName(btn, x); }, LONG_PRESS_MS);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, () => clearTimeout(pressTimer));
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  btn.addEventListener("click", (e) => {
    if (longPressed) { longPressed = false; e.preventDefault(); return; }
    toggleCheck(row, state.date, x, !row.checks[x.name]);
  });
  return btn;
}

const LONG_PRESS_MS = 420;
let nameTimer = null;

// 長押しした札の上に、名前と説明を少しだけ出す
function showName(btn, x) {
  document.querySelector(".name-bubble")?.remove();
  const r = btn.getBoundingClientRect();
  const bubble = h("div", { class: "name-bubble", role: "status" },
    h("b", { text: `${x.must ? "◆ " : ""}${x.label}` }), x.hint ? h("span", { text: x.hint }) : null);
  document.body.append(bubble);
  const bw = bubble.offsetWidth;
  bubble.style.left = `${Math.max(8, Math.min(innerWidth - bw - 8, r.left + r.width / 2 - bw / 2))}px`;
  bubble.style.top = `${Math.max(8, r.top - bubble.offsetHeight - 6)}px`;
  if (navigator.vibrate) navigator.vibrate(8);
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => bubble.remove(), 1800);
}

function noteRow(row) {
  const input = h("input", { type: "text", id: "note", maxlength: "2000", placeholder: "ひとこと（その他のできたこと・+5EXP）", "aria-label": "ひとこと" });
  input.value = row.note;
  const save = h("button", { type: "button", class: "primary", disabled: true }, "保存");
  input.addEventListener("input", () => { save.disabled = input.value === state.savedNote; });
  save.addEventListener("click", () => saveNote(row, input, save));
  return h("div", { class: "note-row" }, input, save);
}

// チェックの付け外し（日・週どちらからでも）。画面はすぐ変え、少し待ってから送る（続けて押したら最後の状態だけ送る）。
// 送信中と送った直後は、読み直した値で上書きしない（Notion の検索は少し遅れて古い値を返すことがあるため）
const SEND_DELAY = 250;
const KEEP_LOCAL_MS = 20e3;

function toggleCheck(row, date, habit, next) {
  setCheck(row.id, habit.name, next);
  if (navigator.vibrate) navigator.vibrate(next ? 12 : 6);
  rerenderHabit();
  const key = `${row.id}|${habit.name}`;
  const p = state.pending.get(key) || { chain: Promise.resolve(), sent: !next };
  Object.assign(p, { value: next, until: Infinity });
  state.pending.set(key, p);
  clearTimeout(p.timer);
  p.timer = setTimeout(() => { p.chain = p.chain.then(() => sendCheck(row.id, habit, key)); }, SEND_DELAY);
}

async function sendCheck(rowId, habit, key) {
  const p = state.pending.get(key);
  if (!p || p.value === p.sent) return;
  const value = p.value;
  try {
    const { row: updated } = await api("PATCH", `/api/pages/${rowId}`, { name: habit.name, value });
    p.sent = value;
    if (state.row?.id === updated.id) state.row.stats = updated.stats;
    if (p.value === value) p.until = Date.now() + KEEP_LOCAL_MS;
    scheduleRefresh();
  } catch (err) {
    if (p.value !== value) return; // その間に押し直した。次の送信に任せる
    state.pending.delete(key);
    setCheck(rowId, habit.name, p.sent);
    rerenderHabit();
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    toast(`${habit.label}：保存できませんでした（${err.message}）`, true);
  }
}

// 読み直した行に、まだ Notion に届いていない（または届いた直後の）チェックを重ねる
function applyPending(row) {
  if (!row) return row;
  const now = Date.now();
  for (const [key, p] of state.pending) {
    const [rowId, name] = [key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)];
    if (p.until < now) state.pending.delete(key);
    else if (rowId === row.id) row.checks[name] = p.value;
  }
  return row;
}

function setCheck(rowId, name, value) {
  if (state.row?.id === rowId) state.row.checks[name] = value;
  for (const r of state.ranges.values()) {
    for (const day of Object.values(r.days || {})) if (day.id === rowId) day.checks[name] = value;
  }
}

function rerenderHabit() {
  if (state.view !== "habit") return;
  if (state.tab === "day" && patchDay()) return;
  show();
}

// 日の画面は作り直さずに、札の向き・達成の数だけ書き換える（裏返る動きを見せるため）
function patchDay() {
  const body = $("day-body");
  const row = state.row;
  if (!row || body.dataset.scrollKey !== `day:${state.date}`) return false;
  for (const btn of body.querySelectorAll(".habit[data-name]")) btn.setAttribute("aria-pressed", String(!!row.checks[btn.dataset.name]));
  for (const el of body.querySelectorAll(".slot[data-slot] .slot-label small")) {
    const list = state.habits.filter((x) => x.slot === el.closest(".slot").dataset.slot);
    el.textContent = `${list.filter((x) => row.checks[x.name]).length}/${list.length}`;
  }
  $("status")?.replaceWith(statusCard(row));
  return true;
}

function saveNote(row, input, save) {
  const value = input.value;
  save.disabled = true;
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
      save.disabled = false;
    }
  });
}

async function createDay() {
  try {
    const data = await api("POST", "/api/day", { date: state.date });
    state.habits = data.habits;
    state.row = data.row;
    state.savedNote = data.row?.note || "";
    state.ranges.clear();
    toast("行を作りました");
  } catch (err) {
    toast(err.message, true);
  }
  renderDay();
}

// Lv・EXP は Notion 側の計算を待ってから取り直す
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => loadPlayer({ force: true }), REFRESH_DELAY);
}

// ================= 習慣：週・カレンダー・グラフ（期間まとめ読み） =================
async function getRange(from, to) {
  const key = `${from}|${to}`;
  const hit = state.ranges.get(key);
  if (hit && Date.now() - hit.at < STALE_MS) return hit;
  const data = await api("GET", `/api/range?from=${from}&to=${to}`);
  if (data.habits?.length) state.habits = data.habits;
  for (const day of Object.values(data.days || {})) applyPending(day);
  const entry = { ...data, at: Date.now() };
  state.ranges.set(key, entry);
  return entry;
}

// 期間のデータを読み、まだ同じ画面・同じ期間を見ていれば描く（古いデータは先に描いてから読み直す）
async function withRange(bodyId, from, to, render, isCurrent) {
  const body = $(bodyId);
  const key = `${from}|${to}`;
  const hit = state.ranges.get(key);
  if (hit) render(hit);
  if (hit && Date.now() - hit.at < STALE_MS) return;
  if (!hit) body.replaceChildren(loadingEl());
  try {
    const r = await getRange(from, to);
    if (!body.closest(".view").hidden && isCurrent()) render(r);
  } catch (err) {
    if (hit) toast(err.message, true);
    else if (isCurrent()) body.replaceChildren(h("p", { class: "err", text: err.message }));
  }
}

function dayRate(day, date) {
  if (!day) return null;
  const scored = state.habits.filter((x) => counts(x, date));
  if (!scored.length) return null;
  return scored.filter((x) => day.checks[x.name]).length / scored.length;
}

function renderWeek() {
  const from = state.weekStart;
  const to = addDays(from, 6);
  $("week-label").textContent = `${md(from)} – ${md(to)}`;
  $("week-next").disabled = addDays(from, 7) > todayJst();
  withRange("week-body", from, to, (r) => {
    const dates = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    const today = todayJst();
    const head = h("div", { class: "trow head" }, h("div", { class: "name", text: "習慣" }),
      dates.map((d, i) => h("div", { class: `day${d === today ? " today" : ""}` }, h("span", { text: WEEK[i] }), h("span", { text: String(Number(d.slice(8))) }))));
    const habitRow = (x) => h("div", { class: "trow" }, h("div", { class: "name", text: x.label }),
      dates.map((d) => {
        const day = r.days[d];
        if (!day || d > today) return h("div", { class: "dot", "aria-hidden": "true", text: "·" });
        const on = !!day.checks[x.name];
        const btn = h("button", { type: "button", class: `cell${d === today ? " today" : ""}${isOff(x, d) ? " off" : ""}`, "aria-pressed": String(on), "aria-label": `${x.label} ${md(d)}`, disabled: !editable(d) }, h("span", { class: "box" }));
        btn.addEventListener("click", () => toggleCheck(day, d, x, !day.checks[x.name]));
        return btn;
      }));
    const rows = slotGroups().flatMap((g) => [h("div", { class: "trow group" }, h("div", { class: "name", text: g.label })), ...g.list.map(habitRow)]);
    const foot = h("div", { class: "trow foot" }, h("div", { class: "name", text: "達成率" }),
      dates.map((d) => { const rate = dayRate(r.days[d], d); return h("div", { class: "day", text: rate == null ? "–" : pct(rate) }); }));
    swap($("week-body"), [
      h("div", { class: "table fill" }, head, h("div", { class: "tbody" }, rows), foot),
    ], `week:${state.weekStart}`);
  }, () => state.weekStart === from);
}

function monthRange(month) {
  const from = `${month}-01`;
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return [from, d.toISOString().slice(0, 10)];
}

function shiftMonth(month, n) {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

function renderCal() {
  const [from, to] = monthRange(state.month);
  $("month-label").textContent = `${Number(state.month.slice(0, 4))}年${Number(state.month.slice(5))}月`;
  $("month-next").disabled = shiftMonth(state.month, 1) > todayJst().slice(0, 7);
  withRange("cal-body", from, to, (r) => {
    const today = todayJst();
    const cells = WEEK.split("").map((w) => h("div", { class: "wd", text: w }));
    for (let i = 0; i < weekIndex(from); i++) cells.push(h("div"));
    let sum = 0, counted = 0, perfect = 0, mustAll = 0;
    const musts = state.habits.filter((x) => x.must);
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const day = r.days[d];
      const rate = d <= today ? dayRate(day, d) : null;
      if (rate != null) {
        sum += rate; counted++;
        if (rate === 1) perfect++;
        if (musts.length && musts.every((x) => day.checks[x.name])) mustAll++;
      }
      const lv = rate == null ? "none" : `lv${Math.round(rate * 4)}`;
      const cls = [lv, d === today ? "is-today" : "", d === state.date ? "is-sel" : ""].join(" ");
      const date = d;
      cells.push(h("button", { type: "button", class: cls, "aria-label": `${md(d)} ${rate == null ? "記録なし" : pct(rate)}`, disabled: d > today, onclick: () => openDay(date) }, String(Number(d.slice(8)))));
    }
    $("cal-body").replaceChildren(
      h("div", { class: "legend" }, "少", ["lv0", "lv1", "lv2", "lv3", "lv4"].map((c) => h("i", { style: `background:var(--${c})` })), "多"),
      h("div", { class: "card" }, h("div", { class: "cal" }, cells)),
      h("div", { class: "stats" },
        stat("今月の平均", counted ? pct(sum / counted) : "—"),
        stat("全部できた日", `${perfect}日`),
        stat("◆必ずクリア", `${mustAll}日`),
      ),
      h("p", { class: "readonly", text: "日付をタップすると、その日の入力に移ります" }),
    );
  }, () => monthRange(state.month)[0] === from);
}

function stat(label, value) {
  return h("div", { class: "card stat" }, h("span", { text: label }), h("b", { text: value }));
}

function openDay(date) {
  state.date = date;
  state.tab = "day";
  state.row = null;
  show();
  loadDay();
}

function renderGraph() {
  const to = todayJst();
  const from = addDays(to, -(GRAPH_DAYS - 1));
  withRange("graph-body", from, to, (r) => {
    const barFrom = addDays(to, -(BAR_DAYS - 1));
    const bars = [];
    const labels = [];
    for (let d = barFrom; d <= to; d = addDays(d, 1)) {
      const rate = dayRate(r.days[d], d) ?? 0;
      bars.push(h("span", { class: d === to ? "now" : "", style: `height:${Math.max(1.5, rate * 100)}%`, title: `${md(d)} ${pct(rate)}` }));
      labels.push(h("span", { text: String(Number(d.slice(8))) }));
    }
    const entries = Object.entries(r.days);
    const days = entries.map(([, d]) => d);
    // ★ボーナスは順位に出さない。曜日指定はその曜日の日だけで割る
    const rates = state.habits.filter((x) => !x.bonus).map((x) => {
      const on = entries.filter(([date]) => !isOff(x, date));
      return { x, rate: on.length ? on.filter(([, d]) => d.checks[x.name]).length / on.length : 0 };
    })
      .sort((a, b) => b.rate - a.rate);
    const rankList = (list) => h("div", { class: "rank-list" }, list.map(({ x, rate }) => h("div", { class: "rank-row" },
      h("span", { class: "label", text: x.label }), h("div", { class: "bar" }, h("span", { style: `width:${rate * 100}%` })), h("b", { text: pct(rate) }))));
    $("graph-body").replaceChildren(h("div", { class: "scroll fill stack" },
      h("div", { class: "card" },
        h("h2", {}, "日ごとの達成率 ", h("span", { class: "sub", text: `${md(barFrom)} – ${md(to)}` })),
        h("div", { class: "chart" },
          h("div", { class: "axis", "aria-hidden": "true" }, h("span", { text: "100%" }), h("span", { text: "50%" }), h("span", { text: "0%" })),
          h("div", { class: "plot" }, h("div", { class: "bars", role: "img", "aria-label": "日ごとの達成率" }, bars), h("div", { class: "labels", "aria-hidden": "true" }, labels)),
        ),
      ),
      h("div", { class: "card" }, h("h2", {}, "よくできている ", h("span", { class: "sub", text: `直近${GRAPH_DAYS}日・記録のある${days.length}日` })), rankList(rates.slice(0, 5))),
      h("div", { class: "card" }, h("h2", { text: "伸びしろ" }), rankList(rates.slice(-5).reverse())),
    ));
  }, () => todayJst() === to);
}

// ================= パーティー（DB_すがた） =================
async function renderParty() {
  const body = $("party-body");
  if (!state.data.party) body.replaceChildren(loadingEl());
  await Promise.all([loadData("party", "/api/party"), loadPlayer()]);
  if (state.view !== "party") return;
  if (state.errors.party && !state.data.party) return body.replaceChildren(h("p", { class: "err", text: state.errors.party }));
  const lv = state.data.player?.player?.level;
  const members = state.data.party.members;
  if (!members.length) return body.replaceChildren(h("p", { class: "empty-msg", text: "まだなかまがいません" }));
  swap(body, [h("div", { class: "party scroll fill" }, members.map((m) => {
    const isNow = m.kind === "しゅじんこう" && typeof lv === "number" && lv >= (m.needLv ?? 0) && lv < (m.nextLv ?? Infinity);
    return h("div", { class: "card member" },
      isNow ? h("span", { class: "now-badge", text: "いま" }) : null,
      m.image ? h("img", { src: m.image, alt: m.name, loading: "lazy" }) : h("div", { class: "noimg", text: "絵なし" }),
      h("span", { class: "mname", text: m.name }),
      h("span", { class: `tag ${m.kind === "なかま" ? "blue" : "yellow"}`, text: m.kind || "—" }),
      typeof m.needLv === "number" ? h("span", { class: "sub", text: `Lv${m.needLv}〜` }) : null,
    );
  }))], "party");
}

// ================= ギルド（DB_ギルド依頼・DB_ギルド達成記録） =================
async function renderGuild() {
  for (const b of document.querySelectorAll("#view-guild .seg button")) b.setAttribute("aria-selected", String(b.dataset.guild === state.guildTab));
  const body = $("guild-body");
  if (!state.data.guild) body.replaceChildren(loadingEl());
  await loadData("guild", "/api/guild");
  if (state.view !== "guild") return;
  if (state.errors.guild && !state.data.guild) return body.replaceChildren(h("p", { class: "err", text: state.errors.guild }));
  const { quests, reports } = state.data.guild;
  const addBtn = h("button", { type: "button", class: "primary add-report", onclick: () => openNewReport() }, "＋ ほうこく");
  if (state.guildTab === "reports") {
    const titles = Object.fromEntries(quests.map((q) => [q.id.replace(/-/g, ""), q.title]));
    return swap(body, [
      addBtn,
      reports.length
        ? h("div", { class: "list scroll fill" }, reports.map((r) => h("div", { class: "card report" },
          h("span", { class: "rnote", text: r.note || "（ひとことなし）" }),
          h("span", { class: "rmeta", text: `${jstStamp(r.date)} ・ ${(r.questIds || []).map((id) => titles[id.replace(/-/g, "")] || "依頼").join("、")}` }),
        )))
        : h("p", { class: "empty-msg", text: "まだほうこくがありません" }),
    ], "guild:reports");
  }
  const cats = ["すべて", ...Object.keys(CATEGORY_COLORS).filter((c) => quests.some((q) => q.category === c))];
  const shown = quests.filter((q) => state.guildCat === "すべて" || q.category === state.guildCat);
  swap(body, [
    addBtn,
    h("div", { class: "chips", role: "group", "aria-label": "カテゴリ" }, cats.map((c) => h("button", {
      type: "button", "aria-pressed": String(c === state.guildCat), onclick: () => { state.guildCat = c; renderGuild(); },
    }, c))),
    h("div", { class: "list scroll fill" }, shown.map(questCard)),
  ], `guild:board:${state.guildCat}`);
}

function questLocked(q) {
  return typeof q.lv === "number" && typeof q.playerLv === "number" && q.playerLv < q.lv;
}

function questCard(q) {
  const locked = questLocked(q);
  return h("button", { type: "button", class: `card quest note${locked ? " locked" : ""}`, onclick: () => openQuest(q) },
    h("span", { class: "nail", "aria-hidden": "true" }),
    h("span", { class: `rank ${q.rank || ""}`, text: q.rank || "?" }),
    h("span", { class: "qbody" },
      h("span", { class: "qtitle", text: q.title }),
      h("span", { class: "qmeta" },
        q.category ? h("span", { class: `tag ${CATEGORY_COLORS[q.category] || ""}`, text: q.category }) : null,
        h("span", { text: locked ? `Lv${q.lv}で受注` : `受注Lv${q.lv ?? "—"}` }),
        h("span", { text: `基本${q.exp ?? "—"}EXP` }),
        h("span", { text: `達成${q.count ?? 0}回` }),
      ),
      q.board ? h("span", { class: "board", text: plainMarks(q.board) }) : null,
    ),
  );
}

function openQuest(q) {
  const locked = questLocked(q);
  const count = typeof q.count === "number" ? q.count : 0;
  const note = h("textarea", { rows: "2", maxlength: "200", placeholder: "なにをしたか ひとこと", "aria-label": "ほうこくのひとこと", disabled: locked });
  const send = h("button", { type: "button", class: "primary", disabled: true }, locked ? `Lv${q.lv}になると受注できます` : "ほうこくする");
  note.addEventListener("input", () => { send.disabled = locked || !note.value.trim(); });
  send.addEventListener("click", () => submitReport([q], note.value, send));
  openSheet(q.title, [
    h("div", { class: "qmeta", style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center" },
      h("span", { class: `rank ${q.rank || ""}`, text: q.rank || "?" }),
      q.category ? h("span", { class: `tag ${CATEGORY_COLORS[q.category] || ""}`, text: q.category }) : null,
      h("span", { class: "sub", text: `受注Lv${q.lv ?? "—"} ・ 基本${q.exp ?? "—"}EXP ・ 累計${fmt(q.totalExp)}EXP` }),
    ),
    q.stages.length
      ? h("div", { class: "card" }, h("h3", { text: `だんかい（${Math.min(count, q.stages.length)}/${q.stages.length}）` }),
        h("ol", { class: "stages", style: "margin-top:8px" }, q.stages.map((s, i) => h("li", { class: i < count ? "done" : i === count ? "next" : "" },
          h("span", { class: "box" }), h("span", { text: s })))))
      : null,
    q.board ? h("div", { class: "card" }, h("h3", { text: "けいじばん" }), h("p", { class: "pre", style: "margin:6px 0 0", text: plainMarks(q.board) })) : null,
    q.detour ? h("div", { class: "card" }, h("h3", { text: "寄り道" }), h("p", { class: "pre", style: "margin:6px 0 0", text: plainMarks(q.detour) })) : null,
  ], [note, send]);
}

// ほうこくを送って、ギルドとLvを読み直す（依頼の画面と「＋ ほうこく」の共用）
async function submitReport(selected, note, send) {
  send.disabled = true;
  try {
    await api("POST", "/api/guild/reports", { questIds: selected.map((q) => q.id), note });
    toast(`ほうこくしました：${selected.map((q) => q.title).join("、")}`);
    closeSheet();
    state.loadedAt.guild = 0;
    if (state.view === "guild") renderGuild();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => enqueue(async () => {
      await Promise.all([loadData("guild", "/api/guild", { force: true }), loadPlayer({ force: true })]);
      if (state.view === "guild") renderGuild();
    }), REFRESH_DELAY);
  } catch (err) {
    toast(err.message, true);
    send.disabled = false;
  }
}

// ---------- 「＋ ほうこく」：先にひとことを書き、合う依頼を候補から選ぶ ----------
const REPORT_QUEST_MAX = 5;
const SUGGEST_COUNT = 6;

// 比べやすい形（全角半角・大文字小文字・空白や記号をそろえる）
function normText(s) {
  return (s || "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

// 2文字ずつの組（日本語は単語の区切りがないため）
function bigrams(s) {
  const t = normText(s);
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

// ひとことの2文字の組が、依頼名（重め）・段階・カテゴリにいくつ含まれるか
function questScore(noteGrams, q) {
  if (!noteGrams.size) return 0;
  const title = bigrams(q.title);
  const rest = bigrams(`${q.stages.join(" ")} ${q.category || ""}`);
  let score = 0;
  for (const g of noteGrams) score += title.has(g) ? 3 : rest.has(g) ? 1 : 0;
  return score;
}

// 書く前の並び：最近ほうこくした依頼 → それ以外（受注Lv順のまま）
function recentQuestOrder(quests, reports) {
  const rank = new Map();
  for (const r of reports) for (const id of r.questIds || []) {
    const key = id.replace(/-/g, "");
    if (!rank.has(key)) rank.set(key, rank.size);
  }
  const at = (q) => rank.get(q.id.replace(/-/g, "")) ?? Infinity;
  return [...quests].sort((a, b) => at(a) - at(b));
}

function openNewReport() {
  const { quests, reports } = state.data.guild;
  const open = quests.filter((q) => !questLocked(q));
  const recent = recentQuestOrder(open, reports);
  const selected = new Map();
  const note = h("textarea", { rows: "2", maxlength: "200", placeholder: "なにをしたか ひとこと（例：換気扇のフィルターを替えた）", "aria-label": "ほうこくのひとこと" });
  const send = h("button", { type: "button", class: "primary", disabled: true }, "ほうこくする");
  const picked = h("div", { class: "chips picked", role: "group", "aria-label": "えらんだ依頼" });
  const list = h("div", { class: "list suggest" });
  const hint = h("p", { class: "sub", style: "margin:0" });

  const update = () => { send.disabled = !note.value.trim() || !selected.size; };
  const toggle = (q) => {
    if (selected.has(q.id)) selected.delete(q.id);
    else if (selected.size < REPORT_QUEST_MAX) selected.set(q.id, q);
    else return toast(`依頼は${REPORT_QUEST_MAX}つまでです`, true);
    draw();
  };
  const draw = () => {
    const grams = bigrams(note.value);
    const scored = grams.size
      ? open.map((q) => [q, questScore(grams, q)]).filter(([, sc]) => sc > 0).sort((a, b) => b[1] - a[1]).map(([q]) => q)
      : [];
    const shown = (scored.length ? scored : recent).slice(0, SUGGEST_COUNT);
    hint.textContent = !note.value.trim() ? "最近ほうこくした依頼" : scored.length ? "ひとことに合いそうな依頼" : "合う依頼が見つからないので、最近の依頼を出しています";
    list.replaceChildren(...shown.map((q) => h("button", {
      type: "button", class: "card quest pick", "aria-pressed": String(selected.has(q.id)), onclick: () => toggle(q),
    },
      h("span", { class: `rank ${q.rank || ""}`, text: q.rank || "?" }),
      h("span", { class: "qbody" },
        h("span", { class: "qtitle", text: q.title }),
        h("span", { class: "qmeta" },
          q.category ? h("span", { class: `tag ${CATEGORY_COLORS[q.category] || ""}`, text: q.category }) : null,
          h("span", { text: `基本${q.exp ?? "—"}EXP` }),
        ),
      ),
      h("span", { class: "pick-mark", "aria-hidden": "true", text: selected.has(q.id) ? "✓" : "" }),
    )));
    picked.replaceChildren(...[...selected.values()].map((q) => h("button", {
      type: "button", "aria-pressed": "true", "aria-label": `${q.title} をはずす`, onclick: () => toggle(q),
    }, `${q.title} ×`)));
    picked.hidden = !selected.size;
    update();
  };
  let timer = null;
  note.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(draw, 150); update(); });
  send.addEventListener("click", () => submitReport([...selected.values()], note.value, send));
  openSheet("ほうこく", [note, picked, hint, list], [send]);
  draw();
  note.focus();
}

// ================= ものがたり（DB_ものがたり） =================
async function renderStory() {
  const body = $("story-body");
  if (!state.data.story) body.replaceChildren(loadingEl());
  await loadData("story", "/api/story");
  if (state.view !== "story") return;
  if (state.errors.story && !state.data.story) return body.replaceChildren(h("p", { class: "err", text: state.errors.story }));
  const chapters = state.data.story.chapters;
  const section = (kind, title) => {
    const list = chapters.filter((c) => (c.kind || "ほんぺん") === kind);
    return list.length ? [h("p", { class: "section-title", text: title }), ...list.map(chapterRow)] : [];
  };
  swap(body, [h("div", { class: "list scroll fill" }, section("ほんぺん", "ほんぺん"), section("よりみち", "よりみち"))], "story");
}

// Notion の文面の先頭の絵文字（📖 ✅ 🔒 など）は外し、代わりに彫った絵を出す
const stripEmoji = (t) => (t || "").replace(/^(?:\p{Extended_Pictographic}|\uFE0F|\s)+/u, "");

// 文中の絵文字は、木彫りの見た目に合う記号に置き換える（知らないものは消す）
const EMOJI_MARKS = { "✅": "✓", "✔": "✓", "🔒": "×", "📖": "▶", "📝": "…", "⭐": "★", "⚠": "！", "▶": "▶", "◀": "◀", "☀": "☀", "☾": "☾" };
const plainMarks = (t) => (t || "").replace(/\p{Extended_Pictographic}\uFE0F?/gu, (m) => EMOJI_MARKS[m.replace("\uFE0F", "")] ?? "").replace(/^ +/gm, "");

function chapterRow(c) {
  const art = c.locked ? "lock" : c.read ? "check" : c.kind === "よりみち" ? "sprout" : "book";
  return h("button", { type: "button", class: `card chapter${c.locked ? " locked" : ""}${c.read ? " read" : ""}`, disabled: c.locked, onclick: () => openChapter(c) },
    h("span", { class: "plaque-ico" }, carving(art)),
    h("span", { class: "cbody" },
      h("span", { class: "ctitle", text: c.title }),
      h("span", { class: "cstate", text: c.locked ? `Lv${c.unlockLv}で解放` : stripEmoji(c.state) }),
    ),
    c.read ? h("span", { class: "read-badge", text: "よんだ" }) : null,
  );
}

async function openChapter(c) {
  const toggleBtn = h("button", { type: "button", class: "primary" }, c.read ? "「よんだ」を外す" : "よんだ");
  openSheet(c.title, [loadingEl()], [toggleBtn]);
  toggleBtn.addEventListener("click", async () => {
    toggleBtn.disabled = true;
    try {
      const { chapter } = await api("PATCH", `/api/story/${c.id}`, { read: !c.read });
      Object.assign(c, chapter);
      toast(chapter.read ? "よんだ を付けました" : "よんだ を外しました");
      closeSheet();
      renderStory();
    } catch (err) {
      toast(err.message, true);
      toggleBtn.disabled = false;
    }
  });
  try {
    const { blocks } = await api("GET", `/api/story/${c.id}`);
    if ($("sheet").hidden || $("sheet-title").textContent !== c.title) return;
    $("sheet-body").replaceChildren(h("div", { class: "reader" }, blocks.length
      ? blocks.map((b) => (b.type === "quote" ? h("blockquote", { text: b.text }) : b.type === "heading" ? h("h3", { text: b.text }) : h("p", { text: b.text })))
      : h("p", { class: "sub", text: "本文がありません" })));
    $("sheet-body").scrollTop = 0;
  } catch (err) {
    $("sheet-body").replaceChildren(h("p", { class: "err", text: err.message }));
  }
}

// ================= きろく（DB_プレイヤー） =================
async function renderMe() {
  const body = $("me-body");
  if (!state.data.player) body.replaceChildren(loadingEl());
  await Promise.all([loadPlayer(), loadData("party", "/api/party")]);
  if (state.view !== "me") return;
  const p = state.data.player?.player;
  if (!p) return body.replaceChildren(h("p", { class: "err", text: state.errors.player || "読み込めませんでした" }));
  const lv = p.level;
  const me = (state.data.party?.members || []).find((m) => m.kind === "しゅじんこう" && typeof lv === "number" && lv >= (m.needLv ?? 0) && lv < (m.nextLv ?? Infinity));
  const parts = [["習慣", p.habitExp], ["タスク", p.taskExp], ["ギルド", p.guildExp]].filter(([, v]) => typeof v === "number");
  const max = Math.max(1, ...parts.map(([, v]) => v));
  const textCard = (title, value) => (value ? h("div", { class: "card" }, h("h3", { text: title }), h("p", { class: "pre", style: "margin:6px 0 0", text: String(value) })) : null);
  swap(body, [h("div", { class: "scroll fill stack" },
    h("div", { class: "card hero" },
      me?.image ? h("img", { src: me.image, alt: me.name }) : h("div", { class: "noimg" }),
      h("div", { class: "stack", style: "gap:2px;flex:1;min-width:0" },
        h("span", { class: "sub", text: me?.name || "" }),
        h("span", { style: "font-size:17px;font-weight:700", text: p.name || "プレイヤー" }),
        h("span", { class: "lvbig", text: `Lv${lv ?? "—"}` }),
        h("span", { class: "sub", text: `総EXP ${fmt(p.totalExp)} ・ 次のLvまで ${fmt(p.toNext)}` }),
      ),
    ),
    parts.length ? h("div", { class: "card stack", style: "gap:6px" }, h("h3", { text: "EXPのうちわけ" }),
      parts.map(([label, v]) => h("div", { class: "rank-row" }, h("span", { class: "label", text: label }), h("div", { class: "bar" }, h("span", { style: `width:${(v / max) * 100}%` })), h("b", { text: fmt(v) })))) : null,
    // 習慣EXPは読めてタスクEXPだけ空 ＝ インテグレーションが DB_タスク管理 に未接続（Lvがタスク分だけ低く出る）
    typeof p.habitExp === "number" && p.taskExp == null
      ? h("p", { class: "err", text: "タスクEXPが読めません。Notion の DB_タスク管理 に「習慣チェック」を接続すると、Lv にタスクの分が入ります" })
      : null,
    textCard("ステータス", p.status),
    textCard("なかま", p.party),
    textCard("じゅもん", p.spell),
    p.url ? h("a", { class: "link", href: p.url, target: "_blank", rel: "noopener", style: "text-align:center" }, "Notionで開く") : null,
  )], "me");
}

// ---------- シート ----------
let lastFocus = null;
function openSheet(title, bodyNodes, footNodes = []) {
  lastFocus = document.activeElement;
  $("sheet-title").textContent = title;
  $("sheet-body").replaceChildren(...bodyNodes.filter(Boolean));
  $("sheet-foot").replaceChildren(...footNodes);
  $("sheet").hidden = false;
  $("sheet-close").focus();
}
function closeSheet() {
  $("sheet").hidden = true;
  lastFocus?.focus?.();
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
  start();
});
$("logout").addEventListener("click", () => {
  memoryKey = "";
  setKey("");
  state.data = {};
  state.ranges.clear();
  showLogin();
});
$("refresh").addEventListener("click", () => {
  state.loadedAt = {};
  state.ranges.clear();
  show();
  loadDay({ quiet: true });
});
for (const b of document.querySelectorAll("#bottom-nav button")) {
  b.addEventListener("click", () => { state.view = b.dataset.view; show(); });
}
for (const b of document.querySelectorAll("#habit-tabs button")) {
  b.addEventListener("click", () => { state.tab = b.dataset.tab; show(); });
}
for (const b of document.querySelectorAll("#view-guild .seg button")) {
  b.addEventListener("click", () => { state.guildTab = b.dataset.guild; renderGuild(); });
}
$("prev").addEventListener("click", () => { state.date = addDays(state.date, -1); state.row = null; loadDay(); });
$("next").addEventListener("click", () => { state.date = addDays(state.date, 1); state.row = null; loadDay(); });
$("go-today").addEventListener("click", () => { state.date = todayJst(); state.row = null; loadDay(); });
$("week-prev").addEventListener("click", () => { state.weekStart = addDays(state.weekStart, -7); renderWeek(); });
$("week-next").addEventListener("click", () => { state.weekStart = addDays(state.weekStart, 7); renderWeek(); });
$("month-prev").addEventListener("click", () => { state.month = shiftMonth(state.month, -1); renderCal(); });
$("month-next").addEventListener("click", () => { state.month = shiftMonth(state.month, 1); renderCal(); });
$("sheet-close").addEventListener("click", closeSheet);
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });

// アプリに戻ってきたとき、日付が変わっていれば今日に合わせて取り直す
let lastToday = todayJst();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !memoryKey) return;
  const t = todayJst();
  if (t !== lastToday) {
    lastToday = t;
    state.date = t;
    state.weekStart = mondayOf(t);
    state.month = t.slice(0, 7);
    state.row = null;
    state.ranges.clear();
    show();
    loadDay();
  } else {
    enqueue(() => loadDay({ quiet: true }));
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

function start() {
  show();
  if (!memoryKey) return;
  loadDay();
  loadPlayer();
}
start();
