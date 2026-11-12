// 行きたい場所の状態（未定の管理）・地図で場所を決める・現在地からのルート・通行止め。
// app.js / detail.js の state・detail・el・render などを使う（関数の中でだけ使う）
"use strict";

// ---------- 行きたい場所の状態 ----------
// 文の形：「🎟 カリブの海賊 @35.63312,139.88012」（状態の絵文字・名前・地図の位置）
const WANT_STATUS = [
  ["🎟", "スタンバイパス"],
  ["⚡", "プレミアアクセス"],
  ["🍴", "食べる"],
  ["🛍", "買う"],
  ["🚶", "行きたい（未定）"],
];
const COORD_TAIL = /\s*@(-?\d+\.\d+),(-?\d+\.\d+)\s*$/u;

function parseWant(text) {
  let rest = String(text || "").trim();
  const c = rest.match(COORD_TAIL);
  if (c) rest = rest.replace(COORD_TAIL, "").trim();
  const st = WANT_STATUS.find(([e]) => rest.startsWith(e));
  if (st) rest = rest.slice(st[0].length).trim();
  return { status: st ? st[0] : "🚶", name: rest, lat: c ? Number(c[1]) : null, lon: c ? Number(c[2]) : null };
}

function composeWant({ status, name, lat, lon }) {
  return `${status || "🚶"} ${name}${lat != null ? ` @${lat.toFixed(5)},${lon.toFixed(5)}` : ""}`;
}

// 画面に出す名前（状態の絵文字と位置を外す）。行きたい場所以外は位置だけ外す
function displayLabel(item) {
  return String(item.label || "").replace(COORD_TAIL, "");
}

function setWant(item, patch) {
  const w = { ...parseWant(item.text), ...patch };
  const text = composeWant(w);
  if (text === item.text) return;
  item.text = text;
  item.label = text;
  queue({ op: "edit", id: item.id, text });
}

