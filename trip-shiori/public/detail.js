// 詳しい地図（OpenStreetMap＋Leaflet）と、施設の検索。
// app.js の state・el・render などを使う（このファイルは app.js より先に読み、関数の中でだけ使う）
"use strict";

const POIS_STORAGE = "trip-shiori-pois";
const MODE_STORAGE = "trip-shiori-mapmode";
const POI_MAX_AGE = 7 * 864e5;
const PARK_BOUNDS = {
  land: [[35.6298, 139.8762], [35.6364, 139.8842]],
  sea: [[35.6228, 139.8812], [35.6302, 139.8915]],
};
const PARK_CENTER = { land: [35.6329, 139.8804], sea: [35.6267, 139.8851] };

const detail = {
  pois: null, // { pois: [...], fetchedAt }
  loading: false,
  error: "",
  map: null,
  box: null,
  layer: null,
  leafletLoading: null,
  q: "",
  kind: "all",
  fly: null,
};
try { detail.pois = JSON.parse(localStorage.getItem(POIS_STORAGE) || "null"); } catch { /* 無くても動く */ }

function mapMode() {
  try { return localStorage.getItem(MODE_STORAGE) || "simple"; } catch { return "simple"; }
}
function setMapMode(m) {
  try { localStorage.setItem(MODE_STORAGE, m); } catch { /* 保存できなくても動く */ }
}

// ---------- データ ----------
async function loadPois(force = false) {
  const fresh = detail.pois && Date.now() - Date.parse(detail.pois.fetchedAt) < POI_MAX_AGE;
  if (detail.loading || (fresh && !force)) return;
  detail.loading = true;
  detail.error = "";
  try {
    detail.pois = await api("GET", "/api/pois");
    try { localStorage.setItem(POIS_STORAGE, JSON.stringify(detail.pois)); } catch { /* 容量が足りなくても動く */ }
  } catch (err) {
    detail.error = err.message;
  } finally {
    detail.loading = false;
    render();
  }
}

function parkOf(lat, lon) {
  const d = (c) => (lat - c[0]) ** 2 + (lon - c[1]) ** 2;
  return d(PARK_CENTER.land) <= d(PARK_CENTER.sea) ? "land" : "sea";
}

// 辞書（エリア・ビールの印）と OpenStreetMap（座標・トイレ）をまとめた検索用の一覧
function searchIndex() {
  const { PLACE_INDEX, norm } = TripPlaces;
  const osm = (detail.pois?.pois || []).map((p) => ({ ...p, key: norm(p.n), park: parkOf(p.lat, p.lon) }));
  const byKey = new Map();
  for (const p of osm) if (p.key && !byKey.has(p.key)) byKey.set(p.key, p);
  const used = new Set();
  const out = PLACE_INDEX.map((e) => {
    let hit = byKey.get(e.key);
    if (!hit) hit = osm.find((p) => p.key.length >= 3 && (p.key.includes(e.key) || e.key.includes(p.key)));
    if (hit) used.add(hit);
    return { name: e.name, kind: e.kind, park: e.park, area: e.area, beer: e.beer, baby: e.kind === "baby", lat: hit?.lat, lon: hit?.lon, ct: hit?.ct };
  });
  for (const p of osm) {
    if (used.has(p)) continue;
    const place = TripPlaces.findPlace(p.n);
    out.push({ name: p.n, kind: p.k, park: p.park, area: place?.area || null, beer: false, baby: p.k === "baby", lat: p.lat, lon: p.lon, ct: p.ct, osm: true });
  }
  return out;
}

const KIND_WORDS = [
  [/トイレ|お手洗い|化粧室|wc/iu, "toilet"],
  [/ビール|酒|アルコール|お酒|ワイン/u, "beer"],
  [/ベビー|授乳|おむつ|オムツ|ミルク|赤ちゃん/u, "baby"],
  [/ショップ|お土産|おみやげ|グッズ/u, "shop"],
  [/レストラン|食事|ごはん|カフェ|軽食|食べ/u, "food"],
  [/アトラクション|乗り物|ライド/u, "ride"],
];

function matchKind(e, kind) {
  if (kind === "all") return true;
  if (kind === "beer") return e.beer;
  if (kind === "baby") return e.baby || (e.kind === "toilet" && e.ct);
  return e.kind === kind;
}

