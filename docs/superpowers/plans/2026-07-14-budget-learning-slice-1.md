# Budget learning — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-first, per-category planned-vs-actual drill-down to the Budget tab, built on one shared pure rollup that later slices will reuse.

**Architecture:** Extract a single pure function `perCategoryRollup(expenses, budgetItems, catOrder)` (the source of truth for per-category planned vs actual) into a client-safe module, then render it as a new `BudgetByCategory` component hanging off the trip-total bar. Level 1 = category rows (spent/planned + variance); Level 2 = that category's expenses via the existing `LedgerRow`. No migration, no AI, no editing.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4. pnpm.

## Global Constraints

- No new dependency, table, column, or migration. Pure computation over already-loaded `expenses` + `trip_budget_items`.
- No AI in this slice (that is Slice 3).
- Read-only lens: it must not edit the plan. (`LedgerRow` reused at Level 2 keeps its own existing edit/delete affordances on individual expenses — that is fine and pre-existing; do not add plan-editing.)
- Amounts are integer cents everywhere; format only at render (`(cents / 100).toFixed(0)` for whole-euro summaries).
- No emojis in code. Sparse comments; comment only non-obvious WHY.
- Client components import types/pure helpers from `*-types.ts`, never from `*-queries.ts`.
- Settlements (`expense.isSettlement === true`) are never counted as actual spend.
- Spec: `docs/superpowers/specs/2026-07-14-budget-learning-slice-1-design.md`.

---

### Task 1: The shared rollup (pure data layer)

**Files:**
- Create: `src/lib/trips/budget-rollup-types.ts`
- Verify (throwaway, deleted before commit): `<scratchpad>/rollup-check.ts`

**Interfaces:**
- Consumes: `Expense` from `@/lib/trips/expense-types` (fields used: `category`, `amountCents`, `isSettlement`); `BudgetItem` from `@/lib/trips/budget-item-types` (fields used: `category`, `amountCents`). Both imported **type-only** so the module has no runtime dependency on `@/` resolution.
- Produces:
  - `interface CategoryRollup { category: string; plannedCents: number; actualCents: number }`
  - `function perCategoryRollup(expenses: Expense[], budgetItems: BudgetItem[], catOrder: string[]): CategoryRollup[]`

- [ ] **Step 1: Write the failing verification script**

Create `<scratchpad>/rollup-check.ts` (substitute the real scratchpad path). Uses `import type`-free runtime by importing only the function; casts fixtures to `any` to avoid needing the full types at runtime:

