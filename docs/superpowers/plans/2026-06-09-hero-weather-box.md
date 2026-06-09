# HeroCard Current-Weather Box Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a small condition-icon + temperature weather box top-left on the `/home` HeroCard for the trip's destination, built against a stubbed data function so a real API can be wired in later without UI changes.

**Architecture:** One stubbed data file (`get-weather.ts`) exposes `getWeather(lat, lng): Promise<Weather>` returning mock values; its return type uses WMO weather codes so a later Open-Meteo swap touches only this file. A `WeatherBadge` presentational component maps the code to a lucide icon and renders the temperature. `HeroCard` becomes an async server component that awaits the stub when the trip has coordinates and renders the badge beside the `// now` badge.

**Tech Stack:** Next.js 16 App Router (server components), TypeScript 5, lucide-react icons, Tailwind v4.

> **Note for the engineer:** This repo has **no test framework** (see `CLAUDE.md` — "There are no tests yet; do not invent a test command until one exists"). The verification gate for every task is `pnpm lint` then `pnpm build`, plus the stated visual check. Do **not** add a test runner or write unit tests.

---

### Task 1: Stubbed weather data file

**Files:**
- Create: `src/lib/weather/get-weather.ts`

- [ ] **Step 1: Create the file**

```ts
export interface Weather {
  tempC: number
  /** WMO weather code (Open-Meteo's scheme), drives the icon. */
  code: number
}

/**
 * Current weather at a coordinate. Stubbed with mock data until a real
 * provider is wired in; the signature and return type are fixed so the UI
 * never changes when the API lands. One file per integration -- no
 * provider-agnostic abstraction (see docs/TECH.md).
 */
export async function getWeather(lat: number, lng: number): Promise<Weather> {
  void lat
  void lng
  return { tempC: 24, code: 0 }
}
```

- [ ] **Step 2: Lint and build**

