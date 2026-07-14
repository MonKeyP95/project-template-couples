# Budget learning — Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic cross-trip "Budget history" zone to `/profile`: per category, each trip's spend-per-day, spent/planned, and variance, aggregated across the workspace's started trips.

**Architecture:** Reuse Slice 1's `perCategoryRollup` per trip (widened to accept minimal row shapes), fold the results into a category-first history via a new pure `buildBudgetHistory`, assemble it in one server query over batched reads, and render it as a collapsible client zone on `/profile`. No migration, no AI (Decision A: live aggregation).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4. pnpm.

## Global Constraints

- No new dependency, table, column, or migration (Decision A). Pure computation over already-stored `expenses` + `trip_budget_items`, two batched reads.
- No AI in this slice (that is Slice 3).
- Deterministic only; numbers are the artifact — no narrative.
- Amounts are integer cents; format only at render (`(cents / 100).toFixed(0)` for whole-euro).
- Dates displayed `en-GB`; the history line label is `Mon YYYY` (month + year, no day).
- No emojis in code. Sparse comments; comment only non-obvious WHY.
- Client components import types/pure helpers from `*-types.ts`, never from `*-queries.ts` (`budget-history-queries.ts` is server-only and must never be imported by a client component).
- Settlements (`is_settlement === true`) never count as actual spend.
- Inclusion: a trip appears in a category only if its actual spend there is > 0; planning-only/dream trips are excluded; empty categories hidden.
- Spec: `docs/superpowers/specs/2026-07-14-budget-learning-slice-2-design.md`.

---

### Task 1: Pure layer — widen the rollup + the history builder

**Files:**
- Modify: `src/lib/trips/budget-rollup-types.ts` (widen `perCategoryRollup` param types; backward-compatible)
- Create: `src/lib/trips/budget-history-types.ts`
- Verify (throwaway, deleted before commit): `history-check.mts` at repo root

**Interfaces:**
- Consumes: `CategoryRollup` from `@/lib/trips/budget-rollup-types`.
- Produces:
  - `ExpenseSpend { category: string; amountCents: number; isSettlement: boolean }`, `PlannedSpend { category: string; amountCents: number }` (new, in `budget-rollup-types.ts`); `perCategoryRollup(expenses: ExpenseSpend[], budgetItems: PlannedSpend[], catOrder: string[])`.
  - `TripCategorySpend`, `CategoryHistory`, `TripRollupInput`, `dayCountInclusive(startDate, endDate): number`, `buildBudgetHistory(trips: TripRollupInput[], catOrder: string[]): CategoryHistory[]` (new, in `budget-history-types.ts`).

- [ ] **Step 1: Widen `perCategoryRollup`'s param types (backward-compatible)**

Replace the whole contents of `src/lib/trips/budget-rollup-types.ts` with (body logic unchanged; only the two `import type` lines drop and the params become structural minimums that full `Expense`/`BudgetItem` still satisfy):

```ts
export interface CategoryRollup {
  category: string
  /** Sum of budget items in this category. */
  plannedCents: number
  /** Sum of non-settlement expenses in this category. */
  actualCents: number
}

/** Minimal expense shape the rollup reads; full `Expense` is assignable. */
export interface ExpenseSpend {
  category: string
  amountCents: number
  isSettlement: boolean
}

/** Minimal budget-item shape the rollup reads; full `BudgetItem` is assignable. */
export interface PlannedSpend {
  category: string
  amountCents: number
}

/**
 * Per-category planned vs actual for one trip. The category set is the union
 * of those appearing in planned items or actual expenses, ordered by
 * `catOrder` (the trip's category list) with any extras appended in first-seen
 * order. Settlements are excluded from actual spend.
 */
export function perCategoryRollup(
  expenses: ExpenseSpend[],
  budgetItems: PlannedSpend[],
  catOrder: string[],
): CategoryRollup[] {
  const planned = new Map<string, number>()
  for (const it of budgetItems) {
    planned.set(it.category, (planned.get(it.category) ?? 0) + it.amountCents)
  }

  const actual = new Map<string, number>()
  for (const e of expenses) {
    if (e.isSettlement) continue
    actual.set(e.category, (actual.get(e.category) ?? 0) + e.amountCents)
  }

  const ordered: string[] = []
  for (const cat of catOrder) {
    if (planned.has(cat) || actual.has(cat)) ordered.push(cat)
  }
  for (const cat of [...planned.keys(), ...actual.keys()]) {
    if (!ordered.includes(cat)) ordered.push(cat)
  }

  return ordered.map((category) => ({
    category,
    plannedCents: planned.get(category) ?? 0,
    actualCents: actual.get(category) ?? 0,
  }))
}
```

