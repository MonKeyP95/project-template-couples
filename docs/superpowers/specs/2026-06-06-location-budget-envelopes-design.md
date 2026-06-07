# Location-Bucketed Budget Envelopes

**Date:** 2026-06-06
**Status:** Approved design, pending implementation plan

## Summary

Extend the existing budget tab so the single trip budget can be broken down
into **per-location envelopes** (a target per place), with each expense
**automatically attributed** to a location by its date, an **explicit
location tag** override, a **Move budget** operation to rebalance targets
between envelopes, and a **Location | Month** toggle for grouping the same
spend two ways.

No second tab. Everything lives in the budget tab that already works.

## Motivation

Today a trip has one `plannedBudgetCents` and one flat spend total. For trips
that span several places (and the trip shape varies from two weeks to several
months), the couple wants to budget and track *per place*: "Bali 500, Thailand
800," see burn-down per place, and shuffle leftover budget around as the trip
unfolds. The itinerary is already location-organized and expenses already carry
a date, so most of this can be **derived** rather than re-entered.

## Decisions (locked during brainstorming)

- **Approach: per-location envelopes** (targets + burn-down), not just grouping
  and not a first-class bucket table. One small schema add, reuse the location
  entity.
- **Both axes, location primary.** Location view is default; a toggle re-buckets
  the same expenses by calendar month. Month view is **insight-only** (no month
  targets) — months are not real entities the way locations are.
- **Allocation rollup.** The existing top-line `plannedBudgetCents` stays as the
  master. Location targets are slices of it. UI shows allocated vs unallocated.
- **Move budget** can send/pull between **locations and the unallocated pool**.
- **Going over budget is fine** — never an error. Over shows as a negative
  ("over") figure on the location and can be covered via Move.
- **Manual location tag** on an expense overrides date-based attribution.

## Data Model

Two nullable column additions. No new tables. Migrations idempotent
(`IF NOT EXISTS` / `DROP ... IF EXISTS`), per repo convention.

```sql
-- Per-location budget target. Null = no target set (not counted as allocated).
alter table public.itinerary_locations
  add column if not exists budget_cents integer
  check (budget_cents is null or budget_cents > 0);

-- Explicit location tag on an expense. Null = attribute by date.
-- ON DELETE SET NULL: deleting a location reverts its expenses to auto, never errors.
alter table public.expenses
  add column if not exists location_id uuid
  references public.itinerary_locations(id) on delete set null;
```

- `trips.planned_budget_cents` (master top-line): **unchanged**.
- Savings: **unchanged**.
- Settlements: still excluded from spend, exactly as today.

RLS: both columns sit on tables that already have row-level security gated by
trip → workspace membership. No new policies needed; existing
update/select policies cover the new columns.

## Attribution (pure, derived)

A pure function assigns each **non-settlement** expense to one bucket. Priority:

1. **Explicit tag** — `expense.location_id` is set → that location's envelope.
2. **Date-derived** — build a `dayDate → locationId` map from itinerary days
   (each day carries `locationId` + `dayDate`); look up `expense.dayDate`.
   A day filed under a location → that envelope.
3. **Unassigned** — no tag, and (no date / no matching itinerary day / a
   transit day with `locationId = null`).

Returns: per-location spend totals + an unassigned total. This is the only
place attribution logic lives; it is unit-testable in isolation and has no I/O.

Month attribution (for the Month view) is simpler: `expense.dayDate` → calendar
month; no date → an **"Undated"** group. Independent of location attribution.

## Allocation Rollup

- **Master** = `plannedBudgetCents`
- **Allocated** = sum of all location `budget_cents`
- **Unallocated** = master − allocated
  - Negative → "over-allocated" soft note (never blocks).
- **Unassigned spend** is shown drawing against the unallocated pool.

## Move Budget

One operation: **transfer an amount of budget from envelope A to envelope B**,
where either endpoint may be a location or the **unallocated pool** (the pool is
just "no counterpart" — moving to it lowers a location's target; moving from it
raises one).

- **Leftover case:** location target > spent → leftover. Move button:
  *"Move {leftover} from {location} → [destination]."* On confirm, source target
  −X, destination target +X (destination omitted when it's the pool).
- **Over case:** spent > target → negative "over" figure. Move button flips:
  *"Cover {over} for {location} → from [source]."* On confirm, this location
  target +X, source target −X (source omitted when it's the pool).

The leftover/overage pre-fills the amount; the user can edit it. A single server
action applies the two `budget_cents` updates together. Moving to/from the pool
touches only one location row.

## UI

All inside the existing budget tab. Headline (spent / planned) and "Saved so
far" are **unchanged**.

New **"Budget by location"** section between the headline area and the ledger:

- A small **Location | Month** segmented toggle (Location default).
- **Location view:** one row per itinerary location, in itinerary order:
  - name, burn-down bar (spent vs its target), `spent / target` figures,
    over-or-under amount.
  - inline **set/edit target** via the existing `AmountField` (replace variant).
  - **Move** affordance when there is a non-zero leftover or overage.
  - an **Unassigned** row for spend with no place.
  - a summary line: *"Allocated €1,300 of €2,000 · €700 unallocated."*
- **Month view:** the same expenses grouped by calendar month with spend-only
  subtotals (no targets). Undated expenses under an **"Undated"** group.

The **ledger** stays below, unchanged in structure. Each expense gains a
**Location** picker in the shared `ExpenseFields` form (used by both add and
inline edit): **"Auto (by date)"** default (`null`) plus each itinerary
location. Retagging an existing expense is therefore a one-tap inline edit.

New expenses default to **"Auto (by date)"** — only tagged when intended,
preserving today's behavior.

## Edge Cases

- **Location with no target:** shows spend + "+ set budget" affordance; not
  counted toward allocated.
- **No locations yet:** Location view shows just Unassigned (or a "build your
  itinerary" nudge); Month view still works.
- **Over-allocated** (allocated > master): soft warning text, never blocks.
- **Location deleted:** its expenses' `location_id` set to null (revert to auto);
  its `budget_cents` disappears with the row (allocated recomputes).
- **Settlements:** excluded from all spend totals, as today.

## Deliberately Not Doing (YAGNI)

- **No month targets.** The Month toggle is insight-only.
- **No per-bucket settle-up.** Settle-up stays trip-wide.
- **No new table.** Two nullable columns reuse existing entities.
- **No auto-suggested reallocation.** Move is always user-initiated.

## Components / Units

- `lib/trips/location-budget-types.ts` — pure attribution + rollup functions and
  their result types (no I/O, no `next/headers`); importable by client code per
  the `*-types.ts` split rule.
- `lib/trips/location-budget-queries.ts` — server-side fetch of locations with
  `budget_cents` (if not already joined where the tab loads its data).
- Server actions (in existing `lib/trips/actions.ts`): set a location target,
  move budget between envelopes, set an expense's `location_id`.
- `app/trips/[slug]/budget-by-location.tsx` — the new section (client): toggle,
  envelope rows, allocation summary, Move dialog. Reuses `AmountField` and `Bar`.
- `ExpenseFields` gains a Location picker prop; `logExpense` / expense update
  actions gain an optional `locationId`.

## Testing

There is no test runner in the repo yet; do not invent one. The attribution and
rollup functions are pure and the natural seam — if/when tests land, they go
there first. Until then, validate by building (`pnpm build`), running
(`pnpm dev`), and checking each increment against a real trip on a phone
viewport, per the repo working style.
