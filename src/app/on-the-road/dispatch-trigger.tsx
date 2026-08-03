"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { ensureDispatch } from "@/lib/trips/dispatch-actions"

/** Fires today's dispatch generation once after paint, then refreshes so the
 * box picks up the stored row. Renders nothing. */
export function DispatchTrigger({
  tripSlug,
  dayDate,
}: {
  tripSlug: string
  dayDate: string
}) {
  const router = useRouter()
  React.useEffect(() => {
    let cancelled = false
    ensureDispatch(tripSlug, dayDate).then(() => {
      if (!cancelled) router.refresh()
    })
    return () => {
      cancelled = true
    }
  }, [tripSlug, dayDate, router])
  return null
}
