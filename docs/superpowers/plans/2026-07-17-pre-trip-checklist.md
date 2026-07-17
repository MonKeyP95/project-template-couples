# Pre-trip Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed "Before you go" list of pre-departure cost slots (flights, insurance, docs, medicine, gear) to the Budget tab that saves into the planned budget as a reserved `"Pre-trip"` category — no stepper, no LLM.

**Architecture:** Reuse `trip_budget_items` with a reserved `category = "Pre-trip"` (null location). A new `savePreTripItems` action manages only that slice (update-in-place to preserve paid links). Three existing bulk-save paths are guarded so they never touch the reserved category. A new client component renders the fixed five slots plus optional added rows, styled like the guided-question rows.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TypeScript, Supabase, Tailwind v4.

## Global Constraints

- No new table, no new column, no migration. Reserved category is `"Pre-trip"` (exact string, used verbatim in every task).
- Validation per increment is `pnpm lint` + `pnpm build`. There is no test harness — do NOT invent a test command.
- No emojis in code/logs. Sparse comments (WHY only). Short functions.
- Display currency with `€`; dates (none here) would be `en-GB`. No defensive/speculative code.
- Slot labels, exact order: `Flights / getting there`, `Travel insurance`, `Docs & fees`, `Medicine / vaccinations`, `Gear & equipment`.
- A row is written only if `amountCents > 0` AND `subject` is non-empty. Note-only rows are dropped.

---

### Task 1: Guard the reserved category in the two bulk-save paths

**Files:**
- Modify: `src/lib/trips/actions.ts` (`saveBudgetItems`, `saveBudgetItemsForScope`)

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change. Behavioural guarantee — `saveBudgetItems` and `saveBudgetItemsForScope` never delete rows whose `category === "Pre-trip"`, and both set `planned_budget_cents` to the sum of ALL current rows.

- [ ] **Step 1: Guard `saveBudgetItems` delete + recompute total from all rows**

In `saveBudgetItems`, the delete currently removes every row for the trip. Add the reserved-category guard:

```ts
  const { error: delErr } = await supabase
    .from("trip_budget_items")
    .delete()
    .eq("trip_id", input.tripId)
    .neq("category", "Pre-trip")
  if (delErr) return { error: delErr.message }
```

Then replace the total line (currently `const total = rows.reduce((sum, r) => sum + r.amount_cents, 0)`) so it counts the preserved pre-trip rows too:

```ts
  const { data: allRows } = await supabase
    .from("trip_budget_items")
    .select("amount_cents")
    .eq("trip_id", input.tripId)
  const total = (allRows ?? []).reduce((sum, r) => sum + (r.amount_cents as number), 0)
```

- [ ] **Step 2: Guard `saveBudgetItemsForScope` existing-ids query**

In `saveBudgetItemsForScope`, the existing-ids query selects every row in the scope. For the trip-wide (`location_id null`) scope that includes pre-trip rows. Exclude them so a scope save never sees or deletes them (its total recompute already re-sums all rows, so no total change needed):

```ts
  let existingQ = supabase
    .from("trip_budget_items")
    .select("id")
    .eq("trip_id", input.tripId)
    .neq("category", "Pre-trip")
  existingQ =
    input.locationId === null
      ? existingQ.is("location_id", null)
      : existingQ.eq("location_id", input.locationId)
```

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: compiles clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(budget): guard reserved Pre-trip category in bulk saves"
```

---

### Task 2: `savePreTripItems` server action

**Files:**
- Modify: `src/lib/trips/actions.ts` (add `SavePreTripItemsInput` + `savePreTripItems` near the other budget-save actions)

**Interfaces:**
- Consumes: existing `SaveBudgetItemInput` (has `id?`, `category`, `subject`, `whenLabel`, `amountCents`, `locationId`, …), existing `validCents`, `createClient`, `revalidatePath`.
- Produces:
  - `export interface SavePreTripItemsInput { tripId: string; tripSlug: string; items: SaveBudgetItemInput[] }`
  - `export async function savePreTripItems(input: SavePreTripItemsInput): Promise<{ error?: string }>`

- [ ] **Step 1: Add the input type and action**

Add after `saveBudgetItemsForScope`:

```ts
export interface SavePreTripItemsInput {
  tripId: string
  tripSlug: string
  items: SaveBudgetItemInput[]
}

