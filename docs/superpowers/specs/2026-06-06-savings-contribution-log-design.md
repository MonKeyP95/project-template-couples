# Savings contribution log — design

**Date:** 2026-06-06
**Status:** Approved, ready for implementation plan

## Problem

"Saved so far" is a single shared integer (`trips.saved_cents`). Anyone taps
`+ add` and it increments one anonymous pot — there is no record of who
contributed what. The user wants savings to track per-person contributions and
keep a dated log (who, how much, when), while the headline stays exactly as it
looks today.

## Goal

Turn "Saved so far" into a contribution log with per-person totals, surfaced via
progressive disclosure: the headline and progress bar are unchanged; the
breakdown and log appear only when you press to expand.

## Decisions

- **Contributions table, derived total.** A new `trip_savings_contributions`
  table is the single source of truth. The saved total is the SUM of its rows;
  `trips.saved_cents` is dropped. The headline, per-person cards, and log can
  never disagree.
- **Attribution: always the current user.** Each `+ add` credits whoever is
  logged in. No logging on a partner's behalf.
- **Delete only.** A contribution can be removed; amounts are not edited in place
  (delete and re-add). No realtime sync (revalidate like expenses).
- **Start fresh.** No migration of existing `saved_cents` values.
- **Disclosure: tap number expands; `+` adds.** Tapping the big saved number
  toggles the details panel. The existing `+` cue stays as the separate add
  control.

## Data model

New table, mirroring `expenses` RLS (access gated by trip -> workspace
membership):

```sql
create table if not exists public.trip_savings_contributions (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  user_id     uuid not null references auth.users(id),
  amount_cents integer not null,
  created_at  timestamptz not null default now()
);
```

- RLS enabled; select/insert/delete policies match the existing `expenses`
  policies (membership in the trip's workspace). No update policy — contributions
  are not edited.
- `trips.saved_cents` column is dropped.
- Migration is idempotent (`create table if not exists`, `drop column if
  exists`, policies via `drop policy if exists` then `create`).

## Derived total

Saved total = `SUM(amount_cents)` per trip, computed everywhere `saved_cents` is
read today:

- **Detail page** (`page.tsx`): fetch contributions via `getTripSavings`,
  compute total + per-user breakdown, pass down.
- **Home cards** (`list-queries.ts`): replace the `saved_cents` read with a
  per-trip sum over `trip_savings_contributions` for the listed trips.
- **`queries.ts` / `TripHeader`**: drop `savedCents`; the page derives it.

Data scale is tiny (a couple's handful of trips/contributions), so summing in the
query layer is fine — no view, no cached column.

## Server actions (`lib/trips/actions.ts`)

- `addSavingsContribution({ tripId, tripSlug, amountCents })` — inserts one row
  credited to the current user (`auth.getUser()`), validates `amountCents` with
  the existing `validCents`, `revalidatePath`.
- `deleteSavingsContribution(contributionId, tripSlug)` — deletes one row,
  `revalidatePath`.
- `updateTripBudget` — remove the `savedCents` branch; it handles planned budget
  only.

## Query / type modules

- `savings-queries.ts`: `getTripSavings(tripId)` ->
  `{ contributions: SavingsContribution[]; totalCents: number; perUser: Record<string, number> }`.
  Server module (uses `next/headers` via the Supabase server client).
- `savings-types.ts`: client-importable `SavingsContribution` interface and a
  pure `summarizeSavings(contributions, memberIds)` helper returning
  `{ totalCents, perUser }`. Client components import types from here, not from
  `savings-queries.ts` (per the client/`*-types` split rule).

`SavingsContribution`:

```ts
interface SavingsContribution {
  id: string
  tripId: string
  userId: string
  amountCents: number
  createdAt: string
}
```

## UI (`budget-figures.tsx`)

The "Saved so far" block changes; the planned-budget block above it is untouched.

- Headline "Saved so far" + moss progress bar: **unchanged layout**, total now =
  derived sum.
- The `+` cue stays as the add control. It calls `addSavingsContribution`
  (still feels additive — each submit logs one contribution by the current user).
- Tapping the **big saved number** toggles an inline details panel below the bar.
- Details panel:
  - **Per-person cards** — Avatar + display name + that member's summed
    contribution. Rendered for 2-member trips, styled like the expense "paid"
    cards (`SplitBreakdown`).
  - **Contribution log** — one row per contribution: date - contributor avatar -
    amount - `×` delete. Styled like `LedgerRow`, lighter. Delete confirms then
    calls `deleteSavingsContribution`.

The panel needs the contributions list, per-user totals, and member tone/avatar
data, so `BudgetFigures` gains `contributions`, `perUser`, and `members` props
(threaded from `BudgetTab` / page, same as the expense ledger gets them).

## Out of scope

- Editing a contribution's amount (delete + re-add instead).
- Realtime sync (revalidate on the server action, like expenses).
- Logging a contribution on a partner's behalf.
- Migrating existing `saved_cents` data.

## Files touched

- `supabase/migrations/<new>.sql` — create table + RLS, drop `saved_cents`.
- `src/lib/trips/savings-queries.ts` — new.
- `src/lib/trips/savings-types.ts` — new.
- `src/lib/trips/actions.ts` — add/delete actions; trim `updateTripBudget`.
- `src/lib/trips/queries.ts` — drop `savedCents` from `TripHeader`.
- `src/lib/trips/list-queries.ts` — derive per-trip saved total.
- `src/app/trips/[slug]/page.tsx` — fetch savings, derive total, thread props.
- `src/app/trips/[slug]/budget-tab.tsx` — thread savings props.
- `src/app/trips/[slug]/budget-figures.tsx` — expand panel, per-person, log.
- `src/app/home/trip-cards.tsx` — consume derived saved total (if shape changes).
