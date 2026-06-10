# HeroCard schematic route panel — design

**Date:** 2026-06-09
**Status:** approved, ready for implementation plan

## Goal

Place a map-shaped panel to the right of the home page hero trip, the same
size as the hero card, showing the hero trip's locations as a route. For now
this is a **schematic** route (a stylized, on-brand line through the location
names) — **not** a real geographic map. A real interactive map is a later
stage and is explicitly deferred here.

## Reminder for the later interactive-map stage

A real map needs per-location coordinates. Today an `itinerary_locations` row
is only `name + sort_order + optional date span` — there is **no lat/lng** on a
location (only the trip has one pin). So wiring a real interactive map will
require: adding lat/lng to `itinerary_locations`, a geocoding step when a
location is created/edited, a map library, and client-side rendering. This
panel is the visual shell that map later swaps into.

## Decisions (from brainstorming)

- **Style:** schematic route using the real, ordered location names on the
  existing topographic sand-and-sea texture. Not geographically accurate.
- **Responsive:** desktop only. Hidden on mobile — phones keep today's lean
  hero-only view.
- **Fallback:** a trip with zero locations shows a "quiet placeholder" — sparse
  topo surface, one centered pin, a small `// map` label — so it never looks
  broken.

## Placement

In `src/app/home/page.tsx`, the hero ("Now/Upcoming") section currently renders
`<HeroCard>` inside `md:grid md:grid-cols-2 lg:grid-cols-3` with a single child.

Change that one row to a 50/50 desktop grid holding two children:

- left: `HeroCard` (unchanged)
- right: new `TripRoutePanel`, wrapped `hidden md:block`

Use `md:grid-cols-2` for this row (drop `lg:grid-cols-3` here only) so hero and
panel stay equal width — the same footprint — at all desktop sizes. The Trips,
Dreams, and Past grids below are untouched.

## Component: `TripRoutePanel`

New **server** component at `src/app/home/trip-route-panel.tsx`. Pure SVG, no
interactivity, no `"use client"`, no client JS.

Props:

```ts
{ slug: string; locations: string[] }   // ordered location names
```

Chrome matches the hero card: `border`, `rounded-[14px]`, `overflow-hidden`,
`bg-card`, an `aspect-[16/10]` surface tinted via `slugToTone(slug)` with
`TopoBg`, and a small mono footer caption (e.g. `4 STOPS · ROUTE`).

Rendering:

- A pure helper `routePoints(n: number, seed: number)` returns `n` SVG points
  along a deterministic wandering path inside the viewBox. The `seed` is a small
  integer derived from the slug (e.g. sum of char codes) so each trip's curve is
  stable and distinct. This is decorative layout, **not** real geography.
- Draw a moss stroke through the points; render a pin (circle) + mono label at
  each point.

Fallback: when `locations.length === 0`, render the quiet placeholder (sparse
topo, one centered pin, `// map` label) instead of a route.

## Data

`page.tsx` already resolves `hero`. The existing
`getItineraryLocations(tripId)` (`src/lib/trips/location-queries.ts`) returns
ordered locations. Add one call when a hero exists and pass the names down:

```ts
const heroLocations = hero ? await getItineraryLocations(hero.id) : []
// ...
<TripRoutePanel slug={hero.slug} locations={heroLocations.map((l) => l.name)} />
```

One extra query, only when a hero card is shown.

## Out of scope (deferred)

- Real map tiles / map library
- Per-location lat/lng and geocoding
- Any interactivity (pan, zoom, click-through)
- Mobile rendering of the panel

## Files touched

- `src/app/home/trip-route-panel.tsx` — new component + `routePoints` helper
- `src/app/home/page.tsx` — fetch hero locations, render the 50/50 hero row
