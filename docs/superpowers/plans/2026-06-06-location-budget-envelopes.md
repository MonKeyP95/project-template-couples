# Location-Bucketed Budget Envelopes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break the single trip budget into per-location envelopes (target + burn-down) with automatic date-or-tag attribution, an allocation rollup against the existing trip budget, a Move-budget rebalance, and a Location | Month grouping toggle — all inside the existing budget tab.

**Architecture:** Two nullable columns (`itinerary_locations.budget_cents`, `expenses.location_id`) feed a pure attribution/rollup module (`location-budget-types.ts`, no I/O, client-safe) consumed by one new client section (`budget-by-location.tsx`). Three new server actions set a target, move budget, and tag an expense's location. Attribution priority: explicit tag → date-derived (day → location) → Unassigned.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TypeScript 5, Tailwind v4, Supabase (Postgres + RLS). Package manager: `pnpm`.

**Verification note:** This repo has **no test runner** and CLAUDE.md forbids inventing one. Each task is verified with `pnpm lint` and `pnpm build`, plus a manual check in `pnpm dev` on a phone viewport. The pure module in Task 3 is the natural seam for unit tests if/when a runner is added; do not add one as part of this plan.

**Conventions to honor (from CLAUDE.md / memory):**
- Migrations are **idempotent** (`IF [NOT] EXISTS` / `DROP ... IF EXISTS`).
- `"use client"` files import query-layer **types/helpers from `*-types.ts`**, never from `*-queries.ts` (which pulls `next/headers`).
- No emojis in code/logs. Sparse comments. Short functions. No defensive code for impossible cases.
- Commit after each task.

---

## File Structure

**Create:**
- `supabase/migrations/20260606000002_location_budgets.sql` — the two column adds.
- `src/lib/trips/location-budget-types.ts` — pure attribution + rollup + month grouping. No I/O. Client-safe.
- `src/app/trips/[slug]/budget-by-location.tsx` — the new budget section (client): toggle, envelopes, allocation summary, target editor, Move dialog, month view.

**Modify:**
- `src/lib/trips/location-types.ts` — add `budgetCents` to `ItineraryLocation` + row mapping.
- `src/lib/trips/location-queries.ts` — select `budget_cents`.
- `src/lib/trips/expense-types.ts` — add `locationId` to `Expense`.
- `src/lib/trips/expense-queries.ts` — select `location_id`.
- `src/lib/trips/actions.ts` — thread `locationId` through `logExpense`/`updateExpense`; add `setLocationBudget` + `moveLocationBudget`.
- `src/app/trips/[slug]/expense-fields.tsx` — add a Location picker.
- `src/app/trips/[slug]/log-expense-row.tsx` — thread `locationId` state + `locations` prop.
- `src/app/trips/[slug]/ledger-row.tsx` — thread `locationId` + `locations` prop.
- `src/app/trips/[slug]/budget-tab.tsx` — render `BudgetByLocation`; pass `locations` to log/ledger rows.
- `src/app/trips/[slug]/page.tsx` — load itinerary days + locations when the budget tab is active; pass to `BudgetTab`.

---

## Task 1: Migration — per-location budget + expense location tag

**Files:**
- Create: `supabase/migrations/20260606000002_location_budgets.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Location-bucketed budgets: a per-location target plus an explicit location
-- tag on expenses (overrides date-based attribution). Both nullable. RLS is
-- already enforced on these tables by trip -> workspace membership, so the
-- existing row-level policies cover the new columns; no new policies needed.
-- Idempotent: safe to paste-and-run multiple times.

-- Per-location budget target. Null = no target set (not counted as allocated).
alter table public.itinerary_locations
  add column if not exists budget_cents integer
  check (budget_cents is null or budget_cents > 0);

-- Explicit location tag on an expense. Null = attribute by date.
-- on delete set null: deleting a location reverts its expenses to auto.
alter table public.expenses
  add column if not exists location_id uuid
  references public.itinerary_locations(id) on delete set null;
```

- [ ] **Step 2: Apply it**

Paste the file into the Supabase SQL editor and run it (this project applies migrations manually). Re-run once to confirm idempotency: it must succeed with no error the second time.

Expected: both `alter table` statements succeed; second run is a no-op.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260606000002_location_budgets.sql
git commit -m "feat(budget): location budget + expense location tag columns"
```

---

## Task 2: Data layer — read the new columns

Add the new fields to the types and the two read queries so the rest of the code can consume them. Pure mapping only.

**Files:**
- Modify: `src/lib/trips/location-types.ts`
- Modify: `src/lib/trips/location-queries.ts`
- Modify: `src/lib/trips/expense-types.ts:1-12`
- Modify: `src/lib/trips/expense-queries.ts`

- [ ] **Step 1: Add `budgetCents` to the location type + mapping**

Replace the whole contents of `src/lib/trips/location-types.ts` with:

```ts
export interface ItineraryLocation {
  id: string
  name: string
  sortOrder: number
  /** Declared start of the location's span; null = implied by its days. */
  startDate: string | null
  /** Declared end of the location's span; null = implied by its days. */
  endDate: string | null
  /** Per-location budget target in cents; null = no target set. */
  budgetCents: number | null
}

