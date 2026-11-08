"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { addTodayEvent } from "@/lib/trips/actions"
import { normalizeTime } from "@/lib/trips/event-time"

/** One itinerary day a card can drop an event on. */
export interface DispatchDay {
  id: string
  dayDate: string
  label: string
}

/**
 * The small inline "put this on a day" form a road card opens: a day picker
 * (a date input when the trip has no days yet), an optional time, add and
 * cancel. Shared by the news and conditions cards.
 */
export function AddToDayForm({
  tripId,
  tripSlug,
  days,
  defaultDate,
  text,
  url,
  category,
  onAdded,
  onCancel,
}: {
  tripId: string
  tripSlug: string
  days: DispatchDay[]
  /** The day picked when the form opens. */
  defaultDate: string
  text: string
  url?: string
  category?: string
  onAdded: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [dayId, setDayId] = React.useState(
    () => days.find((d) => d.dayDate === defaultDate)?.id ?? days[0]?.id ?? "",
  )
  const [newDate, setNewDate] = React.useState(defaultDate)
  const [time, setTime] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  // No day selected means the trip has none yet: create one on the typed date.
  function add() {
    const day = days.find((d) => d.id === dayId)
    setError(null)
    addTodayEvent({
      tripId,
      tripSlug,
      dayDate: day ? day.dayDate : newDate,
      dayId: day?.id ?? null,
      time: normalizeTime(time),
      text,
      url,
      category,
    }).then((result) => {
      if (result.error) {
        setError(result.error)
        return
      }
      onAdded()
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {days.length ? (
          <select
            value={dayId}
            onChange={(e) => setDayId(e.target.value)}
            className="rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground"
          >
            {days.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="t-num rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground"
          />
        )}
        <input
          type="text"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => setTime((t) => normalizeTime(t))}
          placeholder="00:00"
          className="t-num w-16 border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-clay focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
        >
          add
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="border-0 bg-transparent px-1.5 py-1 font-mono text-[13px] text-muted-foreground hover:text-clay"
        >
          ×
        </button>
      </div>
      {error ? <div className="font-mono text-[10px] text-clay">{error}</div> : null}
    </div>
  )
}
