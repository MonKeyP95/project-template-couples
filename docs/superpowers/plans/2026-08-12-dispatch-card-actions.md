# Dispatch Card Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a dispatch card on `/on-the-road` pressable, so a found event can be added to an itinerary date or expanded with a follow-up search, without leaving the card.

**Architecture:** One new agent descriptor (`dispatch-detail`) behind the existing `runAgent` seam, one new registry tool (`propose_detail`), one new server action (`learnAboutItem`) beside `ensureDispatch`, and a component split that moves the item card out of `dispatch-box.tsx` into its own client file that owns the expanded state, the add row, and the detail panel.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4, `@anthropic-ai/sdk` 0.106, Supabase (existing `trip_dispatch` table — no migration).

Spec: `docs/superpowers/specs/2026-08-12-dispatch-card-actions-design.md`

## Global Constraints

- No test framework exists in this repo. Every task verifies with `pnpm lint` and, where types change across files, `pnpm build`. Do not invent a test command.
- Do not run `pnpm build` while `pnpm dev` is running — they share `.next/` and the dev server ends up serving unstyled pages.
- No new table, no migration. `trip_dispatch` is unchanged; nothing about learn-more is persisted.
- No emojis in code, comments, or strings.
- Client components (`"use client"`) must import types from `*-types.ts` modules, never from `*-queries.ts`.
- `@/lib/ai/claude.ts` stays the only import seam for AI entry points. No caller imports `agents/*.ts` directly.
- Dates displayed to the user are day-before-month (`en-GB`).
- Every AI call goes through `runAgent`. No provider-agnostic abstraction.

---

### Task 1: The detail agent (types, tool, descriptor, seam)

Server-side only. Nothing renders yet; this task ends with a callable
`generateDispatchDetail`.

**Files:**
- Modify: `src/lib/trips/dispatch-types.ts`
- Modify: `src/lib/ai/registry.ts` (append inside `TOOL_REGISTRY`, after `propose_dispatch`)
- Create: `src/lib/ai/agents/dispatch-detail.ts`
- Modify: `src/lib/ai/claude.ts`

**Interfaces:**
- Consumes: `runAgent`, `AgentDescriptor` from `../runtime`; `DispatchItem` from `@/lib/trips/dispatch-types`.
- Produces:
  - `interface DispatchLink { label: string; url: string }`
  - `interface DispatchDetail { detail: string; links: DispatchLink[] }` (both in `dispatch-types.ts`, client-safe)
  - `interface DispatchDetailQuery { place: string; dayDate: string; item: DispatchItem; question: string }`
  - `generateDispatchDetail(query: DispatchDetailQuery): Promise<DispatchDetail>`, re-exported from `@/lib/ai/claude`.

- [ ] **Step 1: Add the detail types**

Append to `src/lib/trips/dispatch-types.ts`:

```ts
export interface DispatchLink {
  /** Three words at most — this is a chip, not a sentence. */
  label: string
  url: string
}

/** What "learn more" returns for one card: a short answer plus real links.
 * Page-lifetime only — never stored on the dispatch row. */
export interface DispatchDetail {
  detail: string
  links: DispatchLink[]
}
```

- [ ] **Step 2: Register the `propose_detail` tool**

In `src/lib/ai/registry.ts`, inside `TOOL_REGISTRY`, after the `propose_dispatch` entry:

```ts
  propose_detail: {
    name: "propose_detail",
    description:
      "Return what the couple wanted to know about one dispatch item, with real links.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        detail: {
          type: "string",
          description:
            "Two to four sentences answering what was asked about this one item. No preamble, no restating the question.",
        },
        links: {
          type: "array",
          description:
            "Up to three real URLs from the search that back the answer. An empty list is allowed.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: {
                type: "string",
                description: "Three words at most, e.g. 'Official programme'.",
              },
              url: {
                type: "string",
                description:
                  "A real URL from a search result. Never invented.",
              },
            },
            required: ["label", "url"],
          },
        },
      },
      required: ["detail", "links"],
    },
  },
```

- [ ] **Step 3: Write the agent descriptor**

