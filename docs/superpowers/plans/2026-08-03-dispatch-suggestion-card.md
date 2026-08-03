# Dispatch suggestion card — slice 1 implementation plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax for tracking.
> This repo has **no test framework** (`CLAUDE.md`: "There are no tests yet; do
> not invent a test command until one exists"). Each task's verification is
> `npx tsc --noEmit` + `pnpm lint` plus reasoning about the data path. `pnpm
> build` runs once at the end, and **only if the dev server is stopped** — a
> build while `pnpm dev` runs clobbers `.next`.

**Goal:** One proactive, answerable suggestion a day in the `/on-the-road`
dispatch box, generated on the existing daily trigger and stored with its
outcome.

**Architecture:** `ensureDispatch` grows a second half. After the `dispatch`
agent's web search, a new `road-suggestion` descriptor runs with no search tool,
reading the findings plus trip context plus this trip's recently answered
suggestions. Its proposal is stored in a new `trip_suggestions` table (unique on
`trip_id, day_date`). The box renders a `pending` row as a card with **add** —
which commits through the existing `addTodayEvent` — and **×**.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (RLS,
hand-applied SQL), `@anthropic-ai/sdk` via `runAgent`.

## Global Constraints

- **One agent, one descriptor file.** `road-suggestion` is its own file under
  `src/lib/ai/agents/`; do not add tools to `dispatch.ts`.
- **Migrations are idempotent** — safe to paste into the Supabase SQL editor
  repeatedly (`if not exists` / `drop policy if exists` then create).
- **Migrations are applied by hand.** The task is done when the file exists;
  the user pastes it.
- **Client components import types from `*-types.ts`**, never from
  `*-queries.ts` (which pulls `next/headers` and breaks the bundle).
- **No emojis** in code, prompts, or logs.
- **European date order** in any user-visible date.
- **Never say "works" or "verified"** for anything behind the UI.

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260803000002_trip_suggestions.sql` | new table, unique index, RLS |
| `src/lib/trips/road-suggestion-types.ts` | pure shared types (row, proposal, card data) |
| `src/lib/trips/road-suggestion-queries.ts` | read today's row + the answered history |
| `src/lib/ai/agents/road-suggestion.ts` | the agent descriptor |
| `src/lib/ai/registry.ts` | `propose_road_suggestion` tool schema |
| `src/lib/ai/claude.ts` | re-export the seam entry point |
| `src/lib/trips/dispatch-actions.ts` | generate + store both halves |
| `src/lib/trips/road-suggestion-actions.ts` | add / dismiss |
| `src/components/road-suggestion-card.tsx` | the card UI |
| `src/components/dispatch-box.tsx` | put the card in the deck, pin rotation |
| `src/app/on-the-road/page.tsx` | read the row, pass it down, widen the trigger |

---

### Task 1: Table, types, queries

**Files:**
- Create: `supabase/migrations/20260803000002_trip_suggestions.sql`
- Create: `src/lib/trips/road-suggestion-types.ts`
- Create: `src/lib/trips/road-suggestion-queries.ts`

**Interfaces:**
- Consumes: `is_trip_workspace_member(uuid)` (already in the DB),
  `createClient` from `@/lib/supabase/server`.
- Produces: `RoadSuggestion`, `SuggestionOutcome`, `SuggestionTarget`,
  `RoadSuggestionProposal`, `SuggestionCardData`, `AnsweredSuggestion`,
  `SUGGESTION_HISTORY_LIMIT`, `getSuggestionForDay(tripId, dayDate)`,
  `getAnsweredSuggestions(tripId)`.

- [ ] **Step 1: Write the migration**

```sql
-- One AI suggestion per trip per day: the proactive card in the dispatch box.
-- Written by the same daily pass as trip_dispatch, but unlike that row this one
-- is answered by the couple, and the answers are what the assistant learns from.
-- The unique index is what makes generation once-per-day (upsert on conflict).
--
-- Idempotent: safe to paste-and-run multiple times.

create table if not exists public.trip_suggestions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_date date not null,
  title text not null default '',
  body text not null default '',
  target text not null default 'event',
  category text,
  suggested_time text,
  source_url text,
  outcome text not null default 'pending',
  answered_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists trip_suggestions_trip_day_idx
  on public.trip_suggestions (trip_id, day_date);

alter table public.trip_suggestions
  drop constraint if exists trip_suggestions_outcome_check;
alter table public.trip_suggestions
  add constraint trip_suggestions_outcome_check
  check (outcome in ('pending', 'added', 'dismissed'));

alter table public.trip_suggestions enable row level security;

drop policy if exists trip_suggestions_select on public.trip_suggestions;
create policy trip_suggestions_select on public.trip_suggestions
  for select using (is_trip_workspace_member(trip_id));

drop policy if exists trip_suggestions_insert on public.trip_suggestions;
create policy trip_suggestions_insert on public.trip_suggestions
  for insert with check (is_trip_workspace_member(trip_id));

drop policy if exists trip_suggestions_update on public.trip_suggestions;
create policy trip_suggestions_update on public.trip_suggestions
  for update using (is_trip_workspace_member(trip_id));

drop policy if exists trip_suggestions_delete on public.trip_suggestions;
create policy trip_suggestions_delete on public.trip_suggestions
  for delete using (is_trip_workspace_member(trip_id));
```

- [ ] **Step 2: Write the types**

`src/lib/trips/road-suggestion-types.ts`:

```ts
// Pure types for the proactive suggestion card. No server-only import, so the
// client card and the server query layer can share them (the *-types.ts split).

/** How a suggestion was answered. Only `pending` renders. */
export type SuggestionOutcome = "pending" | "added" | "dismissed"

/** What a suggestion can be added to. Only `event` exists in this slice. */
export type SuggestionTarget = "event"

/** A stored suggestion row. */
export interface RoadSuggestion {
  id: string
  tripId: string
  dayDate: string
  title: string
  body: string
  target: SuggestionTarget
  /** Expense category for the event it creates, e.g. "Food"; "" when none. */
  category: string
  /** HH:MM, or "" when the thing has no clock. */
  suggestedTime: string
  /** Backing URL when it was built on a dispatch finding; "" otherwise. */
  sourceUrl: string
  outcome: SuggestionOutcome
}

/** What the agent proposes. Null from the agent means "nothing worth saying". */
export interface RoadSuggestionProposal {
  title: string
  body: string
  category: string
  suggestedTime: string
  sourceUrl: string
}

/** Everything the card needs to render and to commit its add. */
export interface SuggestionCardData {
  id: string
  title: string
  body: string
  category: string
  suggestedTime: string
  sourceUrl: string
  tripId: string
  tripSlug: string
  dayDate: string
  dayId: string | null
}

/** One answered suggestion, for the history block the agent reads. */
export interface AnsweredSuggestion {
  title: string
  outcome: "added" | "dismissed"
}

/** How many answered suggestions the agent is shown. */
export const SUGGESTION_HISTORY_LIMIT = 10
```

- [ ] **Step 3: Write the queries**

`src/lib/trips/road-suggestion-queries.ts`:

```ts
import { createClient } from "@/lib/supabase/server"
import {
  SUGGESTION_HISTORY_LIMIT,
  type AnsweredSuggestion,
  type RoadSuggestion,
  type SuggestionOutcome,
  type SuggestionTarget,
} from "./road-suggestion-types"

interface SuggestionRow {
  id: string
  trip_id: string
  day_date: string
  title: string
  body: string
  target: string
  category: string | null
  suggested_time: string | null
  source_url: string | null
  outcome: string
}

const SUGGESTION_COLS =
  "id, trip_id, day_date, title, body, target, category, suggested_time, source_url, outcome"

function toSuggestion(row: SuggestionRow): RoadSuggestion {
  return {
    id: row.id,
    tripId: row.trip_id,
    dayDate: row.day_date,
    title: row.title,
    body: row.body,
    target: row.target as SuggestionTarget,
    category: row.category ?? "",
    suggestedTime: row.suggested_time ?? "",
    sourceUrl: row.source_url ?? "",
    outcome: row.outcome as SuggestionOutcome,
  }
}

/** Today's suggestion row, or null when it has not been generated yet. A row
 * with an empty title is a real answer — the agent had nothing — not a miss. */
export async function getSuggestionForDay(
  tripId: string,
  dayDate: string,
): Promise<RoadSuggestion | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("trip_suggestions")
    .select(SUGGESTION_COLS)
    .eq("trip_id", tripId)
    .eq("day_date", dayDate)
    .returns<SuggestionRow[]>()
  if (error) throw new Error(error.message)
  const row = data?.[0]
  return row ? toSuggestion(row) : null
}

