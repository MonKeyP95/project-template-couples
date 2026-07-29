# Editing an Itinerary Through the Guided Walk — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reopening "Plan your itinerary" on a trip that already has one prefills the walk from the real itinerary and saves edits in place, instead of starting blank and appending.

**Architecture:** Mirror the budget drafter. A pure reader turns `locations` + `days` into the walk's shape, each row keeping a `serverId` (`dayId#eventIndex`). The walk seeds from it on every open. `applyPlanEntries` branches: when the trip already has days, it patches events in place rather than building the even-split scaffold.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Server Actions, Supabase.

## Global Constraints

- **No test suite exists in this repo.** Do not invent one. Per-task verification is `pnpm lint` + `pnpm build` + reasoning through the data path.
- **Never run `pnpm build` while `pnpm dev` is running** — they share `.next/` and the dev server breaks.
- No emojis in code, logs, or commit messages.
- Sparse comments: docstrings on new exported functions, otherwise only where WHY is non-obvious.
- Dates display day-before-month (`en-GB`). No date formatting changes in this plan.
- `"use client"` files must not import from `*-queries.ts` (pulls `next/headers`). `itinerary-planner.ts` stays client-safe.
- Spec: `docs/superpowers/specs/2026-07-29-edit-itinerary-not-recreate-design.md`.

---

### Task 1: Read an existing itinerary back into the walk's shape

**Files:**
- Modify: `src/lib/ai/itinerary-planner.ts` (add imports at top; add `serverId` to `PlanEntry` around line 89-99; append new exports at end of file)

**Interfaces:**
- Consumes: `ItineraryDay` (`@/lib/trips/itinerary-types`), `ItineraryLocation` (`@/lib/trips/location-types`) — both plain types, client-safe.
- Produces:
  - `PlanEntry.serverId?: string`
  - `interface SavedPlanRow { subject: string; whenStart: string; serverId: string }`
  - `interface SavedPlan { places: { id: string; name: string }[]; rows: Record<string, SavedPlanRow[]> }`
  - `savedPlanFromItinerary(locations: ItineraryLocation[], days: ItineraryDay[]): SavedPlan`

- [ ] **Step 1: Add the two type imports**

At the top of `src/lib/ai/itinerary-planner.ts`, the existing first line is:

```ts
import { ITINERARY_TONES, type ItineraryTone } from "@/lib/trips/itinerary-types"
```

Replace it with:

```ts
import {
  ITINERARY_TONES,
  type ItineraryDay,
  type ItineraryTone,
} from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
```

- [ ] **Step 2: Add `serverId` to `PlanEntry`**

In the `PlanEntry` interface, after the `endDate` field, add:

```ts
  /** `${dayId}#${eventIndex}` when this row was read back from an existing
   * event. The handle that makes a save patch that event instead of adding a
   * second copy of it. */
  serverId?: string
```

- [ ] **Step 3: Append the reader to the end of the file**

```ts
/** Categories that live on a per-place step; the value is the step key prefix. */
const PER_PLACE_STEP: Record<string, string> = {
  Accommodation: "accommodation",
  Food: "food",
  Activities: "activities",
}

/** Categories that live on a trip-wide step; the value is the whole step key. */
const TRIP_STEP: Record<string, string> = {
  Transportation: "transportation:trip",
  Other: "other:trip",
}

/** One walk row read back off an existing itinerary event. */
export interface SavedPlanRow {
  subject: string
  /** The day this event sits on, YYYY-MM-DD. */
  whenStart: string
  /** `${dayId}#${eventIndex}`. */
  serverId: string
}

/** An existing itinerary in the guided walk's shape. */
export interface SavedPlan {
  /** Existing locations in order — the Places step's rows. */
  places: { id: string; name: string }[]
  /** Step key -> rows. */
  rows: Record<string, SavedPlanRow[]>
}

/**
 * Read an existing itinerary back into the walk: locations become the Places
 * step, and every day event becomes a row on its own date under the step its
 * category belongs to. Each row keeps a serverId so applying the walk patches
 * that event rather than adding a duplicate. The itinerary twin of the budget
 * drafter's savedRows(). An empty itinerary yields an empty SavedPlan, which
 * leaves the walk exactly as it opens today.
 */
