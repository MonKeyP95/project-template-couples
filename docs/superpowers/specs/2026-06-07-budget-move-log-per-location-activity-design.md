# Budget-Move Log + Per-Location Activity

**Date:** 2026-06-07
**Status:** Approved design, pending implementation plan
**Builds on:** `2026-06-06-location-budget-envelopes-design.md` (per-location envelopes, the `move_location_budget` RPC, the `expenseLocationId` attribution).

## Summary

Two related additions to the budget tab:

1. **Budget-move log** — every budget move (cover / leftover transfer) is recorded
   as a distinct, dated entry, shown in the main ledger AND under the affected
   locations' bars. It is an allocation event, never counted as spend and never
   affecting settle-up.
2. **Per-location activity** — each location envelope expands to show that
   location's own ledger: its attributed expenses (reusing existing attribution)
   plus its budget moves. Pure derivation for the expense side — no change to the
   underlying expense model.

## Motivation

Today a budget move silently mutates `budget_cents` with no trace, and spend is
only ever visible as one flat trip-wide ledger. During a trip the couple wants
to see, per place, what was spent there and how its budget was rebalanced — in
real time as expenses are logged — without disturbing the single source-of-truth
ledger.

## Decisions (locked during brainstorming)

- A move is a **distinct budget-activity entry**: persisted, dated, excluded from
  spent total and settle-up.
- Move entries appear in **both** the main ledger and the affected locations'
  per-location activity.
- Per-location activity is **expandable per location** (tap the envelope), like
  the itinerary's collapsible location groups.
- Per-location expense rows **reuse the full editable LedgerRow** (edits flow to
  the one underlying expense).
- Deleted-location handling: **FK `ON DELETE SET NULL`**; a deleted endpoint
  renders as "Unallocated" (accepted minor ambiguity, no extra columns).

## Data Model

One new table. Idempotent migration (`IF NOT EXISTS` / `DROP POLICY IF EXISTS`).

```sql
create table if not exists public.trip_budget_moves (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references public.trips(id) on delete cascade,
  from_location_id uuid references public.itinerary_locations(id) on delete set null,
  to_location_id   uuid references public.itinerary_locations(id) on delete set null,
  amount_cents     integer not null check (amount_cents > 0),
  created_by       uuid not null references auth.users(id) on delete restrict,
  created_at       timestamptz not null default now()
);

create index if not exists trip_budget_moves_trip_idx
  on public.trip_budget_moves (trip_id, created_at desc);

alter table public.trip_budget_moves enable row level security;
```

- `from_location_id` / `to_location_id` nullable: null = the **unallocated pool**
  (consistent with the move semantics). A since-deleted location also reads as
  null → rendered "Unallocated" (accepted).
- RLS mirrors `trip_savings_contributions`:
  - `select` to authenticated using `is_trip_workspace_member(trip_id)`.
  - `insert` with check `is_trip_workspace_member(trip_id) and created_by = auth.uid()`.
  - `delete` to authenticated using `is_trip_workspace_member(trip_id)` (for
    completeness; not exposed in the UI — see below).

No change to `expenses`, `itinerary_locations.budget_cents`, or `trips`.

## Recording a Move (atomic, in the RPC)

The existing `move_location_budget(p_trip_id, p_from, p_to, p_amount)` RPC is
extended (`create or replace`) so that, after the validated debit/credit and in
the **same transaction**, it inserts the log row:

```sql
insert into public.trip_budget_moves
  (trip_id, from_location_id, to_location_id, amount_cents, created_by)
values
  (p_trip_id, p_from, p_to, p_amount, auth.uid());
```

So the log can never disagree with the actual budget change: an invalid move
(insufficient source, etc.) raises and rolls back, logging nothing. `auth.uid()`
is available inside the SECURITY INVOKER function under the caller's JWT. No new
RPC parameter, no action-layer change beyond what already calls the RPC.

## Reads

New `getTripBudgetMoves(tripId): Promise<BudgetMove[]>` in a query module
(`budget-move-queries.ts`), selecting
`id, trip_id, from_location_id, to_location_id, amount_cents, created_by, created_at`
ordered by `created_at desc`, mapped to camelCase. The trip page loads it for the
budget tab (same `Promise.all` pattern as expenses/savings, gated to the budget
tab) and threads it into `BudgetTab`.

