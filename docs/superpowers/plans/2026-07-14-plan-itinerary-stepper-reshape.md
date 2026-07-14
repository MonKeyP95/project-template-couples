# Plan-your-itinerary Stepper Reshape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the guided "Plan your itinerary" flow from one long AI-filled scroll into a calm 5-step category stepper with a sparse, grounded AI draft that leaves gaps for the user to fill.

**Architecture:** Reuse the Slice-2 AI seam (`draftItinerary`), the write path (`applyItinerarySkeleton`), and the event model. The staging area becomes a flat list of draft items (category/place/text/date/time — the exact `DraftedItineraryEvent` shape) so each item can carry its own optional place and date; a new pure converter turns that flat list into an `ItinerarySkeleton` at Apply, reusing the unchanged write path. The seam gains one clarifying-question path (empty events + a question when the input is too thin).

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions), React 19, TypeScript 5, Tailwind v4, `@anthropic-ai/sdk`. No new deps, no migration.

**Spec:** `docs/superpowers/specs/2026-07-14-plan-itinerary-stepper-reshape-design.md`

## Global Constraints

- **Suggest-only.** The draft only fills the wizard's client-side staging area; the single write is Apply. No auto-acts.
- **No AI on render.** The AI runs only when the user presses Generate.
- **Category set (order):** `Accommodation, Transportation, Activities, Food, Other` — the budget five, walked in this order.
- **Dated trips only.** The planning block (where this mounts) already renders only for dated trips; dreams render `DreamItineraryTab`.
- **European dates** where dates display: use the existing `formatShortDate` (en-GB, day-before-month). Never `en-US`.
- **No test runner exists** (CLAUDE.md: do not invent one). Hard gate per task is `pnpm lint && pnpm build` clean plus the named in-app check. The one pure function (`itemsToSkeleton`) is additionally exercised by a throwaway `tsx` script that is deleted after.
- **No emojis** in code, prints, or logs. Sparse comments; clear names; short functions.
- **No migration, no new dependencies.**

---

## File Structure

- **Modify** `src/lib/ai/itinerary-planner.ts` — widen `ITINERARY_CATEGORIES` to the five (done in Task 3, with the UI that iterates it); add the pure `DraftItem` type + `itemsToSkeleton` converter (Task 1).
- **Modify** `src/lib/ai/claude.ts` — widen the `propose_itinerary` category enum to five; rewrite `ITINERARY_SYSTEM` (sparse + grounding + one-question); add the `question` field; change `draftItinerary` to return `{ events, question }` (Task 2).
- **Modify** `src/lib/ai/itinerary-actions.ts` — keep old `draftItineraryForTrip` compiling; add `draftItineraryItems` returning flat items + question (Task 2); remove the now-dead old path (Task 4).
- **Rewrite** `src/app/trips/[slug]/plan-itinerary.tsx` — the stepper container + presentational steps (Task 3).
- **Modify** `src/app/trips/[slug]/itinerary-tab.tsx` — thread `startDate` to `<PlanItinerary>` (Task 3).

---

## Task 1: Pure `itemsToSkeleton` converter

**Files:**
- Modify: `src/lib/ai/itinerary-planner.ts`
- Throwaway test: `src/lib/ai/_items-to-skeleton.check.tsx` (deleted at end of task)

**Interfaces:**
- Consumes: `planItinerarySkeleton`, `ItinerarySkeleton`, `SkeletonEvent` (existing, same file).
- Produces:
  - `interface DraftItem { category: string; place: string; text: string; date: string; time: string }`
  - `itemsToSkeleton(items: DraftItem[], placeNames: string[], destination: string, startDate: string, dayCount: number): ItinerarySkeleton`

- [ ] **Step 1: Write the throwaway test**

Create `src/lib/ai/_items-to-skeleton.check.tsx`:

