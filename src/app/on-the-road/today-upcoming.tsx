"use client"

import React from "react"

import type { ItineraryEvent } from "@/lib/trips/itinerary-types"

/** Current local time as zero-padded "HH:MM" so it compares with event times. */
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
 * Today's still-upcoming events: timed events at/after the current local time
 * (ascending) followed by any untimed ones. "Day's done" once everything timed
 * has passed. Renders nothing on the server (local time unknown) so there's no
 * hydration mismatch.
 */
export function TodayUpcoming({ events }: { events: ItineraryEvent[] }) {
  const now = useLocalHhMm()
  if (now === null) return null

  const timed = events
    .filter((e) => e.time)
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  const untimed = events.filter((e) => !e.time)
  const upcoming = [...timed.filter((e) => e.time >= now), ...untimed]

  if (upcoming.length === 0) {
    return (
      <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        Day&apos;s done
      </div>
    )
  }

  return (
    <ul className="mt-2 flex flex-col gap-0.5">
      {upcoming.map((e, i) => (
        <li
          key={`${e.time}-${e.text}-${i}`}
          className="flex gap-2 text-[13px] text-foreground"
        >
          {e.time ? (
            <span className="t-num shrink-0 text-muted-foreground">{e.time}</span>
          ) : (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              anytime
            </span>
          )}
          <span>{e.text}</span>
        </li>
      ))}
    </ul>
  )
}
