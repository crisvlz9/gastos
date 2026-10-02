// Cambia este número cada vez que subas una versión nueva de index.html,
// o el teléfono seguirá mostrando la versión anterior.
const VERSION = 'gastos-v1';
const ARCHIVOS = ['./', './index.html', './manifest.json',
                  './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Solo cachea la app; las llamadas a Apps Script pasan directo a la red.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
