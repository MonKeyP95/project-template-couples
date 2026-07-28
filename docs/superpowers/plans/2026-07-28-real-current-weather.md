# Real Current Weather Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the latitude/month weather stub with a real Open-Meteo current-conditions call on the two surfaces that display "weather now" (`/on-the-road`, `/home` hero badge), keeping the stub — renamed to say what it is — for the packing nudge alone.

**Architecture:** `src/lib/weather/get-weather.ts` splits its one ambiguous export into `getCurrentWeather` (real fetch, `null` on failure) and `getSeasonalEstimate` (the old body, date now required). `src/lib/weather/get-trip-weather.ts` gains a matching pair on top of the unchanged `resolveCoords`. No component changes: the `Weather` shape is identical, so `WeatherCard` and `WeatherBadge` are untouched.

**Tech Stack:** Next.js 16 App Router server components, TypeScript, `fetch` with Next's `revalidate` cache. Open-Meteo forecast API — free, keyless, already the vendor behind `geocodePlace` and `getWeekForecast`.

**Spec:** `docs/superpowers/specs/2026-07-28-real-current-weather-design.md`

## Global Constraints

- No test framework exists in this repo. Verification is `pnpm build`, `pnpm lint`, and reasoning about the data path. Do not invent a test command.
- Never claim a UI-visible behaviour works. Report "implemented; build and lint clean; unverified in app".
- No emojis in code, comments, or logs.
- No defensive code. A failed fetch returns `null`; there is no retry, no fallback to the estimate, no try/catch.
- Displayed weather must never come from `getSeasonalEstimate`. That function has exactly one consumer: `detectWeatherPacking`.
- Temperature unit stays Celsius, wind stays km/h — both are Open-Meteo defaults, so no unit parameters in the URL.
- Dates display day-before-month elsewhere in the app; this change adds no new date strings.

## File Structure

| File | Responsibility after this change |
| --- | --- |
| `src/lib/weather/get-weather.ts` (modify) | The vendor seam. Three exports: `getCurrentWeather` (now), `getWeekForecast` (next 7 days, unchanged), `getSeasonalEstimate` (climate model). Plus the `Weather` / `WeatherHour` / `DayForecast` types, unchanged. |
| `src/lib/weather/get-trip-weather.ts` (modify) | Trip-to-coordinates resolution (`resolveCoords`, unchanged) with one wrapper per vendor function. |
| `src/app/trips/[slug]/page.tsx` (modify) | Switches its packing-nudge input to the estimate wrapper and hoists `today`. |
| `src/components/weather-card.tsx` (modify) | Docstring only — it currently advertises the stub. |
| `src/app/on-the-road/page.tsx`, `src/app/home/trip-cards.tsx` | Unchanged. They already call `getTripWeather(place)` with no date. |

---

### Task 1: Split the vendor seam and rewire callers

All three source files change together: `getTripWeather` loses a parameter, so the trip
page must move in the same commit or the build breaks on a type error.

**Files:**
- Modify: `src/lib/weather/get-weather.ts:36-103`
- Modify: `src/lib/weather/get-trip-weather.ts:1-61`
- Modify: `src/app/trips/[slug]/page.tsx:207-219`
- Modify: `src/components/weather-card.tsx:38-42`

**Interfaces:**
- Consumes: `Weather`, `WeatherHour` (already exported from `get-weather.ts`); `resolveCoords(place): Promise<Resolved | null>` (already private in `get-trip-weather.ts`); `localToday(): Promise<string>` from `@/lib/time/local-today`.
- Produces:
  - `getCurrentWeather(lat: number, lng: number): Promise<Weather | null>`
  - `getSeasonalEstimate(lat: number, lng: number, isoDate: string): Promise<Weather>`
  - `getTripWeather(place: TripPlace): Promise<Weather | null>`
  - `getTripSeasonalEstimate(place: TripPlace, isoDate: string): Promise<Weather | null>`

