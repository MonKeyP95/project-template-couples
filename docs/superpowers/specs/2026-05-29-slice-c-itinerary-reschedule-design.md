# Slice C — Drag-to-reschedule itinerary days — design

**Date:** 2026-05-29
**Status:** Approved, ready for implementation plan.
**Carries from:** `docs/TODO.md` Phase 4.6 carried list → "Slice C — Drag to reschedule." Unblocked now that `@dnd-kit` is in the project (added for packing categories, 2026-05-29).

## Goal

Let a workspace member drag itinerary day cards to resequence them on `/trips/[slug]?tab=itinerary`. The trip's set of dates is a fixed frame; dragging reorders which activity sits on which date (insertion-shift). Closes the "can only reorder by editing each day's date one at a time" gap.

## Semantic: insertion-shift across fixed date slots

The trip's existing `day_date` values, sorted ascending, are the **slots**. Dragging a card to a new position reassigns the slots to the rows by their new order. Example — Jun12 Arrive, Jun13 Surf, Jun14 Hike; drag Hike to top → Hike=Jun12, Arrive=Jun13, Surf=Jun14. Matches `arrayMove` + the category-drag feel.

- Only `day_date` is reassigned. `title` / `sub` / `tag` / `tone` ride along with their row.
- Gaps are preserved: a trip with Jun12 / Jun14 / Jun19 permutes across exactly those three dates.
- The set of dates never changes — no new or empty dates are introduced. (Moving a day to a brand-new/empty date is already possible via the day edit form; that's not this feature.)

## Non-goals (deferred)

- **Dream itinerary (Slice B).** Dreams have no `day_date`, so there's nothing to reschedule. The existing `DreamItineraryStub` renders unchanged; drag is dated-trips-only.
- **Move-to-arbitrary/empty-date.** Covered by the existing date picker in `DayEditor` + `updateItineraryDay` (with its `23505` collision message). Not duplicated here.
- **Pairwise swap** and **move-onto-a-specific-date** semantics. Rejected in brainstorming in favor of insertion-shift.
- **Multi-event days, cross-trip drag, undo.** Out of scope.

## Schema (one migration)

`supabase/migrations/20260529000002_itinerary_reschedule.sql` (idempotent).

### 1. Make the unique constraint deferrable

An insertion-shift permutes `day_date` among rows; rewriting them row-by-row transiently collides on `unique (trip_id, day_date)`. Postgres checks non-deferrable unique constraints during the statement, so even a single multi-row `UPDATE` that permutes values fails. Fix: make the constraint `DEFERRABLE INITIALLY IMMEDIATE`.

- `INITIALLY IMMEDIATE` keeps today's behavior identical for `addItineraryDay` / `updateItineraryDay`: their inserts/updates still fail fast with `23505`, so the "Another day already uses that date." message is unaffected.
- Only the reschedule function opts into deferral (`SET CONSTRAINTS ALL DEFERRED`), so the permutation is validated at transaction commit instead of mid-statement.

The Phase 3 constraint was created inline as `unique (trip_id, day_date)`, so its system-assigned name is `itinerary_days_trip_id_day_date_key`. The migration drops and re-adds it:

```sql
-- Make the (trip_id, day_date) uniqueness deferrable so an insertion-shift
-- reschedule can permute dates within one transaction without tripping the
-- per-statement unique check. INITIALLY IMMEDIATE keeps add/edit behavior
-- (fail-fast 23505) unchanged; only reschedule_itinerary_days defers.
-- Idempotent: drop-if-exists then re-add.
alter table public.itinerary_days
  drop constraint if exists itinerary_days_trip_id_day_date_key;
alter table public.itinerary_days
  add constraint itinerary_days_trip_id_day_date_key
  unique (trip_id, day_date) deferrable initially immediate;
```

### 2. Reschedule function

`SECURITY INVOKER` (the default) so the caller's RLS still applies — a non-member's `UPDATE` affects no rows and the `SELECT` returns nothing. One `UPDATE` mapping each id to its slot, after deferring the constraint:

```sql
create or replace function public.reschedule_itinerary_days(
  p_trip_id uuid,
  p_day_ids uuid[]
) returns void
language plpgsql
as $$
declare
  v_dates date[];
begin
  set constraints all deferred;

  select array_agg(day_date order by day_date)
    into v_dates
  from public.itinerary_days
  where trip_id = p_trip_id;

  if array_length(v_dates, 1) is distinct from array_length(p_day_ids, 1) then
    raise exception 'reschedule id count % does not match day count %',
      array_length(p_day_ids, 1), array_length(v_dates, 1);
  end if;

  update public.itinerary_days d
  set day_date = m.new_date
  from (
    select i.id, dt.new_date
    from unnest(p_day_ids) with ordinality as i(id, ord)
    join unnest(v_dates)  with ordinality as dt(new_date, ord) using (ord)
  ) m
  where d.id = m.id and d.trip_id = p_trip_id;
end;
$$;
```

The `using (ord)` join pairs `day_ids[i]` with `sorted_dates[i]`, so each dragged row takes the slot at its new position.

No Realtime publication change — `itinerary_days` is already published. Each row is updated once to its final date, so the partner's client receives clean final values and re-sorts via `withOrdinals`.

## Server action (`src/lib/trips/actions.ts`)

Append, mirroring `reorderPackingCategories`:

```ts
export interface RescheduleItineraryResult {
  error?: string
}

export async function rescheduleItineraryDays(
  tripId: string,
  tripSlug: string,
  orderedDayIds: string[],
): Promise<RescheduleItineraryResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("reschedule_itinerary_days", {
    p_trip_id: tripId,
    p_day_ids: orderedDayIds,
  })
  if (error) return { error: error.message }
  revalidatePath(`/trips/${tripSlug}`)
  return {}
}
```

## Client (`src/app/trips/[slug]/itinerary-tab.tsx`)

Reuse the `@dnd-kit` pattern from `packing-tab.tsx`.

- **Sensors:** `PointerSensor` with `activationConstraint: { distance: 8 }` (mouse + touch).
- **Wrapping:** the day list is wrapped in `DndContext` (`closestCenter`, `onDragEnd`) + `SortableContext` (`verticalListSortingStrategy`) over the day ids. Each day becomes a `SortableDayCard` wrapper that supplies `setNodeRef` / transform style and passes a grip-handle node into `DayCard`.
- **Grip handle:** a small `⠿` on the day card, `touch-none`, shown only in view mode (`DayView`). While a card is being edited (`DayEditor`), no handle — you can't drag a card mid-edit. The `AddDayRow` and `SuggestionCard` stay outside the sortable context.
- **`onDragEnd`:**
  1. find old/new index by id; bail if unchanged.
  2. `const reordered = arrayMove(days, oldIndex, newIndex)`.
  3. reassign dates by slot: take the current dates sorted ascending (`days.map(d => d.dayDate).sort()`), assign `slot[i]` to `reordered[i].dayDate`, then `withOrdinals(...)`.
  4. snapshot, set optimistically, call `rescheduleItineraryDays(tripId, tripSlug, reordered.map(d => d.id))` inside a `useTransition`; revert to snapshot on error.
- **Realtime:** unchanged. The RPC's `UPDATE`s broadcast per-row final dates; the existing channel's `UPDATE` handler + `withOrdinals` re-sort on the partner's device. The acting client already shows the optimistic result (id-keyed replace dedupes the echo).

Single-day trips: `days.length < 2` → render as today, no drag (a one-item sortable is a no-op anyway).

## Files touched

- `supabase/migrations/20260529000002_itinerary_reschedule.sql` — deferrable constraint + `reschedule_itinerary_days` function.
- `src/lib/trips/actions.ts` — `rescheduleItineraryDays`.
- `src/app/trips/[slug]/itinerary-tab.tsx` — DnD wiring, grip handle, optimistic reschedule.

## User action required after merge

Paste `supabase/migrations/20260529000002_itinerary_reschedule.sql` into the Supabase SQL Editor (idempotent). Until then `reschedule_itinerary_days` doesn't exist and a drag's action call returns an error → the optimistic reorder reverts, so the UI stays correct (just no persistence).
