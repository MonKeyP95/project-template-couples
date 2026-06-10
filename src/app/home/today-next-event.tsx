"use client"

import React from "react"

import type { ItineraryEvent } from "@/lib/trips/itinerary-types"

/** Current local time as a zero-padded "HH:MM" so it compares with event times. */
function computeNow(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`
}

// Cached so getSnapshot returns a stable reference between renders (required by
// useSyncExternalStore); refreshes only when the minute actually changes.
let cachedNow = ""
function getSnapshot(): string {
  const v = computeNow()
  if (v !== cachedNow) cachedNow = v
  return cachedNow
}
// No subscription: this is a glanceable hint, not a live ticker — it re-reads on
// load / navigation, not on an interval.
function subscribe(): () => void {
  return () => {}
}
function getServerSnapshot(): null {
  return null
}

/** Client-only local "HH:MM"; null on the server / during hydration. */
function useLocalHhMm(): string | null {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * The day's next upcoming timed event, falling back to the last once they've all
 * passed (so it never goes empty). Untimed events are ignored. Renders nothing
 * when there are no timed events. Local time via useSyncExternalStore so the
 * server renders null (no hydration mismatch) and the client picks next vs last.
 */
export function TodayNextEvent({ events }: { events: ItineraryEvent[] }) {
  const now = useLocalHhMm()

  const timed = events
    .filter((e) => e.time)
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  if (timed.length === 0 || now === null) return null

  const upcoming = timed.find((e) => e.time >= now)
  const pick = upcoming ?? timed[timed.length - 1]
  const label = upcoming ? "next" : "last"

  return (
    <div className="mt-1.5 font-mono text-[12.5px] tracking-[0.04em] text-muted-foreground">
      <span className="uppercase tracking-[0.14em] text-foreground/70">
        {label}
      </span>{" "}
      <span className="t-num">{pick.time}</span> · {pick.text}
    </div>
  )
}
