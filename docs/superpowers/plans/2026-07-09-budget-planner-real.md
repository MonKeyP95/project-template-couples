# Budget Planner — Real Claude Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deterministic mock in the budget drafter with a real Claude draft, so suggested line items and amounts reflect the trip's destination, itinerary, and profile.

**Architecture:** The interview structure stays deterministic (`planBudgetSteps`); only the seed content becomes AI. A new `draftBudgetSeeds` seam in `claude.ts` returns a flat list of drafted items; a new `draftBudget` server action builds the scaffold, loads trip context, calls the seam, and merges the items into buckets. The client drafter opens async, falling back to the deterministic scaffold on failure with a quiet note.

**Tech Stack:** Next.js 16 App Router, Server Actions, `@anthropic-ai/sdk` (already installed), Supabase (read-only here), TypeScript.

## Global Constraints

- **One AI seam.** All Claude calls live in `src/lib/ai/claude.ts`. Copied verbatim from CLAUDE.md.
- **Suggest-only.** Code under `lib/ai` never writes; the sole write is the existing `saveBudgetItems` behind the user's Apply.
- **AI-gated.** The drafter renders only with AI mode on (unchanged).
- **No new deps, no new vendor, no migration.**
- **No emojis** in code, prints, or logs.
- **No tests in this repo.** Validation gate for every task is `pnpm lint` then `pnpm build`, plus in-app verification for the UI task. Do not invent a test command.
- **European date order** for any displayed date (`en-GB`). No new dates are displayed in this slice.
- **Model:** use the existing `MODEL` constant (`claude-sonnet-4-6`) in `claude.ts`.

---

### Task 1: `draftBudgetSeeds` seam in `claude.ts`

**Files:**
- Modify: `src/lib/ai/claude.ts` (add a type + one exported async function + one tool)

**Interfaces:**
- Produces:
  - `interface DraftedBudgetItem { category: string; place: string; subject: string; whenLabel: string; amountEuros: number }`
  - `interface BudgetDraftContext { destination: string; tripDays: number; memberCount: number; locations: { name: string; nights: number; dateLabel: string | null }[]; vibe: string[]; brief: string; budgetBand: string }`
  - `async function draftBudgetSeeds(context: BudgetDraftContext): Promise<DraftedBudgetItem[]>`

- [ ] **Step 1: Add the tool, types, and function to `claude.ts`**

Append to `src/lib/ai/claude.ts` (after `discover`, at end of file). Reuse the existing `anthropic`, `MODEL`, and `Anthropic` import already at the top.

```ts
// Budget draft. Claude proposes concrete line items with realistic,
// destination-and-trip-aware amounts, filling the deterministic interview
// scaffold. Plain messages.create + a forced structured tool (no web_search — a
// budget is an estimate; parametric cost knowledge answers in one round-trip and
// web search tripled discovery latency for no gain). Suggest-only: returns data.

export interface DraftedBudgetItem {
  /** One of the five category labels: Accommodation, Transportation, Food, Activities, Other. */
  category: string
  /** An itinerary location name (for Accommodation/Activities), else empty (trip-wide). */
  place: string
  subject: string
  whenLabel: string
  /** Whole-euro estimate; never an exact quoted price. */
  amountEuros: number
}

export interface BudgetDraftContext {
  destination: string
  tripDays: number
  memberCount: number
  locations: { name: string; nights: number; dateLabel: string | null }[]
  vibe: string[]
  brief: string
  budgetBand: string
}

const BUDGET_TOOL: Anthropic.Messages.ToolUnion = {
  name: "propose_budget",
  description: "Return the drafted budget line items.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: {
              type: "string",
              enum: ["Accommodation", "Transportation", "Food", "Activities", "Other"],
              description: "Which budget category this line belongs to.",
            },
            place: {
              type: "string",
              description:
                "For Accommodation/Activities, the exact itinerary location name given. Empty for Transportation/Food/Other.",
            },
            subject: {
              type: "string",
              description: "Short label for the line, e.g. 'Riad in the medina'.",
            },
            whenLabel: {
              type: "string",
              description: "Short duration/when text, e.g. '3 nights' or '7 days'. May be empty.",
            },
            amountEuros: {
              type: "number",
              description: "Whole-euro estimate for the whole line (all members, whole stay). Never an exact quoted price.",
            },
          },
          required: ["category", "place", "subject", "whenLabel", "amountEuros"],
        },
      },
    },
    required: ["items"],
  },
}

const BUDGET_SYSTEM =
  "You draft a realistic trip budget for a couple or family. You never ask " +
  "questions or reply conversationally — you cannot receive a reply. You MUST " +
  "call propose_budget with concrete line items across the five categories " +
  "(Accommodation, Transportation, Food, Activities, Other). Estimate amounts " +
  "from real typical costs for the given destination, season, trip length, and " +
  "party size — a whole-euro figure per line covering the whole party and whole " +
  "stay. For Accommodation and Activities, set place to the exact itinerary " +
  "location name given, one or more lines per place. For Transportation, Food, " +
  "and Other, leave place empty. Weight the trip's stated style: a relaxed or " +
  "off-the-beaten-path brief is cheaper than a luxe one. Give a couple of " +
  "activity ideas per place; skip Other unless something obvious applies " +
  "(insurance, a buffer). Never quote an exact price."

function budgetPrompt(c: BudgetDraftContext): string {
  const list = (label: string, items: string[]) =>
    items.length ? `${label}: ${items.join(", ")}.` : ""
  const places = c.locations.length
    ? c.locations
        .map((l) => `${l.name} (${l.dateLabel ?? `${l.nights} nights`})`)
        .join("; ")
    : "no specific places listed"
  return [
    `Draft a budget for a ${c.tripDays}-day trip to ${c.destination} for ${c.memberCount} people.`,
    `Places in order: ${places}.`,
    c.budgetBand ? `The couple's usual spending level: ${c.budgetBand}.` : "",
    list("Trip vibe", c.vibe),
    c.brief ? `Trip brief: ${c.brief}.` : "",
  ]
    .filter(Boolean)
    .join(" ")
}

