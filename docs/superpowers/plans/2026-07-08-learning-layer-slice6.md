# Learning Layer (slice 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ratings accumulate into a durable append-only log, Claude distils a living per-category markdown summary the couple can edit, and discovery reads that summary on every search.

**Architecture:** Two new tables — `event_ratings` (append-only corpus) and `couple_summaries` (one editable markdown row per workspace+category). `rateEvent` logs a corpus row on every real 1-5 rating (AI-free). A new `summarizeTaste` seam in `lib/ai/claude.ts` evolves the current summary from the corpus (AI-gated, suggest-only). The couple profile shows each summary editable and background-refreshes it when stale (percentage rule). Discovery loads the summary and folds it into the prompt as a strong couple signal.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), React 19, TypeScript 5, Supabase (Postgres + RLS), Anthropic SDK behind `lib/ai/claude.ts`.

## Global Constraints

- **No test framework exists in this repo.** Do NOT invent a test command. Each task's validation is `pnpm lint` + `pnpm build` (both must pass) plus the manual smoke check named in the task. (CLAUDE.md: "There are no tests yet; do not invent a test command.")
- **Migrations are applied by hand.** SQL files go in `supabase/migrations/` and are pasted into the Supabase SQL editor manually. Single shared project — dev = prod. Every SQL file must be idempotent (`create table if not exists`, `drop policy`/exception guards). Committing or restarting dev does nothing to the DB.
- **`lib/ai` is suggest-only.** Nothing under `src/lib/ai/` may import a server action or write to the DB. It returns data; the caller persists.
- **AI is off by default and cookie-gated** via `isAiEnabled()` (`src/lib/ai/ai-mode.ts`). Logging is AI-free; generation is AI-gated.
- **Client components must import from `*-types.ts`, never `*-queries.ts`** (which pull `next/headers`). The staleness rule and category type live in `couple-summary-types.ts` for exactly this reason.
- **European date order** anywhere dates render (`en-GB`). Not expected in this slice, but hold to it.
- **No emojis** in code, prompts, or logs. Sparse comments; clear names; short functions.
- The Supabase client is **untyped** (`createServerClient` with no `Database` generic), so `.select()` results are `any` — nested selects like `trips(workspace_id)` return a plain object accessible as `row.trips.workspace_id`.

## File Structure

**New files:**
- `supabase/migrations/20260708000001_learning_layer.sql` — both tables + RLS.
- `src/lib/preferences/couple-summary-types.ts` — pure: `LearnedCategory`, `RATING_FLOOR`, `inferRatingCategory`, `isSummaryStale`. No server-only import (client-shareable).
- `src/lib/preferences/couple-summary-queries.ts` — `getCoupleSummary`, `countRatings`. Server-only (uses `createClient`).
- `src/lib/preferences/couple-summary-actions.ts` — `"use server"`: `refreshCoupleSummary` (AI-gated), `saveCoupleSummary` (no AI).
- `src/app/profile/learned-summary.tsx` — `"use client"` "What we've learned" block.

**Modified files:**
- `src/lib/trips/actions.ts` — `rateEvent` appends an `event_ratings` row.
- `src/lib/ai/claude.ts` — add `summarizeTaste`; render a `learned` block in `discoveryPrompt`.
- `src/lib/ai/discovery-types.ts` — add `learned: string` to `DiscoveryQuery`.
- `src/app/api/ai/discover/route.ts` — load the summary and pass it as `learned`.
- `src/app/profile/page.tsx` — render `LearnedSummary` in the Food and Activities sections.
- `docs/TODO.md`, `docs/DECISIONS.md` — record the slice.

---

### Task 1: Migration — the two stores

**Files:**
- Create: `supabase/migrations/20260708000001_learning_layer.sql`

**Interfaces:**
- Produces: tables `public.event_ratings` (columns: `id`, `workspace_id`, `trip_id`, `day_date`, `event_text`, `note`, `rating`, `category`, `created_by`, `created_at`) and `public.couple_summaries` (PK `(workspace_id, category)`; columns `summary_md`, `rating_count_at_generation`, `updated_at`). Both RLS'd to workspace members via `public.is_workspace_member(workspace_id)`.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260708000001_learning_layer.sql`:

```sql
-- Learning layer (slice 6): a durable append-only rating corpus + a per-category
-- editable markdown summary the discovery agent reads. RLS via the existing
-- is_workspace_member helper. Idempotent: safe to paste-and-run again.

create table if not exists public.event_ratings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete set null,
  day_date date,
  event_text text not null,
  note text,
  rating smallint not null check (rating between 1 and 5),
  category text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists event_ratings_ws_cat_idx
  on public.event_ratings (workspace_id, category);

alter table public.event_ratings enable row level security;

do $$
begin
  create policy event_ratings_select on public.event_ratings
    for select to authenticated using (public.is_workspace_member(workspace_id));
  create policy event_ratings_insert on public.event_ratings
    for insert to authenticated with check (public.is_workspace_member(workspace_id));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.couple_summaries (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  category text not null,
  summary_md text not null default '',
  rating_count_at_generation int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, category)
);

alter table public.couple_summaries enable row level security;

do $$
begin
  create policy couple_summaries_select on public.couple_summaries
    for select to authenticated using (public.is_workspace_member(workspace_id));
  create policy couple_summaries_insert on public.couple_summaries
    for insert to authenticated with check (public.is_workspace_member(workspace_id));
  create policy couple_summaries_update on public.couple_summaries
    for update to authenticated
    using (public.is_workspace_member(workspace_id))
    with check (public.is_workspace_member(workspace_id));
exception
  when duplicate_object then null;
end $$;
```

- [ ] **Step 2: Apply it by hand**

Paste the whole file into the Supabase SQL editor and run it. Run it a **second** time to confirm idempotency — it must succeed with no error both times.

Expected: "Success. No rows returned" on both runs.

- [ ] **Step 3: Verify the tables and policies exist**

In the SQL editor:

```sql
select table_name from information_schema.tables
  where table_name in ('event_ratings','couple_summaries');
select polname from pg_policies
  where tablename in ('event_ratings','couple_summaries');
```

Expected: both table names returned; five policy names returned (2 for `event_ratings`, 3 for `couple_summaries`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260708000001_learning_layer.sql
git commit -m "feat(learning): event_ratings + couple_summaries tables (slice 6)"
```

---

### Task 2: Pure types + query helpers

**Files:**
- Create: `src/lib/preferences/couple-summary-types.ts`
- Create: `src/lib/preferences/couple-summary-queries.ts`

**Interfaces:**
- Produces (types): `type LearnedCategory = "food" | "activity"`; `const RATING_FLOOR = 3`; `inferRatingCategory(text: string): LearnedCategory`; `isSummaryStale(ratingCount: number, countAtGeneration: number, hasSummary: boolean): boolean`.
- Produces (queries): `interface CoupleSummary { summaryMd: string; ratingCountAtGeneration: number }`; `getCoupleSummary(workspaceId: string, category: LearnedCategory): Promise<CoupleSummary>`; `countRatings(workspaceId: string, category: LearnedCategory): Promise<number>`.

- [ ] **Step 1: Write the pure types module**

Create `src/lib/preferences/couple-summary-types.ts`:

```ts
// Pure types + helpers for the learned couple summary (slice 6). No server-only
// import so the profile client component can share the staleness rule and the
// category type (the *-types.ts split rule).

export type LearnedCategory = "food" | "activity"

/** Fraction of new ratings (relative to corpus size) that makes a summary stale.
 * Early ratings each carry more weight: at 5 ratings one more is 20%; at 30 it is
 * 3% and not worth a refresh. */
const STALE_FRACTION = 0.2

/** Minimum ratings in a category before any learned summary is shown. */
export const RATING_FLOOR = 3

/** Meal words -> food; everything else -> activity. Best-effort tag set when a
 * rating is logged; the summariser still reads the text, so a mis-tag is low
 * stakes. */
const MEAL_WORDS = [
  "breakfast",
  "brunch",
  "lunch",
  "dinner",
  "cafe",
  "café",
  "coffee",
  "restaurant",
  "eat",
  "food",
  "dining",
  "bar",
  "drinks",
  "snack",
]

export function inferRatingCategory(text: string): LearnedCategory {
  const t = text.toLowerCase()
  return MEAL_WORDS.some((w) => t.includes(w)) ? "food" : "activity"
}

/** Stale when there is no summary yet, or enough new ratings have landed since it
 * was generated. Assumes the caller already applied RATING_FLOOR. */
export function isSummaryStale(
  ratingCount: number,
  countAtGeneration: number,
  hasSummary: boolean,
): boolean {
  if (!hasSummary) return true
  if (ratingCount <= 0) return false
  return (ratingCount - countAtGeneration) / ratingCount >= STALE_FRACTION
}
```

- [ ] **Step 2: Write the query helpers**

Create `src/lib/preferences/couple-summary-queries.ts`:

```ts
import { createClient } from "@/lib/supabase/server"
import type { LearnedCategory } from "./couple-summary-types"

export interface CoupleSummary {
  summaryMd: string
  ratingCountAtGeneration: number
}

/** The stored summary for a category, or empty defaults when none. */
export async function getCoupleSummary(
  workspaceId: string,
  category: LearnedCategory,
): Promise<CoupleSummary> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("couple_summaries")
    .select("summary_md, rating_count_at_generation")
    .eq("workspace_id", workspaceId)
    .eq("category", category)
    .maybeSingle()

  if (!data) return { summaryMd: "", ratingCountAtGeneration: 0 }
  return {
    summaryMd: data.summary_md ?? "",
    ratingCountAtGeneration: data.rating_count_at_generation ?? 0,
  }
}

