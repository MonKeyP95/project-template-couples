# Weather Location Headline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forecast the most specific place a trip knows about — the itinerary location you are on today — and name that place in the 7-day bar's header so a wrong answer is visible instead of silent.

**Architecture:** One new pure function picks the location (span-covering-today, else first by `sortOrder`, else null). `resolveCoords` gains an ordered candidate list — location name, manual pin, trip name, country — and returns the label that produced the coordinates. `getTripWeekForecast` returns `{ label, days }`; the right rail passes the label into `WeekForecast`'s header and the packing nudge reuses the same label so the two cannot disagree.

**Tech Stack:** Next.js 16 App Router (Server Components), React 19, TypeScript 5, Tailwind v4. No new dependencies, no migration, no server action change.

Spec: `docs/superpowers/specs/2026-07-28-weather-location-headline-design.md`

## Global Constraints

- **The working tree is clean at `d4fbabc`.** Each code task ends with its own commit, staging only the files that task names. Never `git add -A`.
- **No new dependencies, no migration, no server-action change.** `geocodePlace` and `getWeather`/`getWeekForecast` signatures are untouched.
- **`getWeather` stays a stub.** This slice changes *which coordinates* feed it, not whether its number is real. Do not "fix" `get-weather.ts` — that is a separate slice (spec, "Known limitation").
- **`locationName` is optional on `TripPlace`** so `/home`'s `getTripWeather(trip)` call stays type-valid untouched.
- **No emojis** in code, output, or logs.
- **Sparse comments.** Docstring on exported functions; the existing files' density is the target.
- Verification command after every code task: `pnpm lint` then `pnpm build`, both clean.
- There is no test suite in this repo. Do not invent one, do not add a test runner. Verification is lint, build, the stated reasoning checks, and the in-app checklist in Task 4.
- Do not start the dev server or open a browser. The user verifies in-app.
- Display dates day-before-month (`en-GB`). Not exercised here; do not introduce `en-US`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/weather/place-for-weather.ts` | Pure: which itinerary location a 7-day forecast should describe. | **Create** |
| `src/lib/weather/get-trip-weather.ts` | Resolve a trip to coordinates + the label that produced them. | **Modify** |
| `src/components/week-forecast.tsx` | The desktop 7-day bar; header now names the place. | **Modify** |
| `src/app/trips/[slug]/page.tsx` | Picks the location, feeds both weather calls and the nudge, passes `{label, days}` to the rail. | **Modify** |
| `src/app/on-the-road/page.tsx` | Feeds the already-computed `locationName` into `getTripWeather`. | **Modify** |
| `src/lib/weather/geocode.ts` | Open-Meteo geocoding. | Unchanged — consumed |
| `src/lib/weather/get-weather.ts` | Stub current-weather + real week forecast. | Unchanged — consumed |
| `src/app/home/trip-cards.tsx` | Home hero cards. | Unchanged — inherits the name-before-country fix |
| `docs/TODO.md`, `docs/DECISIONS.md` | Logs. | **Modify** (Task 4) |

---

### Task 1: `pickWeatherLocation`

**Files:**
- Create: `src/lib/weather/place-for-weather.ts`

**Interfaces:**
- Consumes: `type ItineraryLocation` from `@/lib/trips/location-types` (fields used: `name`, `sortOrder`, `startDate`, `endDate`).
- Produces: `function pickWeatherLocation(locations: ItineraryLocation[], today: string): ItineraryLocation | null`

**Notes for the implementer:**

The span predicate is deliberately identical to the one in `src/lib/journal/journal-types.ts:86` — a location with no declared span never catches a date. Do not "improve" it by inferring spans from days.

`sortOrder` is not guaranteed to match array order, so sort a copy rather than taking `locations[0]`.

- [ ] **Step 1: Create the file**

```ts
import type { ItineraryLocation } from "@/lib/trips/location-types"

/**
 * The location a 7-day forecast should describe: the one whose declared span
 * covers `today`, else the first leg by sort order, else null. A forecast only
 * reaches 7 days out, so "where are we now" is the only span that matters;
 * before the trip starts the first leg is the right guess.
 */
