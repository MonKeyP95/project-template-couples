# Budget-learning Slice 3 (raise-the-buffer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface one deterministic "raise-the-buffer" budget flag in a trip's Budget-tab assistant block when a category chronically overran on past trips and this trip under-budgets it again; tapping `help` prefills the chat with the numbers.

**Architecture:** A pure detector (`src/lib/nudges/raise-the-buffer.ts`) reads this trip's per-category plan plus the workspace's other started trips' slice-1/2 rollups (reused `getTripRollups`) and returns a `Nudge | null`. The `/trips/[slug]` server page computes it and threads it into the existing `<AssistantBlock nudge=... />` slot. The nudge's `help` carries a `seed` string that prefills the chat input; nothing is sent to Claude until the couple presses send.

**Tech Stack:** Next.js 16 App Router (Server Components), React 19, TypeScript. No test runner — pure logic validated with a throwaway `tsx` script; UI validated by `pnpm build`/`pnpm lint` + in-app.

## Global Constraints

- **No new AI seam / no migration.** `claude.ts`, `generateSuggestion`, `sendChatMessage` unchanged; no SQL.
- **Token control.** Detection + flag line are deterministic (zero Claude calls); Claude fires only on an explicit chat *send*.
- **Numbers are the artifact.** The detector only reads planned/actual; it never writes them.
- **Reuse the existing rollup artifact.** Use `getTripRollups` / `perCategoryRollup` / `TripRollupInput`; do not build a parallel budget store.
- **No emojis; sparse comments; short functions.** European date order is irrelevant here (no dates rendered).
- **Money copy:** whole euros, `€{n}` (e.g. `+€110`), matching existing budget nudge formatting.
- Package manager is `pnpm`. Commit after each task.

---

### Task 1: Pure detector + `seed` on `NudgeHelp`

**Files:**
- Modify: `src/lib/nudges/types.ts` (add `seed` to `NudgeHelp`; add `RaiseTheBufferContext`)
- Create: `src/lib/nudges/raise-the-buffer.ts`
- Test: `scratch/raise-check.ts` (throwaway; deleted in Step 6)

**Interfaces:**
- Consumes: `Nudge`, `NudgeHelp` (`src/lib/nudges/types.ts`); `TripRollupInput` (`src/lib/trips/budget-history-types.ts`) whose `.rollup` is `CategoryRollup[]` = `{ category, plannedCents, actualCents }`.
- Produces: `detectRaiseTheBuffer(ctx: RaiseTheBufferContext): Nudge | null`, where
  `RaiseTheBufferContext = { thisTripPlan: Record<string, number>; pastRollups: TripRollupInput[] }`.

- [ ] **Step 1: Add `seed` to `NudgeHelp` and the context type**

In `src/lib/nudges/types.ts`, change the `NudgeHelp` type and append the new context type. Replace:

```ts
/** An optional token-spending action a nudge offers; only runs when tapped. */
export type NudgeHelp = {
  label: string
}
```

with:

```ts
/** An optional token-spending action a nudge offers; only runs when tapped.
 * `seed`, when present, prefills the assistant chat input with a drafted
 * question so the couple can send it (or edit it first). */
export type NudgeHelp = {
  label: string
  seed?: string
}
```

Then add at the end of the file:

```ts
export type RaiseTheBufferContext = {
  /** This trip's planned cents per category (summed budget items). */
  thisTripPlan: Record<string, number>
  /** Other started trips' rollups (excludes this trip). */
  pastRollups: import("@/lib/trips/budget-history-types").TripRollupInput[]
}
```

- [ ] **Step 2: Write the throwaway test (expect failure)**

Create `scratch/raise-check.ts`:

