# Profile-growth slice 3 — Accommodation & Transport from expenses — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the learned couple profile to its two empty categories — Accommodation and Transport — which learn from the titles of the real expenses logged in those two budget categories.

**Architecture:** A new `used` `TasteSignal` kind sourced from the `expenses` table (title text, never amount; settlements skipped), scoped to accommodation/transport only. It flows through the existing summariser pipeline (`gatherTasteSignals` -> `summarizeTaste` -> `couple_summaries`/`trip_summaries`) and renders through the existing `LearnedSummary` component on both `/profile` surfaces. No new tables, no migration, no deps.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), TypeScript 5, Supabase (`@supabase/ssr`), Anthropic SDK (`summarizeTaste`), Tailwind v4.

## Global Constraints

- No new dependencies, no migration, no schema change. Reuse `expenses`, `couple_summaries`, `trip_summaries`.
- No emojis in code, prints, or logs.
- Read expense **titles only, never `amount_cents`.** Skip rows where `is_settlement = true`.
- Food and Activity signal gathering must stay **byte-identical** — the new source is scoped to accommodation/transport.
- Suggest-only: the summariser returns text; callers persist. No writes added anywhere.
- Sparse comments; clear names; short functions. Follow existing file patterns.
- This repo has **no test framework**. Each task's verification is `pnpm lint` + `pnpm build` clean; the feature is confirmed by the final in-app task. Do not invent a test runner.
- Commit after each task with a clear message.

---

### Task 1: Types + summariser learn the `used` signal

Widen the learned category to four, add the `used` signal kind and its category mapping, and teach `summarizeTaste` to format and weight `used` lines and to name the two new categories. This lands together so the codebase still type-checks: widening `LearnedCategory` while `summarizeTaste` still takes the 2-valued `DiscoveryCategory` would break the action call sites, so both change in one task.

**Files:**
- Modify: `src/lib/preferences/couple-summary-types.ts`
- Modify: `src/lib/ai/claude.ts:86-131` (`signalToLine`, `summarizeTaste`) and the import at `src/lib/ai/claude.ts:11`

**Interfaces:**
- Produces: `LearnedCategory = "food" | "activity" | "accommodation" | "transport"`; `TasteSignal.kind` includes `"used"`; `learnedCategoryToExpenseName(category: LearnedCategory): string | null`; `summarizeTaste(category: LearnedCategory, currentSummaryMd: string, signals: TasteSignal[]): Promise<string>`.

- [ ] **Step 1: Widen `LearnedCategory` and the signal kind**

In `src/lib/preferences/couple-summary-types.ts`, change the type alias and the `TasteSignal` interface:

```ts
export type LearnedCategory = "food" | "activity" | "accommodation" | "transport"
```

```ts
export interface TasteSignal {
  text: string
  kind: "rated" | "planned" | "wanted" | "used"
  /** Present only when kind === "rated" (1-5). */
  rating?: number
  /** Free note captured with a rating; absent otherwise. */
  note?: string
}
```

- [ ] **Step 2: Add the category -> expense-name map**

Append to `src/lib/preferences/couple-summary-types.ts`:

```ts
/** The budget expense-category name whose real expenses feed a learned category,
 * for the two categories that learn from actual spending. Food/Activity return
 * null — they learn from ratings/plans/detail tags, not expenses. */
export function learnedCategoryToExpenseName(
  category: LearnedCategory,
): string | null {
  if (category === "accommodation") return "Accommodation"
  if (category === "transport") return "Transportation"
  return null
}
```

- [ ] **Step 3: Import `LearnedCategory` into `claude.ts`**

Change `src/lib/ai/claude.ts:11` from:

```ts
import type { TasteSignal } from "@/lib/preferences/couple-summary-types"
```

to:

```ts
import type {
  LearnedCategory,
  TasteSignal,
} from "@/lib/preferences/couple-summary-types"
```

- [ ] **Step 4: Format the `used` line in `signalToLine`**

In `src/lib/ai/claude.ts`, replace the final line of `signalToLine` (currently `return `- ${s.text} · wanted``) so both `used` and `wanted` are handled:

```ts
function signalToLine(s: TasteSignal): string {
  if (s.kind === "rated") {
    const note = s.note ? ` · ${s.note}` : ""
    return `- ${s.text} · rated ${s.rating}/5${note}`
  }
  if (s.kind === "planned") return `- ${s.text} · planned (not rated)`
  if (s.kind === "used") return `- ${s.text} · booked & paid on a trip (real)`
  return `- ${s.text} · wanted`
}
```

