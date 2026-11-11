// 旅のしおり：画面。Notion のしおりページを読み、チェック・追加を書き戻す。
// 圏外でも開けるよう、最後に読んだしおりと未送信の変更を端末に置いておく。
"use strict";

const KEY_STORAGE = "trip-shiori-key";
const CACHE_STORAGE = "trip-shiori-cache";
const OUTBOX_STORAGE = "trip-shiori-outbox";
const TAB_STORAGE = "trip-shiori-tab";
const PARK_STORAGE = "trip-shiori-park";
const PLACES_LABEL = "📍 行きたい場所";
const WEEK = "日月火水木金土";

const $ = (id) => document.getElementById(id);
const state = {
  trip: load(CACHE_STORAGE, null),
  outbox: load(OUTBOX_STORAGE, []),
  tab: load(TAB_STORAGE, ""),
  syncing: false,
  error: "",
  open: new Set(), // 足す欄を開いているまとまり
  park: load(PARK_STORAGE, "land"),
  focus: "", // マップで選んだピン
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
      if (op.op === "delete") await api("DELETE", `/api/blocks/${op.id}`);
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
  if (withTime) sortByTime(list);
  queue({ op: "add", parent: parent.id, text, tempId: item.id });
}

function addGroup(text) {
  const g = { id: `tmp-${Date.now()}`, label: text, items: [] };
  state.trip.groups.push(g);
  state.open.add(g.id);
  queue({ op: "group", text, tempId: g.id });
  return g;
}

// 消す：すぐ画面から消し、5秒の「元に戻す」のあとで Notion へ送る（Notion ではゴミ箱に入り30日は戻せる）
let pendingDelete = null;
function removeItem(item) {
  commitDelete();
  const loc = locate(item);
  if (!loc) return false;
  loc.list.splice(loc.index, 1);
  pendingDelete = { item, ...loc, timer: setTimeout(commitDelete, 5000) };
  save(CACHE_STORAGE, state.trip);
  render();
  const kids = flatten([item]).length - (item.checked === null ? 0 : 1);
  toast(`「${item.label}」${kids > 0 ? `と下の${kids}件` : ""}を消しました`, "元に戻す", () => {
    const p = pendingDelete;
    if (!p || p.item !== item) return;
    clearTimeout(p.timer);
    pendingDelete = null;
    p.list.splice(Math.min(p.index, p.list.length), 0, item);
    save(CACHE_STORAGE, state.trip);
    render();
  });
  return true;
}

function commitDelete() {
  const p = pendingDelete;
  if (!p) return;
  pendingDelete = null;
  clearTimeout(p.timer);
  if (isTemp(p.item.id)) {
    const gone = new Set(flattenIds(p.item));
    state.outbox = state.outbox.filter((o) => !gone.has(o.tempId) && !gone.has(o.id) && !gone.has(o.parent));
    save(OUTBOX_STORAGE, state.outbox);
    save(CACHE_STORAGE, state.trip);
    renderSync();
    return;
  }
  queue({ op: "delete", id: p.item.id });
}

function locate(item) {
  const find = (list) => {
    const index = list.indexOf(item);
    if (index >= 0) return { list, index };
    for (const n of list) {
      const hit = find(n.items || n.children || []);
      if (hit) return hit;
    }
    return null;
  };
  return find(state.trip.groups) || find(state.trip.days);
}

function flattenIds(item) {
  return [item.id, ...(item.items || item.children || []).flatMap(flattenIds)];
}

const WISH_LABEL = "🛍 買いたいもの";
function isWishGroup(g) {
  return /買いたいもの/u.test(g.label);
}

function addWish(text) {
  const g = state.trip.groups.find(isWishGroup) || addGroup(WISH_LABEL);
  addItem(g, text, false);
}

// 文の中の価格（¥2,800／2800円）
function priceOf(text) {
  const m = String(text || "").match(/[¥￥]\s?([\d,]+)|([\d,]+)\s?円/u);
  return m ? Number((m[1] || m[2]).replace(/,/g, "")) : 0;
}

