# Slice 1 — Budget on the itinerary spine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Weave the planned budget into the itinerary — a tap-to-expand cost editor per location (dates inherited) plus a Trip-wide section (own dates) and a planned total — always available, scoped saves.

**Architecture:** Add `when_start`/`when_end` to `trip_budget_items` (trip-wide only). One `BudgetScopeEditor` client component renders both per-location (inside each open location block) and trip-wide (foot of timeline). A scoped `saveBudgetItemsForScope` action replaces only one scope and recomputes the trip total. The AI-off `BudgetItemList` is removed from the Budget tab.

**Tech Stack:** Next.js 16 (Server Components/Actions), Supabase + RLS, React 19. One migration, no new deps.

**Verification:** No test framework (per CLAUDE.md); each task verifies with `pnpm lint` + `pnpm build`. Migration pasted into Supabase (Task 7).

**Spec:** `docs/superpowers/specs/2026-06-17-budget-on-itinerary-slice1-design.md`

---

### Task 1: Migration — budget item dates

**Files:**
- Create: `supabase/migrations/20260617000002_budget_item_dates.sql`

- [ ] **Step 1: Write the migration (idempotent)**

```sql
-- Add optional dates to budget items. Used only by trip-wide items (no
-- location to inherit dates from); located items leave these null.
-- Idempotent: safe to paste-and-run multiple times.

alter table public.trip_budget_items
  add column if not exists when_start date,
  add column if not exists when_end date;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260617000002_budget_item_dates.sql
git commit -m "feat(budget): add when_start/when_end to trip_budget_items"
```

---

### Task 2: Types + query gain dates

**Files:**
- Modify: `src/lib/trips/budget-item-types.ts`
- Modify: `src/lib/trips/budget-item-queries.ts`

- [ ] **Step 1: Extend the types**

In `budget-item-types.ts`, add `whenStart`/`whenEnd` to `BudgetItem`, the snake
columns to `BudgetItemRow`, and map them in `rowToBudgetItem`:

```ts
export interface BudgetItem {
  id: string
  category: string
  subject: string
  whenLabel: string
  amountCents: number
  locationId: string | null
  whenStart: string | null
  whenEnd: string | null
  sortOrder: number
}

export interface BudgetItemRow {
  id: string
  category: string
  subject: string
  when_label: string
  amount_cents: number
  location_id: string | null
  when_start: string | null
  when_end: string | null
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
    whenStart: row.when_start,
    whenEnd: row.when_end,
    sortOrder: row.sort_order,
  }
}
```

- [ ] **Step 2: Select the new columns**

In `budget-item-queries.ts`, update the `.select(...)` string:

```ts
    .select(
      "id, category, subject, when_label, amount_cents, location_id, when_start, when_end, sort_order",
    )
```

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/budget-item-types.ts src/lib/trips/budget-item-queries.ts
git commit -m "feat(budget): budget items carry optional dates"
```

---

### Task 3: Scoped save action

**Files:**
- Modify: `src/lib/trips/actions.ts`

- [ ] **Step 1: Add optional dates to `SaveBudgetItemInput`**

Change the existing interface (keep fields optional so the drafter's
`saveBudgetItems` callers are unaffected):

```ts
export interface SaveBudgetItemInput {
  category: string
  subject: string
  whenLabel: string
  amountCents: number
  locationId: string | null
  whenStart?: string | null
  whenEnd?: string | null
}
```

- [ ] **Step 2: Append the scoped action** (after `saveBudgetItems`)

```ts
export interface SaveScopeInput {
  tripId: string
  tripSlug: string
  locationId: string | null
  items: SaveBudgetItemInput[]
}

/**
 * Replace the budget items of a single scope — one location, or the trip-wide
 * bucket (locationId null) — then recompute the trip's planned total. Other
 * scopes are untouched.
 */
