# Itinerary: drag-to-swap days within a location

Date: 2026-07-16
Status: approved-for-planning

## Problem

On the dated itinerary you can add, edit, reschedule-by-push, and delete days,
but you cannot directly reorder two days that are already planned. The user
wants to grab a day and drop it into another day's slot to "switch easily" —
e.g. move the plan on one day onto a later date.

## Scope

Instant, no-approval drag-and-drop reordering of days **within a single
location group** on the dated itinerary tab (`itinerary-tab.tsx`). Both partners
see the result live through the itinerary's existing Realtime subscription.

Semantics: **dates stay put, the day's plan moves.** The location's own set of
dates is fixed; reordering only changes which day (its title, sub, events, tag,
tone) sits on which of that location's dates. This is the same model the
existing reschedule already uses, scoped to one location.

### Explicitly out of scope (v1)

- **Partner approval / voting.** Swaps apply instantly.
- **Cross-location drag.** Dropping a day onto another location's day does
  nothing (drop ignored). Keeps location date-spans valid with zero repair.
- **Loose transit days in mixed trips.** When locations exist, the scattered
  location-less days between them are non-contiguous and are not draggable.
- **Multi-day block (`group_id`) contiguity.** Individual days stay
  independently draggable; dragging a day out of an "added together" block is
  possible and not specially guarded (the prior reschedule never guarded it).

## Why this is a UI-only slice

The data layer already exists and is currently unused on this tab:

- `reschedule_itinerary_days` RPC (`supabase/migrations/20260529000002_...`)
  reassigns a trip's days to its sorted date slots: `day_ids[i]` takes
  `sorted_dates[i]`. Uniqueness on `(trip_id, day_date)` is DEFERRABLE so the
  permutation commits atomically.
- `rescheduleItineraryDays(tripId, tripSlug, orderedDayIds)` action
  (`src/lib/trips/actions.ts`) wraps it and `revalidatePath`s.
- dnd-kit is installed; the pattern is proven in the **dream** tab
  (`dream-itinerary-tab.tsx`: `DndContext` + `SortableContext` +
  `arrayMove` + optimistic `setDays` with rollback).
- `DayCard` already carries a `dragHandle` prop plumbed through to `DayView`
  (currently never populated).

No migration, no new server action.

## How a within-location swap reuses the trip-wide RPC

The RPC operates over the whole trip's dates. To reuse it while only permuting
one group's days:

1. `globalOrder` = all trip `days` sorted ascending by `dayDate`. Position `i`
   currently maps to `sorted_dates[i]`, so this list is a no-op baseline.
2. `groupIds` = the dragged location's day ids in date order.
3. `reorderedGroupIds` = `arrayMove(groupIds, oldIndexInGroup, newIndexInGroup)`.
4. Find the global indices the group's members occupy in `globalOrder`
   (ascending). Overwrite those slots, in order, with `reorderedGroupIds`;
   every other slot keeps its current day id.
5. Call `rescheduleItineraryDays(tripId, tripSlug, newGlobalOrder)`.

Only the group's members change date; all others map to their own current date.
Because the group's date set is unchanged, the location's declared
`start`/`end` span stays valid — nothing to repair.

## Components

### 1. `reassignDayDate(day, newDate)` — `src/lib/trips/itinerary-types.ts`

Pure helper: returns a copy of an `ItineraryDay` with `dayDate` set to
`newDate` and the derived display fields (`dow`, `date`, `dom`, `mon`)
recomputed via the module's existing `Intl` formatters. Used by the optimistic
update so the reordered cards show their new dates without a round-trip.
`d` ordinals are then re-padded by the existing `withOrdinals`.

Unit-testable in isolation (input day + date → output day).

### 2. `SortableDayCard` wrapper — `itinerary-tab.tsx`

Mirrors `SortableDreamDayCard`. Wraps `DayCard` in a `useSortable({ id })`
node; spreads `attributes`/`listeners` on the **card root** (whole card
draggable) and applies the `CSS.Transform` style. No separate visible handle;
the `dragHandle` prop is left unused (or removed if trivially clean).

Tap-vs-drag is disambiguated by the sensor's activation distance (below), so
tap-to-expand and tap-to-edit keep working.

### 3. Per-location `DndContext` + `onDragEnd` — `itinerary-tab.tsx`

For each location group's rendered day sequence:

- Wrap in `<DndContext id={`dnd-${group.key}`} sensors collisionDetection={closestCenter} onDragEnd=...>`
  (stable id from the location id keeps dnd-kit's `aria-describedby`
  deterministic across SSR/CSR — see the dnd-kit SSR id-mismatch note).
- Inside, a `<SortableContext items={group.days.map(d => d.id)}
  strategy={verticalListSortingStrategy}>` around the existing rows; each day
  card becomes a `SortableDayCard`. Empty-day buttons and empty-runs remain
  rendered as non-sortable siblings.
- `sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))`.
- `onDragEnd(group)`: ignore if no `over`, same id, or `over.id` not in this
  group's ids (cross-location or onto an empty). Otherwise compute
  `reorderedGroupIds`, optimistically `setDays` (via `reassignDayDate` on the
  moved members + `withOrdinals`), then in a transition call
  `rescheduleItineraryDays`; on error, restore the pre-drag snapshot.

**No-locations trips:** all days are one contiguous loose sequence. Treat that
single loose run as one sortable region with the same handler, so simple trips
are fully reorderable. (When locations exist, loose runs stay non-draggable per
scope.)

## Data flow

drag end → optimistic `setDays(reassigned)` → `rescheduleItineraryDays` →
`reschedule_itinerary_days` RPC permutes `day_date` in one deferred-constraint
transaction → `revalidatePath` + Realtime `UPDATE` events → partner's tab
reconciles. On action error → `setDays(snapshot)` rollback.

## Testing

- Unit: `reassignDayDate` recomputes `dow`/`date`/`dom`/`mon` for a new date
  (incl. month/weekday rollover), leaves other fields intact.
- Unit: the `newGlobalOrder` builder — swapping two members of a group permutes
  only their slots and leaves all other positions identical.
- Manual (both modes): planning a multi-location trip, drag two days within a
  location → dates hold, plans swap, span unchanged, partner sees it live;
  a no-location trip reorders freely; cross-location drop is a no-op.

## Risks

- Whole-card drag vs. tap-to-expand: mitigated by the 8px activation distance
  (same value the dream tab ships).
- Realtime vs. optimistic race: same pattern the tab already uses for edits;
  the RPC is atomic and `revalidatePath` re-seeds server state.
