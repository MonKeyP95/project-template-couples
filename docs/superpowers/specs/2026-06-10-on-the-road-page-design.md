# On the Road — the "living it" page

**Date:** 2026-06-10
**Status:** Design approved, pending spec review

## Purpose

A third top-level lens for the app, alongside the two that exist:

- **Home** — the *vision* lens. All trips at a glance (past / now / upcoming / dreams).
- **Trips / Dreams** — the *planning* lens. Go into a trip to build itinerary, budget, packing.
- **On the road** (this page) — the *living it* lens. Zero planning, zero browsing. Assumes you are standing in the middle of the current trip *today*, and concentrates everything relevant into one concrete "here's your day" surface.

When a trip is active, this becomes the app's home base; you only dip back into the trip page to edit.

## Activation rule

The page **only wakes up during an active trip** — a trip whose date range contains today (the existing `state === "now"` notion).

- Active trip exists: the route renders, the nav item is shown, and the user auto-lands here instead of Home.
- No active trip: the route redirects to Home and the nav item is absent.

This keeps the page from ever being empty or awkward. It is a mode that wakes during a trip, not a permanent always-present destination.

## Routing & nav

- New route: `/on-the-road`.
- Active-trip detection reuses the existing `state === "now"` logic already used on Home.
- Nav shows the item and auto-lands the user here only when a trip is active; otherwise the item is hidden and the route redirects to Home.

## Auto-advance behaviour

"Today" always means the real calendar date. The page advances on its own at midnight for free — no faked early rollover.

The evening case is handled by graceful degradation, not date-shifting: once today's last event time has passed, the now/next focus empties ("Day's done") and the **Looking ahead** block carries the weight. The page *feels* like it moves on without lying about what day it is.

## The surface (top to bottom)

1. **Day header** — "Day 4 · Ubud" + date + weather. Current leg comes from itinerary locations; weather from the existing `getWeather` helper.
2. **Today's plan** — today's itinerary events with now/next emphasis (reuses the home-hero now/next logic). When all of today's events are past, shows "Day's done."
3. **Quick add expense** — amount + category + name. Inserts an expense with `day_date = today`, `paid_by = you`. Reuses the existing expense insert path and per-trip categories. Date-tagged expenses are already auto-attributed to the right location/leg.
4. **Today's spend** — sum of today's logged expenses.
5. **Quick note jot** — one line; inserts a `trip_notes` row tagged to today (needs the new additive `day_date` column, see Data changes).
6. **Looking ahead** — two quiet lines:
   - **Tomorrow** → tomorrow's **first event with its time** ("Tomorrow 09:00 · Diving"). Falls back to tomorrow's day title/summary if tomorrow has no timed events.
   - **Next move** → the next location change with a countdown ("In 2 days → Gili Air").
   - If tomorrow *is* the next move, collapse to a single line to avoid redundancy.

## Data changes

Exactly one additive migration:

- `day_date date` (nullable) on `public.trip_notes`, mirroring `expenses.day_date`. No new RLS — existing `trip_notes` policies already gate by trip via `is_trip_workspace_member()`. Idempotent (`add column if not exists`).

Everything else reuses existing tables, queries, and RLS:

- Itinerary days / events / locations (day header, today's plan, looking-ahead waypoints).
- Expenses (`day_date`, categories, insert path) for quick-add and today's spend.
- `getWeather` for the header.

## Out of scope (v1)

- Packing/prep nudges.
- Settle-up glance.
- Multi-day agenda (the itinerary planning view is one tap away; duplicating it here would dilute the page's purpose).
- Editing today's plan from this page — editing stays in the trip page.

## Why these boundaries

The page's whole identity is "just today, concretely." A multi-day plan or in-place itinerary editing would turn it back into the planning lens that already exists, and create two places showing the same thing. Today is the whole page; tomorrow gets exactly two quiet lines. Any expansion later is a deliberate add, not the default.