```tsx
import { itemsToSkeleton, type DraftItem } from "./itinerary-planner"

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg)
  console.log("ok: " + msg)
}

const names = ["Faial", "Sao Jorge"]
// 4 days from 2026-07-10: Faial gets 10,11; Sao Jorge gets 12,13 (even split).
const items: DraftItem[] = [
  { category: "Activities", place: "Faial", text: "Snorkel", date: "2026-07-10", time: "" },
  { category: "Food", place: "Faial", text: "Dinner", date: "2026-07-11", time: "20:00" },
  { category: "Activities", place: "Sao Jorge", text: "Hike", date: "2026-07-12", time: "" },
  // place-less -> first place (Faial), its first day (2026-07-10)
  { category: "Other", place: "", text: "Buy sim", date: "", time: "" },
  // date out of Sao Jorge's range -> Sao Jorge's first day (2026-07-12)
  { category: "Food", place: "Sao Jorge", text: "Market", date: "2026-07-30", time: "" },
]

const sk = itemsToSkeleton(items, names, "Azores", "2026-07-10", 4)
const faial = sk.places.find((p) => p.name === "Faial")!
const sjorge = sk.places.find((p) => p.name === "Sao Jorge")!

assert(sk.places.length === 2, "two places")
// Faial: day 10 has Snorkel + Buy sim, day 11 has Dinner; days 12/13 dropped (empty).
const f10 = faial.days.find((d) => d.date === "2026-07-10")!
assert(f10.events.length === 2, "Faial 07-10 has two events (snorkel + place-less)")
assert(faial.days.every((d) => d.events.length > 0), "no empty Faial days kept")
// Sao Jorge: day 12 has Hike + Market (out-of-range date fell back to first day).
const s12 = sjorge.days.find((d) => d.date === "2026-07-12")!
assert(s12.events.length === 2, "Sao Jorge 07-12 has two events (hike + market fallback)")

// Empty input -> places present but all days empty (apply skips them).
const empty = itemsToSkeleton([], names, "Azores", "2026-07-10", 4)
assert(empty.places.every((p) => p.days.length === 0), "empty items -> no days")

console.log("ALL PASS")
```

- [ ] **Step 2: Run it to verify it fails (function not defined yet)**

Run: `pnpm dlx tsx src/lib/ai/_items-to-skeleton.check.tsx`
Expected: FAIL — `itemsToSkeleton`/`DraftItem` not exported.

- [ ] **Step 3: Implement `DraftItem` + `itemsToSkeleton`**

Append to `src/lib/ai/itinerary-planner.ts`:

```ts
/** A flat, per-item draft: category + optional place/date, the wizard's staging
 * unit. Structurally the same as claude.ts's DraftedItineraryEvent; kept here
 * (client-safe) so the stepper and the converter never import the server seam. */
export interface DraftItem {
  category: string
  place: string
  text: string
  date: string
  time: string
}

/**
 * Turn the wizard's flat draft items into an ItinerarySkeleton for the existing
 * write path. Builds the deterministic scaffold to learn each place's dates and
 * day metadata, then files each item under its place (place-less -> first place)
 * on its date (blank or out-of-range -> that place's first day). Days with no
 * items are dropped so Apply never creates empty itinerary days.
 */
export function itemsToSkeleton(
  items: DraftItem[],
  placeNames: string[],
  destination: string,
  startDate: string,
  dayCount: number,
): ItinerarySkeleton {
  const names = placeNames.map((n) => n.trim()).filter((n) => n.length > 0)
  const scaffold = planItinerarySkeleton({ destination, startDate, dayCount, placeNames: names })

  // Per scaffold place: a map date -> collected events, plus its date set.
  const buckets = scaffold.places.map((place) => ({
    place,
    dates: new Set(place.days.map((d) => d.date)),
    firstDate: place.days[0]?.date ?? null,
    byDate: new Map<string, SkeletonEvent[]>(),
  }))
  // Place 0 always has at least one day (dayCount >= 1, remainder to earlier places).
  const fallbackPlaceIdx = 0

  for (const item of items) {
    const key = item.place.trim().toLowerCase()
    let idx = key ? scaffold.places.findIndex((p) => p.name.trim().toLowerCase() === key) : -1
    if (idx < 0) idx = fallbackPlaceIdx
    let bucket = buckets[idx]
    if (!bucket.firstDate) bucket = buckets[fallbackPlaceIdx]
    const date = bucket.dates.has(item.date) ? item.date : (bucket.firstDate as string)
    const list = bucket.byDate.get(date) ?? []
    list.push({ text: item.text, time: item.time, category: item.category })
    bucket.byDate.set(date, list)
  }

  return {
    places: buckets.map(({ place, byDate }) => ({
      name: place.name,
      days: place.days
        .filter((d) => byDate.has(d.date))
        .map((d) => ({ ...d, events: byDate.get(d.date) as SkeletonEvent[] })),
    })),
  }
}
```

- [ ] **Step 4: Run the throwaway test to verify it passes**

Run: `pnpm dlx tsx src/lib/ai/_items-to-skeleton.check.tsx`
Expected: prints `ok:` lines then `ALL PASS`.

- [ ] **Step 5: Delete the throwaway test and verify lint + build**

