// Keeps /on-the-road openable with no connection. See
// docs/superpowers/specs/2026-11-27-offline-on-the-road-design.md
const VERSION = "v1"
const PAGES = `pages-${VERSION}`
const STATIC = `static-${VERSION}`
const ROAD = "/on-the-road"

self.addEventListener("install", () => self.skipWaiting())

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== PAGES && name !== STATIC) await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === "navigate" && url.pathname === ROAD) {
    event.respondWith(roadPage(request))
  } else if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(offlinePage))
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request))
  }
})

self.addEventListener("message", (event) => {
  if (event.data?.type === "warm") event.waitUntil(warm())
})

/** Stores the on-the-road page and every static file its HTML names. */
async function warm() {
  const res = await fetch(ROAD)
  if (!res.ok || res.redirected) return
  const html = await res.clone().text()
  const urls = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) ?? [])]
  await (await caches.open(STATIC)).addAll(urls)
  await storeRoad(res)
}

async function roadPage(request) {
  try {
    const res = await fetch(request)
    await storeRoad(res.clone())
    return res
  } catch {
    const stored = await (await caches.open(PAGES)).match(ROAD)
    return stored ? markOffline(stored) : offlinePage()
  }
}

/** Only a real page is kept: never a redirect to /signin or /home. */
async function storeRoad(res) {
  if (res.ok && !res.redirected) await (await caches.open(PAGES)).put(ROAD, res)
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok) await cache.put(request, res.clone())
  return res
}

/** Flags the page as the stored copy, so it reloads instead of sending. */
async function markOffline(stored) {
  const html = (await stored.text()).replace(
    "</head>",
    "<script>self.__offlineCopy=1</script></head>",
  )
  const headers = new Headers(stored.headers)
  headers.delete("content-length")
  return new Response(html, { status: 200, headers })
}

function offlinePage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline</title></head>
<body style="font-family:sans-serif;background:#f5efe7;color:#2b2620;padding:32px 16px">
<p>No connection.</p><p>The on-the-road screen works offline.</p>
<p><a href="${ROAD}" style="color:#00576a">Open on the road</a></p></body></html>`
  return new Response(html, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
