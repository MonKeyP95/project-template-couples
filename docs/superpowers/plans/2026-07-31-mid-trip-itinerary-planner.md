# Mid-Trip Itinerary Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the guided itinerary planner available while a trip is running, without letting Apply overwrite days that already happened.

**Architecture:** A server-derived floor (today, while the trip is active) stops `applyPlanEdits` from writing any day before it. On top of that, the itinerary tab seeds the walk with today-onward days only and moves `PlanItinerary` inside `planningBlock`, which already renders in both modes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5. No new dependency, no migration, no new file.

Spec: `docs/superpowers/specs/2026-07-31-mid-trip-itinerary-planner-design.md`

## Global Constraints

- **No new dependency, no migration, no new file.** Nothing added to `package.json`.
- There is **no test framework** and one must not be added. Pure helpers are verified by a throwaway `npx --yes tsx` script in the scratchpad, not committed.
- **No emojis** in code, comments, or strings.
- **Sparse comments** — only where the WHY is non-obvious. Docstrings on exported functions.
- Dates are `yyyy-mm-dd` strings compared lexicographically (already the house pattern); display dates are day-before-month, `en-GB`, UTC.
- **Do NOT run `pnpm build`** — the dev server may be running and a build clobbers the shared `.next` directory. Use `npx tsc --noEmit`.

## Task ordering is a hard dependency

**Task 2 must land before Task 3.** Task 3 filters the walk's seed to today-onward days. Without Task 2's floor, `applyPlanEdits` would find no entries for the earlier days and set their events to `[]` — emptying the part of the trip that already happened. Task 3 alone is the data-loss bug this plan exists to prevent.

---

### Task 1: The two pure helpers

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts`
- Test: throwaway script at `<scratchpad>/check-plan-floor.ts` (not committed)

**Interfaces:**
- Consumes: `tripActive(today, start, end)`, already in this file.
- Produces: `planFloor(today, startDate, endDate): string | null` and `firstDayAtOrAfter(days, floor, locationId?): string | undefined`.

- [ ] **Step 1: Add the helpers**

Append to `src/lib/trips/itinerary-types.ts`, directly below `tripActive`:

```ts
/** The earliest date the guided planner may write to: today while the trip is
 * running, null otherwise. Null means no floor -- every day is writable. */
export function planFloor(
  today: string,
  startDate: string,
  endDate: string,
): string | null {
  return tripActive(today, startDate, endDate) ? today : null
}

/** Minimal day shape the floor helpers read; a full `ItineraryDay` is assignable. */
export interface DayDateAndLocation {
  dayDate: string
  locationId: string | null
}

/** The earliest day at or after `floor`, optionally restricted to one location.
 * A null floor means no lower bound. Undefined when no day qualifies. */
export function firstDayAtOrAfter(
  days: DayDateAndLocation[],
  floor: string | null,
  locationId?: string,
): string | undefined {
  let best: string | undefined
  for (const day of days) {
    if (floor && day.dayDate < floor) continue
    if (locationId && day.locationId !== locationId) continue
    if (best === undefined || day.dayDate < best) best = day.dayDate
  }
  return best
}
```

`firstDayAtOrAfter` scans for the minimum rather than trusting input order, because callers pass whatever `getItineraryDays` returned.

- [ ] **Step 2: Write the verification script**

Create `<scratchpad>/check-plan-floor.ts`, fixing the import to the real relative path from the scratchpad to `src/lib/trips/itinerary-types.ts`:

```ts
import { planFloor, firstDayAtOrAfter } from "../../projects/project-template-couples/src/lib/trips/itinerary-types"

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

const DAYS = [
  { dayDate: "2026-07-28", locationId: "U" },
  { dayDate: "2026-07-29", locationId: "U" },
  { dayDate: "2026-07-30", locationId: "U" },
  { dayDate: "2026-07-31", locationId: "U" },
  { dayDate: "2026-08-01", locationId: "U" },
  { dayDate: "2026-08-02", locationId: "U" },
  { dayDate: "2026-08-03", locationId: "A" },
  { dayDate: "2026-08-04", locationId: "A" },
]
const FLOOR = "2026-07-31"

check("floor during the trip", planFloor("2026-07-31", "2026-07-28", "2026-08-10"), "2026-07-31")
check("no floor before the trip", planFloor("2026-07-20", "2026-07-28", "2026-08-10"), null)
check("no floor after the trip", planFloor("2026-08-20", "2026-07-28", "2026-08-10"), null)
check("floor on the first day", planFloor("2026-07-28", "2026-07-28", "2026-08-10"), "2026-07-28")
check("floor on the last day", planFloor("2026-08-10", "2026-07-28", "2026-08-10"), "2026-08-10")

