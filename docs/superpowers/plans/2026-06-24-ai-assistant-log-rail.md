# AI Assistant Log Rail — Implementation Plan (first slice)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop right rail's "Pre-trip" progress block with an in-session, mock-fed **Assistant** panel — a scrollable per-trip AI timeline (suggestions-with-why + chat) with location filtering — keeping the weather grid below.

**Architecture:** A pure mock module (`lib/ai/assistant-log.ts`) seeds a `LogEntry[]`. A client component (`assistant-panel.tsx`) renders the timeline, a location filter, and an ask input (active only when AI mode is on; an "AI is off" invite otherwise). The server-rendered `DesktopRightRail` in `page.tsx` drops the progress bars and mounts the panel above the weather grid.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4. Reuses existing mocks `lib/ai/suggestions.ts` and `lib/ai/chat.ts`, the `useAiMode`/`AiToggle` context, and the `Label` design primitive.

## Global Constraints

- **No test framework exists.** Per `CLAUDE.md`, do not invent one. Each task's verification is `pnpm build` (runs TypeScript typecheck + ESLint) passing, plus a manual `pnpm dev` visual check for UI tasks.
- **No new dependencies.** No DB table, no Anthropic SDK, no network — this slice is mock/in-session only (per spec).
- **AI provider stays behind `lib/ai/*`.** Keep `LogEntry` stable so the real-Claude swap is a one-file change later.
- **European date order** if any date is ever shown (`en-GB`); this slice shows none.
- **No emojis** in code or copy.
- **Mobile unchanged.** The rail is `hidden lg:flex`; the floating `TripChat` "ask" stays as-is on mobile.

---

### Task 1: Mock assistant-log module

**Files:**
- Create: `src/lib/ai/assistant-log.ts`

**Interfaces:**
- Consumes: `suggestionFor`, `SurfaceKey` from `src/lib/ai/suggestions.ts`.
- Produces:
  - `type LogKind = "suggestion" | "user" | "assistant"`
  - `interface LogEntry { id: string; kind: LogKind; body: string; createdAt: string; locationId: string | null; reason: string | null }`
  - `function seedLog(locations: { id: string; name: string }[]): LogEntry[]`

- [ ] **Step 1: Create the module**

```ts
/**
 * Mock seed for the assistant log timeline (first slice). Pure, no network.
 * Real entries arrive when Claude is wired and a trip_ai_log table exists; this
 * deterministic seed proves the rail's feel. Keep LogEntry stable across that swap.
 */

import { suggestionFor, type SurfaceKey } from "./suggestions"

export type LogKind = "suggestion" | "user" | "assistant"

export interface LogEntry {
  id: string
  kind: LogKind
  body: string
  /** ISO timestamp; drives chronological order (oldest first). */
  createdAt: string
  /** Itinerary location this entry is about; null = trip-wide. */
  locationId: string | null
  /** One-line "why" for a suggestion; null for chat turns. */
  reason: string | null
}

/** A few mock entries, oldest first; the budget one is tagged to the first
 * location (when any) so the location filter has something to show. */
export function seedLog(locations: { id: string; name: string }[]): LogEntry[] {
  const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
  const firstLoc = locations[0]?.id ?? null

  const suggestion = (
    surface: SurfaceKey,
    reason: string,
    locationId: string | null,
    m: number,
  ): LogEntry => ({
    id: `seed-${surface}`,
    kind: "suggestion",
    body: suggestionFor(surface)?.body ?? "",
    createdAt: minsAgo(m),
    locationId,
    reason,
  })

  return [
    {
      id: "seed-intro",
      kind: "assistant",
      body: "I'll note suggestions for this trip here as we plan — with the why behind each. Ask me anything below.",
      createdAt: minsAgo(30),
      locationId: null,
      reason: null,
    },
    suggestion(
      "budget",
      "Food is usually the biggest flexible line, so it's the easiest to trim.",
      firstLoc,
      20,
    ),
    suggestion(
      "packing",
      "Forgotten warm layers are a common regret on trips like this.",
      null,
      10,
    ),
  ]
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm build`
Expected: build succeeds (no type/lint errors). `assistant-log.ts` is imported nowhere yet, which is fine.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/assistant-log.ts
git commit -m "feat(ai): mock assistant-log seed for the timeline"
```

---

### Task 2: AssistantPanel component

**Files:**
- Create: `src/app/trips/[slug]/assistant-panel.tsx`

**Interfaces:**
- Consumes: `seedLog`, `LogEntry` from `src/lib/ai/assistant-log.ts`; `requestChatReply` from `src/lib/ai/chat.ts`; `AiToggle`, `useAiMode` from `src/components/ai-mode.tsx`; `Label` from `src/components/together`; `ItineraryLocation` from `src/lib/trips/location-types`.
- Produces: `function AssistantPanel({ locations }: { locations: ItineraryLocation[] })` (default export not used; named export).

- [ ] **Step 1: Create the component**

```tsx
"use client"

