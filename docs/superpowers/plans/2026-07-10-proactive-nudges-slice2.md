# Proactive Nudges (Assistant Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first two data-triggered proactive nudges — planning weather/season packing and on-the-road near-daily-cap — proving the whole proactive pipeline end to end.

**Architecture:** Detectors are pure functions (`context -> Nudge | null`) run in a server component on render — zero tokens. A nudge surfaces inside the expanded assistant block (planning) or as a free line on the on-the-road page (on the road). The only token spend is an explicit `help` tap into an existing tool (packing `/ suggest`, or the find-a-place door).

**Tech Stack:** Next.js 16 (App Router, Server Components), React 19, TypeScript 5, Tailwind v4. No new deps, no migration, no `lib/ai` seam change.

**Spec:** `docs/superpowers/specs/2026-07-10-proactive-nudges-slice2-design.md`

## Global Constraints

- **Suggest-only:** detectors and nudge UI read only; they never write. The only writes are existing user-driven actions behind explicit taps.
- **Token control:** detection is 100% deterministic — no Claude call on render, in either mode. Tokens spend only on an explicit `help` tap into an existing tool.
- **On/off contract:** planning nudges render only inside the expanded (AI-on) assistant block; on-the-road nudges are free page lines (displaying them costs nothing).
- **No emojis** in code, prints, or logs. Sparse comments; clear names; short functions.
- **European dates** where dates display (`en-GB`); not relevant to this slice's copy.
- **EUR money format:** whole units as `EUR 123` (matches `suggestion-actions.ts`).
- **No test runner exists** (CLAUDE.md: do not invent a test command). Verification per task is `pnpm lint` + `pnpm build` clean, plus the in-app checks named in the task. The two pure detectors are exercised end-to-end in Tasks 3 and 4.

---

## File Structure

- Create: `src/lib/nudges/types.ts` — `Nudge`, `NudgeHelp`, the two context shapes.
- Create: `src/lib/nudges/weather-packing.ts` — `detectWeatherPacking`.
- Create: `src/lib/nudges/near-daily-cap.ts` — `detectNearDailyCap`.
- Create: `src/components/nudge-line.tsx` — presentational client component.
- Create: `src/app/on-the-road/road-nudge.tsx` — thin client wrapper (help = expand assistant + scroll).
- Modify: `src/lib/weather/get-weather.ts` — optional `isoDate` arg + latitude/month varying body.
- Modify: `src/components/assistant-block.tsx` — optional `nudge` prop, render `NudgeLine` in expanded area.
- Modify: `src/app/trips/[slug]/packing-tab.tsx` — thread `packingNudge` prop to the packing `AssistantBlock`.
- Modify: `src/app/trips/[slug]/page.tsx` — compute the planning weather-packing nudge, pass to `PackingTab`.
- Modify: `src/app/on-the-road/page.tsx` — compute the near-cap nudge, render `RoadNudge`, wrap the block with a scroll anchor.

---

## Task 1: Varying weather mock

**Files:**
- Modify: `src/lib/weather/get-weather.ts`

**Interfaces:**
- Produces: `getWeather(lat: number, lng: number, isoDate?: string): Promise<Weather>` — new optional third arg, defaults to today. Return type `Weather` unchanged.

- [ ] **Step 1: Replace the constant body with a latitude/month model**

Replace the whole `getWeather` function (currently lines 27-44) with:

```ts
/**
 * Current weather at a coordinate, as a deterministic function of latitude and
 * the month of `isoDate` (defaults to today). Hemisphere-aware: warmest in the
 * local summer, colder toward the poles, seasonal swing grows with latitude.
 * Still a stub -- no network, no key. When the real Open-Meteo call lands the
 * body swaps out; the signature and return type stay fixed so nothing downstream
 * changes. The planning path passes a future trip's start date so it reads that
 * trip's season, not today's; that path is a seasonal estimate, not a forecast.
 */
export async function getWeather(
  lat: number,
  lng: number,
  isoDate?: string,
): Promise<Weather> {
  void lng
  const month = isoDate ? Number(isoDate.slice(5, 7)) : new Date().getUTCMonth() + 1
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
    hourly: [
      { time: "12:00", tempC, code: 0 },
      { time: "15:00", tempC: tempC + 2, code: 1 },
      { time: "18:00", tempC: tempC - 1, code: 2 },
      { time: "21:00", tempC: tempC - 3, code: 3 },
    ],
  }
}
```

