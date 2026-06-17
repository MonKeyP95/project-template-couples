# Slice 1 — Budget on the itinerary spine — design

**Date:** 2026-06-17
**Status:** Approved (pending spec review)
**Vision:** `docs/superpowers/specs/2026-06-17-planning-spine-vision.md` (Slice 1)

## Goal

Weave the planned budget into the itinerary (the planning spine): each
location shows a slim planned total and a tap-to-expand cost editor; costs that
belong to no place live in a Trip-wide section with their own dates; a planned
total sits at the foot. Always available, regardless of the AI toggle.

## Decisions (from brainstorming)

- **Always available** — not gated by the AI toggle; manual planning. The
  assistant only assists later (separate slice).
- **Located items inherit the location's dates** — no per-item date field.
- **Trip-wide items carry their own date** — a start + optional end (single or
  range), since they have no location to inherit from.
- **Explicit save**, scoped per location (or the trip-wide set). Planning phase;
  auto-save is for the during phase (Slice 3).
- **Budget tab:** remove the AI-off `BudgetItemList` (planning moves here). Keep
  figures, by-location, ledger. The AI drafter stays for now (its own
  replace-all path), reconciled in a later slice.

## Data

- **Migration** `20260617000002_budget_item_dates.sql` (idempotent): add
  `when_start date` and `when_end date` (both nullable) to `trip_budget_items`.
  Used only by trip-wide items; located items leave them null.
- `budget-item-types.ts`: `BudgetItem` gains `whenStart: string | null`,
  `whenEnd: string | null`; `BudgetItemRow` gains `when_start`, `when_end`;
  `rowToBudgetItem` maps them.
- `budget-item-queries.ts`: `getBudgetItems` selects the two new columns.

## Server action

`saveBudgetItemsForScope` in `actions.ts` — replace just one scope, then
recompute the trip total.

```ts
export interface SaveScopeInput {
  tripId: string
  tripSlug: string
  locationId: string | null   // null = the trip-wide bucket
  items: SaveBudgetItemInput[] // SaveBudgetItemInput gains whenStart/whenEnd
}
```

Behavior:
1. Validate each item (category in `EXPENSE_CATEGORIES`, `amountCents` valid).
2. Delete the scope's rows: `eq(trip_id)` plus `eq(location_id, locationId)` when
   set, or `is(location_id, null)` for trip-wide.
3. Insert the new rows, stamping `location_id = locationId`,
   `when_start`/`when_end` (trip-wide only; null for located),
   `sort_order` by index.
4. Recompute `trips.planned_budget_cents = sum(amount_cents)` over **all** the
   trip's items.
5. `revalidatePath('/trips/<slug>')`.

`SaveBudgetItemInput` gains `whenStart: string | null`, `whenEnd: string | null`.
The existing replace-all `saveBudgetItems` (used by the drafter) keeps working.

## UI

**`BudgetScopeEditor`** (`src/app/trips/[slug]/budget-scope-editor.tsx`,
`"use client"`) — one component for both a location and the trip-wide bucket.

Props: `{ tripId, tripSlug, locationId: string | null, items: BudgetItem[],
withDates: boolean, locations: ItineraryLocation[] }`.

- Collapsed: a slim line `Budget €<total> ›` (the scope's item sum).
- Expanded: rows of **category select · subject · amount** (`× ` to remove),
  `+ add cost`, and a **save** button. When `withDates` (trip-wide only), each
  row also has a **start** date + optional **end** date.
- Local row state seeded from `items` (ids via `crypto.randomUUID()`). Save calls
  `saveBudgetItemsForScope`; on success the `revalidatePath` refreshes props.
- Empty subjects with €0 are dropped on save (as in the current editor).
- Category select defaults: located → `Accommodation`, trip-wide → `Other`.

**Itinerary tab** (`itinerary-tab.tsx`): accept a `budgetItems: BudgetItem[]`
prop; group by `locationId`. Inside each expanded location block, render
`<BudgetScopeEditor locationId={group.key} items={byLoc[group.key]} withDates={false} … />`
and show the scope total on the location header line. At the foot of the
timeline, a **Trip-wide** section: `<BudgetScopeEditor locationId={null}
items={tripWide} withDates … />`, followed by a **Planned total** = sum of all
`budgetItems`.

**Trip page** (`page.tsx`): also fetch `getBudgetItems` for the itinerary tab
(currently budget-tab only) and pass `budgetItems` into `ItineraryTab`.

**Budget tab** (`budget-tab.tsx`): drop the AI-off branch's `BudgetItemList`
(delete the import + the `: ( <BudgetItemList … /> )` arm). With AI off the
Budget pill shows figures/by-location/ledger; with AI on the drafter still
renders. Delete `budget-item-list.tsx`.

## Verification

- `pnpm lint` + `pnpm build` clean.
- Migration pasted to dev.
- Itinerary tab: expand a location, add `Accommodation · Hotel · 330`, save →
  the location header total shows €330 and the spent-vs-planned figure's planned
  total updates.
- Trip-wide: add `Transport · Flights · 300` with a date, save → planned total
  includes it.
- Editing one location's costs leaves other locations untouched.
- Budget tab (AI off) no longer shows the old editor; the drafter still works
  with AI on and its output appears on the itinerary.

## Out of scope (later slices)

Buffer bar (2), during-trip expense→location auto-assign (3), packing
suggestions (4), retiring/moving the drafter + full IA cleanup (5), per-item
dates on located items, realtime sync of budget items.
