// Web解体パック Service Worker
// 目的: PWAとしてインストール可能にし、Web Share Target APIを成立させる。
// オフラインキャッシュは行わず、すべてのリクエストをネットワークに通す。

const CACHE_NAME = 'web-disassembly-pack-v0.3.0';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// pass-through: キャッシュせず常にネットワークから取得する
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
