"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import { isOfflineCopy } from "@/lib/offline/offline-copy"

/**
 * Registers public/sw.js (production only). Each online visit to on-the-road,
 * by full load or by link, asks the worker to store the page and the static
 * files it names, so it opens offline even on the first visit after install.
 */
export function ServiceWorker() {
  const pathname = usePathname()

  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js")
      return
    }
    // A worker left by `pnpm start` on localhost would serve stale dev chunks.
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
  }, [])

  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return
    if (pathname !== "/on-the-road" || isOfflineCopy()) return
    navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "warm" }))
  }, [pathname])

  return null
}