export interface ItineraryLocationRow {
  id: string
  name: string
  sort_order: number
  start_date?: string | null
  end_date?: string | null
  budget_cents?: number | null
}

export function rowToLocation(row: ItineraryLocationRow): ItineraryLocation {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    budgetCents: row.budget_cents ?? null,
  }
}
```

- [ ] **Step 2: Select `budget_cents` in the location query**

In `src/lib/trips/location-queries.ts`, change the `.select(...)` to include `budget_cents`:

```ts
    .select("id, name, sort_order, start_date, end_date, budget_cents")
```

- [ ] **Step 3: Add `locationId` to the expense type**

In `src/lib/trips/expense-types.ts`, change the `Expense` interface (lines 1-12) to add `locationId`:

```ts
export interface Expense {
  id: string
  tripId: string
  title: string
  amountCents: number
  currency: string
  paidBy: string
  category: string
  dayDate: string | null
  locationId: string | null
  isSettlement: boolean
  createdAt: string
}
```

- [ ] **Step 4: Select + map `location_id` in the expense query**

Replace the whole contents of `src/lib/trips/expense-queries.ts` with:

```ts
import { createClient } from "@/lib/supabase/server"
import type { Expense } from "./expense-types"

export async function getTripExpenses(tripId: string): Promise<Expense[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("expenses")
    .select(
      "id, trip_id, title, amount_cents, currency, paid_by, category, day_date, location_id, is_settlement, created_at",
    )
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })

  return (data ?? []).map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    title: row.title,
    amountCents: row.amount_cents,
    currency: row.currency,
    paidBy: row.paid_by,
    category: row.category,
    dayDate: row.day_date,
    locationId: row.location_id,
    isSettlement: row.is_settlement,
    createdAt: row.created_at,
  }))
}
```

- [ ] **Step 5: Verify the build**

Run: `pnpm build`
Expected: PASS. The only place that builds `Expense` objects is `getTripExpenses` (just edited), so adding the non-optional `locationId` field should not break any other construction site. If `pnpm build` reports a missing `locationId` anywhere, add `locationId: null` there.

- [ ] **Step 6: Commit**

```bash
git add src/lib/trips/location-types.ts src/lib/trips/location-queries.ts src/lib/trips/expense-types.ts src/lib/trips/expense-queries.ts
git commit -m "feat(budget): read location budget_cents and expense location_id"
```

## Task 3: Pure attribution + rollup + month grouping module

The single source of attribution truth. No I/O, no `next/headers` — importable by
the client component in Task 6. This is where the spec's priority rule lives:
explicit tag → date-derived → Unassigned.

**Files:**
- Create: `src/lib/trips/location-budget-types.ts`

- [ ] **Step 1: Write the module**

```ts
import type { Expense } from "./expense-types"
import type { ItineraryLocation } from "./location-types"

/** Minimal day shape needed for date-based attribution. */
export interface DayLocation {
  dayDate: string
  locationId: string | null
}

/** One spend bucket: a location, or the synthetic Unassigned bucket (id null). */
export interface Envelope {
  locationId: string | null
  name: string
  /** null = no target set; always null for Unassigned. */
  budgetCents: number | null
  spentCents: number
}

export interface EnvelopeSummary {
  /** One per location, in itinerary order. Unassigned is tracked separately. */
  envelopes: Envelope[]
  /** Sum of location targets. */
  allocatedCents: number
  /** master - allocated; negative means over-allocated. */
  unallocatedCents: number
  /** Non-settlement spend that lands in no location. */
  unassignedSpentCents: number
}

export interface MonthGroup {
  /** "2026-06" for a dated month, "undated" for the no-date bucket. */
  key: string
  /** "Jun 2026" or "Undated". */
  label: string
  spentCents: number
}

/** dayDate -> locationId, only for days filed under a location. */
export function dayLocationMap(days: DayLocation[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const d of days) {
    if (d.locationId) map[d.dayDate] = d.locationId
  }
  return map
}

/** Which location an expense belongs to: explicit tag > date-derived > null. */
export function expenseLocationId(
  expense: Pick<Expense, "locationId" | "dayDate">,
  dayMap: Record<string, string>,
): string | null {
  if (expense.locationId) return expense.locationId
  if (expense.dayDate && dayMap[expense.dayDate]) return dayMap[expense.dayDate]
  return null
}

