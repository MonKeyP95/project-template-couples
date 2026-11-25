# Accept a Home Trip Idea Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "let's do it" button on the home idea opens the new-trip walk pre-filled from the idea, and creating the trip builds a rough itinerary (locations, travel-day titles, activity suggestions) with no extra AI call.

**Architecture:** The existing trip-idea call also returns a structured `plan` (walk answers + route). Pure, import-free route functions fit the route to the trip length, lay out day spans and place activities. The walk carries the route to `createTrip`, which writes locations, spans, travel-day titles and `trip_suggestions` rows through existing actions.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase (RLS), `@anthropic-ai/sdk` tool use.

**Spec:** `docs/superpowers/specs/2026-11-25-accept-home-idea-design.md`

## Global Constraints

- No test runner exists. Do not add one. Verify with `pnpm exec tsc --noEmit` (no output) and `pnpm lint` (no problems). Pure functions are also checked with a throwaway Node script in the session scratchpad (Node 24 runs `.ts` directly), never committed.
- Do not run `pnpm build` while the dev server may be running; ask the user to stop it first (final task only).
- Every SQL file re-runnable (`add column if not exists`). The user applies it by hand in the Supabase SQL editor.
- `"use client"` files import only from `*-types.ts` or import-free modules, never `*-queries.ts` / `actions` internals that pull `next/headers`.
- No AI call between "let's do it" and the new trip page. No dates, no prices from the AI.
- Activities are never written as events, and never placed on a travel day.
- Dates shown European order (`en-GB`). No emojis. Sparse comments, short functions.
- Subagents edit + verify only; the controller does all git.

## Review Focus

1. **Note typing after accept**: the walk opens with the idea body as the note; typing in the note must not change the plan-filled place, what, days or prefs. Pinned by Task 4 Step 2.
2. **Dated trip with a different length than the route**: picking From/To that make 6 days for an 8-night route must shrink the last stop (or drop it) and show that on the route line. Pinned by Task 1 checks and Task 4 Step 3.
3. **Old saved idea without `plan`**: the home must remake it once, not crash on `plan` null. Pinned by Task 2 Step 5.
4. **Hand-edited `?idea=` URL** (bad JSON or nonsense nights): the walk opens normally without a route; the server re-fits whatever arrives. Pinned by Task 3 Step 3 and Task 5 Step 2.
5. **One-off idea from an option pill**: has a plan and accepts the same way as the saved one. Pinned by Task 3 Step 2.

---

### Task 1: Pure route functions

**Files:**
- Create: `src/lib/trips/idea-route.ts`

**Interfaces:**
- Produces (all exported, file is import-free except `import type { PrefKey } from "./trip-note-parse"`):

```ts
export interface RouteActivity { title: string; kind: "big" | "small" }
export interface RouteStop { name: string; nights: number; travelDay: boolean; activities: RouteActivity[] }
export interface IdeaPlan {
  place: string; what: string; days: number
  prefs: Record<PrefKey, string>
  stops: RouteStop[]
}
export interface RouteSpan { name: string; start: number; end: number; travelDay: boolean }
export interface PlacedActivity { stopIndex: number; title: string; kind: "big" | "small"; dayIndex: number | null }

export function routeNights(stops: RouteStop[]): number
export function fitRoute(stops: RouteStop[], days: number): RouteStop[]
export function routeSpans(stops: RouteStop[]): RouteSpan[]
export function placeActivities(stops: RouteStop[]): PlacedActivity[]
export function routeLine(stops: RouteStop[]): string
```

Rules (from the spec):
- `routeNights`: sum of `nights`.
- `fitRoute(stops, days)`: `days < 1` returns `stops` unchanged. Otherwise returns a new array whose nights sum to `days`: longer adds the difference to the last stop; shorter takes nights off the last stop, and when the last stop would go below 1 night it is dropped and the remainder comes off the new last stop. The first stop always has `travelDay: false`. Never mutates input.
- `routeSpans`: stop `i` covers days `start..end` (1-based, consecutive, `end - start + 1 === nights`). `travelDay` is the stop's flag, forced false for `i === 0`.
- `placeActivities`: per stop, the free days are its span minus its first day when `travelDay`. Activities go one per free day in order; the rest get `dayIndex: null` (the box).
- `routeLine`: `"Malta 5 nights · Gozo 3 nights (travel day)"`; `1 night` singular.

- [ ] **Step 1: Write the check script** at `<scratchpad>/route-check.ts` importing `file:///C:/Users/Noam%20West/projects/project-template-couples/src/lib/trips/idea-route.ts`, using `node:assert/strict`:

