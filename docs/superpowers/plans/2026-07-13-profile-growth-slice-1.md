# Profile Growth — Slice 1 (Broaden the Corpus) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Food/Activity couple summaries grow from planned itinerary events and category detail tags — not just ratings — so a couple who never rates still builds a profile.

**Architecture:** No schema change. The learned-summary pipeline (`refreshCoupleSummary` -> `summarizeTaste`) keeps its shape; only its *input corpus* widens from ratings-only to a unified `TasteSignal[]` (rated / planned / wanted), assembled by new gather helpers. The display floor and staleness stamp switch from counting ratings to counting all signals, so the broadened corpus is actually reachable in the UI. Spec: `docs/superpowers/specs/2026-07-13-profile-growth-design.md`.

**Tech Stack:** Next.js 16 App Router, TypeScript 5, Supabase (`@supabase/ssr` server client), Anthropic SDK (`lib/ai/claude.ts`).

## Global Constraints

- **No test runner exists in this repo, and per CLAUDE.md we do not invent one.** Every task is verified by `pnpm lint` + `pnpm build` (typecheck), and the final task adds an in-app manual check. This intentionally replaces the skill's default TDD steps.
- **No new dependencies, no schema migration.** The `couple_summaries.rating_count_at_generation` column is reused verbatim; it now holds a signal count.
- **Server-first.** Gather helpers are server-only (they use the SSR client); pure types live in `*-types.ts` so client components can import them (the `*-types.ts` split rule).
- **No emojis. Sparse comments (WHY only). Short functions.**
- **AI provider is one file:** all Claude calls stay in `src/lib/ai/claude.ts`.
- Signal categorization mirrors the existing rating classifier: planned events route via `inferRatingCategory(text)` (same call `rateEvent` uses); detail tags route via the expense-category name (`Food` -> food, `Activities` -> activity).

---

### Task 1: Signal types + reverse category map (pure)

**Files:**
- Modify: `src/lib/preferences/couple-summary-types.ts` (add `TasteSignal`)
- Modify: `src/lib/ai/discovery-types.ts` (add `expenseCategoryToLearned`)

**Interfaces:**
- Consumes: `LearnedCategory` (existing, `couple-summary-types.ts`), `DiscoveryCategory` (existing, `discovery-types.ts`; both are `"food" | "activity"`).
- Produces:
  - `TasteSignal` = `{ text: string; kind: "rated" | "planned" | "wanted"; rating?: number; note?: string }`
  - `expenseCategoryToLearned(name: string): DiscoveryCategory | null`

- [ ] **Step 1: Add the `TasteSignal` type**

In `src/lib/preferences/couple-summary-types.ts`, append after the existing exports:

```ts
/** One piece of evidence about the couple's taste in a category. A rating is the
 * strong kind; "planned" (added to an itinerary, not rated) and "wanted" (a
 * category detail tag) are lighter hints. The summariser weights them accordingly. */
export interface TasteSignal {
  text: string
  kind: "rated" | "planned" | "wanted"
  /** Present only when kind === "rated" (1-5). */
  rating?: number
  /** Free note captured with a rating; absent otherwise. */
  note?: string
}
```

- [ ] **Step 2: Add the reverse expense-category map**

In `src/lib/ai/discovery-types.ts`, directly below the existing `mapDiscoveryCategory` function, add:

```ts
/** Reverse of mapDiscoveryCategory: an expense-category name back to a learned
 * category. Only Food/Activities are learnable in this slice; everything else
 * (Transport, Accommodation, Other, ...) returns null and is ignored. */
export function expenseCategoryToLearned(name: string): DiscoveryCategory | null {
  if (name === "Food") return "food"
  if (name === "Activities") return "activity"
  return null
}
```

- [ ] **Step 3: Verify lint + typecheck**

Run: `pnpm lint && pnpm build`
Expected: both pass. No behavior change yet (types + a pure function only).

- [ ] **Step 4: Commit**

```bash
git add src/lib/preferences/couple-summary-types.ts src/lib/ai/discovery-types.ts
git commit -m "feat(profile): TasteSignal type + expense->learned reverse map"
```

---