/** The trip's recently answered suggestions, newest first — the history the
 * agent reads so it stops repeating itself. Auto-dismissed empty rows are
 * excluded: they record a quiet day, not a judgement. */
export async function getAnsweredSuggestions(
  tripId: string,
): Promise<AnsweredSuggestion[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("trip_suggestions")
    .select("title, outcome")
    .eq("trip_id", tripId)
    .neq("outcome", "pending")
    .neq("title", "")
    .order("day_date", { ascending: false })
    .limit(SUGGESTION_HISTORY_LIMIT)
    .returns<{ title: string; outcome: "added" | "dismissed" }[]>()
  if (error) throw new Error(error.message)
  return data ?? []
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit` then `pnpm lint`
Expected: both clean. Nothing imports these yet, so a failure here is a typo.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260803000002_trip_suggestions.sql src/lib/trips/road-suggestion-types.ts src/lib/trips/road-suggestion-queries.ts
git commit -m "feat(suggestion): store one suggestion per trip-day"
```

---

### Task 2: The agent

**Files:**
- Modify: `src/lib/ai/registry.ts` (add one tool after `propose_dispatch`)
- Create: `src/lib/ai/agents/road-suggestion.ts`
- Modify: `src/lib/ai/claude.ts` (one export line)

**Interfaces:**
- Consumes: `runAgent`, `AgentDescriptor` from `../runtime`; `DispatchItem` from
  `@/lib/trips/dispatch-types`; `RoadSuggestionProposal` from Task 1.
- Produces: `proposeRoadSuggestion(query: RoadSuggestionQuery):
  Promise<RoadSuggestionProposal | null>` and `RoadSuggestionQuery`, both
  re-exported from `@/lib/ai/claude`.

- [ ] **Step 1: Add the tool to the registry**

In `src/lib/ai/registry.ts`, add this entry immediately after the
`propose_dispatch` entry, inside `TOOL_REGISTRY`:

```ts
  propose_road_suggestion: {
    name: "propose_road_suggestion",
    description:
      "Return the one proactive suggestion for today. An empty title is a valid answer.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: {
          type: "string",
          description:
            "The suggestion itself, six words at most — it becomes the itinerary event's text. Empty string when nothing is worth suggesting today.",
        },
        body: {
          type: "string",
          description:
            "One or two sentences on why it fits them today. Empty when title is empty.",
        },
        category: {
          type: "string",
          description:
            "One of the trip's expense categories, exactly as given. Empty when none fits.",
        },
        suggestedTime: {
          type: "string",
          description: "HH:MM 24h when the thing has a clock time, else empty.",
        },
        sourceUrl: {
          type: "string",
          description:
            "The URL of the local finding this is built on. Empty when it is not built on one. Never invented.",
        },
      },
      required: ["title", "body", "category", "suggestedTime", "sourceUrl"],
    },
  },
```

- [ ] **Step 2: Write the descriptor**

`src/lib/ai/agents/road-suggestion.ts`:

```ts
import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"
import type { DispatchItem } from "@/lib/trips/dispatch-types"
import type { RoadSuggestionProposal } from "@/lib/trips/road-suggestion-types"

/**
 * The proactive suggestion AI. Runs once a day beside the dispatch agent, on
 * that agent's findings — it has no search tool of its own. Proposes one thing
 * the couple can add to today, or nothing. Edit `SYSTEM`/`tools` to change it.
 */

export interface RoadSuggestionQuery {
  /** The place they are in today — the itinerary location, else the country. */
  place: string
  dayDate: string
  /** Everything the app knows about this couple, from buildAssistantContext. */
  profileBlock: string
  tasteDirective: string
  /** Today's planned title and summary, or empty. */
  todayPlan: string
  /** What the dispatch agent just found: sourced facts it may build on. */
  dispatchItems: DispatchItem[]
  /** Titles they recently added, so it never repeats one. */
  added: string[]
  /** Titles they recently refused, so it never pushes one again. */
  refused: string[]
  /** The trip's real expense category names. */
  categories: string[]
}

const SYSTEM = [
  "You are the in-app assistant for a couple travelling together, writing the one proactive suggestion they see today.",
  "Never ask questions and never reply conversationally — you cannot receive a reply.",
  "Answer by calling propose_road_suggestion exactly once.",
  "The suggestion must be something they can add to today: somewhere to go, something to eat, something to do.",
  "Ground it in what you are given — their plan for today, what is on locally, who they are. Never invent a place, a price or a date.",
  "Never repeat anything in their recent history, whether they added it or refused it.",
  "The app already warns them about their daily spending cap and about expenses they have not logged. Never say either.",
  "Only set sourceUrl when the suggestion builds on one of the local findings, using that finding's own URL. Never invent one.",
  "Set category to one of the trip's expense categories when one fits, copied exactly. Otherwise leave it empty.",
  "An empty title is a correct and expected answer: a day with a good plan needs nothing from you. Never pad.",
].join(" ")

function suggestionPrompt(query: RoadSuggestionQuery): string {
  const findings = query.dispatchItems
    .map((item) => `${item.title} (${item.window}) ${item.sourceUrl}`)
    .join("; ")
  return [
    `Today is ${query.dayDate}. The couple is in ${query.place}.`,
    query.todayPlan
      ? `Their plan for today: ${query.todayPlan}.`
      : "Nothing is planned for today.",
    findings ? `Happening locally: ${findings}.` : "",
    query.profileBlock ? `What we know about them — ${query.profileBlock}` : "",
    query.tasteDirective,
    query.added.length ? `They recently added: ${query.added.join("; ")}.` : "",
    query.refused.length
      ? `They recently refused: ${query.refused.join("; ")}.`
      : "",
    query.categories.length
      ? `The trip's expense categories: ${query.categories.join(", ")}.`
      : "",
    "Propose one suggestion for today, or an empty title if nothing is worth saying.",
  ]
    .filter(Boolean)
    .join(" ")
}

