# HeroCard current-weather box — design

**Date:** 2026-06-09
**Status:** Approved, ready for implementation plan

## Goal

Show a small current-day weather box (condition icon + temperature) on the
`/home` HeroCard, for the destination of the trip the card represents.

The UI is built now against a stubbed data function returning mock values. A
real weather API is wired in later by swapping only the stub's internals — the
component and types do not change.

## Placement

On the HeroCard (`src/app/home/trip-cards.tsx`, `HeroCard`):

- Weather sits **top-left**, side-by-side with the `// now` badge:
  `// now  ☀ 24°`.
- On an **upcoming** trip (no `// now` badge) the weather sits alone top-left.
- **Coordinates stay top-right**, unchanged.
- Only the HeroCard gets weather — the smaller `TripCard`s do not.

```
// now  ☀ 24°            41.9N·12.5E


Rome
ITALY
```

## Data layer — one stubbed file

`src/lib/weather/get-weather.ts`:

```ts
export interface Weather {
  tempC: number
  /** WMO weather code (Open-Meteo's scheme), drives the icon. */
  code: number
}

export async function getWeather(lat: number, lng: number): Promise<Weather> {
  // Stub: realistic mock until a real API is wired in.
  return { tempC: 24, code: 0 }
}
```

- `code` uses the WMO weather-code scheme so a later swap to Open-Meteo (or
  any provider that exposes WMO codes) only changes this function's body.
- Signature and return type are fixed — the UI never changes when the real API
  lands.
- One file per integration, wired when needed. No generic provider-agnostic
  "API layer" abstraction (per `docs/TECH.md`).

## Presentation — `WeatherBadge`

A small component in `trip-cards.tsx`, alongside the other card pieces:

- Props: `{ tempC, code }`.
- Renders a **small inline SVG condition icon + `24°`** (rounded temp, degree
  glyph).
- A tiny `code → icon` map buckets WMO codes into a few conditions: clear,
  cloudy, rain, snow (fallback: cloudy).
- **No emoji** — icons are inline SVGs (house rule). Styled muted/mono to match
  the existing card corner treatment (`Coord`, `MonoBadge`).

## Wiring

- `HeroCard` becomes an `async` server component.
- When `trip.lat` and `trip.lng` are both present, it `await getWeather(lat, lng)`
  and renders `<WeatherBadge>` in the top-left cluster.
- If the trip has no coordinates, no weather renders — the same graceful rule
  the coordinate display already follows.
- Weather shows **today's** conditions at the destination regardless of trip
  state (now or upcoming).

## Out of scope (now)

- No loading or error UI — the stub is synchronous, nothing can fail yet.
- When the real fetch lands, revisit whether to keep it in the async server
  component or move it to a small client island so it does not block page
  render. Not decided or built now.
- Weather on `TripCard`, `CompactRow`, or `DreamTile`.
- Forecasts, high/low, condition text, hourly data.

## Files touched

- **New:** `src/lib/weather/get-weather.ts`
- **Edit:** `src/app/home/trip-cards.tsx` (`HeroCard` → async, add `WeatherBadge`)
