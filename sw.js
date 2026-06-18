// Service worker: cache the app shell so listening/shadowing/dictation
// work offline. AI chat still needs the network (it calls a remote API).
const CACHE = 'els-v5';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/storage.js',
  './js/lessons.js',
  './js/azure.js',
  './js/speech.js',
  './js/listening.js',
  './js/shadowing.js',
  './js/dictation.js',
  './js/ai.js',
  './js/video.js',
  './js/translate.js',
  './js/vocab.js',
  './js/app.js',
  './icons/icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Don't touch third-party calls (APIs, SDKs, embedded players).
  if (url.origin !== location.origin) return;
  // Network-first: when online always serve the latest, fall back to cache
  // offline. This avoids stale app shells after an update.
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