```ts
import assert from "node:assert"
import { detectRaiseTheBuffer } from "../src/lib/nudges/raise-the-buffer"
import type { TripRollupInput } from "../src/lib/trips/budget-history-types"

function trip(id: string, planned: number, actual: number): TripRollupInput {
  return {
    tripId: id,
    tripName: id,
    startDate: "2025-01-01",
    dayCount: 5,
    rollup: [{ category: "Activities", plannedCents: planned, actualCents: actual }],
  }
}

// Fires: 2 past overruns (avg +€100 >= €50 floor), this trip plans €150 < avg past actual €300.
const fire = detectRaiseTheBuffer({
  thisTripPlan: { Activities: 15000 },
  pastRollups: [trip("a", 20000, 30000), trip("b", 20000, 30000)],
})
assert(fire, "should fire")
assert(fire.id === "raise-the-buffer:Activities", fire.id)
assert(/Activities ran over on 2 of your last 2 trips/.test(fire.text), fire.text)
assert(/avg \+€100/.test(fire.text), fire.text)
assert(fire.help?.seed?.includes("€150"), fire.help?.seed)

// No fire: only 1 overrun.
assert(
  detectRaiseTheBuffer({
    thisTripPlan: { Activities: 15000 },
    pastRollups: [trip("a", 20000, 30000), trip("b", 20000, 10000)],
  }) === null,
  "one overrun should not fire",
)

// No fire: this trip already budgets >= avg past actual.
assert(
  detectRaiseTheBuffer({
    thisTripPlan: { Activities: 40000 },
    pastRollups: [trip("a", 20000, 30000), trip("b", 20000, 30000)],
  }) === null,
  "generous plan should not fire",
)

// No fire: overrun below the €50 floor.
assert(
  detectRaiseTheBuffer({
    thisTripPlan: { Activities: 15000 },
    pastRollups: [trip("a", 20000, 22000), trip("b", 20000, 22000)],
  }) === null,
  "small overrun should not fire",
)

// No fire: category not planned on this trip.
assert(
  detectRaiseTheBuffer({
    thisTripPlan: { Food: 10000 },
    pastRollups: [trip("a", 20000, 30000), trip("b", 20000, 30000)],
  }) === null,
  "unplanned category should not fire",
)

console.log("ok")
```

- [ ] **Step 3: Run it, expect failure (module not found)**

Run: `npx tsx scratch/raise-check.ts`
Expected: FAIL — cannot find module `../src/lib/nudges/raise-the-buffer`.

- [ ] **Step 4: Implement the detector**

Create `src/lib/nudges/raise-the-buffer.ts`:

```ts
import type { Nudge } from "@/lib/nudges/types"
import type { TripRollupInput } from "@/lib/trips/budget-history-types"
import type { RaiseTheBufferContext } from "@/lib/nudges/types"

/** Minimum average overrun (cents) for a chronic category to be worth flagging. */
const RAISE_MIN_OVERRUN_CENTS = 5000
/** Minimum number of past trips that overran the category. */
const RAISE_MIN_OVERRUNS = 2

const eur = (cents: number) => Math.round(cents / 100)

type Candidate = {
  category: string
  overruns: number // n
  budgetedTrips: number // m
  avgOverrunCents: number
  avgPastActualCents: number
  thisPlanCents: number
}

/**
 * Cross-trip planning flag: a category that chronically ran over plan on past
 * trips and is under-budgeted again this trip. Picks the single worst category
 * (largest average overrun) or returns null when none qualify. Deterministic;
 * reads only, writes nothing.
 */
export function detectRaiseTheBuffer(ctx: RaiseTheBufferContext): Nudge | null {
  const candidates: Candidate[] = []

  for (const [category, thisPlanCents] of Object.entries(ctx.thisTripPlan)) {
    if (thisPlanCents <= 0) continue

    const budgeted = ctx.pastRollups
      .map((t) => t.rollup.find((r) => r.category === category))
      .filter((r): r is NonNullable<typeof r> => !!r && r.plannedCents > 0)
    if (budgeted.length === 0) continue

    const overran = budgeted.filter((r) => r.actualCents > r.plannedCents)
    if (overran.length < RAISE_MIN_OVERRUNS) continue

    const avgOverrunCents = Math.round(
      overran.reduce((s, r) => s + (r.actualCents - r.plannedCents), 0) /
        overran.length,
    )
    if (avgOverrunCents < RAISE_MIN_OVERRUN_CENTS) continue

    const avgPastActualCents = Math.round(
      budgeted.reduce((s, r) => s + r.actualCents, 0) / budgeted.length,
    )
    if (thisPlanCents >= avgPastActualCents) continue

    candidates.push({
      category,
      overruns: overran.length,
      budgetedTrips: budgeted.length,
      avgOverrunCents,
      avgPastActualCents,
      thisPlanCents,
    })
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.avgOverrunCents - a.avgOverrunCents)
  const c = candidates[0]

  return {
    id: `raise-the-buffer:${c.category}`,
    text: `${c.category} ran over on ${c.overruns} of your last ${c.budgetedTrips} trips (avg +€${eur(c.avgOverrunCents)}). Consider a bigger ${c.category} buffer.`,
    help: {
      label: "how much?",
      seed: `${c.category} ran over on ${c.overruns} of our last ${c.budgetedTrips} trips (avg +€${eur(c.avgOverrunCents)}) and we've budgeted €${eur(c.thisPlanCents)} this time. How much should we set aside?`,
    },
  }
}
```

- [ ] **Step 5: Run the test, expect pass**

Run: `npx tsx scratch/raise-check.ts`
Expected: prints `ok`.

- [ ] **Step 6: Delete the throwaway, lint, build**

```bash
rm scratch/raise-check.ts
pnpm lint
pnpm build
```
Expected: lint + build clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/nudges/types.ts src/lib/nudges/raise-the-buffer.ts
git commit -m "feat(budget): raise-the-buffer detector (slice 3 pure layer)"
```

