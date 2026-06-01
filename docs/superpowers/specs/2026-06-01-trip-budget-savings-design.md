# Trip / Dream Budget + Savings — Design

**Date:** 2026-06-01
**Status:** Approved (pre-implementation)

## Summary

Two related additions to every trip and dream:

1. **Editable budget.** A per-trip/dream planned budget the user can set and change. The budget tab already *renders* a planned budget (`€spent / €planned` + progress bar) when one exists, but the value is hardcoded in `src/lib/trips/fixtures.ts` (only Lombok). There is no `trips.planned_budget_cents` column, so every real trip/dream shows €0 planned with no way to set one.
2. **Saved-so-far tracker.** A shared running total of how much has been put aside toward the budget goal, shown as progress toward it (`€saved / €budget`, "X to go"). Distinct from *spent* (the expense ledger). Most meaningful for dreams (saving toward a someday-trip) but available on any trip.

Both values are **shared across the workspace** (one number per trip, both partners edit), matching how budget/packing/expenses already work. A dream is just a trip with `start_date = null`; both already render the Budget tab, so one implementation covers both.

## Decisions

- **Saved is a running total the user edits**, not accumulated contributions. Tap, type the new total, save. No deposit history.
- **Shared, not per-person.** One `saved_cents` per trip.
- **Two integer columns on `trips`**, not a separate table. Consistent with the existing schema; no new RLS needed (`trips` already has workspace-member policies).
- **Inline edit on the budget tab**, not on the edit-trip form. Both figures are tap-to-edit in the budget header.

## Data Model

Migration `supabase/migrations/20260601000001_trip_budget_savings.sql`, idempotent:

```sql
alter table trips add column if not exists planned_budget_cents int4 not null default 0;
alter table trips add column if not exists saved_cents          int4 not null default 0;

-- Preserve Lombok's existing €2,800 (previously hardcoded in fixtures.ts) so its
-- budget tab does not visibly regress once we stop reading the fixture value.
update trips set planned_budget_cents = 280000
where slug = 'lombok' and planned_budget_cents = 0;
```

- `planned_budget_cents` — the budget goal (feature 1).
- `saved_cents` — running total saved so far (feature 2).
- No new RLS: editing these columns is covered by the existing member-scoped `trips` policies.

## Read Path

**`src/lib/trips/queries.ts`**
- Add `plannedBudgetCents: number` and `savedCents: number` to the `TripHeader` interface and `TripRow`.
- Add `planned_budget_cents, saved_cents` to the `getTripBySlug` `select`.
- Map them in the returned object.

**`src/app/trips/[slug]/page.tsx`**
- Stop sourcing the planned budget from `detail` (the fixture). The fixture (`getTripDetailBySlug`) stays for weather only.
- Pass `plannedBudgetCents={header.plannedBudgetCents}` and new `savedCents={header.savedCents}` to `BudgetTab`.
- Right rail (`DesktopRightRail`): source budget from `header`; add a "Saved" progress row alongside the existing "Packing" / "Budget" rows in the Pre-trip section (data is already in scope — cheap).

## Write Path

**`src/lib/trips/actions.ts`** — one new server action:

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

export async function updateTripBudget(
  input: UpdateTripBudgetInput,
): Promise<UpdateTripBudgetResult>
```

- Builds a patch from whichever field(s) are present, so editing one figure never clobbers the other (no stale-overwrite of a value a partner just changed).
- Validates each present value: integer, `>= 0`, `< MAX_AMOUNT_CENTS` (reuse the existing int4 ceiling constant). Reject otherwise with `{ error }`.
- `update({ ... }).eq("id", tripId)` — RLS gates membership.
- `revalidatePath(\`/trips/${tripSlug}\`)`.
- Returns `{ error }` (inline form shape, like `updateExpense`).

## UI

### New client component — `src/app/trips/[slug]/budget-figures.tsx`

`"use client"`. Renders the two editable figures in the budget header. Per the client/types split rule, imports types from `*-types.ts` (not `*-queries.ts`); imports `updateTripBudget` from `actions.ts` (server action — safe).

Each figure is tap-to-edit:
- Display mode: the figure (`/ €YYYY` for budget, `€saved / €goal` for saved) with a faint ✎ affordance.
- Edit mode: a numeric input pre-filled with the current value; submit calls `updateTripBudget` with just that field; Esc/blur cancels.
- **Empty state (value is 0):** show a faint `+ set a budget` / `+ set savings` text button instead of the bar — guarantees a tappable entry point where today there is none.

### `src/app/trips/[slug]/budget-tab.tsx`

- `BudgetTabProps` gains `savedCents: number` (already has `plannedBudgetCents`).
- `BudgetHeader` uses `BudgetFigures` for the planned-budget figure (replacing the static `/ €{planned}` span) and gains a **"Saved so far"** block below the planned bar:

```
Budget · Lombok
€1,240.00 / €2,800   ✎          spent / budget goal      (feature 1)
████████░░  44% of planned · €1,560 left

Saved so far
€40 / €2,800   ✎                saved / goal             (feature 2)
███░░░░░░░  1% saved · €2,760 to go
```

- The saved bar shows a percentage only when `plannedBudgetCents > 0`; otherwise the saved figure is editable on its own with no bar.
- Identical rendering for trips and dreams.

## Out of Scope (later)

- Savings deposit history / itemized contributions (chosen: running total only).
- Surfacing budget/saved on `/home` trip cards or dream tiles.
- Currency other than EUR (the app is EUR-only today).

## Touched Files

| File | Change |
| --- | --- |
| `supabase/migrations/20260601000001_trip_budget_savings.sql` | New. Two columns + Lombok re-seed. |
| `src/lib/trips/queries.ts` | `TripHeader`/`TripRow` + select + mapping for both fields. |
| `src/app/trips/[slug]/page.tsx` | Source budget from `header`; pass `savedCents`; right-rail Saved row. |
| `src/lib/trips/actions.ts` | New `updateTripBudget` action. |
| `src/app/trips/[slug]/budget-figures.tsx` | New client component: inline-editable figures + empty states. |
| `src/app/trips/[slug]/budget-tab.tsx` | `savedCents` prop; wire `BudgetFigures`; "Saved so far" block. |
| `docs/DECISIONS.md` | Append row: `planned_budget_cents` + `saved_cents` columns added (supersedes the 2026-05-27 "hardcoded in fixtures" deferral). |
| `docs/TODO.md` | Mark task done. |
