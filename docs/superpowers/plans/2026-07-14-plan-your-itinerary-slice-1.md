# Plan your itinerary — Slice 1 (shell + additive write path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the deterministic guided "Plan your itinerary" shell — a context step, an editable draft, and an **additive** apply that writes places + days (+ any events) to a dated trip's itinerary — with no AI yet.

**Architecture:** Mirror the budget planner's mock-first arc. A pure `planItinerarySkeleton` scaffold (the seam AI later fills, exactly like `planBudgetSteps`), a `"use server"` `applyItinerarySkeleton` action that maps the edited skeleton onto the **existing** itinerary mutation actions additively, and one client shell reachable from a button on the itinerary tab. The itinerary data model is unchanged.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4, Supabase (existing actions). No new deps, no migration.

## Scope (read first — a change from the design doc)

- **Dated trips only.** Dreams use a separate write path (`addDreamItineraryDay`, numbered `day_index`, no locations); folding both into slice 1 doubles the write path and blunts de-risking. **Dreams are deferred to a follow-up slice.** The design doc's "trips and dreams in slice 1" is narrowed here.
- **No AI.** The deterministic skeleton produces places + dated days with **empty** event lists; events are added by hand in the refine step. Slice 2 swaps in `draftItinerary` to fill them.
- Additive apply, per the design's Open Decision #1: never overwrites an existing day.

## Global Constraints

- **No test framework exists** (CLAUDE.md). Verify pure functions with a throwaway `npx tsx` exercise, then delete it; verify every task with `pnpm lint` **and** `pnpm build`; verify UI in-app. **Do not** invent a test command or add a test framework.
- `pnpm` only (not npm/yarn). No emojis in code/logs. Sparse comments; clear names. European date display (`en-GB`, dd/mm).
- Reuse existing systems; add no new table, migration, or dependency.
- All AI stays behind `lib/ai/` (none used this slice).

## File Structure

- Create `src/lib/ai/itinerary-planner.ts` — pure, deterministic `planItinerarySkeleton` + skeleton types. The seam AI fills in slice 2. Mirrors `src/lib/ai/budget-planner.ts`.
- Create `src/lib/ai/itinerary-actions.ts` — `"use server"` `applyItinerarySkeleton`, mapping the skeleton onto existing itinerary actions additively. Mirrors `src/lib/ai/budget-actions.ts`.
- Create `src/app/trips/[slug]/plan-itinerary.tsx` — the client shell (`"use client"`): context step -> editable draft -> apply.
- Modify `src/app/trips/[slug]/itinerary-tab.tsx` — mount a "Plan your itinerary" entry button in the planning block that opens the shell.

---

### Task 1: Pure itinerary-skeleton scaffold

**Files:**
- Create: `src/lib/ai/itinerary-planner.ts`

**Interfaces:**
- Produces:
  - `SkeletonEvent = { text: string; time: string }`
  - `SkeletonDay = { date: string; title: string; tag: string; tone: ItineraryTone; events: SkeletonEvent[] }`
  - `SkeletonPlace = { name: string; days: SkeletonDay[] }`
  - `ItinerarySkeleton = { places: SkeletonPlace[] }`
  - `ItineraryPlanInput = { destination: string; startDate: string; dayCount: number; placeNames: string[] }`
  - `planItinerarySkeleton(input: ItineraryPlanInput): ItinerarySkeleton`

- [ ] **Step 1: Write the file**

```ts
import { ITINERARY_TONES, type ItineraryTone } from "@/lib/trips/itinerary-types"

export interface SkeletonEvent {
  text: string
  time: string
}
export interface SkeletonDay {
  /** YYYY-MM-DD */
  date: string
  title: string
  tag: string
  tone: ItineraryTone
  events: SkeletonEvent[]
}
export interface SkeletonPlace {
  name: string
  days: SkeletonDay[]
}
export interface ItinerarySkeleton {
  places: SkeletonPlace[]
}

export interface ItineraryPlanInput {
  destination: string
  /** The trip's first day, YYYY-MM-DD. */
  startDate: string
  /** Inclusive day count across the whole trip. */
  dayCount: number
  /** Ordered place names; empty => one place named after the destination. */
  placeNames: string[]
}

/** Advance a YYYY-MM-DD date by n days (UTC, no tz drift). */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Deterministic first draft: split the trip's days evenly across the places
 * (earlier places take the remainder), assign consecutive dates from startDate,
 * cycle tones, and leave events empty for the user (or slice 2's AI) to fill.
 */
export function planItinerarySkeleton(input: ItineraryPlanInput): ItinerarySkeleton {
  const dayCount = Math.max(1, input.dayCount)
  const names =
    input.placeNames.map((n) => n.trim()).filter((n) => n.length > 0)
  const places = names.length > 0 ? names : [input.destination.trim() || "Trip"]

  // Even split, remainder to the earlier places.
  const base = Math.floor(dayCount / places.length)
  const extra = dayCount % places.length

  const out: SkeletonPlace[] = []
  let offset = 0
  places.forEach((name, pi) => {
    const nights = base + (pi < extra ? 1 : 0)
    const days: SkeletonDay[] = []
    for (let i = 0; i < nights; i++) {
      const date = addDays(input.startDate, offset)
      days.push({
        date,
        title: name,
        tag: name,
        tone: ITINERARY_TONES[offset % ITINERARY_TONES.length],
        events: [],
      })
      offset++
    }
    out.push({ name, days })
  })
  return { places: out }
}
```