const roadSuggestion: AgentDescriptor<
  RoadSuggestionQuery,
  RoadSuggestionProposal | null
> = {
  name: "road-suggestion",
  model: "claude-sonnet-4-6",
  maxTokens: 512,
  system: SYSTEM,
  tools: ["propose_road_suggestion"],
  toolChoice: { type: "tool", name: "propose_road_suggestion" },
  mcpServers: [],
  buildInput: (query) => suggestionPrompt(query),
  parseOutput: (message) => {
    const proposal = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_road_suggestion",
    )
    if (!proposal) return null
    const data = proposal.input as Partial<RoadSuggestionProposal>
    const title = (data.title ?? "").trim()
    // An empty title is the agent saying "nothing today" — the one answer that
    // must never become a card.
    if (!title) return null
    return {
      title,
      body: (data.body ?? "").trim(),
      category: (data.category ?? "").trim(),
      suggestedTime: (data.suggestedTime ?? "").trim(),
      sourceUrl: (data.sourceUrl ?? "").trim(),
    }
  },
}

/** One suggestion for today, or null on a day that needs nothing. */
export function proposeRoadSuggestion(
  query: RoadSuggestionQuery,
): Promise<RoadSuggestionProposal | null> {
  return runAgent(roadSuggestion, query)
}
```

- [ ] **Step 3: Export from the seam**

In `src/lib/ai/claude.ts`, after the `generateDispatch` export line, add:

```ts
export {
  proposeRoadSuggestion,
  type RoadSuggestionQuery,
} from "./agents/road-suggestion"
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit` then `pnpm lint`
Expected: both clean. A `Unknown tool` error is impossible at compile time — it
would throw at call time, which Task 3 exercises.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/registry.ts src/lib/ai/agents/road-suggestion.ts src/lib/ai/claude.ts
git commit -m "feat(suggestion): add the road-suggestion agent descriptor"
```