Create `src/lib/ai/agents/dispatch-detail.ts`:

```ts
import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { runAgent, type AgentDescriptor } from "../runtime"
import type { DispatchDetail, DispatchItem } from "@/lib/trips/dispatch-types"

/**
 * The dispatch-detail AI. Expands one dispatch card: with no question it tells
 * the couple what they need in order to decide whether to go; with one it
 * answers that instead. Read-only. Edit `SYSTEM`/`tools` to change it.
 */

export interface DispatchDetailQuery {
  /** Where they are — today's itinerary location, else the country. */
  place: string
  dayDate: string
  item: DispatchItem
  /** The couple's own follow-up, or empty on the first press. */
  question: string
}

const SYSTEM = [
  "You expand on one thing a couple has been told is happening where they are travelling.",
  "Never ask questions and never reply conversationally — you cannot receive a reply.",
  "On every request you MUST use the web_search tool first, then call propose_detail.",
  "Answer only about the item you are given. Never drift onto other events.",
  "Never invent a time, a price, an address or a URL: if the search does not say it, say it is not published.",
  "Keep it to what a couple standing there would need. No history lesson, no filler.",
].join(" ")

function detailPrompt(query: DispatchDetailQuery): string {
  const { item } = query
  const ask = query.question.trim()
  return [
    `Today is ${query.dayDate}. The couple is in ${query.place}.`,
    `They are looking at this item: "${item.title}" — ${item.body} (${item.window}). Source: ${item.sourceUrl}.`,
    ask
      ? `They asked: "${ask}". Search, then answer that question about this item.`
      : "Search, then tell them what they need in order to decide whether to go: what it is, where exactly, when exactly, what it costs, and how to get there.",
    "Then call propose_detail.",
  ].join(" ")
}

const EMPTY: DispatchDetail = { detail: "", links: [] }

const dispatchDetail: AgentDescriptor<DispatchDetailQuery, DispatchDetail> = {
  name: "dispatch-detail",
  model: "claude-sonnet-4-6",
  maxTokens: 1024,
  maxTurns: 6,
  system: SYSTEM,
  tools: ["web_search_short", "propose_detail"],
  mcpServers: [],
  buildInput: (query) => detailPrompt(query),
  parseOutput: (message) => {
    const proposal = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "propose_detail",
    )
    if (!proposal) return EMPTY
    const data = proposal.input as Partial<DispatchDetail>
    return {
      detail: data.detail ?? "",
      // A link with no url cannot be rendered as an anchor.
      links: (data.links ?? []).filter((link) => link.url?.trim()).slice(0, 3),
    }
  },
}

/** More on one dispatch item, optionally answering the couple's own question. */
export function generateDispatchDetail(
  query: DispatchDetailQuery,
): Promise<DispatchDetail> {
  return runAgent(dispatchDetail, query)
}
```

- [ ] **Step 4: Re-export from the seam**

In `src/lib/ai/claude.ts`, after the `generateDispatch` export:

```ts
export {
  generateDispatchDetail,
  type DispatchDetailQuery,
} from "./agents/dispatch-detail"
```

- [ ] **Step 5: Verify**

Run: `pnpm lint`
Expected: clean, no new warnings.

- [ ] **Step 6: Commit**

```bash
git add src/lib/trips/dispatch-types.ts src/lib/ai/registry.ts src/lib/ai/agents/dispatch-detail.ts src/lib/ai/claude.ts
git commit -m "feat(dispatch): add the dispatch-detail agent behind the claude seam"
```

---

### Task 2: The `learnAboutItem` server action

**Files:**
- Modify: `src/lib/trips/dispatch-actions.ts`

**Interfaces:**
- Consumes: `generateDispatchDetail`, `DispatchDetailQuery` from Task 1; existing `getDispatchForDay`, `getTodayForTrip`, `getItineraryLocations`, `daySummary`, `isAiEnabled`, `getCurrentWorkspace`, `getTripBySlug`.
- Produces: `learnAboutItem(tripSlug: string, dayDate: string, itemIndex: number, question: string): Promise<{ detail?: DispatchDetail; error?: string }>`

