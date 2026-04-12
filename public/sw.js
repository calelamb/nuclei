// No-op service worker — intentionally clears stale caches from previous
// versions (pre-v0.1.3) that pinned outdated bundles via cache-first strategy.
// This file exists solely to replace the old SW; it does no caching.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.map((n) => caches.delete(n))))
      .then(() => self.registration.unregister())
  );
});

self.addEventListener('fetch', () => {});
