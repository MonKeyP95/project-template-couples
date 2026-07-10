# Proactive nudges (proactive-assistant slice 2) — design

Date: 2026-07-10
Status: approved, ready for a plan
Vision: `project-assistant-proactive-vision` (memory) — item 1 (proactive, data-triggered
suggestions). Slice 1 (clarify-then-act harness) shipped 2026-07-09.

## Goal

Make the assistant **notice real data and speak up**, instead of only answering the
on-demand, generic `/ suggest`. First increment: **one detector per mode**, proving the
whole proactive pipeline end to end. The other detectors are cheap follow-ups on the same
framework.

The two starter detectors are the two examples the user named as the vision:

- **Planning → weather/season packing**: "Bergen will be cold — pack warm layers."
- **On the road → near daily cap**: "You've spent 90% of today's budget."

## Core constraint: token control

The user's hard constraint: **proactive must never mean "the assistant spends tokens on
its own."** That splits "proactive" into two things:

1. **Noticing the situation** — a deterministic check on data already loaded. Zero tokens,
   no Claude call.
2. **Generating a worded suggestion / acting** — costs tokens.

This slice does #1 freely and lets #2 happen **only when the user taps `help`**. No
unprompted Claude call ever fires on render, in either mode.

## Two modes (product-wide principle)

Same engine, one divergence — **where** a nudge surfaces:

- **Planning**: the on/off model stays. A nudge renders **inside the expanded (AI-on)
  assistant block**; nothing shows while collapsed. No change to the token contract.
- **On the road**: a nudge is a **free deterministic line rendered on the `/on-the-road`
  page itself**, always visible regardless of AI on/off (costs nothing to display). Claude
  only enters on an explicit `help` tap.

## Architecture

A detector is a **pure function**: it takes a plain context object (assembled server-side
from data the page already has) and returns `Nudge | null`. No DB calls of its own where
avoidable, no Claude, no tokens. Detection runs in the **server component** (the tab / the
on-the-road page) on render.

```ts
// src/lib/nudges/types.ts
export type NudgeHelp = {
  label: string          // e.g. "find a cheaper spot"
  // v1: the only wired action is "open the assistant tool"; see surfacing below.
}

export type Nudge = {
  id: string             // stable key, e.g. "weather-packing" | "near-daily-cap"
  text: string           // the deterministic line
  help?: NudgeHelp       // optional token-spending path, only when tapped
}
```

New folder `src/lib/nudges/`, one small file per detector plus shared types:

- `types.ts` — `Nudge`, `NudgeHelp`, the per-detector context shapes.
- `weather-packing.ts` — `detectWeatherPacking(ctx) : Nudge | null`.
- `near-daily-cap.ts` — `detectNearDailyCap(ctx) : Nudge | null`.

## Detector 1 — weather/season packing (planning, packing surface)

```ts
detectWeatherPacking(ctx: {
  destination: string          // trip.country ?? trip.name
  weather: Weather | null      // getWeather(trip.lat, trip.lng, trip.startDate)
  packingLabels: string[]      // getPackingItems(trip.id) labels, lowercased
}): Nudge | null
```

- Returns `null` if `weather` is `null` (no coords / no start month → no nudge).
- Fires when `weather.lowC <= 10` **and** no packing label matches a warm-item keyword set:
  `jacket, coat, sweater, jumper, fleece, thermal, gloves, hat, scarf`.
- Text: `"{destination} will be cold ({lowC}°C) — pack warm layers."`
- `help`: "suggest warm items" — **not a separate button** in v1. The nudge renders inside
  the packing assistant block directly above `/ suggest`, and that existing `/ suggest`
  control is the token path. So the planning nudge is a pure free line; no new AI wiring.

## Detector 2 — near daily cap (on the road)

```ts
detectNearDailyCap(ctx: {
  plannedBudgetCents: number
  tripDays: number             // inclusive day count, start..end
  spentTodayCents: number      // already computed on the on-the-road page
}): Nudge | null
```

- Returns `null` if `plannedBudgetCents === 0` or `tripDays === 0` (no cap to measure).
- `dailyCap = plannedBudgetCents / tripDays`. Fires when `spentTodayCents >= 0.9 * dailyCap`.
- Text: `"You've spent {spent} of today's ~{cap} budget."` (EUR, whole units, matching the
  existing budget formatting).
