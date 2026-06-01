# Trip / Dream Budget + Savings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users set/edit a planned budget on any trip or dream, and track a shared running total of how much has been saved toward it — both inline-edited on the budget tab.

**Architecture:** Two integer columns on `trips` (`planned_budget_cents`, `saved_cents`), both shared across the workspace and covered by existing `trips` RLS. The planned budget stops being read from the `fixtures.ts` hardcode and is sourced from the trip row. One server action writes either field; one new client component (`BudgetFigures`) renders both figures as tap-to-edit values in the budget header.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), TypeScript, Supabase Postgres + RLS, Tailwind v4. No test suite in this repo — each task is verified with `pnpm build`, `pnpm lint`, and a concrete manual browser check (the project's actual verification loop).

> **Spec:** `docs/superpowers/specs/2026-06-01-trip-budget-savings-design.md`
>
> **No-emoji note:** Per `CLAUDE.md`, no emoji glyphs in source. The edit affordance from the mockup (✎) is rendered as a faint mono `edit` text cue, matching the existing `// edit trip` affordance — not a pencil character.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260601000001_trip_budget_savings.sql` | **New.** Adds the two columns (idempotent) + re-seeds Lombok's €2,800. |
| `src/lib/trips/queries.ts` | **Modify.** Surface both fields on `TripHeader` from `getTripBySlug`. |
| `src/lib/trips/actions.ts` | **Modify.** New `updateTripBudget` server action. |
| `src/app/trips/[slug]/budget-figures.tsx` | **New.** `"use client"` — inline-editable budget + saved figures with empty states. |
| `src/app/trips/[slug]/budget-tab.tsx` | **Modify.** Accept `savedCents`; render `BudgetFigures` in the header. |
| `src/app/trips/[slug]/page.tsx` | **Modify.** Source budget from `header`; pass `savedCents`; right-rail Saved row. |
| `docs/DECISIONS.md`, `docs/TODO.md` | **Modify.** Record the decision + mark the task done. |

---

## Task 1: Migration — add columns + re-seed Lombok

**Files:**
- Create: `supabase/migrations/20260601000001_trip_budget_savings.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Trip-level planned budget + saved-so-far running total.
-- Both shared across the workspace; covered by existing trips RLS policies.
-- Idempotent: safe to paste-and-run multiple times.

alter table public.trips
  add column if not exists planned_budget_cents integer not null default 0;

alter table public.trips
  add column if not exists saved_cents integer not null default 0;

-- Preserve Lombok's previously-hardcoded €2,800 (was in src/lib/trips/fixtures.ts)
-- so its budget tab does not visibly regress once we stop reading the fixture.
update public.trips
  set planned_budget_cents = 280000
  where slug = 'lombok' and planned_budget_cents = 0;
```

- [ ] **Step 2: Apply the migration to Supabase**

Run the file's SQL in the Supabase SQL editor (or via the project's apply workflow). Then **paste-and-run it a second time** to confirm idempotency — it must succeed with no error and not double-apply (the `UPDATE` is a no-op on the second run because `planned_budget_cents` is already 280000).

Expected: both runs succeed; `select slug, planned_budget_cents, saved_cents from trips;` shows `lombok = 280000`, all others `0` for budget and `0` for saved.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260601000001_trip_budget_savings.sql
git commit -m "feat(budget): add trips.planned_budget_cents + saved_cents columns"
```

---

## Task 2: Surface both fields on `TripHeader`

**Files:**
- Modify: `src/lib/trips/queries.ts`

- [ ] **Step 1: Add the fields to the `TripHeader` interface**

In `src/lib/trips/queries.ts`, add to `interface TripHeader` (after `lng`):

```ts
  lng: number | null
  /** Planned budget goal in cents (0 = unset). */
  plannedBudgetCents: number
  /** Shared running total saved toward the budget, in cents. */
  savedCents: number
  /** 1-based position within the workspace's trip list, ordered by start_date. */
  index: number
```

- [ ] **Step 2: Add the columns to `TripRow` and the select**

In `interface TripRow`, add after `lng`:

```ts
  lng: string | number | null
  planned_budget_cents: number
  saved_cents: number
```

In `getTripBySlug`, extend the `tripQuery` select string to include the two columns:

```ts
    .select(
      "id, workspace_id, slug, name, country, start_date, end_date, fuzzy_when, lat, lng, planned_budget_cents, saved_cents",
    )
```

- [ ] **Step 3: Map them in the returned object**

In the `return { ... }` of `getTripBySlug`, add after `lng`:

```ts
    lat: asNumber(trip.lat),
    lng: asNumber(trip.lng),
    plannedBudgetCents: trip.planned_budget_cents,
    savedCents: trip.saved_cents,
    index,
    total,
```

- [ ] **Step 4: Verify build + lint**

Run: `pnpm build` then `pnpm lint`
Expected: both pass. `TripHeader` now carries both fields (not yet consumed — fine).

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/queries.ts
git commit -m "feat(budget): surface planned_budget_cents + saved_cents on TripHeader"
```

---

## Task 3: `updateTripBudget` server action

**Files:**
- Modify: `src/lib/trips/actions.ts`

- [ ] **Step 1: Add the action**

Append to `src/lib/trips/actions.ts`. It reuses the existing module-level `MAX_AMOUNT_CENTS` constant. Only the field(s) present in the input are written, so editing one figure never clobbers the other.

```ts
export interface UpdateTripBudgetInput {
  tripId: string
  tripSlug: string
  plannedBudgetCents?: number
  savedCents?: number
}

export interface UpdateTripBudgetResult {
  error?: string
}

function validCents(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < MAX_AMOUNT_CENTS
}

/**
 * Sets the trip's planned budget and/or saved-so-far total. Both are shared
 * workspace values; RLS gates membership. Only the provided field(s) are
 * written, so a one-figure edit never overwrites the other.
 */
export async function updateTripBudget(
  input: UpdateTripBudgetInput,
): Promise<UpdateTripBudgetResult> {
  const patch: { planned_budget_cents?: number; saved_cents?: number } = {}

  if (input.plannedBudgetCents !== undefined) {
    if (!validCents(input.plannedBudgetCents)) {
      return { error: "Budget out of range." }
    }
    patch.planned_budget_cents = input.plannedBudgetCents
  }

  if (input.savedCents !== undefined) {
    if (!validCents(input.savedCents)) {
      return { error: "Saved amount out of range." }
    }
    patch.saved_cents = input.savedCents
  }

  if (Object.keys(patch).length === 0) return { error: "Nothing to update." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("trips")
    .update(patch)
    .eq("id", input.tripId)

  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}
```

- [ ] **Step 2: Verify build + lint**

Run: `pnpm build` then `pnpm lint`
Expected: both pass. (`MAX_AMOUNT_CENTS` is already defined at module scope around line 143.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(budget): add updateTripBudget server action"
```

---

## Task 4: `BudgetFigures` client component

**Files:**
- Create: `src/app/trips/[slug]/budget-figures.tsx`

- [ ] **Step 1: Write the component**

Tap-to-edit figures modeled on the `log-expense-row.tsx` state machine (`useState` + `useTransition`, Escape to cancel). `AmountField` is the shared single-value editor; `BudgetFigures` composes two of them with the surrounding formatting and bars. The edit affordance is a faint mono `edit` cue (no emoji glyph).

```tsx
"use client"

import * as React from "react"

import { Bar, Label } from "@/components/together"
import { updateTripBudget } from "@/lib/trips/actions"

function fmt(cents: number): string {
  return (cents / 100).toFixed(2)
}

function EditCue() {
  return (
    <span className="ml-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
      edit
    </span>
  )
}

function AmountField({
  valueCents,
  onSave,
  trigger,
}: {
  valueCents: number
  onSave: (cents: number) => Promise<{ error?: string }>
  trigger: React.ReactNode
}) {
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function open() {
    setValue(valueCents > 0 ? (valueCents / 100).toFixed(0) : "")
    setError(null)
    setEditing(true)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending) return
    const num = Number(value)
    if (!Number.isFinite(num) || num < 0) {
      setError("Enter a valid amount.")
      return
    }
    const cents = Math.round(num * 100)
    startTransition(async () => {
      const result = await onSave(cents)
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
        className="inline-flex items-baseline border-0 bg-transparent p-0 text-left"
      >
        {trigger}
        <EditCue />
      </button>
    )
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") setEditing(false)
      }}
      className="inline-flex items-center gap-1.5"
    >
      <span className="t-display text-[20px] text-muted-foreground">€</span>
      <input
        ref={inputRef}
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={isPending}
        className="t-num w-24 border-0 border-b border-border bg-transparent text-[20px] text-foreground outline-none focus:border-foreground"
      />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-full border-0 bg-foreground px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
      >
        {isPending ? "…" : "save"}
      </button>
      {error ? (
        <span className="font-mono text-[9px] text-clay">{error}</span>
      ) : null}
    </form>
  )
}

export interface BudgetFiguresProps {
  tripId: string
  tripSlug: string
  spentCents: number
  plannedBudgetCents: number
  savedCents: number
}

export function BudgetFigures({
  tripId,
  tripSlug,
  spentCents,
  plannedBudgetCents,
  savedCents,
}: BudgetFiguresProps) {
  const hasPlanned = plannedBudgetCents > 0
  const leftCents = Math.max(0, plannedBudgetCents - spentCents)
  const spentPct = hasPlanned
    ? Math.min(100, Math.round((spentCents / plannedBudgetCents) * 100))
    : 0
  const savedToGo = Math.max(0, plannedBudgetCents - savedCents)
  const savedPct = hasPlanned
    ? Math.min(100, Math.round((savedCents / plannedBudgetCents) * 100))
    : 0

  const savePlanned = (cents: number) =>
    updateTripBudget({ tripId, tripSlug, plannedBudgetCents: cents })
  const saveSaved = (cents: number) =>
    updateTripBudget({ tripId, tripSlug, savedCents: cents })

  return (
    <>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="t-display text-[22px] text-muted-foreground">€</span>
        <span className="t-display t-num text-[42px] leading-none text-foreground">
          {fmt(spentCents)}
        </span>
        <AmountField
          valueCents={plannedBudgetCents}
          onSave={savePlanned}
          trigger={
            hasPlanned ? (
              <span className="t-display text-[22px] text-muted-foreground">
                {" "}/ €{fmt(plannedBudgetCents)}
              </span>
            ) : (
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                + set a budget
              </span>
            )
          }
        />
      </div>

      {hasPlanned ? (
        <>
          <div className="mt-3">
            <Bar pct={spentPct} tone="sea" />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            <span>{spentPct}% of planned</span>
            <span>€{fmt(leftCents)} left</span>
          </div>
        </>
      ) : null}

      <div className="mt-5">
        <Label>Saved so far</Label>
        <div className="mt-1.5 flex items-baseline gap-1">
          <span className="t-display text-[18px] text-muted-foreground">€</span>
          <span className="t-display t-num text-[28px] leading-none text-foreground">
            {fmt(savedCents)}
          </span>
          <AmountField
            valueCents={savedCents}
            onSave={saveSaved}
            trigger={
              savedCents > 0 ? (
                hasPlanned ? (
                  <span className="t-display text-[18px] text-muted-foreground">
                    {" "}/ €{fmt(plannedBudgetCents)}
                  </span>
                ) : (
                  <span className="t-display text-[18px] text-muted-foreground" />
                )
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  + set savings
                </span>
              )
            }
          />
        </div>
        {hasPlanned && savedCents > 0 ? (
          <>
            <div className="mt-3">
              <Bar pct={savedPct} tone="moss" />
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
              <span>{savedPct}% saved</span>
              <span>€{fmt(savedToGo)} to go</span>
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Verify build + lint**

Run: `pnpm build` then `pnpm lint`
Expected: both pass. Component compiles but is not yet rendered anywhere.

> **Lint note (React 19):** none of the JSX text here starts with `//`, so no `{"..."}` wrapping is needed. The `{" "}` literals are intentional leading spaces before `/ €`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/trips/[slug]/budget-figures.tsx"
git commit -m "feat(budget): BudgetFigures inline-edit component"
```

---

## Task 5: Wire `BudgetFigures` into the budget tab + page

This task changes `budget-tab.tsx` (new `savedCents` prop, header renders `BudgetFigures`) **and** its only caller `page.tsx` in the same commit, so the prop contract stays consistent and the build stays green.

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx`
- Modify: `src/app/trips/[slug]/page.tsx`

- [ ] **Step 1: Import `BudgetFigures` in `budget-tab.tsx`**

At the top of `src/app/trips/[slug]/budget-tab.tsx`, add the import alongside the others:

```ts
import { BudgetFigures } from "./budget-figures"
```

- [ ] **Step 2: Add `savedCents` to `BudgetTabProps` and the component params**

In `BudgetTabProps` (after `plannedBudgetCents: number`):

```ts
  plannedBudgetCents: number
  savedCents: number
```

In the `BudgetTab({ ... })` destructure (after `plannedBudgetCents,`):

```ts
  plannedBudgetCents,
  savedCents,
```

- [ ] **Step 3: Drop the now-unused `leftCents` / `pct` and pass new props to `BudgetHeader`**

In the `BudgetTab` body, remove these lines (they move into `BudgetFigures`):

```ts
  const leftCents = Math.max(0, plannedBudgetCents - totalCents)
  const pct =
    plannedBudgetCents === 0
      ? 0
      : Math.min(100, Math.round((totalCents / plannedBudgetCents) * 100))
```

Replace the `<BudgetHeader ... />` call with:

```tsx
      <BudgetHeader
        tripId={tripId}
        tripSlug={tripSlug}
        tripName={tripName}
        spentCents={totalCents}
        plannedBudgetCents={plannedBudgetCents}
        savedCents={savedCents}
      />
```

- [ ] **Step 4: Rewrite `BudgetHeader` to render `BudgetFigures`**

Replace the entire `BudgetHeader` function with:

```tsx
function BudgetHeader({
  tripId,
  tripSlug,
  tripName,
  spentCents,
  plannedBudgetCents,
  savedCents,
}: {
  tripId: string
  tripSlug: string
  tripName: string
  spentCents: number
  plannedBudgetCents: number
  savedCents: number
}) {
  return (
    <div className="relative overflow-hidden bg-dusk-tint px-5 pt-6 pb-4">
      <TopoBg tone="sea" opacity={0.1} />
      <div className="relative">
        <Label>Budget · {tripName}</Label>
        <BudgetFigures
          tripId={tripId}
          tripSlug={tripSlug}
          spentCents={spentCents}
          plannedBudgetCents={plannedBudgetCents}
          savedCents={savedCents}
        />
      </div>
    </div>
  )
}
```

> After this, the local `fmt` in `budget-tab.tsx` is still used by `SettleUpCard` / `SplitBreakdown`, so leave it. `Bar` is no longer used directly in `budget-tab.tsx` — remove `Bar` from the `@/components/together` import to keep lint clean (verify in Step 7).

- [ ] **Step 5: Source budget from `header` and pass `savedCents` in `page.tsx`**

In `src/app/trips/[slug]/page.tsx`, update the `<BudgetTab .../>` props block. Replace:

```tsx
            plannedBudgetCents={detail?.plannedBudgetCents ?? 0}
            startDate={header.startDate}
```

with:

```tsx
            plannedBudgetCents={header.plannedBudgetCents}
            savedCents={header.savedCents}
            startDate={header.startDate}
```

- [ ] **Step 6: Source the right-rail budget from `header` and add a Saved row**

In `page.tsx`, update the `<DesktopRightRail .../>` `budget` prop. Replace:

```tsx
        budget={{
          spentCents: budgetSummary.expenseTotalCents,
          plannedCents: detail?.plannedBudgetCents ?? 0,
        }}
```

with:

```tsx
        budget={{
          spentCents: budgetSummary.expenseTotalCents,
          plannedCents: header.plannedBudgetCents,
        }}
        saved={{
          savedCents: header.savedCents,
          plannedCents: header.plannedBudgetCents,
        }}
```

Then update the `DesktopRightRail` signature and body. Change its props type from:

```tsx
function DesktopRightRail({
  detail,
  packing,
  budget,
}: {
  detail: TripDetail | null
  packing: { done: number; total: number }
  budget: { spentCents: number; plannedCents: number }
}) {
```

to:

```tsx
function DesktopRightRail({
  detail,
  packing,
  budget,
  saved,
}: {
  detail: TripDetail | null
  packing: { done: number; total: number }
  budget: { spentCents: number; plannedCents: number }
  saved: { savedCents: number; plannedCents: number }
}) {
```

Add the saved percentage next to the existing `budgetPct`:

```tsx
  const savedPct =
    saved.plannedCents === 0
      ? 0
      : Math.min(100, Math.round((saved.savedCents / saved.plannedCents) * 100))
```

And add a third `ProgressRow` directly after the Budget one inside the Pre-trip block:

```tsx
          <ProgressRow
            label="Saved"
            value={`€${(saved.savedCents / 100).toFixed(0)} / €${(saved.plannedCents / 100).toFixed(0)}`}
            pct={savedPct}
            tone="moss"
          />
```

- [ ] **Step 7: Verify build + lint**

Run: `pnpm build` then `pnpm lint`
Expected: both pass. If lint flags `Bar` as an unused import in `budget-tab.tsx`, remove it from the `@/components/together` import (Step 4 note). `TripDetail` is still imported/used in `page.tsx` (the right rail still takes `detail` for weather) — leave it.

- [ ] **Step 8: Manual browser check**

Run: `pnpm dev`, then:
1. Visit `http://localhost:3000/trips/lombok?tab=budget` — the planned figure reads `/ €2800.00` (from the DB column now, not the fixture), with the spent bar.
2. Tap the `edit` cue next to the budget → input appears → change it → `save` → the figure and bar update.
3. Under **Saved so far**, tap `+ set savings` → enter e.g. `40` → save → shows `€40.00 / €2800.00` with a moss bar and "X% saved · €… to go".
4. On a desktop-width window, the right rail shows a **Saved** progress row under Budget.
5. Open a **dream** from `/home` (no dates) → Budget tab → confirm both `+ set a budget` and `+ set savings` work the same way.

Expected: all edits persist across a refresh (server action + `revalidatePath`).

- [ ] **Step 9: Commit**

```bash
git add "src/app/trips/[slug]/budget-tab.tsx" "src/app/trips/[slug]/page.tsx"
git commit -m "feat(budget): editable budget + saved-so-far on the budget tab"
```

---

## Task 6: Docs

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/TODO.md`

- [ ] **Step 1: Append a DECISIONS row**

Add a row to the table in `docs/DECISIONS.md` (match the existing 3-column `| decision | rationale | date |` format):

```markdown
| **`planned_budget_cents` + `saved_cents` columns on `trips`** | Supersedes the 2026-05-27 "planned budget hardcoded in `fixtures.ts`" deferral. Budget is now editable per trip/dream; `saved_cents` is a shared running total toward it. Both shared, covered by existing `trips` RLS — no new table. | 2026-06-01 |
```

- [ ] **Step 2: Mark the TODO done**

In `docs/TODO.md`, add (or check off, if a matching line exists) under the appropriate section:

```markdown
- [x] Trip/dream editable budget + shared saved-so-far tracker (budget tab inline edit)
```

- [ ] **Step 3: Commit**

```bash
git add docs/DECISIONS.md docs/TODO.md
git commit -m "docs: record budget + savings columns; mark task done"
```

---

## Self-Review

**Spec coverage:**
- Feature 1 (editable budget): column (Task 1) → query (Task 2) → action (Task 3) → component (Task 4) → wired + sourced from header (Task 5). ✓
- Feature 2 (saved-so-far running total, shared): column (Task 1) → query (Task 2) → action (Task 3) → component + empty state (Task 4) → wired + right-rail row (Task 5). ✓
- Lombok re-seed: Task 1 Step 1. ✓
- Empty-state affordances (`+ set a budget` / `+ set savings`): Task 4. ✓
- Right-rail Saved row: Task 5 Step 6. ✓
- Docs (DECISIONS supersede + TODO): Task 6. ✓

**Placeholder scan:** No TBD/TODO-in-code/"handle errors" placeholders; every code step shows complete code. ✓

**Type consistency:** `plannedBudgetCents` / `savedCents` (camelCase, TS) and `planned_budget_cents` / `saved_cents` (snake_case, DB) used consistently. `updateTripBudget` input/return names match across Tasks 3–4. `BudgetFiguresProps` (Task 4) matches the props passed in Task 5 Step 4. `DesktopRightRail`'s new `saved` prop shape matches its call site (Task 5 Step 6). ✓
