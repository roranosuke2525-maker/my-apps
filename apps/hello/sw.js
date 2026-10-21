// アプリを変更したら必ず VERSION を上げる（古いキャッシュが削除され、更新が反映される）
const VERSION = 'v1';
const CACHE = `hello-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // このアプリ（hello-）の古いバージョンだけ消す。他アプリのキャッシュには触らない
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('hello-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// キャッシュ優先、なければネットワーク
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then((hit) => hit || fetch(event.request))
  );
});