- [ ] **Step 1: Extract the shared day context**

`ensureDispatch` currently derives `place` and `todayPlan` inline. Both are
needed by the new action, and the two must never disagree. In
`src/lib/trips/dispatch-actions.ts`, add this helper above `ensureDispatch`:

```ts
/** Where the couple is that day and what they had planned. Shared by the
 * dispatch and by the detail behind one of its cards, so the two agree. */
async function dayContext(
  trip: { id: string; name: string; country: string | null },
  dayDate: string,
): Promise<{ place: string; todayPlan: string }> {
  const day = await getTodayForTrip(trip.id, dayDate)
  const locations = await getItineraryLocations(trip.id)
  const locationName = day?.locationId
    ? locations.find((l) => l.id === day.locationId)?.name ?? null
    : null
  return {
    place: locationName ?? trip.country ?? trip.name,
    todayPlan: day
      ? [day.title, daySummary(day)].filter(Boolean).join(" - ")
      : "",
  }
}
```

- [ ] **Step 2: Point `ensureDispatch` at the helper**

Replace the block in `ensureDispatch` that runs from `const day = await getTodayForTrip(...)`
through `const todayPlan = ...` with:

```ts
  const { place, todayPlan } = await dayContext(trip, dayDate)
```

Everything below it (`buildAssistantContext`, `generateDispatch`, the upsert)
is unchanged and still reads `place` and `todayPlan`.

- [ ] **Step 3: Add the imports**

At the top of `src/lib/trips/dispatch-actions.ts`, extend the existing imports:

```ts
import { generateDispatch, generateDispatchDetail } from "@/lib/ai/claude"
import type { DispatchDetail } from "@/lib/trips/dispatch-types"
```

(`generateDispatch` is already imported — add `generateDispatchDetail` to that
same line rather than a second import statement.)

- [ ] **Step 4: Write the action**

Append to `src/lib/trips/dispatch-actions.ts`:

```ts
/**
 * More on one card in today's dispatch, optionally answering the couple's own
 * question. The item is read from the stored row by index — the client's copy
 * is never trusted as prompt input. Reads only: nothing is written, nothing is
 * revalidated, nothing is cached.
 */
export async function learnAboutItem(
  tripSlug: string,
  dayDate: string,
  itemIndex: number,
  question: string,
): Promise<{ detail?: DispatchDetail; error?: string }> {
  if (!(await isAiEnabled())) return { error: "AI mode is off." }

  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }
  const trip = await getTripBySlug(workspace.id, tripSlug)
  if (!trip) return { error: "No trip in context." }

  const dispatch = await getDispatchForDay(trip.id, dayDate)
  const item = dispatch?.items[itemIndex]
  if (!item) return { error: "That card is no longer here." }

  try {
    const { place } = await dayContext(trip, dayDate)
    const detail = await generateDispatchDetail({
      place,
      dayDate,
      item,
      question: question.trim(),
    })
    return { detail }
  } catch {
    return { error: "Couldn't reach the assistant." }
  }
}
```

- [ ] **Step 5: Verify**

Run: `pnpm lint`
Expected: clean.

Then read the changed `ensureDispatch` body once and confirm `place` and
`todayPlan` are still the same two values it passed to `generateDispatch`
before the refactor.

- [ ] **Step 6: Commit**

```bash
git add src/lib/trips/dispatch-actions.ts
git commit -m "feat(dispatch): add learnAboutItem, sharing day context with ensureDispatch"
```

---

### Task 3: Lift `normalizeTime` out of the discovery component

**Files:**
- Create: `src/lib/trips/event-time.ts`
- Modify: `src/components/discovery-section.tsx:13-21` (delete the local copy, import instead)

**Interfaces:**
- Produces: `normalizeTime(raw: string): string`

- [ ] **Step 1: Create the module**

Create `src/lib/trips/event-time.ts`:

```ts
/** Normalize a typed time to "HH:MM": "18" -> "18:00", "9:5" -> "09:05".
 * Leaves blanks and unrecognized input untouched. */
export function normalizeTime(raw: string): string {
  const v = raw.trim()
  if (!v) return ""
  const m = v.match(/^(\d{1,2})(?::?(\d{1,2}))?$/)
  if (!m) return v
  return `${m[1].padStart(2, "0")}:${(m[2] ?? "0").padStart(2, "0")}`
}
```

- [ ] **Step 2: Point the discovery component at it**

In `src/components/discovery-section.tsx`, delete the local `normalizeTime`
function (the doc comment and body, lines 13-21) and add to the imports:

```ts
import { normalizeTime } from "@/lib/trips/event-time"
```

Both call sites (`normalizeTime(time)` in `commit`, and the `onBlur` handler)
are unchanged.

- [ ] **Step 3: Verify**

Run: `pnpm lint`
Expected: clean — in particular no "normalizeTime is defined but never used".

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/event-time.ts src/components/discovery-section.tsx
git commit -m "refactor(trips): lift normalizeTime into its own module"
```

---

### Task 4: The item card component

Extract the card out of the deck and give it the expanded state, the add row,
and the detail panel. The deck does not know about any of it yet — Task 5 wires
it up — so after this task the new file exists and compiles but nothing renders
it. That is intentional: the card is big enough to review on its own.

**Files:**
- Create: `src/components/dispatch-item-card.tsx`

**Interfaces:**
- Consumes: `learnAboutItem` (Task 2), `DispatchDetail` (Task 1), `normalizeTime` (Task 3), existing `addTodayEvent` and `DISPATCH_KIND_LABEL`.
- Produces:
  - `interface DispatchDay { id: string; dayDate: string; label: string }`
  - `DispatchItemCard` with props `{ item: DispatchItem; index: number; tripId: string; tripSlug: string; today: string; days: DispatchDay[]; expanded: boolean; onToggle: (expanded: boolean) => void }`

- [ ] **Step 1: Write the file**

Create `src/components/dispatch-item-card.tsx`:

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { addTodayEvent } from "@/lib/trips/actions"
import { learnAboutItem } from "@/lib/trips/dispatch-actions"
import { normalizeTime } from "@/lib/trips/event-time"
import {
  DISPATCH_KIND_LABEL,
  type DispatchDetail,
  type DispatchItem,
} from "@/lib/trips/dispatch-types"

/** One itinerary day the card can drop an event on. */
export interface DispatchDay {
  id: string
  dayDate: string
  label: string
}

/** whats_on is a thing you go and do; a strike or a swell is not. Drives the
 * default category on the event's expense form. */
function eventCategory(item: DispatchItem): string | undefined {
  return item.kind === "whats_on" ? "Activities" : undefined
}

/**
 * One dispatch card. Read-only until pressed; expanded it offers the two things
 * a found event is actually for — putting it on a date, and asking more about
 * it. Expansion is owned by the deck (it stops the rotation), everything else
 * lives here.
 */
export function DispatchItemCard({
  item,
  index,
  tripId,
  tripSlug,
  today,
  days,
  expanded,
  onToggle,
}: {
  item: DispatchItem
  /** Position in the stored dispatch row — how the server finds it again. */
  index: number
  tripId: string
  tripSlug: string
  today: string
  days: DispatchDay[]
  expanded: boolean
  onToggle: (expanded: boolean) => void
}) {
  const router = useRouter()
  const [adding, setAdding] = React.useState(false)
  const [added, setAdded] = React.useState(false)
  const [dayId, setDayId] = React.useState(
    () => days.find((d) => d.dayDate === today)?.id ?? days[0]?.id ?? "",
  )
  const [newDate, setNewDate] = React.useState(today)
  const [time, setTime] = React.useState("")
  const [detail, setDetail] = React.useState<DispatchDetail | null>(null)
  const [question, setQuestion] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // No day selected means the trip has none yet: create one on the typed date.
  function add() {
    const day = days.find((d) => d.id === dayId)
    setError(null)
    addTodayEvent({
      tripId,
      tripSlug,
      dayDate: day ? day.dayDate : newDate,
      dayId: day?.id ?? null,
      time: normalizeTime(time),
      text: item.title,
      url: item.sourceUrl,
      category: eventCategory(item),
    }).then((result) => {
      if (result.error) {
        setError(result.error)
        return
      }
      setAdded(true)
      setAdding(false)
      router.refresh()
    })
  }

  function learn(ask: string) {
    setLoading(true)
    setError(null)
    learnAboutItem(tripSlug, today, index, ask).then((result) => {
      setLoading(false)
      if (result.error) {
        setError(result.error)
        return
      }
      setDetail(result.detail ?? null)
      setQuestion("")
    })
  }

  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {DISPATCH_KIND_LABEL[item.kind]}
        </div>
        {expanded ? (
          <button
            type="button"
            onClick={() => onToggle(false)}
            aria-label="Close"
            className="-mt-0.5 border-0 bg-transparent px-1 font-mono text-[13px] leading-none text-muted-foreground hover:text-clay"
          >
            ×
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onToggle(!expanded)}
        aria-expanded={expanded}
        className="mt-1 block w-full border-0 bg-transparent p-0 text-left"
      >
        <span className="block text-[13px] text-foreground">{item.title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
          {item.body}
        </span>
      </button>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <span>{item.window}</span>
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sea hover:underline"
        >
          source
        </a>
      </div>

      {expanded ? (
        <div className="mt-2.5 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {added ? (
              <span className="rounded-full bg-foreground/40 px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background">
                added
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setAdding((v) => !v)}
                className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
              >
                add to a date
              </button>
            )}
            <button
              type="button"
              onClick={() => learn("")}
              disabled={loading}
              className="rounded-full border border-rule px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              {loading ? "learning…" : "learn more"}
            </button>
          </div>

          {adding ? (
            <div className="flex flex-wrap items-center gap-2">
              {days.length ? (
                <select
                  value={dayId}
                  onChange={(e) => setDayId(e.target.value)}
                  className="rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground"
                >
                  {days.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="t-num rounded-lg border border-border bg-background px-2 py-1 text-[12px] text-foreground"
                />
              )}
              <input
                type="text"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                onBlur={() => setTime((t) => normalizeTime(t))}
                placeholder="19:30"
                className="t-num w-16 border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
              />
              <button
                type="button"
                onClick={add}
                className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background"
              >
                add
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false)
                  setTime("")
                }}
                aria-label="Cancel"
                className="border-0 bg-transparent px-1.5 py-1 font-mono text-[13px] text-muted-foreground hover:text-clay"
              >
                ×
              </button>
            </div>
          ) : null}

          {detail ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] leading-snug text-muted-foreground">
                {detail.detail}
              </p>
              {detail.links.length ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {detail.links.map((link, i) => (
                    <a
                      key={i}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[10px] uppercase tracking-[0.14em] text-sea hover:underline"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              ) : null}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const ask = question.trim()
                  if (ask) learn(ask)
                }}
              >
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="ask about this…"
                  disabled={loading}
                  className="w-full border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-40"
                />
              </form>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mt-2 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `pnpm lint`
Expected: clean. React 19 lint gotcha to watch for: the `…` and `×` characters
are fine as JSX text; a bare `//` would not be.

