// The display's service worker (PR 5.8). It keeps the app shell so an installed
// display still opens when the server can't be reached; the page then shows the
// last state it kept in localStorage. Plain JavaScript with no build step,
// registered by app/pages/display.vue with the scope `/display`.
//
// What it does, and what it leaves alone:
//   - /api and /_ws are never touched: the wall's data is always live or absent.
//   - The page (any navigation under /display): network first, with a short
//     timeout so a dead server doesn't hold the screen blank. The page is the
//     same single-page shell for every display id, so it is kept under one key.
//   - /_nuxt/builds/ (Nuxt's app manifest, whose name never changes): network
//     first, cache as the fallback.
//   - The rest of /_nuxt/ (named by a hash of their content, so never stale):
//     cache first, filled on a miss, trimmed to a cap so old builds don't pile up.
//   - /icons/ and the manifest: network first, cache as the fallback.
//   - Everything else goes straight to the network.

const VERSION = 'v1'
const CACHE = `wall-display-${VERSION}`
const SHELL_KEY = '/display'
const NETWORK_TIMEOUT_MS = 4000
const MAX_HASHED_FILES = 120

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // A new version starts clean: drop every older cache of ours.
    const names = await caches.keys()
    await Promise.all(names.filter(name => name.startsWith('wall-display-') && name !== CACHE).map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  const path = url.pathname
  if (path.startsWith('/api/') || path.startsWith('/_ws')) return

  if (request.mode === 'navigate' && (path === '/display' || path.startsWith('/display/'))) {
    event.respondWith(networkFirst(request, SHELL_KEY))
  } else if (path.startsWith('/_nuxt/builds/')) {
    event.respondWith(networkFirst(request, path))
  } else if (path.startsWith('/_nuxt/')) {
    event.respondWith(cacheFirst(request))
  } else if (path.startsWith('/icons/') || path === '/display.webmanifest') {
    event.respondWith(networkFirst(request, request.url))
  }
})

/** Asks the network, keeps a good answer under `key`, and falls back to what was kept if the network fails, is slow or answers with an error. */
async function networkFirst(request, key) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS)
    if (response.ok) {
      await cache.put(key, response.clone())
      return response
    }
    // An error page (a proxy's 502 while the app is down, say) is no better than no answer.
    return (await cache.match(key)) ?? response
  } catch (error) {
    const kept = await cache.match(key)
    if (kept) return kept
    throw error
  }
}

/** Serves a kept file, and fetches and keeps it the first time. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const kept = await cache.match(request)
  if (kept) return kept
  const response = await fetch(request)
  if (response.ok) {
    await cache.put(request, response.clone())
    await trim(cache)
  }
  return response
}

/** Keeps the newest `MAX_HASHED_FILES` hashed files (a cache lists its keys oldest first). */
async function trim(cache) {
  const hashed = (await cache.keys()).filter((key) => {
    const path = new URL(key.url).pathname
    return path.startsWith('/_nuxt/') && !path.startsWith('/_nuxt/builds/')
  })
  for (const key of hashed.slice(0, Math.max(0, hashed.length - MAX_HASHED_FILES))) await cache.delete(key)
}

function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer))
}