/** Real Claude budget draft. Returns [] if the model finishes without proposing. */
export async function draftBudgetSeeds(
  context: BudgetDraftContext,
): Promise<DraftedBudgetItem[]> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: BUDGET_SYSTEM,
    tools: [BUDGET_TOOL],
    tool_choice: { type: "tool", name: "propose_budget" },
    messages: [{ role: "user", content: budgetPrompt(context) }],
  })
  const proposal = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === "propose_budget",
  )
  if (!proposal) return []
  const input = proposal.input as { items?: DraftedBudgetItem[] }
  return input.items ?? []
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build succeeds (type-checks the new tool schema and function).

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/claude.ts
git commit -m "feat(budget): draftBudgetSeeds Claude seam (real budget draft)"
```

---

### Task 2: `draftBudget` server action + merge

**Files:**
- Create: `src/lib/ai/budget-actions.ts`

**Interfaces:**
- Consumes:
  - `draftBudgetSeeds`, `DraftedBudgetItem`, `BudgetDraftContext` from `@/lib/ai/claude` (Task 1)
  - `planBudgetSteps`, `type BudgetPlanInput`, `type BudgetStep`, `type SeedItem` from `@/lib/ai/budget-planner`
  - `getCurrentWorkspace` from `@/lib/workspace/queries`
  - `getTripBySlug` from `@/lib/trips/queries`
  - `getDiningPreferences` from `@/lib/preferences/dining-queries`
- Produces:
  - `async function draftBudget(input: BudgetPlanInput & { tripSlug: string }): Promise<{ steps: BudgetStep[]; drafted: boolean }>`

Note: `SeedItem` is exported from `budget-planner.ts` (`export interface SeedItem`). `BudgetStep.seed?: SeedItem[]` and `BudgetGroup.seed: SeedItem[]` are the fields the merge rewrites.

- [ ] **Step 1: Create `src/lib/ai/budget-actions.ts`**

```ts
"use server"

import {
  draftBudgetSeeds,
  type DraftedBudgetItem,
} from "@/lib/ai/claude"
import {
  planBudgetSteps,
  type BudgetPlanInput,
  type BudgetStep,
  type SeedItem,
} from "@/lib/ai/budget-planner"
import { getDiningPreferences } from "@/lib/preferences/dining-queries"
import { getTripBySlug } from "@/lib/trips/queries"
import { getCurrentWorkspace } from "@/lib/workspace/queries"

/** Category label -> step key, matching budget-planner's step keys. */
const STEP_KEY_BY_CATEGORY: Record<string, string> = {
  Accommodation: "accommodation",
  Transportation: "transport",
  Food: "food",
  Activities: "activities",
  Other: "other",
}

function toSeed(item: DraftedBudgetItem): SeedItem {
  return {
    subject: item.subject,
    when: item.whenLabel,
    suggestedCents: Math.round(Math.max(0, item.amountEuros) * 100),
  }
}

