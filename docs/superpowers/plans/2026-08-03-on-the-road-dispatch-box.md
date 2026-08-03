# On-the-road dispatch box — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static weather card at the top of `/on-the-road` with one rotating box holding the weather plus up to two AI-sourced items about what is actually happening where the couple is today.

**Architecture:** A new `trip_dispatch` table stores one row per trip per day. A seventh agent descriptor (`dispatch.ts`) runs `web_search` once per trip-day and writes that row via a server action fired after paint, so page render never waits on Claude. A client `DispatchBox` component stacks the existing `WeatherCard` and the stored items in one CSS grid cell and rotates between them.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4, Supabase (Postgres + RLS), `@anthropic-ai/sdk` 0.106.

**Source spec:** `docs/superpowers/specs/2026-08-03-on-the-road-dispatch-box-design.md`

## Global Constraints

- **No test suite exists in this repo.** Do not invent a test command. Each task verifies with `pnpm lint` then `pnpm build`, plus reasoning about the data path.
- **Do not run `pnpm build` while `pnpm dev` is running** — they share `.next/` and the dev server ends up serving unstyled pages. Stop dev first.
- Migrations are applied **by hand** in the Supabase SQL editor. Every SQL file must be re-runnable (`if not exists` / `drop`-then-`create`).
- **No emojis** in code, comments, or logs.
- Sparse comments — docstrings where the *why* is non-obvious, nothing else.
- `"use client"` files must import types from `*-types.ts`, never from `*-queries.ts` (query files pull `next/headers` and break the client bundle).
- Dates displayed to users are day-before-month (`en-GB`). No `en-US`.
- The AI layer is suggest-only: nothing under `src/lib/ai/` may import a server action or write to the database.
- Item ceiling is **2**. Rotation interval is **7000 ms**.
- Card kinds are exactly `whats_on | disrupted | conditions`. General news headlines are excluded by design.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260803000001_trip_dispatch.sql` | create table, unique index, RLS |
| `src/lib/trips/dispatch-types.ts` | `DispatchItem`, `DispatchKind`, `TripDispatch`, kind labels — client-safe |
| `src/lib/trips/dispatch-queries.ts` | `getDispatchForDay` — server-only read |
| `src/lib/ai/registry.ts` | add the `propose_dispatch` tool definition |
| `src/lib/ai/agents/dispatch.ts` | the descriptor: system prompt, tools, parse |
| `src/lib/ai/claude.ts` | re-export `generateDispatch` |
| `src/lib/trips/dispatch-actions.ts` | `ensureDispatch` server action |
| `src/app/on-the-road/dispatch-trigger.tsx` | fires the action once after paint |
| `src/components/dispatch-box.tsx` | the rotating box |
| `src/app/on-the-road/page.tsx` | wire it in, drop the standalone `WeatherCard` |

---

### Task 1: Table, types and read query

**Files:**
- Create: `supabase/migrations/20260803000001_trip_dispatch.sql`
- Create: `src/lib/trips/dispatch-types.ts`
- Create: `src/lib/trips/dispatch-queries.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DispatchKind`, `DispatchItem`, `TripDispatch`, `DISPATCH_KIND_LABEL` from `dispatch-types.ts`; `getDispatchForDay(tripId: string, dayDate: string): Promise<TripDispatch | null>` from `dispatch-queries.ts`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260803000001_trip_dispatch.sql`:

```sql
-- One AI "dispatch" per trip per day: what is happening where the couple is.
-- Child-table shape of trip_notes, RLS via is_trip_workspace_member().
-- The unique index is what makes generation once-per-day (upsert on conflict).
--
-- Idempotent: safe to paste-and-run multiple times.

create table if not exists public.trip_dispatch (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_date date not null,
  items jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now()
);

create unique index if not exists trip_dispatch_trip_day_idx
  on public.trip_dispatch (trip_id, day_date);

alter table public.trip_dispatch enable row level security;

drop policy if exists trip_dispatch_select on public.trip_dispatch;
create policy trip_dispatch_select on public.trip_dispatch
  for select using (is_trip_workspace_member(trip_id));

drop policy if exists trip_dispatch_insert on public.trip_dispatch;
create policy trip_dispatch_insert on public.trip_dispatch
  for insert with check (is_trip_workspace_member(trip_id));

drop policy if exists trip_dispatch_update on public.trip_dispatch;
create policy trip_dispatch_update on public.trip_dispatch
  for update using (is_trip_workspace_member(trip_id));

drop policy if exists trip_dispatch_delete on public.trip_dispatch;
create policy trip_dispatch_delete on public.trip_dispatch
  for delete using (is_trip_workspace_member(trip_id));
```