- [ ] **Step 5: Add the four-category noun map and retype `summarizeTaste`**

In `src/lib/ai/claude.ts`, add a noun map above `summarizeTaste` and rewrite the function's signature/noun/prompt. Replace the current `summarizeTaste` (lines ~95-131) with:

```ts
const LEARNED_NOUN: Record<LearnedCategory, string> = {
  food: "food",
  activity: "activities",
  accommodation: "places to stay",
  transport: "ways of getting around",
}

export async function summarizeTaste(
  category: LearnedCategory,
  currentSummaryMd: string,
  signals: TasteSignal[],
): Promise<string> {
  const noun = LEARNED_NOUN[category]
  const lines = signals.map(signalToLine).join("\n")
  const current = currentSummaryMd.trim()
    ? `Their current ${noun} summary (may include their own hand-edits — respect ` +
      `them):\n\n${currentSummaryMd.trim()}`
    : `They have no ${noun} summary yet.`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content:
          `A couple leaves signals about their ${noun} across their trips: places ` +
          `they rated, places they planned but never rated, things they said they ` +
          `wanted, and places or modes they actually booked and paid for. ${current}\n\n` +
          `Here are the signals:\n${lines}\n\n` +
          `Weight rated highest and actually-booked ("booked & paid") next as real ` +
          `behaviour; treat "planned" and "wanted" as lighter hints about direction. ` +
          `Write a short markdown summary (a few bullet points) of what this couple ` +
          `likes and dislikes in ${noun}. Evolve the current summary rather than ` +
          `discarding it; keep any hand-edits that still hold. Return only the ` +
          `markdown, no preamble.`,
      },
    ],
  })
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim()
}
```

Leave the `DiscoveryCategory` import and every discovery function unchanged — only `summarizeTaste` switches to `LearnedCategory`.

