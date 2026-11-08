"use client"

import * as React from "react"

import { repeatItineraryEvent } from "@/lib/trips/actions"
import type { ItineraryDay, ItineraryEvent } from "@/lib/trips/itinerary-types"

const pillClass = (active: boolean) =>
  `rounded-full px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
    active ? "bg-sea text-background" : "text-muted-foreground hover:text-foreground"
  }`

function dayLabel(d: ItineraryDay): string {
  return d.dayDate ? `${d.dow} ${d.dom} ${d.mon} · day ${d.dayIndex}` : `day ${d.dayIndex}`
}

/** Copies one event onto later days of the trip: every day, or every same
 * weekday, until a picked day. Each copy is its own event. */
export function RepeatEvent({
  tripSlug,
  day,
  event,
  days,
  onClose,
}: {
  tripSlug: string
  day: ItineraryDay
  event: ItineraryEvent
  days: ItineraryDay[]
  onClose: () => void
}) {
  const [step, setStep] = React.useState<1 | 7>(1)
  const [pickedUntil, setPickedUntil] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const options = days
    .filter((d) => d.dayIndex > day.dayIndex && (d.dayIndex - day.dayIndex) % step === 0)
    .sort((a, b) => a.dayIndex - b.dayIndex)
  const last = options[options.length - 1]?.dayIndex ?? null
  const until = options.some((d) => d.dayIndex === pickedUntil) ? pickedUntil : last
  const count = options.filter((d) => until !== null && d.dayIndex <= until).length

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (until === null) return
    setError(null)
    startTransition(async () => {
      const result = await repeatItineraryEvent({
        tripSlug,
        dayId: day.id,
        event,
        untilIndex: until,
        step,
      })
      if (result.error) setError(result.error)
      else onClose()
    })
  }

  return (
    <form onSubmit={submit} className="mt-1 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="inline-flex rounded-full border border-border bg-background p-0.5">
          <button type="button" onClick={() => setStep(1)} aria-pressed={step === 1} className={pillClass(step === 1)}>
            every day
          </button>
          {day.dayDate ? (
            <button type="button" onClick={() => setStep(7)} aria-pressed={step === 7} className={pillClass(step === 7)}>
              every {day.dow}
            </button>
          ) : null}
        </div>
        {until !== null ? (
          <label className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            until
            <select
              value={until}
              onChange={(e) => setPickedUntil(Number(e.target.value))}
              disabled={isPending}
              className="rounded-lg border border-border bg-background px-2 py-1 text-[12px] normal-case tracking-normal text-foreground"
            >
              {options.map((d) => (
                <option key={d.id} value={d.dayIndex}>
                  {dayLabel(d)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="flex-1 font-mono text-[10px] text-muted-foreground">
          {until === null ? "no later days in this trip" : `adds to ${count} ${count === 1 ? "day" : "days"}`}
        </span>
        <button
          type="submit"
          disabled={isPending || until === null}
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