- `help`: "find a cheaper spot" — opens the on-the-road find-a-place door (see surfacing).
- Cap is **flat** (budget ÷ days), not per-location/per-category. Simplest correct thing.

## The varying weather mock

`getWeather` gains an **optional third arg** — `getWeather(lat, lng, isoDate?)` — defaulting
to today when omitted, so the existing on-the-road call (`getWeather(trip.lat, trip.lng)`)
and the home-card call are unchanged. Replace the constant `24°C` body with a deterministic
function of **latitude + the month of `isoDate`** (hemisphere-aware: July warm in the north,
cool in the south; colder at higher latitudes). The return type is unchanged.

- Makes the cold trigger genuinely fire on the right trips (Bergen/December cold,
  Marrakech/July hot) and be **truthfully testable in-app**. The planning detector passes
  `trip.startDate`, so a future trip reads its own season, not today's.
- Weather `code` (sun/rain) can stay simple; the two starter detectors only read
  temperature. ~10 lines.
- Real-API caveat for the next phase: this is a **seasonal/climate** estimate, not a live
  forecast — a real provider can't forecast a trip months out, so when the API lands the
  *current-conditions* path (on the road, `isoDate = today`) swaps cleanly, while the
  planning path stays a seasonal estimate. Noted so the swap isn't mistaken for 1:1.

## Surfacing UI

**`NudgeLine`** (new, client, presentational): renders `nudge.text` as a quiet moss line in
the assistant's visual language, plus an optional `help` button (label + `onClick` supplied
by the caller, since the action needs client context).

**Planning (packing surface):**
- The packing tab computes the weather-packing nudge server-side and passes it into
  `AssistantBlock` via a **new optional `nudge` prop**.
- `AssistantBlock` renders `<NudgeLine>` at the top of the **expanded** area, above
  `/ suggest`, with **no help button**. `/ suggest` is the token path. No new AI wiring.

**On the road:**
- The `/on-the-road` page computes the near-cap nudge server-side and renders it through a
  thin client wrapper **`RoadNudge`** (placed near the spend section), because its help
  needs client state.
- `RoadNudge`'s help button calls `useAiMode().setEnabled(true)` to **expand the assistant
  block** (which holds the find-a-place door) and scrolls to it. Expanding is free; the
  actual token spend is one further explicit tap (running a door search). Chain:
  free nudge → tap help → assistant opens → user searches = tokens only at the search.

**Reuses:** `AssistantBlock`, the packing `/ suggest`, the find-a-place door, `useAiMode`.
**Adds:** `NudgeLine`, `RoadNudge`, one optional `nudge` prop on `AssistantBlock`, the two
detector files, and the varying-mock body. No new server actions, no `lib/ai` seam change.

## Invariants

- **Suggest-only.** Detectors read; they never write. Nothing under `src/lib/nudges/` or the
  nudge UI mutates data.
- **Token control.** Detection is deterministic — zero Claude calls on render. Tokens spend
  only on an explicit `help` tap into an existing tool, in either mode.
- **On/off contract preserved.** Planning nudges show only inside the expanded (AI-on)
  block. On-the-road nudges are free page lines — displaying them while AI is off spends
  nothing.
- **Two modes, one engine.** Same `Nudge` type and pure-detector shape; only the render
  location differs.
- **One `lib/ai` seam untouched.** No new AI action; no change to `generateSuggestion` /
  chat / discovery.

## Verification (in-app; no test runner in this repo)

- Open a cold northern trip (coords + a winter start month) with no warm item on the packing
  list → expand the packing assistant block → the weather-packing nudge shows above
  `/ suggest`. Add a "jacket" → nudge disappears.
- On an active trip with a planned budget, log expenses today past 90% of budget ÷ days →
  the near-cap nudge shows on `/on-the-road`. Tap "find a cheaper spot" → the assistant
  block expands to the door.

## Deferred (explicit non-goals for v1)

- The other four detectors: empty location, budget-not-set, meal-not-planned, weather-today.
- Hot-weather symmetric case; rain / weather-code triggers.
- Real weather API (next phase; v1 uses the varying mock).
- Prefilling the door with "cheaper"/craving context on the help tap — v1 just opens it.
- Per-location / per-category daily caps (v1 is flat budget ÷ days).
- Dismissing/snoozing a nudge; persisted or shared nudge state.
- A test runner (verification is in-app).
