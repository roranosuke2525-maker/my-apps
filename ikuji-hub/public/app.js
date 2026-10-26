// 育児ハブ：Notion の育児まわり（タスク・しらべた・育児メモ・申請）と、カレンダーの育児の予定をまとめて見る。
// /api は mcp-api.js（アーティファクト版）か Worker が答える。
const SRC = {
  task: { label: "やること", short: "タスク" },
  ref: { label: "しらべた", short: "しらべ" },
  memo: { label: "育児メモ", short: "メモ" },
  aid: { label: "申請", short: "申請" },
};
// 棚：育児メモは分類タグで、ほかは名前の言葉で振り分ける（上から順に最初に当たった棚）
const SHELVES = [
  { key: "food", label: "離乳食・ミルク", icon: "🍼", hue: "#fde7c8", tags: ["授乳/ミルク", "搾乳", "離乳食"], re: /離乳食|ミルク|授乳|ごはん|ブレンダー|だし/ },
  { key: "body", label: "からだ・医療", icon: "🩺", hue: "#d9f0e4", tags: ["検診", "予防接種", "体調/発熱", "医療", "母体"], re: /予防接種|接種|健診|検診|病院|医療|発熱|体幹|肌|湿疹|ボディソープ|現状把握/ },
  { key: "care", label: "お世話・ねんね", icon: "🌙", hue: "#e4e0fb", tags: ["おむつ", "沐浴", "抱っこ", "寝かしつけ"], re: /おむつ|沐浴|抱っこ|抱き|寝かし|布団|ベッド|見守り|ドライヤー|ぐずる/ },
  { key: "play", label: "あそび・本", icon: "🎈", hue: "#fbe0ec", tags: ["遊び", "絵本/歌", "おもちゃ", "本"], re: /絵本|おもちゃ|ピアノ|読む|本$|プレイ/ },
  { key: "out", label: "保育園・おでかけ", icon: "🏰", hue: "#dbe6fb", tags: ["お出かけ", "保育園準備", "行事"], re: /保育園|ベビーカー|チャイルドシート|おでかけ|お出かけ/ },
  { key: "money", label: "手続き・お金", icon: "🪙", hue: "#fff0c4", tags: [], re: /マイナンバー|お祝い|申請|手当|給付|一時金|助成|口座|ファイル/ },
];
const OTHER = { key: "other", label: "そのほか", icon: "✦", hue: "" };
const ALL_SHELVES = [...SHELVES, OTHER];
const STATUS_ORDER = ["▶️ DOING", "⏭ NEXT", "⏳ WAITING", "📥 INBOX", "🕰 SOMEDAY", "🤖 AI", "📚 REFERENCE"];
const SOON_DAYS = 60;
const LIST_MAX = 80;
const NURSERY = /保育園|慣らし|入園/;

// 育児メモ「🍼 ミルクの分量」（アイクレオ・標準）の表：20ml 2.54g … 200ml 25.40g
const MILK_G_PER_ML = 0.127;
const MILK_PRESETS = [60, 80, 100, 120, 140, 160, 200];

// これからの予防接種・健診（一般的な目安。育児メモ「予防接種」と 10/26 の調べ物より）。m＝誕生日からの月数
const VAX = [
  { m: 9, label: "9〜10か月健診", items: [["9か月検診", "日程は妻のカレンダー"]], checkup: true },
  { m: 12, label: "1歳", items: [
    ["MR（麻しん・風しん）1期", "1歳になったら早めに"],
    ["水痘（みずぼうそう）1回目", ""],
    ["小児用肺炎球菌 追加（4回目）", ""],
    ["五種混合 追加（4回目）", "3回目から6か月以上あけて"],
    ["おたふくかぜ 1回目", "任意接種（有料のことが多い）", true],
  ] },
  { m: 18, label: "1歳6か月", items: [["水痘 2回目", "1回目から6か月以上あけて"], ["1歳6か月健診", "市からの案内で"]] },
  { m: 36, label: "3歳", items: [["日本脳炎 1期（1・2回目）", "1〜4週あけて2回"], ["3歳児健診", "市からの案内で"]] },
  { m: 48, label: "4歳", items: [["日本脳炎 1期 追加", "2回目からおよそ1年後"]] },
  { m: 60, label: "5〜6歳（入学前の1年）", items: [["MR 2期", ""], ["おたふくかぜ 2回目", "任意接種", true]] },
];