```ts
import { perCategoryRollup } from "../../src/lib/trips/budget-rollup-types"

const expenses: any = [
  { category: "Food", amountCents: 5000, isSettlement: false },
  { category: "Food", amountCents: 9000, isSettlement: false },
  { category: "Food", amountCents: 2000, isSettlement: true }, // settlement: excluded
  { category: "Taxis", amountCents: 3000, isSettlement: false }, // not in catOrder
]
const items: any = [
  { category: "Food", amountCents: 20000 },
  { category: "Accommodation", amountCents: 40000 }, // planned only, no spend
]
const catOrder = ["Accommodation", "Food", "Transportation"]

const out = perCategoryRollup(expenses, items, catOrder)

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg)
    process.exit(1)
  }
}

// Ordering: catOrder first (present ones), then extras first-seen -> Taxis last.
assert(
  JSON.stringify(out.map((r) => r.category)) ===
    JSON.stringify(["Accommodation", "Food", "Taxis"]),
  `order was ${out.map((r) => r.category).join(",")}`,
)
const food = out.find((r) => r.category === "Food")!
assert(food.plannedCents === 20000, `food planned ${food.plannedCents}`)
assert(food.actualCents === 14000, `food actual ${food.actualCents}`) // settlement excluded
const accom = out.find((r) => r.category === "Accommodation")!
assert(accom.plannedCents === 40000 && accom.actualCents === 0, "accom planned-only")
const taxis = out.find((r) => r.category === "Taxis")!
assert(taxis.plannedCents === 0 && taxis.actualCents === 3000, "taxis spend-only")
assert(perCategoryRollup([] as any, [] as any, []).length === 0, "empty inputs")

console.log("OK", JSON.stringify(out))
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx "<scratchpad>/rollup-check.ts"`
Expected: FAIL — module `budget-rollup-types` not found (file does not exist yet).
(If `npx tsx` cannot be fetched offline, skip to Step 4's `pnpm build` as the type gate and rely on the in-app check in Task 2; note it in the commit.)

- [ ] **Step 3: Write the implementation**

Create `src/lib/trips/budget-rollup-types.ts`:

```ts
import type { Expense } from "@/lib/trips/expense-types"
import type { BudgetItem } from "@/lib/trips/budget-item-types"

export interface CategoryRollup {
  category: string
  /** Sum of budget items in this category. */
  plannedCents: number
  /** Sum of non-settlement expenses in this category. */
  actualCents: number
}

/**
 * Per-category planned vs actual for one trip. The category set is the union
 * of those appearing in planned items or actual expenses, ordered by
 * `catOrder` (the trip's category list) with any extras appended in first-seen
 * order. Settlements are excluded from actual spend.
 */
export function perCategoryRollup(
  expenses: Expense[],
  budgetItems: BudgetItem[],
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

- [ ] **Step 4: Run it to verify it passes**

Run: `npx tsx "<scratchpad>/rollup-check.ts"`
Expected: prints `OK [...]` and exits 0.

- [ ] **Step 5: Lint and delete the throwaway script**

Run: `pnpm lint`
Expected: no errors for `src/lib/trips/budget-rollup-types.ts`.
Then delete `<scratchpad>/rollup-check.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/trips/budget-rollup-types.ts
git commit -m "feat(budget): perCategoryRollup pure rollup (slice 1 spine)"
```

---

### Task 2: The read lens (BudgetByCategory) + wire into the Budget tab

**Files:**
- Create: `src/app/trips/[slug]/budget-by-category.tsx`
- Modify: `src/app/trips/[slug]/budget-tab.tsx` (first budget card: replace the flat `Ledger label="Expenses"` with `BudgetByCategory`)

**Interfaces:**
- Consumes: `perCategoryRollup`, `CategoryRollup` from Task 1; `LedgerRow` from `./ledger-row` (props: `expense, members, tripSlug, locations, categories, locationChip?`); `Bar` and `Label` from `@/components/together`; `dayLocationMap`, `effectiveLocation`, `DayLocation` from `@/lib/trips/location-budget-types`; `MemberToneEntry` from `./packing-tab`; `ItineraryLocation` from `@/lib/trips/location-types`; `Expense`, `ExpenseCategoryRow` from `@/lib/trips/expense-types`; `BudgetItem` from `@/lib/trips/budget-item-types`.
- Produces: `BudgetByCategory` component (props below). No new server code.

- [ ] **Step 1: Create the component**

Create `src/app/trips/[slug]/budget-by-category.tsx`:

```tsx
"use client"

import * as React from "react"

import { Bar, Label } from "@/components/together"
import { perCategoryRollup } from "@/lib/trips/budget-rollup-types"
import type { Expense, ExpenseCategoryRow } from "@/lib/trips/expense-types"
import type { BudgetItem } from "@/lib/trips/budget-item-types"
import {
  dayLocationMap,
  effectiveLocation,
  type DayLocation,
} from "@/lib/trips/location-budget-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

import { LedgerRow } from "./ledger-row"
import type { MemberToneEntry } from "./packing-tab"

function fmt(cents: number): string {
  return (cents / 100).toFixed(0)
}

/** Read-first per-category planned-vs-actual, collapsible off the total bar.
 * Level 1 = category rows (spent/planned + variance); Level 2 = that
 * category's expenses via the shared LedgerRow. Read-only summary of data
 * already on the page — no server calls of its own. */
export function BudgetByCategory({
  expenses,
  budgetItems,
  categories,
  members,
  tripSlug,
  locations,
  itineraryDays,
}: {
  expenses: Expense[]
  budgetItems: BudgetItem[]
  categories: ExpenseCategoryRow[]
  members: Record<string, MemberToneEntry>
  tripSlug: string
  locations: ItineraryLocation[]
  itineraryDays: DayLocation[]
}) {
  const [open, setOpen] = React.useState(false)
  const [openCat, setOpenCat] = React.useState<string | null>(null)

  const catOrder = categories.map((c) => c.name)
  const rollup = perCategoryRollup(expenses, budgetItems, catOrder)

  const dayMap = dayLocationMap(itineraryDays)
  const locationsById = Object.fromEntries(locations.map((l) => [l.id, l.name]))
  const hasLocations = locations.length > 0

  return (
    <div className="border-t border-rule">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between border-0 bg-transparent px-5 pt-4 pb-1.5 text-left"
      >
        <Label>By category · {rollup.length}</Label>
        <span className="font-mono text-[10px] text-muted-foreground">
          {open ? "hide" : "show"}
        </span>
      </button>
      {open ? (
        <div className="pb-2">
          {rollup.map((r) => {
            const variance = r.actualCents - r.plannedCents
            const over = variance > 0
            const pct =
              r.plannedCents > 0
                ? Math.min(100, Math.round((r.actualCents / r.plannedCents) * 100))
                : 0
            const catExpenses = expenses.filter(
              (e) => !e.isSettlement && e.category === r.category,
            )
            const isOpen = openCat === r.category
            return (
              <div key={r.category} className="border-t border-rule">
                <button
                  type="button"
                  onClick={() =>
                    setOpenCat((c) => (c === r.category ? null : r.category))
                  }
                  aria-expanded={isOpen}
                  className="w-full border-0 bg-transparent px-5 py-2.5 text-left"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-serif text-[14px] italic text-foreground">
                      {r.category}
                    </span>
                    <span className="font-mono text-[11px]">
                      <span className="text-muted-foreground">
                        spent €{fmt(r.actualCents)} /{" "}
                      </span>
                      <span className="text-foreground">€{fmt(r.plannedCents)}</span>
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <Bar pct={pct} tone={over ? "clay" : "sea"} />
                  </div>
                  <div className="mt-1 flex justify-between font-mono text-[10px] tracking-[0.06em]">
                    <span className="text-muted-foreground">
                      {r.plannedCents > 0 ? `${pct}% of planned` : "no plan"}
                    </span>
                    <span className={over ? "text-clay" : "text-muted-foreground"}>
                      {variance === 0
                        ? "on plan"
                        : over
                          ? `+€${fmt(variance)} over`
                          : `€${fmt(-variance)} under`}
                    </span>
                  </div>
                </button>
                {isOpen ? (
                  catExpenses.length > 0 ? (
                    <div>
                      {catExpenses.map((e) => (
                        <LedgerRow
                          key={e.id}
                          expense={e}
                          members={members}
                          tripSlug={tripSlug}
                          locations={locations}
                          categories={categories}
                          locationChip={
                            hasLocations
                              ? effectiveLocation(e, dayMap, locationsById)
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="px-5 pb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      No expenses yet
                    </div>
                  )
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the Budget tab, removing the redundant flat ledger**

In `src/app/trips/[slug]/budget-tab.tsx`:

Add the import near the other local imports (e.g. below the `Ledger` import):

```tsx
import { BudgetByCategory } from "./budget-by-category"
```

Then, in the first budget card, replace the flat expenses `Ledger` block:

```tsx
        <Ledger
          expenses={expenses}
          moves={[]}
          members={members}
          tripSlug={tripSlug}
          locations={locations}
          itineraryDays={itineraryDays}
          categories={expenseCategories}
          label="Expenses"
          defaultExpanded={false}
          bare
        />
```

with:

```tsx
        <BudgetByCategory
          expenses={expenses}
          budgetItems={budgetItems}
          categories={expenseCategories}
          members={members}
          tripSlug={tripSlug}
          locations={locations}
          itineraryDays={itineraryDays}
        />
```

Leave the comprehensive bottom `Ledger` (the one that also takes `moves` and `contributions`) untouched. If `Ledger` is now imported but only used once (the bottom instance still uses it), keep the import — do not remove it.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean (no unused-import warnings; `budgetItems` was already a prop of `BudgetTab`, now consumed).

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: compiles with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/[slug]/budget-by-category.tsx src/app/trips/[slug]/budget-tab.tsx
git commit -m "feat(budget): per-category plan-vs-actual read lens (slice 1)"
```

- [ ] **Step 6: In-app verification (logged-in session)**

On a trip with both planned budget items and logged expenses:
1. Open the Budget tab. Under the total `spent / planned` bar, the "By category · N" toggle appears where the flat "Expenses" list used to be.
2. Expand it: one row per category with `spent €X / €Y`, a bar, and `+€ over` / `€ under` / `on plan`. A category planned-but-unspent shows `spent €0`; a category spent-but-unplanned shows `no plan` and `€X over`.
3. Expand a category: exactly that category's non-settlement expenses render (via `LedgerRow`), and a category with none shows "No expenses yet".
4. Sanity: the sum of category `spent` equals the trip-total spent on the bar above.

---

## Self-Review

**Spec coverage:**
- Shared rollup / single source of truth -> Task 1. ✅
- Read lens, 3 levels off the total bar -> Task 2 (Level 0 = existing `SpentFigure`, unchanged; Level 1 = category rows; Level 2 = `LedgerRow`). ✅
- Subsume the flat per-card "Expenses" ledger; keep the bottom comprehensive ledger -> Task 2 Step 2. ✅
- No migration / no AI / read-only -> Global Constraints + no server code added. ✅
- Two modes: same component, numbers fill in as the trip runs -> inherent (no mode branching). ✅
- Refactor existing inline computations: spec marked this **opportunistic**, and `PlannedBudget.spentForScope` / `BudgetByLocation` are location-scoped (a different shape than the trip-wide rollup). Decision: **do not** refactor them in this slice — forcing the trip-wide helper onto location-scoped math would be a bad abstraction (spec explicitly permits leaving them). Noted, no task. ✅

**Placeholder scan:** none — all code is complete and concrete.

**Type consistency:** `perCategoryRollup(expenses, budgetItems, catOrder)` and `CategoryRollup { category, plannedCents, actualCents }` match between Task 1 (definition) and Task 2 (use). `LedgerRow` props match `ledger-row.tsx`. `effectiveLocation` returns `{ name, tagged }` matching `LedgerRow.locationChip`. `Bar` tone `"clay"|"sea"` is within `BarTone`. `BudgetTab` already receives `budgetItems`, `expenses`, `expenseCategories`, `members`, `tripSlug`, `locations`, `itineraryDays` — no `page.tsx` change needed.