- [ ] **Step 2: Write the shared types**

Create `src/lib/trips/dispatch-types.ts`. This file is imported by a `"use client"` component, so it must not import anything server-only:

```ts
/** What kind of thing an item is. General news headlines are excluded by
 * design — see the design doc. */
export type DispatchKind = "whats_on" | "disrupted" | "conditions"

export interface DispatchItem {
  kind: DispatchKind
  title: string
  /** One line on what it is and why it matters today. */
  body: string
  /** The date or span it applies to, e.g. "Sat 8 Aug". Never empty. */
  window: string
  /** Real URL from the web search backing this item. Never empty. */
  sourceUrl: string
}

export interface TripDispatch {
  id: string
  tripId: string
  dayDate: string
  items: DispatchItem[]
  generatedAt: string
}

export const DISPATCH_KIND_LABEL: Record<DispatchKind, string> = {
  whats_on: "What's on",
  disrupted: "Heads up",
  conditions: "Conditions",
}

/** The most items one day's dispatch may carry. */
export const MAX_DISPATCH_ITEMS = 2
```

- [ ] **Step 3: Write the read query**

Create `src/lib/trips/dispatch-queries.ts`, following the `note-queries.ts` row-mapping style:

```ts
import { createClient } from "@/lib/supabase/server"
import type { DispatchItem, TripDispatch } from "./dispatch-types"

interface TripDispatchRow {
  id: string
  trip_id: string
  day_date: string
  items: DispatchItem[]
  generated_at: string
}

const DISPATCH_COLS = "id, trip_id, day_date, items, generated_at"

/** Today's dispatch for a trip, or null when it has not been generated yet.
 * A row with zero items is a real answer, not a miss. */
export async function getDispatchForDay(
  tripId: string,
  dayDate: string,
): Promise<TripDispatch | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("trip_dispatch")
    .select(DISPATCH_COLS)
    .eq("trip_id", tripId)
    .eq("day_date", dayDate)
    .returns<TripDispatchRow[]>()
  if (error) throw new Error(error.message)
  const row = data?.[0]
  if (!row) return null
  return {
    id: row.id,
    tripId: row.trip_id,
    dayDate: row.day_date,
    items: row.items ?? [],
    generatedAt: row.generated_at,
  }
}
```

- [ ] **Step 4: Lint and build**

Run: `pnpm lint` then `pnpm build`
Expected: both clean. Nothing imports these files yet, so this only proves they compile.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260803000001_trip_dispatch.sql src/lib/trips/dispatch-types.ts src/lib/trips/dispatch-queries.ts
git commit -m "feat(dispatch): store one dispatch per trip-day"
```

- [ ] **Step 6: Tell the user to paste the migration**

The migration is applied by hand. Say explicitly: paste `supabase/migrations/20260803000001_trip_dispatch.sql` into the Supabase SQL editor and run it, or the feature will fail at runtime with a missing-table error.

---

### Task 2: The agent

**Files:**
- Modify: `src/lib/ai/registry.ts` (add one entry to `TOOL_REGISTRY`)
- Create: `src/lib/ai/agents/dispatch.ts`
- Modify: `src/lib/ai/claude.ts` (one re-export line)

**Interfaces:**
- Consumes: `DispatchItem`, `MAX_DISPATCH_ITEMS` from Task 1.
- Produces: `generateDispatch(query: DispatchQuery): Promise<DispatchItem[]>` and `interface DispatchQuery { place: string; dayDate: string; profileBlock: string; tasteDirective: string; todayPlan: string }`, both exported from `src/lib/ai/claude.ts`.

- [ ] **Step 1: Add the tool to the registry**

In `src/lib/ai/registry.ts`, add this entry to `TOOL_REGISTRY` after `propose_suggestion`:

```ts
  propose_dispatch: {
    name: "propose_dispatch",
    description:
      "Return up to two things happening where the couple is today. An empty list is a valid answer.",
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
              kind: {
                type: "string",
                enum: ["whats_on", "disrupted", "conditions"],
                description:
                  "whats_on: a festival, market, holiday, concert or match. disrupted: a strike, closure, protest or weather warning. conditions: surf, snow, tide, air quality — something they care about doing.",
              },
              title: {
                type: "string",
                description: "The name of the thing. Six words at most.",
              },
              body: {
                type: "string",
                description:
                  "One sentence on what it is and why it matters to them today.",
              },
              window: {
                type: "string",
                description:
                  "The date or span it applies to, e.g. 'Sat 8 Aug' or 'through the weekend'. Never empty — if you cannot date it, do not return it.",
              },
              sourceUrl: {
                type: "string",
                description:
                  "A real URL from the web search backing this item. Never empty, never invented.",
              },
            },
            required: ["kind", "title", "body", "window", "sourceUrl"],
          },
        },
      },
      required: ["items"],
    },
  },
