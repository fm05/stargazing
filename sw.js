// Service Worker: App-Dateien offline verfügbar, API-Anfragen immer frisch (mit Offline-Fallback).
const VERSION = 'v4';
const SHELL = [
  './', 'index.html', 'css/style.css', 'js/app.js', 'js/astro.js', 'js/weather.js', 'js/score.js',
  'js/lightpollution.js', 'js/map.js', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-shadow.png', 'vendor/leaflet/images/layers.png',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    // Network-first für eigene Dateien, damit Updates sofort ankommen; Cache als Fallback
    e.respondWith(
      fetch(e.request)
        .then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; })
        .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
    );
  }
  // Externe APIs: nicht abfangen (App speichert die letzten Daten selbst)
});
