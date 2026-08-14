/* WinfraBR PWA service worker: cache only explicitly public, same-origin assets. */
const WINFRA_CACHE_PREFIX = "winfrabr-pwa-";
const WORKER_VERSION = "2026-08-14.2";
const STATIC_CACHE_NAME = `${WINFRA_CACHE_PREFIX}${WORKER_VERSION}`;
const MAX_RUNTIME_CACHE_ENTRIES = 80;
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/brand/favicon-32.png",
  "/brand/icon-192.png",
  "/brand/icon-512.png",
  "/brand/winfra-mark-64.png",
];

const PRIVATE_PATH_PREFIXES = [
  "/api",
  "/auth",
  "/admin",
  "/revisao",
  "/notas",
  "/validacoes",
];

function pathMatchesPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isSameOriginRequest(request) {
  return new URL(request.url).origin === self.location.origin;
}

function isNextRouterRequest(request) {
  const url = new URL(request.url);
  const purpose = `${request.headers.get("Purpose") || ""} ${
    request.headers.get("Sec-Purpose") || ""
  }`.toLowerCase();
  return (
    url.searchParams.has("_rsc") ||
    request.headers.get("RSC") === "1" ||
    request.headers.get("Next-Router-Prefetch") === "1" ||
    request.headers.has("Next-Router-State-Tree") ||
    request.headers.has("Next-Router-Segment-Prefetch") ||
    purpose.includes("prefetch")
  );
}

function isPrivatePath(pathname) {
  return PRIVATE_PATH_PREFIXES.some((prefix) =>
    pathMatchesPrefix(pathname, prefix),
  );
}

function isExplicitPublicAsset(pathname) {
  return pathname === "/brand" || pathname.startsWith("/brand/");
}

function responseAllowsCache(response) {
  if (!response || !response.ok || response.status !== 200) return false;
  if (response.type === "opaque" || response.type === "opaqueredirect") {
    return false;
  }

  const cacheControl = (response.headers.get("Cache-Control") || "").toLowerCase();
  return !cacheControl.includes("no-store") && !cacheControl.includes("private");
}

function isPrecachedUrl(url) {
  const parsed = new URL(url, self.location.origin);
  return (
    parsed.origin === self.location.origin &&
    parsed.search === "" &&
    PRECACHE_URLS.includes(parsed.pathname)
  );
}

async function trimRuntimeEntries(cache) {
  const requests = await cache.keys();
  const runtimeRequests = requests.filter(
    (request) => !isPrecachedUrl(request.url),
  );
  const overflow = runtimeRequests.length - MAX_RUNTIME_CACHE_ENTRIES;
  if (overflow <= 0) return;
  await Promise.all(
    runtimeRequests.slice(0, overflow).map((request) => cache.delete(request)),
  );
}

async function putBestEffort(cache, request, response) {
  try {
    await cache.put(request, response.clone());
    await trimRuntimeEntries(cache);
  } catch {
    // Cache Storage pode falhar por quota ou indisponibilidade. A rede continua válida.
  }
}

function classifyRequest(request) {
  if (request.method !== "GET") return "network-only";
  if (!isSameOriginRequest(request)) return "network-only";
  if (request.headers.has("Range")) return "network-only";

  const url = new URL(request.url);
  if (isNextRouterRequest(request)) return "network-only";
  if (request.mode === "navigate" || request.destination === "document") {
    return "navigation-network-only";
  }
  if (isPrivatePath(url.pathname)) return "network-only";
  if (url.pathname === "/manifest.webmanifest") return "network-only";
  if (url.pathname === "/sw.js") return "network-only";
  if (url.pathname === OFFLINE_URL && url.search === "") return "cache-first";
  if (url.search !== "") return "network-only";
  if (url.pathname.startsWith("/_next/static/")) return "cache-first";
  if (isExplicitPublicAsset(url.pathname)) return "stale-while-revalidate";
  return "network-only";
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (responseAllowsCache(response)) {
    await putBestEffort(cache, request, response);
  }
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(STATIC_CACHE_NAME);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(async (response) => {
    if (responseAllowsCache(response)) {
      await putBestEffort(cache, request, response);
    }
    return response;
  });

  if (cached) {
    event.waitUntil(refresh.then(() => undefined).catch(() => undefined));
    return cached;
  }
  return refresh;
}

async function navigationWithOfflineFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(STATIC_CACHE_NAME);
    const cached = await cache.match(OFFLINE_URL);
    return (
      cached ||
      new Response("Conexão necessária para continuar.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) =>
      cache.addAll(
        PRECACHE_URLS.map(
          (url) => new Request(url, { cache: "reload", credentials: "same-origin" }),
        ),
      ),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith(WINFRA_CACHE_PREFIX) && name !== STATIC_CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const strategy = classifyRequest(event.request);
  if (strategy === "navigation-network-only") {
    event.respondWith(navigationWithOfflineFallback(event.request));
    return;
  }
  if (strategy === "cache-first") {
    event.respondWith(cacheFirst(event.request));
    return;
  }
  if (strategy === "stale-while-revalidate") {
    event.respondWith(staleWhileRevalidate(event.request, event));
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }
});