/** How many ratings the corpus holds for a category. */
export async function countRatings(
  workspaceId: string,
  category: LearnedCategory,
): Promise<number> {
  const supabase = await createClient()
  const { count } = await supabase
    .from("event_ratings")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("category", category)
  return count ?? 0
}
```

- [ ] **Step 3: Lint and build**

Run: `pnpm lint && pnpm build`
Expected: both pass. (The new exports are unused so far — that's fine; later tasks consume them.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/preferences/couple-summary-types.ts src/lib/preferences/couple-summary-queries.ts
git commit -m "feat(learning): couple-summary types + query helpers (slice 6)"
```

---

### Task 3: Log a corpus row from `rateEvent`

**Files:**
- Modify: `src/lib/trips/actions.ts` (the `rateEvent` function, currently lines ~1350-1393)

**Interfaces:**
- Consumes: `inferRatingCategory` from `@/lib/preferences/couple-summary-types`.
- Behaviour: after the existing event-jsonb update succeeds, when `rating` is a real 1-5, insert one `event_ratings` row. The jsonb write is unchanged. Clearing a rating (rating null) appends nothing.

- [ ] **Step 1: Add the import**

At the top of `src/lib/trips/actions.ts`, alongside the existing imports, add:

```ts
import { inferRatingCategory } from "@/lib/preferences/couple-summary-types"
```

- [ ] **Step 2: Widen the day load to carry the workspace/trip/date**

In `rateEvent`, change the existing select from:

```ts
  const { data: row, error: loadError } = await supabase
    .from("itinerary_days")
    .select("events")
    .eq("id", input.dayId)
    .maybeSingle()
```

to:

```ts
  const { data: row, error: loadError } = await supabase
    .from("itinerary_days")
    .select("events, day_date, trip_id, trips(workspace_id)")
    .eq("id", input.dayId)
    .maybeSingle()
```

- [ ] **Step 3: Append the corpus row after the jsonb update**

In `rateEvent`, find the tail:

```ts
  const { error } = await supabase
    .from("itinerary_days")
    .update({ events: sorted })
    .eq("id", input.dayId)
  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}
```

Replace it with:

```ts
  const { error } = await supabase
    .from("itinerary_days")
    .update({ events: sorted })
    .eq("id", input.dayId)
  if (error) return { error: error.message }

  // Durable corpus: log a row for every real rating (AI-free). Survives editing
  // or deleting the event/day/trip because workspace_id is the anchor.
  if (rating) {
    const workspaceId = row.trips.workspace_id
    await supabase.from("event_ratings").insert({
      workspace_id: workspaceId,
      trip_id: row.trip_id,
      day_date: row.day_date,
      event_text: target.text,
      note: note || null,
      rating,
      category: inferRatingCategory(target.text),
      created_by: userData.user.id,
    })
  }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}
```

(`rating`, `note`, `target`, and `userData` are all already in scope earlier in the function.)

- [ ] **Step 4: Lint and build**

Run: `pnpm lint && pnpm build`
Expected: both pass.

- [ ] **Step 5: Manual smoke — a rating writes a row**

Start `pnpm dev`. Open a trip, rate an itinerary event 1-5 with a note. In the Supabase SQL editor:

```sql
select event_text, rating, note, category from public.event_ratings
  order by created_at desc limit 3;
```

Expected: a row for the event you rated, with `category` = `food` for a meal-ish event (e.g. "Dinner · ...") or `activity` otherwise. Clear the rating and confirm **no** new row is appended.

- [ ] **Step 6: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(learning): rateEvent logs to event_ratings corpus (slice 6)"
```

---

### Task 4: `summarizeTaste` seam

**Files:**
- Modify: `src/lib/ai/claude.ts`

**Interfaces:**
- Consumes: existing module-level `anthropic`, `MODEL`, and the `DiscoveryCategory` import.
- Produces: `summarizeTaste(category: DiscoveryCategory, currentSummaryMd: string, ratings: { text: string; rating: number; note: string }[]): Promise<string>` — returns markdown text. Plain `messages.create`, no `web_search`. Suggest-only (returns text; never writes).

- [ ] **Step 1: Add `summarizeTaste`**

In `src/lib/ai/claude.ts`, after the `pingClaude` function (before the Discovery section is fine), add:

```ts
/** Distil a couple's category ratings into a short markdown summary, evolving
 * their current summary (which may contain hand-edits) rather than replacing it.
 * Plain messages.create — no web_search. Suggest-only: returns text; the caller
 * persists it. */