```

- [ ] **Step 2: Write the descriptor**

Create `src/lib/ai/agents/dispatch.ts`:

```ts
import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"
import {
  MAX_DISPATCH_ITEMS,
  type DispatchItem,
} from "@/lib/trips/dispatch-types"

/**
 * The dispatch AI. Once a day, searches for what is actually happening where
 * the couple is right now and returns at most two items. Read-only: the card it
 * feeds has no actions. Edit `SYSTEM`/`tools` to change it.
 */

export interface DispatchQuery {
  /** The place to search — today's itinerary location, else the country. */
  place: string
  dayDate: string
  /** Everything the app knows about this couple, from buildAssistantContext. */
  profileBlock: string
  tasteDirective: string
  /** Today's planned title and summary, or empty. */
  todayPlan: string
}

const SYSTEM = [
  "You brief a couple on what is happening where they are travelling today.",
  "Never ask questions and never reply conversationally — you cannot receive a reply.",
  "On every request you MUST use the web_search tool first, then call propose_dispatch.",
  "Only three kinds of thing qualify:",
  "(1) whats_on — a festival, market, saint's day, public holiday, concert or match on or near their dates;",
  "(2) disrupted — a transport strike, closure, protest or weather warning that changes their day;",
  "(3) conditions — surf, snow, tide, jellyfish or air quality, but ONLY when what you know about this couple says they care about that activity.",
  "Never return general news: no politics, no crime, no economy. Those do not change their day.",
  "Every item MUST carry a window (a real date or span) and a sourceUrl from a search result.",
  "If you cannot date it or cannot source it, drop it.",
  `Return at most ${MAX_DISPATCH_ITEMS} items, the best ones.`,
  "Returning an empty list is a correct and expected answer: most places on most days have nothing worth saying.",
  "Never pad the list with a generic guidebook fact about the destination. Nothing is better than filler.",
].join(" ")

function dispatchPrompt(query: DispatchQuery): string {
  return [
    `Today is ${query.dayDate}. The couple is in ${query.place}.`,
    query.todayPlan ? `Their plan for today: ${query.todayPlan}.` : "",
    query.profileBlock ? `What we know about them — ${query.profileBlock}` : "",
    query.tasteDirective,
    `Search for what is on, what is disrupted, and any conditions in ${query.place} for today and the next few days, then call propose_dispatch.`,
  ]
    .filter(Boolean)
    .join(" ")
}

const dispatch: AgentDescriptor<DispatchQuery, DispatchItem[]> = {
  name: "dispatch",
  model: "claude-sonnet-4-6",
  maxTokens: 1024,
  maxTurns: 6,
  system: SYSTEM,
  tools: ["web_search_short", "propose_dispatch"],
  mcpServers: [],
  buildInput: (query) => dispatchPrompt(query),
  parseOutput: (message) => {
    const proposal = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_dispatch",
    )
    if (!proposal) return []
    const data = proposal.input as { items?: DispatchItem[] }
    // The window and source rules are contract, not taste: an undated or
    // unsourced item is the failure mode this card exists to avoid.
    return (data.items ?? [])
      .filter((item) => item.window?.trim() && item.sourceUrl?.trim())
      .slice(0, MAX_DISPATCH_ITEMS)
  },
}