---

### Task 2: Prefill the chat from the nudge's `help` seed

**Files:**
- Modify: `src/components/assistant-block.tsx`

**Interfaces:**
- Consumes: `Nudge.help.seed` (Task 1); existing `NudgeLine({ nudge, onHelp })` which already renders the help button when `nudge.help && onHelp` are both present (`nudge-line.tsx:17`).
- Produces: `AssistantBlock` seeds the chat input on a nudge help tap. `AskLine` gains an optional `initialInput?: string`.

- [ ] **Step 1: Give `AskLine` an initial input value**

In `src/components/assistant-block.tsx`, change the `AskLine` signature and its `input` state. Replace:

```tsx
function AskLine({ tripSlug }: { tripSlug?: string }) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState("")
```

with:

```tsx
function AskLine({
  tripSlug,
  initialInput,
}: {
  tripSlug?: string
  initialInput?: string
}) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState(initialInput ?? "")
```

- [ ] **Step 2: Hold a seed in `AssistantBlock` and remount `AskLine` when it changes**

In `AssistantBlock`, add seed state right after the `useAiMode()` line. Replace:

```tsx
  const { enabled, setEnabled } = useAiMode()
  return (
```

with:

```tsx
  const { enabled, setEnabled } = useAiMode()
  const [chatSeed, setChatSeed] = React.useState<string | null>(null)
  return (
```

- [ ] **Step 3: Wire the nudge's help to set the seed**

Replace the nudge block:

```tsx
          {nudge ? (
            <>
              <Divider />
              <div className="px-4 py-3">
                <NudgeLine nudge={nudge} />
              </div>
            </>
          ) : null}
```

with:

```tsx
          {nudge ? (
            <>
              <Divider />
              <div className="px-4 py-3">
                <NudgeLine
                  nudge={nudge}
                  onHelp={
                    nudge.help?.seed
                      ? () => setChatSeed(nudge.help!.seed!)
                      : undefined
                  }
                />
              </div>
            </>
          ) : null}
```

- [ ] **Step 4: Remount `AskLine` with the seed**

Replace:

```tsx
          <div className="px-4 py-3">
            <AskLine tripSlug={tripSlug} />
          </div>
```

with:

```tsx
          <div className="px-4 py-3">
            <AskLine
              key={chatSeed ?? "chat"}
              tripSlug={tripSlug}
              initialInput={chatSeed ?? ""}
            />
          </div>
```

