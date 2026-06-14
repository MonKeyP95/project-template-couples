"use client"

import { useRouter } from "next/navigation"
import * as React from "react"

import { createClient } from "@/lib/supabase/client"

/**
 * Re-runs the route's server queries whenever a row changes in any of the
 * given tables for this trip. For surfaces whose data is rendered from server
 * props rather than optimistic client state (notes, expenses, today's events
 * on the on-the-road page), this gives a partner's edits live sync instead of
 * only-on-focus or only-on-reload. Tables must be in the supabase_realtime
 * publication with replica identity full.
 */
export function RealtimeRefresh({
  tripId,
  tables,
}: {
  tripId: string
  tables: string[]
}) {
  const router = useRouter()
  const tableKey = tables.join(",")

  React.useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(`rt-refresh-${tripId}`)
    for (const table of tableKey.split(",")) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `trip_id=eq.${tripId}` },
        () => router.refresh(),
      )
    }
    channel.subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tripId, tableKey, router])

  return null
}