// ---------- 地図で場所を決める・通行止めにする（地図を押す） ----------
function startPick(item) {
  detail.blocking = false;
  detail.picking = item;
  state.tab = "map";
  render();
  document.querySelector(".map-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function onMapClick(ev) {
  // 1回押しただけで2回届く端末があるので、0.4秒以内の2回目は捨てる
  const now = performance.now();
  if (now - (detail.lastClickAt ?? -1e9) < 400) return;
  detail.lastClickAt = now;
  const { lat, lng } = ev.latlng;
  if (detail.picking) {
    const item = detail.picking;
    detail.picking = null;
    setWant(item, { lat, lon: lng });
    toast(`「${parseWant(item.text).name}」の場所を決めました`);
    render();
    return;
  }
  if (detail.blocking) toggleBlock(lat, lng);
}

function modeBanner() {
  if (detail.picking) {
    return el("div", { class: "mode-banner" },
      el("span", {}, `地図を押して「${parseWant(detail.picking.text).name}」の場所を決める`),
      el("button", { type: "button", onclick: () => { detail.picking = null; render(); } }, "やめる"));
  }
  if (detail.blocking) {
    return el("div", { class: "mode-banner block" },
      el("span", {}, "通れない道を押す（もう一度押すと戻す）"),
      blockedIds().size ? el("button", { type: "button", onclick: () => { saveBlocked(new Set()); drawBlocked(); rerouteIfActive(); render(); } }, "全部戻す") : null,
      el("button", { type: "button", onclick: () => { detail.blocking = false; render(); } }, "おわる"));
  }
  return null;
}

// ---------- 歩ける道（OpenStreetMap） ----------
const PATHS_STORAGE = "trip-shiori-paths";
const BLOCKED_STORAGE = "trip-shiori-blocked";
try { detail.paths = JSON.parse(localStorage.getItem(PATHS_STORAGE) || "null"); } catch { /* 無くても動く */ }

async function loadPaths() {
  if (detail.paths?.v === 1 && Date.now() - Date.parse(detail.paths.fetchedAt) < 7 * 864e5) return detail.paths;
  detail.paths = await api("GET", "/api/paths");
  detail.graph = null;
  try { localStorage.setItem(PATHS_STORAGE, JSON.stringify(detail.paths)); } catch { /* 容量が足りなくても動く */ }
  return detail.paths;
}

function meters(a, b) {
  const R = 6371000;
  const toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR;
  const dLon = (b[1] - a[1]) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// 点と線（道の一区間）のおおよその距離（m）
function distToSegment(p, a, b) {
  const k = Math.cos(p[0] * Math.PI / 180);
  const ax = (a[1] - p[1]) * k; const ay = a[0] - p[0];
  const bx = (b[1] - p[1]) * k; const by = b[0] - p[0];
  const dx = bx - ax; const dy = by - ay;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  const x = ax + t * dx; const y = ay + t * dy;
  return Math.sqrt(x * x + y * y) * 111320;
}

function buildGraph() {
  if (detail.graph) return detail.graph;
  const nodes = new Map(); // "lat,lon" → { p: [lat, lon], edges: [{ to, d, id }] }
  const segs = []; // 通行止めにするための区間 { id, a, b }
  const node = (lat, lon) => {
    const k = `${lat},${lon}`;
    if (!nodes.has(k)) nodes.set(k, { k, p: [lat, lon], edges: [] });
    return nodes.get(k);
  };
  for (const w of detail.paths?.ways || []) {
    for (let i = 0; i + 3 < w.length; i += 2) {
      const a = node(w[i], w[i + 1]);
      const b = node(w[i + 2], w[i + 3]);
      if (a === b) continue;
      const d = meters(a.p, b.p);
      const id = a.k < b.k ? `${a.k}|${b.k}` : `${b.k}|${a.k}`;
      a.edges.push({ to: b, d, id });
      b.edges.push({ to: a, d, id });
      segs.push({ id, a: a.p, b: b.p });
    }
  }
  detail.graph = { nodes: [...nodes.values()], segs };
  return detail.graph;
}

function nearestNode(g, p) {
  let best = null;
  let bd = Infinity;
  for (const n of g.nodes) {
    if (!n.edges.length) continue;
    const d = meters(n.p, p);
    if (d < bd) { bd = d; best = n; }
  }
  return { node: best, d: bd };
}

// いちばん短い道（通行止めの区間は通らない）
function shortestPath(g, from, to, blocked) {
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const heap = [[0, from]];
  const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1; const r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  while (heap.length) {
    const [d, n] = pop();
    if (n === to) break;
    if (d > (dist.get(n) ?? Infinity)) continue;
    for (const e of n.edges) {
      if (blocked.has(e.id)) continue;
      const nd = d + e.d;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, n); push([nd, e.to]); }
    }
  }
  if (!dist.has(to)) return null;
  const line = [];
  for (let n = to; n; n = prev.get(n)) line.unshift(n.p);
  return { line, m: dist.get(to) };
}

// ---------- 通行止め ----------
function blockedIds() {
  try { return new Set(JSON.parse(localStorage.getItem(BLOCKED_STORAGE) || "[]")); } catch { return new Set(); }
}
function saveBlocked(set) {
  try { localStorage.setItem(BLOCKED_STORAGE, JSON.stringify([...set])); } catch { /* 保存できなくても動く */ }
}

async function toggleBlock(lat, lon) {
  try { await loadPaths(); } catch (err) { return toast(err.message); }
  const g = buildGraph();
  let best = null;
  let bd = Infinity;
  for (const s of g.segs) {
    const d = distToSegment([lat, lon], s.a, s.b);
    if (d < bd) { bd = d; best = s; }
  }
  if (!best || bd > 25) return toast("近くに道がありません。道の上を押してください");
  const set = blockedIds();
  set.has(best.id) ? set.delete(best.id) : set.add(best.id);
  saveBlocked(set);
  drawBlocked();
  rerouteIfActive();
}

function drawBlocked() {
  const L = window.L;
  if (!L || !detail.map) return;
  if (!detail.blockLayer) detail.blockLayer = L.layerGroup().addTo(detail.map);
  detail.blockLayer.clearLayers();
  const set = blockedIds();
  if (!set.size) return;
  for (const id of set) {
    const [a, b] = id.split("|").map((k) => k.split(",").map(Number));
    L.polyline([a, b], { className: "blocked-line", interactive: false }).addTo(detail.blockLayer);
  }
}

