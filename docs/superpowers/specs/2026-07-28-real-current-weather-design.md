# Real current weather (on the road + home hero)

**Date:** 2026-07-28
**Status:** designed

## Problem

`getWeather(lat, lng, isoDate?)` in `src/lib/weather/get-weather.ts` is a stub: it
derives a temperature from latitude and the month, discards longitude, and returns
fixed wind/humidity/rain plus four invented hourly slots. Three surfaces render it:

- `/on-the-road` — the `WeatherCard` under the day headline
- `/home` — the `WeatherBadge` on the hero card
- `/trips/[slug]` — not displayed; feeds `detectWeatherPacking`, called with the
  trip's **start date**

The trip page's 7-day bar (`getWeekForecast`) is already a real Open-Meteo call, so
the same trip can show a real forecast in the right rail and a fabricated reading in
the card above it.

The user's framing: **displayed weather is not an estimate — it is what the weather
actually is at that place today.**

## Decisions taken

1. **Both dateless surfaces go real.** `/on-the-road` and the `/home` hero badge both
   ask "weather now at the destination"; one change fixes both, and leaving one stubbed
   would show two different temperatures for one trip on two pages.
2. **The packing nudge keeps the seasonal estimate.** It is the only consumer that asks
   about a future date, and a trip months out is beyond any forecast. Reading today's
   real weather instead would judge a July trip by today's January conditions.
3. **A failed call hides the weather; it never substitutes the estimate.** Printing
   modelled numbers where a reading is promised is the thing being removed.

## Design

### `src/lib/weather/get-weather.ts`

The one ambiguous export splits into two honestly-named ones. `Weather`, `WeatherHour`,
`DayForecast` and `getWeekForecast` are unchanged.

```ts
getCurrentWeather(lat: number, lng: number): Promise<Weather | null>
getSeasonalEstimate(lat: number, lng: number, isoDate: string): Promise<Weather>
```

- `getSeasonalEstimate` is the existing stub body, renamed, with `isoDate` now
  **required** — there is no longer a dateless caller. Its docstring says it is a
  climate estimate for a future trip, not a forecast.
- `getCurrentWeather` is one Open-Meteo request (free, keyless, same vendor as
  `geocodePlace` and `getWeekForecast`):

  ```
  https://api.open-meteo.com/v1/forecast
    ?latitude=..&longitude=..
    &current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m
    &daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max
    &hourly=temperature_2m,weather_code
    &timezone=auto&forecast_days=2
  ```

  Field mapping into the existing `Weather` shape:

  | `Weather` field | source |
  | --- | --- |
  | `tempC`, `code`, `windKph` | `current.temperature_2m` / `weather_code` / `wind_speed_10m` |
  | `humidityPct` | `current.relative_humidity_2m` |
  | `highC`, `lowC` | `daily.temperature_2m_max[0]`, `daily.temperature_2m_min[0]` |
  | `rainPct` | `daily.precipitation_probability_max[0]`, `0` when null |
  | `hourly` | next four 3-hourly slots after `current.time` |

  Hourly slicing: `timezone=auto` returns `current.time` and every `hourly.time` in
  destination-local time, so the first slot is the first `hourly.time` strictly after
  `current.time`, then every third entry, four in total. `forecast_days=2` exists so an
  evening reading still has twelve hours ahead of it instead of running out at midnight.
  Each slot's `time` is the `"HH:MM"` tail of the ISO string, matching what `WeatherCard`
  already renders.

  Cached with `next: { revalidate: 3600 }`, the same hour as `getWeekForecast`.
  A non-`ok` response, or a missing `current`/`daily` block, returns `null`.

### `src/lib/weather/get-trip-weather.ts`

`resolveCoords` and its most-specific-place-first ordering are unchanged, so both paths
still resolve through the itinerary location covering today before the trip pin.

- `getTripWeather(place)` loses its `isoDate` parameter and calls `getCurrentWeather`.
  Still `Promise<Weather | null>`, so both call sites keep their existing `weather ? …`
  guards.
- New `getTripSeasonalEstimate(place, isoDate)` calls `getSeasonalEstimate`. Returns
  `null` only when the place will not resolve.

### Call sites

| File | change |
| --- | --- |
| `src/app/on-the-road/page.tsx` | none — already `getTripWeather(weatherPlace)` |
| `src/app/home/trip-cards.tsx` | none — already `getTripWeather(trip)` |
| `src/app/trips/[slug]/page.tsx` | `getTripWeather(weatherPlace, header.startDate ?? undefined)` becomes `getTripSeasonalEstimate(weatherPlace, header.startDate ?? today)` |

The page already calls `await localToday()` inline inside the `weatherPlace` literal;
hoist it to a `const today` above and reuse it for both, so the estimate always has a
date and a dream trip with no `start_date` reads today's season.

`detectWeatherPacking` is pure and unchanged. `WeatherCard`, `WeatherBadge` and
`WeekForecast` are unchanged.

## Not in scope

- Persisting coordinates. Render-time geocoding stays (`DECISIONS.md`, 2026-07-12).
- A forecast-vs-estimate switch on the trip page. Rejected above.
- Any change to the 7-day bar, which is already real.
- Imperial units, "feels like", sunrise/sunset.

## Success criteria

### Verified by Claude

1. `pnpm build` and `pnpm lint` pass.
2. `get-weather.ts` exports `getCurrentWeather` and `getSeasonalEstimate`; no export
   named `getWeather` remains, and no file imports one.
3. `getSeasonalEstimate` keeps the old `getWeather` maths unchanged — same
   `northSeason` / `baseC` / `swing` expressions — with only the now-unnecessary
   `isoDate ? … : new Date()` branch collapsed to `Number(isoDate.slice(5, 7))`.
4. Grep confirms `getTripSeasonalEstimate` has exactly one caller,
   `src/app/trips/[slug]/page.tsx`, and that it is the `detectWeatherPacking` input.
5. The request URL contains `current=`, `daily=`, `hourly=`, `timezone=auto`,
   `forecast_days=2`, and `revalidate: 3600`.
6. Reasoned trace of the hourly slice: given a `current.time` of `18:00` and hourly
   entries from `00:00` on day one through `23:00` on day two, the returned slots are
   `19:00`, `22:00`, `01:00`, `04:00` — four entries, none at or before `current.time`.
7. A non-`ok` response returns `null` and no code path returns a `getSeasonalEstimate`
   result to a display surface.

### Verified by the user in-app

1. `/on-the-road` shows a plausible current temperature and condition for where the
   trip actually is — cross-check against a phone weather app for the same city.
2. Expanding the card shows a high/low that brackets the current temperature, a wind
   and humidity that are not the old constants (12 km/h, 55%), and four hour slots
   whose first is the next hour ahead in **destination** local time, not yours.
3. The `/home` hero badge temperature matches the on-the-road card for the same trip.
4. The trip page's 7-day bar first day agrees with the on-the-road card (same place,
   same day, same vendor).
5. A trip whose destination cannot be geocoded still renders with no weather chip and
   no error.
6. Both surfaces at a phone viewport look unchanged in layout.
