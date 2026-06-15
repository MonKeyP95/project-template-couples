# Mock Budget-Planning Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Draft a budget" assistant to the Budget view that proposes a master total + per-location split from the trip's structure, with an editable preview that writes through existing actions.

**Architecture:** A pure heuristic module (`lib/ai/budget-planner.ts`) is the seam where real Claude lands later — it takes typed trip facts and returns a typed draft, with no network and no async. A client component renders a button and an editable preview, and Apply calls the existing `updateTripBudget` and `setLocationBudget` server actions. No new tables, no new server actions.

**Tech Stack:** Next.js 16 App Router, React 19 client component, TypeScript, existing Supabase-backed server actions.

**Testing note:** This repo has no test framework and `CLAUDE.md` says not to invent one. The verification gate for every task is `pnpm lint` + `pnpm build` passing, plus the manual check described in the final task. Do not add a test runner.

---

### Task 1: The drafter seam (pure heuristic)

**Files:**
- Create: `src/lib/ai/budget-planner.ts`

- [ ] **Step 1: Write the module**

```ts
/**
 * Slice 1 mock for the budget-planning assistant. Pure, deterministic, no
 * network. This is the seam where real Claude lands later: keep the input and
 * output types stable, then make draftBudget async and call the LLM client.
 * The `context` field is reserved for that (trip notes) and is unused here.
 */

export interface BudgetDraftInput {
  locations: { id: string; name: string; days: number }[]
  memberCount: number
  context?: string
}

export interface BudgetDraftLine {
  locationId: string
  name: string
  cents: number
}

export interface BudgetDraft {
  totalCents: number
  perLocation: BudgetDraftLine[]
  rationale: string
}

const DAILY_PER_PERSON_CENTS = 11000

export function draftBudget(input: BudgetDraftInput): BudgetDraft {
  const memberCount = Math.max(1, input.memberCount)
  // A dateless location still gets a share: floor its day count at 1.
  const locations = input.locations.map((l) => ({
    ...l,
    days: Math.max(1, l.days),
  }))
  const totalDays = locations.reduce((sum, l) => sum + l.days, 0)
  const totalCents = totalDays * DAILY_PER_PERSON_CENTS * memberCount

  const perLocation: BudgetDraftLine[] = locations.map((l) => ({
    locationId: l.id,
    name: l.name,
    cents: Math.floor((totalCents * l.days) / totalDays),
  }))

  // Rounding remainder lands on the location with the most days, so the split
  // always sums to exactly totalCents.
  const allocated = perLocation.reduce((sum, l) => sum + l.cents, 0)
  const remainder = totalCents - allocated
  if (remainder > 0 && perLocation.length > 0) {
    let maxIdx = 0
    for (let i = 1; i < locations.length; i++) {
      if (locations[i].days > locations[maxIdx].days) maxIdx = i
    }
    perLocation[maxIdx].cents += remainder
  }

  const perDay = DAILY_PER_PERSON_CENTS / 100
  const nights = totalDays === 1 ? "night" : "nights"
  const rationale = `${totalDays} ${nights} x EUR ${perDay}/person/day x ${memberCount}`

  return { totalCents, perLocation, rationale }
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `pnpm lint`
Expected: no errors for `src/lib/ai/budget-planner.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/budget-planner.ts
git commit -m "feat(ai): pure heuristic budget drafter (Phase 5 seam)"
```

---

### Task 2: The drafter UI (button + editable preview)

**Files:**
- Create: `src/app/trips/[slug]/budget-drafter.tsx`

This is a `"use client"` component. It computes days-per-location from `itineraryDays` using the existing `dayLocationMap`, calls `draftBudget`, and holds the editable preview in local state (editable string values live in the same state object — no `useEffect` to reset). Apply writes the total via `updateTripBudget`, then each location via `setLocationBudget`, sequentially inside one transition.

- [ ] **Step 1: Write the component**

```tsx
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

export interface BudgetDrafterProps {
  tripId: string
  tripSlug: string
  locations: ItineraryLocation[]
  itineraryDays: DayLocation[]
  memberCount: number
}

