# Itinerary: drag empty days like real days

Date: 2026-07-16
Status: approved-for-planning

## Problem

The day-swap slice (`2026-07-16-itinerary-day-swap-within-location-design.md`)
made real days draggable within a location, but **empty days stay inert**. They
render outside the sortable list, so you cannot grab a free day and move it. The
user wants an empty day to drag exactly like a full day.

## Scope

Within a single location group on the dated itinerary tab, an empty day is a
draggable slot identical to a real day. Dragging any slot (full or empty)
reorders the sequence, which re-lays onto the location's fixed set of dates:
real days take their new date, empties are the holes. Dragging a real day up
pushes a gap down, and vice versa — symmetric.

Semantics extend the existing model from "dates fixed, real days permute" to
"dates fixed, real days **and gaps** permute." The location's declared
`start`/`end` span is unchanged; only which date each real day sits on changes.

### Decisions

- **Empty runs.** Consecutive empties still collapse into one "N empty days"
  run for compactness. Expanding the run exposes each empty as its own
  draggable slot. The collapsed summary itself is inert — expand to grab one.
- **Both modes, no dragging into the past.** Drag works identically planning and
  on the road, but a day/empty cannot land on a date before today. Past days
  stay in the collapsed "earlier" section, non-participating. In planning today
  precedes the whole trip, so there is no restriction.

### Explicitly out of scope (consistent with the day-swap slice)

- Cross-location drag (drop onto another location is ignored).
- Partner approval / voting — reorders apply instantly.
- Multi-day block (`group_id`) contiguity — a day can still leave its block,
  unguarded.
- Loose transit days scattered between locations when locations exist.

## Why this is not UI-only

The existing `reschedule_itinerary_days` RPC
(`supabase/migrations/20260529000002_...`) assigns days only to the set of
**currently-occupied** dates (`v_dates = array_agg(day_date)`). It cannot place
a day on a date that is currently empty, which is exactly what moving a gap
requires. So this slice needs a small data-layer addition.

The new full-range permutation **subsumes** the old occupied-only permutation
(no gaps is the special case), so the old within-location reorder path is
retired rather than kept in parallel.

## Components

### 1. RPC `reschedule_itinerary_days_to` — new migration

```sql
create or replace function public.reschedule_itinerary_days_to(
  p_trip_id uuid,
  p_day_ids uuid[],
  p_dates   date[]
) returns void
```

Assigns `p_day_ids[i]` -> `p_dates[i]` explicitly. `set constraints all
deferred` so the permutation commits atomically against the DEFERRABLE
`(trip_id, day_date)` uniqueness (already made deferrable by the slice-C
migration). SECURITY INVOKER so the caller's RLS still gates the update. Raises
if the two array lengths differ. Idempotent (`create or replace`). The old
`reschedule_itinerary_days` function is left in place, unused and harmless.

The client passes every real day within the participating sub-range with its new
date (movers and non-movers alike), mirroring how the existing action passes the
full order; deferred uniqueness makes it atomic.

### 2. Pure helper `reorderRangeSlots` — `src/lib/trips/itinerary-types.ts`

```ts
reorderRangeSlots(
  days: ItineraryDay[],   // one location's real days
  rangeStart: string,     // effective range low (declared span ∪ days)
  rangeEnd: string,       // effective range high
  floorDate: string,      // inclusive floor; "" = no floor (planning)
  activeId: string,       // dragged slot id (day id or "empty:<date>")
  overId: string,         // drop-target slot id
): { id: string; date: string }[]   // real days whose date changed
```

Builds `allDates = dateRange(rangeStart, rangeEnd)` filtered to `>= floorDate`.
`slots[i]` = the real day id occupying `allDates[i]`, else `"empty:<date>"`.
`oldIndex`/`newIndex` = indices of `activeId`/`overId` in `slots`; return `[]`
if either is missing or equal. `arrayMove(slots, oldIndex, newIndex)`, then for
each real-day slot at new position `i` set its date to `allDates[i]`; return the
subset whose date differs from the current one.

Empty ids use the `"empty:"` prefix, which never collides with a UUID day id.
Collapsed-run empties are still real entries in `slots` (so a day slides past
them correctly) even though they are not rendered as drop targets.

`floorDate` is the "not into the past" guard: `today` when the trip is live,
`""` otherwise.

### 3. UI — `src/app/trips/[slug]/itinerary-tab.tsx`

- `SortableEmptyDay` wrapper around `EmptyDayButton`, mirroring
  `SortableDayCard`: `useSortable({ id: "empty:" + date })`, spreads
  attributes/listeners on the wrapper, applies `CSS.Transform`. Single empties
  and expanded-run empties render through it. The collapsed run summary button
  stays a plain button (inert).
- `SortableContext items` = the rendered sortable ids in order — day ids plus
  rendered empty ids, excluding collapsed-run empties and any rows hidden in the
  "earlier" (past) section. Computed alongside the existing `rows`/`renderRow`
  pass so it matches what is actually mounted.
- `onGroupDragEnd(group)` computes `floorDate = active ? today : ""`, calls
  `reorderRangeSlots` with the group's effective range, and if it returns
  changes: optimistic `setDays` via `reassignDayDate` on the changed days +
  `withOrdinals`, snapshot for rollback, then `rescheduleItineraryDaysTo` in a
  transition; on error restore the snapshot. The locationless single loose group
  uses the same handler with its own range.
- Guard: a fully-past location on the road (`rangeEnd < today`) renders
  non-sortable — there is nothing to reorder.
- `reorderWithinGroup` and the `rescheduleItineraryDays` call are removed once
  the new path is wired.

## Data flow

drag end -> `reorderRangeSlots` -> optimistic `setDays(reassigned)` ->
`rescheduleItineraryDaysTo` -> `reschedule_itinerary_days_to` RPC permutes
`day_date` in one deferred-constraint transaction -> `revalidatePath` +
Realtime `UPDATE` events -> partner's tab reconciles. On action error ->
`setDays(snapshot)` rollback.

## Testing

- Unit `reorderRangeSlots`:
  - Moving an empty between two planned days inserts the gap at the drop
    position and shifts exactly the real days between old and new positions.
  - Moving a real day past an empty pushes the gap the other way.
  - `floorDate` excludes past dates from the slot list (a live trip cannot
    reassign onto a past date).
  - The returned list contains only real days whose date actually changed.
- Manual (both modes): drag an empty between two planned days; drag a day past
  an empty; expand a multi-empty run and drag one empty out; on the road, past
  dates reject and partner sees the result live; a locationless trip reorders
  freely; cross-location drop is a no-op.

## Risks

- Whole-card drag vs. tap-to-expand/fill: mitigated by the existing 8px
  mouse / 200ms touch activation constraints (`dragSensors`).
- `items` drifting from the mounted sortable nodes (collapsed runs, earlier
  section): computed from the same render pass to stay in sync.
- Realtime vs. optimistic race: same pattern the tab already uses; the RPC is
  atomic and `revalidatePath` re-seeds server state.
