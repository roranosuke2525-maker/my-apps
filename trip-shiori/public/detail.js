// 詳しい地図（OpenStreetMap＋Leaflet）と、施設の検索。
// app.js の state・el・render などを使う（このファイルは app.js より先に読み、関数の中でだけ使う）
"use strict";

const POIS_STORAGE = "trip-shiori-pois";
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

// ---------- データ ----------
async function loadPois(force = false) {
  const fresh = detail.pois?.v === 3 && Date.now() - Date.parse(detail.pois.fetchedAt) < POI_MAX_AGE;
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
// 辞書（エリア・お酒のメニュー）と OpenStreetMap（座標・トイレ）を合わせた一覧。
// 店の名前は日本語名・英語名の両方で合わせ、名前だけの建物（k: named）も座標の手がかりにする
function searchIndex() {
  if (detail.indexFor === detail.pois && detail.index) return detail.index;
  const { PLACE_INDEX, norm } = TripPlaces;
  const osm = (detail.pois?.pois || []).map((p) => ({
    ...p, key: norm(p.n), enKey: p.en ? norm(p.en) : "", park: p.p || parkOf(p.lat, p.lon),
  }));
  const byKey = new Map();
  // 店・アトラクションの印がある方を先に登録（名前だけの建物より優先）
  for (const p of [...osm.filter((x) => x.k !== "named"), ...osm.filter((x) => x.k === "named")]) {
    for (const k of [p.key, p.enKey]) if (k && !byKey.has(k)) byKey.set(k, p);
  }
  const near = (e) => osm.find((p) => p.park === e.park && [p.key, p.enKey].some((k) =>
    k.length >= 4 && [e.key, e.enKey].some((x) => x.length >= 4 && (k.includes(x) || x.includes(k)))));
  const used = new Set();
  const out = PLACE_INDEX.map((e) => {
    const hit = byKey.get(e.key) || (e.enKey && byKey.get(e.enKey)) || near(e);
    if (hit) used.add(hit);
    return {
      name: e.name, kind: e.kind, park: e.park, area: e.area, beer: e.beer, drinks: e.drinks, baby: e.kind === "baby",
      lat: hit?.lat, lon: hit?.lon, ct: hit?.ct,
    };
  });
  for (const p of osm) {
    if (used.has(p) || p.k === "named") continue;
    const place = TripPlaces.findPlace(p.n);
    out.push({ name: p.n, kind: p.k, park: p.park, area: place?.area || null, beer: false, baby: p.k === "baby", lat: p.lat, lon: p.lon, ct: p.ct, osm: true });
  }
  detail.index = out;
  detail.indexFor = detail.pois;
  return out;
}

// お酒のメニューを1行に（例：一番搾り ¥800 ほか・持ち歩き○）
function drinksLine(d) {
  if (!d) return "";
  const first = d.menu[0];
  return `${first[0].replace(/^キリン/, "").replace(/生ビール$/, "")} ¥${first[1].toLocaleString("ja-JP")}${d.menu.length > 1 ? ` ほか${d.menu.length - 1}` : ""}・${d.to ? "持ち歩き○" : "店内だけ"}`;
}

const KIND_WORDS = [
  [/トイレ|お手洗い|化粧室|wc/iu, "toilet"],
  [/ビール|酒|アルコール|お酒|ワイン/u, "beer"],
  [/ベビー|授乳|おむつ|オムツ|ミルク|赤ちゃん/u, "baby"],
  [/グッズ|お土産|おみやげ|土産/u, "goods"],
  [/ショップ|お店/u, "shop"],
  [/レストラン|食事|ごはん|カフェ|軽食|食べ/u, "food"],
  [/アトラクション|乗り物|ライド/u, "ride"],
];

function matchKind(e, kind) {
  if (kind === "all") return true;
  if (kind === "beer") return e.beer;
  if (kind === "baby") return e.baby || (e.kind === "toilet" && e.ct);
  if (kind === "goods") return e.kind === "shop";
  return e.kind === kind;
}

function runSearch() {
  const { norm } = TripPlaces;
  let kind = detail.kind;
  let q = detail.q.trim();
  for (const [re, k] of KIND_WORDS) {
    if (q && re.test(q)) { kind = k; q = q.replace(re, "").trim(); break; }
  }
  if (!q && kind === "all") return { kind, q, list: [] };
  const nq = kind === "goods" ? "" : norm(q);
  const list = searchIndex()
    .filter((e) => e.park === state.park && matchKind(e, kind) && (!nq || norm(e.name).includes(nq)))
    .sort((a, b) => (a.lat != null ? 0 : 1) - (b.lat != null ? 0 : 1) // 地図に出るものを先に
      || a.name.localeCompare(b.name, "ja"));
  return { kind, q, list };
}

// ---------- 地図（検索を上に、結果を下に重ねる） ----------
// 検索欄は1つの入力欄を使い回し、入力中は画面全体を描き直さない（日本語の変換が途切れないように）
function searchInput() {
  if (detail.input) return detail.input;
  const input = el("input", { type: "search", placeholder: "さがす　例）トイレ・ビール・カチューシャ", enterkeyhint: "search", "aria-label": "施設やグッズをさがす", autocomplete: "off" });
  const changed = () => {
    if (detail.composing) return;
    clearTimeout(detail.t);
    detail.t = setTimeout(() => { detail.q = input.value; detail.cardsX = 0; refreshSearch(); }, 250);
  };
  input.addEventListener("compositionstart", () => { detail.composing = true; });
  input.addEventListener("compositionend", () => {
    detail.composing = false;
    changed();
    if (state.needsRender) { state.needsRender = false; render(); input.focus(); } // 変換中に待たせた描き直し
  });
  input.addEventListener("input", changed);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) input.blur(); });
  detail.input = input;
  return input;
}