- [ ] **Step 3: Commit**

```bash
git add src/components/dispatch-item-card.tsx
git commit -m "feat(dispatch): add the pressable item card with add and learn more"
```

---

### Task 5: Wire the card into the deck and the page

**Files:**
- Modify: `src/components/dispatch-box.tsx`
- Modify: `src/app/on-the-road/page.tsx:186-191`

**Interfaces:**
- Consumes: `DispatchItemCard`, `DispatchDay` (Task 4).
- Produces: `DispatchBox` props extended with `tripId: string`, `tripSlug: string`, `today: string`, `days: DispatchDay[]`.

- [ ] **Step 1: Replace `ItemCard` with the imported card**

In `src/components/dispatch-box.tsx`: delete the local `ItemCard` function at
the bottom of the file, and add to the imports:

```ts
import {
  DispatchItemCard,
  type DispatchDay,
} from "@/components/dispatch-item-card"
```

`DISPATCH_KIND_LABEL` is no longer used in this file — drop it from the
`dispatch-types` import, keeping `type DispatchItem`.

- [ ] **Step 2: Give `buildCards` the context and the expanded state**

Replace the existing `buildCards` with:

```tsx
/** What every item card needs to act: the trip, today, and the days it can
 * drop an event on. */
interface CardContext {
  tripId: string
  tripSlug: string
  today: string
  days: DispatchDay[]
}

/** The deck in order: weather, then today's findings. Weather is not pressable;
 * every item is. `expanded` is a deck index, so the weather offset applies. */
function buildCards(
  weather: Weather | null,
  items: DispatchItem[],
  ctx: CardContext,
  expanded: number | null,
  onToggle: (deckIndex: number | null) => void,
): React.ReactNode[] {
  const offset = weather ? 1 : 0
  return [
    ...(weather ? [<WeatherCard key="weather" weather={weather} />] : []),
    ...items.map((item, i) => (
      <DispatchItemCard
        key={`item-${i}`}
        item={item}
        index={i}
        tripId={ctx.tripId}
        tripSlug={ctx.tripSlug}
        today={ctx.today}
        days={ctx.days}
        expanded={expanded === i + offset}
        onToggle={(next) => onToggle(next ? i + offset : null)}
      />
    )),
  ]
}
```