/** Overlay Claude's items onto the deterministic scaffold. A bucket that
 * receives >= 1 item has its seed replaced; a bucket with no items keeps its
 * mock seed. Grouped steps (Accommodation/Activities) match `place` to a group
 * by case-insensitive title; unmatched grouped items are dropped. */
function mergeSeeds(steps: BudgetStep[], items: DraftedBudgetItem[]): BudgetStep[] {
  // stepKey -> (groupTitleLower|"" ) -> SeedItem[]
  const byBucket = new Map<string, Map<string, SeedItem[]>>()
  for (const item of items) {
    const stepKey = STEP_KEY_BY_CATEGORY[item.category]
    if (!stepKey) continue
    const groupKey = item.place.trim().toLowerCase()
    const stepMap = byBucket.get(stepKey) ?? new Map<string, SeedItem[]>()
    const rows = stepMap.get(groupKey) ?? []
    rows.push(toSeed(item))
    stepMap.set(groupKey, rows)
    byBucket.set(stepKey, stepMap)
  }

  return steps.map((step) => {
    const stepMap = byBucket.get(step.key)
    if (!stepMap) return step
    if (step.groups) {
      const groups = step.groups.map((g) => {
        const rows = stepMap.get(g.title.trim().toLowerCase())
        return rows && rows.length ? { ...g, seed: rows } : g
      })
      return { ...step, groups }
    }
    // Flat step: gather all items for this step regardless of place.
    const rows = Array.from(stepMap.values()).flat()
    return rows.length ? { ...step, seed: rows } : step
  })
}

/** Build the deterministic interview scaffold, then overlay a real Claude draft.
 * On any failure returns the scaffold unchanged with drafted:false, so the
 * interview always opens. Suggest-only: reads context, writes nothing. */
