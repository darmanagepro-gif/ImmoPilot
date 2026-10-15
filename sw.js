/*
 * Service worker minimal : met en cache UNIQUEMENT la coquille (icônes, page d'accueil, page hors ligne).
 * Les données (réservations, finances…) ne sont jamais mises en cache : elles restent chez Google, toujours à jour,
 * identiques sur le web, Android et iPhone.
 */
var CACHE = "immopilot-shell-v3";
var SHELL = ["./", "index.html", "config.js", "offline.html", "manifest.webmanifest", "icons/immopilot-192.png", "icons/immopilot-512.png", "icons/immopilot-180.png"];
self.addEventListener("install", function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })); self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }));
  self.clients.claim();
});
self.addEventListener("fetch", function (e) {
  var u = new URL(e.request.url);
  if (u.origin !== self.location.origin || e.request.method !== "GET") return; // Google (données) : jamais intercepté
  // Vidéo d'introduction : jamais interceptée. Safari exige une gestion exacte des requêtes « Range » ; le navigateur la gère très bien seul.
  if (e.request.headers.has("range") || /\.(mp4|webm|mov)$/i.test(u.pathname)) return;
  e.respondWith(fetch(e.request).then(function (r) {
    var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); return r;
  }).catch(function () {
    return caches.match(e.request).then(function (m) { return m || (e.request.mode === "navigate" ? caches.match("offline.html") : undefined); });
  }));
});
