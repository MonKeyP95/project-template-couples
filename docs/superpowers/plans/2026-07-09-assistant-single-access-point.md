# One Assistant Access Point — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the floating assistant pill, the standalone AI on/off toggle, and the separate per-page suggestion cards + discovery doors with one inline collapsible `assistant` block whose expand/collapse *is* the AI on/off, containing suggest + a bare press-to-open door + inline chat.

**Architecture:** A new client `AssistantBlock` renders an always-visible `assistant` header that toggles `useAiMode()` (collapsed = off, expanded = on, persisted per-person via the existing `ai` cookie). When expanded it shows a reused suggestion line, an optional discovery door passed in as a prop, and an inline chat line. The door is a new bare `PlaceDoor` (⌕ line → vertical category list → picked category's existing `DiscoverySection`). The floating pill and `AiToggle` are deleted.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4. No test runner exists in this repo.

## Global Constraints

- **No test suite exists.** Do not invent a test command. Each task's verification is `pnpm lint` (no new errors) then `pnpm build` (succeeds), plus a manual look where noted.
- **Server-first, client only on need.** New interactive components are `"use client"`.
- **Client/`*-types.ts` split rule.** `"use client"` files must not import modules that pull `next/headers`. Import pure types from `*-types.ts` (e.g. `chat-types.ts`, `suggestion-types.ts`), never from a `*-queries.ts`.
- **Suggest-only invariant.** AI never performs a write or calls a server action to mutate data. Unchanged by this work.
- **No emojis in code/logs.** The `⌕` and `▸`/`▾` in JSX are UI glyphs, not emojis — allowed.
- **European date order** anywhere dates render: `en-GB`, `{day} {mon}`. (No new date rendering here; existing `DiscoverySection` day labels are untouched.)
- **Sparse comments, short functions, clear names.** Match surrounding style.
- Package manager is **pnpm** (`pnpm lint`, `pnpm build`). Commit frequently.

---

## File Structure

**Create:**
- `src/components/assistant-block.tsx` — the single AI block (header on/off + suggest + optional door + chat). Client.
- `src/components/place-door.tsx` — the bare ⌕ discovery door (list → picked category content). Client, presentational.

**Modify:**
- `src/components/ai-mode.tsx` — fold cookie persistence into `AiModeProvider`'s `setEnabled`; later remove `AiToggle`.
- `src/app/home/page.tsx`, `src/app/checklists/page.tsx`, `src/app/trips/[slug]/notes-tab.tsx`, `src/app/trips/[slug]/packing-tab.tsx`, `src/app/trips/[slug]/budget-tab.tsx` — swap `AiSuggestion` → `AssistantBlock` (doorless).
- `src/app/on-the-road/page.tsx` — swap `AiSuggestion` + `FindAPlace` → one `AssistantBlock` with a road door.
- `src/app/trips/[slug]/itinerary-tab.tsx` — swap `AiSuggestion` + `FindAPlacePlanning` → one `AssistantBlock` with a planning door.
- `src/app/on-the-road/find-a-place.tsx` — becomes `RoadPlaceDoor` (door content, no gate/section).
- `src/app/trips/[slug]/find-a-place-planning.tsx` — becomes `PlanningPlaceDoor` (door content, no gate/section).
- `src/app/layout.tsx` — remove `<Assistant />`.
- `docs/DECISIONS.md`, `docs/TODO.md` — record the change.

**Delete (slice 3):**
- `src/components/assistant.tsx` — the floating pill + chat panel.
- `src/components/ai-suggestion.tsx` — its logic now lives inside `AssistantBlock`.

**Keep:** `src/components/together/suggestion-card.tsx` (reused by the block), `src/components/category-section.tsx` (still used by the couple profile), `src/components/discovery-section.tsx` (reused verbatim), `src/lib/ai/*` seams, `meal-slot.ts`.

---

## Slice 1 — the block on doorless pages

### Task 1: Persist AI mode from the provider

**Files:**
- Modify: `src/components/ai-mode.tsx`

**Interfaces:**
- Produces: `useAiMode()` unchanged shape `{ enabled: boolean; setEnabled: (v: boolean) => void }`, but `setEnabled` now also writes the `ai` cookie so any caller (the new block) persists without its own cookie code.

- [ ] **Step 1: Fold cookie persistence into the provider**

In `src/components/ai-mode.tsx`, replace the `AiModeProvider` function body so `setEnabled` persists:

```tsx
export function AiModeProvider({
  initialEnabled,
  children,
}: {
  initialEnabled: boolean
  children: React.ReactNode
}) {
  const [enabled, setEnabledState] = React.useState(initialEnabled)
  const setEnabled = React.useCallback((v: boolean) => {
    setEnabledState(v)
    document.cookie = `${AI_COOKIE}=${v ? "on" : "off"}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
  }, [])
  return (
    <AiModeContext.Provider value={{ enabled, setEnabled }}>
      {children}
    </AiModeContext.Provider>
  )
}
```

Leave `AiToggle` and `persistAi` as they are for now (the duplicate cookie write is idempotent; `AiToggle` is deleted in Task 8).

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/ai-mode.tsx
git commit -m "refactor(ai): persist ai cookie from AiModeProvider.setEnabled"
```

