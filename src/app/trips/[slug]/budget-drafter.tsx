"use client"

import * as React from "react"

import { Label } from "@/components/together"
import {
  draftBudget,
  type BudgetDraftLine,
} from "@/lib/ai/budget-planner"
import { setLocationBudget, updateTripBudget } from "@/lib/trips/actions"
import {
  dayLocationMap,
  type DayLocation,
} from "@/lib/trips/location-budget-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

function fmt(cents: number): string {
  return (cents / 100).toFixed(0)
}

interface DraftLineState {
  locationId: string
  name: string
  value: string
}

interface DraftState {
  total: string
  lines: DraftLineState[]
  rationale: string
}

/** True when the only line is the whole-trip envelope (no real locations yet). */
function isSynthetic(draft: DraftState): boolean {
  return draft.lines.length === 1 && draft.lines[0].locationId === ""
}

export interface BudgetDrafterProps {
  tripId: string
  tripSlug: string
  tripName: string
  /** Whole-trip duration in days, from the trip's date span (0 for a dateless dream). */
  tripDays: number
  locations: ItineraryLocation[]
  itineraryDays: DayLocation[]
  memberCount: number
}

export function BudgetDrafter({
  tripId,
  tripSlug,
  tripName,
  tripDays,
  locations,
  itineraryDays,
  memberCount,
}: BudgetDrafterProps) {
  const [draft, setDraft] = React.useState<DraftState | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  // Draft from whatever the itinerary has: a date span, day rows, or locations.
  // Only a trip with none of those (a bare dateless dream) has nothing to draft.
  const totalDays = tripDays > 0 ? tripDays : itineraryDays.length
  if (totalDays === 0 && locations.length === 0) return null

  function open() {
    const dayMap = dayLocationMap(itineraryDays)
    const daysByLoc: Record<string, number> = {}
    for (const locId of Object.values(dayMap)) {
      daysByLoc[locId] = (daysByLoc[locId] ?? 0) + 1
    }
    const result = draftBudget({
      totalDays,
      tripName,
      locations: locations.map((l) => ({
        id: l.id,
        name: l.name,
        days: daysByLoc[l.id] ?? 0,
      })),
      memberCount,
    })
    setError(null)
    setDraft({
      total: fmt(result.totalCents),
      rationale: result.rationale,
      lines: result.perLocation.map((l: BudgetDraftLine) => ({
        locationId: l.locationId,
        name: l.name,
        value: fmt(l.cents),
      })),
    })
  }

  function setTotal(value: string) {
    setDraft((d) => (d ? { ...d, total: value } : d))
  }

  function setLine(locationId: string, value: string) {
    setDraft((d) =>
      d
        ? {
            ...d,
            lines: d.lines.map((l) =>
              l.locationId === locationId ? { ...l, value } : l,
            ),
          }
        : d,
    )
  }

  function apply() {
    if (!draft || isPending) return
    const synthetic = isSynthetic(draft)
    startTransition(async () => {
      const totalCents = synthetic
        ? Math.round(Number(draft.lines[0].value) * 100)
        : Math.round(Number(draft.total) * 100)
      const r1 = await updateTripBudget({
        tripId,
        tripSlug,
        plannedBudgetCents: totalCents,
      })
      if (r1.error) {
        setError(r1.error)
        return
      }
      // A synthetic trip line has no location row to write; only the total lands.
      for (const line of draft.lines) {
        if (!line.locationId) continue
        const cents = Math.round(Number(line.value) * 100)
        if (cents <= 0) continue
        const r = await setLocationBudget({
          locationId: line.locationId,
          tripSlug,
          budgetCents: cents,
        })
        if (r.error) {
          setError(r.error)
          return
        }
      }
      setDraft(null)
    })
  }

  if (!draft) {
    return (
      <div className="border-t border-border bg-background px-5 pt-4 pb-2">
        <button
          type="button"
          onClick={open}
          className="rounded-full border border-border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          Draft a budget
        </button>
      </div>
    )
  }

  const synthetic = isSynthetic(draft)

  return (
    <div className="border-t border-border bg-background px-5 pt-4 pb-2">
      <div className="rounded-lg border border-border bg-card px-3.5 py-3">
        <Label>Drafted budget</Label>
        <div className="mt-1 font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          {draft.rationale}
        </div>

        {synthetic ? (
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="font-serif text-[14px] italic text-foreground">
              {draft.lines[0].name}
            </span>
            <span className="inline-flex items-baseline gap-1">
              <span className="font-mono text-[12px] text-muted-foreground">€</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.lines[0].value}
                onChange={(e) => setLine("", e.target.value)}
                disabled={isPending}
                className="t-num w-24 border-0 border-b border-border bg-transparent text-right text-[15px] text-foreground outline-none focus:border-foreground"
              />
            </span>
          </div>
        ) : (
          <>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="font-serif text-[14px] italic text-foreground">
                Total
              </span>
              <span className="inline-flex items-baseline gap-1">
                <span className="font-mono text-[12px] text-muted-foreground">
                  €
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={draft.total}
                  onChange={(e) => setTotal(e.target.value)}
                  disabled={isPending}
                  className="t-num w-24 border-0 border-b border-border bg-transparent text-right text-[15px] text-foreground outline-none focus:border-foreground"
                />
              </span>
            </div>

            <div className="mt-2 border-t border-rule">
              {draft.lines.map((line) => (
                <div
                  key={line.locationId}
                  className="flex items-center justify-between gap-3 border-t border-rule py-2 first:border-t-0"
                >
                  <span className="text-[13px] text-foreground">{line.name}</span>
                  <span className="inline-flex items-baseline gap-1">
                    <span className="font-mono text-[12px] text-muted-foreground">
                      €
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={line.value}
                      onChange={(e) => setLine(line.locationId, e.target.value)}
                      disabled={isPending}
                      className="t-num w-20 border-0 border-b border-border bg-transparent text-right text-[13px] text-foreground outline-none focus:border-foreground"
                    />
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          Applying replaces any existing budgets.
        </div>

        <div className="mt-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={apply}
            disabled={isPending}
            className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {isPending ? "…" : "apply"}
          </button>
          <button
            type="button"
            onClick={() => setDraft(null)}
            disabled={isPending}
            className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
          >
            dismiss
          </button>
          {error ? (
            <span className="font-mono text-[9px] text-clay">{error}</span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
