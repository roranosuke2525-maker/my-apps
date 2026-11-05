// 画面ファイルだけをキャッシュする（/api は常にネットワーク）
const CACHE = "habit-check-v46";
const SHELL = ["./", "index.html", "app.js", "aibou.js", "aibou-sprites.js", "art-index.js", "theater.js", "theater-gl.js", "battle-stage.js", "theater-script.js", "theater-speakers.js", "theater-stage.js", "guild-epilogues.js", "style.css", "manifest.webmanifest", "icons/icon-192.png", "img/walnut.jpg", "img/oak.jpg"];

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
  // 新しい画面を優先し、圏外のときだけキャッシュを使う
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});

// 朝のアラート（Worker の cron から届く「空の通知」）。何の習慣かは /api/push/alert に聞く
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let info = {};
    try { info = await (await fetch("/api/push/alert", { cache: "no-store" })).json(); } catch { /* 文言なしでも出す */ }
    const label = String(info.habit || "").replace(/^[◆◇★][☼☀◷◐☾↻][︎️]?\s*/u, "");
    await self.registration.showNotification(label ? `⏰ ${label}` : "⏰ 習慣のアラート", {
      body: label ? `${info.at || ""} になりました。まだチェックが入っていません` : "まだの習慣があります",
      tag: "habit-alert",
      renotify: true,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { url: "./" },
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = all.find((c) => c.url.startsWith(self.registration.scope));
    if (open) return open.focus();
    return self.clients.openWindow("./");
  })());
});
