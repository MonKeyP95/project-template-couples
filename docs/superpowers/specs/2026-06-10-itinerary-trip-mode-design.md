# Itinerary during-trip mode — design

**Date:** 2026-06-10
**Status:** Approved, ready for planning
**Scope:** Itinerary tab only (dated trips). A pilot for a possible wider
"during-trip" treatment; other tabs (home/packing/budget) are out of scope.

## Vision

A trip in progress has different needs than one being planned. Today's plan
matters most; what's already happened should stay (not be deleted) but get out of
the way; what's coming should be a tidy preview. The itinerary should *emphasize
differently* based on the trip state the app already knows — not become a second
UI. Locations remain the backbone throughout.

## Two layers per day

Each day carries two levels of detail:

- **`sub`** — a one-line summary of the day ("Ferry over, dive, sunset"). The
  at-a-glance view. Reuses the existing `itinerary_days.sub` column (kept
  vestigial by the mini-events change; now read/written again). No migration for
  this layer.
- **`events`** — the detailed timed/untimed plan (the `events jsonb` array from
  the mini-events feature).

A day card has two display states:

- **Collapsed** — shows the `sub` summary line.
- **Expanded** — shows the full `events` list.

The detailed events are always a drill-down; they never clutter the overview.
**Tap any day to toggle** its state.

**Collapsed fallback:** if a day has events but an empty `sub`, the collapsed card
shows a cheap derived hint — the first event's text, or "N events" — rather than
appearing blank. A true *auto-summary* of events is an AI task and is deferred to
Phase 5.

## During-trip emphasis (three zones)

When the trip is `now` (today is within its dates), the itinerary reads
top-to-bottom past -> present -> future, but **always grouped by location**:

```
> Past · Lombok, Kuta            (collapsed bar — fully-completed locations)
----------------------------------
Gili Trawangan        (current location — open)
   day 2 — settle in           (past day, dim, inline)
   day 3  · TODAY · 28°        (expanded, full events)
   day 4 — free morning        (future day, sub summary) >
----------------------------------
Senggigi   14–16 Jun           (future location — collapsed) >
[ + add day   + add location ]  (receded to bottom, muted)
```

- **Past bar** — only locations whose *every* day is before today collapse into
  this bar. It is collapsed by default; tapping opens it to reveal those
  completed locations, still as location groups you can drill into. Nothing is
  deleted. Loose past days never go here — only whole completed locations (per
  the "locations are the backbone" rule).
- **Current location** — the location whose span contains/straddles today. It
  stays whole and open. Inside it, past days dim inline (per-day), today's day is
  expanded and prominent, later days in the same location show as summaries.
- **Future locations** — all-after-today locations render as collapsed groups
  with day summaries; tap to peek ahead.
- **Planning affordances** (`+ add day`, `+ add location`) recede to the bottom,
  muted.

Dimming of completed items reuses the `/home` precedent (`opacity-60`).

## Outside a trip

For `upcoming` / `past` / `dream` states there is **no Past bar and no
auto-expansion**: the itinerary is the tidy collapsed-summary timeline with the
planning affordances prominent. Tap a day to expand its events. (This is the
normal planning view; the during-trip behavior is purely additive.)

## Zoning rules

- `today` = server-computed ISO `yyyy-mm-dd`, same derivation `/home` uses.
- Trip state via the existing pure `deriveState(today, start, end)`.
- A **day** is past / today / future by `dayDate` vs `today` (string compare).
- A **location's** zone from its date span vs `today`:
  - all days before today -> Past bar (completed),
  - span contains or straddles today -> current (stays whole, open),
  - all days after today -> future (collapsed).
- Edge: if today has no day (a gap/transit day, or no itinerary entry for today),
  there is simply no expanded today-card; locations still zone by their spans, so
  the past/future split is unaffected.

## Mechanics

**DB.** The `sub` column already exists — the summary layer needs no migration.
The one DB change: the `shift_and_insert_itinerary` RPC currently takes
`p_events` only; re-add `p_sub text` so days created via the push-forward path
carry a summary. Small idempotent `drop function ... + create or replace`
migration that writes both `sub` and `events` on the inserted rows.

**Form.** `DayForm` re-gains an optional **Summary** field (single-line input)
between Title and the Events section. A day is Title + Summary + Events.

**Server actions.** `addItineraryDay`, `updateItineraryDay`, and
`insertItineraryDayWithShift` take `sub: string` again alongside `events`, trim
it, and write the `sub` column. (`AddItineraryDayInput` / `UpdateItineraryDayInput`
regain `sub`.)

**Expand/collapse state is client-only, not persisted.** Ephemeral UI state in
the tab, extending the location-group collapse state that already exists. On load
it resets to sensible defaults derived from the date:

- during a trip -> Past bar collapsed, current location open with today expanded,
  future locations collapsed;
- outside a trip -> everything collapsed summaries.

No new table, no persisted flag, no flicker.

**Component shape.** The day card body splits into a collapsed (`sub`) vs
expanded (`events`) view toggled by tap — mirroring the existing
`DayView` / `DayEditor` split so it stays in the repo's React-19-friendly pattern
(no set-state-in-effect).

**Today detection wiring.** The tab receives `today` (server-computed) and the
trip's start/end (already on the header) so it can call `deriveState` and zone
days/locations. No client clock dependence beyond the passed-in `today`.

## Out of scope (deliberately)

- AI auto-summary of a day's events (Phase 5).
- During-trip treatment on home / packing / budget — revisit after this pilot.
- Weather / location-notes / today's-spend on the today card.
- Per-event "dim what's already happened by clock time" inside today — a
  nice-to-have, easy to add later.
- Persisting expand/collapse state across reloads (defaults are re-derived).