---

### Task 3: Generate it on the daily trigger

**Files:**
- Modify: `src/lib/trips/dispatch-actions.ts` (whole file rewritten below)

**Interfaces:**
- Consumes: `getSuggestionForDay`, `getAnsweredSuggestions` (Task 1);
  `proposeRoadSuggestion`, `RoadSuggestionQuery` (Task 2);
  `getTripExpenseCategories` from `@/lib/trips/expense-queries`.
- Produces: `ensureDispatch(tripSlug, dayDate)` — unchanged signature, now
  generating each half only when that half's row is missing.

- [ ] **Step 1: Rewrite `dispatch-actions.ts`**

```ts
"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { buildAssistantContext } from "@/lib/ai/assistant-context"
import { generateDispatch, proposeRoadSuggestion } from "@/lib/ai/claude"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getTripBySlug } from "@/lib/trips/queries"
import { getTodayForTrip } from "@/lib/trips/itinerary-queries"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { getTripExpenseCategories } from "@/lib/trips/expense-queries"
import { daySummary } from "@/lib/trips/itinerary-types"
import type { DispatchItem } from "@/lib/trips/dispatch-types"
import { getDispatchForDay } from "./dispatch-queries"
import {
  getAnsweredSuggestions,
  getSuggestionForDay,
} from "./road-suggestion-queries"

/**
 * Generate today's dispatch and today's suggestion once each, if missing.
 * Called after paint from the client so the page never waits on a web-search
 * turn. Each half is written even when it is empty — that is what stops a quiet
 * day re-searching on every load.
 */
export async function ensureDispatch(
  tripSlug: string,
  dayDate: string,
): Promise<void> {
  if (!(await isAiEnabled())) return

  const workspace = await getCurrentWorkspace()
  if (!workspace) return
  const trip = await getTripBySlug(workspace.id, tripSlug)
  if (!trip) return

  const dispatch = await getDispatchForDay(trip.id, dayDate)
  const suggestion = await getSuggestionForDay(trip.id, dayDate)
  if (dispatch && suggestion) return

  const day = await getTodayForTrip(trip.id, dayDate)
  const locations = await getItineraryLocations(trip.id)
  const locationName = day?.locationId
    ? locations.find((l) => l.id === day.locationId)?.name ?? null
    : null
  const place = locationName ?? trip.country ?? trip.name
  const todayPlan = day
    ? [day.title, daySummary(day)].filter(Boolean).join(" - ")
    : ""

  const context = await buildAssistantContext(workspace.id, trip.id)
  const supabase = await createClient()

  // The dispatch half owns the only web search. When its row already exists the
  // search is skipped and its stored items still feed the suggestion.
  let items: DispatchItem[] = dispatch?.items ?? []
  if (!dispatch) {
    items = await generateDispatch({
      place,
      dayDate,
      profileBlock: context.profileBlock,
      tasteDirective: context.tasteDirective,
      todayPlan,
    })
    const { error } = await supabase.from("trip_dispatch").upsert(
      {
        trip_id: trip.id,
        day_date: dayDate,
        items,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "trip_id,day_date" },
    )
    if (error) throw new Error(error.message)
  }

  if (!suggestion) {
    const answered = await getAnsweredSuggestions(trip.id)
    const categories = await getTripExpenseCategories(trip.id)
    const proposal = await proposeRoadSuggestion({
      place,
      dayDate,
      profileBlock: context.profileBlock,
      tasteDirective: context.tasteDirective,
      todayPlan,
      dispatchItems: items,
      added: answered.filter((a) => a.outcome === "added").map((a) => a.title),
      refused: answered
        .filter((a) => a.outcome === "dismissed")
        .map((a) => a.title),
      categories: categories.map((c) => c.name),
    })
    // No proposal still writes a row, so a quiet day is asked once, not once
    // per page load. answered_at stays null: nobody answered it.
    const { error } = await supabase.from("trip_suggestions").upsert(
      {
        trip_id: trip.id,
        day_date: dayDate,
        title: proposal?.title ?? "",
        body: proposal?.body ?? "",
        target: "event",
        category: proposal?.category ?? "",
        suggested_time: proposal?.suggestedTime ?? "",
        source_url: proposal?.sourceUrl ?? "",
        outcome: proposal ? "pending" : "dismissed",
      },
      { onConflict: "trip_id,day_date" },
    )
    if (error) throw new Error(error.message)
  }

  revalidatePath("/on-the-road")
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit` then `pnpm lint`
Expected: both clean.

