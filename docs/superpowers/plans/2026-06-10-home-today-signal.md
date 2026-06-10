# Home Hero "Today" Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/home`, when the hero trip is active, surface today's day title + summary (server-rendered) and the next/last event by the browser clock (client component) in the hero card footer.

**Architecture:** A focused query fetches the hero trip's today (the `itinerary_days` row for today's date). `HeroCard` (already a server component) renders the title + summary; a small `"use client"` `TodayNextEvent` computes the next-vs-last timed event from the browser clock to get the user's local time right. No schema change.

**Tech Stack:** Next.js 16 App Router (Server + Client Components), React 19, Supabase, TypeScript 5. No test framework — validate with `pnpm build` / `pnpm lint` and a manual check.

**Spec:** `docs/superpowers/specs/2026-06-10-home-today-signal-design.md`

**Commit cadence:** one small coherent feature; commit once at the end after build/lint pass (Task 6).

---

### Task 1: `daySummary` helper in itinerary-types

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts`

The itinerary card has a `daySummary` (in the client `itinerary-tab.tsx`); the server `HeroCard` needs the same fallback. Add a pure version to the shared types module (no sort needed — only the single-event and count cases use event text).

- [ ] **Step 1: Add the helper at the end of `itinerary-types.ts`**

```ts
/** One-line summary for a day: the typed sub, else a cheap hint from the events
 * (the lone event's text, or "N events"), else "". Pure; safe server or client. */
export function daySummary(day: ItineraryDay): string {
  if (day.sub.trim()) return day.sub
  if (day.events.length === 0) return ""
  if (day.events.length === 1) return day.events[0].text
  return `${day.events.length} events`
}
```

---

### Task 2: `getTodayForTrip` query

**Files:**
- Modify: `src/lib/trips/itinerary-queries.ts`

- [ ] **Step 1: Add the query below `getItineraryDays`**

```ts
export async function getTodayForTrip(
  tripId: string,
  today: string,
): Promise<ItineraryDay | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("itinerary_days")
    .select("id, day_date, title, sub, events, tag, tone, group_id, group_name, location_id")
    .eq("trip_id", tripId)
    .eq("day_date", today)
    .maybeSingle()

  return data ? rowToItineraryDay(data) : null
}
```

(`rowToItineraryDay` is already imported in this file.)

---

### Task 3: `TodayNextEvent` client component

**Files:**
- Create: `src/app/home/today-next-event.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client"

import React from "react"

import type { ItineraryEvent } from "@/lib/trips/itinerary-types"