```bash
rm src/lib/ai/_items-to-skeleton.check.tsx
```
Run: `pnpm lint && pnpm build`
Expected: no errors (the new exports are unused until Task 3; build confirms they compile).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/itinerary-planner.ts
git commit -m "feat(itinerary): pure itemsToSkeleton converter for the stepper staging model"
```

---

## Task 2: Seam — five categories, sparse + grounded draft, one clarifying question

**Files:**
- Modify: `src/lib/ai/claude.ts` (the itinerary block: enum, `ITINERARY_SYSTEM`, `ITINERARY_TOOL`, `draftItinerary`)
- Modify: `src/lib/ai/itinerary-actions.ts` (keep `draftItineraryForTrip` compiling; add `draftItineraryItems`)

**Interfaces:**
- Consumes: `DraftItem` (Task 1), `planItinerarySkeleton` (existing), `buildAssistantContext`, `isAiEnabled`, `getCurrentWorkspace`, `getTripBySlug` (existing).
- Produces:
  - `draftItinerary(context: ItineraryDraftContext): Promise<{ events: DraftedItineraryEvent[]; question: string }>`
  - `draftItineraryItems(input: { tripSlug: string; dayCount: number; placeNames: string[]; freeText: string }): Promise<{ items: DraftItem[]; drafted: boolean; question: string }>`

- [ ] **Step 1: Widen the tool category enum to five**

In `src/lib/ai/claude.ts`, in `ITINERARY_TOOL.input_schema.properties.events.items.properties.category`, change the enum:

```ts
            category: {
              type: "string",
              enum: ["Accommodation", "Transportation", "Activities", "Food", "Other"],
              description: "Which kind of event this is.",
            },
```

- [ ] **Step 2: Add the optional `question` field to the tool**

In the same `ITINERARY_TOOL`, add a `question` property alongside `events`, and require it (strict tool: every listed key must be in `required`). Replace the `properties` + `required` of the top-level object:

```ts
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: {
              type: "string",
              enum: ["Accommodation", "Transportation", "Activities", "Food", "Other"],
              description: "Which kind of event this is.",
            },
            place: {
              type: "string",
              description: "The exact itinerary place name given for this event, or empty.",
            },
            text: {
              type: "string",
              description: "Short label for the event, e.g. 'Surf lesson' or 'Dinner - seafood'.",
            },
            date: {
              type: "string",
              description: "YYYY-MM-DD within the trip dates. Empty if you can't place it.",
            },
            time: {
              type: "string",
              description: "HH:MM 24h, or empty.",
            },
          },
          required: ["category", "place", "text", "date", "time"],
        },
      },
      question: {
        type: "string",
        description:
          "Empty when you proposed events. When the input is too thin to ground on, leave events empty and put ONE short clarifying question here.",
      },
    },
    required: ["events", "question"],
```

- [ ] **Step 3: Rewrite `ITINERARY_SYSTEM` for sparseness, grounding, and the one-question rule**

Replace the `ITINERARY_SYSTEM` constant:

```ts
const ITINERARY_SYSTEM =
  "You draft a trip itinerary for a couple or family by calling propose_itinerary. " +
  "Be SPARSE: propose only a few genuinely grounded items per category (roughly one " +
  "or two), and leave a category empty if you have nothing concrete. Do not pad with " +
  "generic filler like 'explore the old town'. Leave room for the user to fill the rest. " +
  "GROUNDING: stay strictly on the specific place names given; never leap from a country " +
  "to a city the user did not name; never invent a place or date from the trip's name. " +
  "Set place to one of the exact place names given (or empty). Set date to a real " +
  "YYYY-MM-DD within range, or empty if you cannot place it. Keep each event a short " +
  "label, not a paragraph. Weight the couple's taste and vibe as a lens, never a checklist. " +
  "Do not invent prices or booking details. " +
  "If what you were given is too thin to ground on (for example no usable place), do NOT " +
  "guess: return an empty events array and put ONE short clarifying question in question. " +
  "Otherwise return your events and leave question empty."
```

- [ ] **Step 4: Change `draftItinerary` to return `{ events, question }`**

Replace the `draftItinerary` function:

```ts
/** Real Claude itinerary draft. Returns sparse, grounded events, OR an empty
 * events array plus one clarifying question when the input is too thin. */
