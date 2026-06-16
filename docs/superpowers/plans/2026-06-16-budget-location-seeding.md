# Budget location-aware seeding (Part A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the budget assistant's Accommodation and Activities steps group by itinerary location (header per place, multiple rows per place, location-seeded), while Transport/Food/Other stay flat.

**Architecture:** `BudgetStep` gains an optional `groups: BudgetGroup[]` alongside flat `seed`; `planBudgetSteps` takes `locations` and builds grouped steps. The drafter keys rows per **bucket** (`step.key`, or `step.key:locationId` for grouped) and renders grouped steps as per-location sub-lists. Pure mock; no server/data change (the Activities category landed in Part B / PR #51).

**Tech Stack:** React 19 client component, TypeScript; existing `dayLocationMap` + `locationDateLabel` helpers.

**Testing note:** No test framework; `CLAUDE.md` says not to invent one. Gate per task is `pnpm lint` + `pnpm build`, plus the manual check in the last task.

---

### Task 1: Grouped steps in the seam

**Files:**
- Modify: `src/lib/ai/budget-planner.ts`

- [ ] **Step 1: Replace the file contents**

```ts
/**
 * Mock for the guided budget assistant. Pure, deterministic, no network. The
 * seam where real Claude lands later: keep the input/output types stable, then
 * make planBudgetSteps async and generate the interview from the LLM client.
 * The `context` field is reserved for that (trip notes), unused here.
 *
 * Steps are categories. Accommodation and Activities are *grouped by location*
 * (one sub-group per itinerary place, holding several hotels / activities);
 * Transport, Food and Other are flat trip-wide add-lists.
 */

export interface BudgetPlanInput {
  tripName: string
  /** Whole-trip nights; drives the trip-wide suggestions and the no-location fallback. */
  totalDays: number
  memberCount: number
  /** Itinerary places in order; empty for a location-less trip. */
  locations: { id: string; name: string; nights: number; dateLabel: string | null }[]
  context?: string
}

export interface SeedItem {
  subject: string
  when: string
  suggestedCents: number | null
}

export interface BudgetGroup {
  /** Location id, or "trip" for the no-location fallback. */
  key: string
  title: string
  /** Date label / nights, shown in the group header. */
  when: string
  seed: SeedItem[]
}

export interface BudgetStep {
  key: string
  title: string
  question: string
  hint: string | null
  addNoun: string
  /** A flat step has `seed`; a grouped (by-location) step has `groups`. */
  seed?: SeedItem[]
  groups?: BudgetGroup[]
}

const LODGING_PER_NIGHT_CENTS = 11000
const TRANSPORT_PER_PERSON_CENTS = 15000
const FOOD_PER_PERSON_DAY_CENTS = 2500
const ITEM_ESTIMATE_CENTS = 5000

function euros(cents: number): string {
  return (cents / 100).toFixed(0)
}

/**
 * The assistant's guess for an item left without a cost. Mock returns a flat
 * figure; real Claude later assesses it from the item's subject. An explicit 0
 * (e.g. staying with friends) is kept as-is and never estimated.
 */
export function estimateItemCents(): number {
  return ITEM_ESTIMATE_CENTS
}

export function planBudgetSteps(input: BudgetPlanInput): BudgetStep[] {
  const memberCount = Math.max(1, input.memberCount)
  const totalDays = Math.max(1, input.totalDays)

  // Places to group by: the itinerary locations, or one synthetic group named
  // after the trip when there are none.
  const places =
    input.locations.length > 0
      ? input.locations.map((l) => ({ ...l, nights: Math.max(1, l.nights) }))
      : [
          {
            id: "trip",
            name: input.tripName,
            nights: totalDays,
            dateLabel: null as string | null,
          },
        ]

  function whenLabel(p: { nights: number; dateLabel: string | null }): string {
    return p.dateLabel ?? `${p.nights} ${p.nights === 1 ? "night" : "nights"}`
  }

  const accommodationGroups: BudgetGroup[] = places.map((p) => ({
    key: p.id,
    title: p.name,
    when: whenLabel(p),
    seed: [
      {
        subject: "",
        when: p.dateLabel ?? "",
        suggestedCents: p.nights * LODGING_PER_NIGHT_CENTS,
      },
    ],
  }))

  const activityGroups: BudgetGroup[] = places.map((p) => ({
    key: p.id,
    title: p.name,
    when: whenLabel(p),
    seed: [],
  }))

  const transport = TRANSPORT_PER_PERSON_CENTS * memberCount
  const food = FOOD_PER_PERSON_DAY_CENTS * memberCount * totalDays
  const days = `${totalDays} ${totalDays === 1 ? "day" : "days"}`

  return [
    {
      key: "accommodation",
      title: "Accommodation",
      question: "Where are you staying in each place?",
      hint: `Roughly EUR ${euros(LODGING_PER_NIGHT_CENTS)}/night. Add each hotel with its cost.`,
      addNoun: "hotel",
      groups: accommodationGroups,
    },
    {
      key: "transport",
      title: "Transport",
      question: "Flights and getting around?",
      hint: `Roughly EUR ${euros(TRANSPORT_PER_PERSON_CENTS)} each for ${memberCount}.`,
      addNoun: "transport",
      seed: [{ subject: "", when: "", suggestedCents: transport }],
    },
    {
      key: "food",
      title: "Food & drink",
      question: "Eating out and groceries?",
      hint: `About EUR ${euros(FOOD_PER_PERSON_DAY_CENTS)} each a day over ${days}.`,
      addNoun: "food",
      seed: [{ subject: "", when: days, suggestedCents: food }],
    },
    {
      key: "activities",
      title: "Activities",
      question: "Anything you'd like to do in each place?",
      hint: "Surfing, diving, a tour... add each with its cost. Skip if none.",
      addNoun: "activity",
      groups: activityGroups,
    },
    {
      key: "other",
      title: "Anything else",
      question: "Anything else to budget for?",
      hint: "Insurance, gifts, a buffer... add each with a label and cost. Skip if none.",
      addNoun: "item",
      seed: [],
    },
  ]
}
```

- [ ] **Step 2: Verify it lints**

Run: `pnpm lint`
Expected: no errors for `src/lib/ai/budget-planner.ts`. (The drafter will not compile against the new shape until Task 2; run the full build at the end of Task 2.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/budget-planner.ts
git commit -m "feat(budget): grouped-by-location steps in the planner seam"
```

---

### Task 2: Bucket-keyed drafter with grouped rendering

**Files:**
- Modify: `src/app/trips/[slug]/budget-drafter.tsx` (full rewrite)
- Modify: `src/app/trips/[slug]/budget-tab.tsx` (pass `tripName`)

- [ ] **Step 1: Replace `budget-drafter.tsx` with the bucket-keyed version**

```tsx
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
```

- [ ] **Step 2: Pass `tripName` from `budget-tab.tsx`**

In `src/app/trips/[slug]/budget-tab.tsx`, the `<BudgetDrafter>` call, add the `tripName` prop (it's already a `BudgetTab` prop):

```tsx
          <BudgetDrafter
            tripId={tripId}
            tripSlug={tripSlug}
            tripName={tripName}
            tripDays={tripDays}
            plannedBudgetCents={plannedBudgetCents}
            locations={locations}
            itineraryDays={itineraryDays}
            memberCount={Object.keys(members).length}
          />
```

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: both pass. (Turbopack `0xc0000142` on Windows is a known flake — delete `.next/` and rerun if hit.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/trips/[slug]/budget-drafter.tsx" "src/app/trips/[slug]/budget-tab.tsx"
git commit -m "feat(budget): location-grouped accommodation + activities in the drafter"
```

---

### Task 3: Manual verification + docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Manual check**

Run `pnpm dev`, open a trip with 2+ itinerary locations → Budget tab → "Plan a budget"/"Edit budget".
Confirm:
1. **Accommodation** shows one sub-group per place (header `place · dates`), each pre-seeded with one hotel row and a "+ add hotel here". Adding a second hotel keeps it under that place.
2. **Transport** and **Food** are single trip-wide rows; **Other** is an empty flat add-list.
3. **Activities** shows the same per-place groups, empty, each with "+ add activity here"; multiple activities per place work.
4. The summary lists rows as `place · subject` for grouped ones; the total includes everything; **apply** sets the budget; reopening **Edit budget** restores rows into their places.
5. A trip with **no locations** shows a single group named after the trip under Accommodation/Activities.

- [ ] **Step 2: Update TODO.md**

Add a line near the top recording Part A: Accommodation + Activities now group by itinerary location (per-place headers, multiple hotels/activities per place, location-seeded); Transport/Food/Other stay flat; rows keyed per bucket; localStorage restores rows into their place. Reference the spec `docs/superpowers/specs/2026-06-16-budget-location-hybrid-design.md` and plan `docs/superpowers/plans/2026-06-16-budget-location-seeding.md`.

- [ ] **Step 3: Add a DECISIONS.md row**

Append a row: budget assistant is a hybrid — Accommodation/Activities grouped by location (place-walk feel + multiple per place), other categories flat; restores the location smoothness without losing category correctness; still total-only mock behind `planBudgetSteps`.

- [ ] **Step 4: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record budget location-aware seeding (Part A)"
```

---

## Self-Review

- **Spec coverage (Part A):** grouped steps in seam (Task 1), bucket-keyed drafter + grouped render + location-aware open() + tripName wiring + no-location fallback + localStorage per bucket (Task 2), manual check + docs (Task 3). Part B shipped separately (PR #51).
- **Type consistency:** `BudgetGroup`/`BudgetStep.groups`/`SeedItem` from Task 1 are imported and used in Task 2; `stepBuckets` keys (`step.key` / `${step.key}:${group.key}`) are used identically in open/add/patch/remove/normalize/render/summary; `BudgetPlanInput` now requires `tripName` + `locations`, both supplied by the drafter; `BudgetDrafterProps` gains `tripName`, passed in Task 2 Step 2.
- **No placeholders:** full file contents / exact edits in every code step. `open()` iterates `itineraryDays` directly (no `dayLocationMap`), so only `locationDateLabel` + `DayLocation` are imported — no unused import.