function mapView(pins) {
  detail.lastPins = pins;
  const input = searchInput();
  if (document.activeElement !== input) input.value = detail.q;
  return el("div", { class: "card map-card detail" },
    el("div", { class: "map-wrap" },
      detailMap(pins),
      el("div", { class: "map-top" },
        el("div", { class: `search-row${detail.q.trim() || detail.kind !== "all" ? " has-q" : ""}` }, input,
          el("button", { type: "button", class: "search-clear", "aria-label": "検索をやめる", onclick: () => { detail.q = ""; input.value = ""; detail.kind = "all"; refreshSearch(); } }, "×")),
        el("div", { class: "map-top-extra" }, ...searchExtras())),
      el("div", { class: "map-bottom" }, ...searchResults()),
      el("button", {
        type: "button", class: `locate-btn${detail.watchId != null ? " on" : ""}`, "aria-label": "現在地を表示",
        onclick: () => locateMe(),
      }, locateIcon()),
    ));
}

// ---------- 現在地 ----------
function locateIcon() {
  const n = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  n.setAttribute("viewBox", "0 0 24 24");
  n.setAttribute("aria-hidden", "true");
  n.innerHTML = '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>';
  return n;
}

// 押すと位置を見張りはじめ、最初の1回だけそこへ寄る。見張っている間にもう一度押すと現在地へ戻る
function locateMe() {
  if (!navigator.geolocation) return toast("この端末では現在地が使えません");
  detail.followOnce = true;
  if (detail.me) centerOnMe();
  if (detail.watchId != null) return;
  startWatch();
  document.querySelector(".locate-btn")?.classList.add("on");
}