/** What is happening where they are today. Returns [] on a quiet day. */
export function generateDispatch(
  query: DispatchQuery,
): Promise<DispatchItem[]> {
  return runAgent(dispatch, query)
}
```

- [ ] **Step 3: Re-export from the seam**

In `src/lib/ai/claude.ts`, add after the `generateSuggestion` export:

```ts
export { generateDispatch, type DispatchQuery } from "./agents/dispatch"
```

- [ ] **Step 4: Lint and build**

Run: `pnpm lint` then `pnpm build`
Expected: both clean. A typo in the tool name would only fail at call time (`resolveTools` throws on unknown names), so re-read that `tools: ["web_search_short", "propose_dispatch"]` matches the registry keys exactly.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/registry.ts src/lib/ai/agents/dispatch.ts src/lib/ai/claude.ts
git commit -m "feat(dispatch): add the dispatch agent descriptor"
```

---

### Task 3: Generation — server action and after-paint trigger

**Files:**
- Create: `src/lib/trips/dispatch-actions.ts`
- Create: `src/app/on-the-road/dispatch-trigger.tsx`

**Interfaces:**
- Consumes: `getDispatchForDay` (Task 1), `generateDispatch` + `DispatchQuery` (Task 2).
- Produces: `ensureDispatch(tripSlug: string, dayDate: string): Promise<void>`; `<DispatchTrigger tripSlug={string} dayDate={string} />`.

- [ ] **Step 1: Write the server action**

Create `src/lib/trips/dispatch-actions.ts`. It takes a **slug**, not an id, so the workspace lookup re-authorises the caller — the same shape `suggestion-actions.ts` uses:

```ts
"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { isAiEnabled } from "@/lib/ai/ai-mode"
import { buildAssistantContext } from "@/lib/ai/assistant-context"
import { generateDispatch } from "@/lib/ai/claude"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getTripBySlug } from "@/lib/trips/queries"
import { getTodayForTrip } from "@/lib/trips/itinerary-queries"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { daySummary } from "@/lib/trips/itinerary-types"
import { getDispatchForDay } from "./dispatch-queries"

/**
 * Generate today's dispatch once, if it does not exist yet. Called after paint
 * from the client so the page never waits on a web-search turn. A row with zero
 * items still gets written — that is what stops a quiet day re-searching on
 * every load.
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
  if (await getDispatchForDay(trip.id, dayDate)) return

  const day = await getTodayForTrip(trip.id, dayDate)
  const locations = await getItineraryLocations(trip.id)
  const locationName = day?.locationId
    ? locations.find((l) => l.id === day.locationId)?.name ?? null
    : null
  const place = locationName ?? trip.country ?? trip.name

  const context = await buildAssistantContext(workspace.id, trip.id)
  const items = await generateDispatch({
    place,
    dayDate,
    profileBlock: context.profileBlock,
    tasteDirective: context.tasteDirective,
    todayPlan: day ? [day.title, daySummary(day)].filter(Boolean).join(" - ") : "",
  })

  const supabase = await createClient()
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

  revalidatePath("/on-the-road")
}
```

- [ ] **Step 2: Write the trigger component**

Create `src/app/on-the-road/dispatch-trigger.tsx`. It renders nothing; the page mounts it only when today's row is missing:

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { ensureDispatch } from "@/lib/trips/dispatch-actions"

/** Fires today's dispatch generation once after paint, then refreshes so the
 * box picks up the stored row. Renders nothing. */
export function DispatchTrigger({
  tripSlug,
  dayDate,
}: {
  tripSlug: string
  dayDate: string
}) {
  const router = useRouter()
  React.useEffect(() => {
    let cancelled = false
    ensureDispatch(tripSlug, dayDate).then(() => {
      if (!cancelled) router.refresh()
    })
    return () => {
      cancelled = true
    }
  }, [tripSlug, dayDate, router])
  return null
}
```

- [ ] **Step 3: Lint and build**

Run: `pnpm lint` then `pnpm build`
Expected: both clean.

If `daySummary(day)` is typed as `string | null`, `[day.title, daySummary(day)].filter(Boolean).join(" - ")` still type-checks as `string` because `filter(Boolean)` keeps the array `(string | null)[]` and `join` accepts it. If TypeScript complains, change to `[day.title, daySummary(day) ?? ""].filter(Boolean).join(" - ")`.

- [ ] **Step 4: Reason through the once-a-day guarantee**

Confirm by reading, not running: `ensureDispatch` returns early when `getDispatchForDay` finds a row; the `upsert` targets the `trip_dispatch_trip_day_idx` unique index via `onConflict: "trip_id,day_date"`, so two concurrent first-loads (you and your partner, same morning) produce one row rather than a duplicate-key error. Both may issue a model call in that race; that is an acceptable once-per-trip-day-per-partner ceiling and is not worth a lock.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/dispatch-actions.ts src/app/on-the-road/dispatch-trigger.tsx
git commit -m "feat(dispatch): generate today's dispatch after paint"
```