- [ ] **Step 3: Reason through the data path (no code)**

Confirm by reading, and state the answer in the commit or the handover:
- A day with neither row: one search call, one suggestion call, two rows.
- A day with a dispatch row only (every day loaded before this ships): no
  search, one suggestion call, one row — and the suggestion still sees the
  stored `items`.
- A day with both rows: returns before any model call.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/dispatch-actions.ts
git commit -m "feat(suggestion): generate today's suggestion beside the dispatch"
```

---

### Task 4: Answering it

**Files:**
- Create: `src/lib/trips/road-suggestion-actions.ts`

**Interfaces:**
- Consumes: `addTodayEvent` + `AddTodayEventInput` from `./actions`;
  `SuggestionCardData` from Task 1.
- Produces: `addSuggestion(data: SuggestionCardData): Promise<{ error?: string }>`,
  `dismissSuggestion(id: string): Promise<{ error?: string }>`.

- [ ] **Step 1: Write the actions**

`src/lib/trips/road-suggestion-actions.ts`:

```ts
"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { addTodayEvent } from "./actions"
import type { SuggestionCardData } from "./road-suggestion-types"

/** Record how a suggestion was answered. RLS gates the write to workspace
 * members, the same way every other trip write is gated. */
async function answer(
  id: string,
  outcome: "added" | "dismissed",
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("trip_suggestions")
    .update({ outcome, answered_at: new Date().toISOString() })
    .eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/on-the-road")
  return {}
}

