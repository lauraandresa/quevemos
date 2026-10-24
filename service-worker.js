/* Network-first: si hay internet siempre carga la última versión (así las actualizaciones
   que subas a GitHub llegan solas); si no hay, usa la copia guardada.
   'no-cache' fuerza a revalidar con GitHub en vez de usar la copia que guarda el navegador
   (GitHub Pages permite cachear 10 minutos, y eso mezclaba archivos viejos con nuevos). */
const CACHE = 'que-vemos-v4';
const SHELL = ['./', 'index.html', 'css/styles.css?v=4', 'js/config.js?v=4', 'js/storage.js?v=4', 'js/tmdb.js?v=4', 'js/scoring.js?v=4', 'js/app.js?v=4', 'manifest.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(function (res) {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (m) { return m || caches.match('index.html'); });
    })
  );
});