export async function summarizeTaste(
  category: DiscoveryCategory,
  currentSummaryMd: string,
  ratings: { text: string; rating: number; note: string }[],
): Promise<string> {
  const noun = category === "activity" ? "activities" : "food"
  const lines = ratings
    .map((r) => `- ${r.text} · ${r.rating}/5${r.note ? ` · ${r.note}` : ""}`)
    .join("\n")
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
          `A couple has been rating ${noun} on their trips. ${current}\n\n` +
          `Here are their ${noun} ratings (place · rating · note):\n${lines}\n\n` +
          `Write a short markdown summary (a few bullet points) of what this ` +
          `couple likes and dislikes in ${noun}. Evolve the current summary ` +
          `rather than discarding it; keep any hand-edits that still hold. ` +
          `Return only the markdown, no preamble.`,
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

- [ ] **Step 2: Lint and build**

Run: `pnpm lint && pnpm build`
Expected: both pass. (`summarizeTaste` is exported but unused until Task 5 — fine.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/claude.ts
git commit -m "feat(learning): summarizeTaste seam in claude.ts (slice 6)"
```

---

### Task 5: Server actions — refresh (AI) and save (no AI)

**Files:**
- Create: `src/lib/preferences/couple-summary-actions.ts`

**Interfaces:**
- Consumes: `isAiEnabled` (`@/lib/ai/ai-mode`), `summarizeTaste` (`@/lib/ai/claude`), `getCurrentWorkspace` (`@/lib/workspace/queries`), `getCoupleSummary` (`./couple-summary-queries`), `LearnedCategory` (`./couple-summary-types`).
- Produces: `refreshCoupleSummary(category: LearnedCategory): Promise<{ summaryMd?: string; error?: string }>`; `saveCoupleSummary(category: LearnedCategory, md: string): Promise<{ error?: string }>`.

- [ ] **Step 1: Write the actions module**

Create `src/lib/preferences/couple-summary-actions.ts`:

```ts
"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { summarizeTaste } from "@/lib/ai/claude"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getCoupleSummary } from "./couple-summary-queries"
import type { LearnedCategory } from "./couple-summary-types"

/** Regenerates a category's learned summary from its ratings (AI-gated). Evolves
 * the current summary, then stamps rating_count_at_generation to the current
 * total so staleness resets. Returns the new markdown (or an error). */
export async function refreshCoupleSummary(
  category: LearnedCategory,
): Promise<{ summaryMd?: string; error?: string }> {
  if (!(await isAiEnabled())) return { error: "AI mode is off." }

  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }

  const supabase = await createClient()
  const { data: rows } = await supabase
    .from("event_ratings")
    .select("event_text, rating, note")
    .eq("workspace_id", workspace.id)
    .eq("category", category)
    .order("created_at", { ascending: true })

  const ratings = (rows ?? []).map((r) => ({
    text: r.event_text as string,
    rating: r.rating as number,
    note: (r.note as string | null) ?? "",
  }))
  if (ratings.length === 0) return { error: "No ratings yet." }

  const current = await getCoupleSummary(workspace.id, category)
  const summaryMd = await summarizeTaste(category, current.summaryMd, ratings)

  await supabase.from("couple_summaries").upsert(
    {
      workspace_id: workspace.id,
      category,
      summary_md: summaryMd,
      rating_count_at_generation: ratings.length,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,category" },
  )

  revalidatePath("/profile")
  return { summaryMd }
}

/** Saves a hand-edited summary (no AI). Leaves rating_count_at_generation
 * untouched so a manual edit does not clear staleness — if still stale, the next
 * profile load regenerates and folds the edit in. */
export async function saveCoupleSummary(
  category: LearnedCategory,
  md: string,
): Promise<{ error?: string }> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }

  const supabase = await createClient()
  await supabase.from("couple_summaries").upsert(
    {
      workspace_id: workspace.id,
      category,
      summary_md: md,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,category" },
  )

  revalidatePath("/profile")
  return {}
}
```

Note on `saveCoupleSummary`: the upsert omits `rating_count_at_generation`, so on **insert** it takes the column default (0) and on **conflict update** it is left as-is — exactly the "manual edit does not clear staleness" behaviour.

- [ ] **Step 2: Lint and build**

Run: `pnpm lint && pnpm build`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/preferences/couple-summary-actions.ts
git commit -m "feat(learning): refresh (AI) + save (no-AI) summary actions (slice 6)"
```

---

### Task 6: Show — the "What we've learned" block on the profile

**Files:**
- Create: `src/app/profile/learned-summary.tsx`
- Modify: `src/app/profile/page.tsx`

**Interfaces:**
- Consumes: `isSummaryStale`, `LearnedCategory` (`@/lib/preferences/couple-summary-types`); `refreshCoupleSummary`, `saveCoupleSummary` (`@/lib/preferences/couple-summary-actions`); `Button` (`@/components/ui/button`).
- Produces: `LearnedSummary` component with props `{ category: LearnedCategory; summaryMd: string; ratingCount: number; countAtGeneration: number; aiOn: boolean }`.
- Page consumes: `getCoupleSummary`, `countRatings` (`@/lib/preferences/couple-summary-queries`), `RATING_FLOOR` (`@/lib/preferences/couple-summary-types`), `isAiEnabled` (`@/lib/ai/ai-mode`), `LearnedSummary` (`./learned-summary`).

- [ ] **Step 1: Write the client component**

Create `src/app/profile/learned-summary.tsx`:

```tsx
"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  isSummaryStale,
  type LearnedCategory,
} from "@/lib/preferences/couple-summary-types"
import {
  refreshCoupleSummary,
  saveCoupleSummary,
} from "@/lib/preferences/couple-summary-actions"

/** The "What we've learned" block for one category on the couple profile. Shows
 * the editable markdown summary, a Save (no AI), and a refresh that auto-fires in
 * the background on mount when the summary is stale and AI is on. */
export function LearnedSummary({
  category,
  summaryMd,
  ratingCount,
  countAtGeneration,
  aiOn,
}: {
  category: LearnedCategory
  summaryMd: string
  ratingCount: number
  countAtGeneration: number
  aiOn: boolean
}) {
  const [text, setText] = React.useState(summaryMd)
  const [busy, setBusy] = React.useState(false)
  const stale = isSummaryStale(
    ratingCount,
    countAtGeneration,
    summaryMd.trim() !== "",
  )
  const newCount = Math.max(0, ratingCount - countAtGeneration)

  const refresh = React.useCallback(async () => {
    setBusy(true)
    const res = await refreshCoupleSummary(category)
    if (res.summaryMd !== undefined) setText(res.summaryMd)
    setBusy(false)
  }, [category])

  // Background-regenerate once on mount when stale and AI is on. The current
  // summary shows instantly; the fresh one swaps in when ready.
  const started = React.useRef(false)
  React.useEffect(() => {
    if (stale && aiOn && !started.current) {
      started.current = true
      void refresh()
    }
  }, [stale, aiOn, refresh])

  async function save() {
    setBusy(true)
    await saveCoupleSummary(category, text)
    setBusy(false)
  }

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="text-xs text-muted-foreground">{"What we've learned"}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Rate places on your trips and a summary appears here."
        className="mt-2 block w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
      />
      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={save}
          disabled={busy}
        >
          Save
        </Button>
        {aiOn ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={busy}
          >
            {busy ? "Refreshing…" : stale ? `${newCount} new — refresh` : "Refresh"}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            Turn on AI to refresh from your {newCount} new ratings.
          </span>
        )}
      </div>
    </div>
  )
}
```

(The `{"What we've learned"}` expression form avoids the React 19 apostrophe-in-JSX-text lint gotcha.)

- [ ] **Step 2: Load the data in the profile page**

In `src/app/profile/page.tsx`, add these imports next to the existing preference imports:

```ts
import {
  getCoupleSummary,
  countRatings,
} from "@/lib/preferences/couple-summary-queries"
import { RATING_FLOOR } from "@/lib/preferences/couple-summary-types"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { LearnedSummary } from "./learned-summary"
```

Then, just after the existing `const dining = await getDiningPreferences(workspace.id)` line, add:

```ts
  const aiOn = await isAiEnabled()
  const foodSummary = await getCoupleSummary(workspace.id, "food")
  const foodRatings = await countRatings(workspace.id, "food")
  const activitySummary = await getCoupleSummary(workspace.id, "activity")
  const activityRatings = await countRatings(workspace.id, "activity")
```

- [ ] **Step 3: Render the block in the Food section**

In `src/app/profile/page.tsx`, inside the Food `CategorySection`, after the closing `</form>` (the one ending the food-preferences form) and before `</CategorySection>`, add:

```tsx
              {foodRatings >= RATING_FLOOR ? (
                <LearnedSummary
                  category="food"
                  summaryMd={foodSummary.summaryMd}
                  ratingCount={foodRatings}
                  countAtGeneration={foodSummary.ratingCountAtGeneration}
                  aiOn={aiOn}
                />
              ) : null}
```

- [ ] **Step 4: Render the block in the Activities section**

In the Activities `CategorySection`, after its closing `</form>` and before `</CategorySection>`, add:

```tsx
              {activityRatings >= RATING_FLOOR ? (
                <LearnedSummary
                  category="activity"
                  summaryMd={activitySummary.summaryMd}
                  ratingCount={activityRatings}
                  countAtGeneration={activitySummary.ratingCountAtGeneration}
                  aiOn={aiOn}
                />
              ) : null}
```

- [ ] **Step 5: Lint and build**

Run: `pnpm lint && pnpm build`
Expected: both pass.

- [ ] **Step 6: Manual smoke — the block appears, edits and refresh work**

With `pnpm dev` running and at least 3 food ratings in the corpus (from Task 3 / add more if needed):
- Visit `/profile`. The Food section shows a "What we've learned" block (hidden if under 3 ratings).
- With **AI off**: the block shows, the textarea is editable, Save persists (reload confirms), and the refresh slot shows the "Turn on AI" hint.
- With **AI on** (toggle at top of profile) and a stale category: on the next `/profile` load the summary regenerates in the background and swaps in (placeholder/existing text first, Claude output after a moment). Verify a `couple_summaries` row now exists with a non-empty `summary_md` and `rating_count_at_generation` = current total:

```sql
select category, rating_count_at_generation, left(summary_md, 60)
  from public.couple_summaries;
```

- [ ] **Step 7: Commit**

```bash
git add src/app/profile/learned-summary.tsx src/app/profile/page.tsx
git commit -m "feat(learning): editable 'what we've learned' block on profile (slice 6)"
```

---

### Task 7: Rank — feed the summary into discovery

**Files:**
- Modify: `src/lib/ai/discovery-types.ts`
- Modify: `src/lib/ai/claude.ts` (`discoveryPrompt`)
- Modify: `src/app/api/ai/discover/route.ts`

**Interfaces:**
- Consumes: `getCoupleSummary` (`@/lib/preferences/couple-summary-queries`).
- Produces: `DiscoveryQuery.learned: string`; a rendered learned block in `discoveryPrompt` when non-empty.

- [ ] **Step 1: Add `learned` to `DiscoveryQuery`**

In `src/lib/ai/discovery-types.ts`, add to the `DiscoveryQuery` interface (after `walkable`):

```ts
  /** Learned couple summary markdown from past-trip ratings; "" when none. A
   * strong, evidence-based couple signal. */
  learned: string
```

- [ ] **Step 2: Render the learned block in `discoveryPrompt`**

In `src/lib/ai/claude.ts`, inside `discoveryPrompt`, add a `learnedLine` next to the existing `moment` array:

```ts
  const learnedLine = query.learned.trim()
    ? `From past trips, this couple has especially enjoyed: ${query.learned.trim()}`
    : ""
```

Then insert `learnedLine` into **both** category branches, right after `...moment,` and before the `"The couple generally —"` line. The activity branch becomes:

```ts
  if (query.category === "activity") {
    return [
      `Find things to do in ${query.destination}.`,
      ...moment,
      learnedLine,
      "The couple generally —",
      list("Activities they enjoy", query.activities),
      list("Vibe", query.vibeTags),
      ...(tripLines.length ? ["This trip —", ...tripLines] : []),
    ]
      .filter(Boolean)
      .join(" ")
  }
```

And the food (default) branch becomes:

```ts
  return [
    `Find restaurants in ${query.destination} for ${query.when}.`,
    ...moment,
    learnedLine,
    "The couple generally —",
    `Budget: ${query.budgetBand}.`,
    list("Vibe", query.vibeTags),
    list("Dietary needs", query.dietary),
    list("Cuisines they love", query.cuisines),
    list("Activities they enjoy", query.activities),
    ...(tripLines.length ? ["This trip —", ...tripLines] : []),
  ]
    .filter(Boolean)
    .join(" ")
```

(Placement is deliberate: after the in-the-moment `moment` lines and before the static structured prefs, so the evidence-based learned signal outranks the static base. The system prompt's mood-then-trip-then-general weighting is unchanged.)

- [ ] **Step 3: Load and pass the summary in the discover route**

In `src/app/api/ai/discover/route.ts`, add the import:

```ts
import { getCoupleSummary } from "@/lib/preferences/couple-summary-queries"
```

After the existing `const profile = tripId ? await getTripProfile(tripId) : EMPTY_TRIP_PROFILE` line, add:

```ts
    const summary = await getCoupleSummary(workspace.id, category)
```

Then add `learned` to the `DiscoveryQuery` object (after `walkable`):

```ts
      walkable: Boolean(body.walkable),
      learned: summary.summaryMd,
```

(`category` here is already a `DiscoveryCategory` of `"food" | "activity"`, which matches `LearnedCategory`.)

- [ ] **Step 4: Lint and build**

Run: `pnpm lint && pnpm build`
Expected: both pass.

- [ ] **Step 5: Manual smoke — discovery reads the summary, never generates**

With AI on, a couple that has a non-empty food summary, and a trip open: run a food discovery search. It should return normally (the learned summary is now in the prompt). Confirm discovery does **not** write a `couple_summaries` row on its own (only the profile refresh does):

```sql
select updated_at from public.couple_summaries where category = 'food';
```

Expected: `updated_at` unchanged by a discovery search (only changes when you refresh from the profile).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/discovery-types.ts src/lib/ai/claude.ts src/app/api/ai/discover/route.ts
git commit -m "feat(learning): discovery reads the learned couple summary (slice 6)"
```

---

### Task 8: Docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Mark slice 6 shipped in TODO.md**

In `docs/TODO.md`, add a line under the current in-progress/roadmap section recording slice 6 (learning layer) as shipped, mirroring the existing slice entries' format (e.g. a `- [x]` line describing: durable `event_ratings` corpus, editable per-category `couple_summaries`, `summarizeTaste` seam, profile "what we've learned" block, discovery wiring).

- [ ] **Step 2: Append decision rows to DECISIONS.md**

In `docs/DECISIONS.md`, append rows (match the file's existing row format) for the non-obvious choices:
- Two stores: durable append-only `event_ratings` log + editable `couple_summaries` markdown (raw data and distillation are separate jobs).
- Percentage staleness (20% of corpus, floor 3) instead of fixed-N — early ratings weigh more.
- Edit-preserving generation: refresh evolves the current summary (edits included) rather than replacing, so auto-replace is always safe; manual save leaves `rating_count_at_generation` untouched so an edit doesn't clear staleness.
- AI toggle "position 3": logging AI-free, generation AI-gated, the toggle itself never generates, background regen on next profile load; discovery reads only.
- Best-effort `category` column via meal-word heuristic (needed for per-category % counts).

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record slice 6 (learning layer) shipped + decisions"
```

---

## Self-Review

**1. Spec coverage:**
- Two stores (`event_ratings`, `couple_summaries`) → Task 1. ✓
- "All data saved" append-only corpus, workspace-anchored, only real 1-5 logged, no dedupe → Task 3. ✓
- Best-effort `category` column via meal-word heuristic → Task 2 (`inferRatingCategory`) + Task 3 (used at insert). ✓
- `summarizeTaste` seam, evolve-not-replace, no web_search, suggest-only → Task 4. ✓
- Percentage staleness (20%, floor 3), lazy non-blocking on profile load → `isSummaryStale`/`RATING_FLOOR` (Task 2) + background mount effect (Task 6). ✓
- AI position 3: logging AI-free (Task 3), generation AI-gated (`refreshCoupleSummary` guard, Task 5), toggle doesn't itself generate / background on next load (Task 6), AI-off still shows+edits (Task 6 hint branch), discovery never generates (Task 7 read-only). ✓
- Manual edit doesn't clear staleness → `saveCoupleSummary` omits `rating_count_at_generation` (Task 5). ✓
- Show editable block, hidden below floor → Task 6. ✓
- Discovery `learned` field + prompt block + route load, precedence after moment/before static base → Task 7. ✓
- RLS mirrors `dining_preferences` → Task 1. ✓
- Idempotent, manually-applied migration → Task 1. ✓
- Docs (TODO + DECISIONS) → Task 8. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to". Task 8 describes doc edits prose-style (acceptable — the exact wording is authorial and mirrors existing file formats, not code). All code steps show complete code.

**3. Type consistency:** `LearnedCategory = "food" | "activity"` used consistently across types/queries/actions/component; `DiscoveryCategory` (same string union) accepts it in `summarizeTaste` and the route. `CoupleSummary { summaryMd, ratingCountAtGeneration }` returned by `getCoupleSummary`, consumed with those exact names in the page (Task 6) and actions (Task 5). `isSummaryStale(ratingCount, countAtGeneration, hasSummary)` signature matches its one call site. `refreshCoupleSummary` returns `{ summaryMd?, error? }`, consumed as `res.summaryMd` in the component. Insert column names in Task 3 match the migration columns in Task 1.
