// 最小構成のService Worker（キャッシュなし、install/activateのみ）
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
