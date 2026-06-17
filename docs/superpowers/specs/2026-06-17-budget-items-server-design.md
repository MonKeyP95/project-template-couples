# Server-backed budget line items — design

**Date:** 2026-06-17
**Status:** Approved (pending spec review)
**Depends on:** the AI-mode toggle (PR #59) — uses `useAiMode` and replaces the
interim `BudgetTotalField`.

## Problem

The budget's line items (the "Sea hotel · 3 days · 350" rows) live only in the
planning device's `localStorage`; the database stores only the total
(`trips.planned_budget_cents`). So the itemized list can't be viewed or edited
outside the AI drafter, isn't shared with the partner, and is lost when the
browser is cleared. In AI-off mode the budget collapses to a single editable
number. The user wants a real, shared, viewable/editable line-item list —
available with AI on or off.

## Decisions

- **Server-persisted, shared.** A new `trip_budget_items` table with RLS, so
  both partners see and edit the same list and it survives device changes.
- **Total = sum of items.** Editing an item updates the planned total.
  `trips.planned_budget_cents` is kept in sync (= sum) so every existing
  consumer (spent-vs-planned bar, by-location view, home/rail progress) keeps
  working unchanged.
- **Grouped by category.** Items sit under the five categories
  (Accommodation / Transport / Food / Activities / Other), each item being
  `subject` + `when` + `amount`, with an optional **place** (itinerary
  location) for Accommodation & Activities — mirroring the AI drafter so both
  modes share one shape.
- **Replace-all save.** Each save deletes the trip's rows and reinserts the
  current set (matches the drafter's existing Apply-replaces behavior; fine
  for a two-person budget; avoids granular merge/race logic).
- **Both modes write the same table.** A budget made with AI and one edited by
  hand are the same list.

## Data model

New table `public.trip_budget_items`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | `default gen_random_uuid()` |
| `trip_id` | uuid not null | `references trips(id) on delete cascade` |
| `category` | text not null | validated in the action against the expense categories |
| `subject` | text not null | e.g. "Sea hotel" |
| `when_label` | text not null default `''` | free text, e.g. "3 days" |
| `amount_cents` | integer not null default 0 | `>= 0` |
| `location_id` | uuid null | `references itinerary_locations(id) on delete set null` |
| `sort_order` | integer not null default 0 | order within a category |
| `created_by` | uuid not null default `auth.uid()` | |
| `created_at` | timestamptz not null default `now()` | |

- Index on `(trip_id, category, sort_order)`.
- **RLS** (all ops) via `is_trip_workspace_member(trip_id)` — any workspace
  member of the trip can read/write (not owner-gated; matches the other trip
  tables and avoids the prod owner-gating drift noted in memory).
- **No realtime.** The trip page's existing focus-refetch (`RefreshOnVisible`)
  syncs the partner; budget editing isn't live-collaborative like packing.
- Idempotent migration (table `if not exists`, drop-then-create policies),
  pasted into the Supabase SQL editor — dev first, prod later.

## Server layer

- `src/lib/trips/budget-item-types.ts` (pure): `BudgetItem`
  (`id, category, subject, whenLabel, amountCents, locationId, sortOrder`) and
  `rowToBudgetItem(row)`.
- `src/lib/trips/budget-item-queries.ts`: `getBudgetItems(tripId): BudgetItem[]`,
  ordered by category then `sort_order`.
- `saveBudgetItems({ tripId, tripSlug, items })` in `actions.ts`:
  1. Validate (category in the allowed set; `amount_cents` a non-negative
     integer within `MAX_AMOUNT_CENTS`; trim subject/when).
  2. Delete existing rows for `tripId`, insert the new set with `sort_order`
     per category.
  3. `updateTripBudget`-style write of `planned_budget_cents = sum(amount_cents)`
     on the trip.
  4. `revalidatePath('/trips/<slug>')`.
  Returns `{ error? }`.

## UI

**AI-off — `src/app/trips/[slug]/budget-item-list.tsx`** (`"use client"`,
replaces `BudgetTotalField`): renders items grouped under the five categories;
each row is `subject` / `when` / `amount` inputs plus, for Accommodation &
Activities, an optional place `<Select>` from the trip's `locations`. Add-row
per category, remove-row, a live running total, and a single **Save** calling
`saveBudgetItems`. Seeded from `getBudgetItems` (passed in as a prop from the
budget tab's server parent, or fetched — see Data flow).

**AI-on — `BudgetDrafter`** keeps its guided wizard UI but switches persistence
to the server: load via `getBudgetItems` (instead of `loadSavedItems`), Apply
via `saveBudgetItems` (instead of `localStorage` + `updateTripBudget`). The
drafter's bucket ids (`step.key` flat, or `step.key:locationId`) map to item
`{ category: step.key's category, location_id }`. `localStorage` plan storage
is removed.

**Budget tab** (`budget-tab.tsx`): the existing AI on/off branch becomes
`aiEnabled ? <BudgetDrafter…/> : <BudgetItemList…/>`; `BudgetTotalField` is
deleted. Both receive the trip's existing budget items.

## Data flow

1. The trip page (server) already loads budget data; add
   `getBudgetItems(tripId)` and pass `budgetItems` into `BudgetTab`, which
   hands them to whichever editor is shown.
2. Editor holds the list in local state; **Save** → `saveBudgetItems`
   (replace-all) → `planned_budget_cents` recomputed → `revalidatePath`
   refreshes figures.
3. Partner sees the updated list on next focus/refresh.

## Testing / verification

- `pnpm lint` + `pnpm build` clean.
- Migration pasted to dev; insert/select/update/delete gated by trip
  membership.
- AI off: list shows existing items (or empty per category), editing an amount
  and saving updates the spent-vs-planned bar; the planned total equals the
  item sum.
- AI on: running the drafter and applying writes items to the server; opening
  the AI-off list afterward shows the same items.
- Partner account sees the same list after refresh.

## Deferred

- Realtime sync of budget items (focus-refetch is enough for now).
- Per-item planned-vs-actual analytics (still out of scope — planning only).
- Migrating any existing device `localStorage` plans into the table (fresh
  start; the table is empty until first save).
- Reordering items across categories.
