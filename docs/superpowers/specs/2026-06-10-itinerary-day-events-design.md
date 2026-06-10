# Itinerary day events — design

**Date:** 2026-06-10
**Status:** Approved, ready for planning
**Scope:** Dated itinerary only (`itinerary_days`). Dream itinerary unchanged.

## Problem

An itinerary day holds a single free-text `sub` line (e.g. "Ferry 09:00. Refresher
dive + snorkel turtles."). Users want a day to carry **several events** — each a
small "time + text" entry — instead of cramming everything into one line.

## Decisions

- Each extra entry is a **mini event**: an optional time string plus a text line.
  Not a full nested day (no own tag/title/tone).
- Events **replace** the single `sub` field. The day keeps its title; the old
  `sub` becomes the first event on existing rows.
- **Time is optional; events auto-sort by time.** *(Superseded the original
  "manual order" call during implementation, at the user's request.)* Events
  render ascending by time; untimed events sort to the end keeping their relative
  order. Time is a free `"HH:MM"`-style string. On blur the form normalizes a
  typed time (`"11"` -> `"11:00"`, `"9:5"` -> `"09:05"`) and re-sorts. Sorting is
  a string compare on the zero-padded value, applied both in the form (on blur)
  and on the day card (on render), so it survives reload and Realtime.
- Storage is a dedicated **`events jsonb`** column (Approach A), not JSON packed
  into the text column.

## Data model

Migration (manual paste into Supabase SQL editor, idempotent):

- `alter table itinerary_days add column if not exists events jsonb not null default '[]'::jsonb`
- Backfill: for rows where `sub` is non-empty and `events = '[]'`, set
  `events = jsonb_build_array(jsonb_build_object('time', '', 'text', sub))`.
- `sub` column is left in place (vestigial) to keep the migration non-destructive;
  code stops reading or writing it. Dropping it is a later cleanup, not part of
  this work.

Each event element: `{ "time": string, "text": string }`. `time` may be `""`.
Array order is display order.

### Types (`src/lib/trips/itinerary-types.ts`)

- New `export interface ItineraryEvent { time: string; text: string }`.
- `ItineraryDay.sub: string` → `events: ItineraryEvent[]`.
- `ItineraryRow.sub: string | null` → `events: unknown` (raw jsonb), parsed in
  `rowToItineraryDay` into `ItineraryEvent[]` (default `[]` when missing/malformed).

## Server actions (`src/lib/trips/actions.ts`)

`addItineraryDay`, `updateItineraryDay`, `insertItineraryDayWithShift` take
`events: ItineraryEvent[]` in place of `sub`. Each:

- trims `text` and `time` on every event,
- drops events whose `text` is empty after trim,
- writes the resulting array to the `events` column.

The `shift_and_insert_itinerary` RPC param `p_sub text` becomes `p_events jsonb`;
the function inserts it into the `events` column. (Manual SQL, idempotent via
`create or replace function`.)

`.select(...)` projections that listed `sub` now list `events`.

## Form (`DayForm` in `itinerary-tab.tsx`)

- Remove the single "Sub" `<input>`.
- Add an **Events** section below Title: a list of rows, each = a narrow time
  input (`placeholder="09:00"`, optional) + a flex text input + a `×` remove
  button. Empty list is allowed.
- Footer row changes from `justify-end` to `justify-between`:
  - **left:** `+ add event` button (`type="button"`) — appends a blank
    `{ time: "", text: "" }` row to local state.
  - **right:** `cancel` and `save` as today.
- Local state holds `events` as an array; each row gets a client-only `key`
  (e.g. a `crypto.randomUUID()` generated on add / when seeding from props) so
  removing a row doesn't scramble controlled inputs. The persisted shape is
  `{ time, text }` only.
- `DayEditor` seeds events from `day.events`; the add form seeds `[]`.
- Save validity unchanged (still gated on `title` + `tag`); events are optional.

## Day card (`itinerary-tab.tsx`)

Replace the single muted `day.sub` line with the events list: one line per event,
`time` in mono/muted (omitted when blank) followed by `text`. No events → render
nothing, same as an empty sub today.

## Out of scope

- Drag-to-reorder events within a day. *(Discussed during implementation and
  deferred: the drag mechanics are cheap — dnd-kit is already wired and `events`
  is a stored ordered array — but it conflicts with auto-sort-by-time, which is
  the real decision. Revisit if needed.)*
- The dream itinerary (`dream_itinerary_days`) — keeps its single `sub`.
- Dropping the now-unused `sub` column.