function yen(n) {
  return `¥${n.toLocaleString("ja-JP")}`;
}

function groupOf(item) {
  return state.trip.groups.find((g) => g === item || flattenIds(g).includes(item.id));
}

function isPlacesGroup(g) {
  return /行きたい場所/u.test(g.label);
}

// 行きたい場所は「📍 行きたい場所」のまとまりに足す（無ければ作る）
function addPlace(text) {
  const g = state.trip.groups.find(isPlacesGroup) || addGroup(PLACES_LABEL);
  addItem(g, text, false);
  const hit = TripPlaces.findPlace(text);
  if (hit && TripPlaces.AREA_BY_ID[hit.area].park !== state.park && tripParks().includes(TripPlaces.AREA_BY_ID[hit.area].park)) {
    state.park = TripPlaces.AREA_BY_ID[hit.area].park;
    save(PARK_STORAGE, state.park);
    render();
  }
}

// 時刻順に並べる。時刻の無い行（ルートのメモなど）は直前の時刻つきの行にくっついて動く
function sortByTime(items) {
  const head = [];
  const segs = [];
  for (const i of items) {
    if (i.time) segs.push([i]);
    else (segs.length ? segs.at(-1) : head).push(i);
  }
  segs.sort((a, b) => minutes(a[0].time) - minutes(b[0].time));
  items.splice(0, items.length, ...head, ...segs.flat());
}

function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function shiftTime(t, delta) {
  const v = Math.min(23 * 60 + 55, Math.max(0, minutes(t) + delta));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}

function composeText(time, label) {
  return time ? `${fmtTime(time)}　${label}` : label;
}

// 時刻・文字を書き換えて送る（day を渡すと並べ直す）
function saveItem(item, time, label, day) {
  const text = composeText(day ? time : item.time, label); // 日程の外（マップなど）で直すときは時刻をそのまま残す
  if (text === item.text) return;
  item.text = text;
  item.label = label;
  if (day) item.time = time ? fmtTime(time) : null;
  if (day) sortByTime(day.items);
  queue({ op: "edit", id: item.id, text });
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
  return "map";
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
  if (state.dragging || (typeof detail !== "undefined" && detail.composing)) { state.needsRender = true; return; }
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
  const ids = [...state.trip.days.map((d) => d.id), "map", "prep", "todo"];
  if (!ids.includes(state.tab)) state.tab = defaultTab();
  renderTabs();
  const day = state.trip.days.find((d) => d.id === state.tab);
  const scroll = $("main").scrollTop;
  $("view").replaceChildren(...(day ? renderDay(day) : state.tab === "map" ? renderMap() : renderPrep(state.tab)).filter(Boolean));
  $("main").scrollTop = scroll;
  renderSync();
}