function runSearch() {
  const { norm } = TripPlaces;
  let kind = detail.kind;
  let q = detail.q.trim();
  for (const [re, k] of KIND_WORDS) {
    if (q && re.test(q)) { kind = k; q = q.replace(re, "").trim(); break; }
  }
  if (!q && kind === "all") return { kind, list: [] };
  const nq = norm(q);
  const list = searchIndex()
    .filter((e) => matchKind(e, kind) && (!nq || norm(e.name).includes(nq)))
    .sort((a, b) => (a.park === state.park ? 0 : 1) - (b.park === state.park ? 0 : 1) || a.name.localeCompare(b.name, "ja"));
  return { kind, list };
}

// ---------- 検索の画面 ----------
function renderSearch() {
  const { KINDS, PARKS, AREA_BY_ID } = TripPlaces;
  const { kind, list } = runSearch();
  if ((kind === "toilet" || kind === "baby") && !detail.pois && !detail.loading && !detail.error) setTimeout(() => loadPois(), 0);
  const input = el("input", {
    type: "search", value: detail.q, placeholder: "さがす　例）トイレ・ビール・カレー・プーさん", enterkeyhint: "search", "aria-label": "施設をさがす",
    oninput: (e) => { detail.q = e.target.value; clearTimeout(detail.t); detail.t = setTimeout(() => { render(); refocusSearch(); }, 250); },
  });
  const chips = el("div", { class: "kind-chips" },
    [["all", "すべて"], ...Object.entries(KINDS).map(([k, v]) => [k, `${v.icon} ${v.name}`])].map(([k, label]) =>
      el("button", {
        type: "button", class: "chip", "aria-pressed": String(detail.kind === k),
        onclick: () => {
          detail.kind = detail.kind === k ? "all" : k;
          if (["toilet", "baby"].includes(detail.kind)) loadPois();
          render();
        },
      }, label)));

  const notes = [];
  if ((kind === "toilet" || kind === "baby") && !detail.pois) {
    notes.push(detail.loading ? "地図のデータを読み込み中…" : "トイレの位置は「詳しい地図」のデータ（OpenStreetMap）を読むと出ます。");
  }
  if (kind === "toilet") notes.push("トイレはどのエリアにもあり、ほぼすべてにおむつ交換台があります（下調べの目安）。");
  if (kind === "beer") notes.push("🍺 は下調べでビールの取り扱いがあった店（目安）。季節で変わるので当日は公式アプリで。");
  if (kind === "baby") notes.push("ベビーセンター：ランドはワールドバザール、シーはメディテレーニアンハーバー。授乳室はマーメイドラグーンなどにも（要確認）。");
  if (detail.error) notes.push(detail.error);

  const rows = list.slice(0, 40).map((e) => {
    const area = e.area ? AREA_BY_ID[e.area].short || AREA_BY_ID[e.area].name : "";
    return el("li", { class: "hit" },
      el("span", { class: "hit-icon", "aria-hidden": "true" }, (e.beer ? KINDS.beer : KINDS[e.kind] || KINDS.ride).icon),
      el("div", { class: "hit-main" },
        el("div", { class: "hit-name" }, e.name),
        el("div", { class: "hit-sub" }, [PARKS[e.park].name, area, e.ct ? "おむつ交換台" : "", e.beer ? "ビール" : ""].filter(Boolean).join("・"))),
      el("button", { type: "button", class: "map-btn tight", onclick: () => showOnMap(e) }, pinIcon(), "地図"),
      e.kind !== "toilet" ? el("button", { type: "button", class: "chip strong small", "aria-label": `${e.name}を行きたい場所に足す`, onclick: () => { addPlace(e.name); toast(`「${e.name}」を行きたい場所に足しました`); } }, "＋") : null,
    );
  });

  return el("section", { class: "card search-card" },
    el("div", { class: "search-row" }, input),
    chips,
    ...notes.map((n) => el("p", { class: "sub" }, n)),
    list.length ? el("ul", { class: "list hits" }, rows) : (detail.q || detail.kind !== "all") ? el("p", { class: "sub" }, "見つかりませんでした") : null,
    list.length > 40 ? el("p", { class: "sub" }, `ほか ${list.length - 40} 件。ことばを足して絞ってください`) : null,
  );
}

function refocusSearch() {
  const i = document.querySelector('.search-card input[type="search"]');
  if (i) { i.focus(); const v = i.value; i.setSelectionRange?.(v.length, v.length); }
}