export function savedPlanFromItinerary(
  locations: ItineraryLocation[],
  days: ItineraryDay[],
): SavedPlan {
  const places = locations.map((l) => ({ id: l.id, name: l.name }))
  const indexById = new Map(places.map((p, i) => [p.id, i] as const))
  const rows: Record<string, SavedPlanRow[]> = {}

  for (const day of days) {
    day.events.forEach((event, i) => {
      const category = event.category ?? "Other"
      const perPlace = PER_PLACE_STEP[category]
      // A day with no location (a travel day) files under the first place,
      // the same fallback the budget drafter uses for orphaned items.
      const placeIdx = (day.locationId ? indexById.get(day.locationId) : undefined) ?? 0
      const key = perPlace
        ? `${perPlace}:${placeIdx}`
        : (TRIP_STEP[category] ?? "other:trip")
      ;(rows[key] ??= []).push({
        subject: event.text,
        whenStart: day.dayDate,
        serverId: `${day.id}#${i}`,
      })
    })
  }

  return { places, rows }
}
```

- [ ] **Step 4: Verify it compiles and the module stays client-safe**

Run (dev server stopped):

```bash
pnpm lint && pnpm build
```

Expected: both pass. Then confirm no server-only import crept in:

```bash
grep -n "next/headers\|-queries\|use server" src/lib/ai/itinerary-planner.ts
```

Expected: no output.

- [ ] **Step 5: Reason through the two worked examples from the spec**

Confirm by reading the function (no test runner exists):

1. One location `{id:"L1", name:"Lisbon"}`, one day `{id:"D1", dayDate:"2026-01-12", locationId:"L1", events:[{text:"Casa do Bairro", category:"Accommodation"}, {text:"Ferry", category:"Transportation"}]}` yields `places === [{id:"L1", name:"Lisbon"}]`, `rows["accommodation:0"] === [{subject:"Casa do Bairro", whenStart:"2026-01-12", serverId:"D1#0"}]`, and `rows["transportation:trip"] === [{subject:"Ferry", whenStart:"2026-01-12", serverId:"D1#1"}]`.
2. `savedPlanFromItinerary([], [])` yields `{ places: [], rows: {} }`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/itinerary-planner.ts
git commit -m "feat(itinerary): read an existing itinerary back into the walk's shape"
```

---

### Task 2: Seed the walk from the itinerary and relabel the button

**Files:**
- Modify: `src/app/trips/[slug]/plan-itinerary.tsx`
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx:724-729` (the `<PlanItinerary>` render)

**Interfaces:**
- Consumes: `savedPlanFromItinerary`, `SavedPlan`, `SavedPlanRow` from Task 1.
- Produces: `PlanItineraryProps` gains `locations: ItineraryLocation[]` and `days: ItineraryDay[]`. `ItemRow` gains `serverId?: string`. `collectEntries()` emits `serverId` on each entry.

**Note on the intermediate state:** after this task the walk is prefilled but `apply` still runs the old add-only path, so edits to prefilled rows will not take effect yet (the server skips dates that already have days). That is expected and harmless — no duplicates are created. Task 3 makes edits land.

- [ ] **Step 1: Extend the imports**

In `src/app/trips/[slug]/plan-itinerary.tsx`, replace this import block:

```ts
import {
  planItinerarySteps,
  type ItineraryPlanStep,
  type PlanEntry,
} from "@/lib/ai/itinerary-planner"
```

with:

```ts
import {
  planItinerarySteps,
  savedPlanFromItinerary,
  type ItineraryPlanStep,
  type PlanEntry,
  type SavedPlan,
} from "@/lib/ai/itinerary-planner"
import type { ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
```

- [ ] **Step 2: Add the two props**

Replace the `PlanItineraryProps` interface:

```ts
export interface PlanItineraryProps {
  tripId: string
  tripSlug: string
  destination: string
  /** The trip's saved avoid text; the walk prefills from it and writes it back. */
  avoid: string
  /** The trip's existing locations and days — the walk opens on them. */
  locations: ItineraryLocation[]
  days: ItineraryDay[]
}
```

- [ ] **Step 3: Add `serverId` to `ItemRow`**

In the `ItemRow` interface, after the `range` field, add:

```ts
  /** Set when the row was read back off an existing event; makes a save patch it. */
  serverId?: string
}
```

(replacing the existing closing brace of the interface).

- [ ] **Step 4: Add the two module-level seed helpers**

Immediately after the `rowEmpty` function and before the `PlanItinerary` docstring, add:

```ts
/** The Places step's opening rows: the trip's locations, or one blank row. */
function seedPlaceNames(saved: SavedPlan): string[] {
  return saved.places.length > 0 ? saved.places.map((p) => p.name) : [""]
}

