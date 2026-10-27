# One trip model: a dream is a trip without dates

Status: design only, not scheduled. Written 2026-10-27 to be picked up later.

## Intent

A dream should be exactly a trip, minus the dates. Today it is a weaker copy:
its days live in a separate table (`dream_itinerary_days`), render in a
separate 693-line screen (`dream-itinerary-tab.tsx`), have no events, no
locations and no multi-day blocks, and need their own planner agent and actions.
Every itinerary feature is built twice, and "add dates to a dream" copies rows
between tables.

The user's vision, in their words: "if i plan a dream it is the same as a trip
just without dates." No date, no today, no start date, no on-the-road for a
dream. A dream's day is stored as "Day 1 of Surf dream", never as a hidden or
fake date (the user rejected placeholder dates: "it feels wrong").

The fix: **every trip's days are stored by day number.** A trip with a start
date shows Day N as `start_date + N - 1`; a trip without one shows "Day N".
One table, one screen, one set of actions, for both.

## Goals

- One itinerary model. `itinerary_days` keyed by `(trip_id, day_index)`, used
  by dated trips and dreams alike.
- A dream gets everything a trip has: events, locations, location spans,
  multi-day blocks, drag, confirm-and-push, the "Plan your itinerary" walk.
- Adding dates to a dream sets `start_date`. No rows move.
- Removing dates from a trip (back to a dream) clears `start_date`. No rows
  move, nothing is lost. (Today a dated trip turned dream keeps orphaned
  dated rows.)
- Delete the dream-only code path: table, screen, actions, queries, types,
  agent, promotion RPC.
- Once done, build the original request once for both kinds of trip: drag a
  planned day onto **any** day of the trip, including an empty one.

## Non-goals

- No change to anything that is a real calendar fact rather than an itinerary
  position. These keep their own `day_date` and are untouched: `expenses`,
  `trip_notes.day_date` (when a note was written, mirrors expenses),
  receipts/documents `entries` dates, `trip_dispatch`, `trip_suggestions`,
  weather, on-the-road "today".
- No visible change to a dated trip's itinerary. Same screen, same dates shown.
- No new features beyond drag-to-any-day and the date-change questions with
  unplaced days (steps 5-6).

## Anti-goals (failure even if it "works")

- Any date shown on a dream, anywhere, including "1 Jan 2000"-style leaks.
- Placeholder or fake dates stored for dreams.
- Two kinds of day in one table (some keyed by date, some by number). That just
  moves the fork inside the table; it is what DECISIONS row 110 warned about.
- A big-bang switch. Each step ships and is checked in-app before the next.

## Changing a trip's dates (decided with the user 2026-10-27)

There is no single right answer, so the app asks. When a trip with planned
days gets a new start date, it asks:

- **Move the plan with the new dates** ("the whole trip moved"): `day_index`
  unchanged; Day 1 is simply the new start date.