export async function draftItinerary(
  context: ItineraryDraftContext,
): Promise<{ events: DraftedItineraryEvent[]; question: string }> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: ITINERARY_SYSTEM,
    tools: [ITINERARY_TOOL],
    tool_choice: { type: "tool", name: "propose_itinerary" },
    messages: [{ role: "user", content: itineraryPrompt(context) }],
  })
  const proposal = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === "propose_itinerary",
  )
  if (!proposal) return { events: [], question: "" }
  const input = proposal.input as { events?: DraftedItineraryEvent[]; question?: string }
  return { events: input.events ?? [], question: input.question ?? "" }
}
```

- [ ] **Step 5: Keep the old `draftItineraryForTrip` compiling**

In `src/lib/ai/itinerary-actions.ts`, `draftItineraryForTrip` calls `const events = await draftItinerary(...)`. Update that one line to destructure the new shape (question ignored here; this path is removed in Task 4):

```ts
    const { events } = await draftItinerary({
      destination,
      startDate,
      dayCount: input.dayCount,
      locations,
      vibe: trip.tripProfile.vibe,
      brief: trip.tripProfile.idea,
      activityTypes: input.activityTypes,
      freeText: input.freeText,
      profileBlock,
      tasteDirective,
    })
```

- [ ] **Step 6: Add the `draftItineraryItems` action**

In `src/lib/ai/itinerary-actions.ts`, add the import of `DraftItem` to the existing planner import and add the new action. First extend the import:

```ts
import {
  planItinerarySkeleton,
  type ItinerarySkeleton,
  type DraftItem,
} from "@/lib/ai/itinerary-planner"
```

Then append the action at the end of the file:

```ts
/** Sparse, grounded AI draft as flat items for the stepper. Builds the scaffold
 * only to hand the AI each place's real date ranges to ground on; returns the
 * AI's events as flat DraftItems, or a single clarifying question, or nothing.
 * AI off / failure -> empty items, drafted:false. Never throws. Suggest-only. */
export async function draftItineraryItems(input: {
  tripSlug: string
  dayCount: number
  placeNames: string[]
  freeText: string
}): Promise<{ items: DraftItem[]; drafted: boolean; question: string }> {
  const workspace = await getCurrentWorkspace()
  const trip = workspace ? await getTripBySlug(workspace.id, input.tripSlug) : null
  if (!workspace || !trip || !trip.startDate) return { items: [], drafted: false, question: "" }
  if (!(await isAiEnabled())) return { items: [], drafted: false, question: "" }

  const destination = trip.country ?? trip.name
  const names = input.placeNames.map((n) => n.trim()).filter((n) => n.length > 0)

  try {
    const scaffold = planItinerarySkeleton({
      destination,
      startDate: trip.startDate,
      dayCount: input.dayCount,
      placeNames: names,
    })
    const locations = scaffold.places.map((p) => {
      const dates = p.days.map((d) => d.date)
      const first = dates[0]
      const last = dates[dates.length - 1]
      return {
        name: p.name,
        nights: p.days.length,
        dateLabel: first ? (first === last ? first : `${first} to ${last}`) : null,
      }
    })

    const { profileBlock, tasteDirective } = await buildAssistantContext(workspace.id, trip.id)

    const { events, question } = await draftItinerary({
      destination,
      startDate: trip.startDate,
      dayCount: input.dayCount,
      locations,
      vibe: trip.tripProfile.vibe,
      brief: trip.tripProfile.idea,
      activityTypes: [],
      freeText: input.freeText,
      profileBlock,
      tasteDirective,
    })

    const items: DraftItem[] = events.map((e) => ({
      category: e.category,
      place: e.place,
      text: e.text,
      date: e.date,
      time: e.time,
    }))
    return { items, drafted: items.length > 0, question }
  } catch {
    return { items: [], drafted: false, question: "" }
  }
}
```

- [ ] **Step 7: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: no errors. Both `draftItineraryForTrip` (old, still used by the current UI) and `draftItineraryItems` (new, unused until Task 3) compile.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai/claude.ts src/lib/ai/itinerary-actions.ts
git commit -m "feat(itinerary): sparse+grounded draft seam with a clarifying-question path; flat-item action"
```

---

## Task 3: The stepper UI

**Files:**
- Modify: `src/lib/ai/itinerary-planner.ts` (widen `ITINERARY_CATEGORIES` to five)
- Rewrite: `src/app/trips/[slug]/plan-itinerary.tsx`
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (thread `startDate`)

