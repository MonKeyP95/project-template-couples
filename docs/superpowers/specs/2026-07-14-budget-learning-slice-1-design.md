# Budget learning — Slice 1: per-category plan-vs-actual (the numeric spine)

**Date:** 2026-07-14
**Status:** design, ready to plan
**Part of:** the budget-learning arc (Slice 1 of 3). Slice 2 = cross-trip budget history; Slice 3 = budget suggestion harness (AI). This spec covers **Slice 1 only**.

## Why

The taste-learning layer (`event_ratings` -> `couple_summaries`/`trip_summaries` -> `summarizeTaste`) grows a *qualitative* profile: "we like surfing." The budget layer is its opposite: **the numbers are the artifact, not a narrative.** Per category, per trip: *planned 400 / spent 520 in Lanzarote.* That row is precise, it is the real record, and it is what a couple looks at to draw their own conclusions. A prose blurb ("you tend to overspend a bit on food") would throw away exactly the detail that makes it useful.

So this arc is **not** "a budget version of `couple_summaries`." It is: a precise numeric ledger-rollup that is trackable, plus (later) a suggestion harness that reads it. AI never rewrites the numbers; it only reasons about them (Slice 3).

The durable per-`(trip, category)` unit is `{planned, actual, destination, dates}`. **Variance** ("did we stick to plan") and **cost-by-place** ("what does surfing cost us") are two lenses on that one row.

## Slice 1 goal

The Budget tab already shows plan-vs-actual **only at the trip total** (`SpentFigure`: `€520 / €800` + a bar). Break that down **per category**, as a **read-first** drill-down hanging off the total, with three levels:

- **Level 0** — trip total (`SpentFigure`, unchanged).
- **Level 1** — expand -> one row per category: **spent vs planned** (`Food €140 / €200`) + variance.
- **Level 2** — expand a category -> the actual **line-item expenses** in that category.

This is the per-trip "budget summary" you can look at live or after the trip. It needs **zero new storage** — expenses and budget items are already category-tagged; per-category planned-vs-actual is a pure computed rollup off data we already have.

## What already exists (and the reuse decision)

Per-category spent-vs-planned is *already computed and displayed* inside the "Planned budget" section: `PlannedBudget.spentForScope` (in `budget-tab.tsx`) builds `{category: cents}` of actual spend, and `BudgetScopeEditor` renders a `spent €140 / €200` line per category group. But it is shaped for a different job:

1. It is an **editor** (inputs, "to pay" pills, save) — a *planning* surface, not a read-first summary.
2. It groups **location-first, then category** — "Food across the whole trip" is never one number.
3. There is no drill from a category to its **actual expenses** (that is the separate flat `Ledger` at the tab bottom).

So the read-first, category-first lens does not exist, even though its ingredients do. `BudgetByLocation` also computes its own spend-per-location. That is **three** inline recomputations of "spend grouped by X."

**The professional build is A-with-extraction**, not "add a third inline recompute" and not "overload the 445-line editor with a read mode":

- The real duplication is the **computation**, not the UI. Extract it once.
- "Edit the plan" and "read the record" are genuinely different responsibilities. Separate thin views over one shared model is correct separation of concerns, not parallel systems. The reuse principle is satisfied at the data layer, where it counts.
- The shared rollup is the load-bearing piece for Slices 2-3 (cross-trip aggregation and the AI harness both read it). Extracting it now is not gold-plating; it is the spine of the whole arc.

Net effect of Slice 1: we **add** the read lens **and** leave the codebase with fewer independent spend-computations than it has today.

## Design

### 1. The shared rollup (data layer — the load-bearing piece)

New pure, client-safe module `src/lib/trips/budget-rollup-types.ts` (no React, no `next/headers`; unit-testable; follows the `*-types.ts` client-import rule):

```ts
export interface CategoryRollup {
  category: string
  plannedCents: number   // sum of budget items in this category
  actualCents: number    // sum of non-settlement expenses in this category
}

/**
 * Per-category planned vs actual for one trip. Categories are the union of
 * those appearing in planned items or actual expenses, ordered by `catOrder`
 * (the trip's category list) with any extras appended. Settlements excluded.
 */
export function perCategoryRollup(
  expenses: Expense[],
  budgetItems: BudgetItem[],
  catOrder: string[],   // e.g. categories.map(c => c.name)
): CategoryRollup[]
```