export function pickWeatherLocation(
  locations: ItineraryLocation[],
  today: string,
): ItineraryLocation | null {
  const current = locations.find(
    (l) => l.startDate && l.endDate && l.startDate <= today && today <= l.endDate,
  )
  if (current) return current
  const byOrder = [...locations].sort((a, b) => a.sortOrder - b.sortOrder)
  return byOrder[0] ?? null
}
```

- [ ] **Step 2: Verify lint and build**

Run: `pnpm lint` then `pnpm build`
Expected: both clean. The file is not imported yet, so nothing else can break.

- [ ] **Step 3: Reason through the three cases and record the result**

With `A = { sortOrder: 0, startDate: null, endDate: null }` and
`B = { sortOrder: 1, startDate: "2026-07-27", endDate: "2026-07-29" }`:

| Call | Expected |
|---|---|
| `pickWeatherLocation([], "2026-07-28")` | `null` |
| `pickWeatherLocation([A, B], "2026-07-28")` | `B` — its span covers today |
| `pickWeatherLocation([A, B], "2026-08-10")` | `A` — no span covers today, lowest `sortOrder` |
| `pickWeatherLocation([B, A], "2026-08-10")` | `A` — sorted by `sortOrder`, not array position |

State in the task report which line of the function produces each result. Do not add a test file.

- [ ] **Step 4: Commit**

```bash
git add src/lib/weather/place-for-weather.ts
git commit -m "feat(weather): pick the itinerary location a forecast describes"
```

---

### Task 2: Resolution order and the resolved label

**Files:**
- Modify: `src/lib/weather/get-trip-weather.ts` (whole file)
- Modify: `src/app/trips/[slug]/page.tsx:206-214` (feed the location in; keep the build green)

**Interfaces:**
- Consumes: `pickWeatherLocation` from Task 1; `geocodePlace` from `./geocode`.
- Produces:
  - `interface TripPlace { lat: number | null; lng: number | null; country: string | null; name: string; locationName?: string | null }`
  - `function getTripWeather(place: TripPlace, isoDate?: string): Promise<Weather | null>` (signature unchanged)
  - `function getTripWeekForecast(place: TripPlace): Promise<{ label: string; days: DayForecast[] } | null>` (**changed** return shape)

**Notes for the implementer:**

The bug being fixed: `geocodePlace(place.country ?? place.name)` puts the *least* specific known thing first, so a Madeira trip in Portugal geocodes to Lisbon. The new order is most-specific-first, and the itinerary location beats the trip's manual lat/lng because the pin is trip-level while the location is where you actually are.

`getWeekForecast` can return `null` on a failed fetch even when the coordinates resolved — keep returning `null` from `getTripWeekForecast` in that case rather than a label with empty days.

The trip-page edit in Step 3 passes `weekForecast?.days ?? null` to the rail. That line is temporary scaffolding so this task builds; Task 3 replaces it with the `{ label, days }` prop.

- [ ] **Step 1: Rewrite `src/lib/weather/get-trip-weather.ts`**

```ts
import { geocodePlace } from "./geocode"
import {
  getWeather,
  getWeekForecast,
  type DayForecast,
  type Weather,
} from "./get-weather"

interface TripPlace {
  lat: number | null
  lng: number | null
  country: string | null
  name: string
  /** Most specific place for this trip right now. Wins over the trip's own pin. */
  locationName?: string | null
}

interface Resolved {
  lat: number
  lng: number
  /** The string that produced these coordinates. */
  label: string
}

/**
 * Resolves a trip to coordinates, most specific candidate first: the itinerary
 * location we're on, then the trip's manual pin, then its name, then its
 * country. Country is last because it is the least specific thing we know --
 * forecasting Lisbon for a Madeira trip is the bug this order fixes. Returns
 * the label that produced the hit so callers can show which place they got.
 */
async function resolveCoords(place: TripPlace): Promise<Resolved | null> {
  if (place.locationName) {
    const geo = await geocodePlace(place.locationName)
    if (geo) return { ...geo, label: place.locationName }
  }
  if (place.lat != null && place.lng != null) {
    return { lat: place.lat, lng: place.lng, label: place.name }
  }
  const byName = await geocodePlace(place.name)
  if (byName) return { ...byName, label: place.name }
  if (place.country) {
    const byCountry = await geocodePlace(place.country)
    if (byCountry) return { ...byCountry, label: place.country }
  }
  return null
}

/**
 * Weather for a trip at its resolved coordinates. Null when there's no place to
 * locate. `isoDate` selects the season -- omit for today (on the road), pass the
 * trip's start date for a planning estimate.
 */
export async function getTripWeather(
  place: TripPlace,
  isoDate?: string,
): Promise<Weather | null> {
  const coords = await resolveCoords(place)
  if (!coords) return null
  return getWeather(coords.lat, coords.lng, isoDate)
}

/**
 * Real next-7-days forecast for a trip, with the label of the place it actually
 * forecasts. Null when there's no place to locate or the forecast call fails.
 */
