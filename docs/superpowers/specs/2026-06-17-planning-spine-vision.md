# Planning spine: itinerary + budget + packing + assistant — vision & slices

**Date:** 2026-06-17
**Status:** Vision (decomposition). Each slice below gets its own spec → plan → build.

## Vision

A trip has two phases, and the app should be organized around them:

- **Plan** (before): the **itinerary is the spine**. Places and dates are the
  backbone; **budget is woven into it** (cost per place, inherited dates), and
  **packing is informed by it** but kept separate.
- **During** (on the road): you **log actual expenses where you are**, and
  settle up. Expenses auto-assign to your current location.

The **AI assistant** sits on top of both. When **on**, it does the connecting —
drafts/adjusts budget from the itinerary, suggests packing from activities,
flags gaps and over-spend. When **off**, the same data still flows between
itinerary and budget; you just do it by hand. (Suggest-only invariant holds.)

## What already exists (do not rebuild)

- Itinerary: locations with optional date spans, days, events, during-trip mode.
- **Budget items are already server-backed and location-linked** —
  `trip_budget_items` has `category` + `location_id` (shipped 2026-06-17). This
  is the data foundation for weaving budget into the itinerary.
- `BudgetByLocation` already derives spend per location (expense date → that
  day's itinerary location).
- `/on-the-road` page is the during-trip surface; active trips redirect to it.
- AI on/off toggle gates all assistant surfaces.

The recently shipped AI-off `BudgetItemList` (category-grouped editor) is
**interim**: its *data* (`trip_budget_items`) is kept, but its *presentation*
gets reshaped into the itinerary-woven view in Slice 1. The per-item date
picker we stopped designing is dropped for located items (they inherit location
dates) and kept only for trip-wide items.

## Confirmed decisions

- **Itinerary is the spine** of planning; budget woven in, packing separate.
- **Per-location budget = slim total on the location block, tap to expand** the
  cost list (inline add/edit). Located costs **inherit the location's dates**.
- **Trip-wide bucket** for costs not tied to a place (flights, food estimate,
  insurance). These have **no location to inherit from, so they carry their own
  date or range** — the only place a date picker appears.
- **During-trip expenses auto-assign to the current location** (the place
  today's itinerary day is in), with manual override.
- **Planned vs actual are distinct:** planned = `trip_budget_items`; actual =
  logged expenses. Both viewable per location.
- **Budget buffer %:** a per-trip percentage on top of the planned total
  (e.g. €100 +10% → €110 safety target). It **drives the spent-vs-planned bar**:
  the bar fills toward the buffered target with a **marker at the base**, so
  crossing the base into the buffer is visible.
- **Packing is itinerary-informed but separate:** stays its own list; the
  assistant (when on) suggests items from the itinerary (diving → wetsuit,
  crater night → warm layer). When off, it's a plain list.

## Slices (each shippable on its own, in order)

1. **Budget on the itinerary spine.** Each location block shows a slim planned
   total; tap to expand its cost list (add/edit/remove items, inherit location
   dates). A Trip-wide section at the foot for place-less costs, each with a
   date/range. Running planned total. Reuses `trip_budget_items`; reshapes the
   interim `BudgetItemList`. Standalone Budget tab's *plan* half folds in here.

2. **Budget buffer %.** Per-trip buffer percentage (small trip-level field).
   Drives the spent-vs-planned bar: fill to base+buffer, marker at base. Shown
   on the planning total and the figure.

3. **During-trip expense → location.** On the road, logging an expense
   auto-assigns the current location (from today's itinerary day), overridable.
   Make the existing date→location attribution explicit on the expense.

4. **Packing, itinerary-informed.** When AI is on, a suggestion line on the
   packing tab proposes items derived from the itinerary's activities/locations.
   Off = unchanged plain list.

5. **IA cleanup (gradual).** Settle the two-phase navigation: planning surfaces
   (itinerary spine + packing) vs during-trip (expenses + settle on
   `/on-the-road`). May land piecemeal across the slices above rather than as
   one move.

## Out of scope / deferred

- Per-location packing (packing stays whole-trip, itinerary-*informed* only).
- Per-location buffer (buffer is whole-trip).
- Real LLM wiring (assistant stays mock behind `lib/ai`; suggest-only).
- Planned-vs-actual analytics beyond the buffered bar + per-location view.

## Next step

Brainstorm **Slice 1** (budget on the itinerary spine) through the normal
design flow — its own spec, then plan, then build. The other slices follow
one at a time.