check("straddling location clamps to floor", firstDayAtOrAfter(DAYS, FLOOR, "U"), "2026-07-31")
check("future location keeps its own first day", firstDayAtOrAfter(DAYS, FLOOR, "A"), "2026-08-03")
check("unknown location", firstDayAtOrAfter(DAYS, FLOOR, "Z"), undefined)
check("no location, floored", firstDayAtOrAfter(DAYS, FLOOR), "2026-07-31")
check("no floor", firstDayAtOrAfter(DAYS, null), "2026-07-28")
check("no floor, by location", firstDayAtOrAfter(DAYS, null, "A"), "2026-08-03")
check("unsorted input still finds the min", firstDayAtOrAfter([...DAYS].reverse(), FLOOR), "2026-07-31")
check("empty days", firstDayAtOrAfter([], FLOOR), undefined)

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
```

- [ ] **Step 3: Run it**

```bash
npx --yes tsx <scratchpad>/check-plan-floor.ts
```

Expected: every line PASS, final line `ALL PASS`, exit 0. If an assertion fails, fix the helper — the expectations come from the spec.

- [ ] **Step 4: Type-check and lint**

```bash
npx tsc --noEmit
pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/itinerary-types.ts
git commit -m "feat(itinerary): planner floor helpers"
```

---

### Task 2: The server floor

**Files:**
- Modify: `src/lib/ai/itinerary-actions.ts`

**Interfaces:**
- Consumes: `planFloor`, `firstDayAtOrAfter` (Task 1); `localToday` from `@/lib/time/local-today`.
- Produces: `applyPlanEdits` gains a fifth parameter `floor: string | null`. `applyPlanEntries`'s public input type is **unchanged** — the floor is derived server-side, never accepted from the client.

- [ ] **Step 1: Add the imports**

In `src/lib/ai/itinerary-actions.ts`, extend the existing `itinerary-types` import and add `localToday`:

```ts
import {
  ITINERARY_TONES,
  firstDayAtOrAfter,
  planFloor,
} from "@/lib/trips/itinerary-types"
import { localToday } from "@/lib/time/local-today"
```

- [ ] **Step 2: Take the floor as a parameter**

Change `applyPlanEdits`'s signature to add a fifth parameter:

```ts
async function applyPlanEdits(
  input: { tripId: string; tripSlug: string; places: string[]; entries: PlanEntry[] },
  days: ItineraryDay[],
  locations: ItineraryLocation[],
  tripName: string,
  /** Earliest writable date; days before it already happened and are never touched. */
  floor: string | null,
): Promise<{ error?: string; created?: { locations: number; days: number } }> {
```

- [ ] **Step 3: Clamp the undated-row fallback**

Replace the `firstDateByLocation` map, its population inside the `for (const day of days)` loop, and the whole `fallbackDate` function with:

```ts
  const originals = new Map<string, ItineraryEvent>()
  const dayById = new Map(days.map((d) => [d.id, d] as const))
  for (const day of days) {
    day.events.forEach((e, i) => originals.set(`${day.id}#${i}`, e))
  }

  /** Where an undated new row lands: its place's first day at or after the
   * floor, else the trip's. Never a day the rewrite loop will skip, which
   * would drop the row silently. */
  function fallbackDate(place: string): string | undefined {
    const key = place.trim().toLowerCase()
    const loc = key
      ? locations.find((l) => l.name.trim().toLowerCase() === key)
      : undefined
    return (
      (loc ? firstDayAtOrAfter(days, floor, loc.id) : undefined) ??
      firstDayAtOrAfter(days, floor)
    )
  }
```

`firstDateByLocation` has no other reader — removing it leaves no dead code.

- [ ] **Step 4: Skip pre-floor days in the rewrite loop**

In the `// Existing days: rewrite the event list...` loop, add the guard as the first statement:

```ts
  for (const day of days) {
    // A day before the floor is part of the trip that already happened: never
    // written, and dropped from `byDate` so the leftover loop cannot recreate it.
    if (floor && day.dayDate < floor) {
      byDate.delete(day.dayDate)
      continue
    }
    const next = byDate.get(day.dayDate) ?? []
```

Leave the rest of the loop body exactly as it is.

- [ ] **Step 5: Guard the leftover loop**

A walk row can carry a user-picked date in the past for which no day exists, which would otherwise create a brand-new day behind the floor. In the `// Whatever is left sits on a date the trip has no day for yet.` loop:

```ts
  let added = 0
  for (const [date, events] of byDate) {
    if (floor && date < floor) continue
    const locationId = locationForDate(locations, date, placeByDate.get(date) ?? "")
```

- [ ] **Step 6: Derive the floor at the call site**

In `applyPlanEntries`, in the branch that takes the edit path:

```ts
  const existingDays = await getItineraryDays(input.tripId)
  if (existingDays.length > 0) {
    const locations = await getItineraryLocations(input.tripId)
    // Derived here, never taken from the caller: a wrong floor silently empties
    // days that already happened.
    const floor = planFloor(
      await localToday(),
      trip.startDate,
      trip.endDate ?? trip.startDate,
    )
    return await applyPlanEdits(input, existingDays, locations, trip.name, floor)
  }
```

- [ ] **Step 7: Type-check and lint**

```bash
npx tsc --noEmit
pnpm lint
```

Both must be clean. `applyPlanEntries`'s input type must be unchanged — confirm no `floor` field was added to it.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai/itinerary-actions.ts
git commit -m "fix(itinerary): the planner never rewrites days that already happened"
```

---

### Task 3: Show the planner mid-trip

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`

**Interfaces:**
- Consumes: the floor from Task 2 (already live server-side).
- Produces: nothing other code depends on.

**Do not start this task until Task 2 is committed.** See "Task ordering is a hard dependency" above.

- [ ] **Step 1: Derive the seeded day list**

Immediately after the existing `const active = tripActive(today, tripStartDate, tripEndDate)`:

```ts
  // Mid-trip the walk opens on the days that remain; the server floor is what
  // actually protects the earlier ones.
  const plannerDays = active ? days.filter((d) => d.dayDate >= today) : days
```

- [ ] **Step 2: Move `PlanItinerary` into `planningBlock`**

`planningBlock` ends with the `AssistantBlock` followed by `</div>`. Insert `PlanItinerary` between them, so the block reads:

```tsx
      <AssistantBlock
        surface="itinerary"
        tripSlug={tripSlug}
        door={
          <PlanningPlaceDoor
            tripId={tripId}
            tripSlug={tripSlug}
            destination={destination}
            locations={locations}
            days={days}
          />
        }
      />
      <PlanItinerary
        tripId={tripId}
        tripSlug={tripSlug}
        destination={destination}
        avoid={avoid}
        locations={locations}
        days={plannerDays}
      />
    </div>
  )
```

`locations` stays unfiltered: the positional rename in `applyPlanEdits` is guarded by `input.places.length === locations.length`, so sending fewer places silently disables renaming.

- [ ] **Step 3: Collapse the pre-trip branch**

`planningBlock` now carries the planner, so the top-of-tab branch renders it alone. Replace:

```tsx
        {active ? null : (
          <>
            {planningBlock}
            <PlanItinerary
              tripId={tripId}
              tripSlug={tripSlug}
              destination={destination}
              avoid={avoid}
              locations={locations}
              days={days}
            />
          </>
        )}
```

with:

```tsx
        {active ? null : planningBlock}
```

Leave the `{active ? planningBlock : null}` at the bottom of the tab exactly as it is — that is what puts the block, and now the planner, below the timeline during a trip.

- [ ] **Step 4: Confirm there is exactly one render site**

```bash
grep -c "<PlanItinerary" "src/app/trips/[slug]/itinerary-tab.tsx"
```

Expected: `1`.

- [ ] **Step 5: Type-check and lint**

```bash
npx tsc --noEmit
pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): the planner stays available once a trip starts"
```

---

## Wrap-up

- [ ] Add a `docs/DECISIONS.md` row: the floor is derived server-side rather than passed in, and the client-side seed filter is UX on top of it — filtering alone would have caused the data loss it looks like it prevents.
- [ ] Add a `docs/TODO.md` entry under a new `## Mid-trip itinerary planner — 2026-07-31` heading, marked implemented with in-app verification pending.
- [ ] Hand over the in-app checklist (list 2 of the spec's success criteria), leading with: apply the walk mid-trip, then confirm the days before today still hold their events, ratings, and linked expenses.

## Self-review notes

Spec coverage: server floor derivation (Task 2 step 6), rewrite-loop skip (Task 2 step 4), leftover-loop guard (Task 2 step 5 — an addition beyond the spec's prose, covering a user-picked past date with no existing day), `fallbackDate` clamping (Task 2 step 3), client seeding (Task 3 step 1), single render site inside `planningBlock` (Task 3 steps 2-4), locations left unfiltered (Task 3 step 2 note). Helpers and their assertions are Task 1. Out of scope per the spec and untouched here: a finished trip gets no floor, and `DreamItineraryTab` has no planner. `draftAndApplyItinerary` needs no floor — it routes through `applyItinerarySkeleton`, which is additive and skips already-taken dates, so it cannot empty an existing day.
