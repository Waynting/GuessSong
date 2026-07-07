// Minimal service worker: a fetch handler is required for PWA installability
// (and thus for the Web Share Target to register). No offline caching — the
// game depends on the network anyway.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {});
