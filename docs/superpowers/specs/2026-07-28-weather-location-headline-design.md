# Weather location headline + specific-place resolution — design

**Date:** 2026-07-28
**Status:** Approved, ready for implementation plan

## Goal

Two things, one cause.

1. The trip page's 7-day forecast bar says only `Weather · 7 day` — nothing tells
   you which place it forecasts.
2. It forecasts the wrong place. `resolveCoords` geocodes
   `place.country ?? place.name`, so a Madeira trip in Portugal gets Lisbon and a
   Lanzarote leg of a Spain trip gets Madrid.

Fix the resolution order so the most specific known place wins, then show that
place in the headline so a wrong answer is visible instead of silent.

## Which place — `pickWeatherLocation`

New pure function, `src/lib/weather/place-for-weather.ts`:

```ts
export function pickWeatherLocation(
  locations: ItineraryLocation[],
  today: string,
): ItineraryLocation | null
```

- The location whose declared span covers `today`
  (`l.startDate && l.endDate && l.startDate <= today && today <= l.endDate`) —
  the same predicate already used in `src/lib/journal/journal-types.ts:86`.
- Otherwise the first location by `sortOrder`.
- Otherwise `null`.

Rationale: a 7-day forecast can only ever cover the next 7 days, so "where are
we now" is the only span that matters. Before the trip starts, no span covers
today and the first leg is the right guess.

## Resolution order

`TripPlace` in `src/lib/weather/get-trip-weather.ts` gains one optional field:

```ts
interface TripPlace {
  lat: number | null
  lng: number | null
  country: string | null
  name: string
  /** Most specific place for this trip right now. Wins over the trip's own pin. */
  locationName?: string | null
}
```

`resolveCoords` tries these in order, stopping at the first hit, and returns the
label it resolved with:

1. `geocodePlace(locationName)` — "Lanzarote"
2. `place.lat` / `place.lng` — label is `place.name`
3. `geocodePlace(place.name)` — "Lombok"
4. `geocodePlace(place.country)` — "Indonesia"

Country goes last: it is the least specific thing we know, and today it is
first. An itinerary location beats the trip's manual lat/lng because the pin is
trip-level while the location is where you actually are.

Adding the field as optional keeps every existing call site type-valid; callers
that know a location spread it in.

## Return shape

`getTripWeekForecast` returns the label with the days:

```ts
Promise<{ label: string; days: DayForecast[] } | null>
```

`getTripWeather` keeps returning `Weather | null`. Its two surfaces already
display the place themselves, so it needs the better coordinates, not a label.

## Headline

`WeekForecast` (`src/components/week-forecast.tsx`) takes a `label` prop and
renders it into the existing header:

```
WEATHER · 7 DAY · LANZAROTE          ›
┌────┬────┬────┬────┬────┬────┬────┐
│ MON│ TUE│ WED│ THU│ FRI│ SAT│ SUN│
│ 22°│ 23°│ 21°│ 24°│ 25°│ 24°│ 22°│
└────┴────┴────┴────┴────┴────┴────┘
```

The rail is 280px, so the label truncates rather than pushing the chevron out of
the row.

## Wiring

**`/trips/[slug]`** (`src/app/trips/[slug]/page.tsx`) — `locations` and
`localToday()` are both already available:

- Pick the location, build one place object, pass it to both weather calls.
- The packing nudge's `destination` (line 211, currently
  `header.country ?? header.name`) becomes the resolved label, so the nudge and
  the forecast cannot disagree about where the trip is.
- `RightRail` takes `{ label, days }` instead of `DayForecast[]`.

**`/on-the-road`** (`src/app/on-the-road/page.tsx`) — pass the already-computed
`locationName` (line 85) into `getTripWeather`. No headline is added: the big
`<em>{place}</em>` above the card is already one, and it is the same string.

**`/home`** (`src/app/home/trip-cards.tsx`) — untouched. It has no locations
loaded, but it inherits the name-before-country fix for free.

## Known limitation, deliberately not fixed here

`getWeather` (`src/lib/weather/get-weather.ts:74`) is still a stub: temperature
is a deterministic function of latitude and month, and longitude is discarded
(`void lng`). So on the two `getWeather` surfaces this change corrects *which
coordinates feed the stub*, not whether the number is real. Only the trip page's
7-day bar (`getWeekForecast`, a real Open-Meteo call) becomes genuinely correct.

Swapping the stub for a real current-weather call is its own slice. It needs a
decision about the planning path, which asks for weather at a trip start date
that can be months past Open-Meteo's ~16-day horizon.

## Out of scope

- Making `getWeather` real (above).
- A location picker on the forecast — no switching between legs.
- Storing lat/lng on `itinerary_locations`; geocoding the name is enough and is
  cached for a day.
- Weather anywhere it is not already shown.

## Files touched

- **New:** `src/lib/weather/place-for-weather.ts`
- **Edit:** `src/lib/weather/get-trip-weather.ts` (order, label, optional field)
- **Edit:** `src/components/week-forecast.tsx` (`label` prop)
- **Edit:** `src/app/trips/[slug]/page.tsx` (pick location, wire both calls,
  nudge destination, `RightRail` prop)
- **Edit:** `src/app/on-the-road/page.tsx` (pass `locationName`)

## Success criteria

### Verified by Claude

- `pnpm lint` clean, `pnpm build` succeeds.
- `pickWeatherLocation([], "2026-07-28")` returns `null`.
- Given locations `A(sortOrder 0, no span)` and `B(sortOrder 1, 2026-07-27..2026-07-29)`,
  `pickWeatherLocation(locations, "2026-07-28")` returns `B`; for
  `"2026-08-10"` it returns `A`.
- `resolveCoords` calls `geocodePlace` with the location name when
  `locationName` is set, even when `place.lat`/`place.lng` are non-null.
- `place.country` reaches `geocodePlace` only when all three earlier candidates
  have been tried and none produced coordinates.
- `getTripWeekForecast` returns `label` equal to the string that produced the
  coordinates used.
- The trip page passes the same place object to `getTripWeather` and
  `getTripWeekForecast`, and the packing nudge's `destination` is that same label.

### Verified by the user in-app

1. On a trip whose country differs from its destination (Portugal / Madeira), the
   right-rail header reads `Weather · 7 day · <the destination>`, not the country.
2. The temperatures in that bar match a real forecast for that destination, not
   for the country's capital.
3. On a multi-location trip that is currently running, the headline names the leg
   you are on today, not the first leg.
4. On a trip that has not started, the headline names the first leg.
5. A long location name truncates in the 280px rail; the chevron stays on the row
   and the bar does not wrap or overflow.
6. `/on-the-road` still renders its weather card, and the place headline above it
   is unchanged.
7. `/home` hero cards still show their weather badge.
8. A trip with no itinerary locations still shows the forecast bar, headlined with
   the trip name.