- [ ] **Step 2: Write the failing verification script**

Create `history-check.mts` at the repo root:

```ts
import {
  dayCountInclusive,
  buildBudgetHistory,
} from "./src/lib/trips/budget-history-types"

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg)
    process.exit(1)
  }
}

assert(dayCountInclusive("2026-03-01", "2026-03-01") === 1, "same day")
assert(dayCountInclusive("2026-03-01", "2026-03-07") === 7, "7 days")
assert(dayCountInclusive("2026-03-07", "2026-03-01") === 1, "reversed clamps to 1")

const trips: any = [
  {
    tripId: "t1",
    tripName: "Lanzarote",
    startDate: "2026-03-01",
    dayCount: 7,
    rollup: [
      { category: "Food", plannedCents: 40000, actualCents: 52000 },
      { category: "Accommodation", plannedCents: 70000, actualCents: 0 },
    ],
  },
  {
    tripId: "t2",
    tripName: "Malaysia",
    startDate: "2026-01-01",
    dayCount: 20,
    rollup: [{ category: "Food", plannedCents: 0, actualCents: 30000 }],
  },
]

const hist = buildBudgetHistory(trips, ["Accommodation", "Food", "Transportation"])

// Accommodation had zero actual everywhere -> absent. Only Food survives.
assert(hist.length === 1 && hist[0].category === "Food", "only Food")
const food = hist[0]
assert(food.trips.map((t) => t.tripId).join(",") === "t1,t2", "date desc order")
assert(food.trips[0].perDayCents === Math.round(52000 / 7), "t1 perday")
assert(food.trips[1].perDayCents === 1500, "t2 perday")
assert(
  food.avgPerDayCents === Math.round((Math.round(52000 / 7) + 1500) / 2),
  "avg perday equal-weighted",
)
// Only t1 has planned>0: (52000-40000)/40000 = 0.3 -> 30
assert(food.avgVariancePct === 30, "variance 30")

const empty = buildBudgetHistory(
  [
    {
      tripId: "t3",
      tripName: "x",
      startDate: "2025-01-01",
      dayCount: 5,
      rollup: [{ category: "Food", plannedCents: 1000, actualCents: 0 }],
    },
  ] as any,
  [],
)
assert(empty.length === 0, "no real spend -> empty")

console.log("OK", JSON.stringify(hist))
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx --yes tsx history-check.mts`
Expected: FAIL — module `budget-history-types` not found (file does not exist yet).

- [ ] **Step 4: Create the history builder**

Create `src/lib/trips/budget-history-types.ts`:

```ts
import type { CategoryRollup } from "@/lib/trips/budget-rollup-types"

export interface TripCategorySpend {
  tripId: string
  tripName: string
  /** yyyy-mm-dd, for the label and date-desc sort. */
  startDate: string
  dayCount: number
  plannedCents: number
  actualCents: number
  /** round(actualCents / dayCount). */
  perDayCents: number
}

export interface CategoryHistory {
  category: string
  /** Sorted startDate desc. */
  trips: TripCategorySpend[]
  /** Mean of perDayCents across trips (equal weight per trip). */
  avgPerDayCents: number
  /** Mean of (actual-planned)/planned*100 over trips with planned>0; null if none. */
  avgVariancePct: number | null
}

export interface TripRollupInput {
  tripId: string
  tripName: string
  startDate: string
  dayCount: number
  rollup: CategoryRollup[]
}

/** Inclusive day span between two yyyy-mm-dd dates; minimum 1. */
export function dayCountInclusive(startDate: string, endDate: string): number {
  const ms =
    Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)
  if (!Number.isFinite(ms)) return 1
  return Math.max(1, Math.round(ms / 86_400_000) + 1)
}

/**
 * Category-first cross-trip history. Each trip's rollup category with
 * actualCents > 0 becomes a TripCategorySpend under that category. Categories
 * ordered by `catOrder` with extras appended; trips within a category sorted
 * startDate desc. Categories with no real spend anywhere are absent.
 */
export function buildBudgetHistory(
  trips: TripRollupInput[],
  catOrder: string[],
): CategoryHistory[] {
  const byCat = new Map<string, TripCategorySpend[]>()
  for (const t of trips) {
    for (const r of t.rollup) {
      if (r.actualCents <= 0) continue
      const arr = byCat.get(r.category) ?? []
      arr.push({
        tripId: t.tripId,
        tripName: t.tripName,
        startDate: t.startDate,
        dayCount: t.dayCount,
        plannedCents: r.plannedCents,
        actualCents: r.actualCents,
        perDayCents: Math.round(r.actualCents / t.dayCount),
      })
      byCat.set(r.category, arr)
    }
  }

  const ordered: string[] = []
  for (const cat of catOrder) if (byCat.has(cat)) ordered.push(cat)
  for (const cat of byCat.keys()) if (!ordered.includes(cat)) ordered.push(cat)

  return ordered.map((category) => {
    const list = byCat.get(category)!
    list.sort((a, b) =>
      a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0,
    )
    const avgPerDayCents = Math.round(
      list.reduce((s, t) => s + t.perDayCents, 0) / list.length,
    )
    const planned = list.filter((t) => t.plannedCents > 0)
    const avgVariancePct =
      planned.length === 0
        ? null
        : Math.round(
            (planned.reduce(
              (s, t) => s + (t.actualCents - t.plannedCents) / t.plannedCents,
              0,
            ) /
              planned.length) *
              100,
          )
    return { category, trips: list, avgPerDayCents, avgVariancePct }
  })
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx --yes tsx history-check.mts`
Expected: prints `OK [...]` and exits 0.

