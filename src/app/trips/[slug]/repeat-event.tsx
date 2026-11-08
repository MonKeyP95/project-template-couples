"use client"

import * as React from "react"

import { repeatItineraryEvent } from "@/lib/trips/actions"
import type { ItineraryDay, ItineraryEvent } from "@/lib/trips/itinerary-types"
import { DayMultiPicker } from "./day-multi-picker"

/** Copies one event onto the days picked in a small calendar. Each copy is
 * its own event. */
export function RepeatEvent({
  tripId,
  tripSlug,
  day,
  event,
  days,
  todayIndex,
  onClose,
}: {
  tripId: string
  tripSlug: string
  day: ItineraryDay
  event: ItineraryEvent
  days: ItineraryDay[]
  todayIndex: number
  onClose: () => void
}) {
  const [picked, setPicked] = React.useState<number[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (picked.length === 0) return
    setError(null)
    startTransition(async () => {
      const result = await repeatItineraryEvent({ tripId, tripSlug, event, dayIndexes: picked })
      if (result.error) setError(result.error)
      else onClose()
    })
  }

  return (
    <form onSubmit={submit} className="mt-1 flex max-w-[260px] flex-col gap-1.5">
      <DayMultiPicker
        days={days}
        ownIndex={day.dayIndex}
        minIndex={todayIndex}
        selected={picked}
        onChange={setPicked}
        disabled={isPending}
      />
      <div className="flex items-center gap-1.5">
        <span className="flex-1 font-mono text-[10px] text-muted-foreground">
          {picked.length === 0
            ? "tap days to add it to"
            : `adds to ${picked.length} ${picked.length === 1 ? "day" : "days"}`}
        </span>
        <button
          type="submit"
          disabled={isPending || picked.length === 0}
          className="rounded-full border-0 bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : "repeat"}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          aria-label="Cancel"
          className="border-0 bg-transparent px-1 font-mono text-[13px] leading-none text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>
      {error ? <div className="font-mono text-[10px] text-clay">{error}</div> : null}
    </form>
  )
}