- [ ] **Step 3: Thread the new props through `DispatchBox`**

Replace the `DispatchBox` signature and body with:

```tsx
export function DispatchBox({
  weather,
  items,
  storageKey,
  tripId,
  tripSlug,
  today,
  days,
  className,
}: {
  weather: Weather | null
  items: DispatchItem[]
  /** Distinguishes one trip-day from another in localStorage. */
  storageKey: string
  tripId: string
  tripSlug: string
  today: string
  days: DispatchDay[]
  className?: string
}) {
  const isClient = useIsClient()
  const ctx = { tripId, tripSlug, today, days }

  if (!weather && items.length === 0) return null

  // Server and hydration render the first card, static and collapsed. The live
  // deck takes over immediately after, which is where the random start is
  // chosen and where a card can be opened.
  if (!isClient) {
    return (
      <Frame
        className={className}
        cards={buildCards(weather, items, ctx, null, () => {})}
        index={0}
      />
    )
  }
  return (
    <LiveDeck
      weather={weather}
      items={items}
      storageKey={storageKey}
      ctx={ctx}
      className={className}
    />
  )
}
```

- [ ] **Step 4: Hold the expanded card in `LiveDeck` and stop the timer**

Replace `LiveDeck` with:

```tsx
function LiveDeck({
  weather,
  items,
  storageKey,
  ctx,
  className,
}: {
  weather: Weather | null
  items: DispatchItem[]
  storageKey: string
  ctx: CardContext
  className?: string
}) {
  const reduced = useReducedMotion()
  const [index, setIndex] = React.useState(() =>
    pickStart(storageKey, (weather ? 1 : 0) + items.length, weather !== null),
  )
  const [paused, setPaused] = React.useState(false)
  const [expanded, setExpanded] = React.useState<number | null>(null)
  const cards = buildCards(weather, items, ctx, expanded, setExpanded)
  const count = cards.length

  React.useEffect(() => {
    window.localStorage.setItem(seenKey(storageKey), "1")
  }, [storageKey])

  // An opened card holds the deck still: the reader is mid-decision on it.
  React.useEffect(() => {
    if (count < 2 || paused || reduced || expanded !== null) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), ADVANCE_MS)
    return () => clearInterval(timer)
  }, [count, paused, reduced, expanded])

  // The deck grows from one card to several when the findings land and the page
  // refreshes, so a held index can outrun the count it was picked against.
  // Clamping beats resetting: landing on the last card is the least surprising.
  const active = Math.min(index, count - 1)

  return (
    <Frame
      className={className}
      cards={cards}
      index={active}
      onSelect={(i) => {
        setExpanded(null)
        setIndex(i)
      }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    />
  )
}
```

