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

function isPlacesGroup(g) {
  return /行きたい場所/u.test(g.label);
}

// 行きたい場所は「📍 行きたい場所」のまとまりに足す（無ければ作る）
function addPlace(text) {
  const g = state.trip.groups.find(isPlacesGroup) || addGroup(PLACES_LABEL);
  addItem(g, text, false);
  const hit = TripPlaces.findPlace(text);
  if (hit && TripPlaces.AREA_BY_ID[hit.area].park !== state.park) {
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
  if (state.dragging) { state.needsRender = true; return; }
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
  const ids = [...state.trip.days.map((d) => d.id), "map", "prep"];
  if (!ids.includes(state.tab)) state.tab = defaultTab();
  renderTabs();
  const day = state.trip.days.find((d) => d.id === state.tab);
  const scroll = $("main").scrollTop;
  $("view").replaceChildren(...(day ? renderDay(day) : state.tab === "map" ? renderMap() : renderPrep()));
  $("main").scrollTop = scroll;
  renderSync();
}

function renderTabs() {
  const tabs = state.trip.days.map((d) => {
    const { md, w } = shortDate(d.date);
    const isToday = d.date === todayStr();
    return tabBtn(d.id, el("span", { class: "tab-md" }, md), el("span", { class: "tab-w" }, isToday ? "今日" : w));
  });
  tabs.push(tabBtn("map", el("span", { class: "tab-md" }, "マップ"), el("span", { class: "tab-w" }, "行きたい")));
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
    day.items.length ? el("ol", { class: "timeline" }, rows) : el("div", { class: "card empty" }, "予定はまだありません"),
    timedAddForm(day),
    el("p", { class: "hint" }, "丸で済み。時刻か文字を押すと直せます。右の ⋮⋮ を上下にドラッグすると時刻が5分ずつ動きます。"),
  ];
}

