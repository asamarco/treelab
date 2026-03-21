const CACHE_NAME = 'treelab-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Add very critical assets if needed, but for now just a shell
      return cache.addAll(['/']);
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Simple network-first strategy for a data-driven app
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