/**
 * Take today's suggestion: write it onto today's day through the same action
 * the find door commits through, then record that they took it. The outcome is
 * written only after the event lands — it must never claim an add that did not
 * happen.
 */
export async function addSuggestion(
  data: SuggestionCardData,
): Promise<{ error?: string }> {
  const result = await addTodayEvent({
    tripId: data.tripId,
    tripSlug: data.tripSlug,
    dayDate: data.dayDate,
    dayId: data.dayId,
    time: data.suggestedTime,
    text: data.title,
    url: data.sourceUrl,
    category: data.category,
  })
  if (result.error) return result
  return answer(data.id, "added")
}

/** Refuse today's suggestion. Writes nothing to the trip. */
export async function dismissSuggestion(
  id: string,
): Promise<{ error?: string }> {
  return answer(id, "dismissed")
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit` then `pnpm lint`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/road-suggestion-actions.ts
git commit -m "feat(suggestion): add or dismiss today's suggestion"
```

---

### Task 5: The card in the box

**Files:**
- Create: `src/components/road-suggestion-card.tsx`
- Modify: `src/components/dispatch-box.tsx`
- Modify: `src/app/on-the-road/page.tsx`

**Interfaces:**
- Consumes: `addSuggestion`, `dismissSuggestion` (Task 4); `SuggestionCardData`
  (Task 1); `getSuggestionForDay` (Task 1).
- Produces: `RoadSuggestionCard({ data, onInteract })`; `DispatchBox` gains a
  required `suggestion: SuggestionCardData | null` prop.

- [ ] **Step 1: Write the card**

`src/components/road-suggestion-card.tsx`:

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Label } from "@/components/together"
import {
  addSuggestion,
  dismissSuggestion,
} from "@/lib/trips/road-suggestion-actions"
import type { SuggestionCardData } from "@/lib/trips/road-suggestion-types"

/**
 * The one answerable card in the dispatch box. `add` commits it to today's day
 * through the same action the find door uses; dismiss records the refusal.
 * Either answer removes the card, so there is no answered state to render.
 */
