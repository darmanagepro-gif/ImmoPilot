/*
 * Service worker minimal : met en cache UNIQUEMENT la coquille (icônes, page d'accueil, page hors ligne).
 * Les données (réservations, finances…) ne sont jamais mises en cache : elles restent chez Google, toujours à jour,
 * identiques sur le web, Android et iPhone.
 */
var CACHE = "immopilot-shell-v1";
var SHELL = ["./", "index.html", "config.js", "offline.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })); self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }));
  self.clients.claim();
});
self.addEventListener("fetch", function (e) {
  var u = new URL(e.request.url);
  if (u.origin !== self.location.origin || e.request.method !== "GET") return; // Google (données) : jamais intercepté
  e.respondWith(fetch(e.request).then(function (r) {
    var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); return r;
  }).catch(function () {
    return caches.match(e.request).then(function (m) { return m || (e.request.mode === "navigate" ? caches.match("offline.html") : undefined); });
  }));
});
