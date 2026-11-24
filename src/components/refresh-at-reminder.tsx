"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

/** setTimeout's ceiling (~24.8 days); a reminder further out waits for a normal reload. */
const MAX_DELAY_MS = 2 ** 31 - 1

/** Re-renders the page the moment the next note reminder falls due, so its colour shows without a reload. */
export function RefreshAtReminder({ at }: { at: string | null }) {
  const router = useRouter()
  React.useEffect(() => {
    if (!at) return
    const delay = new Date(at).getTime() - Date.now()
    if (delay > MAX_DELAY_MS) return
    const timer = setTimeout(() => router.refresh(), Math.max(0, delay) + 1000)
    return () => clearTimeout(timer)
  }, [at, router])
  return null
}