export async function saveBudgetItemsForScope(
  input: SaveScopeInput,
): Promise<{ error?: string }> {
  let order = 0
  const rows: {
    trip_id: string
    category: string
    subject: string
    when_label: string
    amount_cents: number
    location_id: string | null
    when_start: string | null
    when_end: string | null
    sort_order: number
  }[] = []

  for (const it of input.items) {
    if (!EXPENSE_CATEGORIES.includes(it.category as ExpenseCategory)) {
      return { error: "Unknown budget category." }
    }
    if (!validCents(it.amountCents)) {
      return { error: "Budget amount out of range." }
    }
    rows.push({
      trip_id: input.tripId,
      category: it.category,
      subject: it.subject.trim(),
      when_label: it.whenLabel.trim(),
      amount_cents: it.amountCents,
      location_id: input.locationId,
      when_start: it.whenStart ?? null,
      when_end: it.whenEnd ?? null,
      sort_order: order++,
    })
  }

  const supabase = await createClient()

  let del = supabase
    .from("trip_budget_items")
    .delete()
    .eq("trip_id", input.tripId)
  del =
    input.locationId === null
      ? del.is("location_id", null)
      : del.eq("location_id", input.locationId)
  const { error: delErr } = await del
  if (delErr) return { error: delErr.message }

  if (rows.length > 0) {
    const { error: insErr } = await supabase
      .from("trip_budget_items")
      .insert(rows)
    if (insErr) return { error: insErr.message }
  }

  const { data: allRows } = await supabase
    .from("trip_budget_items")
    .select("amount_cents")
    .eq("trip_id", input.tripId)
  const total = (allRows ?? []).reduce(
    (s, r) => s + (r.amount_cents as number),
    0,
  )
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
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(budget): saveBudgetItemsForScope (per-location / trip-wide)"
```

---

### Task 4: `BudgetScopeEditor` component

**Files:**
- Create: `src/app/trips/[slug]/budget-scope-editor.tsx`

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
import { saveBudgetItemsForScope } from "@/lib/trips/actions"
import type { BudgetItem } from "@/lib/trips/budget-item-types"

const CATEGORIES = [
  "Accommodation",
  "Transportation",
  "Food",
  "Activities",
  "Other",
] as const

interface Row {
  id: string
  category: string
  subject: string
  value: string
  whenStart: string
  whenEnd: string
}

function asCents(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

/** Collapsible cost editor for one scope: a location, or the trip-wide bucket
 * (locationId null, withDates true). Explicit save replaces just this scope. */
export function BudgetScopeEditor({
  tripId,
  tripSlug,
  locationId,
  items,
  withDates,
  defaultCategory,
  label,
}: {
  tripId: string
  tripSlug: string
  locationId: string | null
  items: BudgetItem[]
  withDates: boolean
  defaultCategory: string
  label: string
}) {
  const [rows, setRows] = React.useState<Row[]>(() =>
    items.map((it) => ({
      id: crypto.randomUUID(),
      category: it.category,
      subject: it.subject,
      value: it.amountCents ? (it.amountCents / 100).toFixed(0) : "",
      whenStart: it.whenStart ?? "",
      whenEnd: it.whenEnd ?? "",
    })),
  )
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  const totalCents = rows.reduce((s, r) => s + asCents(r.value), 0)

  function patch(id: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))
  }
  function add() {
    setRows((rs) => [
      ...rs,
      {
        id: crypto.randomUUID(),
        category: defaultCategory,
        subject: "",
        value: "",
        whenStart: "",
        whenEnd: "",
      },
    ])
  }
  function remove(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id))
  }

  function save() {
    const payload = rows
      .filter((r) => r.subject.trim() !== "" || asCents(r.value) > 0)
      .map((r) => ({
        category: r.category,
        subject: r.subject,
        whenLabel: "",
        amountCents: asCents(r.value),
        locationId,
        whenStart: withDates && r.whenStart ? r.whenStart : null,
        whenEnd: withDates && r.whenEnd ? r.whenEnd : null,
      }))
    setError(null)
    startTransition(async () => {
      const res = await saveBudgetItemsForScope({
        tripId,
        tripSlug,
        locationId,
        items: payload,
      })
      if (res.error) setError(res.error)
    })
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-[11px] text-foreground">
          € {(totalCents / 100).toFixed(0)}
        </span>
        <span className="ml-auto font-mono text-[12px] leading-none text-muted-foreground">
          {open ? "⌄" : "›"}
        </span>
      </button>

      {open ? (
        <div className="mt-1.5 space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-1.5">
              <Select
                value={r.category}
                onValueChange={(v: string) => patch(r.id, { category: v })}
              >
                <SelectTrigger className="w-32 font-mono text-[11px]">
                  <SelectValue>{r.category}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                value={r.subject}
                onChange={(e) => patch(r.id, { subject: e.target.value })}
                placeholder="What"
                className="min-w-0 flex-1 rounded-lg border border-clay bg-transparent px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              {withDates ? (
                <>
                  <input
                    type="date"
                    aria-label="Start date"
                    value={r.whenStart}
                    onChange={(e) => patch(r.id, { whenStart: e.target.value })}
                    className="rounded-lg border border-clay bg-transparent px-2 py-1.5 text-[11px] text-foreground focus:outline-none"
                  />
                  <input
                    type="date"
                    aria-label="End date"
                    value={r.whenEnd}
                    min={r.whenStart || undefined}
                    onChange={(e) => patch(r.id, { whenEnd: e.target.value })}
                    className="rounded-lg border border-clay bg-transparent px-2 py-1.5 text-[11px] text-foreground focus:outline-none"
                  />
                </>
              ) : null}
              <input
                type="number"
                inputMode="numeric"
                value={r.value}
                onChange={(e) => patch(r.id, { value: e.target.value })}
                placeholder="0"
                className="w-16 rounded-lg border border-clay bg-transparent px-2 py-1.5 text-right text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
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
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={add}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
            >
              + add cost
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-full border border-border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              save
            </button>
          </div>
          {error ? <p className="text-[11px] text-clay">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/trips/[slug]/budget-scope-editor.tsx"
git commit -m "feat(budget): BudgetScopeEditor (per-location / trip-wide cost editor)"
```

---

### Task 5: Wire budget into the itinerary tab

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`
- Modify: `src/app/trips/[slug]/page.tsx`

- [ ] **Step 1: Imports in `itinerary-tab.tsx`**

Add near the other local imports:

```tsx
import { BudgetScopeEditor } from "./budget-scope-editor"
import type { BudgetItem } from "@/lib/trips/budget-item-types"
```

- [ ] **Step 2: Add the `budgetItems` prop**

In the `ItineraryTab` props type, add:

```tsx
  budgetItems: BudgetItem[]
```

and add `budgetItems,` to the destructured parameters of `ItineraryTab`.

- [ ] **Step 3: Derive budget groupings**

Right after the line `const timeline = buildTimeline(locations, days)`, add:

```tsx
  const budgetByLoc = React.useMemo(() => {
    const m = new Map<string, BudgetItem[]>()
    for (const it of budgetItems) {
      if (!it.locationId) continue
      const arr = m.get(it.locationId)
      if (arr) arr.push(it)
      else m.set(it.locationId, [it])
    }
    return m
  }, [budgetItems])
  const tripWideItems = React.useMemo(
    () => budgetItems.filter((it) => !it.locationId),
    [budgetItems],
  )
  const plannedTotalCents = budgetItems.reduce((s, it) => s + it.amountCents, 0)
```

- [ ] **Step 4: Render the per-location editor inside each open location block**

Find this block (the end of an open location block) and insert the editor
after the `+ day` container's closing `</div>`:

```tsx
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )
            })}
