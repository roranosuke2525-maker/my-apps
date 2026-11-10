// 画面ファイルだけをキャッシュする（/api は常にネットワーク。しおりの中身は app.js が端末に保存する）
const CACHE = "trip-shiori-v6";
const SHELL = ["./", "index.html", "app.js", "style.css", "places.js", "detail.js", "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css", "manifest.webmanifest", "icons/icon-192.png",
  "img/areas/adventure.png", "img/areas/arabian.png", "img/areas/bazaar.png", "img/areas/critter.png", "img/areas/delta.png", "img/areas/discovery.png", "img/areas/fantasy.png", "img/areas/gate.png", "img/areas/harbor.png", "img/areas/island.png", "img/areas/mermaid.png", "img/areas/springs.png", "img/areas/tomorrow.png", "img/areas/toon.png", "img/areas/waterfront.png", "img/areas/western.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // 新しい画面を優先し、圏外のときだけキャッシュを使う（園内の電波が弱いときは3秒で諦める）
  e.respondWith(
    Promise.race([
      fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), 3000)),
    ]).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html"))),
  );
});