Run: `pnpm lint && pnpm build`
Expected: PASS, no errors. (`void lat`/`void lng` keep the unused params from tripping `no-unused-vars` while the body is a stub.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/weather/get-weather.ts
git commit -m "feat(weather): add stubbed getWeather data function"
```

---

### Task 2: WeatherBadge component + HeroCard wiring

**Files:**
- Modify: `src/app/home/trip-cards.tsx`

- [ ] **Step 1: Add the lucide icon import**

At the top of `src/app/home/trip-cards.tsx`, add the icon import (place it with the other imports, after the `next/link` import):

```ts
import { CloudIcon, CloudRainIcon, CloudSnowIcon, SunIcon } from "lucide-react"
```

Also add the data import alongside the existing `@/lib/trips/...` imports:

```ts
import { getWeather, type Weather } from "@/lib/weather/get-weather"
```

- [ ] **Step 2: Add the `WeatherBadge` component**

Add this above the `HeroCard` definition (just before the `/** Top-of-page hero card. ... */` comment), next to the other small card helpers like `SavedBar`:

```tsx
/** Maps a WMO weather code to one of four condition icons. */
function weatherIcon(code: number) {
  if (code >= 71 && code <= 77) return CloudSnowIcon
  if (code === 85 || code === 86) return CloudSnowIcon
  if (code >= 51 && code <= 67) return CloudRainIcon
  if (code >= 80 && code <= 82) return CloudRainIcon
  if (code >= 95) return CloudRainIcon
  if (code === 0) return SunIcon
  return CloudIcon
}

/** Condition icon + current temperature, shown top-left on the hero card. */
function WeatherBadge({ tempC, code }: Weather) {
  const Icon = weatherIcon(code)
  return (
    <span className="flex items-center gap-1 font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
      <Icon className="h-3 w-3" strokeWidth={2} />
      {Math.round(tempC)}°
    </span>
  )
}
```

- [ ] **Step 3: Make `HeroCard` async and fetch weather**

Change the `HeroCard` signature from sync to async and add the weather fetch. Replace:

```tsx
export function HeroCard({ trip }: { trip: TripListItem }) {
  const tone = slugToTone(trip.slug)
  const coord = formatCoord(trip.lat, trip.lng)
  const dateRange = formatDateRange(trip.startDate, trip.endDate)
```

with:

```tsx
export async function HeroCard({ trip }: { trip: TripListItem }) {
  const tone = slugToTone(trip.slug)
  const coord = formatCoord(trip.lat, trip.lng)
  const dateRange = formatDateRange(trip.startDate, trip.endDate)
  const weather =
    trip.lat != null && trip.lng != null
      ? await getWeather(trip.lat, trip.lng)
      : null
```

- [ ] **Step 4: Render the badge in the top-left cluster**

In `HeroCard`, replace the top-left/top-right row block:

```tsx
          <div className="flex items-start justify-between">
            {trip.state === "now" ? (
              <MonoBadge tone={monoBadgeTone[tone]}>{"// now"}</MonoBadge>
            ) : (
              <span />
            )}
            {coord ? <Coord>{coord}</Coord> : <span />}
          </div>
```

with (wrap the left side so badge and weather sit side-by-side):

```tsx
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              {trip.state === "now" ? (
                <MonoBadge tone={monoBadgeTone[tone]}>{"// now"}</MonoBadge>
              ) : null}
              {weather ? <WeatherBadge {...weather} /> : null}
            </div>
            {coord ? <Coord>{coord}</Coord> : <span />}
          </div>
```

Note: the left side is now always a `<div>` (even when empty), so the `justify-between` still pushes `coord` to the right. The `<span />` fallback for the badge is no longer needed because the wrapping `<div>` holds the row's left position.

- [ ] **Step 5: Verify `HeroCard` is awaited by its caller**

`HeroCard` is rendered in `src/app/home/page.tsx` inside `HomePage`, which is already an `async` server component. JSX renders async server components automatically, so no change is needed there. Confirm by reading `src/app/home/page.tsx` around the `<HeroCard trip={hero} />` usage — it is inside the async `HomePage` return, which is correct.

- [ ] **Step 6: Lint and build**

Run: `pnpm lint && pnpm build`
Expected: PASS, no errors.

- [ ] **Step 7: Visual check**

Run: `pnpm dev`, open http://localhost:3000/home on a phone-width viewport and desktop.
Expected:
- A "now" trip hero shows `// now  ☀ 24°` top-left, coords still top-right.
- An upcoming trip hero (no `// now` badge) shows `☀ 24°` alone top-left.
- A trip with no coordinates shows no weather and no broken layout.

- [ ] **Step 8: Commit**

```bash
git add src/app/home/trip-cards.tsx
git commit -m "feat(home): show current-weather box on the hero card"
```

---

### Task 3: Update docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Record the task in TODO.md**

In `docs/TODO.md`, add this entry as the last item of the `- [x]` completed list (just before the `## Working rules` heading), matching the surrounding `- [x] **Title** — Done DATE...` style:

```markdown
- [x] **HeroCard current-weather box** — Done 2026-06-09. The `/home` HeroCard shows a small condition-icon + current temperature top-left (beside the `// now` badge; alone on an upcoming trip), for the trip's destination; coords stay top-right. Data goes through one stubbed file `src/lib/weather/get-weather.ts` (`getWeather(lat, lng): Promise<Weather>`, `Weather = { tempC, code }` with `code` = WMO weather code) returning mock values — `HeroCard` is now an async server component that awaits it when the trip has `lat`/`lng`, else renders no weather. `WeatherBadge` in `trip-cards.tsx` maps the WMO code to a lucide icon (clear/cloudy/rain/snow). **Real weather API deferred** — wiring it later changes only the stub's body, never the UI. Spec: `docs/superpowers/specs/2026-06-09-hero-weather-box-design.md`; plan: `docs/superpowers/plans/2026-06-09-hero-weather-box.md`. Build + lint clean.
```

- [ ] **Step 2: Record the decision in DECISIONS.md**

In `docs/DECISIONS.md`, append this row to the end of the table (after the `WorldMapBg` row, before the `## Notes` heading):

```markdown
| **Weather goes through one stubbed `src/lib/weather/get-weather.ts`; UI built first, real API deferred** | The user wanted the weather box designed/built now and a real provider wired later (and to keep future API integrations as one file each, not a shared abstraction). `getWeather(lat, lng): Promise<Weather>` returns mock data with the return type fixed (`{ tempC, code }`, `code` = WMO weather code) so the later swap to a real provider (e.g. Open-Meteo, which speaks WMO codes and needs no key) touches only this function's body — the `WeatherBadge` UI never changes. One file per integration, no provider-agnostic layer — matches the "integration is one file" principle in `docs/TECH.md` (same reason Claude is one file). | 2026-06-09 |
```

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record HeroCard weather box"
```