- [ ] **Step 1: Replace the stub in `src/lib/weather/get-weather.ts`**

Delete the whole `getWeather` function (lines 65-103, docstring included) and put this in
its place. `getWeekForecast` above it and the type declarations at the top are untouched.

```ts
interface CurrentResponse {
  current?: {
    time: string
    temperature_2m: number
    relative_humidity_2m: number
    weather_code: number
    wind_speed_10m: number
  }
  daily?: {
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_probability_max: Array<number | null>
  }
  hourly?: {
    time: string[]
    temperature_2m: number[]
    weather_code: number[]
  }
}

/**
 * The next four 3-hourly slots strictly after `after`. Every time here is
 * destination-local (`timezone=auto`) and fixed-width ISO, so a string compare
 * orders them correctly.
 */
function nextHours(
  hourly: NonNullable<CurrentResponse["hourly"]>,
  after: string,
): WeatherHour[] {
  const start = hourly.time.findIndex((t) => t > after)
  if (start === -1) return []
  const slots: WeatherHour[] = []
  for (let i = start; i < hourly.time.length && slots.length < 4; i += 3) {
    slots.push({
      time: hourly.time[i].slice(11, 16),
      tempC: hourly.temperature_2m[i],
      code: hourly.weather_code[i],
    })
  }
  return slots
}

/**
 * Real current conditions from Open-Meteo (free, no key), cached for an hour.
 * `current` carries temperature, wind and humidity; today's `daily` row carries
 * the high, low and rain chance; `hourly` fills the next-hours strip. Two
 * forecast days so an evening reading still has hours ahead of it. Returns null
 * if the call fails -- the caller hides the card rather than showing a guess.
 */
export async function getCurrentWeather(
  lat: number,
  lng: number,
): Promise<Weather | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&hourly=temperature_2m,weather_code` +
    `&forecast_days=2&timezone=auto`
  const res = await fetch(url, { next: { revalidate: 3600 } })
  if (!res.ok) return null
  const data = (await res.json()) as CurrentResponse
  const { current, daily, hourly } = data
  if (!current || !daily) return null
  return {
    tempC: current.temperature_2m,
    code: current.weather_code,
    highC: daily.temperature_2m_max[0],
    lowC: daily.temperature_2m_min[0],
    windKph: current.wind_speed_10m,
    humidityPct: current.relative_humidity_2m,
    rainPct: daily.precipitation_probability_max[0] ?? 0,
    hourly: hourly ? nextHours(hourly, current.time) : [],
  }
}

/**
 * A climate estimate for a date, not a forecast: a deterministic function of
 * latitude and the month of `isoDate`. Hemisphere-aware -- warmest in the local
 * summer, colder toward the poles, seasonal swing growing with latitude. Its
 * only consumer is the packing nudge, which asks about a trip start date that
 * can be months out, past any real forecast. Never render this as the weather.
 */
export async function getSeasonalEstimate(
  lat: number,
  lng: number,
  isoDate: string,
): Promise<Weather> {
  void lng
  const month = Number(isoDate.slice(5, 7))
  // 1 at northern midsummer (July), -1 at northern midwinter (January).
  const northSeason = Math.cos(((month - 7) / 12) * 2 * Math.PI)
  const season = lat >= 0 ? northSeason : -northSeason
  const absLat = Math.abs(lat)
  const baseC = 30 - (absLat / 90) * 35 // ~30C at the equator, ~-5C at the poles
  const swing = (absLat / 90) * 18 // tropics barely vary; high latitudes swing hard
  const tempC = Math.round(baseC + season * swing)
  return {
    tempC,
    code: 0,
    highC: tempC + 3,
    lowC: tempC - 3,
    windKph: 12,
    humidityPct: 55,
    rainPct: 10,
    hourly: [
      { time: "12:00", tempC, code: 0 },
      { time: "15:00", tempC: tempC + 2, code: 1 },
      { time: "18:00", tempC: tempC - 1, code: 2 },
      { time: "21:00", tempC: tempC - 3, code: 3 },
    ],
  }
}
```

- [ ] **Step 2: Rewire `src/lib/weather/get-trip-weather.ts`**

Change the import at the top from `getWeather` to the two new names:

```ts
import {
  getCurrentWeather,
  getSeasonalEstimate,
  getWeekForecast,
  type DayForecast,
  type Weather,
} from "./get-weather"
```

Then replace the `getTripWeather` function (its docstring included) with the pair below.
`resolveCoords`, `TripPlace`, `Resolved` and `getTripWeekForecast` are unchanged.

```ts
/**
 * Current weather at a trip's resolved coordinates. Null when there's no place
 * to locate or the vendor call fails; the caller hides the card.
 */