```ts
const malta = { name: "Malta", nights: 5, travelDay: false, activities: [{ title: "Dive", kind: "big" }, { title: "Fish dinner", kind: "small" }] }
const gozo = { name: "Gozo", nights: 3, travelDay: true, activities: [{ title: "Trek", kind: "big" }, { title: "Swim", kind: "big" }, { title: "Kayak", kind: "big" }] }
const route = [malta, gozo]

assert.equal(routeNights(route), 8)
assert.deepEqual(fitRoute(route, 8).map(s => s.nights), [5, 3])
assert.deepEqual(fitRoute(route, 10).map(s => s.nights), [5, 5])
assert.deepEqual(fitRoute(route, 6).map(s => s.nights), [5, 1])
assert.deepEqual(fitRoute(route, 4).map(s => s.nights), [4])          // Gozo dropped
assert.deepEqual(fitRoute(route, 0), route)
assert.equal(fitRoute([{ ...gozo }], 3)[0].travelDay, false)
assert.equal(malta.nights, 5)                                          // no mutation
assert.deepEqual(routeSpans(route), [
  { name: "Malta", start: 1, end: 5, travelDay: false },
  { name: "Gozo", start: 6, end: 8, travelDay: true },
])
assert.deepEqual(placeActivities(route).map(a => [a.title, a.dayIndex]), [
  ["Dive", 1], ["Fish dinner", 2], ["Trek", 7], ["Swim", 8], ["Kayak", null],
])
assert.equal(routeLine(route), "Malta 5 nights · Gozo 3 nights (travel day)")
assert.equal(routeLine([{ ...malta, nights: 1 }]), "Malta 1 night")
console.log("route ok")
```

- [ ] **Step 2: Run it to see it fail**

Run: `node "<scratchpad>/route-check.ts"`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/trips/idea-route.ts`** with the interfaces and rules above. A one-line docstring per export.

- [ ] **Step 4: Run the check and the type check**

Run: `node "<scratchpad>/route-check.ts"` then `pnpm exec tsc --noEmit` and `pnpm lint`
Expected: `route ok`; tsc no output; lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/idea-route.ts
git commit -m "feat: pure route helpers for accepted trip ideas"
```

---

### Task 2: The idea call returns a plan, and the saved idea stores it

**Files:**
- Create: `supabase/migrations/20261125000003_home_idea_plan.sql`
- Modify: `src/lib/ai/suggestion-types.ts` (`TripIdea`)
- Modify: `src/lib/ai/registry.ts:209-235` (`propose_trip_idea`)
- Modify: `src/lib/ai/agents/trip-idea.ts` (system prompt, `parseOutput`)
- Modify: `src/lib/ai/home-idea-queries.ts` (select `plan`)
- Modify: `src/lib/ai/home-idea-actions.ts` (remake when `plan` is missing)
- Modify: `src/lib/ai/suggestion-actions.ts:254-258` (return type)

**Interfaces:**
- Consumes: `IdeaPlan`, `RouteStop` from Task 1.
- Produces: `TripIdea` gains `plan: IdeaPlan`. `suggestForSurface` returns `Promise<{ suggestion?: Suggestion | TripIdea; error?: string }>`.

- [ ] **Step 1: Migration.** `alter table public.home_ideas add column if not exists plan jsonb;` with the file's usual header comment ("Idempotent: safe to paste-and-run multiple times."). Nullable: rows from before stay null.

- [ ] **Step 2: Tool schema.** Add a required `plan` object to `propose_trip_idea` (strict mode: every object `additionalProperties: false`, every property listed in `required`):
  - `place` string: "The trip's destination as the couple would type it in Where, e.g. 'Malta'."
  - `what` string: "A few words for what the trip is, e.g. 'diving and trekking'."
  - `days` integer: "Rough total length in days; 0 when there is no natural length."
  - `prefs` object with `stay`, `move`, `acts`, `food`, `avoid` strings: "One short line each, as the couple would answer 'Where will you sleep?', 'How will you get around?', 'What will you do?', 'Groceries or eating out?', 'Anything to avoid?'; empty string when the idea says nothing."
  - `stops` array (1 to 4) of `{ name, nights (integer >= 1), travelDay (boolean), activities: array (0 to 4) of { title, kind: enum ["big","small"] } }`: "The trip's bases in order. One stop unless it really has more than one base. travelDay true when arriving at this stop takes most of a day; always false for the first. big = an activity worth comparing options for, small = a place to eat or drink. Nights sum to days."

- [ ] **Step 3: Agent.** In `TRIP_IDEA_SYSTEM` add one sentence: "Also fill plan: the same trip as structured answers, with no dates and no prices." In `parseOutput`, read `plan` and return it; when the model omits it, fall back to `{ place: label, what: "", days: 0, prefs: all "", stops: [] }`.

