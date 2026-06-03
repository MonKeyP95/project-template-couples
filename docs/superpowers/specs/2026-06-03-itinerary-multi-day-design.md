# Itinerary multi-day entries — design

**Date:** 2026-06-03
**Status:** approved

## Problem

Adding a multi-day activity (e.g. a 3-day trek) to the itinerary means typing
the same entry once per day. The user wants to add a span once and get one
entry per day, where each day's entry is then **fully independent** — editable
and deletable on its own, with no grouping or linking.

## Scope

Both itineraries get the feature:

- **Dated itinerary** (`itinerary_days`, unique per `(trip_id, day_date)`):
  the Add-day form gains an optional **end date**.
- **Dream itinerary** (`dream_itinerary_days`, ordered by `day_index`, no
  dates): the Add-day form gains a small **days count**.

Out of scope: grouping/linking entries, "day 1 of 3" labels, editing a span as
a unit. Editing stays strictly per-day. No schema migration — only more rows
into existing tables.

## Design

### Dated itinerary

- Add-day form: the single Date field becomes **"from"**, with a new optional
  **"to"** field beside it. Blank "to" → one entry (today's behaviour). "to"
  later than "from" → one identical entry per calendar day in `[from, to]`.
- `addItineraryDay` gains an optional `endDate`. When present and `> dayDate`,
  it enumerates every date in the inclusive range and inserts them in one bulk
  `insert([...])`.
- Each inserted row is an ordinary `itinerary_day`. After creation the days are
  fully independent (edit / delete / reschedule one without touching the rest).
- **Collision:** the `(trip_id, day_date)` unique constraint makes the bulk
  insert all-or-nothing. If any date in the range is already planned, nothing
  inserts and the action returns *"Some days in that range are already
  planned."*
- **Validation:** `end >= start`; range capped at **31 days** so a typo cannot
  insert hundreds of rows.
- The Edit form is unchanged (per-day only).

### Dream itinerary

- Add-day form gains a small **"days"** number field (default 1).
- `addDreamItineraryDay` gains an optional `count` (default 1, capped at 31).
  It inserts `count` identical rows at `day_index = max+1 .. max+count`.
- No collision concern — `day_index` only appends.

### Wiring

Both actions keep their existing `revalidatePath` + Realtime channels, so new
entries propagate to both partners exactly as single adds do today. The bulk
insert fires N INSERT events; the existing Realtime handlers dedupe by `id` and
re-pad ordinals.

## Approach chosen

Extend the two existing add-actions (vs. new range-specific actions, or a
client-side add loop). Smallest change, reuses all validation/revalidation/
Realtime, and a single insert means no partial-failure state.

## Addendum (2026-06-03): visible "added together" grouping

The original design made each multi-day entry fully independent with no link.
Follow-up request: show a mark that the days of one span (e.g. a 3-day trek)
were created together. Chosen approach is a nullable `group_id` on
`itinerary_days` — the only option whose marker survives per-day edits.

- **Schema:** `alter table public.itinerary_days add column if not exists
  group_id uuid;` (nullable, no index, inherits existing RLS).
- **Action:** `addItineraryDay` stamps one fresh `crypto.randomUUID()` on every
  row of a 2+ day span; single-day adds leave `group_id` null.
- **Threading:** `group_id` flows through `ItineraryRow`/`ItineraryDay`
  (`groupId`), `rowToItineraryDay`, the query `.select`, and the Realtime row.
- **UI:** the dated itinerary groups the sorted days into maximal runs of
  consecutive same-`group_id` days; a run of 2+ is wrapped in a fine rounded
  border with a small "added together" caption. Single days render as today.
- **Edge behavior:** editing a day keeps its `group_id` (line survives edits).
  Moving a day out of the run breaks contiguity so the border skips it without
  clearing `group_id`. Pre-existing rows have null `group_id` and show no line.
- Scope: dated itinerary only. The dream itinerary keeps its current ungrouped
  multi-add; grouping can follow later if wanted.