function startWatch() {
  detail.watchId = navigator.geolocation.watchPosition(
    (p) => {
      detail.me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
      drawMe();
      if (detail.followOnce) centerOnMe();
    },
    (err) => {
      stopWatch();
      document.querySelector(".locate-btn")?.classList.remove("on");
      toast(err.code === 1
        ? "位置情報が許可されていません（設定 → プライバシー → 位置情報 → Safari の Web サイト）"
        : "現在地がわかりませんでした。空の見える所でもう一度");
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  );
}

function stopWatch() {
  if (detail.watchId != null) navigator.geolocation.clearWatch(detail.watchId);
  detail.watchId = null;
}

function centerOnMe() {
  if (!detail.map || !detail.me) return;
  detail.followOnce = false;
  const { lat, lon } = detail.me;
  detail.map.setView([lat, lon], Math.max(detail.map.getZoom(), 17));
  const b = PARK_BOUNDS[state.park];
  const inPark = lat >= b[0][0] - 0.002 && lat <= b[1][0] + 0.002 && lon >= b[0][1] - 0.002 && lon <= b[1][1] + 0.002;
  if (!inPark) toast("いまはパークの外にいます");
}

function drawMe() {
  const L = window.L;
  if (!L || !detail.map || !detail.me) return;
  const { lat, lon, acc } = detail.me;
  if (!detail.meDot) {
    detail.meRing = L.circle([lat, lon], { radius: acc, className: "me-ring", interactive: false }).addTo(detail.map);
    detail.meDot = L.circleMarker([lat, lon], { radius: 7, className: "me-dot", interactive: false }).addTo(detail.map);
  } else {
    detail.meRing.setLatLng([lat, lon]).setRadius(acc);
    detail.meDot.setLatLng([lat, lon]);
  }
}

// 画面を離れたら見張りを止め、戻ったら続ける（電池のため）
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && detail.watchId != null) { stopWatch(); detail.resumeWatch = true; }
  else if (document.visibilityState === "visible" && detail.resumeWatch) { detail.resumeWatch = false; startWatch(); }
});

// 検索が変わったら、種類のボタン・注意書き・結果のカード・地図のアイコンだけを入れ替える
function refreshSearch() {
  const top = document.querySelector(".map-top-extra");
  const bottom = document.querySelector(".map-bottom");
  if (!top || !bottom) return render();
  const [chips, note] = searchExtras();
  if (chips.parentNode !== top) top.prepend(chips);
  for (const n of [...top.children]) if (n !== chips) n.remove();
  if (note) top.append(note);
  bottom.replaceChildren(...searchResults());
  document.querySelector(".search-row")?.classList.toggle("has-q", !!(detail.q.trim() || detail.kind !== "all"));
  if (window.L && detail.map) drawDetail(detail.lastPins || []);
}

function kindChips(kind) {
  const { KINDS } = TripPlaces;
  if (!detail.chips) {
    detail.chips = el("div", { class: "kind-chips", onscroll: (e) => { detail.chipsX = e.target.scrollLeft; } },
      Object.entries(KINDS).map(([k, v]) =>
        el("button", {
          type: "button", class: "chip", "data-kind": k,
          onclick: () => { detail.kind = detail.kind === k ? "all" : k; detail.cardsX = 0; refreshSearch(); },
        }, `${v.icon} ${v.name}`)));
  }
  for (const b of detail.chips.children) b.setAttribute("aria-pressed", String(b.dataset.kind === kind));
  // 画面を描き直して並びを付け直したときも、横の位置を戻す
  requestAnimationFrame(() => { if (detail.chips.scrollLeft !== (detail.chipsX || 0)) detail.chips.scrollLeft = detail.chipsX || 0; });
  return detail.chips;
}

function searchExtras() {
  const { kind } = runSearch();
  const chips = kindChips(kind);
  const h = todayHours();
  const note =
    detail.loading && !detail.pois ? "地図のデータを読み込み中…"
      : detail.error ? detail.error
        : kind === "beer" ? `🍺 ${TripPlaces.DRINKS_SOURCE}。当日は公式アプリで`
          : kind === "toilet" ? "どのトイレにもほぼおむつ交換台あり（目安）"
            : kind === "baby" ? "ベビーセンター：ワールドバザール（トゥモローランド寄り）"
              : kind === "goods" ? "グッズの価格は公式のグッズ検索で。下のカードから開けます"
                : h ? `きょうの${TripPlaces.PARKS[state.park].name}：${h}` : "";
  return [chips, note ? el("div", { class: "map-note" }, note) : null].filter(Boolean);
}

