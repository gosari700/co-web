/*
 * co-web service worker kill switch.
 *
 * co-web should launch straight from black to the live camera. A service worker
 * can add a second page-load pass in Chrome/PWA startup, which shows as a top
 * loading line. This script exists only to remove any previously installed
 * worker/cache without forcing a reload.
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
        await self.registration.unregister();
      } catch {}
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
