# Local "today" via device timezone — design

**Date:** 2026-06-16
**Status:** Approved (pending spec review)
**Resolves:** the carried TODO item "'Today' for during-trip mode is UTC-derived" — the same UTC bug also affects trip bucketing, the home today signal, on-the-road, and logged-expense/settlement dates.

## Problem

Every place that means "the current local date" computes it as
`new Date().toISOString().slice(0, 10)`, which is the **UTC** date. On
Vercel (UTC) the server is always UTC; in the browser `toISOString()`
also converts to UTC. So anyone using the app in the evening at a
positive-offset destination (Lombok is UTC+8) sees *tomorrow's* date.

That breaks, concretely:

- **Trip bucketing** (`list-queries.ts`) — now / upcoming / past, which
  drives `/home`, the `/on-the-road` redirect guard, and sign-in landing.
- **During-trip itinerary mode** (`page.tsx` → `itinerary-tab.tsx`) — the
  Past bar, today-auto-expand, and dimming all key off `today`.
- **Home today signal** (`home/page.tsx` → `getTodayForTrip`).
- **On the road** (`on-the-road/page.tsx`) — today's day, spent-today,
  notes-for-day, looking-ahead.
- **Stamped dates** — settlement `day_date` (`actions.ts`) and the
  new-expense default date (`log-expense-row.tsx`, wrong even client-side).

## Decision

Use the **device timezone**. On the trip your phone auto-switches to the
destination zone, so the device date is correct in practice with no
schema and no dependencies. (Trip-location timezone, derived from
lat/lng or a stored field, was considered and deferred — see Deferred.)

## Approach

The browser knows its zone; the server (where the date-keyed data is
fetched) does not. Bridge them with a cookie carrying the IANA timezone,
then compute the date from that zone with the built-in `Intl` API.

### Components

**1. Pure date helper — `src/lib/time/today.ts`** (no `next/headers`, so
both server and client can import it; follows the client/types split rule).

```ts
export const TZ_COOKIE = "tz"

/** "yyyy-mm-dd" for `now` rendered in the given IANA timezone. */
export function todayInTimeZone(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return `${get("year")}-${get("month")}-${get("day")}`
}

/** Device-local today, for use in client components. */
export function deviceToday(): string {
  return todayInTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
}
```

**2. Server helper — `src/lib/time/local-today.ts`** (server-only; reads
the cookie). Falls back to `"UTC"` when the cookie is absent, which
reproduces today's behavior — a safe default, never an error.

```ts
import { cookies } from "next/headers"
import { TZ_COOKIE, todayInTimeZone } from "./today"

export async function localToday(): Promise<string> {
  const tz = (await cookies()).get(TZ_COOKIE)?.value || "UTC"
  return todayInTimeZone(tz)
}
```

**3. Cookie setter — `src/components/timezone-cookie.tsx`** (`"use client"`,
renders `null`, mounted once in `src/app/layout.tsx`). On mount it reads
the device zone; if the `tz` cookie is missing or stale it writes it
(`path=/`, `max-age` ~1 year, `SameSite=Lax`) and calls `router.refresh()`
so the server re-renders with the correct date.

### Call-site changes

Replace `new Date().toISOString().slice(0, 10)` with `await localToday()` at:

- `src/lib/trips/list-queries.ts` (bucketing)
- `src/app/home/page.tsx` (`getTodayForTrip` arg)
- `src/app/on-the-road/page.tsx`
- `src/app/trips/[slug]/page.tsx` (compute `const today = await localToday()`, pass as the `today` prop)
- `src/lib/trips/actions.ts` (`TODAY` becomes `async () => localToday()`, awaited at the two settlement inserts)

Client default in `src/app/trips/[slug]/log-expense-row.tsx`: use
`deviceToday()` instead of the UTC slice.

## Fallback / first render

On a cold first visit the `tz` cookie does not exist yet, so `localToday()`
returns the UTC date for that one render. The `TimezoneCookie` component
then sets the cookie and calls `router.refresh()`, after which every
server component re-renders with the device date. The transient window is
a single render and self-heals; acceptable for a two-person app.

No new caching concern: the affected pages already read auth cookies and
are therefore dynamic; reading one more cookie changes nothing.

## Testing / verification

- Set the OS/browser timezone to `Asia/Makassar` (UTC+8) and load late in
  the UTC evening; confirm the home today signal, during-trip itinerary
  emphasis, and on-the-road header all show the local date, not tomorrow.
- Quick check without changing OS tz: set the `tz` cookie to a far-east
  zone in devtools and confirm the rendered date advances.
- Log an expense near local midnight; confirm `day_date` is the local date.

## Deferred

- **Trip-location timezone** (from lat/lng or a stored IANA field) — would
  be correct even on a device still on home time. Extra lookup/dependency
  or schema + a picker; not worth it while the app is used on the phone
  you're traveling with.
- Multi-device disagreement and sub-render staleness beyond the one
  self-healing refresh.
