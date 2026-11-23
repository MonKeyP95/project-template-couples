# Pinned places: the app knows exactly where you are

## Why

Weather, surf/dive conditions and the daily news all depend on where the trip
is. Today every place is a free-text name, re-geocoded on each render with
"first match wins". That is not reliable enough:

- `"Caleta de Famara"` returns **no match** from Open-Meteo geocoding.
- `"Famara"` returns **Senegal** first; Lanzarote's Famara is second.
- A trip with no itinerary places sends its **country** to the news agent
  (`dispatch-actions.ts` `dayContext`), so a two-week Famara surf trip gets
  news about Spain.

Goal: you choose the exact place once, when you enter it, and every feature
reads that saved choice.

## Goals

- An itinerary place and a trip can each carry a **pin**: coordinates plus a
  canonical label ("Famara, Canary Islands, ES").
- Pins are chosen from a short list of geocoder matches, not guessed.
- Weather, conditions, news and the on-the-road place search use the pin when
  it exists.
- Unpinned places keep working exactly as today (render-time name lookup).

## Non-goals

- No map, no pin dropping, no phone GPS.
- No AI resolving of place names.
- No backfill or nagging to pin existing places.
- No new geocoding vendor; Open-Meteo stays (it knows towns, not beaches;
  a town is close enough for marine and weather grids).

## Anti-goals

- A pin silently changing after it was picked.
- A second, parallel location system next to `itinerary_locations`.

## Both modes

- **Planning:** you pin a place when you add or edit it.
- **On the road:** today's place (its dates cover today) supplies the pin. That
  is the same rule as today, just reading coordinates instead of a name.
- Dateless dreams: pins work the same; nothing is date-dependent.

## Approaches considered

1. **Pin on entry, store it (chosen).** Deterministic, one lookup per place,
   works for future days, no permissions.
2. Phone GPS. Only knows where you are *now*, useless while planning, adds
   permission prompts. Possible later as an "I'm here" button.
3. AI resolves the name. Nondeterministic, costs a call, can invent places.
4. Map picker. More UI and a tile provider for no accuracy gain at town level.

This **supersedes** the DECISIONS row "A trip's weather coordinates are
geocoded at render time ... not stored". That row explicitly deferred
persistence to "the real weather call", which has since shipped.

## Design

### Data (one idempotent migration)

- `itinerary_locations`: add `lat numeric(7,4)`, `lng numeric(7,4)`,
  `place_label text`. Check constraint: all three null or all three set
  (DROP CONSTRAINT IF EXISTS, then ADD).
- `trips`: `lat`/`lng` already exist (the hidden "advanced" pin). Add
  `place_label text`; no constraint change on the existing columns.
- Existing RLS covers the new columns; the location Realtime select must list
  them so a partner's pin arrives live.

### Picking a pin

- Server action `searchPinCandidates(query, preferCountry)` wraps
  `searchPlaces(query, 5, preferCountry)`.
- A small client `PlacePicker`: a "Find" button beside the name
  (not search-as-you-type), which shows up to 5 rows `name, region, CC`. Tap
  one to set the pin, or "clear" to drop it.
- The **name stays what you typed** ("Caleta de Famara"); the pin label shows
  beneath it ("Pinned: Famara, Canary Islands, ES"). Renaming does not touch
  the pin, and the mismatch stays visible.
- No match: "No match. Try a shorter name (the town, without 'Caleta de')."
  The place saves unpinned.
- Used in three places, built in this order:
  1. **New-trip flow** (`src/app/trips/new/note-page.tsx`). The "Where" field
     (parsed from the note or typed) is where a trip first learns its place;
     today it is stored only as free text in `trips.country`. On Continue, when
     "Where" is filled, search once and show the matches under the field, plus
     "Not a specific place". Exactly one match is preselected; several means
     tap one; none shows the shorter-name hint and lets you continue. The pick
     goes to `createTrip`, which writes `trips.lat/lng/place_label`. Optional:
     vague places ("Portugal", "the coast") and "Not sure yet" dreams stay
     unpinned.
  2. **Edit-trip form**: the same picker replaces the "advanced (lat / lng)"
     inputs, for older trips and ones not pinned at creation.
  3. **Itinerary place edit form** (the pencil), for multi-stop trips. The pin
     saves on tap via its own `setLocationPin` action, apart from the rename.
     The one-line add box stays name-only (it closes on blur). A place's pin wins over the trip pin on the days it covers.
- Order rationale: the motivating case (two weeks in Famara) is a single-place
  trip, so the trip pin delivers it first.

### Reading the pin

- `ItineraryLocation` gains `pin: { lat; lng; label } | null` (via
  `rowToLocation`); every `itinerary_locations` select adds the three columns.
- `resolveCoords` order becomes: location pin > location name lookup > trip pin
  > trip name lookup > country. Only the first step is new. `TripPlace` carries
  the location pin next to `locationName`.
- Callers that build a `TripPlace` from a location (trip page via
  `pickWeatherLocation`, on-the-road page, `getUpcomingConditions`) pass the pin.
- News (`dayContext`) and on-the-road `searchDestination`: the place string is
  the location's name plus its pin label when pinned, else the trip's
  `place_label`, else today's fallback chain. Example: "Caleta de Famara
  (Famara, Canary Islands, ES)".

### Left to the builder

- Exact picker styling (follow DESIGN.md and the existing form fields).
- Whether the trip pin's `fullName` comes from `place_label` or the trip name
  when `place_label` is null (legacy manual pins): use the trip name.

## Success criteria

### Verified by Claude

1. The migration runs twice in a row without error; the check constraint
   rejects a row with `lat` set and `place_label` null.
2. `searchPinCandidates("Famara", "Spain")` returns the Canary Islands match
   first.
3. `resolveCoords` with a location pin returns the pin's coordinates without
   calling the geocoder.
4. `dayContext` for a pinned trip with no itinerary places returns a place
   containing the pin label, not the country.
5. `pnpm lint` and `pnpm build` are clean.

### Verified by the user in the app

1. New trip with the note "2 weeks surfing in Famara": after Continue, the
   Canary Islands and Senegal matches show under "Where"; pick Canary Islands,
   finish, and the trip page weather names Famara.
2. New trip with "Where: Portugal" and "Not a specific place" chosen: the trip
   saves, unpinned, as before.
3. Add an itinerary place "Famara", open its edit form (pencil), tap find, and
   see the Canary Islands and Senegal rows; pick Canary Islands and see "Pinned: Famara, Canary Islands, ES".
4. Search "Caleta de Famara" and see the no-match hint; the place still saves.
5. Rename a pinned place; the pin label stays unchanged.
6. Your partner's open trip page shows the new pin without a reload.
7. The weather headline on the trip page names the pinned place.
8. Edit trip: pin the trip itself to Famara; the advanced lat/lng inputs are
   gone.
9. On the road (a trip covering today): conditions and news refer to Famara,
   not Spain or Senegal.
10. Two places on one island: trip pinned to Lanzarote, "Famara" (days 1-7)
    and "Playa Blanca" (days 8-14) each pinned. Weather and conditions for a
    day follow the place covering it; on day 7 tomorrow's card is Playa Blanca;
    a day with no place uses the Lanzarote pin.
11. An old, unpinned trip still shows weather as before.
12. All of the above on a phone-width viewport.