function renderPrep() {
  const cards = state.trip.groups.filter((g) => !isPlacesGroup(g)).map((g) => {
    const flat = flatten(g.items);
    const done = flat.filter((i) => i.checked).length;
    return el("section", { class: "card group" },
      el("div", { class: "group-head" },
        el("button", { type: "button", class: "group-title", onclick: () => openEditor(g) }, g.label),
        el("span", { class: `count${flat.length && done === flat.length ? " all" : ""}` }, `${done}/${flat.length}`),
      ),
      g.items.length ? renderList(g.items, 0) : null,
      addForm(g.id, `＋ ${g.label}に足す`, (text) => addItem(g, text, false), "mini"),
    );
  });
  return [
    addForm("new-group", "＋ 親（まとまり）を足す　例）👕 服装", (text) => addGroup(text), "mini parent"),
    ...cards,
    el("p", { class: "hint" }, "丸で済み。項目を押すと、文字を直したり、その下（子）に足したりできます。"),
  ];
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

function renderMap() {
  const { PARKS, AREA_BY_ID } = TripPlaces;
  const all = mapPins();
  const placed = all.filter((p) => p.place);
  const unknown = all.filter((p) => !p.place && p.kind === "want");
  const park = PARKS[state.park] || PARKS.land;
  const pins = placed.filter((p) => AREA_BY_ID[p.place.area].park === state.park);
  pins.forEach((p, i) => { p.no = i + 1; });

  const seg = el("div", { class: "seg", role: "tablist" }, Object.entries(PARKS).map(([id, pk]) => {
    const n = placed.filter((p) => AREA_BY_ID[p.place.area].park === id).length;
    return el("button", {
      type: "button", role: "tab", "aria-selected": String(state.park === id),
      onclick: () => { state.park = id; state.focus = ""; save(PARK_STORAGE, id); render(); },
    }, pk.name, n ? el("span", { class: "seg-n" }, String(n)) : null);
  }));

  const byArea = park.areas.map((a) => ({ area: a, pins: pins.filter((p) => p.place.area === a.id) }));
  const rows = byArea.filter((g) => g.pins.length).map((g) =>
    el("section", { class: "card area-card", style: `border-left: 6px solid ${g.area.color}` },
      el("h3", {}, g.area.name),
      el("ul", { class: "list" }, g.pins.map((p) =>
        el("li", { class: `pin-row${p.item.checked ? " done" : ""}${state.focus === p.item.id ? " focus" : ""}`, id: `pin-${p.item.id}` },
          el("span", { class: `pin-no ${p.kind}` }, String(p.no)),
          el("div", { class: "pin-main" },
            checkRow(p.item),
            p.kind === "plan" ? el("div", { class: "pin-when" }, `予定 ${p.when}`) : null,
            p.place.name && TripPlaces.norm(p.place.name) !== TripPlaces.norm(p.item.label) ? el("div", { class: "pin-when" }, `→ ${p.place.name}`) : null,
          ),
          el("a", { class: "map-btn tight", href: placeSearch(p, park), target: "_blank", rel: "noopener" }, pinIcon(), "地図"),
        ))),
    ));

  return [
    seg,
    el("div", { class: "card map-card" }, parkSvg(park, pins)),
    el("p", { class: "hint" }, "位置関係の目安の自作図です（公式マップではありません）。番号を押すと下の行に移ります。"),
    addForm("place", "例）カリブの海賊／ジャングル", (text) => addPlace(text)),
    ...(rows.length ? rows : [el("div", { class: "card empty" }, `${park.name}の行きたい場所はまだありません`)]),
    unknown.length ? el("section", { class: "card area-card unknown" },
      el("h3", {}, "場所がわからないもの"),
      el("p", { class: "sub" }, "名前を長押しで直すか、後ろに（エリア名）を付けると地図に出ます。例）ポップコーン（トゥーンタウン）"),
      el("ul", { class: "list" }, unknown.map((p) => el("li", { class: p.item.checked ? "done" : "" }, checkRow(p.item)))),
    ) : null,
  ];
}

function placeSearch(p, park) {
  const q = `${p.place.name || p.item.label} ${park.search}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
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

function parkSvg(park, pins) {
  const w = park.water;
  const nodes = [
    svg("rect", { x: 0, y: 0, width: 100, height: 100, rx: 6, class: "map-bg" }),
    svg("ellipse", { cx: w.cx, cy: w.cy, rx: w.rx, ry: w.ry, class: "map-water" }),
    svg("text", { x: 50, y: 98.5, class: "map-gate-label" }, "▲ 入口"),
  ];
  for (const a of park.areas) {
    nodes.push(svg("rect", { x: a.x - a.w / 2, y: a.y - a.h / 2, width: a.w, height: a.h, rx: 5, fill: a.color, class: "map-area" }));
    nodes.push(svg("text", { x: a.x, y: a.y - a.h / 2 + 4, class: "map-label" }, a.short || a.name));
  }
  for (const a of park.areas) {
    const here = pins.filter((p) => p.place.area === a.id);
    here.forEach((p, i) => {
      const cols = Math.max(1, Math.floor((a.w - 2) / 7));
      const rows = Math.ceil(here.length / cols);
      const x = a.x - ((Math.min(here.length, cols) - 1) * 7) / 2 + (i % cols) * 7;
      const y = a.y + 2 - ((rows - 1) * 7) / 2 + Math.floor(i / cols) * 7;
      const focus = state.focus === p.item.id;
      nodes.push(svg("g", {
        class: `map-pin ${p.kind}${p.item.checked ? " done" : ""}${focus ? " focus" : ""}`,
        transform: `translate(${x} ${y})`,
        role: "button",
        "aria-label": p.item.label,
        onclick: () => {
          state.focus = p.item.id;
          render();
          document.getElementById(`pin-${p.item.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        },
      }, svg("circle", { r: 3.1 }), svg("text", { y: 1.1 }, String(p.no))));
    });
  }
  return svg("svg", { viewBox: "0 0 100 100", class: "park-map", role: "img", "aria-label": `${park.name}の模式図` }, nodes);
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
  const textInput = el("input", { type: "text", value: item.label, maxlength: "190", "aria-label": "内容" });
  const close = () => { sheet.remove(); render(); };
  const isGroup = !!item.items;
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
        const label = textInput.value.replace(/[\r\n]+/g, " ").trim();
        if (!label) return textInput.focus();
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
    canHaveChildren ? el("div", { class: "field" }, el("span", {}, "この下（子）に足す"),
      el("div", { class: "time-row" }, childInput,
        el("button", { type: "button", class: "chip strong", onclick: addChild }, "足す")),
      added) : null,
    el("div", { class: "sheet-actions" },
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
