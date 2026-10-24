// 育児ハブ：Notion の育児まわり（タスク・しらべた・育児メモ・申請）を棚ごとに見る。/api は mcp-api.js か Worker が答える。
const SRC = {
  task: { label: "やること", short: "タスク" },
  ref: { label: "しらべた", short: "しらべ" },
  memo: { label: "育児メモ", short: "メモ" },
  aid: { label: "申請", short: "申請" },
};
// 棚：育児メモは分類タグで、ほかは名前の言葉で振り分ける（上から順に最初に当たった棚）
const SHELVES = [
  { key: "food", label: "ごはん", tags: ["授乳/ミルク", "搾乳", "離乳食"], re: /離乳食|ミルク|授乳|ごはん|ブレンダー/ },
  { key: "body", label: "からだ・医療", tags: ["検診", "予防接種", "体調/発熱", "医療", "母体"], re: /予防接種|接種|健診|検診|病院|医療|発熱|体幹|肌|湿疹|ボディソープ|現状把握/ },
  { key: "care", label: "お世話・ねんね", tags: ["おむつ", "沐浴", "抱っこ", "寝かしつけ"], re: /おむつ|沐浴|抱っこ|抱き|寝かし|布団|ベッド|見守り/ },
  { key: "play", label: "あそび・本", tags: ["遊び", "絵本/歌", "おもちゃ", "本"], re: /絵本|おもちゃ|ピアノ|読む|本$|プレイ/ },
  { key: "out", label: "保育園・おでかけ", tags: ["お出かけ", "保育園準備", "行事"], re: /保育園|ベビーカー|チャイルドシート|おでかけ|お出かけ/ },
  { key: "money", label: "手続き・お金", tags: [], re: /マイナンバー|お祝い|申請|手当|給付|一時金|助成|NISA|ファイル/ },
];
const OTHER = { key: "other", label: "そのほか" };
const STATUS_ORDER = ["▶️ DOING", "⏭ NEXT", "⏳ WAITING", "📥 INBOX", "🕰 SOMEDAY", "🤖 AI", "📚 REFERENCE"];
const SOON_DAYS = 60;
const LIST_MAX = 80;

const $ = (s) => document.querySelector(s);
const state = { child: null, items: [], shelf: null, src: null, q: "", showDone: false, open: null, busy: false };

function shelfOf(item) {
  if (item.src === "aid") return "money";
  const byTag = item.tag && SHELVES.find((s) => s.tags.includes(item.tag));
  if (byTag) return byTag.key;
  const byWord = SHELVES.find((s) => s.re.test(item.title));
  return byWord ? byWord.key : OTHER.key;
}

// ---------- 日付 ----------
function todayJst() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}
function addMonths(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(d, last));
  return x.toISOString().slice(0, 10);
}
export function ageText(birth, today) {
  let months = 0;
  while (addMonths(birth, months + 1) <= today) months++;
  const days = daysBetween(addMonths(birth, months), today);
  if (months < 12) return { main: `生後${months}か月${days}日`, sub: `1歳まで ${daysBetween(today, addMonths(birth, 12))}日` };
  return { main: `${Math.floor(months / 12)}歳${months % 12}か月`, sub: "" };
}
const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

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
  try {
    const data = await api("/api/hub");
    state.child = data.child;
    state.items = data.items.map((it) => ({ ...it, shelf: shelfOf(it) }));
    setStatus("");
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    state.busy = false;
    $("#reload").classList.remove("spin");
    render();
  }
}

// ---------- 描画 ----------
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
};

const visible = (it) => state.showDone || !it.done;

