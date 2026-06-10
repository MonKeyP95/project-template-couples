# Home hero "today" signal — design

**Date:** 2026-06-10
**Status:** Approved, ready for planning
**Scope:** The `/home` hero card only. A follow-on from the itinerary during-trip
pilot — surfaces the active trip's *today* on the home screen.

## Vision

When a trip is in progress, `/home` should answer "what's today?" at a glance.
The hero already shows `// now` and `day 3 / 8`; this adds today's day title, its
summary, and the next event by clock time — so opening the app mid-trip tells you
where you are and what's next without drilling into the itinerary.

## What it surfaces

When the hero trip is **active** (`state === "now"`) and today has an itinerary
day:

- **Today's day title** (e.g. "Gili Trawangan").
- **Its summary** — the day `sub`, falling back to the first event text / "N
  events" when blank (same rule as the itinerary card's `daySummary`). Omitted
  when there's nothing to show.
- **The next event**, by the browser's clock: `next HH:MM · text` for the next
  upcoming timed event; once the last timed event has passed, `last HH:MM · text`
  (so the line never goes empty). Untimed events are ignored for this line; if
  today has no timed events, the line is omitted.

When the trip is not active, today has no day (a gap/transit day), or there's no
hero trip, none of this renders — the hero is unchanged.

## Why a client component for "next"

"Next vs last" depends on the **time of day**. The hero card is a Server
Component (it already awaits `getWeather`), and the server runs in UTC — so
computing "next" server-side would show the wrong event for the hours around the
user's real local time. Therefore:

- Date-based content (title + summary) renders **server-side** on `HeroCard`.
- A small **client** component computes next/last from today's timed events using
  the browser clock (`new Date()`), correct in the user's local zone.

This mirrors the project's "today is UTC-derived" caveat already noted in
`docs/TODO.md`, but sidesteps it for the time-of-day comparison by going to the
client.

## Data

`home/page.tsx` already does a per-hero fetch (`getItineraryLocations` for the
route panel). Add one focused read for the hero trip's today:

- New `getTodayForTrip(tripId: string, today: string): Promise<ItineraryDay | null>`
  in `src/lib/trips/itinerary-queries.ts` — selects the `itinerary_days` row for
  that trip whose `day_date === today`, mapped via `rowToItineraryDay`; `null`
  when none. `today` is the server UTC date the page already derives.
- Called only when a hero exists and `hero.state === "now"`; otherwise skipped
  (no needless query).

No schema change. Reuses `ItineraryDay` (title, sub, events) from the itinerary
work.

## Components

- **`HeroCard`** (`src/app/home/trip-cards.tsx`, already a server component)
  gains an optional `today?: ItineraryDay | null` prop. When present, the footer
  renders a "today" block: the day **title**, the **summary** line (when
  non-empty), and `<TodayNextEvent events={today.events} />`. The existing date
  range + `SavedBar` stay below it.
- **`TodayNextEvent`** — new client component (`src/app/home/today-next-event.tsx`,
  `"use client"`). Props: the day's events (`{ time, text }[]`). It filters to
  timed events, sorts by time, and on the browser clock picks the first event
  whose `HH:MM >= now`; if none remain, the last timed event (labelled `last`
  vs `next`). Renders nothing when there are no timed events. Recomputes on mount
  (a lightweight interval is out of scope — a fresh load / navigation re-evaluates;
  this is a glanceable hint, not a live ticker).

## Placement

In the hero **footer** (the white area below the topo header), only when the
today block is present:

```
[ topo header: // now · weather · name · day 3/8 ]
Gili Trawangan
next 11:00 · Refresher dive
JUN 8 — JUN 16            (existing date range)
[saved bar]              (existing)
```

Same block on mobile and desktop. The header is untouched.

## Out of scope

- The smaller `TripCard` (any other active trip) — hero only.
- A live-updating ticker / interval refresh of "next" (re-evaluates on load).
- Today's weather/notes/spend on the home card.
- Any itinerary-tab change (that shipped in the during-trip work).
