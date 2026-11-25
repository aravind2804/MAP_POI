// Service worker: makes the phone version open instantly and work offline
// (saved places and the app itself; map tiles/search still need internet).
var CACHE = 'poi-map-v5';
var SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'static/style.css', 'static/app.js',
  'static/leaflet/leaflet.css', 'static/leaflet/leaflet.js',
  'static/leaflet/images/marker-icon.png', 'static/leaflet/images/marker-icon-2x.png',
  'static/leaflet/images/marker-shadow.png', 'static/leaflet/images/layers.png',
  'static/leaflet/images/layers-2x.png', 'static/icons/icon-192.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin) {
    // network first (so updates arrive), fall back to cache when offline
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match('./'); });
    }));
  } else if (url.hostname.endsWith('tile.openstreetmap.org')) {
    // keep tiles you have already seen so the map still shows offline
    e.respondWith(caches.open('poi-tiles').then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) { c.put(req, res.clone()); return res; }).catch(function () { return hit; });
        return hit || net;
      });
    }));
  }
});
