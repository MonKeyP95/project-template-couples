# Restaurant discovery — Slice C: accept-to-event

**Date:** 2026-07-07
**Status:** designed (not built)
**Depends on:** Slice B (both discovery doors shipped 2026-06-29) — see
`docs/superpowers/specs/2026-06-29-restaurant-discovery-design.md` §3–§6.

## Why

Slice B already appends a bare event on accept (`"Dinner · <name>"` via
`addTodayEvent`), so C is not "make accept exist" — it is "make an accepted pick
worth keeping." Two gaps the B spec deferred:

1. **Provenance is lost.** `ItineraryEvent` is `{ time, text }`. The moment you
   accept, the source URL / area / price vanish. There is no in-app booking — the
   user books themselves — so the source link is exactly what they need to keep,
   and today it is thrown away.
2. **No date/time control on accept.** The road door drops onto today untimed;
   the planning door drops onto the location's earliest day untimed. The user
   wants the *option* to set a day and a time at accept time.

## Decisions (from brainstorming 2026-07-07)

- **Keep the source link** — it is how the user goes and books. Store it on the
  event.
- **The link is a plain itinerary capability, not an AI-only path.** Any event
  can carry an optional link, hand-editable in the normal day editor. AI-off
  users get the same capability; the AI door just pre-fills it. ("Without AI is
  preferable.")
- **Cheapest wins.** `events` is already a `jsonb` column, so adding an optional
  field to the event shape is **no migration** — a pure code change.
- **Optional date + time on accept**, defaulting to the day you are on
  (road = today; planning = the selected location's earliest day).

## Scope

In:

1. Extend the itinerary event model with an optional `url`.
2. Surface + edit the link in the normal day editor and on day cards (AI-off
   included).
3. Inline accept confirm (optional time; mode-aware date) on both discovery
   doors, writing the link onto the event.

Out (YAGNI / deferred):

- The link in the public `/t/` shared projection (`shared-trip-types.ts` /
  `shared_trip` RPC). Public page stays link-less for now.
- Any URL validation or normalization — store the string as-is; render as a link
  only when non-empty.
- Slice D (good/bad feedback).

## Design

### 1. Event model — optional `url` (no migration)

`ItineraryEvent` in `src/lib/trips/itinerary-types.ts`:

```ts
export interface ItineraryEvent {
  time: string        // free "HH:MM"-style label; "" when untimed
  text: string
  url?: string        // optional source/booking link; omitted when absent
}
```

`parseEvents` gains one tolerant line — read `url` only when it is a non-empty
string, otherwise leave it undefined:

```ts
.map((e) => ({
  time: typeof e.time === "string" ? e.time : "",
  text: typeof e.text === "string" ? e.text : "",
  ...(typeof e.url === "string" && e.url.length > 0 ? { url: e.url } : {}),
}))
```

Because the column is `jsonb`, existing rows read back unchanged (no `url` key),
and new writes just include the extra key. No SQL, no backfill.

`shared-trip-types.ts` has its own `parseEvents` (public projection) — **left
untouched**; the shared page simply won't render a link. Noted as deferred so the
divergence is intentional, not an oversight.

### 2. Hand-editable link + day-card rendering

- **Editor (`DayForm`, inside `src/app/trips/[slug]/itinerary-tab.tsx`).** Each
  event row already has a time input + text input + remove. Add one optional
  **link** input to the right. The row's submitted event object becomes
  `{ time, text, url }` (url omitted/empty when blank). No action change — the
  editor already passes `events: ItineraryEvent[]` straight through
  `addItineraryDay` / `updateItineraryDay` to the `jsonb` column.
- **Day card (the read view that renders the sorted event list).** When an event
  has a `url`, render a small `↗ source` link (new tab, `rel="noreferrer"`) after
  the event text. Absent `url` → nothing extra. Events still auto-sort by time as
  today.

### 3. Accept UX — inline confirm, mode-aware date

Both doors change accept from immediate to a compact inline confirm revealed on
the first tap. Confirm commits; `✕` cancels back to the row.

**On the road (`src/app/on-the-road/find-a-place.tsx`).**
Tap `add to today` → reveal an optional **time** input + `add` / `✕`. Commit:

```
addTodayEvent({
  tripId, tripSlug,
  dayDate,           // today (unchanged)
  dayId,             // today's day or null (unchanged)
  time,              // from the input; "" if left blank
  text: `${label} · ${s.name}`,
  url: s.sourceUrl,
})
```

Date stays today (fixed) — the road door's whole premise is "tonight."

**Planning (`src/app/trips/[slug]/find-a-place-planning.tsx`).**
Tap `add` → reveal a **day picker** (a `<select>` of that location's existing
days, labelled e.g. `Day 2 · 5 Jul`, default = earliest) + optional **time** +
`add` / `✕`. Commit `addTodayEvent` with the chosen day's `dayDate` + `dayId`,
`text: "Dinner · <name>"`, `url: s.sourceUrl`, and the entered time.

Using a picker of the location's *existing* days (not a free date input)
guarantees the event stays filed under the location — a free date with no
matching day would make `addTodayEvent` create a location-less day, dropping the
pick outside the location the user was browsing. The "add a day first" disabled
state (location with zero days) is unchanged.

### 4. Actions

Only one action changes:

- `addTodayEvent` + `AddTodayEventInput` (`src/lib/trips/actions.ts`) gain an
  optional `url`, threaded onto the single event it builds
  (`newEvent = { time, text, ...(url ? { url } : {}) }`). Both doors already
  route through this action, so this one change serves both.

`addItineraryDay` / `updateItineraryDay` need no change — they already accept
`events: ItineraryEvent[]` and write it to `jsonb`, so the manual editor's link
input persists automatically once the type carries `url`.

## Files touched

- `src/lib/trips/itinerary-types.ts` — `ItineraryEvent.url?`, `parseEvents`.
- `src/lib/trips/actions.ts` — `addTodayEvent` / `AddTodayEventInput` optional
  `url`.
- `src/app/trips/[slug]/itinerary-tab.tsx` — `DayForm` link input; day-card link
  render.
- `src/app/on-the-road/find-a-place.tsx` — inline time confirm; pass `url`.
- `src/app/trips/[slug]/find-a-place-planning.tsx` — inline day-picker + time
  confirm; pass `url`.

No new files, no dependency, no migration.

## Two-modes check

- **Planning:** accept → pick which day + optional time; the source link is saved
  so you can go book/verify days later. Ordinary event afterward.
- **On the road:** accept → one extra tap for tonight's time; same link saved for
  the walk over. Ordinary event afterward.
- Identical result whether AI is on or off; the link is editable by hand either
  way.

## Acceptance

- Accepting a pick (either door) creates an itinerary event that shows the
  restaurant name, the chosen time (if any), and a working `↗ source` link.
- The event is indistinguishable from a hand-entered one and fully editable in
  the normal day editor — including adding/changing/clearing the link with AI
  off.
- Planning accept lands the event under the browsed location's chosen day; never
  creates a location-less day.
- Old events (no `url`) render and edit exactly as before.
- Verified on a 390px phone viewport.