---

### Task 2: The AssistantBlock component (no door)

**Files:**
- Create: `src/components/assistant-block.tsx`

**Interfaces:**
- Consumes: `useAiMode()` from Task 1; `suggestForSurface(surface, tripSlug?)` from `@/lib/ai/suggestion-actions` returning `{ suggestion?: Suggestion; error?: string }`; `sendChatMessage(messages, tripSlug?)` from `@/lib/ai/chat-actions`; `SuggestionCard` from `@/components/together`; types `SurfaceKey`, `Suggestion`, `ChatMessage`.
- Produces: `AssistantBlock({ surface: SurfaceKey; tripSlug?: string; door?: React.ReactNode; className?: string })`.

- [ ] **Step 1: Create the component**

Create `src/components/assistant-block.tsx` with the full content:

```tsx
"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { useAiMode } from "@/components/ai-mode"
import { SuggestionCard } from "@/components/together"
import { suggestForSurface } from "@/lib/ai/suggestion-actions"
import type { SurfaceKey, Suggestion } from "@/lib/ai/suggestion-types"
import { sendChatMessage } from "@/lib/ai/chat-actions"
import type { ChatMessage } from "@/lib/ai/chat-types"

/** The single AI access point. One inline collapsible block whose header IS the
 * AI on/off: collapsed = off (just the label), expanded = on (suggest + optional
 * door + inline chat). State persists per-person via useAiMode / the ai cookie. */
export function AssistantBlock({
  surface,
  tripSlug,
  door,
  className,
}: {
  surface: SurfaceKey
  tripSlug?: string
  door?: React.ReactNode
  className?: string
}) {
  const { enabled, setEnabled } = useAiMode()
  return (
    <div
      className={cn(
        "rounded-[14px] border border-l-2 border-border border-l-moss bg-card",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setEnabled(!enabled)}
        aria-expanded={enabled}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-moss">
          assistant
        </span>
        <span aria-hidden className="font-mono text-[12px] text-muted-foreground">
          {enabled ? "▾" : "▸"}
        </span>
      </button>

      {enabled ? (
        <div className="flex flex-col">
          <Divider />
          <div className="px-4 py-3">
            <SuggestLine surface={surface} tripSlug={tripSlug} />
          </div>
          {door ? (
            <>
              <Divider />
              <div className="px-4 py-3">{door}</div>
            </>
          ) : null}
          <Divider />
          <div className="px-4 py-3">
            <AskLine tripSlug={tripSlug} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Divider() {
  return <div className="mx-4 h-px bg-rule" />
}

/** On-demand suggestion: collapsed to "/ suggest" until pressed, then a Claude
 * card with "another" (regenerate) and "dismiss". Moved from ai-suggestion.tsx;
 * no AI-mode gate here since the block already gates. */
function SuggestLine({
  surface,
  tripSlug,
}: {
  surface: SurfaceKey
  tripSlug?: string
}) {
  const [suggestion, setSuggestion] = React.useState<Suggestion | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const run = React.useCallback(async () => {
    setBusy(true)
    setError(null)
    const res = await suggestForSurface(surface, tripSlug)
    if (res.suggestion) setSuggestion(res.suggestion)
    else setError(res.error ?? "Couldn't reach the assistant.")
    setBusy(false)
  }, [surface, tripSlug])

  if (!suggestion) {
    return (
      <div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-moss disabled:opacity-60"
        >
          {busy ? "thinking..." : "/ suggest"}
        </button>
        {error ? (
          <p className="mt-1.5 text-[12.5px] leading-snug text-clay">{error}</p>
        ) : null}
      </div>
    )
  }

  return (
    <SuggestionCard
      label={suggestion.label}
      applyLabel={busy ? "thinking..." : "another"}
      dismissLabel="dismiss"
      onApply={run}
      onDismiss={() => {
        setSuggestion(null)
        setError(null)
      }}
    >
      {suggestion.body}
    </SuggestionCard>
  )
}

/** Inline chat. Same server seam (sendChatMessage) the floating panel used. */
function AskLine({ tripSlug }: { tripSlug?: string }) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const endRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, pending])

  function send() {
    const text = input.trim()
    if (!text || pending) return
    const next: ChatMessage[] = [...messages, { role: "user", content: text }]
    setMessages(next)
    setInput("")
    setPending(true)
    sendChatMessage(next, tripSlug).then((reply) => {
      setMessages((m) => [...m, { role: "assistant", content: reply }])
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
    <div className="flex flex-col gap-2.5">
      {messages.length > 0 ? (
        <div className="flex max-h-60 flex-col gap-2 overflow-y-auto">
          {messages.map((m, i) => (
            <div
              key={i}
              className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <span
                className={`max-w-[85%] rounded-lg px-3 py-1.5 text-[13px] leading-snug ${
                  m.role === "user"
                    ? "bg-foreground text-background"
                    : "border border-border bg-background text-foreground"
                }`}
              >
                {m.content}
              </span>
            </div>
          ))}
          {pending ? (
            <div className="flex justify-start">
              <span className="rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                typing…
              </span>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="ask me anything…"
          className="max-h-24 min-h-[2rem] flex-1 resize-none border-0 border-b border-rule bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground"
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
    </div>
  )
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors. (If lint flags the `typing…` literal, it is fine — it is JSX text, not a comment.)

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build succeeds. The component is not yet rendered anywhere, so no visual check yet.

- [ ] **Step 4: Commit**

```bash
git add src/components/assistant-block.tsx
git commit -m "feat(assistant): AssistantBlock with header on/off, suggest, inline chat"
```

---

### Task 3: Swap doorless pages to AssistantBlock

**Files:**
- Modify: `src/app/home/page.tsx`
- Modify: `src/app/checklists/page.tsx`
- Modify: `src/app/trips/[slug]/notes-tab.tsx`
- Modify: `src/app/trips/[slug]/packing-tab.tsx`
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

**Interfaces:**
- Consumes: `AssistantBlock` from Task 2. Drop-in for `AiSuggestion` on doorless pages (same `surface` / `tripSlug` / `className` props).

- [ ] **Step 1: home/page.tsx**

Replace the import `import { AiSuggestion } from "@/components/ai-suggestion"` with:

```tsx
import { AssistantBlock } from "@/components/assistant-block"
```

Replace the render `<AiSuggestion surface="home" className="mt-9 block" />` with:

```tsx
<AssistantBlock surface="home" className="mt-9 block" />
```

- [ ] **Step 2: checklists/page.tsx**

Replace `import { AiSuggestion } from "@/components/ai-suggestion"` with:

```tsx
import { AssistantBlock } from "@/components/assistant-block"
```

Replace `<AiSuggestion surface="checklists" className="mb-4 block" />` with:

```tsx
<AssistantBlock surface="checklists" className="mb-4 block" />
```

- [ ] **Step 3: notes-tab.tsx**

Replace `import { AiSuggestion } from "@/components/ai-suggestion"` with:

```tsx
import { AssistantBlock } from "@/components/assistant-block"
```

Replace `<AiSuggestion surface="notes" tripSlug={tripSlug} className="mb-4 block" />` with:

```tsx
<AssistantBlock surface="notes" tripSlug={tripSlug} className="mb-4 block" />
```

- [ ] **Step 4: packing-tab.tsx**

Replace `import { AiSuggestion } from "@/components/ai-suggestion"` with:

```tsx
import { AssistantBlock } from "@/components/assistant-block"
```

Replace `<AiSuggestion surface="packing" tripSlug={tripSlug} />` with:

```tsx
<AssistantBlock surface="packing" tripSlug={tripSlug} />
```

- [ ] **Step 5: budget-tab.tsx**

Replace `import { AiSuggestion } from "@/components/ai-suggestion"` with:

```tsx
import { AssistantBlock } from "@/components/assistant-block"
```

Replace `<AiSuggestion surface="budget" tripSlug={tripSlug} />` with:

```tsx
<AssistantBlock surface="budget" tripSlug={tripSlug} />
```

Leave the existing `<BudgetDrafter .../>` render exactly as-is (revisit deferred).

- [ ] **Step 6: Lint + build**

Run: `pnpm lint && pnpm build`
Expected: no new errors; build succeeds.

- [ ] **Step 7: Manual look**

Run: `pnpm dev`, open `/home`. You should see a collapsed `assistant` line. Press it: it expands to `/ suggest` and `ask me anything…`. Press again: collapses. (The old floating pill still shows for now — expected until slice 3.)

- [ ] **Step 8: Commit**

```bash
git add src/app/home/page.tsx src/app/checklists/page.tsx src/app/trips/[slug]/notes-tab.tsx src/app/trips/[slug]/packing-tab.tsx src/app/trips/[slug]/budget-tab.tsx
git commit -m "feat(assistant): swap doorless pages to AssistantBlock"
```

---

## Slice 2 — the bare door

### Task 4: The PlaceDoor component

**Files:**
- Create: `src/components/place-door.tsx`

**Interfaces:**
- Produces:
  - `type DoorCategory = { key: string; title: string; soon?: boolean; content?: React.ReactNode }`
  - `PlaceDoor({ categories: DoorCategory[]; header?: React.ReactNode })`
- Consumes: nothing beyond React. The per-category `content` (a `DiscoverySection` element) and the optional `header` (planning's location `<select>`) are passed in by the mode wrappers in Tasks 5–6.

- [ ] **Step 1: Create the component**

Create `src/components/place-door.tsx` with the full content:

```tsx
"use client"

