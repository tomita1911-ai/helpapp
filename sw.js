const CACHE_NAME = 'help-mgr-v6';
const ASSETS = [
  './index.html',
  './style.css?v=8',
  './app.js?v=10',
  './manifest.json',
  './lib/jspdf.min.js',
  './lib/html2canvas.min.js',
  './lib/xlsx.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
