"use client"

import * as React from "react"

import { Label } from "@/components/together"
import {
  estimateItemCents,
  planBudgetSteps,
  type BudgetGroup,
  type BudgetStep,
} from "@/lib/ai/budget-planner"
import { updateTripBudget } from "@/lib/trips/actions"
import {
  locationDateLabel,
  type DayLocation,
} from "@/lib/trips/location-budget-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

function fmt(cents: number): string {
  return (cents / 100).toFixed(0)
}

function asCents(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

interface ItemRow {
  id: string
  subject: string
  when: string
  value: string
}

interface Session {
  steps: BudgetStep[]
  /** bucket id -> rows. Bucket = step.key (flat) or `${step.key}:${group.key}`. */
  items: Record<string, ItemRow[]>
}

/** The buckets a step holds: one per group, or a single one for a flat step. */
function stepBuckets(
  step: BudgetStep,
): { bucketId: string; group: BudgetGroup | null }[] {
  if (step.groups) {
    return step.groups.map((g) => ({ bucketId: `${step.key}:${g.key}`, group: g }))
  }
  return [{ bucketId: step.key, group: null }]
}

type SavedItems = Record<string, { subject: string; when: string; value: string }[]>

function planKey(tripId: string): string {
  return `together:budget-plan:${tripId}`
}

function loadSavedItems(tripId: string): SavedItems | null {
  try {
    const raw = window.localStorage.getItem(planKey(tripId))
    return raw ? (JSON.parse(raw) as SavedItems) : null
  } catch {
    return null
  }
}

function saveItems(tripId: string, items: Record<string, ItemRow[]>) {
  try {
    const plain: SavedItems = {}
    for (const [k, rows] of Object.entries(items)) {
      plain[k] = rows.map(({ subject, when, value }) => ({ subject, when, value }))
    }
    window.localStorage.setItem(planKey(tripId), JSON.stringify(plain))
  } catch {
    // storage unavailable (private mode / disabled) — saving is best-effort.
  }
}

export interface BudgetDrafterProps {
  tripId: string
  tripSlug: string
  tripName: string
  /** Whole-trip duration in days, from the trip's date span (0 for a dateless dream). */
  tripDays: number
  plannedBudgetCents: number
  locations: ItineraryLocation[]
  itineraryDays: DayLocation[]
  memberCount: number
}

export function BudgetDrafter({
  tripId,
  tripSlug,
  tripName,
  tripDays,
  plannedBudgetCents,
  locations,
  itineraryDays,
  memberCount,
}: BudgetDrafterProps) {
  const [session, setSession] = React.useState<Session | null>(null)
  const [stepIndex, setStepIndex] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const itemSeq = React.useRef(0)

  const totalDays = tripDays > 0 ? tripDays : itineraryDays.length
  if (totalDays === 0 && locations.length === 0) return null

  function newRow(subject = "", when = "", value = ""): ItemRow {
    return { id: `it-${itemSeq.current++}`, subject, when, value }
  }

  function open() {
    // Per-location nights + a human date label, from the itinerary days.
    const nightsByLoc: Record<string, number> = {}
    const datesByLoc: Record<string, string[]> = {}
    for (const d of itineraryDays) {
      if (d.locationId) {
        nightsByLoc[d.locationId] = (nightsByLoc[d.locationId] ?? 0) + 1
        ;(datesByLoc[d.locationId] ??= []).push(d.dayDate)
      }
    }
    const locInput = locations.map((l) => ({
      id: l.id,
      name: l.name,
      nights: nightsByLoc[l.id] ?? 0,
      dateLabel: locationDateLabel(l.startDate, l.endDate, datesByLoc[l.id] ?? []),
    }))

    const steps = planBudgetSteps({
      tripName,
      totalDays,
      memberCount,
      locations: locInput,
    })

    const saved = loadSavedItems(tripId)
    const items: Record<string, ItemRow[]> = {}
    for (const step of steps) {
      for (const { bucketId, group } of stepBuckets(step)) {
        const seed = group ? group.seed : step.seed ?? []
        const savedRows = saved?.[bucketId]
        items[bucketId] = savedRows
          ? savedRows.map((r) => newRow(r.subject, r.when, r.value))
          : seed.map((s) =>
              newRow(
                s.subject,
                s.when,
                s.suggestedCents != null ? fmt(s.suggestedCents) : "",
              ),
            )
      }
    }
    setError(null)
    setStepIndex(0)
    setSession({ steps, items })
  }

  function addItem(bucketId: string) {
    setSession((s) =>
      s
        ? {
            ...s,
            items: { ...s.items, [bucketId]: [...(s.items[bucketId] ?? []), newRow()] },
          }
        : s,
    )
  }

  function patchItem(bucketId: string, id: string, patch: Partial<ItemRow>) {
    setSession((s) =>
      s
        ? {
            ...s,
            items: {
              ...s.items,
              [bucketId]: (s.items[bucketId] ?? []).map((r) =>
                r.id === id ? { ...r, ...patch } : r,
              ),
            },
          }
        : s,
    )
  }

  function removeItem(bucketId: string, id: string) {
    setSession((s) =>
      s
        ? {
            ...s,
            items: {
              ...s.items,
              [bucketId]: (s.items[bucketId] ?? []).filter((r) => r.id !== id),
            },
          }
        : s,
    )
  }

  // Leaving a step: in each of its buckets drop empty rows, and for a row with a
  // subject/when but no cost let the assistant estimate it (explicit 0 is kept).
  function normalizeStep(step: BudgetStep) {
    setSession((s) => {
      if (!s) return s
      const items = { ...s.items }
      for (const { bucketId } of stepBuckets(step)) {
        items[bucketId] = (s.items[bucketId] ?? [])
          .filter(
            (r) =>
              r.subject.trim() !== "" ||
              r.when.trim() !== "" ||
              r.value.trim() !== "",
          )
          .map((r) =>
            (r.subject.trim() !== "" || r.when.trim() !== "") &&
            r.value.trim() === ""
              ? { ...r, value: fmt(estimateItemCents()) }
              : r,
          )
      }
      return { ...s, items }
    })
  }

  function goNext() {
    if (!session) return
    normalizeStep(session.steps[stepIndex])
    setStepIndex((i) => i + 1)
  }

  function totalCents(s: Session): number {
    let sum = 0
    for (const rows of Object.values(s.items)) {
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
      saveItems(tripId, session.items)
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
          {plannedBudgetCents > 0 ? "Edit budget" : "Plan a budget"}
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

  function renderRow(bucketId: string, row: ItemRow) {
    return (
      <div key={row.id} className="rounded-md border border-rule px-2.5 py-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={row.subject}
            placeholder="What"
            onChange={(e) => patchItem(bucketId, row.id, { subject: e.target.value })}
            disabled={isPending}
            className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
          />
          <button
            type="button"
            onClick={() => removeItem(bucketId, row.id)}
            disabled={isPending}
            aria-label="Remove"
            className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <input
            type="text"
            value={row.when}
            placeholder="When (e.g. 3 days, 12 Jan)"
            onChange={(e) => patchItem(bucketId, row.id, { when: e.target.value })}
            disabled={isPending}
            className="min-w-0 flex-1 border-0 border-b border-border bg-transparent font-mono text-[11px] tracking-[0.04em] text-muted-foreground outline-none focus:border-foreground"
          />
          <span className="inline-flex items-baseline gap-1">
            <span className="font-mono text-[12px] text-muted-foreground">€</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="0"
              value={row.value}
              onChange={(e) => patchItem(bucketId, row.id, { value: e.target.value })}
              disabled={isPending}
              className="t-num w-20 border-0 border-b border-border bg-transparent text-right text-[14px] text-foreground outline-none focus:border-foreground"
            />
          </span>
        </div>
      </div>
    )
  }

  function renderAddButton(bucketId: string, addNoun: string, here: boolean) {
    return (
      <button
        type="button"
        onClick={() => addItem(bucketId)}
        disabled={isPending}
        className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
      >
        + add {addNoun}
        {here ? " here" : ""}
      </button>
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

        <div className="mt-2 font-serif text-[15px] italic text-foreground">
          {step.title}
        </div>
        <div className="mt-1 text-[13px] text-foreground">{step.question}</div>
        {step.hint ? (
          <div className="mt-1 font-mono text-[10px] leading-snug tracking-[0.06em] text-muted-foreground">
            {step.hint}
          </div>
        ) : null}

        {step.groups ? (
          <div className="mt-3 space-y-3">
            {step.groups.map((g) => {
              const bucketId = `${step.key}:${g.key}`
              const rows = session!.items[bucketId] ?? []
              return (
                <div key={g.key}>
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-[13px] italic text-foreground">
                      {g.title}
                    </span>
                    {g.when ? (
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                        {g.when}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 space-y-2">
                    {rows.map((row) => renderRow(bucketId, row))}
                  </div>
                  <div className="mt-1.5">
                    {renderAddButton(bucketId, step.addNoun, true)}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <>
            <div className="mt-3 space-y-2">
              {(session!.items[step.key] ?? []).map((row) =>
                renderRow(step.key, row),
              )}
            </div>
            <div className="mt-2">{renderAddButton(step.key, step.addNoun, false)}</div>
          </>
        )}

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
              onClick={goNext}
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
    const lines: {
      id: string
      primary: string
      when: string
      value: string
      onChange: (v: string) => void
    }[] = []
    for (const step of session!.steps) {
      for (const { bucketId, group } of stepBuckets(step)) {
        for (const row of session!.items[bucketId] ?? []) {
          const subject = row.subject.trim()
          const primary = group
            ? subject
              ? `${group.title} · ${subject}`
              : group.title
            : subject || step.title
          lines.push({
            id: row.id,
            primary,
            when: row.when,
            value: row.value,
            onChange: (v) => patchItem(bucketId, row.id, { value: v }),
          })
        }
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
          {lines.length === 0 ? (
            <div className="py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Nothing added yet
            </div>
          ) : (
            lines.map((line) => (
              <div
                key={line.id}
                className="flex items-center justify-between gap-3 border-t border-rule py-2 first:border-t-0"
              >
                <span className="min-w-0">
                  <span className="text-[13px] text-foreground">{line.primary}</span>
                  {line.when ? (
                    <span className="ml-2 font-mono text-[10px] tracking-[0.04em] text-muted-foreground">
                      {line.when}
                    </span>
                  ) : null}
                </span>
                <span className="inline-flex items-baseline gap-1">
                  <span className="font-mono text-[12px] text-muted-foreground">€</span>
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
            ))
          )}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="font-serif text-[15px] italic text-foreground">Total</span>
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