---

### Task 4: The rotating box, wired into the page

**Files:**
- Create: `src/components/dispatch-box.tsx`
- Modify: `src/app/on-the-road/page.tsx`

**Interfaces:**
- Consumes: `DispatchItem` + `DISPATCH_KIND_LABEL` (Task 1), `getDispatchForDay` (Task 1), `DispatchTrigger` (Task 3), the existing `WeatherCard` and `Weather` type.
- Produces: `<DispatchBox weather={Weather | null} items={DispatchItem[]} storageKey={string} className?={string} />`.

- [ ] **Step 1: Write the box**

Create `src/components/dispatch-box.tsx`. Three things in here are deliberate and easy to "simplify" wrongly — read the docstrings before changing them: the grid stack (gives a stable height with no measurement), the after-mount random index (a `Math.random()` during render is a hydration mismatch), and the pointer/focus pause.

```tsx
"use client"

import * as React from "react"

import { WeatherCard } from "@/components/weather-card"
import type { Weather } from "@/lib/weather/get-weather"
import {
  DISPATCH_KIND_LABEL,
  type DispatchItem,
} from "@/lib/trips/dispatch-types"

const ADVANCE_MS = 7000

/**
 * The one ambient box at the top of /on-the-road: weather first, then today's
 * dispatch items. Rotates itself; pauses whenever the user is touching, hovering
 * or focused inside it. With a single card it is a plain static card — no dots,
 * no timer — which is the common, quiet-day state.
 */
export function DispatchBox({
  weather,
  items,
  storageKey,
  className,
}: {
  weather: Weather | null
  items: DispatchItem[]
  /** Distinguishes one trip-day from another in localStorage. */
  storageKey: string
  className?: string
}) {
  const count = (weather ? 1 : 0) + items.length
  const hasWeather = weather !== null

  const [index, setIndex] = React.useState(0)
  const [paused, setPaused] = React.useState(false)
  const [reduced, setReduced] = React.useState(false)

  React.useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  }, [])

  // Start position. First visit of the day opens on weather; every later visit
  // that day opens on a random dispatch card, because the timer resets on each
  // load and a weather-first box would otherwise be the only thing short visits
  // ever show. Per-device by design: each partner gets their own first visit.
  React.useEffect(() => {
    const key = `dispatch-seen:${storageKey}`
    if (window.localStorage.getItem(key) === null) {
      window.localStorage.setItem(key, "1")
      return
    }
    const first = hasWeather ? 1 : 0
    const pool = count - first
    if (pool > 0) setIndex(first + Math.floor(Math.random() * pool))
  }, [storageKey, count, hasWeather])

  React.useEffect(() => {
    if (count < 2 || paused || reduced) return
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % count),
      ADVANCE_MS,
    )
    return () => clearInterval(timer)
  }, [count, paused, reduced])

  if (count === 0) return null

  const cards: React.ReactNode[] = [
    ...(weather ? [<WeatherCard key="weather" weather={weather} />] : []),
    ...items.map((item, i) => <ItemCard key={`item-${i}`} item={item} />),
  ]

  return (
    <div
      className={className}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* Every card occupies the same grid cell, so the box is as tall as its
          tallest card and the page never reflows as it rotates. */}
      <div className="grid">
        {cards.map((card, i) => (
          <div
            key={i}
            className={`col-start-1 row-start-1 ${i === index ? "" : "invisible"}`}
            inert={i !== index}
          >
            {card}
          </div>
        ))}
      </div>
      {count > 1 ? (
        <div className="mt-2 flex justify-center gap-1.5">
          {cards.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Show card ${i + 1} of ${count}`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${
                i === index ? "bg-foreground" : "bg-border"
              }`}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ItemCard({ item }: { item: DispatchItem }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {DISPATCH_KIND_LABEL[item.kind]}
      </div>
      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-1 block text-[13px] text-foreground underline-offset-2 hover:underline"
      >
        {item.title}
      </a>
      <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
        {item.body}
      </div>
      <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {item.window}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the page**

In `src/app/on-the-road/page.tsx`:

Replace the `WeatherCard` import with the two new components and add the query + AI-mode imports:

```ts
import { DispatchBox } from "@/components/dispatch-box"
import { DispatchTrigger } from "./dispatch-trigger"
import { getDispatchForDay } from "@/lib/trips/dispatch-queries"
import { isAiEnabled } from "@/lib/ai/ai-mode"
```

(`import { WeatherCard } from "@/components/weather-card"` comes out — the box renders it now.)

After the existing `const weather = await getTripWeather(weatherPlace)` line, add:

```ts
  const dispatch = await getDispatchForDay(trip.id, today)
  const aiOn = await isAiEnabled()