function showOnMap(e) {
  if (e.park !== state.park) { state.park = e.park; save(PARK_STORAGE, e.park); }
  if (e.lat != null) {
    setMapMode("detail");
    detail.fly = e;
    render();
    document.querySelector(".map-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const q = `${e.name} ${TripPlaces.PARKS[e.park].search}`;
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, "_blank", "noopener");
}

// ---------- 詳しい地図 ----------
function ensureLeaflet() {
  if (window.L) return Promise.resolve();
  if (detail.leafletLoading) return detail.leafletLoading;
  detail.leafletLoading = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "vendor/leaflet/leaflet.css";
    document.head.append(css);
    const js = document.createElement("script");
    js.src = "vendor/leaflet/leaflet.js";
    js.onload = resolve;
    js.onerror = () => reject(new Error("地図の部品を読み込めませんでした"));
    document.head.append(js);
  });
  return detail.leafletLoading;
}

function detailMap(pins) {
  if (!detail.box) detail.box = el("div", { class: "leaflet-box" });
  loadPois();
  ensureLeaflet().then(() => drawDetail(pins)).catch((err) => { detail.error = err.message; });
  return detail.box;
}

function drawDetail(pins) {
  const L = window.L;
  if (!detail.map) {
    detail.map = L.map(detail.box, { zoomControl: true, attributionControl: true, maxZoom: 19 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(detail.map);
    detail.layer = L.layerGroup().addTo(detail.map);
    detail.shownPark = "";
  }
  setTimeout(() => detail.map.invalidateSize(), 0);
  if (detail.shownPark !== state.park) {
    detail.map.fitBounds(PARK_BOUNDS[state.park]);
    detail.shownPark = state.park;
  }
  detail.layer.clearLayers();
  const { KINDS } = TripPlaces;
  const index = searchIndex().filter((e) => e.lat != null);
  const { list } = runSearch();
  const highlight = new Set(list.map((e) => e.name));
  // すべての施設を小さなアイコンで。検索に当たったものは大きく
  for (const e of index) {
    const big = highlight.has(e.name);
    const icon = L.divIcon({
      className: `poi${big ? " hit" : ""}${highlight.size && !big ? " dim" : ""}`,
      html: `<span>${(e.beer ? KINDS.beer : KINDS[e.kind] || KINDS.ride).icon}</span>`,
      iconSize: big ? [28, 28] : [18, 18],
    });
    L.marker([e.lat, e.lon], { icon, title: e.name, zIndexOffset: big ? 500 : 0 })
      .bindPopup(() => poiPopup(e))
      .addTo(detail.layer);
  }
  // 行きたい場所・予定の番号ピン（座標がわかるものだけ）
  const byName = new Map(index.map((e) => [TripPlaces.norm(e.name), e]));
  for (const p of pins) {
    const e = p.place?.name && byName.get(TripPlaces.norm(p.place.name));
    if (!e) continue;
    const icon = L.divIcon({
      className: `num-pin${p.item.checked ? " done" : ""}`,
      html: `<span style="background:${pinColor(p)}"><i>${p.no}</i></span>`,
      iconSize: [26, 26],
      iconAnchor: [13, 26],
    });
    L.marker([e.lat, e.lon], { icon, title: p.item.label, zIndexOffset: 1000 }).bindPopup(() => poiPopup(e, p)).addTo(detail.layer);
  }
  if (detail.fly) {
    const f = detail.fly;
    detail.fly = null;
    detail.map.setView([f.lat, f.lon], 18);
    L.popup().setLatLng([f.lat, f.lon]).setContent(poiPopup(f)).openOn(detail.map);
  }
}

function poiPopup(e, pin) {
  const { KINDS } = TripPlaces;
  const q = `${e.name} ${TripPlaces.PARKS[e.park].search}`;
  return el("div", { class: "poi-pop" },
    el("b", {}, `${(e.beer ? KINDS.beer : KINDS[e.kind] || KINDS.ride).icon} ${e.name}`),
    pin?.when ? el("div", {}, `予定 ${pin.when}`) : null,
    e.ct ? el("div", {}, "おむつ交換台あり") : null,
    el("div", { class: "poi-pop-btns" },
      e.kind !== "toilet" && !pin ? el("button", { type: "button", class: "chip strong small", onclick: () => { addPlace(e.name); toast(`「${e.name}」を行きたい場所に足しました`); } }, "＋ 行きたい") : null,
      el("a", { class: "chip small", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, target: "_blank", rel: "noopener" }, "Googleマップ")));
}
