# Restaurant discovery — Slice D: feedback capture (1–5 + note)

**Date:** 2026-07-07
**Status:** designed (not built)
**Depends on:** Slice C (accept-to-event, shipped 2026-07-07) — the event model
and `jsonb` events array it extended.
**Parent spec:** `docs/superpowers/specs/2026-06-29-restaurant-discovery-design.md` §5.

## Why

The discovery agent's long-term value is learning the couple's tastes. Slice D
captures that signal: a **1–5 rating plus an optional note** on a **past** event.
v1 only **stores** it; feeding it back into discovery ranking is deferred (that
needs the history/learning layer).

Two decisions from brainstorming (2026-07-07) reshape the original §5 sketch:

- **Any past event is rateable, not just AI-suggested restaurants.** Slice C
  made accepted picks indistinguishable from hand-entered events (deliberately —
  "plain itinerary, not AI-locked"), so there is no "this came from the AI" flag,
  and re-adding one would reverse that choice. More importantly, the broader
  signal is valuable: a quiet remote beach vs a busy one is exactly the kind of
  preference worth learning. So rating applies to **any** event.
- **1–5 + note, not good/bad.** A scale plus a free note captures nuance the
  binary can't (e.g. "loved it, very quiet").

## Decisions

- **Rating = 1–5; note = optional free text; default = unrated.** Storable and
  clearable back to unrated.
- **Cheapest, no migration.** `events` is `jsonb`; add optional `rating?` and
  `note?` to the event shape — same pattern as Slice C's `url`.
- **Post-experience only.** Rating shows only on events that have already
  happened — never future ones. Two surfaces (option 2 from brainstorming):
  - **Itinerary, past days** (date before today) — for review, during or after a
    trip.
  - **On-the-road, today's already-passed events** — rate tonight's dinner
    tonight, while it's fresh.
- **One shared rating per event** (either partner can set/edit). Per-partner
  ratings deferred.
- **Not in the planning editor.** `DayForm` stays about planning (time/text/link);
  rating is a separate review action.

## Scope

In:

1. Optional `rating?: number` (1–5) and `note?: string` on the itinerary event
   model + tolerant parse.
2. A `rateEvent` server action that writes rating/note onto one event.
3. A shared `EventRating` client editor (stars + note).
4. Two mount points: itinerary past-day events; on-the-road today's-passed events.
5. **Preserve rating/note through every event-array rewrite** (invariant).

Out (YAGNI / deferred):

- Using ratings to bias discovery search (the learning layer).
- Per-partner ratings; rating whole days; showing the note inline on day cards
  (v1 shows the star count inline, the note lives in the editor).
- Ratings in the public `/t/` projection.

## Design

### 1. Event model — optional `rating` + `note` (no migration)

`ItineraryEvent` (`src/lib/trips/itinerary-types.ts`):

```ts
export interface ItineraryEvent {
  time: string
  text: string
  url?: string          // Slice C
  rating?: number       // 1–5; omitted when unrated
  note?: string          // optional free note; omitted when empty
}
```

`parseEvents` reads them tolerantly — `rating` only when it is a number in 1..5,
`note` only when a non-empty string:

```ts
    .map((e) => ({
      time: typeof e.time === "string" ? e.time : "",
      text: typeof e.text === "string" ? e.text : "",
      ...(typeof e.url === "string" && e.url.length > 0 ? { url: e.url } : {}),
      ...(typeof e.rating === "number" && e.rating >= 1 && e.rating <= 5
        ? { rating: Math.round(e.rating) }
        : {}),
      ...(typeof e.note === "string" && e.note.length > 0 ? { note: e.note } : {}),
    }))
```

Old rows (no keys) read back unchanged. No SQL.

### 2. Persistence — `rateEvent` action

New action in `src/lib/trips/actions.ts`:

```ts
export interface RateEventInput {
  tripSlug: string       // for revalidate; the action needs no tripId
  dayId: string
  eventIndex: number     // index within the day's time-sorted events
  rating: number | null  // 1–5, or null to clear back to unrated
  note: string           // "" clears the note
}
export async function rateEvent(input: RateEventInput): Promise<{ error?: string }>
```

Behaviour: load the day's `events`, **sort them with the existing `sortDayEvents`
(time ascending, untimed last)** — the same order every surface renders — apply
`rating`/`note` to the event at `eventIndex`, write the sorted array back,
`revalidatePath(/trips/<slug>)`. Sorting in the action is what makes `eventIndex`
reliable regardless of the stored order; the sort is deterministic and order is
cosmetic, so writing back sorted is harmless. `rating: null` removes the `rating`
key; `note: ""` removes the `note` key. All other fields on every event are
preserved.

**Event identity.** Events are a `jsonb` array with no stable ids. The rating
rides **on the event object**, addressed by its index in the day's **time-sorted**
array. Every surface must derive `eventIndex` from the *full* day's sorted events
(not a subset — see §6) so it lines up with the action's sort. Editing a day
re-indexes, but because rating/note are fields on the object they move with it.
Concurrent edits are last-write-wins — acceptable for a two-person workspace.

