# Budget learning — Slice 2.5 Implementation Plan (per-trip budget summary)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-trip "Trip budget" summary under each trip's heading in the `/profile` "By trip" zone, fed by a single budget fetch shared with the existing cross-trip history.

**Architecture:** Add a pure `buildTripBudgetSummary` that re-pivots Slice 2's per-trip rollup by trip. Refactor the budget query so `/profile` fetches rollups once and derives both the cross-trip history and the per-trip summaries. Render a static `TripBudget` section, and restructure the "By trip" block to iterate the union of trips-with-taste and trips-with-real-spend.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4. pnpm.

## Global Constraints

- No new dependency, table, column, or migration. Deterministic; numbers are the artifact; no AI.
- Amounts are integer cents; format only at render (`(cents / 100).toFixed(0)`).
- `budget-history-queries.ts` is server-only; never import it into a client component. `TripBudget` is a static (non-client) component.
- Variance tone: clay when over plan, muted otherwise — consistent with Slices 1-2.
- The bottom `BudgetHistory` (Slice 2) zone stays untouched.
- No emojis; sparse comments; short functions.
- Spec: `docs/superpowers/specs/2026-07-14-budget-learning-slice-2_5-per-trip-summary-design.md`.

---

### Task 1: Pure layer — `buildTripBudgetSummary`

**Files:**
- Modify: `src/lib/trips/budget-history-types.ts` (add type + function)
- Verify (throwaway, deleted before commit): `trip-summary-check.mts` at repo root

**Interfaces:**
- Consumes: `CategoryRollup`, `TripRollupInput` (already in this file).
- Produces: `TripBudgetSummary { tripId, tripName, categories: CategoryRollup[], totalPlannedCents, totalActualCents }`; `buildTripBudgetSummary(input: TripRollupInput): TripBudgetSummary`.

- [ ] **Step 1: Write the failing verification script**

Create `trip-summary-check.mts` at repo root:

```ts
import { buildTripBudgetSummary } from "./src/lib/trips/budget-history-types"

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg)
    process.exit(1)
  }
}

const input: any = {
  tripId: "t1",
  tripName: "Denmark",
  startDate: "2026-06-01",
  dayCount: 7,
  rollup: [
    { category: "Food", plannedCents: 40000, actualCents: 52000 },
    { category: "Accommodation", plannedCents: 70000, actualCents: 70000 },
  ],
}
const s = buildTripBudgetSummary(input)
assert(s.tripId === "t1" && s.tripName === "Denmark", "identity")
assert(s.categories.length === 2, "categories passthrough")
assert(s.totalPlannedCents === 110000, "total planned")
assert(s.totalActualCents === 122000, "total actual")

const empty = buildTripBudgetSummary({
  tripId: "t2",
  tripName: "x",
  startDate: "2026-01-01",
  dayCount: 5,
  rollup: [{ category: "Food", plannedCents: 1000, actualCents: 0 }],
} as any)
assert(empty.totalActualCents === 0, "no spend -> total actual 0")

console.log("OK", JSON.stringify(s))
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx --yes tsx trip-summary-check.mts`
Expected: FAIL — `buildTripBudgetSummary` is not exported yet.

- [ ] **Step 3: Add the type and function**

In `src/lib/trips/budget-history-types.ts`, append after the existing `buildBudgetHistory` function:

```ts
export interface TripBudgetSummary {
  tripId: string
  tripName: string
  /** The trip's per-category rollup (categories with a plan or spend), ordered by catOrder. */
  categories: CategoryRollup[]
  totalPlannedCents: number
  totalActualCents: number
}

/**
 * Trip-first view: the trip's full rollup plus totals. Render only when
 * totalActualCents > 0 (real spend) — the /profile query filters on that.
 */
export function buildTripBudgetSummary(
  input: TripRollupInput,
): TripBudgetSummary {
  const categories = input.rollup
  return {
    tripId: input.tripId,
    tripName: input.tripName,
    categories,
    totalPlannedCents: categories.reduce((s, c) => s + c.plannedCents, 0),
    totalActualCents: categories.reduce((s, c) => s + c.actualCents, 0),
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx --yes tsx trip-summary-check.mts`
Expected: prints `OK [...]` and exits 0.