export function BudgetDrafter({
  tripId,
  tripSlug,
  locations,
  itineraryDays,
  memberCount,
}: BudgetDrafterProps) {
  const [draft, setDraft] = React.useState<DraftState | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  if (locations.length === 0) return null

  function open() {
    const dayMap = dayLocationMap(itineraryDays)
    const daysByLoc: Record<string, number> = {}
    for (const locId of Object.values(dayMap)) {
      daysByLoc[locId] = (daysByLoc[locId] ?? 0) + 1
    }
    const result = draftBudget({
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
    startTransition(async () => {
      const totalCents = Math.round(Number(draft.total) * 100)
      const r1 = await updateTripBudget({
        tripId,
        tripSlug,
        plannedBudgetCents: totalCents,
      })
      if (r1.error) {
        setError(r1.error)
        return
      }
      for (const line of draft.lines) {
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

  return (
    <div className="border-t border-border bg-background px-5 pt-4 pb-2">
      <div className="rounded-lg border border-border bg-card px-3.5 py-3">
        <Label>Drafted budget</Label>
        <div className="mt-1 font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          {draft.rationale}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="font-serif text-[14px] italic text-foreground">
            Total
          </span>
          <span className="inline-flex items-baseline gap-1">
            <span className="font-mono text-[12px] text-muted-foreground">€</span>
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
```

- [ ] **Step 2: Verify it lints**

Run: `pnpm lint`
Expected: no errors for `src/app/trips/[slug]/budget-drafter.tsx`. (It is not rendered yet; this just checks the file in isolation.)

- [ ] **Step 3: Commit**

```bash
git add src/app/trips/[slug]/budget-drafter.tsx
git commit -m "feat(budget): drafter button + editable preview"
```

---

### Task 3: Wire the drafter into the Budget view

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

The drafter renders only in the `"budget"` view, just above `BudgetByLocation`. Member count is derived from the `members` record.

- [ ] **Step 1: Add the import**

Add this import alongside the other local component imports near the top of `budget-tab.tsx` (next to the `import { BudgetByLocation } from "./budget-by-location"` line):

```tsx
import { BudgetDrafter } from "./budget-drafter"
```

- [ ] **Step 2: Render the drafter in the budget view**

In `budget-tab.tsx`, in the `view === "budget"` block, insert `BudgetDrafter` between the `CompactSettle` element and the `BudgetByLocation` element. The result reads:

```tsx
          <CompactSettle
            summary={summary}
            currentUserId={currentUserId}
            tripId={tripId}
            tripSlug={tripSlug}
          />
          <BudgetDrafter
            tripId={tripId}
            tripSlug={tripSlug}
            locations={locations}
            itineraryDays={itineraryDays}
            memberCount={Object.keys(members).length}
          />
          <BudgetByLocation
            tripId={tripId}
            tripSlug={tripSlug}
            masterBudgetCents={plannedBudgetCents}
            locations={locations}
            expenses={expenses}
            itineraryDays={itineraryDays}
            members={members}
            moves={moves}
            categories={expenseCategories}
          />
```

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: both pass. (If `pnpm build` hits a Turbopack `0xc0000142` subprocess panic on Windows — a known flake, not a code bug — stop, delete `.next/`, and rerun.)

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/[slug]/budget-tab.tsx
git commit -m "feat(budget): render drafter in budget view"
```

---

### Task 4: Manual verification + docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Manual check on the seeded trip**

Run `pnpm dev`, open the seeded Lombok trip, go to the Budget tab → Budget view.
Confirm:
1. A "Draft a budget" button shows above "Budget by location".
2. Clicking it reveals a preview with a plausible total, a rationale line, and one editable row per location whose amounts sum to the total.
3. Editing the total and a row value works.
4. Clicking "apply" updates the master budget figure (top of the view) and the per-location envelope targets in "Budget by location"; "dismiss" closes without writing.

- [ ] **Step 2: Update TODO.md**

Add a line under the appropriate Phase 5 / in-progress section of `docs/TODO.md` recording that the mock budget-planning assistant (Slice 1) shipped: drafter seam at `lib/ai/budget-planner.ts`, editable preview in the Budget view, writes via existing actions. Note Slice 2 (learn from existing expenses; trip-notes context) and real LLM wiring remain.

- [ ] **Step 3: Add a DECISIONS.md row**

Append a row to `docs/DECISIONS.md` capturing: the AI assistant is being built mock-first behind a pure `draftBudget(input)` seam (no SDK, no tables); real LLM is a one-file swap; learning-from-spend will derive from existing `expenses` rather than a new preferences table.

- [ ] **Step 4: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record mock budget drafter (Phase 5 slice 1)"
```

---

## Self-Review

- **Spec coverage:** seam module (Task 1), button + editable preview + apply via existing actions (Task 2), budget-view placement + hidden-when-no-locations + memberCount (Tasks 2-3), manual verification + docs (Task 4), deferrals recorded (Task 4). No new tables or actions, matching the spec.
- **Type consistency:** `draftBudget`/`BudgetDraftInput`/`BudgetDraft`/`BudgetDraftLine` defined in Task 1 are the exact names imported and used in Task 2. `BudgetDrafterProps` in Task 2 matches the props passed in Task 3. Action calls match real signatures: `updateTripBudget({ tripId, tripSlug, plannedBudgetCents })`, `setLocationBudget({ locationId, tripSlug, budgetCents })`.
- **No placeholders:** every code step is complete.
