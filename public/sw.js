const CACHE_NAME = 'treelab-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting(); // don't wait for old tabs to close — activate immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(['/']))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      clients.claim(), // take control of already-open tabs right away
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      ),
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request);
      return cached || Response.error();
    })
  );
});