- [ ] **Step 5: Lint, delete throwaway, commit**

Run: `pnpm lint` (expected clean). Then `rm trip-summary-check.mts`.

```bash
git add src/lib/trips/budget-history-types.ts
git commit -m "feat(budget): buildTripBudgetSummary (slice 2.5 pure layer)"
```

---

### Task 2: Query refactor + Trip budget section on /profile

**Files:**
- Modify: `src/lib/trips/budget-history-queries.ts` (extract `getTripRollups`; replace `getBudgetHistory` with `getProfileBudgetData`)
- Create: `src/app/profile/trip-budget.tsx`
- Modify: `src/app/profile/page.tsx` (imports, single fetch, union rows, render restructure)

**Interfaces:**
- Consumes: Task 1's `buildTripBudgetSummary`, `TripBudgetSummary`; existing `perCategoryRollup`/`ExpenseSpend`/`PlannedSpend`, `buildBudgetHistory`/`dayCountInclusive`/`CategoryHistory`/`TripRollupInput`, `EXPENSE_CATEGORIES`, `TripListItem`.
- Produces: `getTripRollups(trips): Promise<TripRollupInput[]>`; `getProfileBudgetData(trips): Promise<{ history: CategoryHistory[]; summaries: TripBudgetSummary[] }>`; `TripBudget({ summary })`.

- [ ] **Step 1: Refactor the query (single fetch, two lenses)**

Replace the entire contents of `src/lib/trips/budget-history-queries.ts` with:

```ts
import { createClient } from "@/lib/supabase/server"
import { EXPENSE_CATEGORIES } from "@/lib/trips/expense-types"
import type { TripListItem } from "@/lib/trips/list-queries"
import {
  perCategoryRollup,
  type ExpenseSpend,
  type PlannedSpend,
} from "@/lib/trips/budget-rollup-types"
import {
  buildBudgetHistory,
  buildTripBudgetSummary,
  dayCountInclusive,
  type CategoryHistory,
  type TripBudgetSummary,
  type TripRollupInput,
} from "@/lib/trips/budget-history-types"

interface ExpenseRow {
  trip_id: string
  category: string
  amount_cents: number
  is_settlement: boolean
}
interface ItemRow {
  trip_id: string
  category: string
  amount_cents: number
}

/**
 * Per-trip Slice-1 rollups for the given trips (pass the started ones). One
 * batched read of expenses + budget items; RLS-scoped by the caller's session.
 */
export async function getTripRollups(
  trips: TripListItem[],
): Promise<TripRollupInput[]> {
  const dated = trips.filter((t) => t.startDate && t.endDate)
  const tripIds = dated.map((t) => t.id)
  if (tripIds.length === 0) return []

  const supabase = await createClient()
  const [{ data: expRows }, { data: itemRows }] = await Promise.all([
    supabase
      .from("expenses")
      .select("trip_id, category, amount_cents, is_settlement")
      .in("trip_id", tripIds)
      .returns<ExpenseRow[]>(),
    supabase
      .from("trip_budget_items")
      .select("trip_id, category, amount_cents")
      .in("trip_id", tripIds)
      .returns<ItemRow[]>(),
  ])

  const expByTrip = new Map<string, ExpenseSpend[]>()
  for (const r of expRows ?? []) {
    const arr = expByTrip.get(r.trip_id) ?? []
    arr.push({
      category: r.category,
      amountCents: r.amount_cents,
      isSettlement: r.is_settlement,
    })
    expByTrip.set(r.trip_id, arr)
  }

  const itemsByTrip = new Map<string, PlannedSpend[]>()
  for (const r of itemRows ?? []) {
    const arr = itemsByTrip.get(r.trip_id) ?? []
    arr.push({ category: r.category, amountCents: r.amount_cents })
    itemsByTrip.set(r.trip_id, arr)
  }

  const catOrder = [...EXPENSE_CATEGORIES]
  return dated.map((t) => ({
    tripId: t.id,
    tripName: t.name,
    startDate: t.startDate as string,
    dayCount: dayCountInclusive(t.startDate as string, t.endDate as string),
    rollup: perCategoryRollup(
      expByTrip.get(t.id) ?? [],
      itemsByTrip.get(t.id) ?? [],
      catOrder,
    ),
  }))
}

/**
 * Both /profile budget lenses from a single fetch: the cross-trip category
 * history and the per-trip summaries (trips with real spend only).
 */
export async function getProfileBudgetData(
  trips: TripListItem[],
): Promise<{ history: CategoryHistory[]; summaries: TripBudgetSummary[] }> {
  const rollups = await getTripRollups(trips)
  const catOrder = [...EXPENSE_CATEGORIES]
  return {
    history: buildBudgetHistory(rollups, catOrder),
    summaries: rollups
      .map(buildTripBudgetSummary)
      .filter((s) => s.totalActualCents > 0),
  }
}
```

