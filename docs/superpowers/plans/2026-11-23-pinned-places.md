# Pinned Places Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A trip and each itinerary place can carry a pin picked from geocoder matches; weather, conditions, news and place search read it.

**Architecture:** Three nullable columns (`lat`, `lng`, `place_label`) on `itinerary_locations`, one (`place_label`) on `trips`. The pin type is the existing `PlaceMatch` (`{ lat, lng, fullName }`, `fullName` = `place_label`). One shared `PinChoices` list, one `searchPinCandidates` server action. `resolveCoords` gains a first step: a location pin.

**Tech Stack:** Next.js 16 App Router, Server Actions, Supabase, Open-Meteo geocoding.

**Spec:** `docs/superpowers/specs/2026-11-23-pinned-places-design.md`

## Global Constraints

- Migrations are re-runnable (IF NOT EXISTS, DROP CONSTRAINT IF EXISTS then ADD), pasted by hand.
- No tests exist; verification is `pnpm lint` + `pnpm build` + data-path reasoning. Do not run the dev server.
- Copy: no-match hint is exactly "No match. Try a shorter name (the town, without 'Caleta de')."; none-option is "Not a specific place"; pinned line is "Pinned: <label>".
- Unpinned places behave exactly as today.

## Review Focus

1. Editing the "Where" text after a search must drop the stale matches and pin (new trip and edit trip).
2. A legacy trip with `lat/lng` but null `place_label` keeps working (label falls back to the trip name).
3. Realtime `itinerary_locations` payloads carry numerics as strings; `rowToLocation` must `Number()` them.
4. Renaming a location never clears its pin.
5. "Not sure yet" in the new-trip flow skips the search entirely.

---

### Task 1: Schema + pin plumbing (types, action, list component)

**Files:**
- Create: `supabase/migrations/20261123000001_pinned_places.sql`
- Create: `src/lib/places/pin-actions.ts` (`"use server"`)
- Create: `src/components/pin-choices.tsx` (`"use client"`)

**Interfaces:**
- Produces: `searchPinCandidates(query: string, prefer: string | null): Promise<PlaceMatch[]>` = `searchPlaces(query.trim(), 5, prefer)`, `[]` for blank query.
- Produces: `PinChoices({ matches: PlaceMatch[], value: PlaceMatch | null, onPick: (p: PlaceMatch | null) => void })`: radio rows `fullName` plus "Not a specific place" (value null); empty `matches` renders the no-match hint instead.

- [ ] Migration: `itinerary_locations` add `lat numeric(7,4)`, `lng numeric(7,4)`, `place_label text`; constraint `itinerary_locations_pin_complete` = all three null or all three non-null. `trips` add `place_label text`; constraint `trips_pin_label_needs_coords` = `place_label is null or (lat is not null and lng is not null)`.
- [ ] Action + component as above.
- [ ] `pnpm lint` clean.

### Task 2: Trip pin at creation and in edit trip

**Files:** `src/lib/trips/actions.ts` (`createTrip`, `updateTrip`), `src/lib/trips/queries.ts` (Trip gets `placeLabel: string | null`, select `place_label`), `src/app/trips/new/new-trip-form.tsx`, `src/app/trips/new/note-page.tsx`, `src/app/trips/[slug]/edit/edit-trip-form.tsx`, `src/app/trips/[slug]/edit/page.tsx`, create `src/components/pin-finder.tsx`.

**Interfaces:**
- `CreateTripInput.pin: PlaceMatch | null` -> writes `lat`, `lng`, `place_label`.
- `UpdateTripInput`: `lat`/`lng` replaced by `pin: PlaceMatch | null`; the three update payloads write `lat`, `lng`, `place_label` from it. The old coordinate validation goes.
- `EditTripInitial`: `lat`/`lng` replaced by `pin: PlaceMatch | null` (edit page builds it from `trip.lat/lng`, `fullName: trip.placeLabel ?? trip.name`).
- `PinFinder({ query, prefer, value, onChange })`: "Find" button calls `searchPinCandidates`, remembers the query it searched; shows `Pinned: <label>` when `value`, and `PinChoices` only while `query` equals the searched query.

- [ ] New trip: `NewTripForm` holds `matches: PlaceMatch[] | null`, `searchedFor: string`, `pin`. Continue: if `unsure` or place blank, or `searchedFor === place.trim()`, go to prefs; otherwise search, set `searchedFor`, `matches`, preselect when exactly one, stay on page. `NotePage` renders `PinChoices` under Where when `searchedFor === draft.place.trim()`. `create` sends `pin` only when `searchedFor` matches the current place and not unsure.
- [ ] Edit trip: replace the advanced lat/lng toggle and inputs with `PinFinder(query=country, prefer=null)`; changing "Where" text does not clear the pin (user can pick "Not a specific place").
- [ ] `pnpm lint` clean.

### Task 3: Location pin (edit form) + read path everywhere

**Files:** `src/lib/trips/location-types.ts`, `src/lib/trips/location-queries.ts`, `src/lib/trips/actions.ts` (new `setLocationPin`), `src/app/trips/[slug]/itinerary-tab.tsx`, `src/lib/weather/get-trip-weather.ts`, `src/lib/weather/place-for-weather.ts`, `src/app/trips/[slug]/page.tsx`, `src/app/on-the-road/page.tsx`, `src/lib/conditions/day-conditions.ts`, `src/lib/trips/dispatch-actions.ts`.

**Interfaces:**
- `ItineraryLocation.pin: PlaceMatch | null`; row gets optional `lat`, `lng` (`string | number | null`), `place_label`.
- `setLocationPin(locationId: string, tripSlug: string, pin: PlaceMatch | null): Promise<{ error?: string }>`.
- `TripPlace` gains `locationPin?: PlaceMatch | null` and `placeLabel?: string | null`. `resolveCoords`: location pin first (label = `locationName ?? pin.fullName`); trip pin `fullName = placeLabel ?? name`.
- `placeText(name: string, pin: PlaceMatch | null): string` in `place-for-weather.ts`: `"Caleta de Famara (Famara, Canary Islands, ES)"`, or `name` when no pin.

- [ ] Location select adds `lat, lng, place_label`; `rowToLocation` builds the pin with `Number()`.
- [ ] Location edit form: `PinFinder(query=renameVal, prefer=destination)`; `onChange` calls `setLocationPin` at once (my call: the pin saves on tap, independent of the rename save, so renaming can never touch it).
- [ ] Callers pass `locationPin`: trip page (`pickWeatherLocation`), on-the-road page, `getUpcomingConditions`.
- [ ] News `dayContext` and on-the-road `searchDestination`: location -> `placeText(name, pin)`; no location -> `trip.placeLabel ?? trip.country ?? trip.name`.
- [ ] `pnpm lint` and `pnpm build` clean.

### Task 4: Docs

- [ ] `docs/DECISIONS.md` row: pins stored, supersedes render-time-only geocoding; location pin saves on tap.
- [ ] `docs/TODO.md`: implemented, unverified in app; paste-the-migration step.
- [ ] Spec check 3 reworded: add the place, then pin it from its edit form.
- [ ] Commit.