function searchResults() {
  const { KINDS, AREA_BY_ID } = TripPlaces;
  const { kind, q, list } = runSearch();
  const searching = !!(detail.q.trim() || kind !== "all");
  if (!searching) return [];
  const withPos = list.filter((e) => e.lat != null);
  const cards = [];
  // グッズ：公式のグッズ検索（価格つき）とディズニーストアを先頭に
  if (kind === "goods" || q) {
    const word = q || "";
    cards.push(goodsCard("🎁", word ? `「${word}」のグッズを公式でさがす` : "公式のグッズ検索をひらく", "価格・販売店つき（公式サイト）",
      `https://search.tokyodisneyresort.jp/search?query=${encodeURIComponent(word || "グッズ")}&category=2&site=IBRSO1WA&charset=UTF-8`, word));
    if (kind === "goods") {
      cards.push(goodsCard("🛒", word ? `「${word}」をディズニーストアでさがす` : "ディズニーストア.jp をひらく", "パークの外の通販",
        `https://store.disney.co.jp/search/?q=${encodeURIComponent(word)}`, ""));
    }
  }
  for (const e of list.slice(0, 40)) {
    const area = e.area ? AREA_BY_ID[e.area].short || AREA_BY_ID[e.area].name : "";
    cards.push(el("div", {
      class: `hit-card${e.lat == null ? " nopos" : ""}`, role: "button", tabindex: "0",
      onclick: () => showOnMap(e),
    },
    el("div", { class: "hit-top" },
      el("span", { class: "hit-icon", "aria-hidden": "true" }, (e.beer ? KINDS.beer : KINDS[e.kind] || KINDS.ride).icon),
      el("span", { class: "hit-name" }, e.name)),
    el("div", { class: "hit-sub" }, [area, e.ct ? "おむつ台" : "", e.lat == null ? "位置なし→Google" : ""].filter(Boolean).join("・")),
    e.drinks ? el("div", { class: "hit-drink" }, `🍺 ${drinksLine(e.drinks)}`) : null,
    e.kind !== "toilet" ? el("button", {
      type: "button", class: "chip strong small", "aria-label": `${e.name}を行きたい場所に足す`,
      onclick: (ev) => { ev.stopPropagation(); addPlace(e.name); toast(`「${e.name}」を行きたい場所に足しました`); },
    }, "＋ 行きたい") : null));
  }
  const count = list.length
    ? `${kind === "goods" ? "ショップ " : ""}${list.length}件${withPos.length < list.length ? `（地図に出るのは${withPos.length}件）` : ""}`
    : kind === "goods" || q ? "" : "見つかりませんでした";
  return [
    count ? el("div", { class: "hit-count" }, count) : null,
    cards.length ? keepScroll(el("div", { class: "hit-cards", onscroll: (e) => { detail.cardsX = e.target.scrollLeft; } }, cards)) : null,
  ].filter(Boolean);
}

function goodsCard(icon, title, sub, href, word) {
  return el("div", { class: "hit-card goods" },
    el("a", { class: "goods-link", href, target: "_blank", rel: "noopener" },
      el("div", { class: "hit-top" }, el("span", { class: "hit-icon", "aria-hidden": "true" }, icon), el("span", { class: "hit-name" }, title)),
      el("div", { class: "hit-sub" }, sub)),
    word ? el("button", {
      type: "button", class: "chip strong small",
      onclick: () => { addWish(word); toast(`「${word}」を買いたいものに足しました（価格は準備のタブで）`); },
    }, "＋ 買いたいもの") : null);
}

// 描き直しても、結果のカードの横の位置をそのまま残す
function keepScroll(node) {
  requestAnimationFrame(() => { node.scrollLeft = detail.cardsX || 0; });
  return node;
}

// ---------- 開園・閉園時間 ----------
const HOURS_STORAGE = "trip-shiori-hours";
try { detail.hours = JSON.parse(localStorage.getItem(HOURS_STORAGE) || "null"); } catch { /* 無くても動く */ }

async function loadHours() {
  if (detail.hoursLoading || (detail.hours && Date.now() - Date.parse(detail.hours.fetchedAt) < 3 * 3600e3)) return;
  detail.hoursLoading = true;
  try {
    detail.hours = await api("GET", "/api/hours");
    try { localStorage.setItem(HOURS_STORAGE, JSON.stringify(detail.hours)); } catch { /* 無くても動く */ }
    render();
  } catch { /* 取れなくても他は動く */ } finally {
    detail.hoursLoading = false;
  }
}

