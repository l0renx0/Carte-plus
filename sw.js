/* Service worker: salva tutta l'app sul telefono così funziona senza internet. */
const CACHE = 'carteplus-v1.2.2';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'vendor/JsBarcode.all.min.js',
  'vendor/qrcode-generator.min.js',
  'vendor/zxing.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  // cache: 'reload' scarica SEMPRE i file freschi dal sito, mai copie vecchie
  // dalla memoria del browser: così tutti i file sono della stessa versione.
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('carteplus-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Prima la copia salvata (istantanea e offline); se manca, la rete. */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true }) ||
      (req.mode === 'navigate' ? await cache.match('index.html') : null);
    if (hit) return hit;
    try {
      const res = await fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }));
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      return Response.error();
    }
  })());
});