export function RoadSuggestionCard({
  data,
  onInteract,
}: {
  data: SuggestionCardData
  /** Stops the box rotating: a card being answered must not slide away. */
  onInteract: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState("")

  function answer(run: () => Promise<{ error?: string }>) {
    onInteract()
    setError("")
    startTransition(async () => {
      const result = await run()
      if (result.error) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div
      className="rounded-lg border border-border border-l-[3px] border-l-moss bg-card px-3.5 py-3"
      onFocusCapture={onInteract}
    >
      <Label className="text-moss">/ suggested</Label>
      <div className="mt-1 text-[13px] text-foreground">{data.title}</div>
      <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
        {data.body}
      </div>
      <div className="mt-3 flex gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => answer(() => addSuggestion(data))}
          className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-50"
        >
          add to today
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => answer(() => dismissSuggestion(data.id))}
          className="rounded-md border border-border bg-transparent px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground disabled:opacity-50"
        >
          not now
        </button>
      </div>
      {error ? <div className="mt-1.5 text-[11px] text-clay">{error}</div> : null}
    </div>
  )
}
```

- [ ] **Step 2: Put it in the deck**

In `src/components/dispatch-box.tsx`:

Add to the imports:

```tsx
import { RoadSuggestionCard } from "@/components/road-suggestion-card"
import type { SuggestionCardData } from "@/lib/trips/road-suggestion-types"
```

Replace the whole `DispatchBox` function and add `buildCards` after it:

```tsx
export function DispatchBox({
  weather,
  items,
  suggestion,
  storageKey,
  className,
}: {
  weather: Weather | null
  items: DispatchItem[]
  /** Today's unanswered suggestion, or null. Always renders last. */
  suggestion: SuggestionCardData | null
  /** Distinguishes one trip-day from another in localStorage. */
  storageKey: string
  className?: string
}) {
  const isClient = useIsClient()

  if (!weather && items.length === 0 && !suggestion) return null

  // Server and hydration render the first card, static. The live deck takes
  // over immediately after, which is where the random start is chosen.
  if (!isClient) {
    return (
      <Frame
        className={className}
        cards={buildCards(weather, items, suggestion, () => {})}
        index={0}
      />
    )
  }
  return (
    <LiveDeck
      weather={weather}
      items={items}
      suggestion={suggestion}
      storageKey={storageKey}
      className={className}
    />
  )
}

/** The deck in order: weather, today's findings, then the suggestion.
 * `onInteract` is what the suggestion card calls to stop the rotation. */
function buildCards(
  weather: Weather | null,
  items: DispatchItem[],
  suggestion: SuggestionCardData | null,
  onInteract: () => void,
): React.ReactNode[] {
  return [
    ...(weather ? [<WeatherCard key="weather" weather={weather} />] : []),
    ...items.map((item, i) => <ItemCard key={`item-${i}`} item={item} />),
    ...(suggestion
      ? [
          <RoadSuggestionCard
            key="suggestion"
            data={suggestion}
            onInteract={onInteract}
          />,
        ]
      : []),
  ]
}
```

Replace the whole `LiveDeck` function:

```tsx
function LiveDeck({
  weather,
  items,
  suggestion,
  storageKey,
  className,
}: {
  weather: Weather | null
  items: DispatchItem[]
  suggestion: SuggestionCardData | null
  storageKey: string
  className?: string
}) {
  const reduced = useReducedMotion()
  const [stopped, setStopped] = React.useState(false)
  const cards = buildCards(weather, items, suggestion, () => setStopped(true))
  const count = cards.length
  const [index, setIndex] = React.useState(() =>
    pickStart(storageKey, count, weather !== null),
  )
  const [paused, setPaused] = React.useState(false)

  React.useEffect(() => {
    window.localStorage.setItem(seenKey(storageKey), "1")
  }, [storageKey])

  React.useEffect(() => {
    if (count < 2 || paused || reduced || stopped) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), ADVANCE_MS)
    return () => clearInterval(timer)
  }, [count, paused, reduced, stopped])

  // Answering removes the suggestion card, so a held index can outrun the deck.
  // Clamping beats resetting: landing on the last card is the least surprising.
  const active = Math.min(index, count - 1)

  return (
    <Frame
      className={className}
      cards={cards}
      index={active}
      onSelect={setIndex}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    />
  )
}
```

- [ ] **Step 3: Feed it from the page**

In `src/app/on-the-road/page.tsx`:

Add to the imports, beside the `getDispatchForDay` import:

```tsx
import { getSuggestionForDay } from "@/lib/trips/road-suggestion-queries"
```

After the existing `const dispatch = await getDispatchForDay(trip.id, today)`
line, add:

```tsx
  const suggestionRow = await getSuggestionForDay(trip.id, today)
  // Only an unanswered, non-empty row is a card. That one condition covers
  // answered, auto-dismissed-empty, and no row at all.
  const suggestion =
    suggestionRow && suggestionRow.outcome === "pending" && suggestionRow.title
      ? {
          id: suggestionRow.id,
          title: suggestionRow.title,
          body: suggestionRow.body,
          category: suggestionRow.category,
          suggestedTime: suggestionRow.suggestedTime,
          sourceUrl: suggestionRow.sourceUrl,
          tripId: trip.id,
          tripSlug: trip.slug,
          dayDate: today,
          dayId: todayDay?.id ?? null,
        }
      : null
