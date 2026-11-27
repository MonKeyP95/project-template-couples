"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { isOfflineCopy } from "@/lib/offline/offline-copy"
import { flushOutbox } from "@/lib/offline/send"

/**
 * Sends the outbox from a page fresh from the network, now and whenever the
 * signal returns. A stored copy reloads instead, so the send always uses the
 * current deploy's server actions.
 */
export function OutboxFlusher() {
  const router = useRouter()

  React.useEffect(() => {
    if (isOfflineCopy()) {
      const reload = () => location.reload()
      window.addEventListener("online", reload)
      return () => window.removeEventListener("online", reload)
    }
    const flush = () =>
      flushOutbox().then((sent) => {
        if (sent > 0) router.refresh()
      })
    flush()
    window.addEventListener("online", flush)
    return () => window.removeEventListener("online", flush)
  }, [router])

  return null
}