### Task 2: Signal gather helpers + countSignals

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts:90` (export the existing `parseEvents`)
- Modify: `src/lib/preferences/couple-summary-queries.ts` (add gather helpers + `countSignals`)

**Interfaces:**
- Consumes: `TasteSignal`, `LearnedCategory` (Task 1 / existing), `expenseCategoryToLearned` (Task 1), `inferRatingCategory` (existing, `couple-summary-types.ts`), `parseEvents` (existing, now exported).
- Produces:
  - `gatherTasteSignals(workspaceId: string, category: LearnedCategory): Promise<TasteSignal[]>`
  - `countSignals(workspaceId: string, category: LearnedCategory): Promise<number>`

- [ ] **Step 1: Export `parseEvents`**

In `src/lib/trips/itinerary-types.ts`, change the `parseEvents` declaration (currently `function parseEvents`) to export it:

```ts
/** Parse the raw jsonb `events` array into clean ItineraryEvent[]. Tolerates
 * null/malformed values and drops events with empty text. */
export function parseEvents(raw: unknown): ItineraryEvent[] {
```

(Only the `export` keyword is added; the body is unchanged.)

- [ ] **Step 2: Add gather helpers + `countSignals`**

In `src/lib/preferences/couple-summary-queries.ts`, add these imports at the top:

```ts
import { inferRatingCategory } from "./couple-summary-types"
import type { TasteSignal } from "./couple-summary-types"
import { expenseCategoryToLearned } from "@/lib/ai/discovery-types"
import { parseEvents } from "@/lib/trips/itinerary-types"
```

Then append these functions to the file:

```ts
/** Rated places from the durable corpus (strong signal). */
async function gatherRatingSignals(
  workspaceId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("event_ratings")
    .select("event_text, rating, note")
    .eq("workspace_id", workspaceId)
    .eq("category", category)
    .order("created_at", { ascending: true })
  return (data ?? []).map((r) => ({
    text: r.event_text as string,
    kind: "rated" as const,
    rating: r.rating as number,
    note: (r.note as string | null) ?? undefined,
  }))
}

/** Itinerary events the couple added but never rated (weak "we did this" signal).
 * Un-rated is the dedup: a rated event lives in event_ratings instead. Categorised
 * by the same classifier ratings use. */
async function gatherPlannedSignals(
  workspaceId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("itinerary_days")
    .select("events, trips!inner(workspace_id)")
    .eq("trips.workspace_id", workspaceId)
  const signals: TasteSignal[] = []
  for (const row of data ?? []) {
    for (const e of parseEvents((row as { events: unknown }).events)) {
      if (e.rating !== undefined) continue
      if (inferRatingCategory(e.text) !== category) continue
      signals.push({ text: e.text, kind: "planned" })
    }
  }
  return signals
}

/** Category detail tags (weak intent signal): Food -> sushi, burgers. */
async function gatherWantedSignals(
  workspaceId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("expense_categories")
    .select("name, details, trips!inner(workspace_id)")
    .eq("trips.workspace_id", workspaceId)
  const signals: TasteSignal[] = []
  for (const row of data ?? []) {
    const r = row as { name: string; details: string[] | null }
    if (expenseCategoryToLearned(r.name) !== category) continue
    for (const tag of r.details ?? []) signals.push({ text: tag, kind: "wanted" })
  }
  return signals
}

/** The full corpus for a category: rated + planned + wanted. */
export async function gatherTasteSignals(
  workspaceId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const [rated, planned, wanted] = await Promise.all([
    gatherRatingSignals(workspaceId, category),
    gatherPlannedSignals(workspaceId, category),
    gatherWantedSignals(workspaceId, category),
  ])
  return [...rated, ...planned, ...wanted]
}

/** How many signals of any kind the corpus holds for a category. Drives the
 * display floor and staleness, replacing the ratings-only countRatings. */
export async function countSignals(
  workspaceId: string,
  category: LearnedCategory,
): Promise<number> {
  return (await gatherTasteSignals(workspaceId, category)).length
}
```

Note: `countRatings` stays for now; Task 4 removes its last caller. Leaving it in this task keeps the build green.

- [ ] **Step 3: Verify lint + typecheck**

Run: `pnpm lint && pnpm build`
Expected: both pass. If TypeScript complains about the `trips!inner(...)` embed shape, the `as { ... }` casts above resolve it (the codebase already casts Supabase embed rows this way).

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/itinerary-types.ts src/lib/preferences/couple-summary-queries.ts
git commit -m "feat(profile): gather rated/planned/wanted taste signals + countSignals"
```

---

### Task 3: Broaden the summariser and its caller

**Files:**
- Modify: `src/lib/ai/claude.ts:85-120` (`summarizeTaste` signature + prompt)
- Modify: `src/lib/preferences/couple-summary-actions.ts:15-55` (`refreshCoupleSummary` gather + stamp)

**Interfaces:**
- Consumes: `TasteSignal` (Task 1), `gatherTasteSignals` (Task 2).
- Produces: `summarizeTaste(category: DiscoveryCategory, currentSummaryMd: string, signals: TasteSignal[]): Promise<string>` (third param type changed from the old `{ text; rating; note }[]`).

- [ ] **Step 1: Rewrite `summarizeTaste` to consume signals**

In `src/lib/ai/claude.ts`, add the import near the other type imports:

```ts
import type { TasteSignal } from "@/lib/preferences/couple-summary-types"
```

Add this module-private helper directly above `summarizeTaste`:

```ts
function signalToLine(s: TasteSignal): string {
  if (s.kind === "rated") {
    const note = s.note ? ` · ${s.note}` : ""
    return `- ${s.text} · rated ${s.rating}/5${note}`
  }
  if (s.kind === "planned") return `- ${s.text} · planned (not rated)`
  return `- ${s.text} · wanted`
}
```

Replace the whole `summarizeTaste` function (lines 85-120) with:

```ts
export async function summarizeTaste(
  category: DiscoveryCategory,
  currentSummaryMd: string,
  signals: TasteSignal[],
): Promise<string> {
  const noun = category === "activity" ? "activities" : "food"
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
          `A couple leaves signals about their ${noun} taste across their trips: ` +
          `places they rated, places they planned but never rated, and ${noun} ` +
          `they said they wanted. ${current}\n\n` +
          `Here are the signals:\n${lines}\n\n` +
          `Weight the rated places most; treat "planned" and "wanted" as lighter ` +
          `hints about direction, not firm evidence. Write a short markdown ` +
          `summary (a few bullet points) of what this couple likes and dislikes ` +
          `in ${noun}. Evolve the current summary rather than discarding it; keep ` +
          `any hand-edits that still hold. Return only the markdown, no preamble.`,
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

- [ ] **Step 2: Rewrite `refreshCoupleSummary` to feed gathered signals**

In `src/lib/preferences/couple-summary-actions.ts`, update the imports: remove the `getCoupleSummary`-only line if it stands alone and add `gatherTasteSignals`. The import block becomes:

```ts
import { getCoupleSummary, gatherTasteSignals } from "./couple-summary-queries"
```

Replace the body of `refreshCoupleSummary` (the part from `const supabase = await createClient()` through the `upsert(...)` call) with:

```ts
  const signals = await gatherTasteSignals(workspace.id, category)
  if (signals.length === 0) return { error: "Nothing to learn from yet." }

  const current = await getCoupleSummary(workspace.id, category)
  const summaryMd = await summarizeTaste(category, current.summaryMd, signals)

  const supabase = await createClient()
  await supabase.from("couple_summaries").upsert(
    {
      workspace_id: workspace.id,
      category,
      summary_md: summaryMd,
      rating_count_at_generation: signals.length,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,category" },
  )
```

The old block that loaded `event_ratings` directly and built the `ratings` array is fully removed (gather does it now). Keep the `revalidatePath("/profile")` and `return { summaryMd }` lines that follow.

- [ ] **Step 3: Verify lint + typecheck**

Run: `pnpm lint && pnpm build`
Expected: both pass. The only caller of `summarizeTaste` is `refreshCoupleSummary`, updated in the same task, so the signature change is self-contained.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/claude.ts src/lib/preferences/couple-summary-actions.ts
git commit -m "feat(profile): summarise from rated+planned+wanted signals, stamp signal count"
```

---

### Task 4: Reach the broadened corpus in the UI

**Files:**
- Modify: `src/app/profile/page.tsx:24,47-50,152,157,174,179` (count by signals, not ratings)
- Modify: `src/app/profile/learned-summary.tsx:70,95` (copy: not "ratings"-only)

**Interfaces:**
- Consumes: `countSignals` (Task 2).
- Produces: no new exports. The profile page now gates each category's summary on `>= RATING_FLOOR` *signals* and passes the signal count as `ratingCount` to `LearnedSummary` (whose prop name is kept to avoid churn; it is a generic count).

- [ ] **Step 1: Swap `countRatings` for `countSignals` on the profile page**

In `src/app/profile/page.tsx`, change the import (line ~24) from:

```ts
import {
  getCoupleSummary,
  countRatings,
} from "@/lib/preferences/couple-summary-queries"
```
to:
```ts
import {
  getCoupleSummary,
  countSignals,
} from "@/lib/preferences/couple-summary-queries"
```

Then change the two count reads (lines ~48, ~50) from `countRatings` to `countSignals`, keeping the variable names:

```ts
  const foodRatings = await countSignals(workspace.id, "food")
  const activitySummary = await getCoupleSummary(workspace.id, "activity")
  const activityRatings = await countSignals(workspace.id, "activity")
```

No other lines in this file change — `foodRatings`/`activityRatings` now hold signal counts, so the existing `>= RATING_FLOOR` gates and the `ratingCount={...}` props carry through unchanged.

- [ ] **Step 2: Update the `LearnedSummary` copy so it does not say "ratings" only**

In `src/app/profile/learned-summary.tsx`, change the textarea placeholder (line ~70) from:

```tsx
        placeholder="Rate places on your trips and a summary appears here."
```
to:
```tsx
        placeholder="Rate or plan places on your trips and a summary appears here."
```

And change the AI-off hint (line ~95) from:

```tsx
            Turn on AI to refresh from your {newCount} new ratings.
```
to:
```tsx
            Turn on AI to fold in your {newCount} new.
```

- [ ] **Step 3: Verify lint + typecheck**

Run: `pnpm lint && pnpm build`
Expected: both pass. `countRatings` is now unreferenced but still exported — that is fine (no unused-export lint rule); leave it for a later slice that may reuse it.

- [ ] **Step 4: Manual in-app verification**

This is the slice's real acceptance check — do it before committing.

Run: `pnpm dev` (if it panics with `0xc0000142`, stop, delete `.next/`, restart — known Windows Turbopack flake).

1. Sign in to a workspace that has a trip with itinerary events but **few or no ratings**.
2. Add an un-rated itinerary event with a clearly food name (e.g. "Sushi lunch at Nobu") and one with an activity name (e.g. "Surf lesson").
3. Optionally add a Food category detail tag (e.g. "sushi") on that trip.
4. Open `/profile` with AI mode on.
5. Expected: the Food and/or Activities "What we've learned" block now appears even though you added no ratings (the `>= RATING_FLOOR` gate is met by planned + wanted signals), and after the auto-refresh the summary text reflects the planned/wanted items — leaning toward them, not quoting them verbatim.
6. Confirm a previously ratings-only workspace still summarises correctly (no regression).

If the block does not appear, check the signal count clears `RATING_FLOOR` (3) — add another planned event and reload.

- [ ] **Step 5: Commit**

```bash
git add src/app/profile/page.tsx src/app/profile/learned-summary.tsx
git commit -m "feat(profile): gate + count learned summaries by all signals, not ratings"
```

---

## Post-slice housekeeping

- [ ] Update `docs/TODO.md` — mark "profile grows from un-rated signals (slice 1)" shipped, note slices 2 (per-trip summaries) and 3 (all categories + trip-profile routing) still pending.
- [ ] Add a row to `docs/DECISIONS.md`: "Profile summaries learn from planned events + detail tags, weighted below ratings; display floor + staleness count all signals; reused `rating_count_at_generation` as a signal count (no migration)."
- [ ] Consider the memory note `project-ai-seam-mock-first` — update if the profile-growth surface changes its status.