- [ ] **Step 2: Create the Trip budget section component**

Create `src/app/profile/trip-budget.tsx` (static; no `"use client"`):

```tsx
import type { TripBudgetSummary } from "@/lib/trips/budget-history-types"

function euro(cents: number): string {
  return (cents / 100).toFixed(0)
}

function variance(actualCents: number, plannedCents: number) {
  const v = actualCents - plannedCents
  const over = v > 0
  const label =
    v === 0 ? "on plan" : over ? `+€${euro(v)} over` : `€${euro(-v)} under`
  return { over, label }
}

export function TripBudget({ summary }: { summary: TripBudgetSummary }) {
  const total = variance(summary.totalActualCents, summary.totalPlannedCents)
  return (
    <div>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Trip budget
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        {summary.categories.map((c) => {
          const v = variance(c.actualCents, c.plannedCents)
          return (
            <div
              key={c.category}
              className="flex items-baseline justify-between gap-2 font-mono text-[11px]"
            >
              <span className="text-foreground">{c.category}</span>
              <span className="flex items-baseline gap-2">
                <span className="text-muted-foreground">
                  spent €{euro(c.actualCents)} / €{euro(c.plannedCents)}
                </span>
                <span className={v.over ? "text-clay" : "text-muted-foreground"}>
                  {v.label}
                </span>
              </span>
            </div>
          )
        })}
        <div className="flex items-baseline justify-between gap-2 border-t border-rule pt-1.5 font-mono text-[11px]">
          <span className="text-foreground">Total</span>
          <span className="flex items-baseline gap-2">
            <span className="text-muted-foreground">
              spent €{euro(summary.totalActualCents)} / €
              {euro(summary.totalPlannedCents)}
            </span>
            <span className={total.over ? "text-clay" : "text-muted-foreground"}>
              {total.label}
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Page imports**

In `src/app/profile/page.tsx`, change the Slice-2 import line
`import { getBudgetHistory } from "@/lib/trips/budget-history-queries"`
to:

```tsx
import { getProfileBudgetData } from "@/lib/trips/budget-history-queries"
```

and add below the `import { BudgetHistory } from "./budget-history"` line:

```tsx
import { TripBudget } from "./trip-budget"
```

- [ ] **Step 4: Page fetch + union rows**

In `src/app/profile/page.tsx`, replace:

```tsx
  const budgetHistory = await getBudgetHistory(startedTrips)
```

with:

```tsx
  const { history: budgetHistory, summaries: budgetSummaries } =
    await getProfileBudgetData(startedTrips)
  const tasteByTrip = new Map(tripBlocks.map((tb) => [tb.trip.id, tb.blocks]))
  const budgetByTrip = new Map(budgetSummaries.map((s) => [s.tripId, s]))
  const byTripRows = startedTrips
    .filter((t) => tasteByTrip.has(t.id) || budgetByTrip.has(t.id))
    .map((t) => ({
      trip: t,
      blocks: tasteByTrip.get(t.id) ?? [],
      budget: budgetByTrip.get(t.id) ?? null,
    }))
