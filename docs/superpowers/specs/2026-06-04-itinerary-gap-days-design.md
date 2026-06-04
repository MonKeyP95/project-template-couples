# Itinerary gap days — design (Locations Slice 2, re-scoped)

**Date:** 2026-06-04
**Status:** draft (awaiting user review)
**Scope:** dated trips only. Dreams unchanged.

## Problem / vision

Today you add itinerary days on whatever dates you type. If you add a day on
Jun 12 and another on Jun 15, the days Jun 13–14 simply don't appear — the gap
is invisible. The user wants those in-between days to **show as empty slots you
can click to fill**, so the calendar reads as a continuous strip with obvious
"nothing planned yet" days acting as a buffer.

The buffer is deliberate: filling an empty day never disturbs anything else.
Only when there is **no** empty day where you want one — you're inserting
between two adjacent, already-dated days — does the app **ask to push the later
days forward by one** and then cascade.

This **re-scopes** the original Locations Slice 2 (`2026-06-03-itinerary-locations-design.md`),
which proposed fully computed dates + auto-cascade + reorder. That is dropped.
Everything shipped in Slice 1 stays as-is; this is a small additive change.

## What stays exactly as today (non-goals)

No change to: the location groups, the add-day form, the date picker, the
From/To multi-day range add, the `group_id` "added together" blocks (incl. block
name + block delete), per-day edit/delete, the Realtime channel, or the existing
`reschedule_itinerary_days` RPC (stays in place, still unused by the UI). No
computed-from-order dates. No removing the date picker. No drag-to-reorder. No
location-model changes.

## The model

`day_date` stays the stored source of truth. "Empty days" are **implicit** —
they are just calendar dates inside a location group's span that have no
`itinerary_days` row. There are **no placeholder rows** and **no schema column**
for them; the gap count is derived from the dates already present.

Three behaviours change:

1. **Render gap dates as empty slots.** Inside a location group, the days are
   already sorted by date. Between two consecutive days whose dates are more than
   one day apart, render a faint empty slot per missing date, in date order. A
   group with days on Jun 12 and Jun 15 shows: `Jun 12` (real), `Jun 13` (empty),
   `Jun 14` (empty), `Jun 15` (real). Pure render, driven by existing data.

2. **Click an empty slot to fill it.** Clicking opens the **existing** add form,
   pre-filled with that slot's date and that group's `location_id`. Submitting
   inserts one ordinary day on that free date via the **unchanged**
   `addItineraryDay` (single date, no `endDate`). No shift — the date was empty,
   so the `unique (trip_id, day_date)` insert succeeds directly.

3. **Overflow: push, with confirm.** Adding a day whose date is already taken —
   i.e. squeezing one in between two adjacent days with no gap — currently fails
   with "Another day already uses that date." Instead, surface a confirm: *"No
   empty day there — push the following days forward by 1?"* On confirm, a new
   RPC bumps every day dated `>= newDate` by +1 (deferred-unique, atomic),
   inserts the new day, and the trip's `end_date` extends by 1.

`end_date` only ever **extends** here (overflow push, or a fill on a date past
the current end). Deleting a day does **not** pull anything back — that keeps
this slice purely additive and avoids touching the existing delete path.

## Data model

No new table. No new column. The only DB artifact is one new function.

### New RPC `insert_itinerary_day_shift`

Mirrors the existing `reschedule_itinerary_days` pattern (the
`unique (trip_id, day_date)` constraint is already `DEFERRABLE INITIALLY
IMMEDIATE`, so the RPC opts into deferral and permutes safely in one statement).

```
insert_itinerary_day_shift(
  p_trip_id    uuid,
  p_from_date  date,     -- the occupied date the user is inserting at
  p_title      text,
  p_sub        text,
  p_tag        text,
  p_tone       text,
  p_location_id uuid,    -- nullable
  p_created_by uuid
) returns the inserted row
```

Behaviour, inside one transaction with `set constraints all deferred`:
1. `update itinerary_days set day_date = day_date + 1 where trip_id = p_trip_id and day_date >= p_from_date` (shifts the tail forward, opening p_from_date).
2. `insert` the new day at `p_from_date`.
3. `update trips set end_date = greatest(end_date, <max day_date>)` for the trip.

SECURITY INVOKER (default) so the caller's RLS still gates every write, matching
`reschedule_itinerary_days`. Idempotency note: the function is `create or
replace`, safe to paste repeatedly.

## Server actions

- **`addItineraryDay` — unchanged.** Empty-slot fills go through it verbatim
  (single date). Its existing `23505` branch is what signals "overflow" to the
  client (see below).
- **New `insertItineraryDayShift(input)`** — thin wrapper calling the RPC, same
  `AddItineraryDayResult` shape (`{ day }` / `{ error }`) as `addItineraryDay`,
  plus `revalidatePath`. Only called after the user confirms the push.

## UI / interaction

In `itinerary-tab.tsx`, within each location group's rendered day list:

- **Empty slots.** Compute the missing dates strictly *between* consecutive days
  in the group (never before the first or after the last planned day — matching
  "between the manual added days"). Render each as a faint, dashed, low-height
  card showing just its date and a `+` affordance.
- **Click to fill.** Clicking an empty slot opens the existing `AddDayRow`/
  `DayForm` with `dayDate` pre-set to the slot date and the location preselected;
  the date field stays editable. Submit → `addItineraryDay` (single date).
- **Overflow confirm.** The normal "+ day" / edit path is unchanged. When a
  submit returns the single-day `23505` ("Another day already uses that date"),
  the client replaces the inline error with a confirm prompt: *"No empty day
  there — push the following days forward by 1?"* On confirm, call
  `insertItineraryDayShift` with the same field values; on cancel, restore the
  prior error. Realtime + the existing optimistic `setDays` reconcile the shifted
  dates (the RPC's UPDATEs broadcast one event per row, handled by the existing
  UPDATE branch).

The empty slots render read-only inside `group_id` "added together" boxes is not
a concern — a trek block is contiguous by construction, so it has no internal
gaps to show.

## Migration plan (idempotent, paste-and-run)

1. `create or replace function insert_itinerary_day_shift(...)`. No table or
   column changes; the deferrable unique constraint already exists from
   `20260529000002_itinerary_reschedule.sql`.

## Build slices (for the plan step)

1. **Render empty slots.** Pure UI: compute + render gap-date slots between
   consecutive days in a group. No actions, no DB.
2. **Click-to-fill.** Wire an empty slot to open the existing add form pre-filled
   (date + location); submit via the unchanged `addItineraryDay`.
3. **Overflow push.** Add the `insert_itinerary_day_shift` RPC + the
   `insertItineraryDayShift` action; turn the single-day `23505` into a
   confirm-and-push.

## Decisions captured

1. **Empty days are implicit** (no rows, no column) — derived from dates.
2. **The date picker stays.** Dates remain manually set; this slice only makes
   gaps visible/fillable and adds the overflow push.
3. **`end_date` only extends, never shrinks** in this slice. Deleting days leaves
   their now-empty dates as gaps (which simply render as empty slots) rather than
   pulling the tail back — keeps the delete path untouched.
4. **Overflow is detected via the existing `23505`**, not a pre-check, so the
   plain add stays untouched and the push is opt-in behind a confirm.

## Out of scope

- Computed-from-order dates, removing the date picker, drag-to-reorder
  (all dropped from the original Slice 2).
- Backward cascade on delete (gaps from deletes just become empty slots).
- Empty slots before the first / after the last planned day in a group.
- Gap days for dream itineraries.
