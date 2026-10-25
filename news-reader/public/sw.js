// 画面ファイルをキャッシュし、朝の通知を受けたらホーム画面のアイコンの数字を更新する（/api は常にネットワーク）
const CACHE = "news-reader-v1";
const AUTH_CACHE = "news-reader-auth";
const SHELL = ["./", "index.html", "app.js", "style.css", "manifest.webmanifest", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== AUTH_CACHE).map((k) => caches.delete(k))))
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

// 通知の中身は空。ここで未読の数を読み、アイコンの数字と通知の文面を決める
self.addEventListener("push", (e) => {
  e.waitUntil(
    (async () => {
      let unread = null;
      let topics = [];
      try {
        const keyRes = await (await caches.open(AUTH_CACHE)).match("/__key");
        const key = keyRes ? await keyRes.text() : "";
        const res = await fetch("/api/unread", { headers: { Authorization: `Bearer ${key}` } });
        if (res.ok) ({ unread, topics } = await res.json());
      } catch {}
      if (typeof unread === "number" && self.navigator.setAppBadge) {
        await (unread ? self.navigator.setAppBadge(unread) : self.navigator.clearAppBadge()).catch(() => {});
      }
      const title = typeof unread === "number" ? (unread ? `けさの新聞　未読 ${unread} 件` : "未読はありません") : "けさの新聞が届きました";
      await self.registration.showNotification(title, {
        body: topics?.length ? topics.join("／") : "開いて読む",
        tag: "news-reader",
        icon: "icons/icon-192.png",
      });
    })(),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("./");
    })(),
  );
});