- [ ] **Step 2: Verify with a throwaway tsx exercise**

Create `scratch-itin.ts` at repo root:

```ts
import { planItinerarySkeleton } from "./src/lib/ai/itinerary-planner"

const s = planItinerarySkeleton({
  destination: "Denmark",
  startDate: "2026-08-01",
  dayCount: 5,
  placeNames: ["Copenhagen", "Ringsted"],
})
console.log(JSON.stringify(s.places.map((p) => ({ name: p.name, dates: p.days.map((d) => d.date) })), null, 2))
// Expect: Copenhagen 2026-08-01..03 (3 days, remainder), Ringsted 04..05 (2 days)
console.log("total days:", s.places.reduce((n, p) => n + p.days.length, 0)) // 5
```

Run: `npx tsx scratch-itin.ts`
Expected: Copenhagen gets 3 dated days (01/02/03), Ringsted gets 2 (04/05), total 5, dates consecutive.

- [ ] **Step 3: Delete the throwaway and lint/build**

Run: `rm scratch-itin.ts && pnpm lint && pnpm build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/itinerary-planner.ts
git commit -m "feat(itinerary): pure deterministic plan skeleton (seam for AI later)"
```

---

### Task 2: Additive apply action

**Files:**
- Create: `src/lib/ai/itinerary-actions.ts`
- Reference (read, do not change): `src/lib/trips/actions.ts` — `createItineraryLocation(tripId, tripSlug, name)`, `addItineraryDay(AddItineraryDayInput)`; `src/lib/trips/itinerary-types.ts` — `ItineraryEvent`.

**Interfaces:**
- Consumes: `ItinerarySkeleton` (Task 1).
- Produces:
  - `ApplyItineraryInput = { tripId: string; tripSlug: string; skeleton: ItinerarySkeleton }`
  - `applyItinerarySkeleton(input: ApplyItineraryInput): Promise<{ error?: string; created?: { locations: number; days: number } }>`

**Behaviour (additive):** for each place, create a location (reuse a same-named existing one), then add each day filed under it. A day whose date already exists is **skipped** (additive — never overwrite), by tolerating `addItineraryDay`'s collision error rather than aborting. Events on a day are passed inline to `addItineraryDay`.

- [ ] **Step 1: Write the file**

```ts
"use server"

import {
  addItineraryDay,
  createItineraryLocation,
} from "@/lib/trips/actions"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getTripBySlug } from "@/lib/trips/queries"
import type { ItinerarySkeleton } from "@/lib/ai/itinerary-planner"

export interface ApplyItineraryInput {
  tripId: string
  tripSlug: string
  skeleton: ItinerarySkeleton
}

/**
 * Write an edited skeleton onto the trip's itinerary, additively: reuse a
 * same-named location or create it, then add each day under it. A date that
 * already has a day is skipped (never overwritten). Suggest-only never applies
 * here -- this is an explicit user "apply".
 */
export async function applyItinerarySkeleton(
  input: ApplyItineraryInput,
): Promise<{ error?: string; created?: { locations: number; days: number } }> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }
  const trip = await getTripBySlug(workspace.id, input.tripSlug)
  if (!trip) return { error: "Trip not found." }

  const existing = await getItineraryLocations(input.tripId)
  const byName = new Map(existing.map((l) => [l.name.trim().toLowerCase(), l.id]))

  let locations = 0
  let days = 0
  for (const place of input.skeleton.places) {
    const key = place.name.trim().toLowerCase()
    let locationId = byName.get(key) ?? null
    if (!locationId) {
      const res = await createItineraryLocation(input.tripId, input.tripSlug, place.name)
      if (res.error || !res.location) return { error: res.error ?? "Could not create a place." }
      locationId = res.location.id
      byName.set(key, locationId)
      locations++
    }
    for (const day of place.days) {
      const res = await addItineraryDay({
        tripId: input.tripId,
        tripSlug: input.tripSlug,
        dayDate: day.date,
        title: day.title,
        sub: "",
        events: day.events.map((e) => ({ text: e.text, time: e.time })),
        tag: day.tag,
        tone: day.tone,
        locationId,
      })
      // Additive: a taken date rejects with a friendly error; skip it and go on.
      if (!res.error) days++
    }
  }
  return { created: { locations, days } }
}
```

- [ ] **Step 2: Confirm the `ItineraryEvent` shape matches**

Read `src/lib/trips/itinerary-types.ts` `ItineraryEvent`. If `text`/`time` are not both present-and-sufficient (e.g. a required field is missing), adjust the `events.map(...)` to satisfy it. Do not add optional fields the skeleton doesn't have.

- [ ] **Step 3: Lint/build**

