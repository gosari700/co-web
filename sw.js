const CACHE_NAME = 'co-web-shell-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/src/main.js',
  '/src/modules/app/presentation/app.css',
  '/src/modules/app/application/createCoWebApp.js',
  '/src/modules/app/domain/createAppState.js',
  '/src/modules/camera/application/createCameraController.js',
  '/src/modules/camera/domain/cameraState.js',
  '/src/modules/pwa/application/createPwaController.js',
  '/src/modules/settings/domain/apiKeyStore.js',
  '/src/modules/toolbar/application/createToolbarController.js',
  '/src/modules/toolbar/domain/toolbarFeatures.js',
  '/public/icons/icon-192.png',
  '/public/icons/icon-512.png',
  '/public/icons/maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request).catch(() => {
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        throw new Error('Network unavailable');
      });
    }),
  );
});