- [ ] **Step 4: Storage.** `getHomeIdea` selects `plan`; `SavedHomeIdea` inherits `plan` from `TripIdea` (DB null reads as `plan: IdeaPlan | null` on the saved type: declare `SavedHomeIdea` as `Omit<TripIdea, "plan"> & { plan: IdeaPlan | null; fingerprint: string }`). `saveHomeIdea` takes a `TripIdea & { fingerprint }` and upserts `plan`.

- [ ] **Step 5: Remake once.** In `refreshHomeIdea`, the reuse condition also requires `saved.plan`; return the saved row as a `TripIdea` only when it has one. Update the comment ("A row saved before options or plan existed lacks them, so it is made again once.").

- [ ] **Step 6: Return type.** Widen `suggestForSurface`'s return type as in Interfaces. No other change there.

- [ ] **Step 7: Verify.** Run `pnpm exec tsc --noEmit` and `pnpm lint`. Expected: no output; clean.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261125000003_home_idea_plan.sql src/lib/ai/suggestion-types.ts src/lib/ai/registry.ts src/lib/ai/agents/trip-idea.ts src/lib/ai/home-idea-queries.ts src/lib/ai/home-idea-actions.ts src/lib/ai/suggestion-actions.ts
git commit -m "feat: trip idea returns a structured plan, saved with the idea"
```

---

### Task 3: "let's do it" on the home idea

**Files:**
- Modify: `src/components/together/suggestion-card.tsx` (optional accept action)
- Modify: `src/app/home/ideas-line.tsx`
- Modify: `src/app/trips/new/page.tsx` (read `?idea=`)

**Interfaces:**
- Consumes: `TripIdea.plan` (Task 2), `IdeaPlan` (Task 1).
- Produces: `/trips/new?note=<body>&idea=<encodeURIComponent(JSON.stringify(plan))>`; `NewTripForm` receives a new prop `initialPlan: IdeaPlan | null`.

- [ ] **Step 1: Card.** `SuggestionCardProps` gains optional `acceptLabel?: string` and `onAccept?: () => void`. When `acceptLabel` is set it renders first, with the current filled sea style, and the apply button switches to the outlined style the dismiss button uses. Without it, the card looks exactly as today.

- [ ] **Step 2: Ideas line.** Keep the current idea as `TripIdea | null` state. `ask()` keeps the result only when it has a plan (`"plan" in res.suggestion`); the saved/refreshed path already returns `TripIdea`. Pass `acceptLabel="let's do it"` and `onAccept` that does `router.push` to the URL in Interfaces. Accept does not touch AI mode.

- [ ] **Step 3: Page.** `searchParams` gains `idea?: string`. Parse it with `JSON.parse` in a try/catch that yields `null` on bad input, and keep it only when it is an object with a `stops` array. Pass it as `initialPlan`.

- [ ] **Step 4: Verify.** `pnpm exec tsc --noEmit` and `pnpm lint`. Expected: no output; clean. (`NewTripForm` must accept `initialPlan` for this to type-check; add the prop to its signature now and use it in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add src/components/together/suggestion-card.tsx src/app/home/ideas-line.tsx src/app/trips/new/page.tsx src/app/trips/new/new-trip-form.tsx
git commit -m "feat: let's do it on the home idea opens the walk with its plan"
```

---

### Task 4: The walk fills from the plan and shows the route

**Files:**
- Modify: `src/app/trips/new/new-trip-form.tsx`
- Modify: `src/app/trips/new/note-page.tsx` (route line)

**Interfaces:**
- Consumes: `IdeaPlan`, `RouteStop`, `fitRoute`, `routeNights`, `routeLine` (Task 1).
- Produces: `CreateTripInput` gains `route: RouteStop[] | null` (sent by `create()`; consumed in Task 5).

- [ ] **Step 1: Prefill.** `DraftField` gains `"days"` and `"what"`. With `initialPlan`, the initial draft is `withNote(...)` on the body, then overridden with `place`, `what`, `prefs` from the plan and `days = routeNights(plan.stops) || plan.days`. The initial `touched` set holds `place`, `what`, `days` and every pref key the plan filled with a non-empty value. `withNote` keeps `days` and `what` when touched, like it already does for `budget` and `place`.

- [ ] **Step 2: Note typing.** Reason through `changeNote` with a plan-filled draft: every touched field keeps its value. Confirm in the diff that `withNote`'s `next = { ...d, days: r.days }` respects `keep("days")` and `what: r.what` respects `keep("what")`.

