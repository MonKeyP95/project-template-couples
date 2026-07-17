# Pre-trip checklist — design

**Date:** 2026-07-17
**Status:** Approved, ready for planning

## Problem

The budget planner is a guided walk: per-location Accommodation/Food/Activities,
then trip-wide Transport and "Anything else", with AI pricing the gaps. It helps
you *think through* a trip. But a handful of **pre-departure costs** — flights,
travel insurance, visas/docs, medicine/vaccinations, gear — are known and fixed;
you don't need the assistant to imagine them. You just want to list them, put
amounts on them, and have them count toward the budget.

Today these are buried: flights inside Transport, insurance inside "Anything
else". Easy to forget, and they don't get a first pass before the location walk.

## What we're building

A small, always-visible **"Before you go"** card in the Budget tab, above
"Plan a budget". A fixed list of pre-trip cost slots you fill in — **no stepper,
no Generate, no LLM call**. Filled rows roll into the planned budget.

This is deliberately *not* part of the guided planner. The planner's job is
suggestion + AI pricing; this is a plain list to fill. Keeping them separate also
avoids the round-trip/collision problems that adding steps to the walk would
create.

### Out of scope

- No reminders / to-do / tick-off state (considered, cut — not a budget concern).
- No AI suggestions or pricing for this surface.
- No freq (once/times/daily), date pickers, or est./source marks. Plain amounts.
- No changes to the guided walk's steps.

## Data model

Reuse `trip_budget_items` with a **reserved category `"Pre-trip"`**. No new table,
no new column.

Each filled row saves as a budget item:

- `category = "Pre-trip"`
- `subject` = the slot label (e.g. "Flights / getting there") or the added row's typed subject
- `when_label` = the free-text note
- `amount_cents` = the price
- `location_id = null`

Consequences, all free:

- **Counts toward the budget.** `perCategoryRollup` unions categories dynamically
  (`budget-rollup-types.ts`), so a "Pre-trip" slice simply appears in planned-vs-actual.
- **Payable.** The existing `payBudgetItem` machinery works unchanged — a pre-trip
  cost can be marked paid, logging an expense with category "Pre-trip".
- **Ignored by the guided walk.** `STEP_BY_CATEGORY` has no "Pre-trip" mapping, so
  `savedRows()` in `budget-drafter.tsx` already skips these on reload. No collision.

### Why not a separate table

A separate `trip_pretrip_items` table would decouple the saves, but it's a
parallel system: `planned_budget_cents`, the rollup, and paid-tracking would each
need to learn to merge a second source. Reusing the reserved category keeps
pre-trip costs first-class everywhere with less plumbing. (Aligns with the repo's
"reuse existing systems, don't build parallel ones" principle.)

## Reserved-category guard (coexistence)

Because `"Pre-trip"` rows live in `trip_budget_items` alongside walk items, and two
existing save paths do bulk replaces, they must leave the reserved category alone.
Three surgical edits:

1. **`saveBudgetItems`** (`actions.ts`, the guided walk's Apply — currently deletes
   *all* rows then reinserts): add `.neq("category", "Pre-trip")` to its delete, and
   recompute the trip total by re-querying **all** rows (today it sums only the rows
   it inserted). → Applying a guided budget no longer wipes the checklist.

2. **`saveBudgetItemsForScope`** (`actions.ts`, the always-visible scope editors —
   replaces one location/trip-wide scope): add `.neq("category", "Pre-trip")` to its
   *existing-ids* query so a trip-wide (`location_id null`) save never sees or deletes
   pre-trip rows. Its total recompute already re-sums all rows, so no total change
   needed.

3. **`PlannedBudget`** (`budget-tab.tsx`): its trip-wide editor shows every
   `location_id === null` item, which would double-display pre-trip rows. Filter:
   `tripWide = budgetItems.filter(it => !it.locationId && it.category !== "Pre-trip")`.
   The planned total there still sums *all* items, so pre-trip stays counted, just
   not shown in that editor.

Net: `"Pre-trip"` is a slice only the new checklist manages; every other save path
steps around it.

## UI

New client component `pre-trip-checklist.tsx`, rendered as its own card in
`budget-tab.tsx` just above the "Plan a budget" card.

```
+- Before you go -------------------------------+
|                                               |
|  Flights / getting there                      |
|  Note (optional)                  EUR [ 420 ] |
|                                               |
|  Travel insurance                             |
|  Note (optional)                  EUR [  60 ] |
|                                               |
|  Docs & fees                                  |
|  Medicine / vaccinations                      |
|  Gear & equipment                             |
|                                               |
|  <custom row: subject>              [x]       |
|  Note (optional)                  EUR [  90 ] |
|                                               |
|  + add item                          [ Save ] |
|                              Pre-trip  EUR 480|
+-----------------------------------------------+
```

- **Row visual** mirrors the drafter's `renderRow` (subject line, note beneath,
  `EUR` amount on the right) — but stripped: no freq toggle, no date pickers, no
  est./source marks.
- **Five fixed slots**, always shown, in order: Flights / getting there ·
  Travel insurance · Docs & fees · Medicine / vaccinations · Gear & equipment.
  Their label is plain text (a known slot, not an editable input). Note + amount
  are fillable. **No `x`** — leave any blank; blanks are skipped on save.
- **Added rows** via `+ add item`: editable subject + note + amount, and these
  **do** get an `x` to remove (you added it, you can remove it).
- **Seeding / reload:** on load, read `budgetItems` where `category === "Pre-trip"`.
  Match saved items back to the five slots by subject (the slot label); matched
  items fill that slot's note/amount. Items whose subject matches no slot appear as
  added rows. If no pre-trip items exist yet, the five slots show empty.
- **Save** → new server action **`savePreTripItems`**: mirrors
  `saveBudgetItemsForScope`'s update-in-place (preserving each row's
  `paid_expense_id`), scoped to `category = "Pre-trip"`. Steps: update existing
  matched rows, insert new ones (client-provided id so a just-added cost is
  immediately payable), delete removed ones, then recompute the trip total across
  all items. A row is written only if it has an amount; a fixed slot with no
  amount (and no note) is skipped, and an added row with no subject and no amount
  is skipped. (A note without an amount is treated as empty and not written.)

## Both modes (planning vs on the road)

Pre-trip is inherently a planning-mode tool, but the card is available in both —
the Budget tab renders identically in each. No mode-specific behavior: on the road
it simply stands as the record of those pre-departure costs and remains payable.

## Touched files

- **New:** `src/app/trips/[slug]/pre-trip-checklist.tsx`
- **New action:** `savePreTripItems` in `src/lib/trips/actions.ts` (+ its input type)
- **Edit:** `src/lib/trips/actions.ts` — guard `saveBudgetItems` and
  `saveBudgetItemsForScope`
- **Edit:** `src/app/trips/[slug]/budget-tab.tsx` — render the card; filter
  `"Pre-trip"` out of `PlannedBudget`'s trip-wide editor
- **Docs:** append a row to `docs/DECISIONS.md`; update `docs/TODO.md`

No migration required.