function renderTabs() {
  const tabs = [tabBtn("map", el("span", { class: "tab-md" }, "マップ"), el("span", { class: "tab-w" }, "行きたい"))];
  tabs.push(...state.trip.days.map((d) => {
    const { md, w } = shortDate(d.date);
    const isToday = d.date === todayStr();
    return tabBtn(d.id, el("span", { class: "tab-md" }, md), el("span", { class: "tab-w" }, isToday ? "今日" : w));
  }));
  tabs.push(tabBtn("prep", el("span", { class: "tab-md" }, "準備"), el("span", { class: "tab-w" }, "もちもの")));
  tabs.push(tabBtn("todo", el("span", { class: "tab-md" }, "当日"), el("span", { class: "tab-w" }, "TODO")));
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
    return el("li", { class: `tl-row${item.checked ? " done" : ""}${isNext ? " next" : ""}`, "data-id": item.id },
      el("button", { type: "button", class: "tl-time", onclick: () => openEditor(item, day), "aria-label": `${item.label}の時刻を変える` }, item.time || "—"),
      el("div", { class: "tl-dot", "aria-hidden": "true" }),
      el("div", { class: "tl-body" },
        isNext ? el("span", { class: "badge" }, "つぎ") : null,
        checkRow(item, day),
        item.children.length ? renderList(item.children, 1) : null,
        el("div", { class: "tl-actions" },
          item.map ? el("a", { class: "map-btn", href: item.map, target: "_blank", rel: "noopener" }, pinIcon(), "地図") : null,
          item.link ? el("a", { class: "map-btn", href: item.link, target: "_blank", rel: "noopener" }, "リンク") : null,
          item.checked !== null ? el("button", { type: "button", class: "trash-btn", "aria-label": `${item.label}を消す`, onclick: () => removeItem(item) }, trashIcon()) : null,
        ),
      ),
      dragHandle(item, day),
    );
  });

  return [
    el("div", { class: "day-head" },
      el("div", {}, el("b", {}, md), el("span", {}, `（${w}）`), isToday ? el("span", { class: "today" }, "今日") : null),
      el("span", { class: "count" }, `${done}/${day.items.length}`),
    ),
    dayHours(day),
    day.items.length ? el("ol", { class: "timeline" }, rows) : el("div", { class: "card empty" }, "予定はまだありません"),
    timedAddForm(day),
    el("p", { class: "hint" }, "丸で済み。時刻か文字を押すと直せます。右の ⋮⋮ を上下にドラッグすると時刻が5分ずつ動きます。"),
  ];
}

// その日のパークの開園・閉園（ThemeParks.wiki）
function dayHours(day) {
  const lines = tripParks().map((p) => [TripPlaces.PARKS[p].name, hoursText(p, day.date)]).filter(([, t]) => t);
  if (!lines.length) return null;
  return el("div", { class: "day-hours" },
    ...lines.map(([n, t]) => el("span", {}, `🏰 ${n} ${t}`)),
    el("a", { href: "https://themeparks.wiki/", target: "_blank", rel: "noopener" }, "Powered by ThemeParks.wiki"));
}

// 当日のTODOのまとまり（名前で見分ける。当日のタブで足したまとまりは頭に 📌 が付く）
const DAY_OF = /todo|当日|やること|買いたいもの|お土産|おみやげ|📌/iu;
function isDayOfGroup(g) {
  return DAY_OF.test(g.label);
}

// 準備のタブ（mode: "prep"）と当日のタブ（mode: "todo"）。同じ作りで、まとまりを分けて出す
function renderPrep(mode = "prep") {
  const todo = mode === "todo";
  const groups = state.trip.groups.filter((g) => !isPlacesGroup(g) && isDayOfGroup(g) === todo);
  const cards = groups.map((g) => {
    const flat = flatten(g.items);
    const done = flat.filter((i) => i.checked).length;
    return el("section", { class: "card group" },
      el("div", { class: "group-head" },
        el("button", { type: "button", class: "group-title", onclick: () => openEditor(g) }, g.label),
        priceSum(flat),
        el("span", { class: `count${flat.length && done === flat.length ? " all" : ""}` }, `${done}/${flat.length}`),
        pmButtons(g),
      ),
      g.items.length ? renderList(g.items, 0, true) : null,
      addForm(g.id, `＋ ${g.label}に足す`, (text) => addItem(g, text, false), "mini"),
    );
  });
  return [
    todo
      ? addForm("new-group-todo", "＋ 当日のまとまりを足す　例）お土産", (text) => addGroup(DAY_OF.test(text) ? text : `📌 ${text}`), "mini parent")
      : addForm("new-group", "＋ 準備のまとまりを足す　例）👕 服装", (text) => addGroup(text), "mini parent"),
    ...(cards.length ? cards : [el("div", { class: "card empty" }, todo ? "当日のTODOはまだありません" : "準備はまだありません")]),
    el("p", { class: "hint" }, "＋でその下（子）に足す、🗑で消す。項目を押すと文字を直せます。"),
  ];
}