Run: `pnpm lint && pnpm build`
Expected: clean (this proves the imported action signatures line up).

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/itinerary-actions.ts
git commit -m "feat(itinerary): additive apply of a plan skeleton"
```

---

### Task 3: The guided shell + entry button

**Files:**
- Create: `src/app/trips/[slug]/plan-itinerary.tsx`
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` — render the entry in the planning block.

**Interfaces:**
- Consumes: `planItinerarySkeleton` (Task 1), `applyItinerarySkeleton` (Task 2).
- Produces: `PlanItinerary({ tripId, tripSlug, destination, startDate, dayCount }: { tripId: string; tripSlug: string; destination: string; startDate: string; dayCount: number })`.

**Component spec** (`"use client"`, single scrollable draft — design Open Decision #2):

1. Collapsed: a "Plan your itinerary" button (mirror the drafter's entry pill styling in `budget-drafter.tsx:311`).
2. **Context step** (open, no draft yet): read-only destination + a "how many days" number (default `dayCount`) + a repeatable "places" text list (add/remove rows, ordered). A "Generate draft" button calls `planItinerarySkeleton({ destination, startDate, dayCount, placeNames })` into local `skeleton` state.
3. **Draft/refine** (single scroll): render `skeleton.places` -> for each place its `days` -> each day shows its date (`en-GB`, dd/mm) + title; under it an editable event list (text + optional time, add/remove). Editing mutates local `skeleton` state only. Allow removing a day and renaming a place inline.
4. **Apply**: a button calls `applyItinerarySkeleton({ tripId, tripSlug, skeleton })` in a transition; on `{ created }` success, `router.refresh()` and collapse; on `{ error }` show a clay error line. "Cancel" discards the draft.

Follow existing idioms: `React.useTransition` for the apply, sand/sea/clay classes, `font-mono` uppercase micro-labels, no new primitives. Keep local edits in one `skeleton` state object; do not persist until Apply (matches the drafter).

- [ ] **Step 1: Build `plan-itinerary.tsx`**

Implement the component per the spec above. State: `open` (bool), `placeNames` (string[]), `days` (number), `skeleton` (`ItinerarySkeleton | null`), `error` (string | null), `isPending` (transition). Import `planItinerarySkeleton`/types from `@/lib/ai/itinerary-planner` and `applyItinerarySkeleton` from `@/lib/ai/itinerary-actions`. Use `formatShortDate` from `@/lib/trips/itinerary-types` for the day date, `en-GB`.

- [ ] **Step 2: Mount it in `itinerary-tab.tsx`**

In the planning block (where the existing budget/planning UI renders when `!active`), add:

```tsx
<PlanItinerary
  tripId={tripId}
  tripSlug={tripSlug}
  destination={destination}
  startDate={startDate}
  dayCount={dayCount}
/>
```

Thread `destination`, `startDate` (trip first day), and `dayCount` (inclusive trip length) from the itinerary-tab's existing props/trip data. If `startDate`/`dayCount` aren't already in scope, derive them from the trip header the tab already receives (do not add a query). Import `PlanItinerary` from `./plan-itinerary`.

- [ ] **Step 3: Lint/build**

Run: `pnpm lint && pnpm build`
Expected: clean.

- [ ] **Step 4: In-app verification**

Run `pnpm dev`, open a **dated** trip's Itinerary tab (planning mode). Press "Plan your itinerary", set 2 places + confirm days, Generate, add an event to one day, Apply. Confirm: the locations + dated days appear in the itinerary, the event shows on its day, and re-running with the same dates adds nothing (additive skip). Report what you saw.

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/[slug]/plan-itinerary.tsx src/app/trips/[slug]/itinerary-tab.tsx
git commit -m "feat(itinerary): guided Plan-your-itinerary shell (deterministic, dated trips)"
```

---

## Self-Review

- **Spec coverage (slice 1 scope):** context step (Task 3), deterministic places->days->events skeleton (Task 1), additive apply that never overwrites (Task 2), one access via the itinerary-tab button (Task 3), dated-trip write path (Task 2). AI feed, onboarding routing, dreams, and inline second-access are explicitly later slices.
- **Placeholder scan:** pure function + action are fully coded; the UI task is a spec + fragments (a ~150-200 line component) rather than full source, deliberately — it is straightforward React following existing idioms, and a verbatim dump risks the known large-write timeout. The executor authors it against the spec and verifies by lint/build + in-app.
- **Type consistency:** `ItinerarySkeleton`/`SkeletonPlace`/`SkeletonDay`/`SkeletonEvent` are defined in Task 1 and consumed unchanged in Tasks 2-3; `applyItinerarySkeleton` input/return names match across tasks; `addItineraryDay`/`createItineraryLocation` signatures are copied from `actions.ts`.

## After slice 1

Slice 2 (AI feed) replaces the empty-events skeleton with a `draftItinerary` seam in `lib/ai/claude.ts` + a server action loading `buildAssistantContext`, keeping `planItinerarySkeleton` as the deterministic fallback. Then onboarding routing, then dreams + inline access.