// ---------- 現在地からのルート ----------
function googleWalk(from, to) {
  return `https://www.google.com/maps/dir/?api=1${from ? `&origin=${from.lat},${from.lon}` : ""}&destination=${to.lat},${to.lon}&travelmode=walking`;
}

function waitForMe(ms = 15000) {
  if (detail.me) return Promise.resolve(detail.me);
  if (detail.watchId == null) { detail.followOnce = false; startWatch(); document.querySelector(".locate-btn")?.classList.add("on"); }
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => (detail.me ? resolve(detail.me) : Date.now() - t0 > ms ? resolve(null) : setTimeout(tick, 300));
    tick();
  });
}

async function routeTo(target) {
  if (target.lat == null) return toast("この場所はまだ地図の位置がありません");
  detail.routeTarget = target;
  showRouteInfo({ msg: "ルートを計算しています…" });
  const me = await waitForMe();
  if (!me) { showRouteInfo({ msg: "現在地がわかりません。Google マップで開けます", target }); return; }
  try { await loadPaths(); } catch (err) { showRouteInfo({ msg: `道のデータが取れません（${err.message}）`, target, me }); return; }
  const g = buildGraph();
  const s = nearestNode(g, [me.lat, me.lon]);
  const e = nearestNode(g, [target.lat, target.lon]);
  if (!s.node || s.d > 300) { showRouteInfo({ msg: "パークの外にいるので、Google マップの徒歩ルートで", target, me }); return; }
  const r = shortestPath(g, s.node, e.node, blockedIds());
  if (!r) { showRouteInfo({ msg: "通行止めを避けるとたどり着けません。通行止めを減らしてください", target, me }); return; }
  const line = [[me.lat, me.lon], ...r.line, [target.lat, target.lon]];
  const total = r.m + s.d + e.d;
  drawRoute(line);
  detail.routeFrom = [me.lat, me.lon];
  showRouteInfo({ msg: `🚶 約${Math.max(1, Math.round(total / 70))}分（${Math.round(total / 10) * 10}m）・${target.name}`, target, me, ok: true });
}

function drawRoute(line) {
  const L = window.L;
  if (!L || !detail.map) return;
  if (!detail.routeLayer) detail.routeLayer = L.layerGroup().addTo(detail.map);
  detail.routeLayer.clearLayers();
  L.polyline(line, { className: "route-line-bg", interactive: false }).addTo(detail.routeLayer);
  L.polyline(line, { className: "route-line", interactive: false }).addTo(detail.routeLayer);
  detail.map.fitBounds(L.latLngBounds(line), { paddingTopLeft: [16, 110], paddingBottomRight: [16, 170], maxZoom: 18 });
}

function clearRoute() {
  detail.routeTarget = null;
  detail.routeInfo = null;
  detail.routeLayer?.clearLayers();
  document.querySelector(".route-info")?.remove();
}

// 歩いて 25m 以上動いたら、ルートを引き直す
function rerouteIfActive() {
  if (!detail.routeTarget || !detail.routeInfo?.ok) return;
  routeTo(detail.routeTarget);
}
function maybeReroute() {
  if (!detail.routeTarget || !detail.routeFrom || !detail.me) return;
  if (meters(detail.routeFrom, [detail.me.lat, detail.me.lon]) > 25) routeTo(detail.routeTarget);
}

function showRouteInfo(info) {
  detail.routeInfo = info;
  const wrap = document.querySelector(".map-wrap");
  if (!wrap) return;
  wrap.querySelector(".route-info")?.remove();
  wrap.append(routeInfoBox());
}

function routeInfoBox() {
  const info = detail.routeInfo;
  if (!info) return null;
  return el("div", { class: "route-info" },
    el("span", { class: "route-msg" }, info.msg),
    info.target ? el("a", { class: "chip small", href: googleWalk(info.me, info.target), target: "_blank", rel: "noopener" }, "Googleマップ") : null,
    el("button", { type: "button", class: "chip small", onclick: () => clearRoute() }, "×"));
}
