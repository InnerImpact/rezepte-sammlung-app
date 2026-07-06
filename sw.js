// Service Worker — macht die App offline nutzbar.
// Strategie: Netz zuerst, bei Fehlschlag aus dem Cache (so bleibt alles aktuell,
// funktioniert aber auch ohne Verbindung).

const VERSION = 'rezepte-shell-v3';
const SHELL = [
  './',
  'index.html',
  'css/app.css?v=3',
  'js/app.js?v=3',
  'js/data.js?v=3',
  'js/github.js?v=3',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('rezepte-shell-') && k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return; // GitHub-API regelt die App selbst

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((hit) => hit || caches.match('./'))
      )
  );
});
