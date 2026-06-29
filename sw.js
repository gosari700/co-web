/*
 * co-web network-only service worker.
 *
 * Chrome's installed PWA container needs a service worker to keep the launch in
 * app display mode. This worker never caches camera/app responses; it only
 * keeps the page controlled and lets every request pass through to the network.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch {}

      try {
        await self.clients.claim();
      } catch {}
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