// まとまりの中の価格の合計（買ったものは別に）
function priceSum(items) {
  const all = items.reduce((t, i) => t + priceOf(i.text), 0);
  if (!all) return null;
  const bought = items.filter((i) => i.checked).reduce((t, i) => t + priceOf(i.text), 0);
  return el("span", { class: "price-sum" }, `計 ${yen(all)}${bought ? `（買った ${yen(bought)}）` : ""}`);
}

// 行の右の ＋（この下に足す）と −（消す）
function pmButtons(item) {
  const open = state.addUnder === item.id;
  return el("span", { class: "pm" },
    el("button", {
      type: "button", class: `pm-btn plus${open ? " on" : ""}`, "aria-label": `${item.label}の下に足す`, "aria-expanded": String(open),
      onclick: () => {
        if (item.items) { document.querySelector(`[data-for="${item.id}"] input`)?.focus(); return; }
        state.addUnder = open ? "" : item.id;
        render();
        if (!open) setTimeout(() => document.querySelector(`[data-for="under-${item.id}"] input`)?.focus(), 0);
      },
    }, "＋"),
    el("button", { type: "button", class: "pm-btn minus", "aria-label": `${item.label}を消す`, onclick: () => removeItem(item) }, trashIcon()));
}

function trashIcon() {
  const n = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  n.setAttribute("viewBox", "0 0 24 24");
  n.setAttribute("aria-hidden", "true");
  n.innerHTML = '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>';
  return n;
}

// ---------- マップ（自作の模式図） ----------
function walk(items, fn, ctx) {
  for (const i of items) {
    fn(i, ctx);
    if (i.children?.length) walk(i.children, fn, ctx);
  }
}

function mapPins() {
  const pins = [];
  const want = state.trip.groups.find(isPlacesGroup);
  if (want) walk(want.items, (i) => pins.push({ item: i, kind: "want", place: TripPlaces.findPlace(i.text) }));
  for (const d of state.trip.days) {
    const { md } = shortDate(d.date);
    walk(d.items, (i) => {
      const place = TripPlaces.findPlace(i.label);
      if (place) pins.push({ item: i, kind: "plan", place, when: `${md}${i.time ? ` ${i.time}` : ""}` });
    });
  }
  return pins;
}

// 今回の旅行で使うパーク（Worker の TRIP_PARKS）。今のパークが外れていたら最初のパークに
function tripParks() {
  return state.trip?.parks?.length ? state.trip.parks : ["land", "sea"];
}

