// Network-first service worker: when online you ALWAYS get the newest build
// (no stale-version traps — the old cache-first worker pinned outdated builds
// on iOS); when offline, the last successfully fetched copy is served so the
// built-in lessons keep working with no connection.
const CACHE = 'els-net-first-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // never intercept API/CDN calls
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
      }
      return res;
    }).catch(() =>
      // ignoreSearch: offline, a ?v=NN bump can still hit the stored copy
      caches.match(req, { ignoreSearch: true })
        .then(hit => hit || caches.match('./index.html', { ignoreSearch: true }))
    )
  );
});
