# Budget learning — Slice 2: cross-trip budget history (on /profile)

**Date:** 2026-07-14
**Status:** design, ready to plan
**Part of:** the budget-learning arc (Slice 2 of 3). Slice 1 (per-category plan-vs-actual, the numeric spine) shipped 2026-07-14. Slice 3 = budget suggestion harness (AI). This spec covers **Slice 2 only**.

## Why

Slice 1 gave each trip a per-category planned-vs-actual record, live in its Budget tab. Slice 2 makes that history **legible across trips**: a couple-level retrospective on `/profile` that answers "what does Food actually cost us?" and "do we stick to our plan?" — the corpus a couple reads to draw their own conclusions, and (later) the numbers Slice 3's suggestion harness reasons about.

Still the numeric mirror of the taste layer: **numbers are the artifact, no AI, no narrative.** Deterministic aggregation only.

## Decisions locked in brainstorming

- **Durability = A (live aggregation, no new table).** Cross-trip history is computed on the fly by running Slice 1's `perCategoryRollup` per trip and rolling up across the workspace's trips. A trip's numbers are lost only if the trip is deleted — accepted; a durable snapshot table is a clean Slice-2.5 the day that loss is felt, not now.
- **Home = `/profile`**, a new "Budget history" zone beside the taste sections. The Budget *tab* stays the per-trip live record; `/profile` holds the cross-trip retrospective (taste and now budget).
- **Category-first layout.** Each category = a header stat over a list of its trips. Reads both lenses at once: cost-by-place down the list, variance across each line.
- **Normalize by day, not by trip.** A 1-week and a 5-week trip aren't comparable by total, so the comparable figure is **spend per day** (actual / trip length in days). The header "avg" is the average daily rate across the category's trips (each trip weighted equally).
- **Inclusion:** a trip appears in a category **only if it had real spend there** (`actualCents > 0`; settlements excluded). Planning-only / dream trips never appear. A category with no real spend across all trips is hidden. Each shown line still displays **plan vs spend**.

## Target shape

```
BUDGET HISTORY

Food             €68 / day avg · runs +12% over plan
  Lanzarote · Mar 2026 · 7 days     €74/day     spent €520 / €400   +€120 over
  Malaysia  · Jan 2026 · 21 days    €14/day     spent €300 / €350    €50 under
  Portugal  · Oct 2025 · 10 days    €41/day     spent €410 / €480    €70 under

Accommodation    €41 / day avg · runs on plan
  ...
```

- **Category header:** `€{avgPerDay}/day avg · {variance phrase}`. Variance phrase from the average variance %: `runs +N% over plan` / `runs N% under plan` / `runs on plan` (within ±2%), omitted when no trip in the category had a planned amount.
- **Per-trip line:** `{tripName} · {Mon YYYY} · {N} days` · `€{perDay}/day` · `spent €{actual} / €{planned}` · variance (`+€X over` / `€X under` / `on plan`). `Mon YYYY` via `en-GB` (`Mar 2026`).
- Categories collapsible (default collapsed, header stat visible); tap to reveal the trip lines. Mobile-first.

## Design

### 1. Pure layer — reuse Slice 1, add the history builder

New pure, client-safe module `src/lib/trips/budget-history-types.ts` (no React, no `next/headers`; unit-testable):

```ts
import type { CategoryRollup } from "@/lib/trips/budget-rollup-types"

export interface TripCategorySpend {
  tripId: string
  tripName: string
  startDate: string        // yyyy-mm-dd, for the label and date-desc sort
  dayCount: number
  plannedCents: number
  actualCents: number
  perDayCents: number      // round(actualCents / dayCount)
}

export interface CategoryHistory {
  category: string
  trips: TripCategorySpend[]        // sorted startDate desc
  avgPerDayCents: number            // mean of perDayCents across trips (equal weight)
  avgVariancePct: number | null     // mean of (actual-planned)/planned*100 over trips with planned>0; null if none
}

export interface TripRollupInput {
  tripId: string
  tripName: string
  startDate: string
  dayCount: number
  rollup: CategoryRollup[]          // this trip's Slice-1 rollup
}

/** Inclusive day span; min 1. Both args are yyyy-mm-dd. */
export function dayCountInclusive(startDate: string, endDate: string): number

/**
 * Category-first cross-trip history. For each trip, each rollup category with
 * actualCents > 0 becomes a TripCategorySpend under that category. Categories
 * ordered by `catOrder` with extras appended; within a category, trips sorted
 * startDate desc. Categories with no real spend anywhere are absent.
 */
export function buildBudgetHistory(
  trips: TripRollupInput[],
  catOrder: string[],
): CategoryHistory[]
```

`perCategoryRollup` (Slice 1) is reused unchanged to produce each trip's `rollup`. **One small, backward-compatible widening** of its signature so the history query can feed it minimal DB rows without casts: change its parameter types from `Expense[]` / `BudgetItem[]` to the structural minimums it already reads —

