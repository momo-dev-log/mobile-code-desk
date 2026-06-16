// Web解体パック Service Worker
// 目的: PWAとしてインストール可能にし、Web Share Target APIを成立させる。
// オフラインキャッシュは行わず、アプリ本体ファイルを古いキャッシュから返さないようにする。

const CACHE_NAME = 'web-disassembly-pack-v0.3.1';

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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 同一オリジンのリソースは HTTP キャッシュを無視して常にネットワークから取得する。
  // これにより、JS / CSS / HTML / manifest の古いキャッシュが返されることを防ぐ。
  if (url.origin === self.location.origin) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  // 外部オリジン（Worker エンドポイント等）はそのまま通す
  event.respondWith(fetch(event.request));
});