export async function getTripWeekForecast(
  place: TripPlace,
): Promise<{ label: string; days: DayForecast[] } | null> {
  const coords = await resolveCoords(place)
  if (!coords) return null
  const days = await getWeekForecast(coords.lat, coords.lng)
  return days ? { label: coords.label, days } : null
}
```

- [ ] **Step 2: Confirm the two untouched call sites still type-check**

`src/app/home/trip-cards.tsx:113` and `src/app/on-the-road/page.tsx:63` both call
`getTripWeather(trip)`. `locationName` is optional, so neither needs an edit in
this task. Read both lines and confirm — do not modify them here.

- [ ] **Step 3: Feed the location in on the trip page**

In `src/app/trips/[slug]/page.tsx`, add the import next to the existing weather import (line 38):

```tsx
import { pickWeatherLocation } from "@/lib/weather/place-for-weather"
```

Replace lines 206-214 (the `packingWeather` / `weekForecast` / `packingNudge` block) with:

```tsx
  const weatherPlace = {
    ...header,
    locationName:
      pickWeatherLocation(locations ?? [], await localToday())?.name ?? null,
  }
  const [packingWeather, weekForecast] = await Promise.all([
    getTripWeather(weatherPlace, header.startDate ?? undefined),
    getTripWeekForecast(weatherPlace),
  ])
  const packingNudge = detectWeatherPacking({
    destination: header.country ?? header.name,
    weather: packingWeather,
    packingLabels: packingItems.map((i) => i.label.toLowerCase()),
  })
```

`localToday` is already imported at line 18. The nudge's `destination` still
reads `header.country ?? header.name` — Task 3 switches it to the resolved label.

Then keep the rail compiling by changing its `forecast` prop at line 345:

```tsx
        forecast={weekForecast?.days ?? null}