import * as React from "react"

import { Label } from "@/components/together"
import { AiToggle, useAiMode } from "@/components/ai-mode"
import { requestChatReply } from "@/lib/ai/chat"
import { seedLog, type LogEntry } from "@/lib/ai/assistant-log"
import type { ItineraryLocation } from "@/lib/trips/location-types"

export function AssistantPanel({
  locations,
}: {
  locations: ItineraryLocation[]
}) {
  const { enabled } = useAiMode()
  const [entries, setEntries] = React.useState<LogEntry[]>(() =>
    seedLog(locations),
  )
  const [filter, setFilter] = React.useState<string | null>(null)
  const [input, setInput] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const endRef = React.useRef<HTMLDivElement>(null)

  const locationsById = React.useMemo(
    () => Object.fromEntries(locations.map((l) => [l.id, l.name])),
    [locations],
  )
  const shown = entries.filter(
    (e) => filter === null || e.locationId === filter,
  )

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [shown.length, pending])

  function send() {
    const text = input.trim()
    if (!text || pending || !enabled) return
    const now = Date.now()
    const user: LogEntry = {
      id: `u-${now}`,
      kind: "user",
      body: text,
      createdAt: new Date(now).toISOString(),
      locationId: filter,
      reason: null,
    }
    setEntries((es) => [...es, user])
    setInput("")
    setPending(true)
    requestChatReply([{ role: "user", content: text }]).then((reply) => {
      setEntries((es) => [
        ...es,
        {
          id: `a-${Date.now()}`,
          kind: "assistant",
          body: reply,
          createdAt: new Date().toISOString(),
          locationId: filter,
          reason: null,
        },
      ])
      setPending(false)
    })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between">
        <Label>Assistant</Label>
        <AiToggle />
      </div>

      {locations.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          <FilterChip active={filter === null} onClick={() => setFilter(null)}>
            All
          </FilterChip>
          {locations.map((l) => (
            <FilterChip
              key={l.id}
              active={filter === l.id}
              onClick={() => setFilter(l.id)}
            >
              {l.name}
            </FilterChip>
          ))}
        </div>
      ) : null}

      <div className="mt-3 max-h-[26rem] space-y-2.5 overflow-y-auto pr-1">
        {shown.map((e) => (
          <LogRow
            key={e.id}
            entry={e}
            locationName={
              e.locationId ? (locationsById[e.locationId] ?? null) : null
            }
          />
        ))}
        {pending ? (
          <div className="font-mono text-[10px] text-muted-foreground">
            typing…
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="mt-3 border-t border-border pt-3">
        {enabled ? (
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about your trip…"
              className="max-h-24 min-h-[2rem] flex-1 resize-none border-0 border-b border-border bg-transparent text-[13px] text-foreground outline-none focus:border-foreground"
            />
            <button
              type="button"
              onClick={send}
              disabled={pending || input.trim() === ""}
              className="rounded-md border-0 bg-foreground px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
            >
              send
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              AI is off
            </span>
            <AiToggle />
          </div>
        )}
      </div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] transition-colors ${
        active
          ? "bg-foreground text-background"
          : "border border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}

function LogRow({
  entry,
  locationName,
}: {
  entry: LogEntry
  locationName: string | null
}) {
  if (entry.kind === "user") {
    return (
      <div className="flex justify-end">
        <span className="max-w-[85%] rounded-lg bg-foreground px-3 py-1.5 text-[13px] leading-snug text-background">
          {entry.body}
        </span>
      </div>
    )
  }
  if (entry.kind === "assistant") {
    return (
      <div className="flex justify-start">
        <span className="max-w-[90%] rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] leading-snug text-foreground">
          {entry.body}
        </span>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-moss/40 bg-moss/5 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-moss">
          / suggested
        </span>
        {locationName ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            {locationName}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[13px] leading-snug text-foreground">
        {entry.body}
      </p>
      {entry.reason ? (
        <p className="mt-1.5 border-t border-rule pt-1.5 font-mono text-[10px] leading-snug tracking-[0.04em] text-muted-foreground">
          why · {entry.reason}
        </p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm build`
Expected: build succeeds. Component is imported nowhere yet (fine).

- [ ] **Step 3: Commit**

```bash
git add src/app/trips/[slug]/assistant-panel.tsx
git commit -m "feat(ai): AssistantPanel timeline component (mock, in-session)"
```

---

### Task 3: Mount the panel in the right rail; drop the Pre-trip block

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx`

**Interfaces:**
- Consumes: `AssistantPanel` from `./assistant-panel`; `ItineraryLocation` from `@/lib/trips/location-types`.

- [ ] **Step 1: Import the panel and the location type**

Add to the imports near the other tab imports in `page.tsx` (after `import { BudgetTab } from "./budget-tab"`):

```tsx
import { AssistantPanel } from "./assistant-panel"
```

Add a type import alongside the existing `getItineraryLocations` import line (`import { getItineraryLocations } from "@/lib/trips/location-queries"`), on the next line:

```tsx
import { type ItineraryLocation } from "@/lib/trips/location-types"
```

- [ ] **Step 2: Remove the now-unused packing rollup**

Delete these four lines (the `myPackingItems` / `packingTotal` / `packingDone` computations); keep `const budgetSummary = summarizeBudget(...)` directly above them:

```tsx
  const myPackingItems = packingItems.filter(
    (i) => i.ownerId === null || i.ownerId === userData.user!.id,
  )
  const packingTotal = myPackingItems.length
  const packingDone = myPackingItems.filter((i) => i.done).length
```

- [ ] **Step 3: Update the rail call site**

Replace the `<DesktopRightRail ... />` element (the one passing `packing`/`budget`/`saved`) with:

```tsx
      <DesktopRightRail
        detail={header.startDate ? detail : null}
        locations={locations ?? []}
      />
```

- [ ] **Step 4: Rewrite `DesktopRightRail` to host the panel + weather**

Replace the entire `DesktopRightRail` function with:

```tsx
function DesktopRightRail({
  detail,
  locations,
}: {
  detail: TripDetail | null
  locations: ItineraryLocation[]
}) {
  return (
    <aside className="hidden lg:flex lg:w-[280px] lg:flex-shrink-0 lg:flex-col lg:gap-8 lg:border-l lg:border-border lg:bg-card lg:px-6 lg:py-8">
      <AssistantPanel locations={locations} />

      {detail ? (
        <div>
          <Label>Weather · 7 day</Label>
          <div className="mt-2.5 overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-7">
              {detail.weather.map((day, i) => (
                <DayChip
                  key={day.d + i}
                  d={day.d}
                  t={day.t}
                  glyph={day.glyph}
                  active={i === detail.weatherActive}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  )
}
```

- [ ] **Step 5: Remove the now-unused `ProgressRow` component and its `Bar` import**

`ProgressRow` is the only user of `Bar` in this file, so after deleting it, remove `Bar` from the top `@/components/together` import (change `import { Bar, Chevron, ... }` to `import { Chevron, ... }`). Then delete the entire `ProgressRow` function (it was only used by the old Pre-trip block):

```tsx
function ProgressRow({
  label,
  value,
  pct,
  tone,
}: {
  label: string
  value: string
  pct: number
  tone: "sea" | "clay" | "moss"
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-serif text-[13px] italic text-foreground">
          {label}
        </span>
        <span className="t-num text-[11px] text-muted-foreground">{value}</span>
      </div>
      <Bar pct={pct} tone={tone} />
    </div>
  )
}
```

- [ ] **Step 6: Verify build**

Run: `pnpm build`
Expected: build succeeds (typecheck + ESLint clean). If any other import went unused, remove it and re-run until green.

- [ ] **Step 7: Manual check**

Run: `pnpm dev`, open a trip on a wide (desktop `lg`) viewport.
Expected: the right rail shows an **Assistant** panel with the seeded intro + two suggestions (one tagged to the first location, with a "why · …" line), location filter chips (All + each location), and weather below. Toggle AI on → the ask input appears; type a question + Enter → your message and a mock reply append, autoscrolling. Toggle AI off → the input is replaced by an "AI is off" invite, and the existing log stays visible. Filter by a location → only matching entries show.

- [ ] **Step 8: Commit**

```bash
git add src/app/trips/[slug]/page.tsx
git commit -m "feat(ai): mount AssistantPanel in the rail, drop pre-trip progress block"
```

---

## Notes for the implementer

- The panel's scroll area is a fixed `max-h-[26rem]` box (not `flex-1`) so it scrolls predictably regardless of the rail's height.
- `seedLog` is re-seeded only on mount (`useState` initializer); session chat appends in memory and resets on reload — expected for this slice (per spec, persistence is Phase 5).
- Do **not** touch `TripChat` (the floating mobile "ask") in this slice.
- `budgetSummary` and `savings` stay in `page.tsx` — they still feed `BudgetTab`; only the packing rollup and the rail's progress props are removed.

## Out of scope (per spec — do not build here)

- `trip_ai_log` table / shared persistence and real Claude wiring (Phase 5).
- "Apply"-style actions on suggestions.
- Mobile timeline sheet.
- Folding the in-tab `AiSuggestion` cards / budget drafter summary entries into the log.
