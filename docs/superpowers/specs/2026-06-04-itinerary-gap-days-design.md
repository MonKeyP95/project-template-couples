# Itinerary dated anchors — gap days + location spans (Locations Slice 2, re-scoped)

**Date:** 2026-06-04
**Status:** draft (awaiting user review)
**Scope:** dated trips only. Dreams unchanged.

## Problem / vision

Today you add itinerary days on whatever dates you type, and a location has no
dates of its own — its span is implied by the days under it. Two gaps:

- If you add a day on Jun 12 and another on Jun 15, the in-between days don't
  appear; the empty time is invisible.
- You can't lay out a trip by saying "Kuta is Jun 12–16" up front and then fill
  those days in.

The user wants **one timeline of dated anchors**, where a **day** occupies one
date and a **location** occupies a span, and both behave the same way:

1. The dates an anchor covers that have **no activity yet** show as **empty day
   slots** you can click to fill. Gaps before an anchor (between it and what came
   before) also show as empties. Empty days are a deliberate buffer.
2. Filling a **free** date never disturbs anything.
3. Placing or growing an anchor onto **already-assigned** dates prompts a
   confirm — *"No room there — push the following days forward?"* — and on
   confirm everything from that date is **pushed forward by N** (N = the new
   anchor's length: 1 for a day, the span length for a location), opening a clean
   window. Whole locations move as units. The trip's `end_date` extends by N.

This **re-scopes** the original Locations Slice 2
(`2026-06-03-itinerary-locations-design.md`), which proposed fully
computed-from-order dates + auto-cascade + drag-reorder. That is dropped.
Everything shipped in Slice 1 stays; dates remain **manually set**, and this adds
the empty-day buffer, click-to-fill, location date spans, and the
confirm-then-push.

## What stays exactly as today (non-goals)

No change to: the location groups, the add-day form, the date picker, the From/To
multi-day range add, the `group_id` "added together" blocks (incl. block name +
block delete), per-day edit/delete, the Realtime channels, or the existing
`reschedule_itinerary_days` RPC (stays in place, still unused by the UI). No
computed-from-order dates. No removing the date picker. No drag-to-reorder. No
backward cascade on delete.

## The model

`day_date` stays the stored source of truth for days. "Empty days" are
**implicit** — calendar dates inside an anchor's range that have no
`itinerary_days` row. No placeholder rows, no "empty day" column; the buffer is
derived from the dates present.

The one new stored thing is a **location's own date span** (optional). Days,
multi-day blocks, and locations are all "dated anchors":

| Anchor   | Occupies                   | Length N |
|----------|----------------------------|----------|
| Day      | one date (`day_date`)      | 1        |
| Multi-day block (trek / course) | N consecutive dates sharing one `group_id` (+ optional block name) | day count |
| Location | a span (`start_date`..`end_date`) | `end_date − start_date + 1` |

A multi-day block is created **inside a location** by today's From/To range add
(e.g. a 3-day "Mount Fuji Trek" or a 5-day "Surf School" filed under Kuta) and
renders in the existing "added together" box. It is unchanged except that its
date collision now offers the push (below) instead of erroring.

A location's **effective range** = its declared span if set, else
`min(day_date)..max(day_date)` of its days (today's behavior). Locations without
a span (and "In transit") keep working exactly as now.

## Data model

### `itinerary_locations` — add optional span

```sql
alter table itinerary_locations
  add column if not exists start_date date,
  add column if not exists end_date   date;
-- both null = "span implied by its days" (current behavior); a check keeps them
-- consistent when set.
alter table itinerary_locations
  drop constraint if exists itinerary_locations_span_chk,
  add  constraint itinerary_locations_span_chk
    check (
      (start_date is null and end_date is null)
      or (start_date is not null and end_date is not null and end_date >= start_date)
    );
```

No change to `itinerary_days`. The `unique (trip_id, day_date)` constraint stays
`DEFERRABLE INITIALLY IMMEDIATE` (already so from
`20260529000002_itinerary_reschedule.sql`); locations carry **no** unique date
constraint, so two locations' spans could in principle overlap — the
collision-and-push flow exists precisely to avoid creating overlaps through the
UI.

### New RPC `shift_itinerary_from`

Generalized insertion-shift, same deferred-unique pattern as
`reschedule_itinerary_days`. Opens an N-day window at `p_from_date` by moving
everything at or after it forward:

```
shift_itinerary_from(p_trip_id uuid, p_from_date date, p_n int) returns void
```

Inside one transaction with `set constraints all deferred`:
1. `update itinerary_days set day_date = day_date + p_n where trip_id = p_trip_id and day_date >= p_from_date`.
2. `update itinerary_locations set start_date = start_date + p_n, end_date = end_date + p_n where trip_id = p_trip_id and start_date >= p_from_date`.
3. `update trips set end_date = end_date + p_n where id = p_trip_id`.

A location that **straddles** `p_from_date` (`start_date < p_from_date <= end_date`)
keeps its `start_date` and has `end_date += p_n` so it still contains its shifted
tail days. SECURITY INVOKER (default) — caller RLS gates every write. `create or
replace`, safe to paste repeatedly.

Pushing forward by N from D always frees the window `[D, D+N−1]` (nothing below D
in the `>= D` set), so the new anchor slots in cleanly.

## Server actions

- **`addItineraryDay` — unchanged.** Both the single-date fill and the From/To
  multi-day range add (N days sharing a `group_id` + optional block name) go
  through it verbatim. When the target dates are free it inserts directly; its
  existing `23505` ("Another day already uses that date." / "Some days in that
  range are already planned.") is the signal that dates are taken → triggers the
  confirm-then-push (below).
- **New `insertWithShift(input)`** — calls `shift_itinerary_from(tripId,
  fromDate, N)` (N = 1 for a day, the range length for a multi-day block) then
  inserts the day(s), same `AddItineraryDayResult` shape as `addItineraryDay`.
  Only called after the user confirms a push.
- **`createLocation` / `updateLocation` — extended** to accept optional
  `startDate` + `endDate`. Setting a span checks whether `[start, end]` overlaps
  any already-assigned date (another location's effective range or any day not in
  this location). No overlap → write the span directly. Overlap → return a
  `needsPush` result with the from-date `D = start` and `N = end − start + 1`; the
  client confirms, then calls **`setLocationSpanWithShift`** which runs
  `shift_itinerary_from(tripId, D, N)` and writes the span.
- `renameLocation`, `deleteLocation`, `deleteItineraryDay`, `deleteItineraryGroup`
  — unchanged. Deleting leaves the freed dates as gaps (they just render as empty
  slots); **no backward cascade** in this slice.

## UI / interaction

In `itinerary-tab.tsx`, within each location group:

- **Empty slots.** From the group's effective range (declared span, else
  min..max of its days), render every date with no activity row as a faint,
  dashed, low-height card showing its date and a `+`. Gaps strictly *between*
  covered dates and the leading gap before a location's start are shown; nothing
  is rendered after the last covered date of the last anchor.
- **Click to fill.** Opens the existing `AddDayRow`/`DayForm` pre-filled with the
  slot's date and the group's `location_id` (date field + the From/To range stay
  editable, so an empty slot can also be the start of a multi-day trek). Submit →
  `addItineraryDay`. On a `23505` (single date or range), swap the inline error
  for the confirm *"No empty day there — push the following N days forward?"* (N =
  1 for a day, the range length for a block); on confirm call `insertWithShift`,
  on cancel restore the error.
- **Location dates.** The create/rename-location control gains optional **start**
  and **end** date inputs. Saving a span that overlaps assigned dates shows the
  confirm *"No room — push the following N days forward?"*; on confirm,
  `setLocationSpanWithShift`. A location with a span renders its full range as
  empty slots until filled.
- **Ordering.** Location groups order by `start_date` when set, else by earliest
  day date (today's rule) as the fallback; `sort_order` remains the final
  tiebreaker for empty, date-less locations.
- **Reconciliation.** The shift RPC's UPDATEs broadcast one Realtime event per
  row; the existing UPDATE handler + optimistic `setDays` reconcile shifted
  dates. Location-row changes ride the existing locations Realtime channel /
  `revalidatePath`.

Empty slots are not rendered inside a `group_id` "added together" box — a trek
block is contiguous by construction, so it has no internal gaps.

## Migration plan (idempotent, paste-and-run)

1. `alter table itinerary_locations add column if not exists start_date / end_date`
   + the `drop constraint if exists` / `add constraint` span check.
2. `create or replace function shift_itinerary_from(...)`. No change to
   `itinerary_days`; the deferrable unique already exists.

## Build slices (for the plan step)

1. **Render empty slots between days.** Pure UI from existing day dates. No
   actions, no DB. (Delivers the visible buffer immediately.)
2. **Click-to-fill + overflow push (day and multi-day block).**
   `shift_itinerary_from` RPC + `insertWithShift`; wire empty-slot click to the
   add form and turn the `23505` (single date or From/To range) into
   confirm-then-push by N.
3. **Location date spans.** The `start_date`/`end_date` columns, location form
   date fields, span-based empty-slot rendering, ordering change, and
   `setLocationSpanWithShift` (reusing the same RPC with N = span length).

## Decisions captured

1. **Days and locations are one kind of thing** — dated anchors that occupy
   dates and push the same way.
2. **Empty days are implicit** (no rows, no column) — derived from anchor ranges.
3. **The date picker stays;** dates are manually set. Locations gain an
   *optional* span; a date-less location keeps today's "implied by its days"
   behavior.
4. **Push is by N** (the inserted anchor's length), opening a clean window;
   `end_date` extends by N. Whole locations move as units.
5. **`end_date` only extends, never shrinks** here. Deleting an anchor leaves its
   dates as gaps (empty slots), not a backward cascade — keeps the delete path
   untouched.
6. **Overflow is detected from the assigned dates** (day `23505` for a single
   day; an overlap check for a location span), so the plain free-date fill stays
   untouched and the push is always opt-in behind a confirm.

## Out of scope

- Computed-from-order dates, removing the date picker, drag-to-reorder (all
  dropped from the original Slice 2).
- Backward cascade on delete (freed dates just become empty slots).
- Empty slots before the first / after the last covered date of the whole
  itinerary.
- A unique constraint on location spans (the confirm-push flow is what prevents
  overlaps via the UI).
- Gap days / location spans for dream itineraries.