```

- [ ] **Step 4: Verify lint and build**

Run: `pnpm lint` then `pnpm build`
Expected: both clean.

- [ ] **Step 5: Reason through the resolution order and record the result**

Confirm by reading `resolveCoords`, and state in the task report:

- With `locationName: "Lanzarote"` and non-null `lat`/`lng`, the first `await` is `geocodePlace("Lanzarote")` and the manual pin is never reached.
- `place.country` reaches `geocodePlace` only after `locationName` (absent or unresolved), the pin (null), and `place.name` (unresolved) have all been tried.
- `getTripWeekForecast` returns `label` equal to the candidate string whose coordinates were passed to `getWeekForecast`.
- The trip page passes the *same* `weatherPlace` object to both weather calls.

- [ ] **Step 6: Commit**

```bash
git add src/lib/weather/get-trip-weather.ts "src/app/trips/[slug]/page.tsx"
git commit -m "fix(weather): forecast the trip's specific place, not its country"
```

---

### Task 3: The headline

**Files:**
- Modify: `src/components/week-forecast.tsx` (header row + props)
- Modify: `src/app/trips/[slug]/page.tsx` (rail prop, nudge destination)
- Modify: `src/app/on-the-road/page.tsx:63`

**Interfaces:**
- Consumes: `getTripWeekForecast`'s `{ label, days }` from Task 2.
- Produces:
  - `function WeekForecast(props: { forecast: DayForecast[]; label: string })`
  - `DesktopRightRail`'s `forecast` prop becomes `{ label: string; days: DayForecast[] } | null`

**Notes for the implementer:**

The rail is 280px wide with 24px of padding each side, so the header row has ~232px for label plus chevron. The label must truncate, not wrap and not push the chevron off the row: `min-w-0` + `truncate` on the label, `shrink-0` on the chevron. `Label` (`src/components/together/label.tsx`) forwards `className` to its span, so `truncate` lands on the right element.

`/on-the-road` gets no headline — the big `<em>{place}</em>` above the card already is one, and `locationName` is the same string that feeds it.

- [ ] **Step 1: Add the `label` prop to `WeekForecast`**

In `src/components/week-forecast.tsx`, replace the component signature and the header button (lines 33-47) with:

```tsx
export function WeekForecast({
  forecast,
  label,
}: {
  forecast: DayForecast[]
  label: string
}) {
  const [open, setOpen] = React.useState(false)
  if (forecast.length === 0) return null

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2"
      >
        <Label className="min-w-0 truncate">Weather · 7 day · {label}</Label>
        <Chevron
          dir={open ? "down" : "right"}
          className="shrink-0 text-muted-foreground"
        />
      </button>
```

Update the component's docstring first line to mention the header names the place it forecasts. Everything below the button is unchanged.

- [ ] **Step 2: Pass `{ label, days }` through the right rail**

In `src/app/trips/[slug]/page.tsx` (line numbers below are from `d4fbabc`, before
Task 2's edits — locate by name, not by number), change `DesktopRightRail`'s
prop type (line 548):

```tsx
  forecast: { label: string; days: DayForecast[] } | null
```

and its render line (593):

```tsx
      {forecast ? (
        <WeekForecast forecast={forecast.days} label={forecast.label} />
      ) : null}
```

Revert the Task 2 scaffolding at line 345 back to passing the whole object:

```tsx
        forecast={weekForecast}
```

- [ ] **Step 3: Make the packing nudge agree with the forecast**

Still in `src/app/trips/[slug]/page.tsx`, the `packingNudge` block's `destination` becomes the resolved label, falling back to the trip name when nothing resolved:

```tsx
  const packingNudge = detectWeatherPacking({
    destination: weekForecast?.label ?? header.country ?? header.name,
    weather: packingWeather,
    packingLabels: packingItems.map((i) => i.label.toLowerCase()),
  })
```

- [ ] **Step 4: Pass the location into `/on-the-road`'s weather**

In `src/app/on-the-road/page.tsx`, `locationName` is computed at line 85 —
*below* the `getTripWeather(trip)` call at line 63. Move the weather call below
the `locationName` / `place` / `searchDestination` block (after line 91) and
change it to:

```tsx
  const weather = await getTripWeather({ ...trip, locationName })
```

Assign to a `const` first if TypeScript complains about the extra `TripHeader`
properties in the literal:

```tsx
  const weatherPlace = { ...trip, locationName }
  const weather = await getTripWeather(weatherPlace)
```

Delete the old line 63. Confirm nothing between the old and new position reads
`weather` — as of `d4fbabc`, `weather` is first used in the JSX below line 93.

- [ ] **Step 5: Verify lint and build**

Run: `pnpm lint` then `pnpm build`
Expected: both clean.

- [ ] **Step 6: Reason through the wiring and record the result**

State in the task report:

- The `label` rendered in the header is the same string `resolveCoords` used to geocode — trace `coords.label` -> `{ label, days }` -> `forecast.label` -> `WeekForecast`.
- The nudge's `destination` and the header's label are the same expression when a forecast exists.
- A trip with no itinerary locations passes `locationName: null`, so resolution falls through to the pin / name / country and the bar still renders.

- [ ] **Step 7: Commit**

```bash
git add src/components/week-forecast.tsx "src/app/trips/[slug]/page.tsx" src/app/on-the-road/page.tsx
git commit -m "feat(weather): name the forecast's place in the 7-day header"
```

---

### Task 4: Logs and handover

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

**Notes for the implementer:**

Match the existing row/entry format in each file exactly — read the last few entries before writing. Mark the work **implemented**, not verified: nothing behind the UI has been checked.

- [ ] **Step 1: Add the TODO entry**

Add an entry under the current in-progress section recording: weather now resolves the itinerary location covering today (else the first leg) before the trip's pin/name/country, and the 7-day bar headlines that place. Status: *implemented; build and lint clean; unverified in app.*

- [ ] **Step 2: Add the DECISIONS row**

One row, dated 2026-07-28: **weather resolution is most-specific-first, and an itinerary location beats the trip's manual lat/lng.** Why: the pin is trip-level, the location is where you actually are; country-first silently forecast capitals (Lisbon for Madeira). Note the deliberate non-fix: `getWeather` is still a latitude/month stub, so only the trip page's 7-day bar becomes genuinely correct.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: log the weather location-resolution slice"
```

- [ ] **Step 4: Hand the user the in-app checklist**

Report *implemented; build and lint clean; unverified in app*, then hand over
verbatim:

1. On a trip whose country differs from its destination (Portugal / Madeira), the right-rail header reads `Weather · 7 day · <the destination>`, not the country.
2. The temperatures in that bar match a real forecast for that destination, not for the country's capital.
3. On a multi-location trip that is currently running, the headline names the leg you are on today, not the first leg.
4. On a trip that has not started, the headline names the first leg.
5. A long location name truncates in the 280px rail; the chevron stays on the row and the bar does not wrap or overflow.
6. `/on-the-road` still renders its weather card, and the place headline above it is unchanged.
7. `/home` hero cards still show their weather badge.
8. A trip with no itinerary locations still shows the forecast bar, headlined with the trip name.

---

## Success Criteria

### Verified by Claude

- `pnpm lint` clean and `pnpm build` succeeds after every code task.
- `pickWeatherLocation` returns `null` for `[]`, the span-covering location when one covers today, and the lowest-`sortOrder` location otherwise (Task 1, Step 3).
- `resolveCoords` geocodes `locationName` before reading `place.lat`/`place.lng`, and reaches `place.country` only after the three earlier candidates fail (Task 2, Step 5).
- `getTripWeekForecast` returns a `label` equal to the string that produced the coordinates it forecast.
- The trip page passes one `weatherPlace` object to both `getTripWeather` and `getTripWeekForecast`, and the packing nudge's `destination` is the forecast's label.
- `/home`'s `getTripWeather(trip)` call site is unmodified and still type-checks.
- `getWeather`'s body is unchanged.

### Verified by the user in-app

The eight-item checklist in Task 4, Step 4.
