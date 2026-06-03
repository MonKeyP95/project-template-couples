# Itinerary locations — design

**Date:** 2026-06-03
**Status:** draft (awaiting user review)
**Scope:** dated trips only. Dreams (dateless itinerary) are a follow-up.

## Problem / vision

Today the itinerary is one flat, date-first list: every day is pinned to a
calendar date you type, sorted by date. The user wants the itinerary organized
by **location**. You open the itinerary and see **editable location tabs**
("Kuta", "Gili", "Senaru"); pressing a tab expands its day-by-day. You build a
trip by creating a location, then adding days into it — and the **calendar is
computed from order**, not hand-typed.

This changes one thing shipped earlier on 2026-06-03 — the multi-day **From/To
range** add — into a count-based add (because dates are now computed). The
**"added together" trek box** (`group_id`) is **kept**: a trek is a sub-group
*within* a location, so the two nest (location tab → trek block inside it).

## The model

- **The itinerary is one ordered sequence of dated days.** Most days are filed
  under a **location**; some float free as **travel days** (no location — e.g. a
  ferry day between two places).
- **Location** is a new lightweight record rendered as an editable, reorderable
  **tab**. A location has a name and an order; it has **no date field** — its
  span is implied by the days filed under it. A location may be **empty** (you
  create it before adding days).
- **Each day carries a nullable `location_id`** (the "label id"). `null` = a
  travel day.
- **Dates are computed from position, never typed.** The trip's `start_date` is
  the anchor (day 1). Each day's date = `start_date + (its position − 1)`. The
  sequence is **gapless** going forward: adding a day assigns the next date and
  **cascades every later day +1**; deleting a day **pulls every later day −1**.
- **The trip's `end_date` follows the itinerary.** With ≥1 day,
  `end_date = start_date + (day count − 1)`. Adding a day extends the trip;
  deleting shortens it. (See "Decisions to confirm" — this couples trip length
  to itinerary length, which is the stated intent: "adding a day = extending the
  trip.")
- **Press a tab → expand that location's days**, still date-ordered underneath.

## Data model

### New table `itinerary_locations`

```
id          uuid pk default gen_random_uuid()
trip_id     uuid not null references trips(id) on delete cascade
name        text not null check (length(trim(name)) > 0)
sort_order  int  not null
created_by  uuid not null references auth.users(id) on delete restrict
created_at  timestamptz not null default now()
```

- RLS mirrors `itinerary_days`: select/insert/update/delete gated by
  `is_trip_workspace_member(trip_id)`; insert also requires
  `created_by = auth.uid()`.
- Realtime: add to the publication so both partners see tab changes live.

### `itinerary_days` change

```
alter table itinerary_days
  add column if not exists location_id uuid
  references itinerary_locations(id) on delete set null;
```

- `on delete set null`: deleting a location **detaches** its days (they become
  travel days), rather than destroying day content. A separate "delete location
  and its days" affordance is out of scope for now.
- The `group_id` column added earlier **stays in active use**. Locations and
  trek groups are different axes: a location is the tab; a `group_id` is a
  sub-block of consecutive days *within* a location (the "added together" box).
  A trek group never spans two locations.

### Ordering

- **Tab order:** by each location's **earliest day date**, then `sort_order` as
  the tiebreaker for empty locations (which have no day to date them).
- **Within a tab:** days sorted by date (unchanged from today).
- `sort_order` exists mainly so a freshly-created empty location has a stable
  slot until its first day dates it.

## Date computation & cascade

`day_date` stays the **stored source of truth** (keeps the existing date/dow
rendering and the `unique (trip_id, day_date)` constraint). "Computed dates" is
an **action-layer behaviour**, not a schema change — every write keeps the
sequence consistent:

- **Add day to location L:** new date = `max(date of L's days) + 1` (i.e. right
  after L's current last day, or after the previous location's last day if L is
  empty; `trip.start_date` if the itinerary is empty). Shift every day dated
  `>= newDate` by +1, then insert. Extend `end_date`.
- **Add an N-day trek to location L:** the same insert, but `count` days at once
  sharing a fresh `group_id` (so they render in the "added together" box). Shift
  later days by +N. Replaces the old From/To range add — you give a **count**,
  not an end date, since dates are computed.
- **Add travel day:** same as a single day, inserted after a chosen anchor
  day/location, with `location_id = null`.
- **Delete day:** remove, shift every later day −1 (close the gap), shrink
  `end_date`.
- **Reorder / move between locations:** reuses the existing insertion-shift
  reschedule (reassign the fixed date slots to the new id order) and, when a day
  changes tab, sets its `location_id`.

Shifts that touch the `unique (trip_id, day_date)` constraint run inside
Postgres RPCs under a **deferred** unique constraint (same pattern as the
existing `reschedule_itinerary_days`), so each operation is atomic and
all-or-nothing. New RPCs: `insert_itinerary_day_shift`,
`delete_itinerary_day_shift`.

## UI / interaction

- **Empty itinerary:** a single **"+ new location"** action. Creating a location
  persists an empty location row and immediately opens "add the first day"; that
  first day defaults to `trip.start_date`.
- **Location tabs:** a horizontal, editable tab strip above the day list.
  - Rename: inline edit of the tab (one `name` update).
  - Reorder: drag tabs (writes `sort_order`); calendar position still follows
    the days' dates.
  - Add location: appends a new empty tab.
  - Delete location: detaches its days (they become travel days) after a
    confirm.
- **Active tab** shows that location's days, each card as today (tag / title /
  sub / tone, edit ✎, delete ×), with the **computed date** shown read-only.
  Consecutive days sharing a `group_id` render inside the **"added together"**
  box, exactly as today — the box now just lives within a location tab.