function renderMap() {
  const { PARKS, AREA_BY_ID } = TripPlaces;
  if (!tripParks().includes(state.park)) { state.park = tripParks()[0]; save(PARK_STORAGE, state.park); }
  const all = mapPins();
  const placed = all.filter((p) => p.place);
  const unknown = all.filter((p) => !p.place && p.kind === "want");
  const park = PARKS[state.park] || PARKS.land;
  const pins = placed.filter((p) => AREA_BY_ID[p.place.area].park === state.park);
  const later = placed.filter((p) => p.kind === "want" && !tripParks().includes(AREA_BY_ID[p.place.area].park));
  pins.forEach((p, i) => { p.no = i + 1; });

  const seg = tripParks().length < 2 ? null : el("div", { class: "seg", role: "tablist" }, tripParks().map((id) => [id, PARKS[id]]).map(([id, pk]) => {
    const n = placed.filter((p) => AREA_BY_ID[p.place.area].park === id).length;
    return el("button", {
      type: "button", role: "tab", "aria-selected": String(state.park === id),
      onclick: () => { state.park = id; state.focus = ""; save(PARK_STORAGE, id); render(); },
    }, pk.name, n ? el("span", { class: "seg-n" }, String(n)) : null);
  }));

  const byArea = park.areas.map((a) => ({ area: a, pins: pins.filter((p) => p.place.area === a.id) }));
  const groups = byArea.filter((g) => g.pins.length).map((g) => [
    el("div", { class: "area-sub" }, el("i", { style: `background:${g.area.color}` }), g.area.name),
    el("ul", { class: "list" }, g.pins.map((p) =>
      el("li", { class: `pin-row${p.item.checked ? " done" : ""}${state.focus === p.item.id ? " focus" : ""}`, id: `pin-${p.item.id}` },
        el("span", { class: "pin-no", style: `background:${pinColor(p)}` }, el("span", {}, String(p.no))),
        el("div", { class: "pin-main" },
          checkRow(p.item),
          p.kind === "plan" ? el("div", { class: "pin-when" }, `予定 ${p.when}`) : null,
          p.place.name && TripPlaces.norm(p.place.name) !== TripPlaces.norm(p.item.label) ? el("div", { class: "pin-when" }, `→ ${p.place.name}`) : null,
        ),
        el("button", { type: "button", class: "map-btn tight", onclick: () => flyToPin(p) }, pinIcon(), "地図"),
        p.kind === "want" ? el("button", { type: "button", class: "trash-btn", "aria-label": `${p.item.label}を消す`, onclick: () => removeItem(p.item) }, trashIcon()) : null,
      ))),
  ]);

  const input = el("input", { type: "text", placeholder: "例）カリブの海賊／ジャングル", maxlength: "190", enterkeyhint: "done", "aria-label": "行きたい場所" });
  const addRow = el("form", {
    class: "add-place", "data-for": "place",
    onsubmit: (e) => {
      e.preventDefault();
      const t = input.value.replace(/[\r\n]+/g, " ").trim();
      if (!t) return input.focus();
      input.value = "";
      addPlace(t);
      setTimeout(() => document.querySelector('[data-for="place"] input')?.focus(), 0);
    },
  }, input, el("button", { type: "submit", class: "primary" }, "＋ 追加"));

  return [
    seg,
    mapView(pins),
    el("section", { class: "card place-sheet" },
      el("div", { class: "sheet-grip", "aria-hidden": "true" }),
      el("h2", {}, `行きたい場所（${park.name}）`),
      ...(groups.length ? groups.flat() : [el("p", { class: "sub" }, "まだありません。下で足すと地図に番号が立ちます。")]),
      addRow,
    ),
    later.length ? el("section", { class: "card area-card unknown" },
      el("h3", {}, "今回は行かないパークの場所"),
      el("p", { class: "sub" }, "シーに行く日に、Worker の TRIP_PARKS を変えると地図に出ます。"),
      el("ul", { class: "list" }, later.map((p) => el("li", { class: p.item.checked ? "done" : "" },
        el("div", { class: "row-pm" }, checkRow(p.item),
          el("button", { type: "button", class: "trash-btn", "aria-label": `${p.item.label}を消す`, onclick: () => removeItem(p.item) }, trashIcon()))))),
    ) : null,
    unknown.length ? el("section", { class: "card area-card unknown" },
      el("h3", {}, "場所がわからないもの"),
      el("p", { class: "sub" }, "押して名前を直すか、後ろに（エリア名）を付けると地図に出ます。例）ポップコーン（トゥーンタウン）"),
      el("ul", { class: "list" }, unknown.map((p) => el("li", { class: p.item.checked ? "done" : "" }, checkRow(p.item)))),
    ) : null,
  ];
}

// ピンの色：行きたい場所はエリアの色を濃くしたもの、予定はピーチ
function pinColor(p) {
  if (p.kind === "plan") return "#f08c7d";
  return TripPlaces.AREA_BY_ID[p.place.area].pin;
}


const SVG_NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c) n.append(c);
  return n;
}

function flatten(items) {
  return items.flatMap((i) => [...(i.checked === null ? [] : [i]), ...flatten(i.children || [])]);
}

function renderList(items, depth, editable = false) {
  return el("ul", { class: `list depth-${depth}` }, items.map((item) =>
    el("li", { class: item.checked ? "done" : "" },
      editable && item.checked !== null ? el("div", { class: "row-pm" }, checkRow(item), pmButtons(item)) : checkRow(item),
      item.children?.length ? renderList(item.children, depth + 1, editable) : null,
      editable && state.addUnder === item.id
        ? addForm(`under-${item.id}`, `＋ ${item.label}の下に足す`, (text) => addItem(item, text, false), "mini under")
        : null,
    )));
}

