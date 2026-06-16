"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { TZ_COOKIE } from "@/lib/time/today"

/** Stores the device IANA timezone in a cookie so server components can
 * compute the local date. Refreshes once when the value first appears or
 * changes (e.g. after travelling). Renders nothing. */
export function TimezoneCookie() {
  const router = useRouter()
  React.useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const current = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${TZ_COOKIE}=`))
      ?.slice(TZ_COOKIE.length + 1)
    if (current === tz) return
    document.cookie = `${TZ_COOKIE}=${tz}; path=/; max-age=31536000; SameSite=Lax`
    router.refresh()
  }, [router])
  return null
}