```

- [ ] **Step 5: Page render restructure**

In `src/app/profile/page.tsx`, replace the whole "By trip" block:

```tsx
          {tripBlocks.length > 0 ? (
            <div className="mt-10 border-t border-border pt-8">
              <p className="text-sm text-muted-foreground">
                By trip (what each trip taught us)
              </p>
              <div className="mt-4 flex flex-col gap-8">
                {tripBlocks.map(({ trip, blocks }) => (
                  <div key={trip.id}>
                    <h3 className="font-serif text-lg tracking-tight">
                      {trip.name}
                    </h3>
                    {blocks.map((b) => (
                      <div key={b.category}>
                        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          {CATEGORY_LABEL[b.category]}
                        </p>
                        <LearnedSummary
                          category={b.category}
                          summaryMd={b.summaryMd}
                          ratingCount={b.signalCount}
                          countAtGeneration={b.countAtGeneration}
                          aiOn={aiOn}
                          tripId={trip.id}
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
```

with:

```tsx
          {byTripRows.length > 0 ? (
            <div className="mt-10 border-t border-border pt-8">
              <p className="text-sm text-muted-foreground">By trip</p>
              <div className="mt-4 flex flex-col gap-8">
                {byTripRows.map(({ trip, blocks, budget }) => (
                  <div key={trip.id}>
                    <h3 className="font-serif text-lg tracking-tight">
                      {trip.name}
                    </h3>
                    {blocks.map((b) => (
                      <div key={b.category}>
                        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          {CATEGORY_LABEL[b.category]}
                        </p>
                        <LearnedSummary
                          category={b.category}
                          summaryMd={b.summaryMd}
                          ratingCount={b.signalCount}
                          countAtGeneration={b.countAtGeneration}
                          aiOn={aiOn}
                          tripId={trip.id}
                        />
                      </div>
                    ))}
                    {budget ? <TripBudget summary={budget} /> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
```

(`tripBlocks` stays — it now feeds `tasteByTrip`. `budgetHistory` still feeds the bottom `<BudgetHistory />`.)

- [ ] **Step 6: Lint**

Run: `pnpm lint`
Expected: clean (no unused imports; `getBudgetHistory` no longer referenced, `getProfileBudgetData`/`TripBudget`/`budgetSummaries`/`byTripRows` all used).

- [ ] **Step 7: Build**

Run: `pnpm build`
Expected: compiles with no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/trips/budget-history-queries.ts src/app/profile/trip-budget.tsx src/app/profile/page.tsx
git commit -m "feat(budget): per-trip budget summary on /profile By-trip (slice 2.5)"
```

- [ ] **Step 9: In-app verification (logged-in session)**

On `/profile` with 2+ started trips carrying real expenses:
1. Under a trip's heading in the "By trip" zone, the taste sections (if any) appear, then a separate "Trip budget" header with per-category `spent / planned` + variance and a Total line.
2. A trip with real spend but no taste data appears with only its heading + Trip budget.
3. A trip with taste but no spend appears with only taste (no Trip budget).
4. Category lines sum to the Total; over-plan lines are clay.
5. The bottom "Budget history" zone is unchanged.

---

## Self-Review

**Spec coverage:**
- Layout A, separate "Trip budget" header per trip -> Task 2 Steps 2, 5. ✅
- Trip visibility = union (taste OR real spend), `startedTrips` order -> Task 2 Step 4. ✅
- Trip budget only when real spend -> `getProfileBudgetData` filters `totalActualCents > 0`; `byTripRows` includes taste-only trips too, and `budget` is null for them. ✅
- Content: per-category spent/planned + variance + Total, no €/day -> `TripBudget` (Task 2 Step 2). ✅
- Single budget fetch feeding both lenses -> `getTripRollups` + `getProfileBudgetData` (Task 2 Step 1). ✅
- Bottom Budget history untouched -> `<BudgetHistory categories={budgetHistory} />` unchanged. ✅
- Deterministic, no AI/migration -> nothing added. ✅

**Placeholder scan:** none.

**Type consistency:** `buildTripBudgetSummary(TripRollupInput): TripBudgetSummary` defined in Task 1, consumed in Task 2 query. `TripBudgetSummary` fields (`tripId, tripName, categories, totalPlannedCents, totalActualCents`) used by `TripBudget`. `getProfileBudgetData` returns `{ history, summaries }`, destructured in the page. `tripBlocks` element shape `{ trip, blocks }` unchanged; `tasteByTrip` keyed by `tb.trip.id`. `startedTrips` are `TripListItem` (`id`, `name`). `CATEGORY_LABEL`, `LearnedSummary`, `aiOn` all already in scope in the page.
