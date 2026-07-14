"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Label } from "@/components/together"
import {
  ITINERARY_CATEGORIES,
  type ItinerarySkeleton,
  type SkeletonDay,
  type SkeletonEvent,
  type SkeletonPlace,
} from "@/lib/ai/itinerary-planner"
import { applyItinerarySkeleton, draftItineraryForTrip } from "@/lib/ai/itinerary-actions"
import { formatShortDate } from "@/lib/trips/itinerary-types"

export interface PlanItineraryProps {
  tripId: string
  tripSlug: string
  destination: string
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

/** One event plus the indices needed to route an edit back to its owning day. */
interface EventRef {
  dayIdx: number
  eventIdx: number
  event: SkeletonEvent
}

const CATEGORY_LIST: readonly string[] = ITINERARY_CATEGORIES

function categoryOf(event: SkeletonEvent): string {
  return event.category && CATEGORY_LIST.includes(event.category) ? event.category : "Other"
}

/** Flatten a place's days[].events into per-category buckets, keeping each
 * event's day/event indices so edits still target the right day. */
function groupPlaceEvents(place: SkeletonPlace): Map<string, EventRef[]> {
  const groups = new Map<string, EventRef[]>()
  place.days.forEach((day, dayIdx) => {
    day.events.forEach((event, eventIdx) => {
      const cat = categoryOf(event)
      const list = groups.get(cat) ?? []
      list.push({ dayIdx, eventIdx, event })
      groups.set(cat, list)
    })
  })
  return groups
}

/** One category's events for one place: date + time + text, each editable,
 * routed back to its owning day via dayIdx/eventIdx. */
function CategoryEventList({
  place,
  refs,
  onEdit,
  onRemove,
}: {
  place: SkeletonPlace
  refs: EventRef[]
  onEdit: (dayIdx: number, eventIdx: number, patch: Partial<SkeletonEvent>) => void
  onRemove: (dayIdx: number, eventIdx: number) => void
}) {
  return (
    <div className="mt-1.5 space-y-1">
      {refs.map(({ dayIdx, eventIdx, event }) => (
        <div key={`${dayIdx}-${eventIdx}`} className="flex items-center gap-2">
          <span className="t-num shrink-0 font-mono text-[10px] text-muted-foreground">
            {formatShortDate(place.days[dayIdx].date)}
          </span>
          <input
            type="text"
            value={event.time}
            placeholder="time"
            onChange={(e) => onEdit(dayIdx, eventIdx, { time: e.target.value })}
            className="t-num w-14 shrink-0 border-0 border-b border-border bg-transparent font-mono text-[11px] text-muted-foreground outline-none focus:border-foreground"
          />
          <input
            type="text"
            value={event.text}
            placeholder="What"
            onChange={(e) => onEdit(dayIdx, eventIdx, { text: e.target.value })}
            className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
          />
          <button
            type="button"
            onClick={() => onRemove(dayIdx, eventIdx)}
            aria-label="Remove event"
            className="border-0 bg-transparent font-mono text-[12px] text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

export function PlanItinerary({
  tripId,
  tripSlug,
  destination,
  dayCount,
}: PlanItineraryProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [placeNames, setPlaceNames] = React.useState<string[]>([""])
  const [activityTypes, setActivityTypes] = React.useState<string[]>([""])
  const [freeText, setFreeText] = React.useState("")
  const [days, setDays] = React.useState(dayCount)
  const [skeleton, setSkeleton] = React.useState<ItinerarySkeleton | null>(null)
  const [drafted, setDrafted] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function reset() {
    setOpen(false)
    setPlaceNames([""])
    setActivityTypes([""])
    setFreeText("")
    setDays(dayCount)
    setSkeleton(null)
    setDrafted(true)
    setError(null)
  }

  function generateDraft() {
    const names = placeNames.map((n) => n.trim()).filter((n) => n.length > 0)
    const types = activityTypes.map((t) => t.trim()).filter((t) => t.length > 0)
    setError(null)
    startTransition(async () => {
      try {
        const result = await draftItineraryForTrip({
          tripSlug,
          dayCount: days,
          placeNames: names,
          activityTypes: types,
          freeText,
        })
        setSkeleton(result.skeleton)
        setDrafted(result.drafted)
      } catch {
        setError("Couldn't draft right now — try again.")
      }
    })
  }

  function updatePlaceName(i: number, value: string) {
    setPlaceNames((prev) => prev.map((n, idx) => (idx === i ? value : n)))
  }

  function updateActivityType(i: number, value: string) {
    setActivityTypes((prev) => prev.map((t, idx) => (idx === i ? value : t)))
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

  /** New events go on the place's first day; the category view groups by
   * category, not day, so the day is just where it's stored. */
  function addEventInCategory(placeIdx: number, category: string) {
    setSkeleton((s) =>
      s
        ? withDay(s, placeIdx, 0, (day) => ({
            ...day,
            events: [...day.events, { text: "", time: "", category }],
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
            {!drafted ? (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                using a blank draft — turn the assistant on for suggestions.
              </p>
            ) : null}

            <div className="mt-2 max-h-[60vh] space-y-4 overflow-y-auto">
              {skeleton.places.map((place, pi) => {
                const groups = groupPlaceEvents(place)
                const canAdd = place.days.length > 0
                return (
                  <div key={pi}>
                    <div className="font-serif text-[15px] italic text-foreground">
                      {place.name}
                    </div>
                    <div className="mt-1.5 space-y-3">
                      {ITINERARY_CATEGORIES.map((cat) => {
                        const refs = groups.get(cat) ?? []
                        return (
                          <div key={cat}>
                            <div className="border-b border-rule pb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                              {cat}
                            </div>
                            <CategoryEventList
                              place={place}
                              refs={refs}
                              onEdit={(dayIdx, eventIdx, patch) =>
                                updateEvent(pi, dayIdx, eventIdx, patch)
                              }
                              onRemove={(dayIdx, eventIdx) => removeEvent(pi, dayIdx, eventIdx)}
                            />
                            <button
                              type="button"
                              onClick={() => addEventInCategory(pi, cat)}
                              disabled={!canAdd}
                              className="mt-1.5 rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground disabled:opacity-40"
                            >
                              + add event
                            </button>
                          </div>
                        )
                      })}
                      {(() => {
                        const other = groups.get("Other") ?? []
                        if (other.length === 0) return null
                        return (
                          <div>
                            <div className="border-b border-rule pb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                              Other
                            </div>
                            <CategoryEventList
                              place={place}
                              refs={other}
                              onEdit={(dayIdx, eventIdx, patch) =>
                                updateEvent(pi, dayIdx, eventIdx, patch)
                              }
                              onRemove={(dayIdx, eventIdx) => removeEvent(pi, dayIdx, eventIdx)}
                            />
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                )
              })}
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

            <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Activity types
            </div>
            <div className="mt-1.5 space-y-1.5">
              {activityTypes.map((type, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={type}
                    placeholder="e.g. hiking"
                    onChange={(e) => updateActivityType(i, e.target.value)}
                    className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setActivityTypes((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    aria-label="Remove activity type"
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
                onClick={() => setActivityTypes((prev) => [...prev, ""])}
                className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
              >
                + add type
              </button>
            </div>

            <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Anything else
            </div>
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              rows={3}
              placeholder="Notes for the assistant…"
              className="mt-1.5 w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-foreground"
            />

            <div className="mt-4 flex items-center gap-1.5">
              <button
                type="button"
                onClick={generateDraft}
                disabled={isPending}
                className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
              >
                {isPending ? "Drafting…" : "Generate draft"}
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
        )}
      </div>
    </div>
  )
}
