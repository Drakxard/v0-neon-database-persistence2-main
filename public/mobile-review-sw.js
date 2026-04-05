const CACHE_VERSION = "mobile-review-v1"
const STATIC_CACHE = `${CACHE_VERSION}-static`
const SHELL_ASSETS = [
  "/mobile/review",
  "/mobile-review.webmanifest",
  "/mobile-review-icon-192.png",
  "/mobile-review-icon-512.png",
  "/mobile-review-icon.svg",
  "/mobile-review-icon-maskable.svg",
]
const SHELL_ASSET_SET = new Set(SHELL_ASSETS)

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => undefined)
  )
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  )
})

async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE)

  try {
    const response = await fetch(request)
    if (response.ok) {
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return cache.match(request) || cache.match("/mobile/review") || Response.error()
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => undefined)

  return cached || fetchPromise || Response.error()
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/")) return
  if (url.search) return

  if (request.mode === "navigate" && url.pathname.startsWith("/mobile/review")) {
    event.respondWith(networkFirst(request))
    return
  }

  if (url.pathname.startsWith("/_next/static/") || SHELL_ASSET_SET.has(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request))
  }
})