```

Then replace this line in the headline section:

```tsx
          {weather ? <WeatherCard weather={weather} className="mt-3" /> : null}
```

with:

```tsx
          <DispatchBox
            weather={weather}
            items={dispatch?.items ?? []}
            storageKey={`${trip.slug}:${today}`}
            className="mt-3"
          />
          {!dispatch && aiOn ? (
            <DispatchTrigger tripSlug={trip.slug} dayDate={today} />
          ) : null}
```

- [ ] **Step 3: Lint and build**

Run: `pnpm lint` then `pnpm build`
Expected: both clean.

Two likely lint complaints and their fixes: `react-hooks/exhaustive-deps` on the start-position effect (the deps listed — `storageKey`, `count`, `hasWeather` — are complete and correct; if it still complains, the cause is a typo in the array); and the `inert` prop, which React 19 supports as a boolean — if types reject it, the installed React types are older than expected, so check `pnpm list @types/react` before working around it.

- [ ] **Step 4: Reason through the render path**

Confirm by reading: the page's `await` chain contains no model call — `getDispatchForDay` is a table read. `DispatchTrigger` mounts only when `dispatch` is null **and** AI mode is on, so a quiet day that already has a zero-item row never re-triggers. With `weather` non-null and `items` empty, `count === 1`, so the box renders one static `WeatherCard` with no dots and no interval — identical to the current page.

- [ ] **Step 5: Commit**

```bash
git add src/components/dispatch-box.tsx src/app/on-the-road/page.tsx
git commit -m "feat(dispatch): rotate weather and dispatch in one box"
```

---

### Task 5: Docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Add the TODO entry**

Add an entry recording the slice as **implemented, unverified in app**, following the file's existing format, and listing the user-verified success criteria from the spec as the in-app checklist.

- [ ] **Step 2: Add the decision rows**

Append rows for the two non-obvious choices, in the file's existing column format:

- Dispatch cards are read-only, and general news headlines are excluded by design — suggestions live in the assistant block, and non-actionable headlines make the box worse.
- The box opens on weather only on the first visit of the day, then on a random dispatch card — the rotation timer resets on every page load, so a fixed weather-first order would mean short visits never see anything else.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record the dispatch box slice"
```

---

## Self-review

**Spec coverage.** Table and RLS → Task 1. Content contract, the three kinds, headlines excluded, mandatory `window`/`sourceUrl`, zero-items-valid, max 2 → Task 2 (prompt, tool schema, and the `parseOutput` filter). Inferred interests via `buildAssistantContext` + `TASTE_DIRECTIVE` → Tasks 2 and 3. Once-a-day persistence, never blocking render, zero-item rows counting as generated, `isAiEnabled` off, location fallback, no travel-day special case, no force-regenerate → Task 3. Box placement, stack order, 7 s auto-advance, dots, pause on interaction, `prefers-reduced-motion`, one-card-no-carousel, stable height, first-visit-weather-then-random, per-device `localStorage`, after-mount random index → Task 4. Read-only cards: no action handlers exist anywhere in `ItemCard`. `/on-the-road`-only scope: no other page is touched.

**Placeholders.** None — every code step carries the full file or the exact replacement text.

**Type consistency.** `DispatchItem` fields (`kind`, `title`, `body`, `window`, `sourceUrl`) match across the tool schema, the type file, the agent's filter, and `ItemCard`. `getDispatchForDay(tripId, dayDate)` is called with a trip **id** in both Task 3 and Task 4; `ensureDispatch(tripSlug, dayDate)` takes a **slug** in both its definition and the `DispatchTrigger` call. `MAX_DISPATCH_ITEMS` is defined once in Task 1 and used by the prompt and the slice in Task 2.