- **Add day** lives inside the active tab ("+ add day here"); no date picker —
  the date is computed and the later days cascade. A **count** field (default 1)
  adds an N-day trek at once (shared `group_id`).
- **Travel days:** days with `location_id = null`. Presentation: a lightweight
  **"In transit"** pseudo-tab (or an always-visible lane) collecting unfiled
  days in date order. Adding a travel day is "+ add travel day."
- **Existing Lombok days** (all `location_id = null` after migration) appear as
  travel days / under "In transit" until the user files them into locations.

## Server actions (replacing / extending `actions.ts`)

- `createLocation(tripId, tripSlug, name)` — append at end `sort_order`.
- `renameLocation(locationId, tripSlug, name)`.
- `reorderLocations(tripSlug, orderedIds)` — `sort_order = index`.
- `deleteLocation(locationId, tripSlug)` — detaches days (FK `set null`).
- `addDay({ tripId, tripSlug, locationId | null, title, sub, tag, tone, count })`
  — computes the date, inserts `count` days (default 1) via the shift RPC,
  stamps a shared `group_id` when `count > 1`, updates `end_date`. Replaces the
  date-and-range `addItineraryDay` (count replaces the From/To range).
- `deleteItineraryDay` — gains the −1 cascade + `end_date` shrink (via RPC).
- `updateItineraryDay` — drops the date field; gains optional `location_id`
  reassignment.
- Reschedule action extended to carry `location_id` changes.

## Migration plan (idempotent, paste-and-run)

1. `create table if not exists itinerary_locations (...)` + RLS policies
   (`drop policy if exists` then `create`) + realtime publication add.
2. `alter table itinerary_days add column if not exists location_id ...`.
3. `create or replace function` for `insert_itinerary_day_shift` /
   `delete_itinerary_day_shift`.
4. No backfill: existing days keep `location_id = null` (become travel days).
   Existing **date gaps** in seed data are left as-is — the gapless rule only
   governs new adds; legacy data is not rewritten.

## Suggested build slices (for the plan step)

1. **Schema + locations CRUD + read/group UI.** Table, `location_id`, create /
   rename / reorder / delete locations, assign a day to a location, render the
   tab strip grouping existing days (all start as travel days). Keep today's add
   flow temporarily.
2. **Computed dates + cascade.** Switch add to "add day(s) into location" (count
   field, shared `group_id` for N>1) with the shift RPCs; retire the From/To
   range add and the per-day date picker; auto-manage `end_date`. The trek box
   keeps rendering, now inside a tab.
3. **Travel days + polish.** First-class "In transit" lane; spacing/visual pass.

## Decisions to confirm (review gate)

1. **Trip length is itinerary-driven.** For a dated trip, `end_date` becomes
   `start_date + dayCount − 1`. This overrides a manually-set end date as you add
   days. Intended per "adding a day extends the trip" — confirm you're happy that
   the trip's end follows the itinerary.
2. **Deleting a location keeps its days** (as travel days), rather than deleting
   them. Confirm that's the desired default.
3. **Legacy gaps stay.** Existing Lombok days keep their current (gappy) dates;
   only new adds are gapless. Confirm we don't need to re-flow existing data.

## Out of scope

- Locations for **dream** itineraries (no dates) — follow-up.
- "Delete location and all its days" in one action.
- Geocoding / map pins for locations (name is free text).
- Trek groups that span more than one location.
