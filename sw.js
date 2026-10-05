// Estrategia "red primero": siempre intenta traer la versión más nueva desde GitHub.
// La caché solo se usa sin señal. Ya no hace falta cambiar VERSION en cada actualización.
const VERSION = 'gastos-v3';
const ARCHIVOS = ['./', './index.html', './manifest.json',
                  './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  // cache:'reload' evita guardar copias viejas desde la caché HTTP del navegador
  e.waitUntil(caches.open(VERSION).then(c =>
    c.addAll(ARCHIVOS.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Solo la app; las llamadas a Apps Script pasan directo a la red.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(r => {
        if (r.ok) { const copia = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copia)); }
        return r;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
