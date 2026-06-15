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

function asCents(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

interface ActivityRow {
  id: string
  label: string
  value: string
}

interface Session {
  steps: BudgetStep[]
  /** simple field amounts: fieldId -> euro string. */
  values: Record<string, string>
  /** added activities: stepKey -> rows. */
  activities: Record<string, ActivityRow[]>
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
  const activitySeq = React.useRef(0)

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
    setSession({ steps, values, activities: {} })
  }

  function setValue(id: string, value: string) {
    setSession((s) => (s ? { ...s, values: { ...s.values, [id]: value } } : s))
  }

  function addActivity(stepKey: string, label: string, value: string) {
    const row: ActivityRow = { id: `act-${activitySeq.current++}`, label, value }
    setSession((s) =>
      s
        ? {
            ...s,
            activities: {
              ...s.activities,
              [stepKey]: [...(s.activities[stepKey] ?? []), row],
            },
          }
        : s,
    )
  }

  function patchActivity(
    stepKey: string,
    id: string,
    patch: Partial<Pick<ActivityRow, "label" | "value">>,
  ) {
    setSession((s) =>
      s
        ? {
            ...s,
            activities: {
              ...s.activities,
              [stepKey]: (s.activities[stepKey] ?? []).map((r) =>
                r.id === id ? { ...r, ...patch } : r,
              ),
            },
          }
        : s,
    )
  }

  function removeActivity(stepKey: string, id: string) {
    setSession((s) =>
      s
        ? {
            ...s,
            activities: {
              ...s.activities,
              [stepKey]: (s.activities[stepKey] ?? []).filter(
                (r) => r.id !== id,
              ),
            },
          }
        : s,
    )
  }

  function totalCents(s: Session): number {
    let sum = 0
    for (const v of Object.values(s.values)) sum += asCents(v)
    for (const rows of Object.values(s.activities)) {
      for (const r of rows) sum += asCents(r.value)
    }
    return sum
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
        {onSummary ? renderSummary() : renderStep(session.steps[stepIndex])}
      </div>
    </div>
  )

  function renderActivities(step: BudgetStep) {
    const rows = session!.activities[step.key] ?? []
    return (
      <div className="mt-3 border-t border-rule pt-2.5">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Activities
        </div>

        <div className="mt-1.5 space-y-1.5">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <input
                type="text"
                value={row.label}
                placeholder="Activity"
                onChange={(e) =>
                  patchActivity(step.key, row.id, { label: e.target.value })
                }
                disabled={isPending}
                className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
              />
              <span className="inline-flex items-baseline gap-1">
                <span className="font-mono text-[12px] text-muted-foreground">
                  €
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="0"
                  value={row.value}
                  onChange={(e) =>
                    patchActivity(step.key, row.id, { value: e.target.value })
                  }
                  disabled={isPending}
                  className="t-num w-16 border-0 border-b border-border bg-transparent text-right text-[13px] text-foreground outline-none focus:border-foreground"
                />
              </span>
              <button
                type="button"
                onClick={() => removeActivity(step.key, row.id)}
                disabled={isPending}
                aria-label="Remove activity"
                className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {(step.activitySuggestions ?? []).map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => addActivity(step.key, s.label, fmt(s.cents))}
              disabled={isPending}
              className="rounded-full border border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
            >
              + {s.label} €{fmt(s.cents)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => addActivity(step.key, "", "")}
            disabled={isPending}
            className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
          >
            + your own
          </button>
        </div>
      </div>
    )
  }

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

        {step.activitySuggestions ? renderActivities(step) : null}

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
              className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground"
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
    const lines: { id: string; label: string; value: string; onChange: (v: string) => void }[] =
      []
    for (const step of session!.steps) {
      const isLoc = step.key.startsWith("loc:")
      for (const f of step.fields) {
        const id = fieldId(step.key, f.key)
        lines.push({
          id,
          label: isLoc ? `${step.title} · ${f.label}` : f.label,
          value: session!.values[id] ?? "",
          onChange: (v) => setValue(id, v),
        })
      }
      for (const row of session!.activities[step.key] ?? []) {
        lines.push({
          id: row.id,
          label: `${step.title} · ${row.label || "Activity"}`,
          value: row.value,
          onChange: (v) => patchActivity(step.key, row.id, { value: v }),
        })
      }
    }

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
          {lines.map((line) => (
            <div
              key={line.id}
              className="flex items-center justify-between gap-3 border-t border-rule py-2 first:border-t-0"
            >
              <span className="text-[13px] text-foreground">{line.label}</span>
              <span className="inline-flex items-baseline gap-1">
                <span className="font-mono text-[12px] text-muted-foreground">
                  €
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="0"
                  value={line.value}
                  onChange={(e) => line.onChange(e.target.value)}
                  disabled={isPending}
                  className="t-num w-20 border-0 border-b border-border bg-transparent text-right text-[13px] text-foreground outline-none focus:border-foreground"
                />
              </span>
            </div>
          ))}
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