export async function draftBudget(
  input: BudgetPlanInput & { tripSlug: string },
): Promise<{ steps: BudgetStep[]; drafted: boolean }> {
  const { tripSlug, ...planInput } = input
  const scaffold = planBudgetSteps(planInput)

  try {
    const workspace = await getCurrentWorkspace()
    if (!workspace) return { steps: scaffold, drafted: false }
    const trip = await getTripBySlug(workspace.id, tripSlug)
    if (!trip) return { steps: scaffold, drafted: false }
    const prefs = await getDiningPreferences(workspace.id)

    const items = await draftBudgetSeeds({
      destination: trip.country ?? planInput.tripName,
      tripDays: planInput.totalDays,
      memberCount: planInput.memberCount,
      locations: planInput.locations.map((l) => ({
        name: l.name,
        nights: l.nights,
        dateLabel: l.dateLabel,
      })),
      vibe: trip.tripProfile.vibe,
      brief: trip.tripProfile.brief,
      budgetBand: prefs.budgetBand,
    })

    if (items.length === 0) return { steps: scaffold, drafted: false }
    return { steps: mergeSeeds(scaffold, items), drafted: true }
  } catch {
    return { steps: scaffold, drafted: false }
  }
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/budget-actions.ts
git commit -m "feat(budget): draftBudget server action merges Claude draft into scaffold"
```

---

### Task 3: Wire the drafter to open async

**Files:**
- Modify: `src/app/trips/[slug]/budget-drafter.tsx`

**Interfaces:**
- Consumes: `draftBudget` from `@/lib/ai/budget-actions` (Task 2).
- `BudgetDrafterProps` already includes `tripSlug` — no prop changes; `budget-tab.tsx` unchanged.

The drafter currently imports `planBudgetSteps` and calls it synchronously in `open()`. Replace that path: `open()` becomes async, calls the action for a fresh draft (Plan a budget / Start over), and keeps the saved-items path (Edit budget) local with no AI call.

- [ ] **Step 1: Update imports**

Change the budget-planner import to drop `planBudgetSteps` (now only used server-side) and keep `estimateItemCents` + types; add the action import.

Replace:

```ts
import {
  estimateItemCents,
  planBudgetSteps,
  type BudgetGroup,
  type BudgetStep,
} from "@/lib/ai/budget-planner"
```

with:

```ts
import {
  estimateItemCents,
  type BudgetGroup,
  type BudgetStep,
} from "@/lib/ai/budget-planner"
import { draftBudget } from "@/lib/ai/budget-actions"
```

- [ ] **Step 2: Add loading + note state**

Below the existing `const [isPending, startTransition] = React.useTransition()` line, add:

```ts
  const [drafting, setDrafting] = React.useState(false)
  const [usedFallback, setUsedFallback] = React.useState(false)
```

- [ ] **Step 3: Make `open()` async and call the action for fresh drafts**

Replace the whole `open` function. The saved-items path (Edit budget) is unchanged and makes no AI call; the fresh path (Plan a budget / Start over) awaits `draftBudget` and uses the returned steps, setting the fallback note when `drafted` is false.

```ts
  async function open(fromScratch = false) {
    // Per-location nights + a human date label, from the itinerary days.
    const nightsByLoc: Record<string, number> = {}
    const datesByLoc: Record<string, string[]> = {}
    for (const d of itineraryDays) {
      if (d.locationId) {
        nightsByLoc[d.locationId] = (nightsByLoc[d.locationId] ?? 0) + 1
        ;(datesByLoc[d.locationId] ??= []).push(d.dayDate)
      }
    }
    const locInput = locations.map((l) => ({
      id: l.id,
      name: l.name,
      nights: nightsByLoc[l.id] ?? 0,
      dateLabel: locationDateLabel(l.startDate, l.endDate, datesByLoc[l.id] ?? []),
    }))

    const planInput = { tripName, totalDays, memberCount, locations: locInput }
    const saved = fromScratch ? null : serverToSaved(initialItems)

    // Edit budget: restore saved rows, no AI call.
    if (saved && Object.keys(saved).length > 0) {
      const steps = buildScaffold(planInput)
      seedSession(steps, saved)
      setUsedFallback(false)
      return
    }

    // Plan a budget / Start over: draft with Claude.
    setDrafting(true)
    setUsedFallback(false)
    try {
      const { steps, drafted } = await draftBudget({ ...planInput, tripSlug })
      setUsedFallback(!drafted)
      seedSession(steps, null)
    } finally {
      setDrafting(false)
    }
  }
```

- [ ] **Step 4: Add `buildScaffold` + `seedSession` helpers**

The old `open()` inlined step-building and row-seeding. Task 3 splits them so both the saved path and the drafted path share the same row-seeding, and the saved path can build a local scaffold without an AI call.

`buildScaffold` needs the deterministic structure locally for the Edit-budget path. Rather than re-import `planBudgetSteps` (server-side now), the Edit path uses the scaffold **shape returned by the action is not needed** — instead, for Edit we already have the steps from a fresh draft the first time; but Edit must work offline. Import a client-safe scaffold builder: `planBudgetSteps` is a pure function with no server deps, so it is safe to import in the client too. Re-add it to the import for this local use.

Revert Step 1's import to keep `planBudgetSteps`:

```ts
import {
  estimateItemCents,
  planBudgetSteps,
  type BudgetGroup,
  type BudgetStep,
} from "@/lib/ai/budget-planner"
import { draftBudget } from "@/lib/ai/budget-actions"
```

Then add these two helpers inside the component, above `open`:

```ts
  function buildScaffold(planInput: {
    tripName: string
    totalDays: number
    memberCount: number
    locations: { id: string; name: string; nights: number; dateLabel: string | null }[]
  }): BudgetStep[] {
    return planBudgetSteps(planInput)
  }

  function seedSession(steps: BudgetStep[], saved: SavedItems | null) {
    const items: Record<string, ItemRow[]> = {}
    for (const step of steps) {
      for (const { bucketId, group } of stepBuckets(step)) {
        const seed = group ? group.seed : step.seed ?? []
        const savedRows = saved?.[bucketId]
        items[bucketId] = savedRows
          ? savedRows.map((r) => newRow(r.subject, r.when, r.value))
          : seed.map((s) =>
              newRow(
                s.subject,
                s.when,
                s.suggestedCents != null ? fmt(s.suggestedCents) : "",
              ),
            )
      }
    }
    setError(null)
    setStepIndex(0)
    setSession({ steps, items })
  }
```

(Design note: the drafted path passes `saved = null` so it seeds from the steps' AI seeds; the Edit path passes the saved rows. `planBudgetSteps` stays imported client-side for the offline Edit scaffold — it is pure, no server import, so the bundle is unaffected.)

- [ ] **Step 5: Make the launcher buttons async-aware**

In the `if (!session)` block, disable the buttons while drafting and show progress. Replace the two buttons' `onClick` and label handling:

```tsx
  if (!session) {
    return (
      <div className="flex items-center justify-between border-t border-border px-5 pt-4 pb-2">
        <button
          type="button"
          onClick={() => open()}
          disabled={drafting}
          className="rounded-full border border-border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {drafting
            ? "drafting…"
            : plannedBudgetCents > 0
              ? "Edit budget"
              : "Plan a budget"}
        </button>
        {plannedBudgetCents > 0 ? (
          <button
            type="button"
            onClick={() => open(true)}
            disabled={drafting}
            className="rounded-full border border-dashed border-border bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Start over
          </button>
        ) : null}
      </div>
    )
  }