const $ = (s) => document.querySelector(s);
const state = { child: null, items: [], events: [], calError: "", shelf: null, src: null, q: "", showDone: false, view: "park", busy: false };

function shelfOf(item) {
  if (item.src === "aid") return "money";
  const byTag = item.tag && SHELVES.find((s) => s.tags.includes(item.tag));
  if (byTag) return byTag.key;
  const byWord = SHELVES.find((s) => s.re.test(item.title));
  return byWord ? byWord.key : OTHER.key;
}

// ---------- 日付 ----------
const todayJst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
function addMonths(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(d, last));
  return x.toISOString().slice(0, 10);
}
function monthsOld(birth, today) {
  let months = 0;
  while (addMonths(birth, months + 1) <= today) months++;
  return { months, days: daysBetween(addMonths(birth, months), today) };
}
function ageText(birth, today) {
  const { months, days } = monthsOld(birth, today);
  if (months < 12) return { main: `生後${months}か月${days}日`, sub: `1歳の誕生日まで ${daysBetween(today, addMonths(birth, 12))}日` };
  return { main: `${Math.floor(months / 12)}歳${months % 12}か月`, sub: "" };
}
const WEEK = "日月火水木金土";
const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const mdw = (date) => `${md(date)}（${WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()]}）`;
const ymd = (date) => `${date.slice(0, 4)}/${md(date)}`;

// ---------- 通信 ----------
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* 空のまま */ }
  if (!res.ok) throw new Error(data.error || `読み込めませんでした（${res.status}）`);
  return data;
}

function setStatus(msg, isErr = false) {
  const el = $("#status");
  el.textContent = msg;
  el.classList.toggle("err", isErr);
}

async function load() {
  if (state.busy) return;
  state.busy = true;
  $("#reload").classList.add("spin");
  setStatus(state.items.length ? "" : "Notion から読み込み中…");
  const hub = api("/api/hub").then((data) => {
    state.child = data.child;
    state.items = data.items.map((it) => ({ ...it, shelf: shelfOf(it) }));
    setStatus("");
  }, (err) => setStatus(err.message, true));
  // カレンダーは読めなくても画面は使えるので、失敗は予定の欄にだけ出す
  const cal = api("/api/calendar").then((data) => { state.events = data.events || []; state.calError = ""; }, (err) => { state.calError = err.message; });
  await Promise.all([hub, cal]);
  state.busy = false;
  $("#reload").classList.remove("spin");
  render();
}

// ---------- 描画の道具 ----------
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "style") e.setAttribute("style", v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
};
const visible = (it) => state.showDone || !it.done;

function byRelevance(a, b) {
  const rank = (it) => (it.done ? 9 : it.src === "task" ? 0 : it.src === "aid" ? 1 : it.src === "memo" ? 2 : 3);
  const st = (it) => { const i = STATUS_ORDER.indexOf(it.status); return i < 0 ? 99 : i; };
  return rank(a) - rank(b) || st(a) - st(b) || (a.date || "9999").localeCompare(b.date || "9999") || a.title.localeCompare(b.title, "ja");
}

function itemRow(it) {
  const sub = it.note || (it.date ? md(it.date) : "") || it.meta.join("・");
  return el("button", { type: "button", class: `item${it.done ? " done" : ""}`, onclick: () => openSheet(it) },
    el("span", { class: "grow" }, el("span", { class: "t" }, it.title), sub ? el("span", { class: "s" }, sub) : null),
    el("span", { class: "pills" },
      it.star ? el("span", { class: "pill star" }, "★") : null,
      (it.src === "task" || it.src === "aid") && it.status ? el("span", { class: "pill" }, it.status) : null,
      el("span", { class: "pill src" }, SRC[it.src].short)));
}

function eventRow(ev) {
  const inner = [
    el("span", { class: "grow" }, el("span", { class: "t" }, ev.title), el("span", { class: "s" }, `${mdw(ev.date)}${ev.time ? ` ${ev.time}` : ""}`)),
    el("span", { class: "pills" }, el("span", { class: "pill cal" }, "カレンダー")),
  ];
  return ev.url ? el("a", { class: "item", href: ev.url, target: "_blank", rel: "noopener" }, inner) : el("div", { class: "item" }, inner);
}

function listInto(box, list, emptyText) {
  box.replaceChildren(...(list.length
    ? list.slice(0, LIST_MAX).map((x) => (x.src ? itemRow(x) : eventRow(x))).concat(list.length > LIST_MAX ? [el("p", { class: "empty" }, `ほか${list.length - LIST_MAX}件（さがす・棚で絞ってください）`)] : [])
    : [el("p", { class: "empty" }, emptyText)]));
}