function render() {
  const today = todayJst();
  if (state.child) {
    const a = ageText(state.child.birth, today);
    $("#child-name").textContent = state.child.name;
    $("#child-age").replaceChildren(a.main, a.sub ? el("small", {}, a.sub) : "");
  }

  const soon = state.items
    .filter((it) => !it.done && it.date && it.date >= today && daysBetween(today, it.date) <= SOON_DAYS)
    .sort((a, b) => a.date.localeCompare(b.date));
  $("#soon-wrap").hidden = !soon.length;
  $("#soon").replaceChildren(...soon.map((it) => el("button", { type: "button", onclick: () => openSheet(it) },
    el("span", { class: "d" }, `${md(it.date)}・あと${daysBetween(today, it.date)}日`),
    el("span", { class: "t" }, it.title))));

  const pins = state.items.filter((it) => it.star && visible(it));
  $("#pin-wrap").hidden = !pins.length;
  $("#pins").replaceChildren(...pins.map((it) => el("button", { type: "button", onclick: () => openSheet(it) }, it.title)));

  const base = state.items.filter((it) => visible(it) && (!state.src || it.src === state.src) && (!state.q || it.title.includes(state.q) || it.note.includes(state.q)));
  const shelves = [...SHELVES, OTHER].map((s) => ({ ...s, count: base.filter((it) => it.shelf === s.key).length })).filter((s) => s.count || s.key === state.shelf);
  $("#shelves").replaceChildren(...shelves.map((s) => el("button", {
    type: "button", class: "shelf", "aria-pressed": String(state.shelf === s.key),
    onclick: () => { state.shelf = state.shelf === s.key ? null : s.key; render(); },
  }, el("b", {}, s.label), el("span", {}, `${s.count}件`))));

  $("#srcs").replaceChildren(...Object.entries(SRC).map(([k, s]) => el("button", {
    type: "button", class: "chip", "aria-pressed": String(state.src === k),
    onclick: () => { state.src = state.src === k ? null : k; render(); },
  }, s.label)));

  const list = base.filter((it) => !state.shelf || it.shelf === state.shelf).sort(byRelevance);
  const shelf = [...SHELVES, OTHER].find((s) => s.key === state.shelf);
  $("#list-title").textContent = [shelf?.label, state.src && SRC[state.src].label].filter(Boolean).join("・") || "すべて";
  $("#list-count").textContent = `${list.length}件`;
  $("#list").replaceChildren(...(list.length
    ? list.slice(0, LIST_MAX).map(itemRow).concat(list.length > LIST_MAX ? [el("p", { class: "empty" }, `ほか${list.length - LIST_MAX}件（さがす・棚で絞ってください）`)] : [])
    : [el("p", { class: "empty" }, state.items.length ? "見つかりません" : "まだ読み込んでいません")]));
}

function byRelevance(a, b) {
  const rank = (it) => (it.done ? 9 : it.src === "task" ? 0 : it.src === "aid" ? 1 : it.src === "memo" ? 2 : 3);
  const st = (it) => { const i = STATUS_ORDER.indexOf(it.status); return i < 0 ? 99 : i; };
  return rank(a) - rank(b) || st(a) - st(b) || (a.date || "9999").localeCompare(b.date || "9999") || a.title.localeCompare(b.title, "ja");
}

function itemRow(it) {
  const sub = it.note || (it.date ? `${md(it.date)}` : "") || it.meta.join("・");
  return el("button", { type: "button", class: `item${it.done ? " done" : ""}`, onclick: () => openSheet(it) },
    el("span", { class: "grow" }, el("span", { class: "t" }, it.title), sub ? el("span", { class: "s" }, sub) : null),
    el("span", { class: "pills" },
      it.star ? el("span", { class: "pill star" }, "★") : null,
      it.src === "task" && it.status ? el("span", { class: "pill" }, it.status) : null,
      it.src === "aid" && it.status ? el("span", { class: "pill" }, it.status) : null,
      el("span", { class: "pill src" }, SRC[it.src].short)));
}

// ---------- くわしく ----------
function openSheet(it) {
  state.open = it;
  $("#sheet-src").textContent = SRC[it.src].label;
  $("#sheet-title").textContent = it.title;
  const shelf = [...SHELVES, OTHER].find((s) => s.key === it.shelf);
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
    if (!it.done) actions.push(el("button", { type: "button", class: "primary", onclick: () => setStatus_(it, "✅ DONE") }, "完了にする"));
    if (!it.done && it.status !== "⏭ NEXT") actions.push(el("button", { type: "button", onclick: () => setStatus_(it, "⏭ NEXT") }, "NEXT にする"));
    if (it.done) actions.push(el("button", { type: "button", onclick: () => setStatus_(it, "⏭ NEXT") }, "もどす"));
  }
  $("#sheet-actions").replaceChildren(...actions);
  const open = $("#sheet-open");
  open.hidden = !it.url;
  if (it.url) open.href = it.url;
  const sheet = $("#sheet");
  if (!sheet.open) sheet.showModal();
}

async function setStatus_(it, status) {
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

// ---------- 入力 ----------
$("#reload").addEventListener("click", load);
$("#q").addEventListener("input", (e) => { state.q = e.target.value.trim(); render(); });
$("#show-done").addEventListener("change", (e) => { state.showDone = e.target.checked; render(); });
$("#sheet-close").addEventListener("click", () => $("#sheet").close());
$("#sheet").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
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

render();
load();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