function checkRow(item, day) {
  if (item.checked === null) return el("button", { type: "button", class: "note", onclick: () => openEditor(item) }, item.label);
  return el("div", { class: "check-row" },
    el("button", {
      type: "button", class: "box", role: "checkbox", "aria-checked": String(item.checked), "aria-label": `${item.label}を済みにする`,
      onclick: () => toggle(item),
    }, item.checked ? "✓" : ""),
    el("button", { type: "button", class: "label", onclick: () => openEditor(item, day) }, item.label,
      isTemp(item.id) ? el("span", { class: "pending", title: "未送信" }, " …") : null),
  );
}

// ---------- 直す画面（下から出るシート） ----------
function openEditor(item, day) {
  const timed = !!day;
  let time = item.time ? item.time.padStart(5, "0") : "";
  const timeInput = el("input", { type: "time", step: "300", value: time, "aria-label": "時刻" });
  const wish = !item.items && groupOf(item) && isWishGroup(groupOf(item));
  const price0 = wish ? priceOf(item.label) : 0;
  const baseLabel = wish ? item.label.replace(/[\s　]*([¥￥]\s?[\d,]+|[\d,]+\s?円)/u, "").trim() : item.label;
  const textInput = el("input", { type: "text", value: baseLabel, maxlength: "190", "aria-label": "内容" });
  const priceInput = el("input", { type: "number", inputmode: "numeric", min: "0", step: "10", value: price0 || "", placeholder: "例）2800", "aria-label": "価格（円）" });
  const close = () => { sheet.remove(); render(); };
  const isGroup = !!item.items;
  const canDelete = isGroup || item.checked !== null;
  const canHaveChildren = isGroup || item.checked !== null;
  const childInput = el("input", { type: "text", placeholder: "例）日焼け止め", maxlength: "190", enterkeyhint: "done", "aria-label": "下に足すもの",
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); addChild(); } } });
  const added = el("div", { class: "added" });
  function addChild() {
    const t = childInput.value.replace(/[\r\n]+/g, " ").trim();
    if (!t) return childInput.focus();
    addItem(item, t, false);
    added.append(el("span", { class: "added-chip" }, `✓ ${t}`));
    childInput.value = "";
    childInput.focus();
  }
  const nudge = (d) => {
    const base = timeInput.value || item.time || "12:00";
    timeInput.value = shiftTime(base, d).padStart(5, "0");
  };
  const sheet = el("div", { class: "sheet-wrap", onclick: (e) => { if (e.target === sheet) close(); } },
    el("form", {
      class: "sheet",
      onsubmit: (e) => {
        e.preventDefault();
        let label = textInput.value.replace(/[\r\n]+/g, " ").trim();
        if (!label) return textInput.focus();
        if (wish && Number(priceInput.value) > 0) label = `${label}　${yen(Number(priceInput.value))}`;
        if (isGroup) {
          if (label !== item.label) { item.label = label; queue({ op: "edit", id: item.id, text: label }); }
        } else saveItem(item, timed ? timeInput.value : null, label, day);
        close();
      },
    },
    el("div", { class: "sheet-grip", "aria-hidden": "true" }),
    el("h2", {}, timed ? "予定を直す" : isGroup ? "まとまりを直す" : "項目を直す"),
    timed ? el("label", { class: "field" }, el("span", {}, "時刻"),
      el("div", { class: "time-row" }, timeInput,
        el("button", { type: "button", class: "chip", onclick: () => nudge(-15) }, "−15分"),
        el("button", { type: "button", class: "chip", onclick: () => nudge(15) }, "＋15分"),
        el("button", { type: "button", class: "chip", onclick: () => { timeInput.value = ""; } }, "なし"))) : null,
    el("label", { class: "field" }, el("span", {}, "内容"), textInput),
    wish ? el("label", { class: "field" }, el("span", {}, "価格（円・税込）"), priceInput) : null,
    canHaveChildren ? el("div", { class: "field" }, el("span", {}, "この下（子）に足す"),
      el("div", { class: "time-row" }, childInput,
        el("button", { type: "button", class: "chip strong", onclick: addChild }, "足す")),
      added) : null,
    el("div", { class: "sheet-actions" },
      canDelete ? el("button", { type: "button", class: "ghost danger", onclick: () => { if (removeItem(item)) close(); } }, "消す") : null,
      el("span", { class: "spacer" }),
      el("button", { type: "button", class: "ghost", onclick: close }, "やめる"),
      el("button", { type: "submit", class: "primary" }, "保存")),
    ));
  document.body.append(sheet);
  setTimeout(() => (timed ? timeInput : textInput).focus(), 50);
}