// ---------- 描画 ----------
function render() {
  const today = todayJst();
  if (state.child) {
    const a = ageText(state.child.birth, today);
    $("#child-name").textContent = `${state.child.name}`;
    $("#child-age").textContent = a.main;
    $("#child-sub").textContent = a.sub;
  }
  renderPark(today);
  renderFood();
  renderVax(today);
  renderNursery(today);
}

function renderPark(today) {
  const dated = [
    ...state.items.filter((it) => !it.done && it.date).map((it) => ({ date: it.date, title: it.title, open: () => openSheet(it) })),
    ...state.events.map((ev) => ({ date: ev.date, title: ev.title, time: ev.time, url: ev.url, cal: true })),
  ].filter((x) => x.date >= today && daysBetween(today, x.date) <= SOON_DAYS).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  $("#soon-wrap").hidden = !dated.length;
  // カレンダーの予定は Google カレンダーへのリンク（アーティファクトでは window.open が使えないことがある）
  $("#soon").replaceChildren(...dated.map((x) => el(x.cal && x.url ? "a" : "button",
    x.cal ? { class: "cal", ...(x.url ? { href: x.url, target: "_blank", rel: "noopener" } : { type: "button" }) } : { type: "button", onclick: x.open },
    el("span", { class: "d" }, `${mdw(x.date)}${x.time ? ` ${x.time}` : ""}・あと${daysBetween(today, x.date)}日`),
    el("span", { class: "t" }, x.title))));

  const pins = state.items.filter((it) => it.star && visible(it));
  $("#pin-wrap").hidden = !pins.length;
  $("#pins").replaceChildren(...pins.map((it) => el("button", { type: "button", onclick: () => openSheet(it) }, it.title)));

  const base = state.items.filter((it) => visible(it) && (!state.src || it.src === state.src) && (!state.q || it.title.includes(state.q) || it.note.includes(state.q)));
  const shelves = ALL_SHELVES.map((s) => ({ ...s, count: base.filter((it) => it.shelf === s.key).length })).filter((s) => s.count || s.key === state.shelf);
  $("#shelves").replaceChildren(...shelves.map((s) => el("button", {
    type: "button", class: "shelf", "aria-pressed": String(state.shelf === s.key), style: s.hue ? `--hue:${s.hue}` : null,
    onclick: () => { state.shelf = state.shelf === s.key ? null : s.key; render(); },
  }, el("i", { "aria-hidden": "true" }, s.icon), el("b", {}, s.label), el("span", {}, `${s.count}件`))));

  $("#srcs").replaceChildren(...Object.entries(SRC).map(([k, s]) => el("button", {
    type: "button", class: "chip", "aria-pressed": String(state.src === k),
    onclick: () => { state.src = state.src === k ? null : k; render(); },
  }, s.label)));

  const list = base.filter((it) => !state.shelf || it.shelf === state.shelf).sort(byRelevance);
  const shelf = ALL_SHELVES.find((s) => s.key === state.shelf);
  $("#list-title").textContent = [shelf?.label, state.src && SRC[state.src].label].filter(Boolean).join("・") || "すべて";
  $("#list-count").textContent = `${list.length}件`;
  listInto($("#list"), list, state.items.length ? "見つかりません" : "まだ読み込んでいません");
}

function renderFood() {
  const list = state.items.filter((it) => it.shelf === "food" && visible(it)).sort(byRelevance);
  $("#food-count").textContent = `${list.length}件`;
  listInto($("#food-list"), list, state.items.length ? "離乳食・ミルクの項目はありません" : "まだ読み込んでいません");
}

function setMilk(ml) {
  const v = Math.min(300, Math.max(10, Math.round(Number(ml) / 10) * 10 || 10));
  $("#milk-ml").value = v;
  $("#milk-range").value = v;
  $("#milk-g").textContent = (v * MILK_G_PER_ML).toFixed(2);
  try { localStorage.setItem("ikuji-hub:milk", String(v)); } catch { /* 保存できなくても計算はできる */ }
  document.querySelectorAll("#milk-presets .chip").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.ml) === v)));
}