Expected sanity values (implementer can eyeball, not required to run): Bergen (lat 60.4) in December (`isoDate` month 12) -> `tempC` ~ -4, `lowC` ~ -7 (cold, triggers). Bergen in July -> `tempC` ~ 19 (mild, no trigger). Marrakech (lat 31.6) in July -> `tempC` ~ 24 (warm, no cold trigger).

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: no errors. The existing on-the-road and home-card calls `getWeather(trip.lat, trip.lng)` still type-check (third arg optional).

- [ ] **Step 3: In-app check (weather card still renders)**

Open `/on-the-road` on an active trip that has coordinates. Expected: the weather card renders a temperature that reflects the location's latitude/season (no crash, no `24` hardcode).

- [ ] **Step 4: Commit**

```bash
git add src/lib/weather/get-weather.ts
git commit -m "feat(weather): vary the mock by latitude and month"
```

---

## Task 2: Nudge types + the two pure detectors

**Files:**
- Create: `src/lib/nudges/types.ts`
- Create: `src/lib/nudges/weather-packing.ts`
- Create: `src/lib/nudges/near-daily-cap.ts`

**Interfaces:**
- Consumes: `Weather` from `@/lib/weather/get-weather`.
- Produces:
  - `type Nudge = { id: string; text: string; help?: NudgeHelp }`
  - `type NudgeHelp = { label: string }`
  - `detectWeatherPacking(ctx: WeatherPackingContext): Nudge | null`
  - `detectNearDailyCap(ctx: NearDailyCapContext): Nudge | null`

- [ ] **Step 1: Create the types**

Create `src/lib/nudges/types.ts`:

```ts
import type { Weather } from "@/lib/weather/get-weather"

/** An optional token-spending action a nudge offers; only runs when tapped. */
export type NudgeHelp = {
  label: string
}

/** A deterministic, zero-token proactive nudge. */
export type Nudge = {
  id: string
  text: string
  help?: NudgeHelp
}

export type WeatherPackingContext = {
  destination: string
  weather: Weather | null
  /** Packing labels, lowercased. */
  packingLabels: string[]
}

export type NearDailyCapContext = {
  plannedBudgetCents: number
  /** Inclusive trip day count. */
  tripDays: number
  spentTodayCents: number
}
```

- [ ] **Step 2: Create the weather-packing detector**

Create `src/lib/nudges/weather-packing.ts`:

```ts
import type { Nudge, WeatherPackingContext } from "./types"

const WARM_KEYWORDS = [
  "jacket",
  "coat",
  "sweater",
  "jumper",
  "fleece",
  "thermal",
  "gloves",
  "hat",
  "scarf",
]
const COLD_LOW_C = 10

/** Fires when the destination is cold for the trip's season and no warm item is
 * on the packing list yet. Pure: reads context, returns a nudge or null. */
export function detectWeatherPacking(ctx: WeatherPackingContext): Nudge | null {
  const { destination, weather, packingLabels } = ctx
  if (!weather) return null
  if (weather.lowC > COLD_LOW_C) return null
  const hasWarm = packingLabels.some((label) =>
    WARM_KEYWORDS.some((word) => label.includes(word)),
  )
  if (hasWarm) return null
  return {
    id: "weather-packing",
    text: `${destination} will be cold (${weather.lowC}°C) — pack warm layers.`,
  }
}
```

- [ ] **Step 3: Create the near-daily-cap detector**

Create `src/lib/nudges/near-daily-cap.ts`:

```ts
import type { Nudge, NearDailyCapContext } from "./types"

const CAP_FRACTION = 0.9
const EUR = (cents: number) => `EUR ${Math.round(cents / 100)}`

/** Fires when today's spend reaches 90% of the flat daily cap (budget / days).
 * Pure: reads context, returns a nudge or null. */
export function detectNearDailyCap(ctx: NearDailyCapContext): Nudge | null {
  const { plannedBudgetCents, tripDays, spentTodayCents } = ctx
  if (plannedBudgetCents === 0 || tripDays === 0) return null
  const dailyCap = plannedBudgetCents / tripDays
  if (spentTodayCents < CAP_FRACTION * dailyCap) return null
  return {
    id: "near-daily-cap",
    text: `You've spent ${EUR(spentTodayCents)} of today's ~${EUR(dailyCap)} budget.`,
    help: { label: "find a cheaper spot" },
  }
}
```

Expected behavior (verified end-to-end in Tasks 3 and 4): weather-packing returns a nudge only when `weather.lowC <= 10` and no label contains a warm keyword; near-daily-cap returns a nudge only when `plannedBudgetCents > 0`, `tripDays > 0`, and `spentTodayCents >= 0.9 * plannedBudgetCents / tripDays`.

- [ ] **Step 4: Verify lint + build (type-check)**