- [ ] **Step 6: Lint, delete the throwaway, commit**

Run: `pnpm lint` (expected: clean).
Then: `rm history-check.mts`

```bash
git add src/lib/trips/budget-rollup-types.ts src/lib/trips/budget-history-types.ts
git commit -m "feat(budget): widen rollup + buildBudgetHistory (slice 2 pure layer)"
```

---

### Task 2: Server query + /profile "Budget history" zone

**Files:**
- Create: `src/lib/trips/budget-history-queries.ts`
- Create: `src/app/profile/budget-history.tsx`
- Modify: `src/app/profile/page.tsx` (import, fetch, render)

**Interfaces:**
- Consumes: `perCategoryRollup`, `ExpenseSpend`, `PlannedSpend` from `@/lib/trips/budget-rollup-types`; `buildBudgetHistory`, `dayCountInclusive`, `CategoryHistory`, `TripRollupInput` from `@/lib/trips/budget-history-types`; `EXPENSE_CATEGORIES` from `@/lib/trips/expense-types`; `TripListItem` from `@/lib/trips/list-queries`; `createClient` from `@/lib/supabase/server`.
- Produces: `getBudgetHistory(trips: TripListItem[]): Promise<CategoryHistory[]>`; `BudgetHistory({ categories }: { categories: CategoryHistory[] })`.

- [ ] **Step 1: Create the server query**

Create `src/lib/trips/budget-history-queries.ts`:

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
  dayCountInclusive,
  type CategoryHistory,
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
 * Cross-trip category history for the given trips (pass the started ones).
 * Live aggregation, no snapshot: reads current expenses + budget items and
 * folds each trip's Slice-1 rollup into a category-first history. RLS-scoped
 * by the caller's session.
 */