/**
 * Replace the trip's "Pre-trip" budget items (the before-you-go checklist),
 * updating in place to preserve paid links, then recompute the planned total
 * across all items. No other category is touched.
 */
export async function savePreTripItems(
  input: SavePreTripItemsInput,
): Promise<{ error?: string }> {
  for (const it of input.items) {
    if (!validCents(it.amountCents)) {
      return { error: "Budget amount out of range." }
    }
  }

  const supabase = await createClient()

  const { data: existing, error: exErr } = await supabase
    .from("trip_budget_items")
    .select("id")
    .eq("trip_id", input.tripId)
    .eq("category", "Pre-trip")
  if (exErr) return { error: exErr.message }
  const existingIds = new Set((existing ?? []).map((r) => r.id as string))

  const keptIds = new Set<string>()
  let order = 0
  for (const it of input.items) {
    const fields: {
      id?: string
      trip_id: string
      category: string
      subject: string
      when_label: string
      amount_cents: number
      location_id: string | null
      when_start: string | null
      when_end: string | null
      sort_order: number
      estimated: boolean
      source_url: string | null
      price_unknown: boolean
    } = {
      trip_id: input.tripId,
      category: "Pre-trip",
      subject: it.subject.trim(),
      when_label: it.whenLabel.trim(),
      amount_cents: it.amountCents,
      location_id: null,
      when_start: null,
      when_end: null,
      sort_order: order++,
      estimated: false,
      source_url: null,
      price_unknown: false,
    }
    if (it.id && existingIds.has(it.id)) {
      const { error } = await supabase
        .from("trip_budget_items")
        .update(fields)
        .eq("id", it.id)
      if (error) return { error: error.message }
      keptIds.add(it.id)
    } else {
      if (it.id) fields.id = it.id
      const { error } = await supabase.from("trip_budget_items").insert(fields)
      if (error) return { error: error.message }
    }
  }

  const toDelete = [...existingIds].filter((id) => !keptIds.has(id))
  if (toDelete.length > 0) {
    const { error: delErr } = await supabase
      .from("trip_budget_items")
      .delete()
      .in("id", toDelete)
    if (delErr) return { error: delErr.message }
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

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(budget): savePreTripItems action for the before-you-go list"
```

---

### Task 3: `PreTripChecklist` component

**Files:**
- Create: `src/app/trips/[slug]/pre-trip-checklist.tsx`

**Interfaces:**
- Consumes: `savePreTripItems` + `SavePreTripItemsInput` (Task 2), `BudgetItem` type, `Label` from `@/components/together`.
- Produces:
  - `export interface PreTripChecklistProps { tripId: string; tripSlug: string; budgetItems: BudgetItem[] }`
  - `export function PreTripChecklist(props: PreTripChecklistProps)`

- [ ] **Step 1: Write the component**

```tsx
"use client"

import * as React from "react"

import { Label } from "@/components/together"
import { savePreTripItems } from "@/lib/trips/actions"
import type { BudgetItem } from "@/lib/trips/budget-item-types"

const PRE_TRIP_CATEGORY = "Pre-trip"

const SLOTS = [
  "Flights / getting there",
  "Travel insurance",
  "Docs & fees",
  "Medicine / vaccinations",
  "Gear & equipment",
] as const

function fmt(cents: number): string {
  return (cents / 100).toFixed(0)
}

function asCents(value: string): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

interface Row {
  id: string
  /** The saved item's id, when this row round-tripped from the budget. */
  itemId?: string
  subject: string
  note: string
  value: string
  /** A fixed slot's label is not editable; added rows are, and can be removed. */
  fixed: boolean
}

export interface PreTripChecklistProps {
  tripId: string
  tripSlug: string
  budgetItems: BudgetItem[]
}

export function PreTripChecklist({
  tripId,
  tripSlug,
  budgetItems,
}: PreTripChecklistProps) {
  const seq = React.useRef(0)
  const [rows, setRows] = React.useState<Row[]>(() => {
    const preTrip = budgetItems.filter((i) => i.category === PRE_TRIP_CATEGORY)
    const bySubject = new Map(preTrip.map((i) => [i.subject.trim(), i]))
    const used = new Set<string>()
    const fixed: Row[] = SLOTS.map((label) => {
      const it = bySubject.get(label)
      if (it) used.add(label)
      return {
        id: `pt-${seq.current++}`,
        itemId: it?.id,
        subject: label,
        note: it?.whenLabel ?? "",
        value: it && it.amountCents > 0 ? fmt(it.amountCents) : "",
        fixed: true,
      }
    })
    const added: Row[] = preTrip
      .filter((i) => !used.has(i.subject.trim()))
      .map((i) => ({
        id: `pt-${seq.current++}`,
        itemId: i.id,
        subject: i.subject,
        note: i.whenLabel,
        value: i.amountCents > 0 ? fmt(i.amountCents) : "",
        fixed: false,
      }))
    return [...fixed, ...added]
  })
  const [isPending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  function patch(id: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))
  }

  function addRow() {
    setRows((rs) => [
      ...rs,
      { id: `pt-${seq.current++}`, subject: "", note: "", value: "", fixed: false },
    ])
  }

  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id))
  }

  function save() {
    if (isPending) return
    setError(null)
    const items = rows
      .filter((r) => asCents(r.value) > 0 && r.subject.trim() !== "")
      .map((r) => ({
        id: r.itemId,
        category: PRE_TRIP_CATEGORY,
        subject: r.subject.trim(),
        whenLabel: r.note.trim(),
        amountCents: asCents(r.value),
        locationId: null,
      }))
    startTransition(async () => {
      const res = await savePreTripItems({ tripId, tripSlug, items })
      if (res.error) setError(res.error)
    })
  }

  const total = rows.reduce((s, r) => s + asCents(r.value), 0)

  return (
    <div className="border-t border-border px-5 pt-4 pb-4">
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-md border border-rule px-2.5 py-2">
            <div className="flex items-center gap-2">
              {row.fixed ? (
                <span className="min-w-0 flex-1 text-[13px] text-foreground">
                  {row.subject}
                </span>
              ) : (
                <input
                  type="text"
                  value={row.subject}
                  placeholder="What"
                  onChange={(e) => patch(row.id, { subject: e.target.value })}
                  disabled={isPending}
                  className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
                />
              )}
              {row.fixed ? null : (
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  disabled={isPending}
                  aria-label="Remove"
                  className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <input
                type="text"
                value={row.note}
                placeholder="Note (optional)"
                onChange={(e) => patch(row.id, { note: e.target.value })}
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
                  onChange={(e) => patch(row.id, { value: e.target.value })}
                  disabled={isPending}
                  className="t-num w-16 border-0 border-b border-border bg-transparent text-right text-[14px] text-foreground outline-none focus:border-foreground"
                />
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={addRow}
          disabled={isPending}
          className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
        >
          + add item
        </button>
        <div className="flex items-center gap-2">
          {error ? <span className="font-mono text-[9px] text-clay">{error}</span> : null}
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {isPending ? "…" : "save"}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-baseline justify-between border-t border-rule pt-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Pre-trip
        </span>
        <span className="t-num font-mono text-[14px] text-foreground">€{fmt(total)}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors. (Note: JSX `×` and `€` are string literals in expressions/text, not `//` comments — the React 19 comment-in-JSX gotcha does not apply.)

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/[slug]/pre-trip-checklist.tsx
git commit -m "feat(budget): PreTripChecklist before-you-go component"
```

---

### Task 4: Wire the card into the Budget tab

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

**Interfaces:**
- Consumes: `PreTripChecklist` (Task 3), existing `scopeKey` helper (already in this file), `budgetItems` prop (already passed).
- Produces: a "Before you go" card above "Plan a budget"; `PlannedBudget`'s trip-wide editor excludes `"Pre-trip"` rows.

- [ ] **Step 1: Import the component**

Add near the other local imports (with `BudgetDrafter`):

```tsx
import { PreTripChecklist } from "./pre-trip-checklist"
```

- [ ] **Step 2: Render the card above "Plan a budget"**

Insert this block immediately before the `{/* Plan a budget */}` card:

```tsx
      {/* Before you go */}
      <div className="mx-5 my-4 overflow-hidden rounded-xl border border-border bg-card">
        <div className="px-5 pt-4 pb-1">
          <Label>Before you go</Label>
        </div>
        <PreTripChecklist
          key={scopeKey(
            "pretrip",
            budgetItems.filter((i) => i.category === "Pre-trip"),
          )}
          tripId={tripId}
          tripSlug={tripSlug}
          budgetItems={budgetItems}
        />
      </div>
```

- [ ] **Step 3: Exclude Pre-trip rows from the trip-wide scope editor**

In `PlannedBudget`, change the `tripWide` line so pre-trip rows are not double-displayed in the trip-wide editor (the planned total below still sums all `budgetItems`, so pre-trip stays counted):

```tsx
  const tripWide = budgetItems.filter(
    (it) => !it.locationId && it.category !== "Pre-trip",
  )
```

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 5: Build**

Run: `pnpm build`
Expected: compiles clean.

- [ ] **Step 6: In-app verification**

Start `pnpm dev`, open a trip's Budget tab. Verify:
1. A "Before you go" card shows the five fixed slots above "Plan a budget".
2. Enter an amount on Flights (e.g. 420) and Insurance (60), add a note, press save. The Saved/planned total rises by 480; the slots persist on reload.
3. `+ add item`, type a subject + amount, save; it round-trips as an added row with an `×`.
4. The "Pre-trip" rows do NOT appear in the trip-wide scope editor under "Plan a budget", but ARE in the planned total.
5. Run the guided "Plan a budget" walk and Apply — the pre-trip rows survive (not wiped) and remain in the total.

- [ ] **Step 7: Commit**

```bash
git add src/app/trips/[slug]/budget-tab.tsx
git commit -m "feat(budget): show Before-you-go card in the Budget tab"
```

---

### Task 5: Docs

**Files:**
- Modify: `docs/DECISIONS.md` (append a row)
- Modify: `docs/TODO.md` (record completion)

**Interfaces:** none.

- [ ] **Step 1: Append a DECISIONS row**

Add a row capturing: pre-trip costs are a fixed list saved under a reserved `"Pre-trip"` budget category (no new table/migration); bulk-save paths are guarded to leave it alone. Match the file's existing row format.

- [ ] **Step 2: Update TODO**

Mark the pre-trip checklist done under the appropriate section, matching the file's format.

- [ ] **Step 3: Commit**

```bash
git add docs/DECISIONS.md docs/TODO.md
git commit -m "docs: record pre-trip checklist (reserved Pre-trip category)"
```

---

## Self-Review

**Spec coverage:**
- Reserved `"Pre-trip"` category, no table/column/migration → Tasks 1–2. ✓
- Three-touchpoint guard (saveBudgetItems, saveBudgetItemsForScope, PlannedBudget filter) → Tasks 1 & 4. ✓
- `savePreTripItems` update-in-place preserving paid links + total recompute across all rows → Task 2. ✓
- Fixed five slots, plain labels, no ×; added rows editable + × → Task 3. ✓
- Seed/round-trip by subject match; blanks (no amount) dropped → Task 3 (`seq` initializer + `save` filter). ✓
- Card above "Plan a budget"; remount-on-change via `scopeKey` → Task 4. ✓
- Both modes: no mode-specific behavior (card renders identically) → satisfied by default; nothing to build. ✓

**Placeholder scan:** none — every code step has full code; in-app checks are concrete.

**Type consistency:** `SavePreTripItemsInput`/`savePreTripItems` defined in Task 2 and consumed in Task 3; `PreTripChecklistProps` defined in Task 3 and consumed in Task 4; `PRE_TRIP_CATEGORY === "Pre-trip"` matches the guard strings in Tasks 1–2 and the filter in Task 4. ✓
