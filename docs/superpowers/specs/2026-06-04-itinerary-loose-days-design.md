# Itinerary loose days + date-led cards — design

**Date:** 2026-06-04
**Status:** draft (awaiting user review)
**Scope:** dated trips only. Dreams (the separate `DreamItineraryTab`) are untouched.

## Problem / vision

Two changes to the dated itinerary, shipping together (both touch the same render):

1. **Loose days that float on the timeline.** Today every location-less day is forced into a single collapsible **"In transit"** group. A short trip with no locations ("3–4 days in one place") shouldn't have to create a location — its days should just appear on the timeline. Locations stay an optional grouping, not a requirement.
2. **Date-led day cards.** The day card's left rail currently leads with the trip ordinal (`DAY 10`), with the real date tucked tiny in the corner. Swap them: the rail shows the **calendar date**, the corner shows the trip ordinal (`day 10`).

## #2 — Date-led day card

The dated `DayView`'s left rail today shows `DAY / {d} / {dow}` (ordinal big), and the card header's top-right corner shows `{date}` ("12 Jun"). Swap:

- **Left rail:** day-of-month (big) / short month / weekday — e.g. `10 / JUN / WED`.
- **Corner:** `day {d}` — the trip-wide ordinal (unchanged meaning; `d` is already computed by `withOrdinals` across all the trip's days sorted by date, so it stays continuous across loose + located days).

The big rail number changes meaning from "trip day N" to "day-of-month", which can differ (a trip starting Jun 5 → day 1 is `5 JUN`). The ordinal is preserved in the corner.

**Data:** add two derived fields to `ItineraryDay`, set in `rowToItineraryDay` from `day_date` (UTC):
- `dom: string` — day-of-month, no padding (`"10"`).
- `mon: string` — short month, uppercased at the view (`"JUN"`).

`date` (the combined "12 Jun") stays for any other use. Dreams use `DreamDay` / `DreamItineraryTab` and are not touched — they keep `DAY N`.

## #1 — Loose days, interleaved (Scope B)

### Model

- A day with `location_id = null` is a **loose day** — it floats on the timeline at its own date, with no group header.
- The **"In transit" pseudo-group is removed.** The timeline becomes one **date-sorted sequence of items**, each either:
  - a **location block** — the existing collapsible group (header with `01/02…` number + name + range, body of day-segments + span empties), or
  - a **loose segment** — a bare day card, or a loose `group_id` "added together" trek box (location-less), rendered inline with no header.
- Items sort by **earliest date**. A date-less location (no span, no days) sorts last by `sort_order` (existing rule). Loose segments always have a date.

### Empty slots (confirmed decision)

Empty buffer slots remain a **location** concept and render **only inside location blocks** (their effective range, unchanged from build-3). **Loose days get no empty slots between them** — to add another loose day you use the top-level "+ day". The overflow push still applies to loose adds (adding a loose day on a taken date pushes the rest, `location_id = null`).

### Adding

- A new top-level **"+ day"** button sits beside "+ location" at the bottom of the tab. It opens an `AddDayRow` with `locationId = null` and `defaultDate` = the next free day (`nextDayAfter(last)` / `tripStartDate`). The created loose day appears at its date in the timeline.
- The per-location "+ day" inside each location block is unchanged (adds into that location).
- Empty state (no days, no locations) offers both "+ location" and "+ day".

### Ordinals

- **Location number** (`01`, `02`): numbers the location blocks in order; loose days have none.
- **Trip-day ordinal** (`day N`, the card corner from #2): continuous across all days by date (loose + located), via the existing `withOrdinals`.

## Architecture

`itinerary-tab.tsx`:

- **Replace `buildGroups` with `buildTimeline(locations, days)`** returning an ordered `TimelineItem[]`:
  ```
  type TimelineItem =
    | { kind: "location"; group: DayGroup }   // collapsible block (DayGroup as today, minus transit)
    | { kind: "loose"; seg: DaySegment }       // a location-less single day or trek
  ```
  Location groups are built as today (one per location, with `start`/`end`/`days`), **without** the transit group. Loose days (`location_id = null`) are split via `toSegments` into loose segments. All items are sorted by earliest date (`group.start ?? group.days[0]?.dayDate` for locations; `seg.days[0].dayDate` for loose). Date-less locations sort last by `sortOrder`.
- **Extract a `DaySegmentView` piece** (component or local render fn) that renders one `DaySegment` — either the day-card fragment or the `group_id` trek box (with its caption + delete-block `×`). Used by **both** the location-block body and loose items, so the trek box / cards aren't duplicated. Empty-slot rendering stays in the location-block body only (it owns the effective range).
- **Render loop** maps `TimelineItem[]`: a `location` item renders the existing collapsible block (header + body that interleaves its segments and span empties); a `loose` item renders `DaySegmentView` bare (no header, no collapse).
- **Remove** `TRANSIT_KEY` and the transit branch.
- **Top-level "+ day"**: a new `addDayFor` sentinel (e.g. a `LOOSE_KEY` constant) so the existing `AddDayRow` + `addDayDate` machinery drives it with `locationId = null`. The button sits in the bottom controls beside "+ location".

No schema change, no migration. No new server action — loose adds reuse `addItineraryDay` / `insertItineraryDayWithShift` with `locationId = null` (already supported). Realtime unchanged.

## Edge cases / limitations

- **Adding a day onto a date inside another location's span** is **refused** (`addItineraryDay` checks for a location, other than the target, whose span covers the date and returns *"That date is inside &lt;Location&gt; — add the day there, or pick another date."*). This prevents a loose day from double-rendering against that location's empty slot. The target location is excluded, so filling a location's own empty slot and the same-location overflow push are unaffected.
- Existing seed days with `location_id = null` (e.g. Lombok's) become loose floating days at their dates — an improvement over the old "In transit" bucket.

## Build slices (for the plan step)

1. **Date-led card (#2):** add `dom`/`mon` to `ItineraryDay` + `rowToItineraryDay`; swap the `DayView` rail (date) and corner (`day N`). Self-contained, shippable.
2. **Timeline + loose days (#1):** `buildTimeline` + `TimelineItem`; extract `DaySegmentView`; rewrite the render loop to interleave location blocks and loose segments; remove the transit group; add the top-level "+ day". Empties stay location-only.

## Decisions captured

1. Loose days **float on the timeline** (interleaved by date); the "In transit" group is removed.
2. Empty slots render **only inside location blocks**; loose days have none.
3. Date-led card: rail = calendar date, corner = trip ordinal `day N` (kept, not dropped).
4. No schema/migration; loose adds reuse the existing add + overflow-push actions with `location_id = null`.

## Out of scope

- Empty/buffer slots between loose days.
- Collapsing loose days.
- Reordering loose days by drag.
- Any change to dreams.