/** Per-location spend + allocation rollup against the master trip budget. */
export function summarizeEnvelopes(
  expenses: Expense[],
  locations: ItineraryLocation[],
  days: DayLocation[],
  masterBudgetCents: number,
): EnvelopeSummary {
  const dayMap = dayLocationMap(days)
  const spent: Record<string, number> = {}
  let unassignedSpentCents = 0

  for (const e of expenses) {
    if (e.isSettlement) continue
    const loc = expenseLocationId(e, dayMap)
    if (loc) spent[loc] = (spent[loc] ?? 0) + e.amountCents
    else unassignedSpentCents += e.amountCents
  }

  const envelopes: Envelope[] = locations.map((l) => ({
    locationId: l.id,
    name: l.name,
    budgetCents: l.budgetCents,
    spentCents: spent[l.id] ?? 0,
  }))

  const allocatedCents = locations.reduce(
    (sum, l) => sum + (l.budgetCents ?? 0),
    0,
  )

  return {
    envelopes,
    allocatedCents,
    unallocatedCents: masterBudgetCents - allocatedCents,
    unassignedSpentCents,
  }
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

function monthLabel(ym: string): string {
  return MONTH_YEAR.format(new Date(`${ym}-01T00:00:00Z`))
}

/** Same expenses, grouped by calendar month. Undated spend sorts last. */
export function groupByMonth(expenses: Expense[]): MonthGroup[] {
  const totals = new Map<string, number>()
  for (const e of expenses) {
    if (e.isSettlement) continue
    const key = e.dayDate ? e.dayDate.slice(0, 7) : "undated"
    totals.set(key, (totals.get(key) ?? 0) + e.amountCents)
  }

  const keys = [...totals.keys()].sort((a, b) => {
    if (a === "undated") return 1
    if (b === "undated") return -1
    return a < b ? -1 : a > b ? 1 : 0
  })

  return keys.map((key) => ({
    key,
    label: key === "undated" ? "Undated" : monthLabel(key),
    spentCents: totals.get(key)!,
  }))
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm build`
Expected: PASS. (No consumers yet; this just confirms the module compiles and imports resolve.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/location-budget-types.ts
git commit -m "feat(budget): pure location attribution + envelope rollup module"
```

---

## Task 4: Tag an expense with a location (end to end)

Thread an optional `locationId` through the add form, the edit form, and both
server actions. Default is "Auto (by date)" (`null`). This delivers the spec's
manual-tag override.

**Files:**
- Modify: `src/lib/trips/actions.ts` (`LogExpenseInput`/`logExpense`, `UpdateExpenseInput`/`updateExpense`)
- Modify: `src/app/trips/[slug]/expense-fields.tsx`
- Modify: `src/app/trips/[slug]/log-expense-row.tsx`
- Modify: `src/app/trips/[slug]/ledger-row.tsx`

- [ ] **Step 1: Add `locationId` to `LogExpenseInput` + insert it**

In `src/lib/trips/actions.ts`, add the field to `LogExpenseInput` (after `dayDate`):

```ts
export interface LogExpenseInput {
  tripId: string
  tripSlug: string
  title: string
  amount: string
  category: string
  paidBy: string
  dayDate: string | null
  locationId: string | null
}
```

Then in `logExpense`, add `location_id` to the insert object (alongside `day_date`):

```ts
  const { error } = await supabase.from("expenses").insert({
    trip_id: input.tripId,
    title,
    amount_cents: cents,
    currency: "EUR",
    paid_by: input.paidBy,
    category: input.category,
    day_date: input.dayDate,
    location_id: input.locationId,
    is_settlement: false,
  })
```

- [ ] **Step 2: Add `locationId` to `UpdateExpenseInput` + update it**

In the same file, add the field to `UpdateExpenseInput` (after `dayDate`):

```ts
export interface UpdateExpenseInput {
  expenseId: string
  tripSlug: string
  title: string
  amount: string
  category: string
  paidBy: string
  dayDate: string | null
  locationId: string | null
}
```

Then in `updateExpense`, add `location_id` to the `.update({...})` object (after `day_date`):

```ts
    .update({
      title,
      amount_cents: cents,
      paid_by: input.paidBy,
      category: input.category,
      day_date: input.dayDate,
      location_id: input.locationId,
    })
```

- [ ] **Step 3: Add a Location picker to the shared `ExpenseFields`**

In `src/app/trips/[slug]/expense-fields.tsx`:

First, import the location type at the top (after the existing imports):

```ts
import type { ItineraryLocation } from "@/lib/trips/location-types"
```

Add three props to `ExpenseFieldsProps` (after `members`):

```ts
  members: Record<string, MemberToneEntry>
  locations: ItineraryLocation[]
  locationId: string | null
  onLocationChange: (value: string | null) => void
  disabled: boolean
```

Destructure them in the function signature (after `members`):

```ts
  members,
  locations,
  locationId,
  onLocationChange,
  disabled,
```

Then add a Location field as the last cell inside the existing
`<div className="mt-3 grid grid-cols-2 gap-3">` block, immediately after the
"Paid by" `<div className="block">...</div>`:

```tsx
        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Location
          </span>
          <select
            value={locationId ?? ""}
            onChange={(e) =>
              onLocationChange(e.target.value === "" ? null : e.target.value)
            }
            disabled={disabled}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          >
            <option value="">Auto (by date)</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
```

- [ ] **Step 4: Thread `locationId` through the add form**

In `src/app/trips/[slug]/log-expense-row.tsx`:

Import the location type (after existing imports):

```ts
import type { ItineraryLocation } from "@/lib/trips/location-types"
```

Add `locations` to `LogExpenseRowProps`:

```ts
export interface LogExpenseRowProps {
  tripId: string
  tripSlug: string
  currentUserId: string
  members: Record<string, MemberToneEntry>
  locations: ItineraryLocation[]
}
```

Destructure `locations` in the component signature alongside `members`.

Add a state hook next to the other field states (after `dayDate`):

```ts
  const [locationId, setLocationId] = React.useState<string | null>(null)
```

Reset it in `collapse()` (after `setDayDate(initialDay)`):

```ts
    setLocationId(null)
```

Pass it into the `logExpense` call (after `dayDate`):

```ts
        dayDate,
        locationId,
```

Pass the picker props into `<ExpenseFields ... />` (after `members={members}`):

```tsx
        members={members}
        locations={locations}
        locationId={locationId}
        onLocationChange={setLocationId}
        disabled={isPending}
```

- [ ] **Step 5: Thread `locationId` through the edit form**

In `src/app/trips/[slug]/ledger-row.tsx`:

Import the location type (after existing imports):

```ts
import type { ItineraryLocation } from "@/lib/trips/location-types"
```

Add `locations` to `LedgerRowProps` and pass it down. Change the `LedgerRow`
component to accept and forward `locations`:

```tsx
export interface LedgerRowProps {
  expense: Expense
  members: Record<string, MemberToneEntry>
  tripSlug: string
  locations: ItineraryLocation[]
}

export function LedgerRow({ expense, members, tripSlug, locations }: LedgerRowProps) {
  const [editing, setEditing] = React.useState(false)

  if (editing && !expense.isSettlement) {
    return (
      <LedgerRowEditor
        expense={expense}
        members={members}
        tripSlug={tripSlug}
        locations={locations}
        onDone={() => setEditing(false)}
      />
    )
  }

  return (
    <LedgerRowView
      expense={expense}
      members={members}
      tripSlug={tripSlug}
      onEdit={() => setEditing(true)}
    />
  )
}
```

In `LedgerRowEditor`, add `locations` to its prop type and signature, add a
`locationId` state seeded from the expense, pass it to `updateExpense` and
`ExpenseFields`:

```tsx
function LedgerRowEditor({
  expense,
  members,
  tripSlug,
  locations,
  onDone,
}: {
  expense: Expense
  members: Record<string, MemberToneEntry>
  tripSlug: string
  locations: ItineraryLocation[]
  onDone: () => void
}) {
```

Add the state (after the `dayDate` state line):

```ts
  const [locationId, setLocationId] = React.useState<string | null>(
    expense.locationId,
  )
```

Add to the `updateExpense` call (after `dayDate`):

```ts
        dayDate,
        locationId,
```

Add to `<ExpenseFields ... />` (after `members={members}`):

```tsx
        members={members}
        locations={locations}
        locationId={locationId}
        onLocationChange={setLocationId}
        disabled={isPending}
```

- [ ] **Step 6: Verify the build**

Run: `pnpm build`
Expected: FAIL — `budget-tab.tsx` renders `<LogExpenseRow>` and `<LedgerRow>`
without the new required `locations` prop. That is fixed in Task 6. Confirm the
errors are limited to the missing `locations` prop in `budget-tab.tsx`; any other
error means a mistake in this task.

(If you prefer a clean checkpoint, temporarily pass `locations={[]}` at the two
call sites in `budget-tab.tsx`, build to confirm green, then proceed — Task 6
replaces those with the real array.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/trips/actions.ts src/app/trips/[slug]/expense-fields.tsx src/app/trips/[slug]/log-expense-row.tsx src/app/trips/[slug]/ledger-row.tsx
git commit -m "feat(budget): tag an expense with a location (add + edit)"
```

## Task 5: Budget actions — set a target, move budget

Two server actions. `setLocationBudget` writes one location's target (null
clears it). `moveLocationBudget` transfers an amount between two envelopes,
where either endpoint may be the unallocated pool (represented by `null`).

**Files:**
- Modify: `src/lib/trips/actions.ts` (append near the other location actions)

- [ ] **Step 1: Add `setLocationBudget`**

Append to `src/lib/trips/actions.ts` (after `deleteItineraryLocation`):

```ts
export interface SetLocationBudgetInput {
  locationId: string
  tripSlug: string
  /** null clears the target. */
  budgetCents: number | null
}

/** Sets (or clears) one location's budget target. RLS gates membership. */
export async function setLocationBudget(
  input: SetLocationBudgetInput,
): Promise<{ error?: string }> {
  if (input.budgetCents !== null) {
    if (
      !Number.isInteger(input.budgetCents) ||
      input.budgetCents <= 0 ||
      input.budgetCents >= MAX_AMOUNT_CENTS
    ) {
      return { error: "Budget out of range." }
    }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("itinerary_locations")
    .update({ budget_cents: input.budgetCents })
    .eq("id", input.locationId)

  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}
```

- [ ] **Step 2: Add `moveLocationBudget`**

Append directly after `setLocationBudget`:

```ts
export interface MoveLocationBudgetInput {
  tripId: string
  tripSlug: string
  /** null = the unallocated pool (no counterpart to debit). */
  fromLocationId: string | null
  /** null = the unallocated pool (no counterpart to credit). */
  toLocationId: string | null
  amountCents: number
}

/**
 * Transfers budget from one envelope to another. Either endpoint may be the
 * unallocated pool (null): moving to the pool only debits the source; moving
 * from the pool only credits the destination. A location whose target reaches
 * zero is cleared to null.
 */
export async function moveLocationBudget(
  input: MoveLocationBudgetInput,
): Promise<{ error?: string }> {
  if (
    !Number.isInteger(input.amountCents) ||
    input.amountCents <= 0 ||
    input.amountCents >= MAX_AMOUNT_CENTS
  ) {
    return { error: "Amount must be greater than zero." }
  }
  if (input.fromLocationId === input.toLocationId) {
    return { error: "Pick a different destination." }
  }

  const supabase = await createClient()
  const ids = [input.fromLocationId, input.toLocationId].filter(
    (x): x is string => x !== null,
  )
  const { data: rows, error: fetchError } = await supabase
    .from("itinerary_locations")
    .select("id, budget_cents")
    .eq("trip_id", input.tripId)
    .in("id", ids)
  if (fetchError) return { error: fetchError.message }

  const budgetOf = (id: string) =>
    rows?.find((r) => r.id === id)?.budget_cents ?? 0

  if (input.fromLocationId) {
    const next = budgetOf(input.fromLocationId) - input.amountCents
    if (next < 0) return { error: "Not enough budget to move." }
    const { error } = await supabase
      .from("itinerary_locations")
      .update({ budget_cents: next === 0 ? null : next })
      .eq("id", input.fromLocationId)
    if (error) return { error: error.message }
  }

  if (input.toLocationId) {
    const next = budgetOf(input.toLocationId) + input.amountCents
    const { error } = await supabase
      .from("itinerary_locations")
      .update({ budget_cents: next })
      .eq("id", input.toLocationId)
    if (error) return { error: error.message }
  }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}
```

- [ ] **Step 3: Verify the build**

Run: `pnpm build`
Expected: same state as end of Task 4 (only the `budget-tab.tsx` missing-prop
errors, if you did not add the temporary `locations={[]}`). No new errors from
this task.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(budget): setLocationBudget + moveLocationBudget actions"
```

---

## Task 6: The `BudgetByLocation` section component

One self-contained client component: the Location | Month toggle, the envelope
rows with burn-down bars, the allocation summary, an inline target editor, the
Move/Cover form, and the month view. It consumes only the pure module from
Task 3 plus the two actions from Task 5.

**Files:**
- Create: `src/app/trips/[slug]/budget-by-location.tsx`

- [ ] **Step 1: Write the full component**

```tsx
"use client"

import * as React from "react"

import { Bar, Label } from "@/components/together"
import { moveLocationBudget, setLocationBudget } from "@/lib/trips/actions"
import type { Expense } from "@/lib/trips/expense-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import {
  groupByMonth,
  summarizeEnvelopes,
  type DayLocation,
  type Envelope,
  type EnvelopeSummary,
  type MonthGroup,
} from "@/lib/trips/location-budget-types"

function fmt(cents: number): string {
  return (cents / 100).toFixed(2)
}

type View = "location" | "month"

/** A move endpoint: a location, or the unallocated pool (id null). */
interface MoveTarget {
  id: string | null
  name: string
}

export interface BudgetByLocationProps {
  tripId: string
  tripSlug: string
  masterBudgetCents: number
  locations: ItineraryLocation[]
  expenses: Expense[]
  itineraryDays: DayLocation[]
}

export function BudgetByLocation({
  tripId,
  tripSlug,
  masterBudgetCents,
  locations,
  expenses,
  itineraryDays,
}: BudgetByLocationProps) {
  const [view, setView] = React.useState<View>("location")
  const summary = summarizeEnvelopes(
    expenses,
    locations,
    itineraryDays,
    masterBudgetCents,
  )
  const months = groupByMonth(expenses)

  return (
    <div className="border-t border-border bg-background px-5 pt-4 pb-2">
      <div className="flex items-center justify-between">
        <Label>Budget by {view}</Label>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {view === "location" ? (
        <LocationView
          tripId={tripId}
          tripSlug={tripSlug}
          masterBudgetCents={masterBudgetCents}
          summary={summary}
          locations={locations}
        />
      ) : (
        <MonthView months={months} />
      )}
    </div>
  )
}

function ViewToggle({
  view,
  onChange,
}: {
  view: View
  onChange: (v: View) => void
}) {
  return (
    <div className="inline-flex rounded-full border border-border bg-background p-0.5">
      {(["location", "month"] as View[]).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={view === v}
          className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors ${
            view === v
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  )
}

function LocationView({
  tripId,
  tripSlug,
  masterBudgetCents,
  summary,
  locations,
}: {
  tripId: string
  tripSlug: string
  masterBudgetCents: number
  summary: EnvelopeSummary
  locations: ItineraryLocation[]
}) {
  if (locations.length === 0) {
    return (
      <div className="py-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {summary.unassignedSpentCents > 0
          ? `Unassigned · €${fmt(summary.unassignedSpentCents)}`
          : "Add locations in the itinerary to budget by place"}
      </div>
    )
  }

  const overAllocated = summary.unallocatedCents < 0
  const targets: MoveTarget[] = [
    { id: null, name: "Unallocated" },
    ...summary.envelopes.map((e) => ({ id: e.locationId, name: e.name })),
  ]

  return (
    <div className="mt-2">
      <div className="flex justify-between font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
        <span>
          Allocated €{fmt(summary.allocatedCents)} of €{fmt(masterBudgetCents)}
        </span>
        <span className={overAllocated ? "text-clay" : ""}>
          {overAllocated
            ? `€${fmt(-summary.unallocatedCents)} over`
            : `€${fmt(summary.unallocatedCents)} unallocated`}
        </span>
      </div>

      {summary.envelopes.map((e) => (
        <EnvelopeRow
          key={e.locationId ?? "none"}
          tripId={tripId}
          tripSlug={tripSlug}
          envelope={e}
          targets={targets}
        />
      ))}

      {summary.unassignedSpentCents > 0 ? (
        <div className="flex items-baseline justify-between border-t border-border py-3">
          <span className="font-serif text-[14px] italic text-muted-foreground">
            Unassigned
          </span>
          <span className="t-num text-[13px] text-foreground">
            €{fmt(summary.unassignedSpentCents)}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function EnvelopeRow({
  tripId,
  tripSlug,
  envelope,
  targets,
}: {
  tripId: string
  tripSlug: string
  envelope: Envelope
  targets: MoveTarget[]
}) {
  const [moving, setMoving] = React.useState(false)
  const locationId = envelope.locationId as string
  const hasTarget = envelope.budgetCents !== null
  const target = envelope.budgetCents ?? 0
  const leftover = target - envelope.spentCents
  const over = leftover < 0
  const pct =
    hasTarget && target > 0
      ? Math.min(100, Math.round((envelope.spentCents / target) * 100))
      : 0

  return (
    <div className="border-t border-border py-3">
      <div className="flex items-baseline justify-between">
        <span className="font-serif text-[14px] italic text-foreground">
          {envelope.name}
        </span>
        <span className="t-num text-[13px] text-foreground">
          €{fmt(envelope.spentCents)}
          {hasTarget ? (
            <span className="text-muted-foreground"> / €{fmt(target)}</span>
          ) : null}
        </span>
      </div>

      {hasTarget ? (
        <>
          <div className="mt-2">
            <Bar pct={pct} tone={over ? "clay" : "sea"} />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            <span>{pct}% of budget</span>
            <span className={over ? "text-clay" : ""}>
              {over ? `€${fmt(-leftover)} over` : `€${fmt(leftover)} left`}
            </span>
          </div>
        </>
      ) : null}

      <div className="mt-1.5 flex items-center gap-3">
        <TargetEditor
          tripSlug={tripSlug}
          locationId={locationId}
          budgetCents={envelope.budgetCents}
        />
        {hasTarget && leftover !== 0 ? (
          <button
            type="button"
            onClick={() => setMoving((v) => !v)}
            className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
          >
            {over ? "cover" : "move"}
          </button>
        ) : null}
      </div>

      {moving ? (
        <MoveForm
          tripId={tripId}
          tripSlug={tripSlug}
          envelope={envelope}
          leftover={leftover}
          targets={targets.filter((t) => t.id !== locationId)}
          onDone={() => setMoving(false)}
        />
      ) : null}
    </div>
  )
}

function TargetEditor({
  tripSlug,
  locationId,
  budgetCents,
}: {
  tripSlug: string
  locationId: string
  budgetCents: number | null
}) {
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function open() {
    setValue(budgetCents ? (budgetCents / 100).toFixed(0) : "")
    setError(null)
    setEditing(true)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending) return
    const trimmed = value.trim()
    const cents = trimmed === "" ? null : Math.round(Number(trimmed) * 100)
    if (cents !== null && (!Number.isFinite(cents) || cents <= 0)) {
      setError("Enter a valid amount.")
      return
    }
    startTransition(async () => {
      const result = await setLocationBudget({
        locationId,
        tripSlug,
        budgetCents: cents,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setEditing(false)
    })
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={open}
        className="border-0 bg-transparent p-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
      >
        {budgetCents ? "edit budget" : "+ set budget"}
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="inline-flex items-center gap-1.5">
      <span className="font-mono text-[12px] text-muted-foreground">€</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={isPending}
        placeholder="0"
        className="t-num w-20 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
      />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-full border-0 bg-foreground px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
      >
        {isPending ? "…" : "save"}
      </button>
      {error ? (
        <span className="font-mono text-[9px] text-clay">{error}</span>
      ) : null}
    </form>
  )
}

function MoveForm({
  tripId,
  tripSlug,
  envelope,
  leftover,
  targets,
  onDone,
}: {
  tripId: string
  tripSlug: string
  envelope: Envelope
  leftover: number
  targets: MoveTarget[]
  onDone: () => void
}) {
  const over = leftover < 0
  const locationId = envelope.locationId as string
  const [amount, setAmount] = React.useState(
    (Math.abs(leftover) / 100).toFixed(0),
  )
  const [otherId, setOtherId] = React.useState<string>(
    targets[0]?.id ?? "",
  )
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending) return
    const cents = Math.round(Number(amount) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      setError("Enter a valid amount.")
      return
    }
    // Leftover: debit this location, credit the picked one.
    // Over (cover): debit the picked one, credit this location.
    const other = otherId === "" ? null : otherId
    const fromLocationId = over ? other : locationId
    const toLocationId = over ? locationId : other
    startTransition(async () => {
      const result = await moveLocationBudget({
        tripId,
        tripSlug,
        fromLocationId,
        toLocationId,
        amountCents: cents,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      onDone()
    })
  }

  return (
    <form
      onSubmit={submit}
      className="mt-2 rounded-lg border border-border bg-card px-3 py-2.5"
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {over ? `Cover ${envelope.name} from` : `Move from ${envelope.name} to`}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] text-muted-foreground">€</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={isPending}
          className="t-num w-20 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
        />
        <select
          value={otherId}
          onChange={(e) => setOtherId(e.target.value)}
          disabled={isPending}
          className="border-0 border-b border-border bg-transparent py-0.5 text-[13px] text-foreground focus:outline-none"
        >
          {targets.map((t) => (
            <option key={t.id ?? "pool"} value={t.id ?? ""}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full border-0 bg-foreground px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : over ? "cover" : "move"}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={isPending}
          aria-label="Cancel"
          className="border-0 bg-transparent font-mono text-[12px] text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>
      {error ? (
        <div className="mt-1 font-mono text-[9px] text-clay">{error}</div>
      ) : null}
    </form>
  )
}

function MonthView({ months }: { months: MonthGroup[] }) {
  if (months.length === 0) {
    return (
      <div className="py-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        No expenses yet
      </div>
    )
  }
  return (
    <div className="mt-2">
      {months.map((m) => (
        <div
          key={m.key}
          className="flex items-baseline justify-between border-t border-border py-3"
        >
          <span className="font-serif text-[14px] italic text-foreground">
            {m.label}
          </span>
          <span className="t-num text-[13px] text-foreground">
            €{fmt(m.spentCents)}
          </span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm build`
Expected: still only the `budget-tab.tsx` missing-prop errors from Task 4 (this
component is not yet imported anywhere). No errors originating in
`budget-by-location.tsx` itself.

- [ ] **Step 3: Commit**

```bash
git add src/app/trips/[slug]/budget-by-location.tsx
git commit -m "feat(budget): BudgetByLocation section (envelopes, move, month view)"
```

## Task 7: Wire the section into the budget tab and the page

Render `BudgetByLocation` inside the budget tab, give the log/ledger rows their
`locations`, and load itinerary days + locations on the page when the budget tab
is active.

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx`
- Modify: `src/app/trips/[slug]/page.tsx`

- [ ] **Step 1: Import the new pieces in `budget-tab.tsx`**

Add to the imports at the top of `src/app/trips/[slug]/budget-tab.tsx`:

```ts
import { type DayLocation } from "@/lib/trips/location-budget-types"
import { type ItineraryLocation } from "@/lib/trips/location-types"

import { BudgetByLocation } from "./budget-by-location"
```

- [ ] **Step 2: Add the two props to `BudgetTabProps`**

In `BudgetTabProps`, add (after `savedPerUser`):

```ts
  savedPerUser: Record<string, number>
  locations: ItineraryLocation[]
  itineraryDays: DayLocation[]
  currentUserId: string
```

Destructure them in the `BudgetTab({ ... })` signature alongside the others:

```ts
  savedPerUser,
  locations,
  itineraryDays,
  currentUserId,
```

- [ ] **Step 3: Render the section and pass `locations` to the rows**

In `BudgetTab`'s returned JSX, change the block from `SplitBreakdown` through
`Ledger` to:

```tsx
      <SplitBreakdown members={members} paidByUser={summary.expensePaidByUser} />
      <BudgetByLocation
        tripId={tripId}
        tripSlug={tripSlug}
        masterBudgetCents={plannedBudgetCents}
        locations={locations}
        expenses={expenses}
        itineraryDays={itineraryDays}
      />
      <LogExpenseRow
        tripId={tripId}
        tripSlug={tripSlug}
        currentUserId={currentUserId}
        members={members}
        locations={locations}
      />
      <Ledger
        expenses={expenses}
        members={members}
        tripSlug={tripSlug}
        locations={locations}
      />
```

- [ ] **Step 4: Thread `locations` through the local `Ledger` component**

In the same file, update the `Ledger` function to accept and forward `locations`:

```tsx
function Ledger({
  expenses,
  members,
  tripSlug,
  locations,
}: {
  expenses: Expense[]
  members: Record<string, MemberToneEntry>
  tripSlug: string
  locations: ItineraryLocation[]
}) {
  return (
    <div className="border-t border-border bg-background">
      <div className="flex items-baseline justify-between px-5 pt-4 pb-1.5">
        <Label>Ledger · {expenses.length}</Label>
        <span className="font-mono text-[10px] text-muted-foreground">
          most recent
        </span>
      </div>
      <div>
        {expenses.map((e) => (
          <LedgerRow
            key={e.id}
            expense={e}
            members={members}
            tripSlug={tripSlug}
            locations={locations}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Load itinerary days + locations for the budget tab in `page.tsx`**

In `src/app/trips/[slug]/page.tsx`, the `Promise.all` currently loads
`datedItinerary` and `locations` only on the itinerary tab. Change those two
entries so they also load when the budget tab is active:

```ts
      (showItinerary && !isDream) || activeTab === "budget"
        ? getItineraryDays(header.id)
        : Promise.resolve(null),
      showItinerary && isDream ? getDreamItineraryDays(header.id) : Promise.resolve(null),
      (showItinerary && !isDream) || activeTab === "budget"
        ? getItineraryLocations(header.id)
        : Promise.resolve(null),
```

(The first and third array entries change; the dream entry between them is
unchanged. Keep the array order identical so the destructuring still lines up.)

- [ ] **Step 6: Pass the new props to `<BudgetTab>`**

In `page.tsx`, in the `activeTab === "budget"` branch, add the two props
(after `savedPerUser`):

```tsx
            savedPerUser={savings.perUser}
            locations={locations ?? []}
            itineraryDays={datedItinerary ?? []}
            currentUserId={userData.user.id}
```

- [ ] **Step 7: Verify the build is green**

Run: `pnpm build`
Expected: PASS — all missing-prop errors from Task 4 are now resolved. If you
added the temporary `locations={[]}` placeholders in Task 4, confirm they are
gone (replaced by Step 3's real values).

Run: `pnpm lint`
Expected: PASS (no new warnings/errors).

- [ ] **Step 8: Manual verification in the running app**

Run: `pnpm dev` and open a dated trip with at least two itinerary locations on a
phone viewport (devtools), then the Budget tab. Confirm:
- A "Budget by location" section appears with a Location | Month toggle.
- Each location shows spend; "+ set budget" sets a target and a burn-down bar appears.
- Going over a target shows the bar in clay and "X over" (no error).
- "move" on a location with leftover transfers budget to another location or Unallocated; the allocation summary updates.
- "cover" on an over location pulls budget from another location/Unallocated.
- Adding an expense with a Location of "Auto (by date)" lands in the location whose itinerary day matches its date; tagging it to a specific location overrides that.
- The Month toggle lists per-month spend totals; an expense with no date appears under "Undated".

- [ ] **Step 9: Commit**

```bash
git add src/app/trips/[slug]/budget-tab.tsx src/app/trips/[slug]/page.tsx
git commit -m "feat(budget): render location envelopes in the budget tab"
```

---

## Task 8: Docs + final verification

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Update `docs/TODO.md`**

Add an entry recording the completed work, matching the file's existing format
(checked-off item or a short "done" line). Content:

> Location-bucketed budget envelopes: per-location targets with date/tag
> attribution, allocation rollup against the trip budget, Move-budget rebalance,
> and a Location | Month grouping toggle.

- [ ] **Step 2: Append a row to `docs/DECISIONS.md`**

Match the file's existing row format. Record this non-obvious choice:

> **Per-location budgets reuse `itinerary_locations`, not a new bucket table.**
> Targets live in `itinerary_locations.budget_cents`; expenses attribute to a
> location by explicit `expenses.location_id` tag, else by date (day → location),
> else Unassigned. The trip's `planned_budget_cents` stays the master; location
> targets are an allocation of it (allocated vs unallocated). Month grouping is
> insight-only (no month targets). Chosen over a `trip_budget_buckets` table to
> avoid a second budgeting system for a two-person app.

- [ ] **Step 3: Final full build + lint**

Run: `pnpm build`
Expected: PASS.

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record location-bucketed budget envelopes"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Per-location envelopes (target + burn-down) → Tasks 1, 3, 6.
- Attribution (tag → date → Unassigned) → Task 3 (`expenseLocationId`), Task 4 (tag plumbing).
- Allocation rollup (master / allocated / unallocated) → Task 3 (`summarizeEnvelopes`), Task 6 (`LocationView`).
- Move budget (locations + unallocated pool; leftover and over/cover) → Task 5 (`moveLocationBudget`), Task 6 (`MoveForm`).
- Over-budget is not an error → Task 6 (clay bar + "over", never blocks).
- Location | Month toggle; month insight-only; Undated group → Task 3 (`groupByMonth`), Task 6 (`MonthView`).
- Location tag on expense, default "Auto (by date)" → Tasks 1, 4.
- No new table; two nullable columns; idempotent migration → Task 1.
- No per-bucket settle-up; no month targets (YAGNI) → not built, by omission.

**Placeholder scan:** No TBD/TODO in code steps; every code step shows complete code.

**Type consistency:** `DayLocation`, `Envelope`, `EnvelopeSummary`, `MonthGroup`,
`MoveTarget`, `setLocationBudget`, `moveLocationBudget`,
`SetLocationBudgetInput`, `MoveLocationBudgetInput`, `BudgetByLocationProps`,
`fromLocationId`/`toLocationId`/`amountCents`, `budgetCents`/`locationId` are used
identically across the tasks that define and consume them.