**Interfaces:**
- Consumes: `ITINERARY_CATEGORIES`, `itemsToSkeleton`, `DraftItem` (Tasks 1/3), `draftItineraryItems`, `applyItinerarySkeleton` (Task 2), `formatShortDate` (existing), `Label` (existing).
- Produces: `PlanItinerary` with props `{ tripId, tripSlug, destination, startDate, dayCount }` (adds `startDate: string`).

- [ ] **Step 1: Widen `ITINERARY_CATEGORIES` to the five**

In `src/lib/ai/itinerary-planner.ts`, replace the constant and its `SkeletonEvent.category` doc line:

```ts
export const ITINERARY_CATEGORIES = [
  "Accommodation",
  "Transportation",
  "Activities",
  "Food",
  "Other",
] as const
```

And update the `category` field comment on `SkeletonEvent`:

```ts
  /** One of ITINERARY_CATEGORIES; optional so a blank draft event stays valid. */
  category?: string
```

- [ ] **Step 2: Rewrite `plan-itinerary.tsx` as the stepper**

Replace the entire contents of `src/app/trips/[slug]/plan-itinerary.tsx` with:

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Label } from "@/components/together"
import {
  ITINERARY_CATEGORIES,
  itemsToSkeleton,
  type DraftItem,
} from "@/lib/ai/itinerary-planner"
import { applyItinerarySkeleton, draftItineraryItems } from "@/lib/ai/itinerary-actions"
import { formatShortDate } from "@/lib/trips/itinerary-types"

export interface PlanItineraryProps {
  tripId: string
  tripSlug: string
  destination: string
  startDate: string
  dayCount: number
}

type Phase = "setup" | "walk"

/** Advance a YYYY-MM-DD date by n days (UTC, no tz drift). */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function PlanItinerary({
  tripId,
  tripSlug,
  destination,
  startDate,
  dayCount,
}: PlanItineraryProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [phase, setPhase] = React.useState<Phase>("setup")
  const [catIdx, setCatIdx] = React.useState(0)
  const [placeNames, setPlaceNames] = React.useState<string[]>([""])
  const [freeText, setFreeText] = React.useState("")
  const [answer, setAnswer] = React.useState("")
  const [question, setQuestion] = React.useState("")
  const [items, setItems] = React.useState<DraftItem[]>([])
  const [drafted, setDrafted] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const tripDates = React.useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDays(startDate, i)),
    [startDate, dayCount],
  )
  const trimmedPlaces = placeNames.map((n) => n.trim()).filter((n) => n.length > 0)

  function reset() {
    setOpen(false)
    setPhase("setup")
    setCatIdx(0)
    setPlaceNames([""])
    setFreeText("")
    setAnswer("")
    setQuestion("")
    setItems([])
    setDrafted(true)
    setError(null)
  }

  function generate() {
    const combined = [freeText.trim(), answer.trim()].filter(Boolean).join(" ")
    setError(null)
    startTransition(async () => {
      try {
        const res = await draftItineraryItems({
          tripSlug,
          dayCount,
          placeNames: trimmedPlaces,
          freeText: combined,
        })
        if (res.question) {
          setQuestion(res.question)
          return
        }
        setItems(res.items)
        setDrafted(res.drafted)
        setQuestion("")
        setPhase("walk")
        setCatIdx(0)
      } catch {
        setError("Couldn't draft right now — try again.")
      }
    })
  }

  function skip() {
    setItems([])
    setDrafted(true)
    setQuestion("")
    setPhase("walk")
    setCatIdx(0)
  }

  function editItem(index: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === index ? { ...it, ...patch } : it)))
  }

  function addItem(category: string) {
    setItems((prev) => [...prev, { category, place: "", text: "", date: "", time: "" }])
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== index))
  }

  function apply() {
    if (isPending) return
    const skeleton = itemsToSkeleton(items, trimmedPlaces, destination, startDate, dayCount)
    startTransition(async () => {
      const r = await applyItinerarySkeleton({ tripId, tripSlug, skeleton })
      if (r.error) {
        setError(r.error)
        return
      }
      router.refresh()
      reset()
    })
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between border-t border-border px-5 pt-4 pb-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          Plan your itinerary
        </button>
      </div>
    )
  }

  return (
    <div className="border-t border-border px-5 pt-4 pb-2">
      <div className="rounded-lg border border-border bg-card px-3.5 py-3">
        {phase === "setup" ? (
          <SetupStep
            destination={destination}
            placeNames={placeNames}
            freeText={freeText}
            question={question}
            answer={answer}
            isPending={isPending}
            error={error}
            onPlaceName={(i, v) =>
              setPlaceNames((prev) => prev.map((n, idx) => (idx === i ? v : n)))
            }
            onAddPlace={() => setPlaceNames((prev) => [...prev, ""])}
            onRemovePlace={(i) => setPlaceNames((prev) => prev.filter((_, idx) => idx !== i))}
            onFreeText={setFreeText}
            onAnswer={setAnswer}
            onGenerate={generate}
            onSkip={skip}
            onCancel={reset}
          />
        ) : (
          <CategoryStep
            category={ITINERARY_CATEGORIES[catIdx]}
            stepNo={catIdx + 1}
            stepCount={ITINERARY_CATEGORIES.length}
            items={items}
            placeNames={trimmedPlaces}
            tripDates={tripDates}
            drafted={drafted}
            isPending={isPending}
            error={error}
            isLast={catIdx === ITINERARY_CATEGORIES.length - 1}
            onEdit={editItem}
            onAdd={addItem}
            onRemove={removeItem}
            onBack={() => (catIdx === 0 ? setPhase("setup") : setCatIdx((c) => c - 1))}
            onNext={() => setCatIdx((c) => c + 1)}
            onApply={apply}
            onCancel={reset}
          />
        )}
      </div>
    </div>
  )
}

