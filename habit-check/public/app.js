// 習慣チェック（画面側）。Notion へは必ず Worker の /api を経由する。
// 習慣ページの5つのタブ（習慣チェック・パーティー・ギルド・ものがたり・きろく）と、あいぼうを1画面ずつで見せる。
import { renderPet, renderMonster, renderItem, fillStory, petLine, petName, evolveStory, SLEEP_LINES, TYPE_COLORS } from "./aibou.js";

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
const VIEW_TITLES = { habit: "習慣チェック", aibou: "あいぼう", battle: "ぼうけん", guild: "ギルド", story: "ものがたり", me: "きろく" };
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
  for (const id of ["day", "week", "cal", "graph", "aibou", "battle", "guild", "story", "me"]) $(`view-${id}`).hidden = id !== viewId;
  for (const b of document.querySelectorAll("#bottom-nav button")) {
    b.setAttribute("aria-current", b.dataset.view === state.view ? "page" : "false");
  }
  for (const b of document.querySelectorAll("#habit-tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === state.tab));
  renderHeader();
  ({ day: renderDay, week: renderWeek, cal: renderCal, graph: renderGraph, aibou: renderAibou, battle: renderBattle, guild: renderGuild, story: renderStory, me: renderMe })[viewId]();
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
    state.row = data.row;
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
  const slotEl = (g, cols) => h("div", { class: `slot${g.slot === now ? " now" : ""}`, style: `--cols:${cols};flex-grow:${cols}` },
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

function habitTile(x, row, canEdit) {
  const off = isOff(x, state.date);
  const hint = off ? "今日はお休み（数えない）" : x.hint;
  const btn = h("button", { type: "button", class: `habit${off ? " off" : ""}${x.bonus ? " bonus" : ""}`, "aria-pressed": String(!!row.checks[x.name]), disabled: !canEdit },
    h("span", { class: "box" }),
    h("span", { class: "text" },
      h("span", { class: "name" },
        x.must ? h("span", { class: "must-mark", title: "必ず", text: "◆" }) : null,
        x.bonus ? h("span", { class: "bonus-mark", title: "ボーナス（達成率に数えない）", text: "★" }) : null,
        x.label),
      hint ? h("span", { class: "hint", text: hint }) : null),
  );
  btn.addEventListener("click", () => {
    btn.classList.add("pending");
    toggleCheck(row, state.date, x, !row.checks[x.name], () => btn.classList.remove("pending"));
  });
  return btn;
}

function noteRow(row) {
  const input = h("input", { type: "text", id: "note", maxlength: "2000", placeholder: "ひとこと（その他のできたこと・+5EXP）", "aria-label": "ひとこと" });
  input.value = row.note;
  const save = h("button", { type: "button", class: "primary", disabled: true }, "保存");
  input.addEventListener("input", () => { save.disabled = input.value === state.savedNote; });
  save.addEventListener("click", () => saveNote(row, input, save));
  return h("div", { class: "note-row" }, input, save);
}

// チェックの付け外し（日・週どちらからでも）。画面は先に変え、失敗したら戻す
function toggleCheck(row, date, habit, next, done) {
  setCheck(row.id, habit.name, next);
  rerenderHabit();
  if (next && navigator.vibrate) navigator.vibrate(10);
  enqueue(async () => {
    try {
      const { row: updated } = await api("PATCH", `/api/pages/${row.id}`, { name: habit.name, value: next });
      if (state.row?.id === updated.id) state.row.stats = updated.stats;
      toast(next ? `✓ ${habit.label}` : `${habit.label} を外しました`);
      if (next) aibouPop(habit);
      // あいぼう・ボスへのダメージが変わったので、次に開いたとき読み直す
      for (const k of ["aibou", "battle"]) if (state.loadedAt[k]) state.loadedAt[k] = 0;
      scheduleRefresh();
    } catch (err) {
      setCheck(row.id, habit.name, !next);
      toast(`保存できませんでした：${err.message}`, true);
    } finally {
      done?.();
      rerenderHabit();
    }
  });
}

function setCheck(rowId, name, value) {
  if (state.row?.id === rowId) state.row.checks[name] = value;
  for (const r of state.ranges.values()) {
    for (const day of Object.values(r.days || {})) if (day.id === rowId) day.checks[name] = value;
  }
}

function rerenderHabit() {
  if (state.view === "habit") show();
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
  refreshTimer = setTimeout(() => enqueue(async () => {
    await loadPlayer({ force: true });
    if (state.view === "habit" && state.tab === "day") await loadDay({ quiet: true });
  }), REFRESH_DELAY);
}

// ================= 習慣：週・カレンダー・グラフ（期間まとめ読み） =================
async function getRange(from, to) {
  const key = `${from}|${to}`;
  const hit = state.ranges.get(key);
  if (hit && Date.now() - hit.at < STALE_MS) return hit;
  const data = await api("GET", `/api/range?from=${from}&to=${to}`);
  if (data.habits?.length) state.habits = data.habits;
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

// ================= パーティー（DB_すがた）：きろくの中に出す =================
function partyGrid(members, lv) {
  if (!members?.length) return null;
  return h("div", { class: "party" }, members.map((m) => {
    const isNow = m.kind === "しゅじんこう" && typeof lv === "number" && lv >= (m.needLv ?? 0) && lv < (m.nextLv ?? Infinity);
    return h("div", { class: "card member" },
      isNow ? h("span", { class: "now-badge", text: "いま" }) : null,
      m.image ? h("img", { src: m.image, alt: m.name, loading: "lazy" }) : h("div", { class: "noimg", text: "絵なし" }),
      h("span", { class: "mname", text: m.name }),
      h("span", { class: `tag ${m.kind === "なかま" ? "blue" : "yellow"}`, text: m.kind || "—" }),
      typeof m.needLv === "number" ? h("span", { class: "sub", text: `Lv${m.needLv}〜` }) : null,
    );
  }));
}

// ================= ぼうけん（章ボス・モンスター） =================
const WEAK_LABEL = { ちから: "ちから", かしこさ: "かしこさ", やさしさ: "やさしさ", しっかり: "しっかり", バランス: "4つすべて" };

async function renderBattle() {
  const body = $("battle-body");
  if (!state.data.battle) body.replaceChildren(loadingEl());
  const [data] = await Promise.all([loadData("battle", "/api/battle"), loadData("items", "/api/items")]);
  if (state.view !== "battle") return;
  if (!data) return body.replaceChildren(h("p", { class: "err", text: state.errors.battle || "読み込めませんでした" }));
  // ボスを倒したら、ものがたりの一覧も読み直す（次の話が開く）
  if (data.boss?.defeatedOn) state.loadedAt.story = 0;
  swap(body, [h("div", { class: "scroll fill stack" },
    bossCard(data),
    equipCard(data),
    h("div", { class: "card stack", style: "gap:8px" },
      h("div", { class: "kv" }, h("h3", { text: "モンスター（まだ終わっていないタスク）" }), h("b", { text: `${data.monsters.length}${data.moreMonsters ? "+" : ""}体` })),
      h("p", { class: "sub", style: "margin:0", text: "古いほど凶暴（★）。たおすと ★1つにつき ボスへのダメージ＋20%" }),
      data.monsters.length
        ? h("div", { class: "monsters" }, data.monsters.map(monsterTile))
        : h("p", { class: "sub", text: "モンスターはいません" }),
    ),
  )], "battle");
}

function bossCard(data) {
  const b = data.boss;
  if (!b) {
    return h("div", { class: "card boss-card" },
      h("h2", { text: data.cleared ? "すべてのボスを たおした！" : "いまは しずか……" }),
      h("p", { class: "sub", text: data.next ? `ものがたり「${data.next.title}」を読むと、ボスが現れます。` : "ものがたりの続きを待っています。" }),
      data.next ? h("button", { type: "button", class: "primary", onclick: () => { state.view = "story"; show(); } }, "ものがたりへ") : null,
    );
  }
  const left = Math.max(0, b.hp - b.damage);
  const pet = data.pet;
  const won = !!b.defeatedOn;
  const sprite = renderMonster("boss", BOSS_COLORS[b.weak] || BOSS_COLORS.バランス, { size: 120, motion: won ? "defeated" : "idle" });
  return h("div", { class: `card boss-card${won ? " won" : ""}` },
    h("span", { class: "sub", text: b.chapter }),
    h("h2", { class: "boss-name", text: b.name }),
    sprite,
    h("div", { class: "kv" }, h("span", { text: "HP" }), h("b", { text: `${fmt(left)} / ${fmt(b.hp)}` })),
    h("div", { class: "bar hp", style: "flex:none" }, h("span", { style: `width:${(left / b.hp) * 100}%` })),
    h("div", { class: "boss-tags" },
      h("span", { class: "pet-stage", style: `--chip:${TYPE_COLORS[b.weak] || "#a58bd0"}`, text: `じゃくてん：${WEAK_LABEL[b.weak] || b.weak || "—"}` }),
      b.petHit ? h("span", { class: "pet-stage", style: "--chip:#d9822b", text: `${pet?.name || "あいぼう"}：こうかばつぐん` }) : null,
      h("span", { class: "sub", text: `ダメージ×${b.mult}` }),
    ),
    won
      ? h("p", { class: "win", text: `${b.name}を たおした！ つぎの話が 開きました` })
      : h("p", { class: "sub", style: "margin:0", text: `きょうのダメージ ${fmt(b.today)}（${b.start.slice(5).replace("-", "/")}から たたかっている）` }),
    won && data.next ? h("button", { type: "button", class: "primary", onclick: () => { state.view = "story"; show(); } }, "つぎの話を読む") : null,
    b.log.length ? h("div", { class: "battle-log" }, b.log.map((x) => h("div", { class: "log-row" },
      x.kind === "task" ? renderMonster(x.shape, x.colors, { size: 28 }) : h("span", { class: "log-icon", text: "✓" }),
      h("span", { class: "log-text", text: x.kind === "task" ? `${x.name}${"★".repeat(x.stars)}（${x.title}）を たおした` : `${x.date.slice(5).replace("-", "/")} 習慣` }),
      h("b", { text: `${fmt(x.damage)}` })))) : null,
  );
}

// ---------- そうび（DB_そうび） ----------
const SLOT_NAMES = ["武器", "かぶと", "たて", "よろい", "アクセサリー"];
const stars = (n) => "★".repeat(n || 0);

function equipCard(battle) {
  const data = state.data.items;
  if (!data) {
    return h("div", { class: "card stack", style: "gap:4px" }, h("h3", { text: "そうび" }),
      h("p", { class: "sub", style: "margin:0", text: state.errors.items || "読み込み中…" }));
  }
  const bonus = Object.entries(battle?.equip || {}).filter(([, v]) => v).map(([t, v]) => `${t}＋${Math.round(v * 10) / 10}%`).join("　");
  return h("div", { class: "card stack", style: "gap:6px" },
    h("div", { class: "kv" }, h("h3", { text: "そうび" }), h("span", { class: "sub", text: `もちもの ${data.items.length}こ` })),
    h("p", { class: "sub", style: "margin:0", text: bonus ? `ボスへのダメージ：${bonus}` : "ギルドで ほうこくすると、そうびが落ちます" }),
    SLOT_NAMES.map((slot) => {
      const it = data.items.find((x) => x.slot === slot && x.equipped);
      const have = data.items.filter((x) => x.slot === slot).length;
      return h("button", { type: "button", class: "equip-row", onclick: () => openSlot(slot) },
        it ? renderItem(slot, it.rarity, { size: 32 }) : h("span", { class: "item-icon empty" }),
        h("span", { class: "equip-slot", text: slot }),
        h("span", { class: "equip-name", text: it ? `${it.name} ${stars(it.rarity)}` : have ? "なし（タップで そうび）" : "なし" }),
        it ? h("b", { text: `${it.type}＋${it.type === "ぜんぶ" ? it.effect / 2 : it.effect}%` }) : null,
      );
    }),
  );
}

function openSlot(slot) {
  const render = () => {
    const list = (state.data.items?.items || []).filter((x) => x.slot === slot)
      .sort((a, b) => (b.rarity || 0) - (a.rarity || 0) || String(b.date).localeCompare(String(a.date)));
    if (!list.length) return [h("p", { class: "sub", text: "この部位のそうびは、まだありません。" })];
    return list.map((it) => h("div", { class: `item-row${it.equipped ? " on" : ""}` },
      renderItem(slot, it.rarity, { size: 40 }),
      h("span", { class: "item-text" },
        h("b", { text: it.name }),
        h("span", { class: "sub", text: `${stars(it.rarity)}${it.crit ? " かいしん" : ""}　${it.type}＋${it.type === "ぜんぶ" ? `${it.effect / 2}%（4つすべて）` : `${it.effect}%`}　${(it.date || "").slice(5).replace("-", "/")}` })),
      h("button", { type: "button", class: it.equipped ? "chip-btn" : "primary small", onclick: (e) => equip(it, !it.equipped, e.currentTarget) }, it.equipped ? "はずす" : "そうびする"),
    ));
  };
  const equip = async (it, on, btn) => {
    btn.disabled = true;
    try {
      state.data.items = await api("PATCH", `/api/items/${it.id}`, { equipped: on });
      state.loadedAt.items = Date.now();
      state.loadedAt.battle = 0;
      $("sheet-body").replaceChildren(...render());
      toast(on ? `${it.name} を そうびした` : `${it.name} を はずした`);
      if (state.view === "battle") renderBattle();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  };
  openSheet(`そうび：${slot}`, render());
}

function showDrops(drops) {
  openSheet("アイテムを てにいれた！", drops.map((it) => h("div", { class: "item-row drop" },
    renderItem(it.slot, it.rarity, { size: 56 }),
    h("span", { class: "item-text" },
      h("b", { text: `${it.name} ${stars(it.rarity)}` }),
      h("span", { class: "sub", text: `${it.crit ? "かいしんドロップ！　" : ""}${it.slot}・${it.type}＋${it.type === "ぜんぶ" ? `${it.effect / 2}%（4つすべて）` : `${it.effect}%`}` }),
      h("span", { class: "sub", text: `「${it.quest}」から` })),
  )), [h("button", { type: "button", class: "primary", onclick: () => { closeSheet(); state.view = "battle"; show(); } }, "そうびを みる")]);
}

const BOSS_COLORS = {
  ちから: ["#e0603a", "#a93f22", "#ffc2a8"],
  かしこさ: ["#5b7fd6", "#3a56a0", "#c8d6ff"],
  やさしさ: ["#e2789e", "#b04e72", "#ffd6e4"],
  しっかり: ["#4f9a6a", "#33704a", "#c6ecd2"],
  バランス: ["#bba7e8", "#8a73bd", "#f1eaff"],
};

function monsterTile(m) {
  const el = h("button", { type: "button", class: "monster-tile", onclick: () => openMonster(m) },
    renderMonster(m.shape, m.colors, { size: 44 }),
    h("span", { class: "mname", text: m.name }),
    m.stars ? h("span", { class: "stars", text: "★".repeat(m.stars) }) : null,
  );
  return el;
}

function openMonster(m) {
  openSheet(m.name, [
    h("div", { class: "pet-box" }, renderMonster(m.shape, m.colors, { size: 120 })),
    h("p", { style: "margin:0;font-weight:700", text: m.title || "（名前なし）" }),
    h("div", { class: "kv" }, h("span", { text: "ステータス" }), h("b", { text: m.status || "—" })),
    h("div", { class: "kv" }, h("span", { text: "重さ" }), h("b", { text: m.weight })),
    h("div", { class: "kv" }, h("span", { text: "凶暴さ" }), h("b", { text: m.stars ? `${"★".repeat(m.stars)}（${m.ageDays}日め）` : `ふつう（${m.ageDays}日め）` })),
    h("p", { class: "sub", text: "Notion で DONE にすると たおせます。" }),
  ], m.url ? [h("a", { class: "primary", href: m.url, target: "_blank", rel: "noopener", style: "text-align:center;text-decoration:none;display:block;padding:12px" }, "Notionで開く")] : []);
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
  return h("button", { type: "button", class: `card quest${locked ? " locked" : ""}`, onclick: () => openQuest(q) },
    h("span", { class: `rank ${q.rank || ""}`, text: q.rank || "?" }),
    h("span", { class: "qbody" },
      h("span", { class: "qtitle", text: q.title }),
      h("span", { class: "qmeta" },
        q.category ? h("span", { class: `tag ${CATEGORY_COLORS[q.category] || ""}`, text: q.category }) : null,
        h("span", { text: locked ? `Lv${q.lv}で受注` : `受注Lv${q.lv ?? "—"}` }),
        h("span", { text: `基本${q.exp ?? "—"}EXP` }),
        h("span", { text: `達成${q.count ?? 0}回` }),
      ),
      q.board ? h("span", { class: "board", text: q.board }) : null,
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
    q.board ? h("div", { class: "card" }, h("h3", { text: "けいじばん" }), h("p", { class: "pre", style: "margin:6px 0 0", text: q.board })) : null,
    q.detour ? h("div", { class: "card" }, h("h3", { text: "寄り道" }), h("p", { class: "pre", style: "margin:6px 0 0", text: q.detour })) : null,
  ], [note, send]);
}

// ほうこくを送って、ギルドとLvを読み直す（依頼の画面と「＋ ほうこく」の共用）
async function submitReport(selected, note, send) {
  send.disabled = true;
  try {
    const { drops = [] } = await api("POST", "/api/guild/reports", { questIds: selected.map((q) => q.id), note });
    toast(`ほうこくしました：${selected.map((q) => q.title).join("、")}`);
    if (drops.length) {
      state.loadedAt.items = 0;
      setTimeout(() => showDrops(drops), 1700);
    }
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
  swap(body, [h("div", { class: "list scroll fill" },
    section("エピソード2", "エピソード2　ツヅキの帝国"),
    section("ほんぺん", "エピソード1　霧の国"),
    section("よりみち", "よりみち"))], "story");
}

function chapterRow(c) {
  return h("button", { type: "button", class: `card chapter${c.locked ? " locked" : ""}`, disabled: c.locked, onclick: () => openChapter(c) },
    h("span", { class: "cbody" },
      h("span", { class: "ctitle", text: c.title }),
      h("span", { class: "cstate", text: c.locked ? (c.kind === "エピソード2" ? "前の話のボスを倒すと開く" : `Lv${c.unlockLv}で解放`) : c.state || "" }),
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
      state.loadedAt.battle = 0;
      // エピソード2 の話を読んだら、ボス戦へ
      if (chapter.read && chapter.kind === "エピソード2" && chapter.boss && !chapter.defeated) {
        state.view = "battle";
        show();
        return;
      }
      renderStory();
    } catch (err) {
      toast(err.message, true);
      toggleBtn.disabled = false;
    }
  });
  try {
    const [{ blocks }, pet] = await Promise.all([api("GET", `/api/story/${c.id}`), storyPet()]);
    if ($("sheet").hidden || $("sheet-title").textContent !== c.title) return;
    const t = (s) => fillStory(s, pet);
    $("sheet-body").replaceChildren(h("div", { class: "reader" }, blocks.length
      ? blocks.map((b) => (b.type === "quote" ? h("blockquote", { text: t(b.text) }) : b.type === "heading" ? h("h3", { text: t(b.text) }) : h("p", { text: t(b.text) })))
      : h("p", { class: "sub", text: "本文がありません" })));
    $("sheet-body").scrollTop = 0;
  } catch (err) {
    $("sheet-body").replaceChildren(h("p", { class: "err", text: err.message }));
  }
}

// 本文の {あいぼう} などに入れる、あいぼうの名前・段階・型（読めなければ「たまご」として出す）
async function storyPet() {
  const data = await loadData("aibou", "/api/aibou");
  return data?.pet || null;
}

// ================= きろく（DB_プレイヤー） =================
async function renderMe() {
  const body = $("me-body");
  if (!state.data.player) body.replaceChildren(loadingEl());
  await Promise.all([loadPlayer(), loadData("party", "/api/party"), loadData("battle", "/api/battle")]);
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
    statsCard(state.data.battle?.stats),
    textCard("ステータス", p.status),
    textCard("なかま", p.party),
    textCard("じゅもん", p.spell),
    state.data.party?.members?.length ? h("h3", { class: "section-title", text: "パーティー" }) : null,
    partyGrid(state.data.party?.members, lv),
    p.url ? h("a", { class: "link", href: p.url, target: "_blank", rel: "noopener", style: "text-align:center" }, "Notionで開く") : null,
  )], "me");
}

// さとしの能力値（これまでの全EXPを4つの型に振り分け。ボスの弱点と同じ能力値が高いほどダメージが少し増える）
function statsCard(stats) {
  if (!stats) return null;
  const max = Math.max(1, ...Object.values(stats));
  return h("div", { class: "card stack", style: "gap:6px" }, h("h3", { text: "のうりょく" }),
    Object.entries(stats).map(([t, v]) => h("div", { class: "rank-row" },
      h("span", { class: "label", text: t }),
      h("div", { class: "bar", style: `--fill:${TYPE_COLORS[t]}` }, h("span", { style: `width:${(v / max) * 100}%` })),
      h("b", { text: fmt(v) }))));
}

// ================= あいぼう（DB_あいぼう） =================
// 最後に見た段階・型をこの端末に覚えておき、変わっていたら進化の演出を出す（習慣チェック時の小さな表示にも使う）
const AIBOU_MEMO = "habit-check:aibou";
function aibouMemo() {
  try { return JSON.parse(localStorage.getItem(AIBOU_MEMO) || "null"); } catch { return null; }
}
function setAibouMemo(v) {
  try { localStorage.setItem(AIBOU_MEMO, JSON.stringify(v)); } catch { /* 保存できない端末では演出を出さないだけ */ }
}

function stageLabel(pet) {
  return pet.type ? `${pet.stage}・${pet.type}` : pet.stage;
}

// たまごのひび：次の段階までの進み具合で 0〜2
function crackOf(data) {
  if (data.pet.stage !== "たまご" || !data.next) return 0;
  const p = (data.exp - data.from) / (data.next.at - data.from);
  return p >= 0.85 ? 2 : p >= 0.5 ? 1 : 0;
}

async function renderAibou() {
  const body = $("aibou-body");
  if (!state.data.aibou) body.replaceChildren(loadingEl());
  const data = await loadData("aibou", "/api/aibou");
  if (state.view !== "aibou") return;
  if (!data) return body.replaceChildren(h("p", { class: "err", text: state.errors.aibou || "読み込めませんでした" }));
  if (!data.pet) return swap(body, [eggOffer()], "aibou:none");

  const pet = data.pet;
  const memo = aibouMemo();
  setAibouMemo({ stage: pet.stage, type: pet.type });
  const evolving = memo && memo.stage !== pet.stage;
  const sleeping = pet.stage !== "たまご" && !data.today;
  const motion = sleeping ? "sleep" : "idle";
  const bubble = h("p", { class: "bubble", text: sleeping ? pick1(SLEEP_LINES) : petLine(pet.stage, pet.type) });
  const box = h("div", { class: "pet-box" });
  const story = h("p", { class: "evolve-story", hidden: true });

  const showPet = (m) => {
    const el = renderPet(pet.stage, pet.type, m, { crack: crackOf(data) });
    el.addEventListener("click", () => {
      el.play("happy");
      bubble.textContent = pet.stage === "たまご" ? petLine("たまご") : petLine(pet.stage, pet.type);
      if (navigator.vibrate) navigator.vibrate(8);
    });
    box.replaceChildren(el);
  };
  if (evolving) {
    // 前のすがたが光に包まれて、新しいすがたに入れ替わる
    const old = renderPet(memo.stage, memo.type, memo.stage === "たまご" ? "hatch" : "evolve", { crack: 2 });
    box.replaceChildren(old);
    box.classList.add("flash");
    bubble.textContent = memo.stage === "たまご" ? "……ぴしっ！？" : "……！？";
    setTimeout(() => {
      showPet("happy");
      story.textContent = evolveStory(pet.stage, pet.type, pet.name);
      story.hidden = false;
      bubble.textContent = petLine(pet.stage, pet.type);
      if (pet.stage !== "たまご" && !pet.name) setTimeout(askPetName, 1400);
    }, 1500);
  } else {
    showPet(motion);
    if (pet.stage !== "たまご" && !pet.name) setTimeout(askPetName, 600);
  }

  const next = data.next;
  const gauge = next ? Math.max(0, Math.min(1, (data.exp - data.from) / (next.at - data.from))) : 1;
  const points = pet.stage === "成体" ? data.points : data.period;
  const max = Math.max(1, ...Object.values(points));
  const periodTitle = { たまご: "たまごの あいだの傾向", 幼体: "いまの傾向（成長期の すがたが きまる）", 成長期: "いまの傾向（成体の すがたが きまる）", 成体: "これまでの傾向" }[pet.stage];

  swap(body, [h("div", { class: "scroll fill stack" },
    h("div", { class: "card pet-card" },
      h("div", { class: "pet-head" },
        h("b", { class: "pet-name", text: pet.stage === "たまご" ? "たまご" : pet.name || petName(pet.stage, pet.type) }),
        h("span", { class: "pet-stage", style: pet.type && TYPE_COLORS[pet.type] ? `--chip:${TYPE_COLORS[pet.type]}` : null, text: stageLabel(pet) }),
        pet.stage !== "たまご" ? h("button", { type: "button", class: "chip-btn", onclick: askPetName }, "なまえ") : null,
      ),
      box,
      story,
      bubble,
    ),
    h("div", { class: "card stack", style: "gap:6px" },
      h("div", { class: "kv" },
        h("span", { text: next ? `${next.stage === "幼体" ? "孵化" : next.stage}まで` : "さいごの すがた" }),
        h("b", { text: next ? `あと ${fmt(Math.max(0, next.at - data.exp))} EXP` : `総EXP ${fmt(data.exp)}` })),
      h("div", { class: "bar", style: "flex:none" }, h("span", { style: `width:${gauge * 100}%` })),
    ),
    h("div", { class: "card stack", style: "gap:6px" },
      h("h3", { text: periodTitle }),
      Object.entries(points).map(([t, v]) => h("div", { class: "rank-row" },
        h("span", { class: "label", text: t }),
        h("div", { class: "bar", style: `--fill:${TYPE_COLORS[t]}` }, h("span", { style: `width:${(v / max) * 100}%` })),
        h("b", { text: fmt(v) }))),
    ),
    h("div", { class: "card stack", style: "gap:4px" },
      h("div", { class: "kv" }, h("span", { text: "たんじょうび" }), h("b", { text: pet.birthday || "—" })),
      h("div", { class: "kv" }, h("span", { text: "これまでのEXP" }), h("b", { text: fmt(data.exp) })),
      h("div", { class: "kv" }, h("span", { text: "きょうのEXP" }), h("b", { text: fmt(data.today) })),
      pet.history ? h("p", { class: "sub", style: "margin:4px 0 0", text: pet.history }) : null,
    ),
  )], `aibou:${pet.stage}:${pet.type}`);
}

function pick1(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function eggOffer() {
  const btn = h("button", { type: "button", class: "primary" }, "たまごを うけとる");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      state.data.aibou = await api("POST", "/api/aibou");
      state.loadedAt.aibou = Date.now();
      setAibouMemo({ stage: "たまご", type: null });
      renderAibou();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  });
  return h("div", { class: "card pet-card" },
    h("h2", { text: "ふしぎな たまごを みつけた" }),
    h("div", { class: "pet-box" }, renderPet("たまご", null, "idle")),
    h("p", { class: "sub", text: "習慣のチェックとタスクのDONEで育ちます。やったことの傾向で、すがたが かわります。おなかが すいたり、弱ったりは しません。" }),
    btn,
  );
}

function askPetName() {
  const pet = state.data.aibou?.pet;
  if (!pet || !$("sheet").hidden) return;
  const input = h("input", { type: "text", maxlength: "20", placeholder: petName(pet.stage, pet.type), "aria-label": "なまえ" });
  input.value = pet.name || "";
  const save = h("button", { type: "button", class: "primary" }, "これにする");
  save.addEventListener("click", async () => {
    const name = input.value.trim() || petName(pet.stage, pet.type);
    save.disabled = true;
    try {
      const res = await api("PATCH", "/api/aibou", { name });
      pet.name = res.pet.name;
      closeSheet();
      toast(`${pet.name} に なりました`);
      if (state.view === "aibou") renderAibou();
    } catch (err) {
      toast(err.message, true);
      save.disabled = false;
    }
  });
  openSheet(pet.name ? "なまえを かえる" : "なまえを つけよう", [
    h("p", { class: "sub", text: "あいぼうの なまえを きめてください（20字まで）。" }),
    input,
  ], [save]);
  input.focus();
}

// 習慣をチェックしたとき、あいぼうが小さく出てきて喜ぶ
function aibouPop(habit) {
  const memo = aibouMemo();
  if (!memo || !habit.aibou) return;
  const { exp, type } = habit.aibou;
  const pop = h("div", { class: "aibou-pop", "aria-hidden": "true" },
    renderPet(memo.stage, memo.type, "happy", { size: 44 }),
    h("span", { class: "pop-text", style: type ? `--chip:${TYPE_COLORS[type]}` : null, text: `あいぼう ＋${exp}${type ? ` ${type}` : ""}` }));
  document.querySelector(".aibou-pop")?.remove();
  document.body.append(pop);
  setTimeout(() => pop.remove(), 1900);
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