Note the one behavioural detail carried over: `pickStart` needs the card count
before `cards` is built, so it is computed from `weather` and `items` directly.

- [ ] **Step 5: Pass the new props from the page**

In `src/app/on-the-road/page.tsx`, replace the `<DispatchBox .../>` element with:

```tsx
          <DispatchBox
            weather={weather}
            items={dispatch?.items ?? []}
            storageKey={`${trip.slug}:${today}`}
            tripId={trip.id}
            tripSlug={trip.slug}
            today={today}
            days={days.map((d) => ({
              id: d.id,
              dayDate: d.dayDate,
              label: `${d.dow} ${d.dom} ${d.mon}`,
            }))}
            className="mt-3"
          />
```

`days` is already in scope from `getItineraryDays(trip.id)` above.

- [ ] **Step 6: Verify**

Run: `pnpm lint`
Expected: clean.

Then, with no `pnpm dev` running, run: `pnpm build`
Expected: compiles, types check, `/on-the-road` builds.

- [ ] **Step 7: Commit**

```bash
git add src/components/dispatch-box.tsx src/app/on-the-road/page.tsx
git commit -m "feat(dispatch): press a card to stop the rotation and act on it"
```

---

### Task 6: Docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Record the task**

Add an entry to `docs/TODO.md` marked *implemented, unverified in-app*, naming
the slice (pressable dispatch cards: add to a date + learn more) and pointing at
the spec.

- [ ] **Step 2: Record the decision**

Append a row to `docs/DECISIONS.md`: the learn-more answer is page-lifetime
state, not a column on `trip_dispatch` — a follow-up question is a read, and
storing it would make a card's meaning drift from the day it was generated for.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record the dispatch card actions slice"
```

---

## Success criteria

Copied from the spec. Claude verifies list 1; the user verifies list 2 in the
running app.

### Verified by Claude

1. `pnpm build` passes and `pnpm lint` is clean.
2. `propose_detail` is registered in `registry.ts`; `dispatch-detail.ts` lists it plus `web_search_short`.
3. `generateDispatchDetail` is exported from `src/lib/ai/claude.ts` and no caller imports the agent module directly.
4. `learnAboutItem` reads the item from `getDispatchForDay`, never from its own arguments — the client passes an index.
5. `learnAboutItem` returns `{ error }` and makes no model call when AI mode is off, there is no workspace, the slug does not resolve, or `itemIndex` is out of range.
6. The add path calls `addTodayEvent` with `text = item.title`, `url = item.sourceUrl`, and `category = "Activities"` only for `whats_on`.
7. `normalizeTime` lives in `src/lib/trips/event-time.ts`, is imported by both `discovery-section.tsx` and the item card, and still returns `"18:00"` for `"18"`, `"09:05"` for `"9:5"`, `""` for `""`, and leaves unrecognized input unchanged.
8. `dispatch-item-card.tsx` imports only from `*-types.ts` modules, not from `*-queries.ts`.
9. The rotation interval effect in `dispatch-box.tsx` returns early while `expanded` is non-null.

### Verified by the user in-app

1. Pressing a dispatch card expands it and the rotation stops — it stays on that card indefinitely.
2. `×` collapses the card and the rotation resumes.
3. Pressing the source link opens the source and does not expand the card.
4. `add to a date` shows a day dropdown defaulting to today plus a time field; `add` puts the item on the chosen day and the `added` pill appears.
5. An item added to today shows up in the Today section below without a manual reload.
6. The added event opens the source URL from the itinerary, and a `whats_on` item defaults to the Activities category in the event's expense form.
7. `learn more` returns a paragraph plus links within a few seconds, rendered inside the card.
8. Typing a question in `ask about this…` replaces the answer with one addressing the question; the box stays for another question.
9. Collapsing and re-expanding the same card shows the last answer without re-searching.
10. All of the above works on a phone viewport: the expanded card does not overflow and the growing box does not throw the page around.
11. Weather is still just weather — pressing it does nothing.
