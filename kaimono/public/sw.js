// 画面ファイルをキャッシュする（/api は常にネットワーク）。在庫アラートのプッシュ通知も受ける
const CACHE = "kaimono-v3";
const SHELL = ["./", "index.html", "app.js", "aisle.js", "style.css", "manifest.webmanifest", "icons/icon-192.png"];

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
  // 新しい画面を優先し、圏外のときだけキャッシュを使う（お店の中でも開けるように）
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});

self.addEventListener("push", (e) => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch { msg = { body: e.data?.text() || "" }; }
  const jobs = [
    self.registration.showNotification(msg.title || "かいもの", {
      body: msg.body || "",
      tag: msg.tag || "kaimono",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { url: msg.url || "./" },
    }),
  ];
  if (typeof msg.badge === "number" && self.navigator.setAppBadge) jobs.push(msg.badge ? self.navigator.setAppBadge(msg.badge) : self.navigator.clearAppBadge());
  e.waitUntil(Promise.all(jobs).catch(() => {}));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) if ("focus" in w) return w.navigate(target).then((c) => (c || w).focus()).catch(() => w.focus());
      return self.clients.openWindow(target);
    }),
  );
});