export async function getTripWeather(place: TripPlace): Promise<Weather | null> {
  const coords = await resolveCoords(place)
  if (!coords) return null
  return getCurrentWeather(coords.lat, coords.lng)
}

/**
 * Seasonal climate estimate for a trip on `isoDate` -- not a forecast, and not
 * for display. Feeds the packing nudge only.
 */
export async function getTripSeasonalEstimate(
  place: TripPlace,
  isoDate: string,
): Promise<Weather | null> {
  const coords = await resolveCoords(place)
  if (!coords) return null
  return getSeasonalEstimate(coords.lat, coords.lng, isoDate)
}
```

- [ ] **Step 3: Point the trip page at the estimate wrapper**

In `src/app/trips/[slug]/page.tsx`, change the import on line 38:

```ts
import {
  getTripSeasonalEstimate,
  getTripWeekForecast,
} from "@/lib/weather/get-trip-weather"
```

Then replace lines 207-215 (the `weatherPlace` literal and the `Promise.all`) with this.
The `await localToday()` that was buried inside the object literal becomes a `const` so
the estimate has a date even for a dream trip with no `start_date`:

```ts
  const today = await localToday()
  const weatherPlace = {
    ...header,
    locationName: pickWeatherLocation(locations ?? [], today)?.name ?? null,
  }
  const [packingWeather, weekForecast] = await Promise.all([
    getTripSeasonalEstimate(weatherPlace, header.startDate ?? today),
    getTripWeekForecast(weatherPlace),
  ])
```

The `detectWeatherPacking({ ... })` call right below is unchanged.

- [ ] **Step 4: Reuse the hoisted `today` further down the page**

Line 291 (now shifted by one) reads `today={await localToday()}`. Change it to
`today={today}` so the page resolves the date once. Search the file for any other
`await localToday()` and replace those with `today` too.

- [ ] **Step 5: Fix the stale docstring in `src/components/weather-card.tsx`**

The component's docstring ends with "Data comes from the (currently stubbed)
`getWeather`." Replace that sentence with:

```
 * expand toggle. Data comes from `getCurrentWeather` -- a real reading, not an
 * estimate.
```

- [ ] **Step 6: Verify nothing still references the old name**

Run: `grep -rn "getWeather\b" src/`
Expected: only `getWeekForecast` matches (a different identifier — confirm each hit is
`getWeekForecast`, not a bare `getWeather`). Zero bare `getWeather` occurrences.

- [ ] **Step 7: Verify the estimate has exactly one display-free consumer**

Run: `grep -rn "getTripSeasonalEstimate\|getSeasonalEstimate" src/`
Expected: definitions in the two lib files, plus exactly one call site,
`src/app/trips/[slug]/page.tsx`, feeding `packingWeather` into `detectWeatherPacking`.

- [ ] **Step 8: Trace the hourly slice by hand**

Given `current.time = "2026-07-28T18:00"` and `hourly.time` running hourly from
`"2026-07-28T00:00"` through `"2026-07-29T23:00"`: `findIndex(t => t > after)` returns
index 19 (`19:00`), then the loop steps by 3 to indices 22, 25, 28 — `22:00`, `01:00`,
`04:00`. Four slots, none at or before the current time, and index 28 exists because
`forecast_days=2` supplies 48 entries. Confirm the code produces exactly this before
moving on.

- [ ] **Step 9: Build and lint**

Run: `pnpm build`
Expected: compiles with no type errors.

Run: `pnpm lint`
Expected: no errors. If `require-await` fires on `getSeasonalEstimate`, drop its `async`
and return the object directly — the wrappers already return it into a `Promise`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/weather/get-weather.ts src/lib/weather/get-trip-weather.ts "src/app/trips/[slug]/page.tsx" src/components/weather-card.tsx
git commit -m "feat(weather): real current conditions on the road and home hero"
```