```ts
// in budget-rollup-types.ts
export interface ExpenseSpend { category: string; amountCents: number; isSettlement: boolean }
export interface PlannedSpend { category: string; amountCents: number }
export function perCategoryRollup(
  expenses: ExpenseSpend[],
  budgetItems: PlannedSpend[],
  catOrder: string[],
): CategoryRollup[]
```

Full `Expense[]` / `BudgetItem[]` remain assignable to these, so Slice 1's caller (`BudgetByCategory`) is untouched. This is the honest reuse point — it lets Slice 2 (and 3) call the one rollup without fabricating full objects.

### 2. Server query — assemble the history

New server-only `src/lib/trips/budget-history-queries.ts`:

```ts
export async function getBudgetHistory(
  trips: TripListItem[],   // pass the page's started trips (now + past)
): Promise<CategoryHistory[]>
```

- Keep only trips with both `startDate` and `endDate` (started trips always have them).
- `tripIds = trips.map(t => t.id)`; return `[]` if empty.
- Two batched reads (mirroring `listTripsForWorkspace`'s `.in(...)` pattern), RLS-scoped by the caller's session:
  - `expenses`: `select("trip_id, category, amount_cents, is_settlement").in("trip_id", tripIds)`
  - `trip_budget_items`: `select("trip_id, category, amount_cents").in("trip_id", tripIds)`
- Group rows by `trip_id` into `ExpenseSpend[]` / `PlannedSpend[]`.
- Per trip: `rollup = perCategoryRollup(exp, items, [...EXPENSE_CATEGORIES])`; `dayCount = dayCountInclusive(startDate, endDate)`; build `TripRollupInput`.
- `return buildBudgetHistory(inputs, [...EXPENSE_CATEGORIES])`.

Reuses `EXPENSE_CATEGORIES` from `expense-types.ts` as the canonical category order; unknown categories append after.

### 3. UI — the /profile zone

New client component `src/app/profile/budget-history.tsx` (`BudgetHistory({ categories }: { categories: CategoryHistory[] })`):
- Renders nothing if `categories` is empty (caller also guards).
- Zone header `Budget history` (same `mt-10 border-t border-border pt-8` framing as the taste "By trip" block).
- Each category is a collapsible row (local `useState`, default collapsed): header shows `{category}` + `€{avgPerDay}/day avg · {variance phrase}`; expanding lists its `trips` (destination · `Mon YYYY` · `N days` · `€/day` · `spent/planned` · variance). Whole-euro formatting (`(cents/100).toFixed(0)`); variance tone clay when over, muted otherwise — consistent with Slice 1's `BudgetByCategory`.

Wire into `src/app/profile/page.tsx`: after the existing `startedTrips` computation, `const budgetHistory = await getBudgetHistory(startedTrips)`; render `<BudgetHistory categories={budgetHistory} />` in its own zone (guarded by `budgetHistory.length > 0`), placed after the taste "By trip" block.

## Two modes

Not mode-specific — it is a retrospective. On-the-road, the current trip contributes its partial actuals (it is a started trip with real spend); planning-only future trips are excluded by the real-spend rule. No branching.

## Data / migration

**None.** No table, column, migration, or dependency (per Decision A). Pure computation over `expenses` + `trip_budget_items`, two batched reads.

## Non-goals (deferred)

- **Durable snapshot / survives-trip-deletion** -> Slice 2.5 if ever needed (Decision A).
- **Any AI** — no suggestions, no summaries -> Slice 3 (buffer advice, slack detection, cheaper-than-usual flags reasoning over this history).
- **In-trip "vs your history" block** in the Budget tab -> that is actionable-in-context, i.e. Slice 3.
- **Currency normalization** — amounts are summed in their stored cents as the app already does (single-currency assumption unchanged from the rest of Budget).
- **Editing / drill to individual expenses** from the history — it is a read summary; the per-expense record lives in the trip's Budget tab (Slice 1).

## Testing / verification

- Unit-test the pure functions (throwaway tsx exercise, as in Slice 1; delete after):
  - `dayCountInclusive`: same-day = 1; Mar 1 -> Mar 7 = 7; reversed/degenerate clamps to 1.
  - `buildBudgetHistory`: category grouping across trips; `actualCents === 0` category-trip omitted; a trip with zero real spend contributes nothing; `perDayCents` = actual/dayCount; `avgPerDayCents` equal-weighted; `avgVariancePct` null when no planned, else mean over planned>0; date-desc trip order; category order by `catOrder` with extras appended.
- `pnpm lint` + `pnpm build` clean.
- In-app (logged-in): on a workspace with 2+ started trips carrying real expenses, `/profile` shows a "Budget history" zone; categories list their trips with correct per-day, spent/planned, and variance; a trip with no spend in a category is absent from it; planning-only trips absent entirely; category header avg/day and variance phrase match the lines.

## Risks

- **Category-name coupling** across trips: two trips must use the same category *name* to aggregate (the app's existing free-text category model). Consistent with current behavior; renamed categories split a row. Acceptable.
- **Missing trip dates:** a started trip always has both dates (`deriveState` requires them), so `dayCount` is always computable for included trips; trips without dates are dreams (no real spend, excluded).
