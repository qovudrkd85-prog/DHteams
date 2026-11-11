// Teams service worker. Caches only hashed static assets and icons.
// HTML, RSC, API and cross-origin (Supabase) requests are never intercepted or stored.
//
// VERSION rule: bump it only when icons or offline.html change (unhashed files).
// Bumping deletes old chunk caches, so an already-open old tab may need a reload.
const VERSION = "v1";
const PREFIX = "teams-static-";
const CACHE = `${PREFIX}${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"];
const MAX_ENTRIES = 300;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith(PREFIX) && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

function isCacheable(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

// Drop the oldest non-precached entries once the cache grows past MAX_ENTRIES.
async function trim(cache) {
  const keys = (await cache.keys()).filter((req) => !PRECACHE.includes(new URL(req.url).pathname));
  const extra = keys.length - (MAX_ENTRIES - PRECACHE.length);
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

async function store(request, response) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response);
    await trim(cache);
  } catch {
    // Quota or storage errors must never break asset loading.
  }
}

async function cacheFirst(event) {
  const { request } = event;
  try {
    const hit = await caches.match(request, { cacheName: CACHE });
    if (hit) return hit;
  } catch {
    // Storage unavailable: fall through to the network.
  }
  const response = await fetch(request);
  if (response.status === 200 && response.type === "basic") event.waitUntil(store(request, response.clone()));
  return response;
}

async function navigate(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const offline = await caches.match(OFFLINE_URL, { cacheName: CACHE }).catch(() => undefined);
    if (offline) return offline;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.headers.has("Authorization")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
    return;
  }
  if (url.search === "" && isCacheable(url)) event.respondWith(cacheFirst(event));
});