(Changing `key` remounts `AskLine` so its `input` re-initializes to the seed — no `useEffect`, per the repo's edit-in-place rule.)

- [ ] **Step 5: Lint + build**

```bash
pnpm lint
pnpm build
```
Expected: clean. (No default-behavior change: with no nudge, or a nudge without `help.seed`, `AskLine` renders `key="chat"` / empty input exactly as before.)

- [ ] **Step 6: Commit**

```bash
git add src/components/assistant-block.tsx
git commit -m "feat(budget): seed assistant chat from a nudge help tap (slice 3)"
```

---

### Task 3: Compute the nudge on the trip page and thread it to the Budget tab

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx`
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

**Interfaces:**
- Consumes: `detectRaiseTheBuffer` (Task 1); `getTripRollups` (`src/lib/trips/budget-history-queries.ts`); the existing `navTrips = await listTripsForWorkspace(workspace.id)` and `budgetItems` on the page; `AssistantBlock`'s existing `nudge?: Nudge | null` prop.
- Produces: `BudgetTab` gains a `budgetNudge?: Nudge | null` prop, passed to its `<AssistantBlock nudge=... />`.

- [ ] **Step 1: Import the detector and query on the page**

In `src/app/trips/[slug]/page.tsx`, add after the existing `detectWeatherPacking` import (line 36):

```tsx
import { detectRaiseTheBuffer } from "@/lib/nudges/raise-the-buffer"
import { getTripRollups } from "@/lib/trips/budget-history-queries"
```

- [ ] **Step 2: Compute the nudge (budget tab only), after `navTrips`**

In `page.tsx`, the block that computes `navTrips` / `navDestinations` is around lines 214-218. Immediately after `navDestinations` is assigned, add:

```tsx
  const budgetNudge =
    activeTab === "budget"
      ? detectRaiseTheBuffer({
          thisTripPlan: (budgetItems ?? []).reduce<Record<string, number>>(
            (acc, it) => {
              acc[it.category] = (acc[it.category] ?? 0) + it.amountCents
              return acc
            },
            {},
          ),
          pastRollups: await getTripRollups(
            [...navTrips.now, ...navTrips.past].filter((t) => t.id !== header.id),
          ),
        })
      : null
```

(`getTripRollups` only runs on the Budget tab, so other tabs pay nothing. It itself skips undated trips and batches its reads.)

- [ ] **Step 3: Pass the nudge into `BudgetTab`**

In the `activeTab === "budget"` branch, add the prop to the `<BudgetTab ... />` element (after `currentUserId={userData.user.id}`):

```tsx
            currentUserId={userData.user.id}
            budgetNudge={budgetNudge}
```

- [ ] **Step 4: Accept and forward the prop in `BudgetTab`**

In `src/app/trips/[slug]/budget-tab.tsx`:

Add the import near the other imports (after line 18, the `location-types` import):

```tsx
import type { Nudge } from "@/lib/nudges/types"
```

Add to `BudgetTabProps` (after `currentUserId: string`):

```tsx
  currentUserId: string
  budgetNudge?: Nudge | null
```

Add `budgetNudge` to the destructured params (after `currentUserId,`):

```tsx
  currentUserId,
  budgetNudge,
}: BudgetTabProps) {
```

- [ ] **Step 5: Pass it to `AssistantBlock`**

Replace the Budget-tab `AssistantBlock` usage:

```tsx
        <AssistantBlock
          surface="budget"
          tripSlug={tripSlug}
          door={
```

with:

```tsx
        <AssistantBlock
          surface="budget"
          tripSlug={tripSlug}
          nudge={budgetNudge}
          door={
```

- [ ] **Step 6: Lint + build**

```bash
pnpm lint
pnpm build
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/trips/[slug]/page.tsx src/app/trips/[slug]/budget-tab.tsx
git commit -m "feat(budget): surface raise-the-buffer flag on the Budget tab (slice 3)"
```

---

## In-app verification (after Task 3)

On a workspace with **>= 2 finished (started) trips** that overran a category (e.g. Activities budgeted €200, spent €300 on two past trips), open a newer trip whose Budget tab under-budgets that category (plan €150). Expand the Budget-tab assistant block:
- The raise-the-buffer flag shows with correct `n`/`m` and `avg +€…`.
- Tap `how much?` → the chat input is prefilled with the numbers-laden draft.
- Send it → Claude replies reasoning over the numbers; **no stored amount changes**.
- On a workspace with no chronic overrun (or a generous plan), no flag shows; other tabs are unaffected.

## Self-review notes

- Spec coverage: detector (Task 1), token-safe help/seed path (Tasks 1-2), planning-surface plumbing (Task 3), non-goals untouched (no on-the-road detector, no apply-to-plan, no AI seam, no migration). ✔
- The two fast-follow detectors (`over-on-a-category`, `cheaper-than-usual`) are intentionally **not** in this plan; they reuse the same `Nudge.help.seed` harness built in Tasks 1-2.