```

Replace with:

```tsx
                      )}
                    </div>
                    <BudgetScopeEditor
                      tripId={tripId}
                      tripSlug={tripSlug}
                      locationId={group.key}
                      items={budgetByLoc.get(group.key) ?? []}
                      withDates={false}
                      defaultCategory="Accommodation"
                      label="Budget"
                    />
                  </div>
                ) : null}
              </div>
            )
            })}
```

- [ ] **Step 5: Render the Trip-wide section + planned total at the foot**

Find:

```tsx
          </>
        )}
        {active ? planningBlock : null}
      </div>
    </section>
```

Replace with:

```tsx
          </>
        )}
        <div className="border-t border-rule pt-3">
          <BudgetScopeEditor
            tripId={tripId}
            tripSlug={tripSlug}
            locationId={null}
            items={tripWideItems}
            withDates
            defaultCategory="Other"
            label="Trip-wide"
          />
          <div className="mt-3 flex items-baseline justify-between border-t border-rule pt-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Planned total
            </span>
            <span className="t-num font-mono text-[14px] text-foreground">
              € {(plannedTotalCents / 100).toFixed(0)}
            </span>
          </div>
        </div>
        {active ? planningBlock : null}
      </div>
    </section>
```

- [ ] **Step 6: Load budget items for the itinerary tab + pass them in (`page.tsx`)**

Change the budget-items entry in the `Promise.all` from:

```tsx
      activeTab === "budget" ? getBudgetItems(header.id) : Promise.resolve(null),
```

to:

```tsx
      activeTab === "budget" || activeTab === "itinerary"
        ? getBudgetItems(header.id)
        : Promise.resolve(null),
```

In the `<ItineraryTab ... />` JSX (the dated branch), add:

```tsx
              budgetItems={budgetItems ?? []}
```

- [ ] **Step 7: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx" "src/app/trips/[slug]/page.tsx"
git commit -m "feat(budget): budget woven into the itinerary (per-location + trip-wide)"
```

---

### Task 6: Remove the AI-off editor from the Budget tab

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx`
- Delete: `src/app/trips/[slug]/budget-item-list.tsx`

- [ ] **Step 1: Drop the import**

Remove this line from `budget-tab.tsx`:

```tsx
import { BudgetItemList } from "./budget-item-list"
```

- [ ] **Step 2: Drop the AI-off arm**

Replace:

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
          ) : null}
```

(`budgetItems` and the `BudgetItem` import stay — the drafter still uses them.)