## Types (pure)

In `location-budget-types.ts` (or a sibling `budget-move-types.ts` if the file
grows too large — implementer's call), add:

```ts
export interface BudgetMove {
  id: string
  tripId: string
  fromLocationId: string | null
  toLocationId: string | null
  amountCents: number
  createdBy: string
  createdAt: string
}
```

Plus pure helpers:
- `expensesForLocation(expenses, dayMap, locationId): Expense[]` — the expenses
  whose `expenseLocationId` equals `locationId` (or unassigned when `locationId`
  is null).
- `movesForLocation(moves, locationId): { move: BudgetMove; signedCents: number }[]`
  — moves where this location is `from` (negative) or `to` (positive).

## Main Ledger (#2)

`Ledger` merges expenses + moves into one list sorted by `createdAt` descending,
rendering:
- expenses via the existing editable `LedgerRow` (unchanged), and
- moves via a new read-only `BudgetMoveRow`: a date chip (from `createdAt`), a
  label *"Moved €X · {from} → {to}"* (names resolved from the in-scope
  `locations`; null → "Unallocated"), and a muted "budget" marker so it reads
  distinctly from an expense.

Move rows have **no edit/delete** (deleting an audit line would not reverse the
budget; undo = make the opposite move). Moves are absent from `summarizeBudget`
inputs, so spent total and settle-up are untouched by construction.

## Per-Location Activity (#3 + #2)

`EnvelopeRow` gains a local `expanded` toggle (like its existing `moving` state);
tapping the row body toggles it. Expanded, it renders that location's activity,
date-sorted desc:
- attributed **expenses** via the full editable `LedgerRow`;
- **budget moves** via a signed line: destination *"+€55 from Hokkaido"*, source
  *"−€55 to Tokyo"*.

The "Unassigned" bucket is also expandable (its expenses only; moves never
involve Unassigned — the pool is distinct from the Unassigned attribution
bucket).

To render editable rows, `BudgetByLocation` gains a `members` prop (passed from
`BudgetTab`), and receives the `moves` list. It already has `expenses` and
`itineraryDays` (hence the `dayMap`).

## Components / Units

- `supabase/migrations/<date>_budget_moves.sql` — table + RLS + `create or
  replace move_location_budget` with the log insert.
- `lib/trips/budget-move-types.ts` (or extend `location-budget-types.ts`) —
  `BudgetMove` + the two pure helpers.
- `lib/trips/budget-move-queries.ts` — `getTripBudgetMoves`.
- `app/trips/[slug]/budget-move-row.tsx` — the read-only move row (shared by the
  main ledger and, in signed form, per-location). The signed per-location line
  may be a small variant/prop rather than a second component.
- Modify: `budget-tab.tsx` (thread `moves` + `members`; merge into `Ledger`),
  `budget-by-location.tsx` (`members` + `moves` props; expandable `EnvelopeRow`
  reusing `LedgerRow`), `page.tsx` (load moves for the budget tab).

## Edge Cases

- **Pool endpoints**: a move to/from the unallocated pool stores null on that
  side and renders "Unallocated" — correct.
- **Deleted location**: its old move entries show the endpoint as "Unallocated"
  (accepted). Its attributed expenses revert to date/Unassigned per existing
  attribution; its envelope disappears with the row.
- **Many expenses**: per-location lists are collapsed by default, so the tab
  stays scannable.
- **No moves / no expenses for a location**: expanded view shows an empty/quiet
  state; the toggle still works.
- **Settlements**: already excluded from spend; unaffected here.

## Deliberately Not Doing (YAGNI)

- No change to the underlying expense model or the main ledger's expense rows.
- No deletion/editing of budget-move entries.
- No snapshot of location names on moves (FK + set null instead).
- No month-view change (Month grouping stays expenses-only insight).
- No per-bucket settle-up.

## Testing

No test runner in the repo (do not add one). The pure helpers
(`expensesForLocation`, `movesForLocation`) are the natural future unit-test
seam. Until then: `pnpm build` + `pnpm lint` per increment, and manual in-app
verification on a real trip (log expenses across locations, make a cover and a
leftover move, confirm: the move appears in the main ledger and under both
locations with correct signs, spent total + settle-up unchanged, and expanding a
location shows its expenses editable in place).