Rules (mirroring the existing scope editor's `present`/`groupCats` logic, so behavior is consistent):
- `plannedCents` = sum of `budgetItems.amountCents` grouped by `category`.
- `actualCents` = sum of `expenses.amountCents` where `!isSettlement`, grouped by `category`.
- Category set = union of both key sets; ordered by `catOrder`, unknown categories appended in first-seen order.
- Amounts always in cents; formatting is the caller's job.

This is the single source of truth. It does **not** read location — Slice 1 is category-first across the whole trip. (Location grouping stays the editor's concern.)

### 2. Refactor existing inline computations to consume it

Reduce net duplication as part of the same slice:
- `PlannedBudget.spentForScope` and `BudgetByLocation` keep their **location** grouping (out of scope to change), but their per-category *summation* should reuse the shared helper where it cleanly fits. If a location-scoped view cannot use the trip-wide helper without contortion, leave it and note it — do **not** force a bad abstraction. The mandatory extraction is the new trip-wide rollup; refactoring the location views is opportunistic, not required.

(Keep this honest: the goal is one canonical *trip-wide* per-category rollup. The location-scoped math is a different shape and may legitimately stay separate.)

### 3. The read lens (UI)

New client component `src/app/trips/[slug]/budget-by-category.tsx` (`BudgetByCategory`):
- Reads `perCategoryRollup(expenses, budgetItems, catOrder)`.
- **Level 1:** one row per category — `Food` · `spent €140 / €200` · a thin `Bar` · variance. Variance shown as `+€X over` / `€Y under` (clay when over, moss/muted when under), computed `actualCents - plannedCents`. A category with planned-but-no-spend or spend-but-no-plan still shows (one side `€0`).
- **Level 2:** expanding a category row reveals that category's **actual expenses**, reusing the existing `LedgerRow` filtered to `e.category === cat && !e.isSettlement`. No new row UI.
- Collapsed by default; state is local (`useState`), one category open at a time is fine but not required.

**Placement:** it becomes the expand-target under `SpentFigure` in the first Budget-tab card. The current flat `Ledger label="Expenses"` in that card (`defaultExpanded={false}`) is **subsumed** by this tree — every expense is still reachable, now grouped by category with its plan context — so that flat per-card ledger is removed to avoid redundancy. The comprehensive bottom `Ledger` (expenses + moves + settlements + savings, full chronological record) stays untouched.

### 4. Two modes (planning vs on the road)

- **Planning:** planned amounts exist, actuals are near-zero -> the lens reads as "here is the plan, per category," with `spent €0` lines. Useful but quiet.
- **On the road / post-trip:** actuals accrue -> variance becomes the signal. This is the durable record Slices 2-3 read.

No mode toggle; it is the same component, and the numbers simply fill in as the trip runs. Nothing hides by mode.

## Data / migration

**None.** No new table, column, migration, or dependency. Pure computation over `expenses` + `trip_budget_items`, both already loaded into `BudgetTab`.

## Non-goals (explicitly deferred)

- **Cross-trip aggregation** and the durable snapshot / survives-trip-deletion question -> **Slice 2**.
- **Any AI** — no summaries, no suggestions, no `summarizeBudget`-style seam -> **Slice 3** (buffer advice, slack detection, cost-by-place flags).
- **Editing** from this lens — it is read-only; the plan is still edited in the Planned-budget scope editor.
- **Reshaping `BudgetScopeEditor` or `BudgetByLocation`** into this view (rejected: overloads a dense editor; the shared rollup is the right reuse point).
- **Consolidating the three visual breakdowns** — a later UX call, made cheap by the shared rollup.

## Testing / verification

- Unit-test `perCategoryRollup` as a pure function: union of categories, settlement exclusion, ordering by `catOrder` with extras appended, planned-only and spent-only categories, empty inputs. (There is no test runner yet; if one is not introduced, verify by a throwaway node/tsx exercise of the pure function, then in-app.)
- `pnpm lint` + `pnpm build` clean.
- In-app (logged-in): on a trip with mixed planned + logged expenses, expand the total -> per-category rows show correct `spent / planned` + variance; expand a category -> exactly that category's expenses; totals reconcile with the trip-total bar.

## Risks

- **Category-name coupling:** the rollup keys on the free-text `category` string (as the whole app already does). A renamed category could split a row; acceptable and consistent with current behavior.
- **Visual coherence:** a third spend breakdown in the tab. Watched, not solved here (see non-goals).
