"use client"

import { useRouter } from "next/navigation"
import * as React from "react"

/**
 * Re-runs the server queries for the surrounding route whenever the tab
 * returns to the foreground. Mobile browsers suspend backgrounded WebSocket
 * connections so Realtime events may be missed; this fills the gap by
 * refetching authoritative state on focus.
 */
export function RefreshOnVisible() {
  const router = useRouter()

  React.useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        router.refresh()
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onVisible)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onVisible)
    }
  }, [router])

  return null
}