/** The walk's opening rows, keyed by step. `seq` keeps row ids unique. */
function seedItems(
  saved: SavedPlan,
  seq: React.RefObject<number>,
): Record<string, ItemRow[]> {
  const out: Record<string, ItemRow[]> = {}
  for (const [key, rows] of Object.entries(saved.rows)) {
    out[key] = rows.map((r) => ({
      id: `r-${seq.current++}`,
      subject: r.subject,
      note: "",
      whenStart: r.whenStart,
      serverId: r.serverId,
    }))
  }
  return out
}
```

- [ ] **Step 5: Re-seed the component's state**

Replace the destructured signature and the state block (currently `plan-itinerary.tsx:67-85`) with:

```ts
export function PlanItinerary({
  tripId,
  tripSlug,
  destination,
  avoid: initialAvoid,
  locations,
  days,
}: PlanItineraryProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const seq = React.useRef(0)
  const saved = React.useMemo(
    () => savedPlanFromItinerary(locations, days),
    [locations, days],
  )
  const hasItinerary = days.length > 0
  const title = hasItinerary ? "Edit your itinerary" : "Plan your itinerary"
  const [open, setOpen] = React.useState(searchParams.get("plan") === "1")
  const [phase, setPhase] = React.useState<Phase>("places")
  const [placeNames, setPlaceNames] = React.useState<string[]>(() => seedPlaceNames(saved))
  const [freeText, setFreeText] = React.useState("")
  const [avoid, setAvoid] = React.useState(initialAvoid)
  const [steps, setSteps] = React.useState<ItineraryPlanStep[]>([])
  const [items, setItems] = React.useState<Record<string, ItemRow[]>>(() =>
    seedItems(saved, seq),
  )
  const [stepIndex, setStepIndex] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
```

Note the `seq` ref moved above the state hooks — the `items` initializer needs it. Delete the old `const seq = React.useRef(0)` line that sat after `useTransition`.

- [ ] **Step 6: Re-seed on open and on reset**

Replace the `reset` function with these two:

```ts
  /** Opening always re-reads the itinerary, so a save then reopen shows the
   * saved state rather than the rows this component mounted with. */
  function openWalk() {
    setPhase("places")
    setPlaceNames(seedPlaceNames(saved))
    setFreeText("")
    setAvoid(initialAvoid)
    setSteps([])
    setItems(seedItems(saved, seq))
    setStepIndex(0)
    setError(null)
    setOpen(true)
  }

  function reset() {
    setOpen(false)
    setPhase("places")
    setPlaceNames(seedPlaceNames(saved))
    setFreeText("")
    setAvoid(initialAvoid)
    setSteps([])
    setItems(seedItems(saved, seq))
    setStepIndex(0)
    setError(null)
  }
```

- [ ] **Step 7: Carry `serverId` into the entries**

In `collectEntries()`, the pushed object gains one field:

```ts
        entries.push({
          category: step.category,
          place: step.place ?? "",
          subject: row.subject.trim(),
          when: rowWhen(row),
          date: row.whenStart || undefined,
          endDate: row.whenEnd || undefined,
          serverId: row.serverId,
        })
```

- [ ] **Step 8: Use the label in all three places**

In the closed-state block, replace the button's `onClick` and text:

```tsx
        <button
          type="button"
          onClick={openWalk}
          className="rounded-full border border-border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          {title}
        </button>
```

Then replace all three occurrences of `<Label>Plan your itinerary</Label>` (one in `renderPlaces`, two in `renderStep`) with:

```tsx
<Label>{title}</Label>
```

- [ ] **Step 9: Pass the data from the tab**

In `src/app/trips/[slug]/itinerary-tab.tsx`, the `<PlanItinerary>` render (around line 724) becomes:

```tsx
            <PlanItinerary
              tripId={tripId}
              tripSlug={tripSlug}
              destination={destination}
              avoid={avoid}
              locations={locations}
              days={days}
            />
```

`locations` and `days` are already the tab's local state (declared around lines 352 and 361) — no new query.

- [ ] **Step 10: Verify**

Run (dev server stopped):

```bash
pnpm lint && pnpm build
```

Expected: both pass, no unused-variable or exhaustive-deps warnings.

- [ ] **Step 11: Commit**

```bash
git add src/app/trips/[slug]/plan-itinerary.tsx src/app/trips/[slug]/itinerary-tab.tsx
git commit -m "feat(itinerary): the guided walk opens on the itinerary you already have"
```

---

### Task 3: Make `apply` patch the itinerary instead of appending to it

**Files:**
- Modify: `src/lib/ai/itinerary-actions.ts` (imports at top; `applyPlanEntries` at lines 110-137; new helpers above it)

**Interfaces:**
- Consumes: `PlanEntry.serverId` (Task 1); `getItineraryDays(tripId): Promise<ItineraryDay[]>` from `@/lib/trips/itinerary-queries`; `updateItineraryDay(UpdateItineraryDayInput): Promise<{ error?: string }>` and `renameItineraryLocation(locationId, tripId, tripSlug, name, startDate, endDate): Promise<{ error?: string; needsPush?: boolean }>` from `@/lib/trips/actions`.
- Produces: no signature change. `applyPlanEntries` keeps its input and return type; only its behavior branches.

- [ ] **Step 1: Extend the imports**

Replace the first import block of `src/lib/ai/itinerary-actions.ts`:

```ts
import {
  addItineraryDay,
  createItineraryLocation,
  saveTripProfile,
} from "@/lib/trips/actions"
```

with:

```ts
import {
  addItineraryDay,
  createItineraryLocation,
  renameItineraryLocation,
  saveTripProfile,
  updateItineraryDay,
} from "@/lib/trips/actions"
```

Then, after the existing `import { getItineraryLocations } from "@/lib/trips/location-queries"` line, add:

```ts
import { getItineraryDays } from "@/lib/trips/itinerary-queries"
import { ITINERARY_TONES } from "@/lib/trips/itinerary-types"
import type { ItineraryDay, ItineraryEvent } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"
```

- [ ] **Step 2: Add the location-resolution helper**

Insert immediately above the `export interface ApplyItineraryInput` block:

```ts
/** The location a day on `date` belongs to: the span that covers it, else the
 * one the walk step named, else none — a travel day. */
function locationForDate(
  locations: ItineraryLocation[],
  date: string,
  place: string,
): string | null {
  const covering = locations.find(
    (l) => l.startDate && l.endDate && l.startDate <= date && date <= l.endDate,
  )
  if (covering) return covering.id
  const key = place.trim().toLowerCase()
  const named = key
    ? locations.find((l) => l.name.trim().toLowerCase() === key)
    : undefined
  return named?.id ?? null
}
```

- [ ] **Step 3: Add the edit path**

Insert immediately above `export async function applyPlanEntries`:

```ts
/**
 * The edit path, taken once a trip has an itinerary: the walk owns every event,
 * so applying writes its state back. A row read off an existing event patches it
 * in place — time, url, rating and note are carried over — a row that is gone
 * deletes that event, and a row on a date with no day yet creates one. Days are
 * never deleted, only emptied. No scaffold is built: every row already carries a
 * real date.
 */
async function applyPlanEdits(
  input: { tripId: string; tripSlug: string; places: string[]; entries: PlanEntry[] },
  days: ItineraryDay[],
  locations: ItineraryLocation[],
  tripName: string,
): Promise<{ error?: string; created?: { locations: number; days: number } }> {
  const originals = new Map<string, ItineraryEvent>()
  const dayById = new Map(days.map((d) => [d.id, d] as const))
  const firstDateByLocation = new Map<string, string>()
  for (const day of days) {
    day.events.forEach((e, i) => originals.set(`${day.id}#${i}`, e))
    if (day.locationId && !firstDateByLocation.has(day.locationId)) {
      firstDateByLocation.set(day.locationId, day.dayDate)
    }
  }

  /** Where an undated new row lands: its place's first day, else the trip's. */
  function fallbackDate(place: string): string | undefined {
    const key = place.trim().toLowerCase()
    const loc = key
      ? locations.find((l) => l.name.trim().toLowerCase() === key)
      : undefined
    return (loc && firstDateByLocation.get(loc.id)) ?? days[0]?.dayDate
  }

  // Positional rename, only while the walk still holds as many places as the
  // trip has locations — an added or removed row makes positions meaningless.
  if (input.places.length === locations.length) {
    for (const [i, loc] of locations.entries()) {
      const name = input.places[i].trim()
      if (!name || name === loc.name) continue
      const res = await renameItineraryLocation(
        loc.id,
        input.tripId,
        input.tripSlug,
        name,
        loc.startDate,
        loc.endDate,
      )
      if (res.error) return { error: res.error }
    }
  }

  // Every row as a dated event, keeping its original's extras when it has one.
  const byDate = new Map<string, ItineraryEvent[]>()
  const placeByDate = new Map<string, string>()
  for (const entry of input.entries) {
    const original = entry.serverId ? originals.get(entry.serverId) : undefined
    const fromDay = entry.serverId
      ? dayById.get(entry.serverId.split("#")[0])
      : undefined
    const date = entry.date ?? fromDay?.dayDate ?? fallbackDate(entry.place)
    if (!date) continue
    const text = entry.subject.trim() || entry.category
    const event: ItineraryEvent = original
      ? { ...original, text, category: entry.category }
      : { text, time: "", category: entry.category }
    const list = byDate.get(date) ?? []
    list.push(event)
    byDate.set(date, list)
    if (!placeByDate.has(date)) placeByDate.set(date, entry.place)
  }

  // Existing days: rewrite the event list to what the walk holds for that date.
  for (const day of days) {
    const next = byDate.get(day.dayDate) ?? []
    byDate.delete(day.dayDate)
    if (JSON.stringify(next) === JSON.stringify(day.events)) continue
    const res = await updateItineraryDay({
      dayId: day.id,
      tripSlug: input.tripSlug,
      dayDate: day.dayDate,
      title: day.title,
      sub: day.sub,
      events: next,
      tag: day.tag,
      tone: day.tone,
      locationId: day.locationId,
    })
    if (res.error) return { error: res.error }
  }

  // Whatever is left sits on a date the trip has no day for yet.
  let added = 0
  for (const [date, events] of byDate) {
    const locationId = locationForDate(locations, date, placeByDate.get(date) ?? "")
    const name = locations.find((l) => l.id === locationId)?.name ?? tripName
    const res = await addItineraryDay({
      tripId: input.tripId,
      tripSlug: input.tripSlug,
      dayDate: date,
      title: name,
      sub: "",
      events,
      tag: name,
      tone: ITINERARY_TONES[(days.length + added) % ITINERARY_TONES.length],
      locationId,
    })
    if (res.error) return { error: res.error }
    added++
  }

  return { created: { locations: 0, days: added } }
}
```

- [ ] **Step 4: Branch `applyPlanEntries`**

In the body of `applyPlanEntries`, after the `await persistAvoid(...)` line and before `const skeleton = entriesToSkeleton(`, insert:

```ts
  const existingDays = await getItineraryDays(input.tripId)
  if (existingDays.length > 0) {
    const locations = await getItineraryLocations(input.tripId)
    return await applyPlanEdits(input, existingDays, locations, trip.name)
  }
```

Leave the rest of the function — the `entriesToSkeleton` + `applyItinerarySkeleton` path for a trip with no itinerary — untouched.

- [ ] **Step 5: Update the function's docstring**

Replace the docstring above `export async function applyPlanEntries` with:

```ts
/**
 * The guided walk's no-AI terminal action: write exactly what the couple
 * entered, on the dates they picked. On a trip with no itinerary this scaffolds
 * one from the places; on a trip that already has one it patches the days that
 * are there (see applyPlanEdits).
 */
```

- [ ] **Step 6: Verify**

Run (dev server stopped):

```bash
pnpm lint && pnpm build
```

Expected: both pass.

Then confirm the spec's code-level criteria by reading the diff:

```bash
git diff src/lib/ai/itinerary-actions.ts
```

Check: `applyPlanEdits` mentions neither `planItinerarySkeleton` nor `entriesToSkeleton`; `draftAndApplyItinerary` is untouched; the `{ ...original, text, category }` spread is what carries `rating`, `url` and `note` through a re-save.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/itinerary-actions.ts
git commit -m "feat(itinerary): applying the walk patches the itinerary instead of appending"
```

- [ ] **Step 8: Update the docs**

In `docs/TODO.md`, add under the itinerary section:

```markdown
- [x] Guided walk edits the existing itinerary instead of drafting a new one — *implemented, unverified in app*
```

In `docs/DECISIONS.md`, append a row:

```markdown
| 2026-07-29 | The guided itinerary walk owns every event it shows | Applying it rewrites each day's event list rather than diffing. Rows keep a `dayId#index` serverId so ratings, links and times survive a re-save. Simpler than a diff engine, and makes delete work. |
```

Then commit:

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record the itinerary walk edit path"
```

---

## Self-review

**Spec coverage:** §1 prop → Task 2 steps 2, 9. §2 prefill → Task 1. §3 save → Task 3 steps 2-4. §4 places/rename → Task 3 step 3 (guarded to equal counts; removal never deletes a location, as specified). §5 label → Task 2 step 8. §6 Generate unchanged → no task touches `draftAndApplyItinerary`; asserted in Task 3 step 6.

**Type consistency:** `savedPlanFromItinerary` / `SavedPlan` / `SavedPlanRow` are named identically in Tasks 1 and 2. `serverId` is the same string format (`dayId#index`) in Task 1 step 3, Task 2 step 4, and Task 3 step 3.

**Known limitation, accepted:** a trip with days but no locations opens the Places step blank (one empty row) while its events still prefill under place 0 and the trip-wide steps. Rare, and harmless — the walk still saves correctly because every row carries its own date.

