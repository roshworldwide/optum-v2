/* Caches the app, the on-phone checker and its packs, so after one visit the phone checks messages and runs
   the benefits interview by itself: at home, with no node and no internet. API calls are never cached:
   every check on the node is fresh and stays in the node's memory.
   BASE is "/" on the node and the site folder in the stand-alone build (scripts/build_tryit.py). */
const CACHE = "sahayak-shell-v3";
const BASE = new URL("./", self.location).pathname;
const SHELL = ["", "app/styles.css", "app/app.js", "app/mic.js", "app/recorder.js", "app/checker.js", "app/navigator.js",
  "app/manifest.webmanifest", "app/icons/icon.svg",
  "phone-packs/fraud.json", "phone-packs/scam_patterns.json", "phone-packs/fraud_model.json",
  "phone-packs/schemes.json", "phone-packs/demo.json"].map((p) => BASE + p);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith(BASE + "api/")) return;
  // Network first, so a visit to the node refreshes the app and its packs; the cache answers when offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // Never let a page that is not a pack (an older node, a hotspot's login page) replace a cached pack.
        const json = (res.headers.get("content-type") || "").includes("json");
        if (res.ok && (json || !url.pathname.startsWith(BASE + "phone-packs/"))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: event.request.mode === "navigate" })
        .then((hit) => hit || (event.request.mode === "navigate" ? caches.match(BASE) : undefined))),
  );
});