- **Keep days on their dates** ("we leave 2 days earlier, everything is
  booked"): every `day_index` shifts by the difference; new empty days appear
  at the start. The user stretches a location over them themselves (my guess;
  not automatic).

Today only "keep the dates" exists, so this is an improvement.

**Days that fall outside the trip.** Three ways a planned day can end up
outside the trip, all handled the same:

1. the start moves later with "keep days on their dates",
2. the end moves earlier,
3. a dream's day count is reduced.

The app asks: **delete them** or **keep them as unplaced**. Empty days (no
content) are not asked about; they just go.

**Unplaced days.** An unplaced day keeps its content (title, sub, events,
location) and has `day_index = null`. It shows in a small "Unplaced" list near
the itinerary and goes back by dragging it onto any empty day (step 5's drag).
This is the one exception to "every day has a number"; keep it strict: every
sort, push, span and reorder path filters to `day_index is not null`, so an
unplaced day is never moved or ordered by accident. The `(trip_id, day_index)`
unique constraint allows many nulls, as Postgres does by default.

## The model

- `itinerary_days.day_index int not null`, 1-based, unique per trip
  (deferrable, like today's `(trip_id, day_date)` constraint, so reorders can
  swap). `day_date` is dropped at the end.
- `itinerary_locations.start_index` / `end_index` replace `start_date` /
  `end_date` (same both-or-neither, end >= start check).
- Trip length: `trips.day_count` becomes the single source of length for every
  trip. `end_date` stays as a stored column for the ~25 readers that use it
  (home cards, on-the-road, budget pace, dispatch), always written as
  `start_date + day_count - 1` by the same writes that change length. Null for
  dreams. *Builder's call is fine here if a cleaner option appears, as long as
  no reader of `end_date` breaks.*
- Auto-grow: today a push or span past the end grows `end_date`. It now grows
  `day_count` (and `end_date` with it when dated).
- The start-date floor ("can't add a day before the trip starts") becomes
  `day_index >= 1`.

## Read path

When a dated trip's days are loaded, each day's `dayDate` is derived once
(`start_date + day_index - 1`) so the existing screen code keeps receiving
dates. A dream's days have no `dayDate`; the screen shows "Day N". Location
spans likewise: derive dates for a dated trip, show "Day 3-6" for a dream.

Every place that reads an itinerary day's date as a calendar date (today,
past-dimming, "earlier days", weather, documents-today, dispatch, on-the-road)
must already be off for a trip with no `start_date`. Audit each one when
switching dreams over; none may produce a date for a dream.

## Write path

Every itinerary write takes a day number. Callers that today pass a date on a
dated trip convert once (`date - start_date + 1`). The five database functions
that move days are rewritten on `day_index`:

- `shift_and_insert_itinerary` (confirm-and-push)
- `set_location_span_with_shift`
- `reschedule_itinerary_days` and `reschedule_itinerary_days_to` (drag)
- `shared_trip` (share view; reads days and `day_count`)

Deleted: `reschedule_dream_itinerary_days`, `promote_dream_to_dated`.

AI: the trip `itinerary-planner` and the "Plan your itinerary" walk work in
day numbers, with real dates passed as context when the trip has them. The
`dream-itinerary-planner` agent and `src/lib/ai/dream-plan.ts` /
`dream-itinerary-actions.ts` are deleted. The walk's existing Day 1..N picker
(built for dreams) becomes the one picker; dated trips label it with dates.

## Steps (each shipped and checked in-app before the next)

1. **Add the number alongside the date.** Add `day_index` to `itinerary_days`
   and `start_index`/`end_index` to `itinerary_locations`; backfill from dates
   (`day_date - trips.start_date + 1`); backfill `trips.day_count` for dated
   trips. Writes keep both in sync. Nothing changes on screen.
   Backfill edge cases (Claude's call): a dated trip's `day_count` is
   `max(end_date - start_date + 1, highest day_index)`; an older dream with no
   `day_count` gets its current number of days. Before backfilling, query for
   any day dated before its trip's start (would give `day_index < 1`); if any
   exist, stop and ask the user rather than guess.
2. **Switch dated trips to numbers.** Reads derive dates from `day_index`;
   writes and the five functions work on numbers. Riskiest step:
   confirm-and-push and spans live here. Dated trips must look and behave
   exactly as before.
3. *(Split 2026-10-27 into 3a: the itinerary screen and actions place days by number, no visible change; and 3b: the walk and AI planner in numbers, plus the rest of this step.)* **Move dreams in.** Copy `dream_itinerary_days` into `itinerary_days`
   (`day_index` carries over; `sub` and tone carry over; no events). The dream
   page renders the trip itinerary with "Day N" labels. Run the date-leak
   audit.
4. **Delete the dream path.** Drop `dream_itinerary_days`, the dream screen,
   actions, queries, types, agent, `promote_dream_to_dated`; drop
   `itinerary_days.day_date` and the location date columns. Adding dates to a
   dream is now just setting `start_date`.
5. **Drag to any day.** All `day_count` positions render as drop targets,
   empty ones included, for dreams and trips alike.
6. **Date changes ask; unplaced days.** The start-date question (move plan /
   keep dates) and the delete-or-unplace question for days that fall outside
   the trip, with the Unplaced list and drag back in. Makes `day_index`
   nullable. Comes last because it needs step 5's drag.

Migrations follow the repo rules: hand-pasted, re-runnable, one shared
database for dev and prod, so each step's code must work against the schema
the moment it is pasted.

## Decisions to record when built

- Supersedes DECISIONS row 110 (separate `dream_itinerary_days` table) and row
  106 (itinerary stays empty for dreams).
- Supersedes the memory note "empty days stay derived, not day cards": under
  this model every one of the trip's `day_count` positions is a real slot.

## Left to the builder

- Exact SQL of the rewritten functions, as long as behaviour is unchanged.
- Whether `withOrdinals` / `withDreamOrdinals` merge (they should end as one).
- How the screen code takes "date or Day N" for a label.

## Success criteria

Verified by Claude (each step):
- `pnpm build`, `pnpm lint`, `tsc --noEmit` clean.
- Step 1: after backfill, for every dated trip, `start_date + day_index - 1 =
  day_date` for every day (query returns zero mismatches).
- Step 2: the five functions produce the same day order and `end_date` as
  before for push, span and drag (checked by query on a throwaway trip).
- Step 3: every dream's day count and order in `itinerary_days` matches
  `dream_itinerary_days` before deletion.
- Step 4: no source file references `dream_itinerary_days`, `day_date` on
  itinerary days, or the deleted modules.
- Step 6: a push, span change or reorder on a trip with unplaced days leaves
  every unplaced day's `day_index` null (checked by query on a throwaway
  trip).

Verified by the user in-app:
1. A dated trip's itinerary looks and behaves as before: add, push, spans,
   drag, planner walk, Generate.
2. A dream shows Day 1..N with events, locations and multi-day blocks, and no
   date anywhere.
3. Adding dates to a dream shows the same plan on real dates; removing them
   shows Day 1..N again with nothing lost.
4. Changing a trip's start date asks "move the plan or keep dates"; each
   choice does what it says.
5. Dragging a day onto an empty day works on both a dream and a trip.
6. Moving the start later (keep dates), moving the end earlier, or reducing a
   dream's days asks "delete or keep as unplaced" for planned days that fall
   outside; unplaced days appear in the Unplaced list and drag back onto an
   empty day with their content intact.
6. Home still files dateless trips under Dreams; on-the-road, weather and
   dispatch ignore dreams.