export async function getBudgetHistory(
  trips: TripListItem[],
): Promise<CategoryHistory[]> {
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
  const inputs: TripRollupInput[] = dated.map((t) => ({
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

  return buildBudgetHistory(inputs, catOrder)
}
```

- [ ] **Step 2: Create the client zone component**

Create `src/app/profile/budget-history.tsx`:

```tsx
"use client"

import * as React from "react"

import type { CategoryHistory } from "@/lib/trips/budget-history-types"

const MON_YEAR = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

function euro(cents: number): string {
  return (cents / 100).toFixed(0)
}

function monYear(startDate: string): string {
  return MON_YEAR.format(new Date(`${startDate}T00:00:00Z`))
}

function variancePhrase(pct: number | null): string {
  if (pct === null) return ""
  if (Math.abs(pct) <= 2) return "runs on plan"
  return pct > 0 ? `runs +${pct}% over plan` : `runs ${pct}% under plan`
}

export function BudgetHistory({
  categories,
}: {
  categories: CategoryHistory[]
}) {
  if (categories.length === 0) return null
  return (
    <div className="mt-10 border-t border-border pt-8">
      <p className="text-sm text-muted-foreground">
        Budget history (what our trips actually cost)
      </p>
      <div className="mt-4 flex flex-col gap-3">
        {categories.map((c) => (
          <CategoryRow key={c.category} category={c} />
        ))}
      </div>
    </div>
  )
}

function CategoryRow({ category }: { category: CategoryHistory }) {
  const [open, setOpen] = React.useState(false)
  const phrase = variancePhrase(category.avgVariancePct)
  return (
    <div className="border-t border-rule pt-3 first:border-t-0 first:pt-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-2 border-0 bg-transparent p-0 text-left"
      >
        <span className="font-serif text-[15px] italic text-foreground">
          {category.category}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          €{euro(category.avgPerDayCents)}/day avg
          {phrase ? ` · ${phrase}` : ""}
        </span>
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-2">
          {category.trips.map((t) => {
            const variance = t.actualCents - t.plannedCents
            const over = variance > 0
            return (
              <div key={t.tripId} className="flex flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] text-foreground">
                    {t.tripName}
                    <span className="text-muted-foreground">
                      {" "}
                      · {monYear(t.startDate)} · {t.dayCount} days
                    </span>
                  </span>
                  <span className="font-mono text-[12px] text-foreground">
                    €{euro(t.perDayCents)}/day
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
                  <span className="text-muted-foreground">
                    spent €{euro(t.actualCents)} / €{euro(t.plannedCents)}
                  </span>
                  <span className={over ? "text-clay" : "text-muted-foreground"}>
                    {variance === 0
                      ? "on plan"
                      : over
                        ? `+€${euro(variance)} over`
                        : `€${euro(-variance)} under`}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: Wire into the profile page — imports**

In `src/app/profile/page.tsx`, add below the existing `import { CategorySection } from "@/components/category-section"` line:

```tsx
import { getBudgetHistory } from "@/lib/trips/budget-history-queries"
import { BudgetHistory } from "./budget-history"
```

- [ ] **Step 4: Wire into the profile page — fetch**

In `src/app/profile/page.tsx`, immediately after the `tripBlocks` computation (the block ending with `).filter((tb) => tb.blocks.length > 0)`) and before `const foodKey = [`, insert:

```tsx
  const budgetHistory = await getBudgetHistory(startedTrips)
```

- [ ] **Step 5: Wire into the profile page — render**

In `src/app/profile/page.tsx`, the taste "By trip" block ends with `) : null}` followed by the `</div>` that closes the `max-w-sm` wrapper. Insert the zone between them. Find:

```tsx
          ) : null}
        </div>
      </main>
```

and replace with:

```tsx
          ) : null}

          <BudgetHistory categories={budgetHistory} />
        </div>
      </main>
```

- [ ] **Step 6: Lint**

Run: `pnpm lint`
Expected: clean (no unused imports; `BudgetHistory`, `getBudgetHistory`, `budgetHistory` all used).

- [ ] **Step 7: Build**

Run: `pnpm build`
Expected: compiles with no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/trips/budget-history-queries.ts src/app/profile/budget-history.tsx src/app/profile/page.tsx
git commit -m "feat(budget): cross-trip budget history on /profile (slice 2)"
```

- [ ] **Step 9: In-app verification (logged-in session)**

On a workspace with 2+ **started** trips that carry real logged expenses:
1. Open `/profile`. Below the taste "By trip" block, a "Budget history" zone appears.
2. Each category header shows `€X/day avg` and a variance phrase (or none when no trip in that category had a planned amount). Categories with no real spend anywhere are absent.
3. Expand a category: trips list date-desc, each with `Name · Mon YYYY · N days`, `€/day`, `spent €X / €Y`, and variance. A trip with no spend in that category is absent from it; a planning-only/dream trip appears nowhere.
4. Sanity: a category's `€/day avg` equals the rounded mean of its lines' `€/day`.

---

## Self-Review

**Spec coverage:**
- Decision A (live aggregation, no migration) -> Task 2 query reads live tables; no migration anywhere. ✅
- `/profile` home, category-first, collapsible -> Task 2 Steps 2, 5. ✅
- Per-day normalization + equal-weighted header avg -> `buildBudgetHistory` (Task 1). ✅
- Variance phrase (mean of per-trip %, ±2% band, omitted when no planned) -> `avgVariancePct` (Task 1) + `variancePhrase` (Task 2). ✅
- Inclusion rule (real spend only; empty categories/trips excluded) -> `buildBudgetHistory` skips `actualCents <= 0`; dreams have no spend. ✅
- Reuse Slice 1 via backward-compatible widening -> Task 1 Step 1 (full `Expense`/`BudgetItem` still assignable; `BudgetByCategory` untouched). ✅
- No AI / read-only / no editing -> nothing added. ✅

**Placeholder scan:** none — all code complete.

**Type consistency:** `perCategoryRollup(ExpenseSpend[], PlannedSpend[], string[])` used by the query with exactly those shapes. `CategoryHistory`/`TripCategorySpend` fields (`category, trips, avgPerDayCents, avgVariancePct`; `tripId, tripName, startDate, dayCount, plannedCents, actualCents, perDayCents`) match between builder (Task 1) and component (Task 2). `getBudgetHistory(TripListItem[])` — `TripListItem` has `id, name, startDate, endDate` (confirmed in `list-queries.ts`). `EXPENSE_CATEGORIES` is a readonly tuple; `[...EXPENSE_CATEGORIES]` yields `string[]`. `startedTrips` already exists in `page.tsx` (`[...buckets.now, ...buckets.past]`).