function renderVax(today) {
  const birth = state.child?.birth;
  const calVax = state.events.filter((ev) => /検診|健診|接種|ワクチン|小児科/.test(ev.title));
  $("#vax-cal-wrap").hidden = !calVax.length;
  listInto($("#vax-cal"), calVax, "");
  if (!birth) { $("#vax").replaceChildren(el("p", { class: "empty" }, "読み込み中…")); return; }
  const { months } = monthsOld(birth, today);
  const nextIdx = VAX.findIndex((v) => v.m > months);
  $("#vax").replaceChildren(...VAX.map((v, i) => {
    const from = addMonths(birth, v.m);
    const until = VAX[i + 1] ? addMonths(birth, VAX[i + 1].m) : null;
    const cls = until && until <= today ? "past" : from <= today ? "now" : i === nextIdx ? "next" : "";
    const when = from <= today ? (cls === "past" ? `${ymd(from)}〜` : `${ymd(from)}〜（いまの時期）`) : `${ymd(from)}〜・あと${daysBetween(today, from)}日`;
    return el("div", { class: `stop ${cls}` },
      el("span", { class: "when" }, when),
      el("span", { class: "what" }, v.label, cls === "now" ? el("span", { class: "tag" }, "いま") : cls === "next" ? el("span", { class: "tag" }, "つぎ") : null),
      el("ul", {}, v.items.map(([name, note, opt]) => el("li", {}, name, opt ? el("span", { class: "tag opt", style: "display:inline;margin-left:6px" }, "任意") : null, note ? el("span", {}, note) : null))));
  }));
}

function renderNursery(today) {
  const back = state.child?.backToWork;
  if (back) {
    const left = daysBetween(today, back);
    $("#back-days").textContent = left > 0 ? `あと ${left} 日` : left === 0 ? "きょう" : "復職済み";
    $("#back-date").textContent = `${ymd(back)}（${WEEK[new Date(`${back}T00:00:00Z`).getUTCDay()]}）・1歳の誕生日`;
  }
  const items = state.items.filter((it) => visible(it) && (NURSERY.test(it.title) || it.tag === "保育園準備" || NURSERY.test(it.note))).sort(byRelevance);
  $("#nursery-count").textContent = `${items.length}件`;
  listInto($("#nursery-list"), items, state.items.length ? "保育園の項目はありません" : "まだ読み込んでいません");

  const stops = [
    { date: today, title: "きょう", now: true },
    ...state.events.filter((ev) => NURSERY.test(ev.title)).map((ev) => ({ date: ev.date, title: ev.title, time: ev.time })),
    ...items.filter((it) => it.date && it.date >= today).map((it) => ({ date: it.date, title: it.title })),
    ...(back ? [{ date: back, title: "ママの復職・1歳の誕生日", key: true }] : []),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const note = state.calError ? el("p", { class: "note-s" }, `カレンダーを読めませんでした：${state.calError}`)
    : stops.length <= 2 ? el("p", { class: "note-s" }, "入園日・慣らし保育の予定はまだカレンダーにありません。決まったら Google カレンダーに「保育園」を含む名前で入れると、ここに並びます。") : null;
  $("#nursery-road").replaceChildren(...stops.map((s) => el("div", { class: `stop ${s.now ? "now" : s.key ? "next" : ""}` },
    el("span", { class: "when" }, `${mdw(s.date)}${s.time ? ` ${s.time}` : ""}${s.now ? "" : `・あと${daysBetween(today, s.date)}日`}`),
    el("span", { class: "what" }, s.title))), note || "");
}

// ---------- くわしく ----------
function openSheet(it) {
  $("#sheet-src").textContent = SRC[it.src].label;
  $("#sheet-title").textContent = it.title;
  const shelf = ALL_SHELVES.find((s) => s.key === it.shelf);
  const props = [
    ["棚", shelf?.label],
    ["状態", it.status],
    [it.src === "aid" ? "期限" : "日付", it.date],
    ["分類", it.tag],
    [it.src === "aid" ? "申請先" : "枠・重さ", it.meta.join("・")],
  ].filter(([, v]) => v);
  $("#sheet-props").replaceChildren(...props.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]));
  $("#sheet-note").textContent = it.note;
  const actions = [];
  if (it.src === "task" && /^[0-9a-f]{32}$/.test(it.id)) {
    if (!it.done) actions.push(el("button", { type: "button", class: "primary", onclick: () => changeStatus(it, "✅ DONE") }, "完了にする"));
    if (!it.done && it.status !== "⏭ NEXT") actions.push(el("button", { type: "button", onclick: () => changeStatus(it, "⏭ NEXT") }, "NEXT にする"));
    if (it.done) actions.push(el("button", { type: "button", onclick: () => changeStatus(it, "⏭ NEXT") }, "もどす"));
  }
  $("#sheet-actions").replaceChildren(...actions);
  const open = $("#sheet-open");
  open.hidden = !it.url;
  if (it.url) open.href = it.url;
  if (!$("#sheet").open) $("#sheet").showModal();
}

