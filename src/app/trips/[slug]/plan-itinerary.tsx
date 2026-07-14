"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Label } from "@/components/together"
import {
  planItinerarySkeleton,
  type ItinerarySkeleton,
  type SkeletonDay,
  type SkeletonEvent,
} from "@/lib/ai/itinerary-planner"
import { applyItinerarySkeleton } from "@/lib/ai/itinerary-actions"
import { formatShortDate } from "@/lib/trips/itinerary-types"

export interface PlanItineraryProps {
  tripId: string
  tripSlug: string
  destination: string
  startDate: string
  dayCount: number
}

/** Immutable update of one day inside a skeleton, by place/day index. */
function withDay(
  skeleton: ItinerarySkeleton,
  placeIdx: number,
  dayIdx: number,
  update: (day: SkeletonDay) => SkeletonDay | null,
): ItinerarySkeleton {
  return {
    places: skeleton.places.map((place, pi) => {
      if (pi !== placeIdx) return place
      const days = place.days.flatMap((day, di) => {
        if (di !== dayIdx) return [day]
        const next = update(day)
        return next ? [next] : []
      })
      return { ...place, days }
    }),
  }
}

export function PlanItinerary({
  tripId,
  tripSlug,
  destination,
  startDate,
  dayCount,
}: PlanItineraryProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [placeNames, setPlaceNames] = React.useState<string[]>([""])
  const [days, setDays] = React.useState(dayCount)
  const [skeleton, setSkeleton] = React.useState<ItinerarySkeleton | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function reset() {
    setOpen(false)
    setPlaceNames([""])
    setDays(dayCount)
    setSkeleton(null)
    setError(null)
  }

  function generateDraft() {
    const names = placeNames.map((n) => n.trim()).filter((n) => n.length > 0)
    setSkeleton(
      planItinerarySkeleton({ destination, startDate, dayCount: days, placeNames: names }),
    )
  }

  function updatePlaceName(i: number, value: string) {
    setPlaceNames((prev) => prev.map((n, idx) => (idx === i ? value : n)))
  }

  function updateEvent(
    placeIdx: number,
    dayIdx: number,
    eventIdx: number,
    patch: Partial<SkeletonEvent>,
  ) {
    setSkeleton((s) =>
      s
        ? withDay(s, placeIdx, dayIdx, (day) => ({
            ...day,
            events: day.events.map((e, ei) => (ei === eventIdx ? { ...e, ...patch } : e)),
          }))
        : s,
    )
  }

  function addEvent(placeIdx: number, dayIdx: number) {
    setSkeleton((s) =>
      s
        ? withDay(s, placeIdx, dayIdx, (day) => ({
            ...day,
            events: [...day.events, { text: "", time: "" }],
          }))
        : s,
    )
  }

  function removeEvent(placeIdx: number, dayIdx: number, eventIdx: number) {
    setSkeleton((s) =>
      s
        ? withDay(s, placeIdx, dayIdx, (day) => ({
            ...day,
            events: day.events.filter((_, ei) => ei !== eventIdx),
          }))
        : s,
    )
  }

  function removeDay(placeIdx: number, dayIdx: number) {
    setSkeleton((s) => (s ? withDay(s, placeIdx, dayIdx, () => null) : s))
  }

  function apply() {
    if (!skeleton || isPending) return
    startTransition(async () => {
      const r = await applyItinerarySkeleton({ tripId, tripSlug, skeleton })
      if (r.error) {
        setError(r.error)
        return
      }
      router.refresh()
      reset()
    })
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between border-t border-border px-5 pt-4 pb-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          Plan your itinerary
        </button>
      </div>
    )
  }

  return (
    <div className="border-t border-border px-5 pt-4 pb-2">
      <div className="rounded-lg border border-border bg-card px-3.5 py-3">
        {skeleton ? (
          <>
            <div className="flex items-center justify-between">
              <Label>Draft itinerary</Label>
              <button
                type="button"
                onClick={() => setSkeleton(null)}
                className="border-0 bg-transparent p-0 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
              >
                back
              </button>
            </div>

            <div className="mt-2 max-h-[60vh] space-y-4 overflow-y-auto">
              {skeleton.places.map((place, pi) => (
                <div key={pi}>
                  <div className="font-serif text-[15px] italic text-foreground">
                    {place.name}
                  </div>
                  <div className="mt-1.5 space-y-2">
                    {place.days.map((day, di) => (
                      <div key={di} className="rounded-md border border-rule px-2.5 py-2">
                        <div className="flex items-center gap-2">
                          <span className="t-num shrink-0 font-mono text-[11px] text-muted-foreground">
                            {formatShortDate(day.date)}
                          </span>
                          <input
                            type="text"
                            value={day.title}
                            placeholder="Day title"
                            onChange={(e) =>
                              setSkeleton((s) =>
                                s
                                  ? withDay(s, pi, di, (d) => ({ ...d, title: e.target.value }))
                                  : s,
                              )
                            }
                            className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
                          />
                          <button
                            type="button"
                            onClick={() => removeDay(pi, di)}
                            aria-label="Remove day"
                            className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
                          >
                            ×
                          </button>
                        </div>

                        <div className="mt-1.5 space-y-1">
                          {day.events.map((ev, ei) => (
                            <div key={ei} className="flex items-center gap-2">
                              <input
                                type="text"
                                value={ev.time}
                                placeholder="time"
                                onChange={(e) =>
                                  updateEvent(pi, di, ei, { time: e.target.value })
                                }
                                className="t-num w-14 shrink-0 border-0 border-b border-border bg-transparent font-mono text-[11px] text-muted-foreground outline-none focus:border-foreground"
                              />
                              <input
                                type="text"
                                value={ev.text}
                                placeholder="What"
                                onChange={(e) =>
                                  updateEvent(pi, di, ei, { text: e.target.value })
                                }
                                className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
                              />
                              <button
                                type="button"
                                onClick={() => removeEvent(pi, di, ei)}
                                aria-label="Remove event"
                                className="border-0 bg-transparent font-mono text-[12px] text-muted-foreground hover:text-foreground"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => addEvent(pi, di)}
                            className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
                          >
                            + add event
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-1.5">
              <button
                type="button"
                onClick={apply}
                disabled={isPending}
                className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
              >
                {isPending ? "…" : "Apply"}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={isPending}
                className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
              >
                Cancel
              </button>
              {error ? <span className="font-mono text-[9px] text-clay">{error}</span> : null}
            </div>
          </>
        ) : (
          <>
            <Label>Plan your itinerary</Label>
            <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {destination}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Days
              </span>
              <input
                type="number"
                min={1}
                value={days}
                onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
                className="t-num w-16 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
              />
            </div>

            <div className="mt-3 space-y-1.5">
              {placeNames.map((name, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={name}
                    placeholder={`Place ${i + 1}`}
                    onChange={(e) => updatePlaceName(i, e.target.value)}
                    className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setPlaceNames((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    aria-label="Remove place"
                    className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setPlaceNames((prev) => [...prev, ""])}
                className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
              >
                + add place
              </button>
            </div>

            <div className="mt-4 flex items-center gap-1.5">
              <button
                type="button"
                onClick={generateDraft}
                className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background"
              >
                Generate draft
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