import * as React from "react"

/** One category entry in the door. `content` is the search UI revealed when the
 * category is picked; a `soon` category is a disabled list entry with no content. */
export type DoorCategory = {
  key: string
  title: string
  soon?: boolean
  content?: React.ReactNode
}

/** The bare discovery door: a single unlabelled ⌕ line that presses open to a
 * vertical category list; picking a live category reveals its search UI, with a
 * breadcrumb of the picked title next to the ⌕ and a link back to the list.
 * Press-only (no hover) — mobile-first. `header` renders above the list when open
 * (planning uses it for the location picker). */
export function PlaceDoor({
  categories,
  header,
}: {
  categories: DoorCategory[]
  header?: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [picked, setPicked] = React.useState<string | null>(null)

  const active = categories.find((c) => c.key === picked && !c.soon) ?? null

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Find a place"
        className="flex w-full items-center gap-2.5 py-1 text-left"
      >
        <span aria-hidden className="text-[15px] text-moss">
          ⌕
        </span>
        {active ? (
          <span className="font-serif text-[15px] text-muted-foreground">
            {active.title}
          </span>
        ) : null}
        <span
          aria-hidden
          className={`ml-auto font-mono text-[12px] text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        >
          ▸
        </span>
      </button>

      {open ? (
        <div className="mt-2">
          {header ? <div className="mb-3">{header}</div> : null}
          {active ? (
            <>
              {active.content}
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
              >
                ← categories
              </button>
            </>
          ) : (
            <div className="flex flex-col">
              {categories.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  disabled={c.soon}
                  onClick={() => setPicked(c.key)}
                  className="flex items-baseline gap-2 py-1.5 text-left font-serif text-[15px] text-foreground hover:text-moss disabled:text-muted-foreground disabled:hover:text-muted-foreground"
                >
                  {c.title}
                  {c.soon ? (
                    <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                      soon
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Lint + build**

Run: `pnpm lint && pnpm build`
Expected: no new errors; build succeeds. Not rendered yet.

- [ ] **Step 3: Commit**

```bash
git add src/components/place-door.tsx
git commit -m "feat(assistant): bare PlaceDoor (list to picked-category content)"
```

---

### Task 5: On-the-road door + page swap

**Files:**
- Modify (rewrite): `src/app/on-the-road/find-a-place.tsx`
- Modify: `src/app/on-the-road/page.tsx`

**Interfaces:**
- Consumes: `PlaceDoor`, `DoorCategory` (Task 4); `DiscoverySection` from `@/components/discovery-section`; `AssistantBlock` (Task 2); `currentMeal`, `mealLabel`, `mealWhen`, `Meal` from `./meal-slot`.
- Produces: `RoadPlaceDoor({ tripId: string; tripSlug: string; dayDate: string; dayId: string | null; destination: string })`.

- [ ] **Step 1: Rewrite find-a-place.tsx as RoadPlaceDoor**

Replace the entire contents of `src/app/on-the-road/find-a-place.tsx` with:

```tsx
"use client"

import * as React from "react"

import { DiscoverySection } from "@/components/discovery-section"
import { PlaceDoor, type DoorCategory } from "@/components/place-door"
import { currentMeal, mealLabel, mealWhen, type Meal } from "./meal-slot"

/** On-the-road discovery door content for the assistant block: Food (anchored to
 * the current meal) + Activities, added straight to today's day. Accommodation
 * and Transport are placeholders. */
export function RoadPlaceDoor({
  tripId,
  tripSlug,
  dayDate,
  dayId,
  destination,
}: {
  tripId: string
  tripSlug: string
  dayDate: string
  dayId: string | null
  destination: string
}) {
  // Meal is a client-only value (device clock); null during SSR to avoid a
  // hydration mismatch, per the React 19 useSyncExternalStore pattern.
  const meal = React.useSyncExternalStore<Meal | null>(
    () => () => {},
    () => currentMeal(new Date()),
    () => null,
  )
  const label = meal ? mealLabel(meal) : "Meal"

  const categories: DoorCategory[] = [
    {
      key: "food",
      title: "Food",
      content: (
        <DiscoverySection
          category="food"
          tripId={tripId}
          tripSlug={tripSlug}
          destination={destination}
          when={meal ? mealWhen(meal) : ""}
          defaultNear={destination}
          defaultWalkable
          addTarget={{ kind: "fixed", dayDate, dayId }}
          buildEventText={(s) => `${label} · ${s.name}`}
          ctaLabel="add to today"
        />
      ),
    },
    {
      key: "activity",
      title: "Activities",
      content: (
        <DiscoverySection
          category="activity"
          tripId={tripId}
          tripSlug={tripSlug}
          destination={destination}
          when=""
          defaultNear={destination}
          defaultWalkable
          addTarget={{ kind: "fixed", dayDate, dayId }}
          buildEventText={(s) => s.name}
          ctaLabel="add to today"
        />
      ),
    },
    { key: "stay", title: "Accommodation", soon: true },
    { key: "transport", title: "Transport", soon: true },
  ]

  return <PlaceDoor categories={categories} />
}
```

- [ ] **Step 2: Swap the on-the-road page**

In `src/app/on-the-road/page.tsx`:

Replace the import line `import { FindAPlace } from "./find-a-place"` with:

```tsx
import { RoadPlaceDoor } from "./find-a-place"
```

Replace the import `import { AiSuggestion } from "@/components/ai-suggestion"` with:

```tsx
import { AssistantBlock } from "@/components/assistant-block"
```

Replace this existing line:

```tsx
        <AiSuggestion surface="road" tripSlug={trip.slug} className="mb-4 block" />
```

with the block that carries the door:

```tsx
        <AssistantBlock
          surface="road"
          tripSlug={trip.slug}
          className="mb-4 block"
          door={
            <RoadPlaceDoor
              tripId={trip.id}
              tripSlug={trip.slug}
              dayDate={today}
              dayId={todayDay?.id ?? null}
              destination={searchDestination}
            />
          }
        />
```

Then delete the now-duplicate standalone door render lower in the file:

```tsx
      <FindAPlace
        tripId={trip.id}
        tripSlug={trip.slug}
        dayDate={today}
        dayId={todayDay?.id ?? null}
        destination={searchDestination}
      />
```

- [ ] **Step 3: Lint + build**

Run: `pnpm lint && pnpm build`
Expected: no new errors; build succeeds.

- [ ] **Step 4: Manual look**

`pnpm dev`, open the on-the-road page. Expand `assistant`. Press the ⌕ line → Food / Activities / Accommodation (soon) / Transport (soon). Pick Food → the craving/near/walkable/find inputs appear with a "Food" breadcrumb; `← categories` returns to the list.

- [ ] **Step 5: Commit**

```bash
git add src/app/on-the-road/find-a-place.tsx src/app/on-the-road/page.tsx
git commit -m "feat(assistant): on-the-road door via AssistantBlock + PlaceDoor"
```

---

### Task 6: Planning door + itinerary swap

**Files:**
- Modify (rewrite): `src/app/trips/[slug]/find-a-place-planning.tsx`
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`

**Interfaces:**
- Consumes: `PlaceDoor`, `DoorCategory` (Task 4); `DiscoverySection`; `AssistantBlock` (Task 2); `ItineraryDay`, `ItineraryLocation` types.
- Produces: `PlanningPlaceDoor({ tripId: string; tripSlug: string; locations: ItineraryLocation[]; days: ItineraryDay[] })`.

- [ ] **Step 1: Rewrite find-a-place-planning.tsx as PlanningPlaceDoor**

Replace the entire contents of `src/app/trips/[slug]/find-a-place-planning.tsx` with:

```tsx
"use client"

import * as React from "react"

import { DiscoverySection } from "@/components/discovery-section"
import { PlaceDoor, type DoorCategory } from "@/components/place-door"
import type { ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

/** Planning-mode discovery door content: a location picker (rendered as the
 * door's header) plus Food + Activities that search near the chosen location and
 * add picks to one of its days. */
export function PlanningPlaceDoor({
  tripId,
  tripSlug,
  locations,
  days,
}: {
  tripId: string
  tripSlug: string
  locations: ItineraryLocation[]
  days: ItineraryDay[]
}) {
  const [locId, setLocId] = React.useState("")

  if (locations.length === 0) return null

  const location = locations.find((l) => l.id === locId) ?? locations[0]
  const dayOptions = days
    .filter((d) => d.locationId === location.id)
    .sort((a, b) => a.dayDate.localeCompare(b.dayDate))
    .map((d) => ({ id: d.id, dayDate: d.dayDate, label: `Day ${d.d} · ${d.date}` }))

  const header = (
    <select
      value={location.id}
      onChange={(e) => setLocId(e.target.value)}
      className="block rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground"
    >
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  )

  const categories: DoorCategory[] = [
    {
      key: "food",
      title: "Food",
      content: (
        <DiscoverySection
          key={`${location.id}-food`}
          category="food"
          tripId={tripId}
          tripSlug={tripSlug}
          destination={location.name}
          when="dinner"
          defaultNear={location.name}
          defaultWalkable={false}
          addTarget={{ kind: "select", days: dayOptions }}
          buildEventText={(s) => `Dinner · ${s.name}`}
          ctaLabel={`add to ${location.name}`}
        />
      ),
    },
    {
      key: "activity",
      title: "Activities",
      content: (
        <DiscoverySection
          key={`${location.id}-activity`}
          category="activity"
          tripId={tripId}
          tripSlug={tripSlug}
          destination={location.name}
          when=""
          defaultNear={location.name}
          defaultWalkable={false}
          addTarget={{ kind: "select", days: dayOptions }}
          buildEventText={(s) => s.name}
          ctaLabel={`add to ${location.name}`}
        />
      ),
    },
    { key: "stay", title: "Accommodation", soon: true },
    { key: "transport", title: "Transport", soon: true },
  ]

  return <PlaceDoor categories={categories} header={header} />
}
```

Note: the door category keys are stable (`food`/`activity`), so a picked category survives a location change; each `DiscoverySection` still carries its own `key={`${location.id}-...`}` so its input state resets when the location changes.

- [ ] **Step 2: Swap the itinerary tab**

In `src/app/trips/[slug]/itinerary-tab.tsx`:

Replace the import `import { FindAPlacePlanning } from "./find-a-place-planning"` with:

```tsx
import { PlanningPlaceDoor } from "./find-a-place-planning"
```

Replace the import `import { AiSuggestion } from "@/components/ai-suggestion"` with:

```tsx
import { AssistantBlock } from "@/components/assistant-block"
```

Replace this existing pair:

```tsx
      <AiSuggestion surface="itinerary" tripSlug={tripSlug} />
      <FindAPlacePlanning
        tripId={tripId}
        tripSlug={tripSlug}
        locations={locations}
        days={days}
      />
```

with the single block:

```tsx
      <AssistantBlock
        surface="itinerary"
        tripSlug={tripSlug}
        door={
          <PlanningPlaceDoor
            tripId={tripId}
            tripSlug={tripSlug}
            locations={locations}
            days={days}
          />
        }
      />
```

- [ ] **Step 3: Lint + build**

Run: `pnpm lint && pnpm build`
Expected: no new errors; build succeeds.

- [ ] **Step 4: Manual look**

`pnpm dev`, open a trip's itinerary in planning mode. Expand `assistant`, press the ⌕ line: the location picker shows above the category list; pick a location, then Food, run a find, add to a day. Confirm the add lands on the chosen location's day.

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/[slug]/find-a-place-planning.tsx src/app/trips/[slug]/itinerary-tab.tsx
git commit -m "feat(assistant): planning door via AssistantBlock + PlaceDoor"
```

---

## Slice 3 — remove the pill and clean up

### Task 7: Delete the floating pill, AiToggle, and AiSuggestion

**Files:**
- Delete: `src/components/assistant.tsx`
- Delete: `src/components/ai-suggestion.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/ai-mode.tsx`

**Interfaces:**
- Consumes: nothing new. Removes `Assistant`, `AiToggle`, `AiSuggestion`, all now unused.

- [ ] **Step 1: Remove `<Assistant />` from the layout**

In `src/app/layout.tsx`, delete the import line:

```tsx
import { Assistant } from "@/components/assistant"
```

and change the provider body from:

```tsx
        <AiModeProvider initialEnabled={aiEnabled}>
          {children}
          <Assistant />
        </AiModeProvider>
```

to:

```tsx
        <AiModeProvider initialEnabled={aiEnabled}>
          {children}
        </AiModeProvider>
```

- [ ] **Step 2: Delete the pill and the dead suggestion component**

```bash
git rm src/components/assistant.tsx src/components/ai-suggestion.tsx
```

- [ ] **Step 3: Remove AiToggle + persistAi from ai-mode.tsx**

In `src/components/ai-mode.tsx`, delete the `persistAi` function and the entire `AiToggle` export (the `role="switch"` button). Keep `AI_COOKIE`, `ONE_YEAR_SECONDS`, `AiModeContext`, `AiModeProvider`, and `useAiMode`. `ONE_YEAR_SECONDS` is still used by the provider (Task 1); leave it.

- [ ] **Step 4: Lint + build**

Run: `pnpm lint && pnpm build`
Expected: no new errors; build succeeds. If the build reports any remaining import of `AiToggle`, `Assistant`, or `AiSuggestion`, grep for it and remove that usage — nothing should still reference them after Slices 1–2.

- [ ] **Step 5: Manual look**

`pnpm dev`. Confirm the floating pill is gone everywhere, and every page's `assistant` block still expands/collapses and its state follows you across pages (expand on itinerary, navigate to packing — still expanded).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(assistant): remove floating pill, AiToggle, and AiSuggestion"
```

---

### Task 8: Record the decision and update TODO

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/TODO.md`

- [ ] **Step 1: Append a DECISIONS row**

Add a row to the table in `docs/DECISIONS.md` (match the existing column format):

```markdown
| **Single AI access point = one inline `assistant` block** | Replaced the floating pill, the standalone AI on/off toggle, and the separate per-surface suggestion cards + discovery doors with one collapsible `assistant` block per page. Its expand/collapse IS the AI on/off (persisted via the `ai` cookie, default off). Relaxes the 2026-06-16 "everything AI hidden when off" rule: the single `assistant` label is always visible as the entry point; nothing else renders and no model is called until expanded. Budget drafter left separate — revisit its `useAiMode` coupling later. | 2026-07-09 |
```

- [ ] **Step 2: Update TODO**

In `docs/TODO.md`, mark the AI-surface consolidation done and add the follow-up. Add under the appropriate section:

```markdown
- [x] Consolidate AI surfaces into one collapsible `assistant` block (pill + toggle + cards + doors folded in); bare press-to-open door.
- [ ] Revisit budget drafter: fold into the assistant block or decouple it from `useAiMode` (drafter currently shows when the block is expanded on the budget tab).
```

- [ ] **Step 3: Commit**

```bash
git add docs/DECISIONS.md docs/TODO.md
git commit -m "docs: record single-assistant decision + budget revisit todo"
```

---

## Self-review notes

- **Spec coverage:** block-as-on/off (Tasks 1–2); suggest + chat inside (Task 2); bare press-only list door (Task 4); road + planning doors, placement "where AI is today" (Tasks 5–6); doorless pages = suggest + ask only (Task 3); pill / toggle / cards removed (Task 7); DECISIONS relaxation + budget revisit note (Task 8). All covered.
- **No new date rendering**; `DiscoverySection` day labels reused unchanged.
- **Types consistent:** `DoorCategory` / `PlaceDoor` used identically in Tasks 5–6; `AssistantBlock` prop shape (`surface`, `tripSlug?`, `door?`, `className?`) matches every call site.

