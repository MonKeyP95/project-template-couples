# Server-backed budget line items — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move budget line items from device `localStorage` to a shared `trip_budget_items` table, with an editable list visible in AI-off mode and the AI drafter persisting to the same table; the planned total stays the sum of items.

**Architecture:** New RLS-guarded table + query + a replace-all `saveBudgetItems` action that also writes `trips.planned_budget_cents = sum`. AI-off renders a new `BudgetItemList` editor; the AI drafter loads from / saves to the server instead of `localStorage`. Both modes share one list.

**Tech Stack:** Next.js 16 (Server Components, Server Actions), Supabase (Postgres + RLS), React 19. One migration, no new deps.

**Note on verification:** No test framework (per CLAUDE.md); each task verifies with `pnpm lint` + `pnpm build`. The migration is pasted into the Supabase SQL editor (dev first) — see Task 8.

**Spec:** `docs/superpowers/specs/2026-06-17-budget-items-server-design.md`
**Depends on:** AI toggle (#59), already merged into this branch.

---

### Task 1: Migration — `trip_budget_items` table + RLS

**Files:**
- Create: `supabase/migrations/20260617000001_trip_budget_items.sql`

- [ ] **Step 1: Write the migration (idempotent)**

```sql
-- trip_budget_items: per-trip budget line items (shared, server-backed).
-- The planned total = sum(amount_cents); the app keeps trips.planned_budget_cents in sync.
-- Idempotent: safe to paste-and-run multiple times.

create table if not exists public.trip_budget_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  category text not null,
  subject text not null default '',
  when_label text not null default '',
  amount_cents integer not null default 0 check (amount_cents >= 0),
  location_id uuid references public.itinerary_locations(id) on delete set null,
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists trip_budget_items_trip_idx
  on public.trip_budget_items (trip_id, category, sort_order);

alter table public.trip_budget_items enable row level security;

drop policy if exists trip_budget_items_select on public.trip_budget_items;
create policy trip_budget_items_select on public.trip_budget_items
  for select to authenticated
  using (public.is_trip_workspace_member(trip_id));

drop policy if exists trip_budget_items_insert on public.trip_budget_items;
create policy trip_budget_items_insert on public.trip_budget_items
  for insert to authenticated
  with check (public.is_trip_workspace_member(trip_id));

drop policy if exists trip_budget_items_update on public.trip_budget_items;
create policy trip_budget_items_update on public.trip_budget_items
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));

drop policy if exists trip_budget_items_delete on public.trip_budget_items;
create policy trip_budget_items_delete on public.trip_budget_items
  for delete to authenticated
  using (public.is_trip_workspace_member(trip_id));
```

- [ ] **Step 2: Commit** (SQL is pasted into Supabase in Task 8; nothing to build)

```bash
git add supabase/migrations/20260617000001_trip_budget_items.sql
git commit -m "feat(budget): trip_budget_items table + RLS migration"
```

---

### Task 2: Types — `budget-item-types.ts`

Pure module (no `next/headers`), importable by client and server.

**Files:**
- Create: `src/lib/trips/budget-item-types.ts`

- [ ] **Step 1: Write the types**

```ts
export interface BudgetItem {
  id: string
  category: string
  subject: string
  whenLabel: string
  amountCents: number
  locationId: string | null
  sortOrder: number
}

export interface BudgetItemRow {
  id: string
  category: string
  subject: string
  when_label: string
  amount_cents: number
  location_id: string | null
  sort_order: number
}

export function rowToBudgetItem(row: BudgetItemRow): BudgetItem {
  return {
    id: row.id,
    category: row.category,
    subject: row.subject,
    whenLabel: row.when_label,
    amountCents: row.amount_cents,
    locationId: row.location_id,
    sortOrder: row.sort_order,
  }
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/budget-item-types.ts
git commit -m "feat(budget): BudgetItem types"
```

---

### Task 3: Query — `budget-item-queries.ts`

**Files:**
- Create: `src/lib/trips/budget-item-queries.ts`

- [ ] **Step 1: Write the query**

```ts
import { createClient } from "@/lib/supabase/server"

import {
  rowToBudgetItem,
  type BudgetItem,
  type BudgetItemRow,
} from "./budget-item-types"

/** All budget line items for a trip, ordered by category then sort_order. */
export async function getBudgetItems(tripId: string): Promise<BudgetItem[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trip_budget_items")
    .select(
      "id, category, subject, when_label, amount_cents, location_id, sort_order",
    )
    .eq("trip_id", tripId)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .returns<BudgetItemRow[]>()
  return (data ?? []).map(rowToBudgetItem)
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/budget-item-queries.ts
git commit -m "feat(budget): getBudgetItems query"
```

---

### Task 4: Action — `saveBudgetItems` (replace-all + total sync)

**Files:**
- Modify: `src/lib/trips/actions.ts`

- [ ] **Step 1: Extend the expense-types import**

Change the existing import (top of `actions.ts`):

```ts
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategoryRow,
} from "@/lib/trips/expense-types"
```

to:

```ts
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type ExpenseCategoryRow,
} from "@/lib/trips/expense-types"
```

- [ ] **Step 2: Append the action** (near `updateTripBudget`, end of file)

```ts
export interface SaveBudgetItemInput {
  category: string
  subject: string
  whenLabel: string
  amountCents: number
  locationId: string | null
}

export interface SaveBudgetItemsInput {
  tripId: string
  tripSlug: string
  items: SaveBudgetItemInput[]
}

/**
 * Replace-all save of a trip's budget line items, then set the planned total
 * to their sum. Any workspace member of the trip may edit (RLS-gated).
 */
export async function saveBudgetItems(
  input: SaveBudgetItemsInput,
): Promise<{ error?: string }> {
  const perCategory: Record<string, number> = {}
  const rows: {
    trip_id: string
    category: string
    subject: string
    when_label: string
    amount_cents: number
    location_id: string | null
    sort_order: number
  }[] = []

  for (const it of input.items) {
    if (!EXPENSE_CATEGORIES.includes(it.category as ExpenseCategory)) {
      return { error: "Unknown budget category." }
    }
    if (!validCents(it.amountCents)) {
      return { error: "Budget amount out of range." }
    }
    const order = perCategory[it.category] ?? 0
    perCategory[it.category] = order + 1
    rows.push({
      trip_id: input.tripId,
      category: it.category,
      subject: it.subject.trim(),
      when_label: it.whenLabel.trim(),
      amount_cents: it.amountCents,
      location_id: it.locationId,
      sort_order: order,
    })
  }

  const supabase = await createClient()

  const { error: delErr } = await supabase
    .from("trip_budget_items")
    .delete()
    .eq("trip_id", input.tripId)
  if (delErr) return { error: delErr.message }

  if (rows.length > 0) {
    const { error: insErr } = await supabase
      .from("trip_budget_items")
      .insert(rows)
    if (insErr) return { error: insErr.message }
  }

  const total = rows.reduce((sum, r) => sum + r.amount_cents, 0)
  const { error: budErr } = await supabase
    .from("trips")
    .update({ planned_budget_cents: total })
    .eq("id", input.tripId)
  if (budErr) return { error: budErr.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}
```

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS (uses existing `validCents`, `createClient`, `revalidatePath`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(budget): saveBudgetItems replace-all action + total sync"
```

---

### Task 5: AI-off editor — `BudgetItemList`

**Files:**
- Create: `src/app/trips/[slug]/budget-item-list.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client"

import * as React from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { saveBudgetItems } from "@/lib/trips/actions"
import type { BudgetItem } from "@/lib/trips/budget-item-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

const CATEGORIES = [
  "Accommodation",
  "Transportation",
  "Food",
  "Activities",
  "Other",
] as const
const PLACED = new Set<string>(["Accommodation", "Activities"])

interface Row {
  id: string
  category: string
  subject: string
  when: string
  value: string
  locationId: string | null
}

function asCents(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

/** AI-off budget editor: items grouped by category, total = sum, replace-all save. */
export function BudgetItemList({
  tripId,
  tripSlug,
  items,
  locations,
}: {
  tripId: string
  tripSlug: string
  items: BudgetItem[]
  locations: ItineraryLocation[]
}) {
  const seq = React.useRef(0)
  const [rows, setRows] = React.useState<Row[]>(() =>
    items.map((it) => ({
      id: `r-${seq.current++}`,
      category: it.category,
      subject: it.subject,
      when: it.whenLabel,
      value: it.amountCents ? (it.amountCents / 100).toFixed(0) : "",
      locationId: it.locationId,
    })),
  )
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)

  const totalCents = rows.reduce((s, r) => s + asCents(r.value), 0)

  function patch(id: string, p: Partial<Row>) {
    setSaved(false)
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))
  }
  function add(category: string) {
    setSaved(false)
    setRows((rs) => [
      ...rs,
      { id: `r-${seq.current++}`, category, subject: "", when: "", value: "", locationId: null },
    ])
  }
  function remove(id: string) {
    setSaved(false)
    setRows((rs) => rs.filter((r) => r.id !== id))
  }

  function save() {
    const payload = rows
      .filter((r) => r.subject.trim() !== "" || asCents(r.value) > 0)
      .map((r) => ({
        category: r.category,
        subject: r.subject,
        whenLabel: r.when,
        amountCents: asCents(r.value),
        locationId: PLACED.has(r.category) ? r.locationId : null,
      }))
    setError(null)
    startTransition(async () => {
      const res = await saveBudgetItems({ tripId, tripSlug, items: payload })
      if (res.error) setError(res.error)
      else setSaved(true)
    })
  }

  return (
    <div className="border-t border-border px-5 pt-4 pb-3">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Budget plan
        </span>
        <span className="font-mono text-[12px] text-foreground">
          € {(totalCents / 100).toFixed(0)}
        </span>
      </div>

      {CATEGORIES.map((category) => {
        const catRows = rows.filter((r) => r.category === category)
        const placed = PLACED.has(category) && locations.length > 0
        return (
          <div key={category} className="mt-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {category}
            </div>
            <div className="mt-1.5 space-y-1.5">
              {catRows.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-1.5">
                  <input
                    value={r.subject}
                    onChange={(e) => patch(r.id, { subject: e.target.value })}
                    placeholder="What"
                    className="min-w-0 flex-1 rounded-lg border border-clay bg-transparent px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  <input
                    value={r.when}
                    onChange={(e) => patch(r.id, { when: e.target.value })}
                    placeholder="When"
                    className="w-16 rounded-lg border border-clay bg-transparent px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    value={r.value}
                    onChange={(e) => patch(r.id, { value: e.target.value })}
                    placeholder="0"
                    className="w-16 rounded-lg border border-clay bg-transparent px-2 py-1.5 text-right text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  {placed ? (
                    <Select
                      value={r.locationId}
                      onValueChange={(v: string | null) => patch(r.id, { locationId: v })}
                    >
                      <SelectTrigger className="w-28 font-mono text-[11px]">
                        <SelectValue placeholder="place">
                          {r.locationId
                            ? locations.find((l) => l.id === r.locationId)?.name ?? "place"
                            : "place"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={null}>no place</SelectItem>
                        {locations.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => remove(r.id)}
                    aria-label="Remove item"
                    className="px-1 font-mono text-[13px] text-muted-foreground hover:text-foreground"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => add(category)}
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
              >
                + {category.toLowerCase()}
              </button>
            </div>
          </div>
        )
      })}

      {error ? <p className="mt-2 text-[11px] text-clay">{error}</p> : null}
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="mt-4 rounded-full border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        {saved ? "saved" : "save budget"}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS. (The `Select` with `value={null}` mirrors the itinerary tab's location select.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/trips/[slug]/budget-item-list.tsx"
git commit -m "feat(budget): BudgetItemList editor for AI-off mode"
```

---

### Task 6: Wire the trip page + budget tab; delete the interim total field

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx`
- Modify: `src/app/trips/[slug]/budget-tab.tsx`
- Delete: `src/app/trips/[slug]/budget-total-field.tsx`

- [ ] **Step 1: Load budget items on the trip page**

In `page.tsx`, add the import near the other trip imports:

```ts
import { getBudgetItems } from "@/lib/trips/budget-item-queries"
```

Add a tenth/eleventh entry to the `Promise.all` (after the `getTripBudgetMoves` line) and extend the destructuring array with `budgetItems`:

```ts
  const [datedItinerary, dreamItinerary, locations, notes, packingItems, packingCategories, expenses, expenseCategories, savings, budgetMoves, budgetItems] =
    await Promise.all([
```

…and as the last array element (after the `getTripBudgetMoves` ternary line):

```ts
      activeTab === "budget" ? getBudgetItems(header.id) : Promise.resolve(null),
```

- [ ] **Step 2: Pass items into `BudgetTab`**

In the `<BudgetTab ... />` JSX add:

```tsx
            budgetItems={budgetItems ?? []}
```

- [ ] **Step 3: Update `budget-tab.tsx` imports**

Replace:

```tsx
import { BudgetTotalField } from "./budget-total-field"
```

with:

```tsx
import { BudgetItemList } from "./budget-item-list"
import type { BudgetItem } from "@/lib/trips/budget-item-types"
```

- [ ] **Step 4: Add the prop**

In `BudgetTabProps` add `budgetItems: BudgetItem[]`, and add `budgetItems,` to the destructured params.

- [ ] **Step 5: Swap the AI-off branch + seed the drafter**

Replace the AI on/off block:

```tsx
          {aiEnabled ? (
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
          ) : (
            <BudgetTotalField
              tripId={tripId}
              tripSlug={tripSlug}
              plannedBudgetCents={plannedBudgetCents}
            />
          )}
```

with:

```tsx
          {aiEnabled ? (
            <BudgetDrafter
              tripId={tripId}
              tripSlug={tripSlug}
              tripName={tripName}
              tripDays={tripDays}
              plannedBudgetCents={plannedBudgetCents}
              locations={locations}
              itineraryDays={itineraryDays}
              memberCount={Object.keys(members).length}
              initialItems={budgetItems}
            />
          ) : (
            <BudgetItemList
              tripId={tripId}
              tripSlug={tripSlug}
              items={budgetItems}
              locations={locations}
            />
          )}
```

- [ ] **Step 6: Delete the interim total field**

```bash
git rm "src/app/trips/[slug]/budget-total-field.tsx"
```

- [ ] **Step 7: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: build will FAIL until Task 7 adds `initialItems` to `BudgetDrafter`. That's expected — proceed to Task 7, then verify together. (Do not commit yet.)

---

### Task 7: Drafter persists to the server (drop localStorage)

**Files:**
- Modify: `src/app/trips/[slug]/budget-drafter.tsx`

- [ ] **Step 1: Update imports**

Replace:

```tsx
import { updateTripBudget } from "@/lib/trips/actions"
```

with:

```tsx
import { saveBudgetItems, type SaveBudgetItemInput } from "@/lib/trips/actions"
import type { BudgetItem } from "@/lib/trips/budget-item-types"
```

- [ ] **Step 2: Remove the localStorage helpers**

Delete `planKey` (the `function planKey(...)`), `loadSavedItems`, and `saveItems`. Keep the `SavedItems` type and `ItemRow`/`Session`.

- [ ] **Step 3: Add server <-> session converters** (place just below the `SavedItems` type)

```tsx
const CATEGORY_BY_STEP: Record<string, string> = {
  accommodation: "Accommodation",
  transport: "Transportation",
  food: "Food",
  activities: "Activities",
  other: "Other",
}
const STEP_BY_CATEGORY: Record<string, string> = {
  Accommodation: "accommodation",
  Transportation: "transport",
  Food: "food",
  Activities: "activities",
  Other: "other",
}
const GROUPED_STEPS = new Set(["accommodation", "activities"])

/** Server items -> the drafter's bucket-keyed saved shape. */
function serverToSaved(items: BudgetItem[]): SavedItems {
  const out: SavedItems = {}
  for (const it of items) {
    const stepKey = STEP_BY_CATEGORY[it.category]
    if (!stepKey) continue
    const bucketId = GROUPED_STEPS.has(stepKey)
      ? `${stepKey}:${it.locationId ?? "trip"}`
      : stepKey
    ;(out[bucketId] ??= []).push({
      subject: it.subject,
      when: it.whenLabel,
      value: it.amountCents ? fmt(it.amountCents) : "",
    })
  }
  return out
}

/** The drafter's session -> server items (drops blank rows). */
function sessionToServerItems(session: Session): SaveBudgetItemInput[] {
  const out: SaveBudgetItemInput[] = []
  for (const [bucketId, rows] of Object.entries(session.items)) {
    const [stepKey, locKey] = bucketId.split(":")
    const category = CATEGORY_BY_STEP[stepKey]
    if (!category) continue
    const locationId = locKey && locKey !== "trip" ? locKey : null
    for (const r of rows) {
      const cents = asCents(r.value)
      if (r.subject.trim() === "" && cents === 0) continue
      out.push({
        category,
        subject: r.subject,
        whenLabel: r.when,
        amountCents: cents,
        locationId,
      })
    }
  }
  return out
}
```

- [ ] **Step 4: Add the `initialItems` prop**

In `BudgetDrafterProps` add `initialItems: BudgetItem[]`, and add `initialItems,` to the destructured params.

- [ ] **Step 5: Seed from the server in `open()`**

Replace:

```tsx
    const saved = fromScratch ? null : loadSavedItems(tripId)
```

with:

```tsx
    const saved = fromScratch ? null : serverToSaved(initialItems)
```

- [ ] **Step 6: Persist on Apply**

Replace the Apply body:

```tsx
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
```

with:

```tsx
    if (!session || isPending) return
    startTransition(async () => {
      const r = await saveBudgetItems({
        tripId,
        tripSlug,
        items: sessionToServerItems(session),
      })
      if (r.error) {
        setError(r.error)
        return
      }
      setSession(null)
    })
```

- [ ] **Step 7: Verify lint + build** (Tasks 6 + 7 together)

Run: `pnpm lint && pnpm build`
Expected: PASS. (If `totalCents` is now unused, remove it; if still used for the summary display, leave it.)

- [ ] **Step 8: Commit Tasks 6 + 7**

```bash
git add "src/app/trips/[slug]/page.tsx" "src/app/trips/[slug]/budget-tab.tsx" "src/app/trips/[slug]/budget-drafter.tsx"
git commit -m "feat(budget): server-backed budget items in both modes; drop localStorage"
```

---

### Task 8: Migration apply, verification, docs

- [ ] **Step 1: Apply the migration to dev**

Paste `supabase/migrations/20260617000001_trip_budget_items.sql` into the Supabase SQL editor and run it (dev project). Prod later.

- [ ] **Step 2: Manual check**

Run `pnpm dev`, sign in, open a trip's Budget tab.
- AI off (default): the "Budget plan" list shows (empty per category at first). Add a hotel under Accommodation with a place + cost, Save; the spent-vs-planned figure's planned total reflects the sum.
- AI on (flip the floating toggle): the drafter appears; run it and Apply. Flip back to AI off: the same items show in the list.
- Reload: items persist. A second account (partner) sees the same list after refresh.

- [ ] **Step 3: Update `docs/DECISIONS.md`**

Add this row under the table header (the line after `|---|---|---|`):

```markdown
| **Budget line items are server-persisted (`trip_budget_items`, RLS), shared; planned total = sum of items; editable in both AI modes** | Supersedes the earlier "total-only, no per-item persistence" decision. The user wanted a real, shared, viewable/editable list of hotels/prices, including in AI-off mode. A replace-all `saveBudgetItems` keeps `trips.planned_budget_cents` = sum, so existing budget views are unchanged. The AI drafter now loads/saves the same table instead of localStorage. | 2026-06-17 |
```

- [ ] **Step 4: Update `docs/TODO.md`**

Add a shipped entry near the top (above the most recent dated entry):

```markdown
**Server-backed budget line items: shipped 2026-06-17.** Budget items (hotels/activities/prices) moved from device localStorage to a shared `trip_budget_items` table (RLS via `is_trip_workspace_member`; migration `20260617000001_trip_budget_items.sql`). New `BudgetItem` types, `getBudgetItems` query, and a replace-all `saveBudgetItems` action that keeps `trips.planned_budget_cents = sum(items)`. AI-off shows an editable `BudgetItemList` (grouped by category, optional place, live total) — replacing the interim `BudgetTotalField`; the AI drafter now loads/saves the same table (localStorage dropped). Both modes share one list. Spec: `docs/superpowers/specs/2026-06-17-budget-items-server-design.md`. Plan: `docs/superpowers/plans/2026-06-17-budget-items-server.md`. **Migration pasted to dev; prod pending.**
```

- [ ] **Step 5: Commit**

```bash
git add docs/DECISIONS.md docs/TODO.md
git commit -m "docs: record server-backed budget items (DECISIONS + TODO)"
```

---

## Self-Review

**Spec coverage:**
- Table + RLS + idempotent migration → Task 1.
- `BudgetItem` types → Task 2; `getBudgetItems` → Task 3.
- Replace-all `saveBudgetItems` + `planned_budget_cents = sum` → Task 4.
- AI-off `BudgetItemList` (grouped by category, optional place, live total) → Task 5.
- Trip page + budget tab wiring, `BudgetTotalField` removed → Task 6.
- Drafter server persistence, localStorage dropped → Task 7.
- Migration apply, verification, DECISIONS + TODO → Task 8.
All spec sections map to a task.

**Placeholder scan:** No TBD/"handle edge cases"; every code step shows full code. Task 6 Step 7 intentionally expects a transient build failure resolved by Task 7 (the two are committed together).

**Type consistency:** `BudgetItem`/`BudgetItemRow`/`rowToBudgetItem` (Task 2) used identically in Tasks 3, 5, 6, 7. `SaveBudgetItemInput`/`SaveBudgetItemsInput`/`saveBudgetItems` (Task 4) match the calls in Tasks 5 and 7. Category strings match `EXPENSE_CATEGORIES` ("Food", "Transportation", "Accommodation", "Activities", "Other"); `CATEGORY_BY_STEP` keys match the `planBudgetSteps` step keys (accommodation/transport/food/activities/other). `initialItems` prop added to `BudgetDrafter` (Task 7) matches its use in Task 6.