/** Current local time as a zero-padded "HH:MM" so it compares with event times. */
function nowHhMm(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`
}

/**
 * The day's next upcoming timed event, falling back to the last once they've all
 * passed (so it never goes empty). Untimed events are ignored. Renders nothing
 * when there are no timed events. Uses the browser clock (correct local time);
 * computed after mount to avoid a server/client hydration mismatch.
 */
export function TodayNextEvent({ events }: { events: ItineraryEvent[] }) {
  const [now, setNow] = React.useState<string | null>(null)
  React.useEffect(() => setNow(nowHhMm()), [])

  const timed = events
    .filter((e) => e.time)
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  if (timed.length === 0 || now === null) return null

  const upcoming = timed.find((e) => e.time >= now)
  const pick = upcoming ?? timed[timed.length - 1]
  const label = upcoming ? "next" : "last"

  return (
    <div className="mt-0.5 font-mono text-[11px] tracking-[0.04em] text-muted-foreground">
      <span className="uppercase tracking-[0.14em] text-foreground/70">
        {label}
      </span>{" "}
      <span className="t-num">{pick.time}</span> · {pick.text}
    </div>
  )
}
```

---

### Task 4: `HeroCard` renders the today block

**Files:**
- Modify: `src/app/home/trip-cards.tsx`

- [ ] **Step 1: Imports**

Add to the existing imports:

```tsx
import { getWeather, type Weather } from "@/lib/weather/get-weather"
import { daySummary, type ItineraryDay } from "@/lib/trips/itinerary-types"
import { TodayNextEvent } from "./today-next-event"
```

(The `getWeather` line already exists — add the other two new imports near it.)

- [ ] **Step 2: Add the `today` prop**

Change the signature:

```tsx
export async function HeroCard({
  trip,
  today,
}: {
  trip: TripListItem
  today?: ItineraryDay | null
}) {
```

- [ ] **Step 3: Render the today block in the footer**

In the footer `<div className="px-4 py-3 md:px-5 md:py-3.5">`, immediately inside it and before the existing `<div className="flex items-center justify-between">`, add:

```tsx
        {today ? (
          <div className="mb-2.5">
            <div className="t-display text-[17px] leading-tight text-foreground">
              {today.title}
            </div>
            {daySummary(today) ? (
              <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                {daySummary(today)}
              </div>
            ) : null}
            <TodayNextEvent events={today.events} />
          </div>
        ) : null}
```

The existing date-range row and `SavedBar` stay below it unchanged.

---

### Task 5: `home/page.tsx` fetches today for the hero

**Files:**
- Modify: `src/app/home/page.tsx`

- [ ] **Step 1: Import the query**

Add to the import from `@/lib/trips/itinerary-queries` (the file currently imports nothing from there — add a new import line near the other `@/lib/trips/*` imports):

```tsx
import { getTodayForTrip } from "@/lib/trips/itinerary-queries"
```

- [ ] **Step 2: Fetch today for the active hero**

After the `heroLocations` line, add:

```tsx
  const heroToday =
    hero && hero.state === "now"
      ? await getTodayForTrip(hero.id, new Date().toISOString().slice(0, 10))
      : null
```

- [ ] **Step 3: Pass it to `HeroCard`**

```tsx
                <HeroCard trip={hero} today={heroToday} />
```

---

### Task 6: Build, lint, verify, commit

**Files:** none (verification), then `docs/TODO.md`, `docs/DECISIONS.md`

- [ ] **Step 1: Build** — `pnpm build`. Expected: PASS.
- [ ] **Step 2: Lint** — `pnpm lint`. Expected: clean (watch the React-19 `set-state-in-effect` rule — the `useEffect` here reads the clock on mount, which is a genuine effect, not a prop-reset).
- [ ] **Step 3: Manual** — `pnpm dev`, open `/home` with a hero trip spanning today (2026-06-10):
  - The hero footer shows today's **title**, its **summary** (when set), and a `next HH:MM · text` line.
  - As the day's event times pass (or by temporarily editing an event's time earlier/later), the line switches between `next …` and `last …`.
  - A day with no timed events shows just title + summary (no next line); a trip not spanning today, or today with no itinerary day, shows the hero unchanged.
- [ ] **Step 4: Docs** — add a done entry to `docs/TODO.md` (home hero surfaces the active trip's today: title + summary + next/last event; client component for local-time correctness; hero-only) and a `docs/DECISIONS.md` row (next/last event computed client-side on the browser clock because the hero is a UTC server component; hero-only; no ticker).
- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/itinerary-types.ts src/lib/trips/itinerary-queries.ts src/app/home/today-next-event.tsx src/app/home/trip-cards.tsx src/app/home/page.tsx docs/TODO.md docs/DECISIONS.md
git commit -m "feat(home): surface the active trip's today on the hero"
```

---

## Self-review notes (for the implementer)

- **Hydration safety:** `TodayNextEvent` renders `null` until `useEffect` sets `now` after mount, so server and client first-paint agree (no time-based mismatch).
- **Local time on purpose:** the next/last comparison uses the browser clock, unlike the UTC `today` used elsewhere — that's the whole reason it's a client component.
- **No schema/migration** — pure read + render.
- **`daySummary` now lives in `itinerary-types.ts`**; the client `itinerary-tab.tsx` keeps its own copy (out of scope to refactor here — leave it, or fold it into the import in a later cleanup).