- [ ] **Step 6: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: both clean. (The action call sites `summarizeTaste(category, ...)` in `couple-summary-actions.ts` now type-check because `category` there is already `LearnedCategory`.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/preferences/couple-summary-types.ts src/lib/ai/claude.ts
git commit -m "feat(profile): learned summaries gain the four categories + used signal"
```

---

### Task 2: Gather the `used` signal from expenses

Add the workspace- and trip-scoped expense gathers and fold them into the existing corpus builders. Because the gather returns `[]` for food/activity, folding it in unconditionally keeps their behaviour byte-identical. Extend the per-trip block builder to all four categories.

**Files:**
- Modify: `src/lib/preferences/couple-summary-queries.ts`

**Interfaces:**
- Consumes: `learnedCategoryToExpenseName` (Task 1); `LearnedCategory`, `TasteSignal` (Task 1).
- Produces: unchanged public signatures of `gatherTasteSignals` / `gatherTripTasteSignals` / `countSignals` / `countTripSignals` / `getTripLearnedBlocks` — now returning accommodation/transport signals too.

- [ ] **Step 1: Import the category -> name map**

In `src/lib/preferences/couple-summary-queries.ts`, add `learnedCategoryToExpenseName` to the existing import from `./couple-summary-types`:

```ts
import {
  inferRatingCategory,
  learnedCategoryToExpenseName,
  RATING_FLOOR,
  type LearnedCategory,
  type TasteSignal,
} from "./couple-summary-types"
```

- [ ] **Step 2: Add the workspace-scoped expense gather**

Add after `gatherWantedSignals` (before `gatherTasteSignals`):

```ts
/** Real expenses in the category's budget bucket (Accommodation / Transportation)
 * — a "we actually booked this" signal. Reads the title text, never the amount;
 * skips settlement rows. Returns [] for categories that do not learn from
 * expenses (food, activity). */
async function gatherSpentSignals(
  workspaceId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const name = learnedCategoryToExpenseName(category)
  if (!name) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from("expenses")
    .select("title, trips!inner(workspace_id)")
    .eq("trips.workspace_id", workspaceId)
    .eq("category", name)
    .eq("is_settlement", false)
  return (data ?? []).map((r) => ({
    text: (r as { title: string }).title,
    kind: "used" as const,
  }))
}
```

- [ ] **Step 3: Fold it into `gatherTasteSignals`**

Replace the body of `gatherTasteSignals`:

```ts
/** The full corpus for a category: rated + planned + wanted + used (used is only
 * non-empty for accommodation/transport). */
export async function gatherTasteSignals(
  workspaceId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const [rated, planned, wanted, used] = await Promise.all([
    gatherRatingSignals(workspaceId, category),
    gatherPlannedSignals(workspaceId, category),
    gatherWantedSignals(workspaceId, category),
    gatherSpentSignals(workspaceId, category),
  ])
  return [...rated, ...planned, ...wanted, ...used]
}
```

- [ ] **Step 4: Add the trip-scoped expense gather**

Add after `gatherTripWantedSignals` (before `gatherTripTasteSignals`):

```ts
/** Real expenses on one trip in the category's budget bucket (title only, no
 * amount; settlements skipped). Empty for food/activity. */
async function gatherTripSpentSignals(
  tripId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const name = learnedCategoryToExpenseName(category)
  if (!name) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from("expenses")
    .select("title")
    .eq("trip_id", tripId)
    .eq("category", name)
    .eq("is_settlement", false)
  return (data ?? []).map((r) => ({
    text: (r as { title: string }).title,
    kind: "used" as const,
  }))
}
```

- [ ] **Step 5: Fold it into `gatherTripTasteSignals`**

Replace the body of `gatherTripTasteSignals`:

```ts
/** The full corpus for one trip + category: rated + planned + wanted + used. */
export async function gatherTripTasteSignals(
  tripId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const [rated, planned, wanted, used] = await Promise.all([
    gatherTripRatingSignals(tripId, category),
    gatherTripPlannedSignals(tripId, category),
    gatherTripWantedSignals(tripId, category),
    gatherTripSpentSignals(tripId, category),
  ])
  return [...rated, ...planned, ...wanted, ...used]
}
```

- [ ] **Step 6: Extend per-trip blocks to all four categories**

In `getTripLearnedBlocks`, change the category list:

```ts
const categories: LearnedCategory[] = [
  "food",
  "activity",
  "accommodation",
  "transport",
]
```

- [ ] **Step 7: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: both clean. Nothing renders the new categories yet, but `countSignals(workspace, "accommodation")` and `getTripLearnedBlocks` now include them.

- [ ] **Step 8: Commit**

```bash
git add src/lib/preferences/couple-summary-queries.ts
git commit -m "feat(profile): gather accommodation/transport signals from real expenses"
```

---

### Task 3: Render the two new categories on `/profile`

Show the "What we've learned" block in the Accommodation and Transport sections (gated by the signal floor, keeping the old copy below it), and fix the per-trip block label so accommodation/transport are named correctly instead of falling through to "Activities".

**Files:**
- Modify: `src/app/profile/page.tsx` (reads near lines 48-51; render at 196-207; per-trip label at 224)

**Interfaces:**
- Consumes: `countSignals` / `getCoupleSummary` / `getTripLearnedBlocks` (already imported); `LearnedSummary` (already imported, already typed `LearnedCategory`); `RATING_FLOOR` (already imported); `CategorySection` (already imported).

- [ ] **Step 1: Load the accommodation/transport summaries and counts**

In `src/app/profile/page.tsx`, after the existing `activityRatings` line (~line 51), add:

```ts
  const accommodationSummary = await getCoupleSummary(workspace.id, "accommodation")
  const accommodationSignals = await countSignals(workspace.id, "accommodation")
  const transportSummary = await getCoupleSummary(workspace.id, "transport")
  const transportSignals = await countSignals(workspace.id, "transport")
```

- [ ] **Step 2: Add the per-trip category label map**

First widen the existing type import. Change `src/app/profile/page.tsx:26` from:

```ts
import { RATING_FLOOR } from "@/lib/preferences/couple-summary-types"
```

to:

```ts
import { RATING_FLOOR, type LearnedCategory } from "@/lib/preferences/couple-summary-types"
```

Then add a module-level const after the imports, before the component:

```ts
const CATEGORY_LABEL: Record<LearnedCategory, string> = {
  food: "Food",
  activity: "Activities",
  accommodation: "Accommodation",
  transport: "Transport",
}
```

- [ ] **Step 3: Replace the two empty category sections**

Replace the current Accommodation and Transport `CategorySection`s (lines ~196-207) with:

```tsx
            <CategorySection
              title="Accommodation"
              hint={accommodationSignals >= RATING_FLOOR ? undefined : "empty"}
            >
              {accommodationSignals >= RATING_FLOOR ? (
                <LearnedSummary
                  category="accommodation"
                  summaryMd={accommodationSummary.summaryMd}
                  ratingCount={accommodationSignals}
                  countAtGeneration={accommodationSummary.ratingCountAtGeneration}
                  aiOn={aiOn}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing here yet — this grows from what you book to stay in on
                  your trips.
                </p>
              )}
            </CategorySection>

            <CategorySection
              title="Transport"
              hint={transportSignals >= RATING_FLOOR ? undefined : "empty"}
            >
              {transportSignals >= RATING_FLOOR ? (
                <LearnedSummary
                  category="transport"
                  summaryMd={transportSummary.summaryMd}
                  ratingCount={transportSignals}
                  countAtGeneration={transportSummary.ratingCountAtGeneration}
                  aiOn={aiOn}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing here yet — this grows from how you get around on your
                  trips.
                </p>
              )}
            </CategorySection>
```

- [ ] **Step 4: Fix the per-trip block label**

In the "By trip" render, replace the hardcoded label (line ~224):

```tsx
                          {b.category === "food" ? "Food" : "Activities"}
```

with:

```tsx
                          {CATEGORY_LABEL[b.category]}
```

- [ ] **Step 5: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/profile/page.tsx
git commit -m "feat(profile): render accommodation/transport learned summaries"
```

---

### Task 4: In-app verification

Prove the feature end-to-end in the running app — this is the real test for this repo.

**Files:** none (manual verification).

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev` (http://localhost:3000). If Turbopack throws `0xc0000142` on Windows, stop, delete `.next/`, and restart (known flake).

- [ ] **Step 2: Seed real expenses on a started/finished trip**

On a trip whose `start_date <= today`, open the Budget tab and log at least 3 expenses under **Transportation** (e.g. "Rental car", "Train to Fez", "Airport taxi") and 3 under **Accommodation** (e.g. "Riad Dar Anika", "Beach guesthouse", "City hostel"). These are the `used` signals.

- [ ] **Step 3: Confirm the general profile blocks**

With AI mode **on**, open `/profile`. Expand **Transport** and **Accommodation**. Each should now show a "What we've learned" block (not the "empty" hint) that background-generates a summary describing the *kind* of transport/stay (not the individual bookings or any prices). Confirm no amount or price leaks into the text.

- [ ] **Step 4: Confirm the per-trip block + label**

Scroll to "By trip". The seeded trip should now list **Accommodation** and/or **Transport** blocks under it, labelled correctly (not mislabelled "Activities").

- [ ] **Step 5: Confirm Food/Activity are unchanged**

Verify the Food and Activities sections and their summaries look exactly as before (the expense source must not have leaked into them).

- [ ] **Step 6: Confirm the below-floor state**

On a trip (or workspace) with fewer than 3 Accommodation/Transport expenses, confirm the section still shows the "Nothing here yet" copy and no block.

- [ ] **Step 7: Mark done**

Update `docs/TODO.md` with a slice-3 shipped entry (build+lint clean; in-app verified), referencing this plan and the spec `docs/superpowers/specs/2026-07-13-profile-growth-slice-3-design.md`. Commit:

```bash
git add docs/TODO.md
git commit -m "docs: mark profile-growth slice 3 shipped"
```

---

## Notes for the implementer

- **Why the other three gathers still run for accommodation/transport:** `gatherRatingSignals`/`gatherPlannedSignals`/`gatherWantedSignals` all naturally return empty for these categories (nothing is tagged accommodation/transport in `event_ratings`; `inferRatingCategory` only emits food/activity; the discovery `expenseCategoryToLearned` returns null for Accommodation/Transportation). So "expenses only" holds without special-casing, and the code stays uniform. The few empty queries are acceptable at this app's scale.
- **Do not touch** `expenseCategoryToLearned` in `discovery-types.ts` — `DiscoveryCategory` legitimately stays two-valued (discovery only *finds* food/activity places). The four-way map is the separate `learnedCategoryToExpenseName` in the learned domain.
- **Copy:** dates/prices anywhere use `en-GB`; no emojis.