async function changeStatus(it, status) {
  const buttons = [...$("#sheet-actions").querySelectorAll("button")];
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const { item } = await api(`/api/tasks/${it.id}`, { method: "PATCH", body: { status } });
    Object.assign(it, item, { shelf: it.shelf });
    setStatus(status === "✅ DONE" ? `「${it.title}」を完了にしました` : `「${it.title}」を ${status} にしました`);
    $("#sheet").close();
  } catch (err) {
    setStatus(err.message, true);
    buttons.forEach((b) => { b.disabled = false; });
  }
  render();
}

// ---------- 画面の切り替え ----------
function showView(view) {
  state.view = view;
  document.querySelectorAll(".tabbar button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === view)));
  document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== `view-${view}`; });
  try { localStorage.setItem("ikuji-hub:view", view); } catch { /* 覚えられなくてもよい */ }
  window.scrollTo({ top: 0 });
}

// ---------- 夜空の星 ----------
function drawStars() {
  const c = $("#stars");
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = r.width * dpr;
  c.height = r.height * dpr;
  const g = c.getContext("2d");
  g.scale(dpr, dpr);
  let seed = 19; // 毎回同じ星空にする
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * r.width, y = rnd() * r.height * 0.8, s = rnd() * 1.4 + 0.3;
    g.fillStyle = `rgba(255, ${220 + rnd() * 35}, ${150 + rnd() * 80}, ${0.35 + rnd() * 0.6})`;
    g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
  }
  // きらめき（4本の光）を3つ
  for (const [fx, fy, s] of [[0.82, 0.22, 7], [0.64, 0.12, 4], [0.9, 0.5, 3.5]]) {
    const x = fx * r.width, y = fy * r.height;
    g.fillStyle = "rgba(255, 228, 150, 0.95)";
    g.beginPath();
    g.moveTo(x, y - s * 2); g.quadraticCurveTo(x, y, x + s * 2, y); g.quadraticCurveTo(x, y, x, y + s * 2);
    g.quadraticCurveTo(x, y, x - s * 2, y); g.quadraticCurveTo(x, y, x, y - s * 2); g.fill();
  }
}

// ---------- 入力 ----------
$("#reload").addEventListener("click", load);
$("#q").addEventListener("input", (e) => { state.q = e.target.value.trim(); render(); });
$("#show-done").addEventListener("change", (e) => { state.showDone = e.target.checked; render(); });
$("#sheet-close").addEventListener("click", () => $("#sheet").close());
$("#sheet").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
document.querySelectorAll(".tabbar button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
$("#milk-ml").addEventListener("change", (e) => setMilk(e.target.value));
$("#milk-range").addEventListener("input", (e) => setMilk(e.target.value));
$("#milk-minus").addEventListener("click", () => setMilk(Number($("#milk-ml").value) - 10));
$("#milk-plus").addEventListener("click", () => setMilk(Number($("#milk-ml").value) + 10));
$("#milk-presets").replaceChildren(...MILK_PRESETS.map((ml) => el("button", { type: "button", class: "chip", "data-ml": ml, onclick: () => setMilk(ml) }, `${ml}ml`)));
$("#add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#add-title");
  const title = input.value.trim();
  if (!title) return;
  const btn = e.currentTarget.querySelector("button");
  btn.disabled = true;
  try {
    await api("/api/tasks", { method: "POST", body: { title } });
    input.value = "";
    await load();
    setStatus(`「${title}」を INBOX に追加しました`);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    btn.disabled = false;
  }
});
window.addEventListener("resize", drawStars);

let savedMilk = 100, savedView = "park";
try {
  savedMilk = Number(localStorage.getItem("ikuji-hub:milk")) || 100;
  savedView = localStorage.getItem("ikuji-hub:view") || "park";
} catch { /* 初期値のまま */ }
setMilk(savedMilk);
showView(["park", "food", "vax", "nursery"].includes(savedView) ? savedView : "park");
drawStars();
render();
load();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