Do not use a bare `git add -A`: `docs/TODO.md` carries unrelated uncommitted work.

---

### Task 2: Record the decision

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/TODO.md`

**Interfaces:**
- Consumes: nothing. Documentation only.
- Produces: nothing.

- [ ] **Step 1: Add a `docs/DECISIONS.md` row**

Match the existing three-column format (`| decision | why | date |`). Add:

```
| **Displayed weather is a real Open-Meteo reading; the latitude/month model survives only as `getSeasonalEstimate` for the packing nudge** | The stub was the last fake data on a live surface -- `/on-the-road` and the `/home` hero badge invented a temperature from latitude and month while the trip page's 7-day bar right beside them showed a real forecast. The user's framing: displayed weather is not an estimate, it is what the weather actually is at that place today. `getWeather` split into `getCurrentWeather` (one keyless Open-Meteo call: `current` for temp/wind/humidity, today's `daily` row for high/low/rain, `hourly` for the next four 3-hourly slots, `timezone=auto`, cached an hour) and `getSeasonalEstimate` (the old body, `isoDate` now required). The estimate stays because `detectWeatherPacking` asks about a trip start date that can be months out, past any forecast -- reading today's weather there would judge a July trip by January. A failed call returns null and the card hides; it deliberately does **not** fall back to the estimate, which would print modelled numbers as if they were a reading. | 2026-07-28 |
```

- [ ] **Step 2: Update `docs/TODO.md`**

The file has uncommitted edits already — read it first, then add an entry under the
current in-progress section marking the weather work *implemented* (not verified), with
the in-app checklist owner being the user. Follow whatever bullet style the surrounding
entries use.

- [ ] **Step 3: Commit**

```bash
git add docs/DECISIONS.md docs/TODO.md
git commit -m "docs: record the real-weather swap"
```

---

## Success criteria

### Verified by Claude

1. `pnpm build` and `pnpm lint` pass.
2. No bare `getWeather` identifier remains anywhere in `src/` (Task 1, Step 6).
3. `getSeasonalEstimate` reaches exactly one consumer, `detectWeatherPacking`, and no
   display component (Task 1, Step 7).
4. The request URL contains `current=`, `daily=`, `hourly=`, `timezone=auto`,
   `forecast_days=2`, and `revalidate: 3600`.
5. The hourly trace in Task 1, Step 8 produces `19:00, 22:00, 01:00, 04:00`.
6. A non-`ok` response returns `null`, and no code path substitutes an estimate for a
   display surface.

### Verified by the user in-app

1. `/on-the-road` shows a plausible current temperature and condition for where the trip
   actually is — cross-check against a phone weather app for the same city.
2. Expanding the card shows a high/low bracketing the current temperature, and a wind and
   humidity that are no longer the old constants (12 km/h, 55%).
3. The four hour slots start at the next hour ahead in **destination** local time, not
   yours, and the temperatures vary between them.
4. The `/home` hero badge temperature matches the on-the-road card for the same trip.
5. The trip page's 7-day bar's first day agrees with the on-the-road card.
6. A trip whose destination cannot be geocoded still renders with no weather chip and no
   error.
7. Both surfaces look unchanged in layout at a phone viewport.