```

Replace the `DispatchBox` element and the trigger condition:

```tsx
          <DispatchBox
            weather={weather}
            items={dispatch?.items ?? []}
            suggestion={suggestion}
            storageKey={`${trip.slug}:${today}`}
            className="mt-3"
          />
          {(!dispatch || !suggestionRow) && aiOn ? (
            <DispatchTrigger tripSlug={trip.slug} dayDate={today} />
          ) : null}
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit` then `pnpm lint`
Expected: both clean. If lint flags the `Label` import path, import it from
`@/components/together` exactly as `page.tsx` does.

- [ ] **Step 5: Build — only with the dev server stopped**

Run: `pnpm build`
Expected: clean. If `pnpm dev` is running, stop it first; a build against a live
`.next` leaves the dev app unstyled.

- [ ] **Step 6: Commit**

```bash
git add src/components/road-suggestion-card.tsx src/components/dispatch-box.tsx src/app/on-the-road/page.tsx
git commit -m "feat(suggestion): answer today's suggestion in the dispatch box"
```

---

### Task 6: Docs

**Files:**
- Modify: `docs/TODO.md` (new entry at the top of "Current Phase")
- Modify: `docs/DECISIONS.md` (append rows)

- [ ] **Step 1: Add the TODO entry**

Write one paragraph in the established house style directly under the dispatch
box entry: what shipped, the two-descriptors-one-trigger shape, the table, the
render condition, what is deferred to slices 2 and 3, **the blocking step
(paste `supabase/migrations/20260803000002_trip_suggestions.sql`)**, and the
in-app checklist from the spec's "Verified by the user in-app" list. Mark it
*implemented*, never *verified*.

- [ ] **Step 2: Append the DECISIONS rows**

Four rows, matching the file's existing column format:
- the dispatch box's read-only rule is superseded for the suggestion card only;
- two descriptors on one trigger rather than one agent with two tools;
- `trip_suggestions` as its own table rather than columns on `trip_dispatch`;
- a dismiss reaches the couple profile only through the trip summary at close.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record the dispatch suggestion card"
```

---

## Self-review

**Spec coverage.** Card + two controls (T5), answering removes it (T5, via the
render condition in T5 step 3), interaction stops rotation (T5), no-suggestion
day (T2 parse + T3 write), one per trip-day (T1 unique index), render condition
(T5 step 3), two agents one trigger (T2, T3), agent contract (T2), history block
(T3), storage (T1), `DispatchTrigger` widening (T5 step 3), add through
`addTodayEvent` with outcome written only on success (T4), dismiss (T4), live
learning (T3). Slices 2 and 3 are explicitly out of this plan.

**Deliberately not built here:** the `refused` TasteSignal kind, packing and
budget targets, and any change to `/ suggest` — all slice 2/3.

**Type consistency.** `SuggestionCardData` is produced in `page.tsx` (T5) and
consumed by `RoadSuggestionCard` and `addSuggestion` (T4, T5) with the same ten
fields. `RoadSuggestionProposal` is produced by the agent (T2) and consumed by
`ensureDispatch` (T3) with the same five. `getSuggestionForDay` returns
`RoadSuggestion | null` in T1 and is used that way in T3 and T5.