### 3. Preserve rating/note through every rewrite (INVARIANT)

Because rating/note live on the event object, any code that rebuilds an event
array field-by-field must copy them, or a later edit wipes them. Mirror exactly
what Slice C did for `url` at each site:

- **`addTodayEvent`** (existing-day merge `.map`): also spread `rating`/`note`
  from each existing event.
- **`DayForm` editor** (`itinerary-tab.tsx`): `EventDraft` gains pass-through
  `rating?`/`note?` (not editable in the form); `toEventDrafts` carries them; both
  submit maps (`DayEditor`, `DayCreator`) re-include them. The planning form never
  shows or changes rating — it just must not drop it on save.
- **`rateEvent`** itself: preserves all other fields (per §2).
- The reschedule / shift RPCs move whole day rows (they don't rebuild event
  objects), so ratings survive there with no change.

### 4. Shared editor — `EventRating`

New client component `src/components/event-rating.tsx`:

```ts
export function EventRating(props: {
  tripSlug: string
  dayId: string
  eventIndex: number
  rating?: number
  note?: string
}): JSX.Element
```

(No `tripId` — `rateEvent` addresses the day by `dayId` and revalidates by
`tripSlug`, so `DayView` needs no extra plumbing beyond `today`.)

- **Collapsed:** if rated, show the star count (e.g. `★★★★☆`) as a tap target; if
  unrated, a subtle `☆ rate` affordance.
- **Expanded (on tap):** a 5-star picker (tap a star = that value; a small
  `clear` returns to unrated), an optional single-line **note** input, and
  `save` / `cancel`. `save` calls `rateEvent` then `router.refresh()`; errors
  surface inline.
- Lives in `src/components/` so both the itinerary (`trips/[slug]`) and the
  on-the-road page can import it. It calls the `rateEvent` server action directly
  (same pattern as the doors calling `addTodayEvent`).

### 5. Surface A — itinerary past days

In `DayView` (`itinerary-tab.tsx`), thread the server `today` (already available
in the tab; currently only `dimBefore` — which is null when the trip isn't
active — reaches `DayView`). When `day.dayDate < today`, render `<EventRating>`
per event after its text/link, passing `eventIndex` = the event's index in the
sorted list `DayView` already maps. Future/today days render no rating.

This covers both an **active** trip (past days in the past-fold) and a **finished**
trip being reviewed (all days are past). A future trip in planning has no past
days, so nothing shows — correct for the two-modes rule.

### 6. Surface B — on-the-road, today's passed events

`TodayUpcoming` (`today-upcoming.tsx`) shows only *upcoming* events
(`e.time >= now`); passed events are filtered out. Slice D adds a sibling client
list — a small **"Looking back"** block on `/on-the-road` — of today's
**already-passed** timed events (`e.time < now`), reusing the existing
`useLocalHhMm` client-clock pattern (null on the server → no hydration mismatch).
Each row renders `<EventRating>`.

`EventRating` needs each event's index in the **full** day's time-sorted array,
not the passed subset. So sort `todayDay.events` (same `sortEvents`), tag each
with its full-array index, then filter to the passed ones — carrying that index —
for display. That index matches the action's sort (§2). Because the itinerary
rates strictly past days (`< today`) and on-the-road rates today's passed events,
the two never overlap; tomorrow, today's events become past-day rows on the
itinerary and are rateable there — consistent.

## Files touched

- `src/lib/trips/itinerary-types.ts` — `rating?`/`note?` on `ItineraryEvent`;
  `parseEvents`.
- `src/lib/trips/actions.ts` — `rateEvent` + `RateEventInput`; preserve
  rating/note in `addTodayEvent`'s merge map.
- `src/components/event-rating.tsx` — new shared editor.
- `src/app/trips/[slug]/itinerary-tab.tsx` — `EventDraft`/`toEventDrafts`/both
  submit maps carry rating/note; `DayView` threads `today` and renders
  `EventRating` on past-day events.
- `src/app/on-the-road/page.tsx` + new `src/app/on-the-road/today-past.tsx` —
  the "Looking back" passed-events list with `EventRating`.

No new dependency, no migration.

## Two-modes check

- **On the road:** rate tonight's dinner tonight from the "Looking back" list.
- **Reviewing (during or after a trip):** rate past days on the itinerary.
- **Planning a future trip:** no past events exist, so no rating UI — correct.

## Acceptance

- A past event (itinerary) and a today-passed event (on-the-road) each show a
  rate affordance; tapping expands a 5-star picker + note; saving persists and the
  collapsed view shows the stars.
- Clearing a rating returns the event to unrated; clearing the note removes it.
- Rating survives editing the same day in the normal editor (DayForm save does
  not wipe it) and survives adding another event to the day.
- Future/today (not-yet-passed) events show no rating affordance.
- Old events (no rating) render unchanged.
- Store-only: no change to discovery results yet.
- Verified on a 390px phone viewport.