- [ ] **Step 3: Route state.** `const [route, setRoute] = React.useState<RouteStop[] | null>(initialPlan?.stops.length ? initialPlan.stops : null)`. The walk's length is the inclusive day count between From and To when both are set, otherwise `draft.days`. The shown and sent route is `fitRoute(route, length)` (empty result means no route). `edit("place", ...)` also calls `setRoute(null)`.

- [ ] **Step 4: Route line.** `NotePage` gets `route: string | null` and `onDropRoute: () => void`. Under the Where field it shows `Route: <routeLine(fitted)>` in the page's eyebrow/muted style with a small "×" button (`aria-label="Drop route"`). Hidden when `route` is null.

- [ ] **Step 5: Send it.** Add `route: RouteStop[] | null` to `CreateTripInput` in `src/lib/trips/actions.ts` (unused on the server until Task 5). `create()` passes `route: fitted.length ? fitted : null`.

- [ ] **Step 6: Verify.** `pnpm exec tsc --noEmit` and `pnpm lint`. Expected: no output; clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/trips/new/new-trip-form.tsx src/app/trips/new/note-page.tsx src/lib/trips/actions.ts
git commit -m "feat: new-trip walk fills from an accepted idea and shows its route"
```

---

### Task 5: Creating the trip builds the rough itinerary

**Files:**
- Create: `src/lib/trips/route-itinerary.ts` (`import "server-only"`)
- Modify: `src/lib/trips/actions.ts` (`CreateTripInput`, end of `createTrip`)

**Interfaces:**
- Consumes: `fitRoute`, `routeSpans`, `placeActivities`, `RouteStop` (Task 1); existing `createItineraryLocation(tripId, tripSlug, name)`, `renameItineraryLocation(locationId, tripId, tripSlug, name, startIndex, endIndex, currency)`, `addItineraryDay(input)` in `src/lib/trips/actions.ts`; `ITINERARY_TONES` from `src/lib/trips/itinerary-types.ts`.
- Produces: `export async function buildRouteItinerary(tripId: string, tripSlug: string, stops: RouteStop[]): Promise<{ error?: string }>`.

- [ ] **Step 1: `buildRouteItinerary`.** For each span from `routeSpans(stops)`, in order:
  1. `createItineraryLocation` with the span's name.
  2. `renameItineraryLocation(id, tripId, tripSlug, name, start, end, null)` to set the span.
  3. When `travelDay`: `addItineraryDay({ tripId, tripSlug, dayIndex: start, title: \`Travel to ${name}\`, sub: "", events: [], tag: name, tone: ITINERARY_TONES[i % ITINERARY_TONES.length], locationId })`.

  Then insert one `trip_suggestions` row per `placeActivities(stops)` item: `{ trip_id, kind, category: kind === "big" ? "Activities" : "Food", title, why: "", day_index: dayIndex, location_id: <that stop's location id> }`. Stop on the first error and return it.

- [ ] **Step 2: `createTrip`.** After the expense categories insert, when `input.route?.length`: drop stops with a blank name or non-integer `nights < 1`, compute the trip length (inclusive days between the dates, or `days`), and call `buildRouteItinerary(tripId, slug, fitRoute(stops, length))`. The trip already exists by then, so a route error does not fail creation: return `{ slug }` either way and the trip page shows whatever was built. No route: unchanged behaviour.

- [ ] **Step 3: Data path check.** Confirm by reading: (a) the travel day row has a non-empty title, so `isPlannedRow` treats it as planned and it is not "blank"; (b) `placeActivities` never returns a travel day's index; (c) `renameItineraryLocation` on a fresh trip returns no `needsPush` (no planned days or spans yet in that range, and the travel day is written after its span).

- [ ] **Step 4: Verify.** `pnpm exec tsc --noEmit` and `pnpm lint`. Expected: no output; clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/route-itinerary.ts src/lib/trips/actions.ts
git commit -m "feat: creating a trip from an idea builds its rough itinerary"
```

---

### Task 6: Docs and final build

**Files:**
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`

- [ ] **Step 1: Docs.** `docs/TODO.md`: add "Accept a home trip idea: implemented; build and lint clean; unverified in app" with the spec's in-app checklist and "migration `20261125000003_home_idea_plan.sql` to apply". `docs/DECISIONS.md`: one row: "Accepting a home idea: one AI call carries the walk answers and route; the rough itinerary is built in plain code. Travel days belong to the arrival location (first day, titled 'Travel to X'), never a location-less day; activities never land on them." with the why and 2026-11-25.

- [ ] **Step 2: Build.** Ask the user to stop the dev server, then `pnpm build`. Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: accept home idea implemented, unverified in app"
```