// ---------- ドラッグで時刻を動かす（12px ごとに5分） ----------
function dragHandle(item, day) {
  const STEP_PX = 12;
  let startY = 0;
  let base = "";
  let next = "";
  let row = null;
  const move = (e) => {
    const dy = e.clientY - startY;
    next = shiftTime(base, Math.round(dy / STEP_PX) * 5);
    row.style.transform = `translateY(${dy}px)`;
    row.querySelector(".tl-time").textContent = next;
  };
  const end = (e) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    e.currentTarget.removeEventListener("pointermove", move);
    row.classList.remove("dragging");
    row.style.transform = "";
    state.dragging = false;
    if (next && next !== item.time) saveItem(item, next, item.label, day);
    else if (state.needsRender) render();
    state.needsRender = false;
    render();
  };
  return el("button", {
    type: "button", class: "drag", "aria-label": `${item.label}の時刻をドラッグで変える`,
    onpointerdown: (e) => {
      e.preventDefault();
      row = e.currentTarget.closest(".tl-row");
      startY = e.clientY;
      base = item.time || nearTime(day, item) || "12:00";
      next = "";
      state.dragging = true;
      row.classList.add("dragging");
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.currentTarget.addEventListener("pointermove", move);
    },
    onpointerup: end,
    onpointercancel: end,
  }, "⋮⋮");
}

function nearTime(day, item) {
  const i = day.items.indexOf(item);
  for (let k = i - 1; k >= 0; k--) if (day.items[k].time) return day.items[k].time;
  return day.items.find((x) => x.time)?.time || null;
}

function timedAddForm(day) {
  const timeInput = el("input", { type: "time", step: "300", "aria-label": "時刻" });
  const textInput = el("input", { type: "text", placeholder: "例）ベビーセンター", maxlength: "190", enterkeyhint: "done", "aria-label": "予定" });
  return el("form", {
    class: "add-form timed",
    "data-for": day.id,
    onsubmit: (e) => {
      e.preventDefault();
      const label = textInput.value.replace(/[\r\n]+/g, " ").trim();
      if (!label) return textInput.focus();
      addItem(day, composeText(timeInput.value, label), true);
      textInput.value = "";
      timeInput.value = "";
    },
  }, timeInput, textInput, el("button", { type: "submit", class: "primary small" }, "足す"));
}

function addForm(key, placeholder, onAdd, cls = "") {
  const input = el("input", { type: "text", placeholder, maxlength: "200", enterkeyhint: "done", "aria-label": placeholder });
  return el("form", {
    class: `add-form ${cls}`.trim(),
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
function toast(msg, actionLabel, action) {
  const t = $("toast");
  t.replaceChildren(el("span", {}, msg),
    actionLabel ? el("button", { type: "button", class: "toast-btn", onclick: () => { t.hidden = true; action(); } }, actionLabel) : null);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, actionLabel ? 5000 : 3500);
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
  if (document.visibilityState === "hidden") commitDelete();
  if (document.visibilityState === "visible") { render(); refresh(); }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
render();
refresh().then(() => loadHours());
