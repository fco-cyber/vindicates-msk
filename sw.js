/*
 * VINDICATES MSK — service worker
 *
 * Strategy: cache-first for the app shell + offline fallback.
 * The reference is a single self-contained HTML page, so once it's cached
 * the app works fully offline. Bump CACHE_VERSION whenever you redeploy
 * to force clients to fetch the new HTML.
 */

const CACHE_VERSION = "vindicates-v1.8.3";
const CACHE_NAME = `vindicates-cache-${CACHE_VERSION}`;

// Files that make up the offline app shell.
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/icon.svg"
];

// On install: precache the app shell.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll is atomic — if any file fails, nothing is cached.
      // Use individual adds so a missing optional icon doesn't kill the install.
      return Promise.all(
        APP_SHELL.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch((err) => {
            console.warn(`[sw] failed to precache ${url}:`, err);
          })
        )
      );
    })
  );
  // Activate the new SW as soon as it's installed.
  self.skipWaiting();
});

// On activate: clear out any old caches.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("vindicates-cache-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// On fetch: cache-first for same-origin GETs; network passthrough otherwise.
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Skip non-GET and cross-origin requests.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // For navigation requests, always serve index.html from cache when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Update cache with the freshest version when online.
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return res;
        })
        .catch(() =>
          caches.match("./index.html").then((cached) => cached || caches.match("./"))
        )
    );
    return;
  }

  // For everything else (icons, manifest), cache-first.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Cache successful same-origin responses for next time.
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached); // already undefined here, but explicit
    })
  );
});