```

- [ ] **Step 6: Show the quiet fallback note in the interview**

In `renderStep`, directly under the `step.hint` block, add the fallback note so it shows during the drafted interview when the model could not be reached:

```tsx
        {usedFallback ? (
          <div className="mt-1 font-mono text-[10px] leading-snug tracking-[0.06em] text-clay">
            couldn&apos;t reach the assistant — using rough estimates
          </div>
        ) : null}
```

- [ ] **Step 7: Lint**

Run: `pnpm lint`
Expected: no errors. (React 19 lint gotchas: the note uses `couldn&apos;t` and `—` as plain JSX text, both fine; no `// ` literal text; no `useEffect` reset.)

- [ ] **Step 8: Build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 9: In-app verification**

Run `pnpm dev`, open a trip with AI mode ON, go to the Budget tab, in the Saved+planned card:
1. With no planned budget, click **Plan a budget** -> button shows "drafting…", then the interview opens with concrete, destination-plausible line items and amounts (not flat 110/150/25). Walk to review, Apply. Confirm the planned total persists.
2. Click **Start over** -> drafts fresh again.
3. Click **Edit budget** (now that a budget is saved) -> opens instantly from saved rows, no "drafting…", no note.
4. Fallback: temporarily unset `ANTHROPIC_API_KEY` (or rely on a forced error), click Plan a budget -> interview still opens with mock seeds and the clay "using rough estimates" note. Restore the key.

Expected: all four behave as described.

- [ ] **Step 10: Commit**

```bash
git add src/app/trips/[slug]/budget-drafter.tsx
git commit -m "feat(budget): drafter opens async via draftBudget, fallback note"
```

---

### Task 4: Docs

**Files:**
- Modify: `docs/TODO.md` (add a shipped entry at the top of the running log)
- Modify: `docs/DECISIONS.md` (append a row: budget draft uses no web_search, parametric estimates)

- [ ] **Step 1: Add the TODO entry**

At the top of the running-log section in `docs/TODO.md`, add a paragraph in the house style summarizing: budget planner made real (Claude via `draftBudgetSeeds` in `claude.ts`, forced `propose_budget` tool, no web_search); new `draftBudget` action merges into the deterministic `planBudgetSteps` scaffold; client opens async with a fallback note; Edit-budget path unchanged (no AI call); suggest-only, AI-gated, no migration/deps. Reference the spec and this plan.

- [ ] **Step 2: Add the DECISIONS row**

Append a dated row (2026-07-09) to `docs/DECISIONS.md`: "Budget draft uses parametric Claude estimates, not web_search — a budget is an estimate; web search tripled discovery latency (2026-07-07) for no gain here. Live web-grounded prices deferred."

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record real budget-planner slice"
```

---

## Self-Review

**Spec coverage:**
- Deterministic scaffold, AI content -> Task 2 merge keeps `planBudgetSteps` structure, replaces seeds only. ✓
- `draftBudgetSeeds` seam, no web_search, structured tool -> Task 1. ✓
- Context: destination/locations/tripDays/memberCount/vibe/brief/budgetBand -> Task 1 `BudgetDraftContext`, populated in Task 2. ✓
- `draftBudget` action, fallback on failure -> Task 2 try/catch returns scaffold + `drafted:false`. ✓
- Client async open, loading state, Edit-budget no AI call, quiet note -> Task 3. ✓
- `estimateItemCents` stays deterministic -> untouched in Task 3. ✓
- Invariants (one seam, suggest-only, AI-gated, no migration/deps) -> honored across tasks; Apply write unchanged. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:**
- `DraftedBudgetItem` / `BudgetDraftContext` defined Task 1, consumed Task 2. ✓
- `SeedItem` fields (`subject`, `when`, `suggestedCents`) match `budget-planner.ts`. ✓
- Category labels in Task 1 tool enum match `STEP_KEY_BY_CATEGORY` keys in Task 2 (Accommodation/Transportation/Food/Activities/Other) and `CATEGORY_BY_STEP` in the drafter. ✓
- `draftBudget` return `{ steps, drafted }` matches Task 3 destructure. ✓
- `SavedItems` type used by `seedSession` is already defined in `budget-drafter.tsx`. ✓

**Note on Task 3 import:** Step 1 tentatively drops `planBudgetSteps`, Step 4 restores it for the offline Edit scaffold. Net state after Task 3: `planBudgetSteps` remains imported (pure, client-safe) and `draftBudget` is added. Implement Step 4's import block as the final import state.