// 例）「9:00〜21:00（8:45から入れる日も）」
function hoursText(park, date) {
  const d = detail.hours?.hours?.[park]?.[date];
  if (!d?.open) return "";
  return `${d.open}〜${d.close}${d.early ? `（ホテル宿泊者は${d.early}〜）` : ""}`;
}

function todayHours() {
  return hoursText(state.park, todayStr());
}

// 一覧の「地図」：自分の地図でその場所へ。位置がわからなければ Google マップ
function flyToPin(p) {
  const key = TripPlaces.norm(p.place?.name || p.item.label);
  const e = searchIndex().find((x) => TripPlaces.norm(x.name) === key);
  showOnMap(e || { name: p.place?.name || p.item.label, park: state.park });
}

function showOnMap(e) {
  if (e.park && e.park !== state.park) { state.park = e.park; save(PARK_STORAGE, e.park); }
  if (e.lat != null) {
    detail.fly = e;
    render();
    document.querySelector(".map-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const q = `${e.name} ${TripPlaces.PARKS[e.park || state.park].search}`;
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
  drawMe();
  const pad = { paddingTopLeft: [16, 110], paddingBottomRight: [16, 150], maxZoom: 18 };
  const searchKey = `${state.park}|${detail.kind}|${detail.q.trim()}`;
  if (detail.shownPark !== state.park || detail.lastKey !== searchKey) {
    const hits = runSearch().list.filter((e) => e.lat != null && e.park === state.park);
    if (hits.length && searchKey !== `${state.park}|all|`) detail.map.fitBounds(hits.map((e) => [e.lat, e.lon]), pad);
    else detail.map.fitBounds(PARK_BOUNDS[state.park]);
    detail.shownPark = state.park;
    detail.lastKey = searchKey;
  }
  detail.layer.clearLayers();
  const { KINDS } = TripPlaces;
  const index = searchIndex().filter((e) => e.lat != null && e.park === state.park);
  const { kind, list } = runSearch();
  const searching = !!(detail.q.trim() || kind !== "all");
  const highlight = new Set(list.map((e) => e.name));
  // ふだんは全部の施設を小さなアイコンで。ジャンルを選んだり検索したりしている間は、当たった施設だけを大きく出す
  for (const e of index) {
    const big = highlight.has(e.name);
    if (searching && !big) continue;
    const icon = L.divIcon({
      className: `poi${big ? " hit" : ""}`,
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
    if (!e || (searching && !highlight.has(e.name))) continue;
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
    e.drinks ? el("ul", { class: "drink-menu" },
      ...e.drinks.menu.map(([n, yen]) => el("li", {}, el("span", {}, n), el("b", {}, `¥${yen.toLocaleString("ja-JP")}`)))) : null,
    e.drinks ? el("div", { class: "drink-note" }, [e.drinks.to ? "持ち歩き○" : "店内だけ", e.drinks.note, TripPlaces.DRINKS_SOURCE].filter(Boolean).join("・")) : null,
    el("div", { class: "poi-pop-btns" },
      e.kind !== "toilet" && !pin ? el("button", { type: "button", class: "chip strong small", onclick: () => { addPlace(e.name); toast(`「${e.name}」を行きたい場所に足しました`); } }, "＋ 行きたい") : null,
      el("a", { class: "chip small", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, target: "_blank", rel: "noopener" }, "Googleマップ"),
      officialHoursUrl(e) ? el("a", { class: "chip small", href: officialHoursUrl(e), target: "_blank", rel: "noopener" }, "営業時間（公式）") : null));
}

// 店ごとの営業時間は公式サイトにしか無いので、公式の一覧へ
function officialHoursUrl(e) {
  const park = e.park === "sea" ? "tds" : "tdl";
  if (e.kind === "food") return `https://www.tokyodisneyresort.jp/${park}/restaurant/list/`;
  if (e.kind === "shop") return `https://www.tokyodisneyresort.jp/${park}/shop/list/`;
  return `https://www.tokyodisneyresort.jp/${park}/daily/calendar/`;
}