function SetupStep({
  destination,
  placeNames,
  freeText,
  question,
  answer,
  isPending,
  error,
  onPlaceName,
  onAddPlace,
  onRemovePlace,
  onFreeText,
  onAnswer,
  onGenerate,
  onSkip,
  onCancel,
}: {
  destination: string
  placeNames: string[]
  freeText: string
  question: string
  answer: string
  isPending: boolean
  error: string | null
  onPlaceName: (i: number, v: string) => void
  onAddPlace: () => void
  onRemovePlace: (i: number) => void
  onFreeText: (v: string) => void
  onAnswer: (v: string) => void
  onGenerate: () => void
  onSkip: () => void
  onCancel: () => void
}) {
  return (
    <>
      <Label>Plan your itinerary</Label>
      <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {destination}
      </div>

      <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Places
      </div>
      <div className="mt-1.5 space-y-1.5">
        {placeNames.map((name, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={name}
              placeholder={`Place ${i + 1}`}
              onChange={(e) => onPlaceName(i, e.target.value)}
              className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
            />
            <button
              type="button"
              onClick={() => onRemovePlace(i)}
              aria-label="Remove place"
              className="border-0 bg-transparent font-mono text-[13px] text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2">
        <button
          type="button"
          onClick={onAddPlace}
          className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
        >
          + add place
        </button>
      </div>

      <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Anything else
      </div>
      <textarea
        value={freeText}
        onChange={(e) => onFreeText(e.target.value)}
        rows={2}
        placeholder="Notes for the assistant…"
        className="mt-1.5 w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-foreground"
      />

      {question ? (
        <div className="mt-3 rounded-md border border-l-2 border-border border-l-moss bg-background px-2.5 py-2">
          <p className="text-[12.5px] leading-snug text-moss">{question}</p>
          <input
            type="text"
            value={answer}
            onChange={(e) => onAnswer(e.target.value)}
            placeholder="your answer (optional)…"
            className="mt-1.5 w-full border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
          />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onGenerate}
          disabled={isPending}
          className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "Drafting…" : question ? "Answer & generate" : "Generate"}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={isPending}
          className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground disabled:opacity-40"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground disabled:opacity-40"
        >
          Cancel
        </button>
        {error ? <span className="font-mono text-[9px] text-clay">{error}</span> : null}
      </div>
    </>
  )
}

function CategoryStep({
  category,
  stepNo,
  stepCount,
  items,
  placeNames,
  tripDates,
  drafted,
  isPending,
  error,
  isLast,
  onEdit,
  onAdd,
  onRemove,
  onBack,
  onNext,
  onApply,
  onCancel,
}: {
  category: string
  stepNo: number
  stepCount: number
  items: DraftItem[]
  placeNames: string[]
  tripDates: string[]
  drafted: boolean
  isPending: boolean
  error: string | null
  isLast: boolean
  onEdit: (index: number, patch: Partial<DraftItem>) => void
  onAdd: (category: string) => void
  onRemove: (index: number) => void
  onBack: () => void
  onNext: () => void
  onApply: () => void
  onCancel: () => void
}) {
  // Keep each item's real index in the full array so edits target the right one.
  const rows = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.category === category)

  return (
    <>
      <div className="flex items-center justify-between">
        <Label>{category}</Label>
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          {stepNo} of {stepCount}
        </span>
      </div>
      {!drafted ? (
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          blank draft — turn the assistant on for suggestions.
        </p>
      ) : null}

      <div className="mt-2 space-y-2">
        {rows.length === 0 ? (
          <p className="font-serif text-[14px] italic text-muted-foreground">Nothing here yet.</p>
        ) : (
          rows.map(({ item, index }) => (
            <div key={index} className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={item.text}
                  placeholder="What"
                  onChange={(e) => onEdit(index, { text: e.target.value })}
                  className="min-w-0 flex-1 border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
                />
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  aria-label="Remove item"
                  className="border-0 bg-transparent font-mono text-[12px] text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={item.place}
                  onChange={(e) => onEdit(index, { place: e.target.value })}
                  className="min-w-0 flex-1 border-0 border-b border-border bg-transparent font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground outline-none focus:border-foreground"
                >
                  <option value="">(no place)</option>
                  {placeNames.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <select
                  value={item.date}
                  onChange={(e) => onEdit(index, { date: e.target.value })}
                  className="t-num shrink-0 border-0 border-b border-border bg-transparent font-mono text-[10px] text-muted-foreground outline-none focus:border-foreground"
                >
                  <option value="">no date</option>
                  {tripDates.map((d) => (
                    <option key={d} value={d}>
                      {formatShortDate(d)}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={item.time}
                  placeholder="time"
                  onChange={(e) => onEdit(index, { time: e.target.value })}
                  className="t-num w-14 shrink-0 border-0 border-b border-border bg-transparent font-mono text-[11px] text-muted-foreground outline-none focus:border-foreground"
                />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-2">
        <button
          type="button"
          onClick={() => onAdd(category)}
          className="rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
        >
          + add {category.toLowerCase()}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onBack}
          disabled={isPending}
          className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground disabled:opacity-40"
        >
          Back
        </button>
        {isLast ? (
          <button
            type="button"
            onClick={onApply}
            disabled={isPending}
            className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {isPending ? "…" : "Apply"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            disabled={isPending}
            className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            Next →
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground disabled:opacity-40"
        >
          Cancel
        </button>
        {error ? <span className="font-mono text-[9px] text-clay">{error}</span> : null}
      </div>
    </>
  )
}
```

- [ ] **Step 3: Thread `startDate` into the mount**

In `src/app/trips/[slug]/itinerary-tab.tsx`, the `<PlanItinerary>` render (around line 679) — add `startDate`:

```tsx
            <PlanItinerary
              tripId={tripId}
              tripSlug={tripSlug}
              destination={destination}
              startDate={tripStartDate}
              dayCount={dateRange(tripStartDate, tripEndDate).length}
            />
```

(`tripStartDate: string` is already a prop of `ItineraryTab` — no new plumbing.)

- [ ] **Step 4: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: no errors. Watch for unused-import lint: the old skeleton-editing helpers (`withDay`, `groupPlaceEvents`, `CategoryEventList`, `EventRef`, and the `SkeletonDay`/`SkeletonEvent`/`SkeletonPlace`/`ItinerarySkeleton` type imports, and `draftItineraryForTrip`) are gone from this file by the rewrite; confirm none linger.

- [ ] **Step 5: In-app check (needs a logged-in session with the assistant on + an API key)**

Open a dated trip's Itinerary tab, press "Plan your itinerary". On Setup, type a place, press **Generate**: a sparse draft appears when you walk the five pages (some categories may be empty; no invented places). Walk Accommodation → Transportation → Activities → Food → Other with Next; edit a row's place/date; on the last page press **Apply**. The events appear in the itinerary under their places/dates. Then repeat pressing **Skip** (no AI): empty pages, add one item by hand, Apply — it lands. If you give a deliberately empty/thin setup, Generate may return one clarifying question on the setup screen; answering it and pressing again drafts.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/itinerary-planner.ts src/app/trips/[slug]/plan-itinerary.tsx src/app/trips/[slug]/itinerary-tab.tsx
git commit -m "feat(itinerary): category stepper for Plan-your-itinerary (5 pages, sparse draft, per-item place+date)"
```

---

## Task 4: Remove the dead old path + record the reshape

**Files:**
- Modify: `src/lib/ai/itinerary-actions.ts` (delete `draftItineraryForTrip` + `mergeEvents`)
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`

**Interfaces:** none produced; this removes now-unused code.

- [ ] **Step 1: Confirm the old action is unreferenced**

Run: `git grep -n "draftItineraryForTrip\|mergeEvents" -- src`
Expected: matches only inside `src/lib/ai/itinerary-actions.ts` (the definitions). If anything else references them, stop — a caller was missed in Task 3.

- [ ] **Step 2: Delete `draftItineraryForTrip` and `mergeEvents`**

In `src/lib/ai/itinerary-actions.ts`, remove the `mergeEvents` function (the `/** Overlay Claude's events ... */` block) and the entire `draftItineraryForTrip` function (the `/** Build the deterministic itinerary scaffold ... */` block). Keep `applyItinerarySkeleton` and `draftItineraryItems`.

Then remove the now-unused `DraftedItineraryEvent` type from the claude import, leaving:

```ts
import { draftItinerary } from "@/lib/ai/claude"
```

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: no errors, no unused-import warnings. (`planItinerarySkeleton` and `ItinerarySkeleton` are still used by `draftItineraryItems` and `applyItinerarySkeleton` respectively.)

- [ ] **Step 4: Record the reshape in the docs**

Add a dated entry to the top of `docs/TODO.md`'s completed log summarizing the reshape (category stepper, sparse+grounded draft, per-item place/date, clarifying-question path, staging-then-Apply approval invariant; reused seam/action/write-path; no migration/deps). Note the in-app AI round-trip is pending a logged-in session + key.

Append a `docs/DECISIONS.md` row:

```
| 2026-07-14 | Plan-your-itinerary reshaped from single-scroll to a 5-step category stepper (budget five); AI draft is sparse-by-design + grounded (no country->city leaps, no invention from trip name); staging area is a flat item list converted to a skeleton at Apply (reusing the write path); the draft seam may now return one clarifying question. | The scroll read as "the AI planned it for you" and over-reached; the stepper + sparse draft keep the human filling gaps, and Apply is the single approval to write. |
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/itinerary-actions.ts docs/TODO.md docs/DECISIONS.md
git commit -m "refactor(itinerary): drop the superseded single-scroll draft path; record reshape"
```

---

## Final verification

- [ ] `pnpm lint && pnpm build` clean on the final tree.
- [ ] Stepper walks Setup -> Accommodation -> Transportation -> Activities -> Food -> Other -> Apply; Back returns through the same pages to Setup.
- [ ] Generate produces a sparse, grounded draft (empty categories allowed, no invented places/dates); Skip gives empty pages; both Apply into the itinerary under the right places/dates.
- [ ] A thin setup can surface one clarifying question on the Setup screen; answering it then drafts.
- [ ] Suggest-only held: nothing is written to the itinerary until Apply; per-item `×` removes a proposal before it is committed.
- [ ] `docs/TODO.md` updated; `docs/DECISIONS.md` row added.

---

## Self-review

**Spec coverage:**
- Category-first walk, budget five, per-item optional place + date -> Task 3 (UI) + Task 1 (converter routing).
- Setup step, one upfront Generate, Skip -> Task 3 (`SetupStep`, `generate`, `skip`).
- Sparse draft + three grounding rules -> Task 2 (`ITINERARY_SYSTEM`).
- One clarifying question on Setup only -> Task 2 (`question` field + return) + Task 3 (`SetupStep` question block, at most one, skippable).
- Approval invariant (staging, Apply is the only write, per-item delete) -> Task 3 (`items` state, `apply`, `removeItem`); write path unchanged (Task 1 converter + existing `applyItinerarySkeleton`).
- Reuse seam/action/write-path, no migration/deps -> Tasks 1-2 reuse `draftItinerary`/`applyItinerarySkeleton`; Task 4 removes only the superseded merge path.
- Dated trips only, multi-day blocks stay in the editor -> unchanged mount (planning block is dated-only); stepper adds no span/move features.

**Placeholder scan:** none — every code step shows complete code; commands have expected output.

**Type consistency:** `DraftItem` (planner, Task 1) is the staging unit used by `draftItineraryItems` (Task 2) and the UI (Task 3); `itemsToSkeleton(items, placeNames, destination, startDate, dayCount)` signature matches its call in `apply` (Task 3); `draftItinerary` returns `{ events, question }` (Task 2) consumed by both `draftItineraryItems` (Task 2) and the patched `draftItineraryForTrip` line (Task 2, removed in Task 4); `PlanItinerary` gains `startDate: string`, passed at the mount (Task 3 Step 3).

**Build-green between tasks:** Task 2 patches the old `draftItineraryForTrip` to the new seam return so the old UI keeps compiling until Task 3 replaces it; the old action is only deleted in Task 4 after its last caller is gone.