Run: `pnpm lint && pnpm build`
Expected: no errors. (The detectors are unused until Tasks 3-4; `build` confirms the types compile.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/nudges/
git commit -m "feat(nudges): pure weather-packing and near-daily-cap detectors"
```

---

## Task 3: Surface the planning nudge (NudgeLine + AssistantBlock + packing wiring)

**Files:**
- Create: `src/components/nudge-line.tsx`
- Modify: `src/components/assistant-block.tsx`
- Modify: `src/app/trips/[slug]/packing-tab.tsx`
- Modify: `src/app/trips/[slug]/page.tsx`

**Interfaces:**
- Consumes: `Nudge` (Task 2), `detectWeatherPacking` (Task 2), `getWeather` (Task 1).
- Produces:
  - `NudgeLine({ nudge, onHelp? }: { nudge: Nudge; onHelp?: () => void })`
  - `AssistantBlock` gains optional prop `nudge?: Nudge | null`.
  - `PackingTab` gains optional prop `packingNudge?: Nudge | null`.

- [ ] **Step 1: Create the NudgeLine component**

Create `src/components/nudge-line.tsx`:

```tsx
"use client"

import type { Nudge } from "@/lib/nudges/types"

/** Presentational: the free nudge text plus an optional help button. The help
 * action (token-spending) is supplied by the caller via onHelp. */
export function NudgeLine({
  nudge,
  onHelp,
}: {
  nudge: Nudge
  onHelp?: () => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[12.5px] leading-snug text-moss">{nudge.text}</p>
      {nudge.help && onHelp ? (
        <button
          type="button"
          onClick={onHelp}
          className="self-start font-mono text-[9.5px] uppercase tracking-[0.2em] text-moss"
        >
          {nudge.help.label}
        </button>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Add the `nudge` prop to AssistantBlock and render it**

In `src/components/assistant-block.tsx`, add the import near the other imports:

```tsx
import { NudgeLine } from "@/components/nudge-line"
```

Add `nudge` to the props type and destructuring. Change the signature block:

```tsx
export function AssistantBlock({
  surface,
  tripSlug,
  door,
  nudge,
  className,
}: {
  surface: SurfaceKey
  tripSlug?: string
  door?: React.ReactNode
  nudge?: Nudge | null
  className?: string
}) {
```

Add the `Nudge` type import:

```tsx
import type { SurfaceKey, Suggestion } from "@/lib/ai/suggestion-types"
import type { Nudge } from "@/lib/nudges/types"
```

In the expanded area, insert the nudge above `/ suggest`. Replace:

```tsx
      {enabled ? (
        <div className="flex flex-col">
          <Divider />
          <div className="px-4 py-3">
            <SuggestLine surface={surface} tripSlug={tripSlug} />
          </div>
```

with:

```tsx
      {enabled ? (
        <div className="flex flex-col">
          {nudge ? (
            <>
              <Divider />
              <div className="px-4 py-3">
                <NudgeLine nudge={nudge} />
              </div>
            </>
          ) : null}
          <Divider />
          <div className="px-4 py-3">
            <SuggestLine surface={surface} tripSlug={tripSlug} />
          </div>
```

(No `onHelp` here: the `/ suggest` control directly below is the planning token path.)

- [ ] **Step 3: Thread `packingNudge` through PackingTab to the packing AssistantBlock**

In `src/app/trips/[slug]/packing-tab.tsx`:

Add the type import near the other imports:

```tsx
import type { Nudge } from "@/lib/nudges/types"
```

Add to `PackingTabProps` (after `daysOut`):

```tsx
  daysOut: number | null
  packingNudge?: Nudge | null
```

Destructure it in the `PackingTab` function signature (add `packingNudge` alongside the other props), then pass it to the `<PackingList ...>` render (the one at line ~314). Add this prop to that `<PackingList>`:

```tsx
          packingNudge={packingNudge}
```

Add `packingNudge` to `PackingListProps`:

```tsx
  onReorder: (owner: string | null, orderedIds: string[]) => void
  packingNudge?: Nudge | null
```

Destructure `packingNudge` in the `PackingList` function signature (add it to the destructured params), then pass it to the packing `AssistantBlock` (line ~496):

```tsx
        <AssistantBlock
          surface="packing"
          tripSlug={tripSlug}
          nudge={packingNudge}
          door={
```

- [ ] **Step 4: Compute the nudge in the trip page and pass it to PackingTab**

In `src/app/trips/[slug]/page.tsx`:

Add imports near the top:

```tsx
import { getWeather } from "@/lib/weather/get-weather"
import { detectWeatherPacking } from "@/lib/nudges/weather-packing"
```

Before the `return`, after `packingItems` is available (it is loaded in the `Promise.all` at line ~181), compute the nudge:

```tsx
  const packingWeather =
    header.lat != null && header.lng != null
      ? await getWeather(header.lat, header.lng, header.startDate ?? undefined)
      : null
  const packingNudge = detectWeatherPacking({
    destination: header.country ?? header.name,
    weather: packingWeather,
    packingLabels: packingItems.map((i) => i.label.toLowerCase()),
  })
```

Pass it to `<PackingTab>` (line ~264) by adding:

```tsx
            packingNudge={packingNudge}
```

- [ ] **Step 5: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: no errors.

- [ ] **Step 6: In-app check**

Open a trip whose coordinates + start month are cold (e.g. a northern-latitude trip with a winter start date) and whose packing list has no warm item. Go to the Packing tab, expand the assistant block. Expected: the nudge line "`<place>` will be cold (`N`°C) — pack warm layers." appears above `/ suggest`. Add a packing item labelled "jacket" and reload. Expected: the nudge is gone.

- [ ] **Step 7: Commit**

```bash
git add src/components/nudge-line.tsx src/components/assistant-block.tsx src/app/trips/[slug]/packing-tab.tsx src/app/trips/[slug]/page.tsx
git commit -m "feat(nudges): surface weather-packing nudge in the planning assistant block"
```

---

## Task 4: Surface the on-the-road nudge (RoadNudge + page wiring)

**Files:**
- Create: `src/app/on-the-road/road-nudge.tsx`
- Modify: `src/app/on-the-road/page.tsx`

**Interfaces:**
- Consumes: `Nudge` (Task 2), `detectNearDailyCap` (Task 2), `NudgeLine` (Task 3), `useAiMode` from `@/components/ai-mode`.
- Produces: `RoadNudge({ nudge }: { nudge: Nudge })`.

- [ ] **Step 1: Create the RoadNudge wrapper**

Create `src/app/on-the-road/road-nudge.tsx`:

```tsx
"use client"

import { NudgeLine } from "@/components/nudge-line"
import { useAiMode } from "@/components/ai-mode"
import type { Nudge } from "@/lib/nudges/types"

/** On-the-road nudge: a free line whose help tap expands the assistant block
 * (turning AI on) and scrolls to it, where the find-a-place door lives. Expanding
 * is free; the token spend is one further explicit tap (running a door search). */
export function RoadNudge({ nudge }: { nudge: Nudge }) {
  const { setEnabled } = useAiMode()
  function onHelp() {
    setEnabled(true)
    document
      .getElementById("road-assistant")
      ?.scrollIntoView({ behavior: "smooth" })
  }
  return (
    <div className="mt-4 rounded-[14px] border border-l-2 border-border border-l-moss bg-card px-4 py-3">
      <NudgeLine nudge={nudge} onHelp={onHelp} />
    </div>
  )
}
```

- [ ] **Step 2: Wire the on-the-road page**

In `src/app/on-the-road/page.tsx`:

Add imports:

```tsx
import { detectNearDailyCap } from "@/lib/nudges/near-daily-cap"
import { RoadNudge } from "./road-nudge"
```

After `spentTodayCents` is computed (line ~69), compute the day count and nudge:

```tsx
  const msPerDay = 86400000
  const tripDays =
    trip.startDate && trip.endDate
      ? Math.round((Date.parse(trip.endDate) - Date.parse(trip.startDate)) / msPerDay) + 1
      : 0
  const capNudge = detectNearDailyCap({
    plannedBudgetCents: trip.plannedBudgetCents,
    tripDays,
    spentTodayCents,
  })
```

Add the scroll anchor around the existing `AssistantBlock` (line ~107). Wrap it:

```tsx
        <div id="road-assistant">
          <AssistantBlock
            surface="road"
            tripSlug={trip.slug}
            className="mb-4 block"
            door={
              <RoadPlaceDoor
                tripId={trip.id}
                tripSlug={trip.slug}
                dayDate={today}
                dayId={todayDay?.id ?? null}
                destination={searchDestination}
              />
            }
          />
        </div>
```

Render the nudge just above `<QuickExpense ...>` (line ~165):

```tsx
      {capNudge ? <RoadNudge nudge={capNudge} /> : null}

      <QuickExpense
```

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: no errors.

- [ ] **Step 4: In-app check**

On an active trip with a planned budget set, log expenses dated today until today's spend passes 90% of `plannedBudget / tripDays`. Expected: on `/on-the-road`, the line "You've spent EUR X of today's ~EUR Y budget." appears above the quick-expense section with a "find a cheaper spot" button. Tap it. Expected: the assistant block expands (AI on) and the page scrolls to it. With no planned budget, or spend below 90%, no nudge shows.

- [ ] **Step 5: Commit**

```bash
git add src/app/on-the-road/road-nudge.tsx src/app/on-the-road/page.tsx
git commit -m "feat(nudges): surface near-daily-cap nudge on the on-the-road page"
```

---

## Final verification

- [ ] `pnpm lint && pnpm build` clean.
- [ ] Planning: cold northern winter trip, no warm item -> weather-packing nudge shows in the expanded packing assistant block; adding a warm item removes it.
- [ ] On the road: today's spend past 90% of the flat daily cap -> near-cap nudge shows; help tap expands + scrolls to the assistant block.
- [ ] Suggest-only + token control held: no Claude call fires on render; the only token spend is an explicit tap into `/ suggest` or the door.
- [ ] Update `docs/TODO.md` (mark slice 2 shipped, note deferred detectors) and add a `docs/DECISIONS.md` row if any non-obvious choice was made (flat daily cap; season-aware mock is a climate estimate not a forecast).

---

## Spec coverage self-check

- Token control / deterministic detection -> Task 2 (pure detectors), Global Constraints.
- Two modes, one engine -> Task 3 (planning, in-block) + Task 4 (on the road, page line).
- Varying weather mock + optional isoDate + seasonal caveat -> Task 1.
- weather-packing detector (cold threshold, warm-keyword suppression) -> Task 2 Step 2.
- near-daily-cap detector (flat cap, 90%, null guards) -> Task 2 Step 3.
- NudgeLine + AssistantBlock nudge prop + no planning help button -> Task 3.
- RoadNudge help = expand assistant + scroll; reuse door -> Task 4.
- Suggest-only, no `lib/ai` change, no migration/deps -> Global Constraints; no task touches `lib/ai` or the schema.
- Deferred items (other detectors, hot/rain, real API, prefill, per-location caps, dismiss) -> not implemented by design; noted in spec.
