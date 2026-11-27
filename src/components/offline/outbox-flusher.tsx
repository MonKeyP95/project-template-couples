"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { isOfflineCopy } from "@/lib/offline/offline-copy"
import { readOutbox } from "@/lib/offline/outbox"
import { flushOutbox } from "@/lib/offline/send"

/**
 * Sends the outbox from a page fresh from the network: now, when the signal
 * returns, and when the app comes back to the foreground (`online` alone
 * misses a dead connection that never reported offline). A stored copy
 * reloads instead, so the send always uses the current deploy's server
 * actions.
 */
export function OutboxFlusher() {
  const router = useRouter()

  React.useEffect(() => {
    if (isOfflineCopy()) {
      const reload = () => location.reload()
      const reloadIfWaiting = () => {
        if (document.visibilityState === "visible" && readOutbox().length > 0) reload()
      }
      window.addEventListener("online", reload)
      document.addEventListener("visibilitychange", reloadIfWaiting)
      return () => {
        window.removeEventListener("online", reload)
        document.removeEventListener("visibilitychange", reloadIfWaiting)
      }
    }
    const flush = () =>
      flushOutbox().then((sent) => {
        if (sent > 0) router.refresh()
      })
    const flushIfVisible = () => {
      if (document.visibilityState === "visible") flush()
    }
    flush()
    window.addEventListener("online", flush)
    document.addEventListener("visibilitychange", flushIfVisible)
    return () => {
      window.removeEventListener("online", flush)
      document.removeEventListener("visibilitychange", flushIfVisible)
    }
  }, [router])

  return null
}