- [ ] **Step 3: Delete the file**

```bash
git rm "src/app/trips/[slug]/budget-item-list.tsx"
```

- [ ] **Step 4: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: PASS (no unused-import or missing-module errors).

- [ ] **Step 5: Commit**

```bash
git add "src/app/trips/[slug]/budget-tab.tsx"
git commit -m "feat(budget): drop AI-off BudgetItemList (planning moved to itinerary)"
```

---

### Task 7: Migration apply, verification, docs

- [ ] **Step 1: Apply the migration to dev**

Paste `supabase/migrations/20260617000002_budget_item_dates.sql` into the
Supabase SQL editor and run it (dev). Prod later.

- [ ] **Step 2: Manual check**

Run `pnpm dev`, open a dated trip's Itinerary tab.
- Expand a location → a `Budget € … ›` line shows; expand it, add
  `Accommodation · Hotel · 330`, save → the location's budget total updates and
  the Planned total at the foot reflects it.
- Trip-wide section: add `Transport · Flights · 300` with a date, save → it
  appears in the Planned total.
- Editing one location's costs leaves other locations unchanged.
- Budget tab with AI off no longer shows the old editor; with AI on the drafter
  still works and its items appear on the itinerary.

- [ ] **Step 3: Update `docs/TODO.md`**

Add near the top (above the most recent dated entry):

```markdown
**Budget on the itinerary spine (Slice 1): shipped 2026-06-17.** Planned budget is now woven into the itinerary: each location has a tap-to-expand `BudgetScopeEditor` (category · subject · amount, dates inherited from the location), a Trip-wide section at the foot for place-less costs (with their own start/optional-end dates via new `when_start`/`when_end` columns, migration `20260617000002_budget_item_dates.sql`), and a Planned total. Scoped `saveBudgetItemsForScope` replaces one location (or the trip-wide set) and recomputes `planned_budget_cents`. Always available (not AI-gated). The AI-off `BudgetItemList` was removed from the Budget tab (drafter stays for AI-on). First slice of the planning-spine vision. Spec: `docs/superpowers/specs/2026-06-17-budget-on-itinerary-slice1-design.md`. Plan: `docs/superpowers/plans/2026-06-17-budget-on-itinerary-slice1.md`. **Migration pasted to dev; prod pending.**
```

- [ ] **Step 4: Update `docs/DECISIONS.md`**

Add a row under the table header:

```markdown
| **Budget planning lives on the itinerary spine (per-location + trip-wide), not a standalone editor; located items inherit location dates** | First slice of the planning-spine vision. Budget items already carry `location_id`, so weaving cost into the itinerary is mostly presentation. Located costs inherit their location's dates (no per-item picker); only trip-wide costs carry `when_start`/`when_end`. A scoped save keeps other locations untouched. The AI-off standalone editor is retired; the drafter stays until a later slice. | 2026-06-17 |
```

- [ ] **Step 5: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record budget-on-itinerary slice 1 (TODO + DECISIONS)"
```

---

## Self-Review

**Spec coverage:**
- Migration `when_start`/`when_end` → Task 1.
- Types + query dates → Task 2.
- `saveBudgetItemsForScope` (scoped replace + total recompute) → Task 3.
- `BudgetScopeEditor` (collapsible, category/subject/amount, dates when trip-wide, explicit save) → Task 4.
- Itinerary integration (per-location inside open block, trip-wide + planned total at foot, page loads/threads items) → Task 5.
- Budget tab removes `BudgetItemList` (deleted) → Task 6.
- Migration apply + verification + docs → Task 7.
All spec sections map to a task.

**Placeholder scan:** No TBD/"handle edge cases"; every code step shows full code.

**Type consistency:** `BudgetItem` gains `whenStart`/`whenEnd` (Task 2) used in `BudgetScopeEditor` (Task 4) and the itinerary memos (Task 5). `SaveBudgetItemInput.whenStart/whenEnd` are optional (Task 3), set by `BudgetScopeEditor.save` (Task 4); the drafter's existing `saveBudgetItems` is unaffected. `saveBudgetItemsForScope`/`SaveScopeInput` (Task 3) match the call in Task 4. `BudgetScopeEditor` props (`tripId, tripSlug, locationId, items, withDates, defaultCategory, label`) match both call sites in Task 5. Categories match `EXPENSE_CATEGORIES`.

**Known limitation (acceptable for Slice 1):** each `BudgetScopeEditor` seeds local state once from `items`; after a save the `revalidatePath` refreshes server props but a mounted editor keeps its own (correct, just-saved) state. A partner's concurrent change shows after navigation/refresh, not live — no realtime in this slice (consistent with the spec's "out of scope").
