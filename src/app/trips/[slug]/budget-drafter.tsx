"use client"

import * as React from "react"

import { Label } from "@/components/together"
import { planBudgetSteps, type BudgetStep } from "@/lib/ai/budget-planner"
import { updateTripBudget } from "@/lib/trips/actions"
import {
  dayLocationMap,
  type DayLocation,
} from "@/lib/trips/location-budget-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

function fmt(cents: number): string {
  return (cents / 100).toFixed(0)
}

function fieldId(stepKey: string, fieldKey: string): string {
  return `${stepKey}::${fieldKey}`
}

interface Session {
  steps: BudgetStep[]
  /** fieldId -> euro string. */
  values: Record<string, string>
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
  const [session, setSession] = React.useState<Session | null>(null)
  const [stepIndex, setStepIndex] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  // Work from whatever the itinerary has: a date span, day rows, or locations.
  // Only a bare dateless dream with none of those has nothing to plan.
  const totalDays = tripDays > 0 ? tripDays : itineraryDays.length
  if (totalDays === 0 && locations.length === 0) return null

  function open() {
    const dayMap = dayLocationMap(itineraryDays)
    const nightsByLoc: Record<string, number> = {}
    for (const locId of Object.values(dayMap)) {
      nightsByLoc[locId] = (nightsByLoc[locId] ?? 0) + 1
    }
    const steps = planBudgetSteps({
      tripName,
      totalDays,
      memberCount,
      locations: locations.map((l) => ({
        id: l.id,
        name: l.name,
        nights: nightsByLoc[l.id] ?? 0,
      })),
    })
    const values: Record<string, string> = {}
    for (const step of steps) {
      for (const f of step.fields) {
        values[fieldId(step.key, f.key)] =
          f.suggestedCents != null ? fmt(f.suggestedCents) : ""
      }
    }
    setError(null)
    setStepIndex(0)
    setSession({ steps, values })
  }

  function setValue(id: string, value: string) {
    setSession((s) => (s ? { ...s, values: { ...s.values, [id]: value } } : s))
  }

  function totalCents(s: Session): number {
    return Object.values(s.values).reduce((sum, v) => {
      const n = Number(v)
      return sum + (Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0)
    }, 0)
  }

  function apply() {
    if (!session || isPending) return
    const total = totalCents(session)
    startTransition(async () => {
      const r = await updateTripBudget({
        tripId,
        tripSlug,
        plannedBudgetCents: total,
      })
      if (r.error) {
        setError(r.error)
        return
      }
      setSession(null)
    })
  }

  if (!session) {
    return (
      <div className="border-t border-border bg-background px-5 pt-4 pb-2">
        <button
          type="button"
          onClick={open}
          className="rounded-full border border-border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          Plan a budget
        </button>
      </div>
    )
  }

  const onSummary = stepIndex >= session.steps.length

  return (
    <div className="border-t border-border bg-background px-5 pt-4 pb-2">
      <div className="rounded-lg border border-border bg-card px-3.5 py-3">
        {onSummary
          ? renderSummary()
          : renderStep(session.steps[stepIndex])}
      </div>
    </div>
  )

  function renderStep(step: BudgetStep) {
    const isLast = stepIndex === session!.steps.length - 1
    return (
      <>
        <div className="flex items-center justify-between">
          <Label>/ assistant</Label>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            step {stepIndex + 1} of {session!.steps.length}
          </span>
        </div>

        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-serif text-[15px] italic text-foreground">
            {step.title}
          </span>
          {step.subtitle ? (
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              {step.subtitle}
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-[13px] text-foreground">{step.question}</div>
        {step.hint ? (
          <div className="mt-1 font-mono text-[10px] leading-snug tracking-[0.06em] text-muted-foreground">
            {step.hint}
          </div>
        ) : null}

        <div className="mt-3 space-y-2">
          {step.fields.map((f) => {
            const id = fieldId(step.key, f.key)
            return (
              <div key={id} className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-foreground">{f.label}</span>
                <span className="inline-flex items-baseline gap-1">
                  <span className="font-mono text-[12px] text-muted-foreground">
                    €
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="0"
                    value={session!.values[id] ?? ""}
                    onChange={(e) => setValue(id, e.target.value)}
                    disabled={isPending}
                    className="t-num w-24 border-0 border-b border-border bg-transparent text-right text-[14px] text-foreground outline-none focus:border-foreground"
                  />
                </span>
              </div>
            )
          })}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            disabled={stepIndex === 0}
            className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            back
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSession(null)}
              className="border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground rounded-md"
            >
              cancel
            </button>
            <button
              type="button"
              onClick={() => setStepIndex((i) => i + 1)}
              className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background"
            >
              {isLast ? "review" : "next"}
            </button>
          </div>
        </div>
      </>
    )
  }

  function renderSummary() {
    return (
      <>
        <div className="flex items-center justify-between">
          <Label>Your budget</Label>
          <button
            type="button"
            onClick={() => setStepIndex(session!.steps.length - 1)}
            disabled={isPending}
            className="border-0 bg-transparent p-0 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
          >
            back
          </button>
        </div>

        <div className="mt-2 border-t border-rule">
          {session!.steps.flatMap((step) =>
            step.fields.map((f) => {
              const id = fieldId(step.key, f.key)
              const label = step.key.startsWith("loc:")
                ? `${step.title} · ${f.label}`
                : f.label
              return (
                <div
                  key={id}
                  className="flex items-center justify-between gap-3 border-t border-rule py-2 first:border-t-0"
                >
                  <span className="text-[13px] text-foreground">{label}</span>
                  <span className="inline-flex items-baseline gap-1">
                    <span className="font-mono text-[12px] text-muted-foreground">
                      €
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      placeholder="0"
                      value={session!.values[id] ?? ""}
                      onChange={(e) => setValue(id, e.target.value)}
                      disabled={isPending}
                      className="t-num w-20 border-0 border-b border-border bg-transparent text-right text-[13px] text-foreground outline-none focus:border-foreground"
                    />
                  </span>
                </div>
              )
            }),
          )}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="font-serif text-[15px] italic text-foreground">
            Total
          </span>
          <span className="t-num text-[18px] text-foreground">
            €{fmt(totalCents(session!))}
          </span>
        </div>
        <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          Applying sets your trip budget.
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
            onClick={() => setSession(null)}
            disabled={isPending}
            className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
          >
            dismiss
          </button>
          {error ? (
            <span className="font-mono text-[9px] text-clay">{error}</span>
          ) : null}
        </div>
      </>
    )
  }
}
