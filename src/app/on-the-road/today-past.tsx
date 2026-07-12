"use client"

import React from "react"

import { formatEventTime, type ItineraryEvent } from "@/lib/trips/itinerary-types"
import { EventRating } from "@/components/event-rating"

/** Current local time as zero-padded "HH:MM" (matches event time strings). */
function computeNow(): string {
  return `${String(new Date().getHours()).padStart(2, "0")}:${String(
    new Date().getMinutes(),
  ).padStart(2, "0")}`
}

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
function useLocalHhMm(): string | null {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Today's already-passed timed events (time < now), each rateable. Indexes are
 * into the FULL day's time-sorted events so they align with rateEvent's sort.
 * Renders nothing on the server (local time unknown) — no hydration mismatch.
 */
export function TodayPast({
  tripSlug,
  dayId,
  events,
}: {
  tripSlug: string
  dayId: string
  events: ItineraryEvent[]
}) {
  const now = useLocalHhMm()
  if (now === null) return null

  const sorted = [...events].sort((a, b) => {
    if (!a.time && !b.time) return 0
    if (!a.time) return 1
    if (!b.time) return -1
    return a.time < b.time ? -1 : a.time > b.time ? 1 : 0
  })
  const passed = sorted
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.time && e.time < now)

  if (passed.length === 0) return null

  return (
    <div className="mt-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Looking back
      </span>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {passed.map(({ e, i }) => (
          <li key={i} className="flex flex-col gap-0.5">
            <div className="flex gap-2 text-[13px] text-foreground">
              <span className="t-num shrink-0 whitespace-nowrap text-muted-foreground">
                {formatEventTime(e.time, e.endTime)}
              </span>
              <span>{e.text}</span>
            </div>
            <EventRating
              tripSlug={tripSlug}
              dayId={dayId}
              eventIndex={i}
              rating={e.rating}
              note={e.note}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
