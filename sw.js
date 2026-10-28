const CACHE_VERSION = "lauwak-v21";
const APP_SHELL = [
  "/",
  "/index.html",
  "/admin.html",
  "/user/login.html",
  "/user/login.css",
  "/user/login.js",
  "/css/01-tokens.css",
  "/css/02-base.css",
  "/css/03-layout.css",
  "/css/04-study.css",
  "/css/05-quiz.css",
  "/css/06-modals-forms.css",
  "/css/07-components.css",
  "/css/08-code-practice.css",
  "/css/09-responsive.css",
  "/css/10-nav-chat.css",
  "/css/11-preferences.css",
  "/css/12-flashcards-chat-cards.css",
  "/css/13-home.css",
  "/js/core.js",
  "/js/ui.js",
  "/js/cards.js",
  "/js/home.js",
  "/js/study.js",
  "/js/quiz.js",
  "/js/ai.js",
  "/js/stats.js",
  "/js/code.js",
  "/js/main.js",
  "/assets/manifest.webmanifest",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/images/sunn.png",
  "/assets/images/moon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // API calls (AI, health) are never cached.
  if (url.pathname.startsWith("/api/")) return;

  // Network-first for same-origin static assets (edits always reflect),
  // with cache fallback for offline use (PWA still works offline).
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches
              .open(CACHE_VERSION)
              .then((c) => c.put(req, copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((c) => c || caches.match("/index.html")),
        ),
    );
    return;
  }

  // Cross-origin (fonts, CDN): stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches
              .open(CACHE_VERSION)
              .then((c) => c.put(req, copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    }),
  );
});

// Allow page to trigger skipWaiting via postMessage
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
