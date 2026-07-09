# Clarify-then-act Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the assistant ask before it guesses — a chat behavior contract that asks one focused follow-up when a request lacks context, and a planning door that asks "where?" instead of silently searching a bare country name.

**Architecture:** Two independent changes. (1) Chat: rewrite the chat system prompt in `claude.ts` into a named `CHAT_HARNESS` contract carrying the clarify-then-act rule — pure prompt, no new machinery (chat is already multi-turn). (2) Planning door: replace the silent trip-header fallback in `find-a-place-planning.tsx` with an inline "where in {destination}?" field that anchors discovery, deterministically, when a trip has no itinerary locations.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TypeScript 5, `@anthropic-ai/sdk`, Tailwind v4. Spec: `docs/superpowers/specs/2026-07-09-clarify-then-act-harness-design.md`.

## Global Constraints

- **No tests in this repo.** CLAUDE.md: "There are no tests yet; do not invent a test command until one exists." Verification per task is `pnpm lint` + `pnpm build`, then a final in-app smoke. Do NOT add a test framework.
- **Suggest-only invariant:** code under `lib/ai` reads context and returns text/data; it never writes.
- **The harness is chat-scoped.** Do NOT touch `discoverySystem`, `BUDGET_SYSTEM`, or `SUGGESTION_SYSTEM` — their one-shot "never ask" rule is the opposite of the clarify rule and must stay.
- **No new deps, no migration, no schema change.**
- **No emojis** in code, comments, or copy. Sparse comments; clear names.
- **European date order** anywhere dates render (`en-GB`, `dd/mm`). (Not expected to arise in this slice.)
- The two tasks are independent; either can be committed while approving the other.

---

### Task 1: Chat harness (clarify-then-act contract)

**Files:**
- Modify: `src/lib/ai/claude.ts:25-33` (the `chatSystem` function)

**Interfaces:**
- Consumes: nothing new. `chatReply(messages, tripContext)` (claude.ts:38) already calls `chatSystem(tripContext)` and is reached via `sendChatMessage` (`chat-actions.ts`). Both stay unchanged.
- Produces: no signature change. `chatSystem(tripContext: string): string` keeps its shape; only its text content changes, plus a new module-level `CHAT_HARNESS` constant.

- [ ] **Step 1: Replace `chatSystem` with the `CHAT_HARNESS` contract**

In `src/lib/ai/claude.ts`, replace the existing function (lines 25-33):

```ts
function chatSystem(tripContext: string): string {
  const base =
    "You are the in-app travel assistant for a couple planning and taking " +
    "trips together. Be warm, concise, and practical. Give concrete, " +
    "actionable answers; ask a brief clarifying question only when you " +
    "genuinely cannot answer otherwise."
  const context = tripContext.trim()
  return context ? `${base}\n\n${context}` : base
}
```

with:

```ts
// The chat behavior contract (the "harness"). Chat is the one conversational
// surface that CAN receive a reply, so it is the only place the clarify-then-act
// rule applies — the one-shot discovery/budget/suggestion prompts must not ask.
const CHAT_HARNESS =
  "You are the in-app travel assistant for a couple planning and taking " +
  "trips together. Be warm, concise, and practical, and give concrete, " +
  "actionable answers. You are suggest-only: you advise, and you never claim " +
  "to have edited their trip, budget, itinerary, packing list, or notes. " +
  "Clarify before you act: when a request turns on a specific you do not " +
  "have -- above all which place -- ask exactly one focused follow-up " +
  "question and wait, then answer once they tell you. Do not ask when the " +
  "context already pins the answer down or a sensible general answer exists; " +
  "one question, and only when you genuinely need it. Treat any itinerary " +
  "places given to you below as the set of places you know: if a request " +
  "implies a place and none is pinned, ask which one."

function chatSystem(tripContext: string): string {
  const context = tripContext.trim()
  return context ? `${CHAT_HARNESS}\n\n${context}` : CHAT_HARNESS
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors or warnings for `src/lib/ai/claude.ts`.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build completes; no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/claude.ts
git commit -m "feat(assistant): chat harness with clarify-then-act contract"
```

---

### Task 2: Planning door asks "where?" instead of silent fallback

**Files:**
- Modify: `src/app/trips/[slug]/find-a-place-planning.tsx` (whole `PlanningPlaceDoor` body)

**Interfaces:**
- Consumes: `PlaceDoor` (`@/components/place-door`) `header` slot — renders above the category list whenever the door is open. `DiscoverySection` (`@/components/discovery-section`) — sends `destination` to `/api/ai/discover` and seeds its editable `near` field from `defaultNear`; both must be a real place, never empty.
- Produces: no prop change. `PlanningPlaceDoor` keeps its existing props (`tripId`, `tripSlug`, `destination`, `locations`, `days`); call sites are unchanged.

- [ ] **Step 1: Rewrite `PlanningPlaceDoor`**

Replace the entire body of `src/app/trips/[slug]/find-a-place-planning.tsx` with:

```tsx
"use client"

import * as React from "react"

import { DiscoverySection } from "@/components/discovery-section"
import { PlaceDoor, type DoorCategory } from "@/components/place-door"
import type { ItineraryDay } from "@/lib/trips/itinerary-types"
import type { ItineraryLocation } from "@/lib/trips/location-types"

/** Planning-mode discovery door content: Food + Activities search near a place
 * and add picks to one of its days. With itinerary locations, a picker (the
 * door's header) chooses which one. With none yet, the harness rule applies:
 * ask "where in {destination}?" instead of silently searching the bare trip
 * header, and anchor the search on what they type. */
export function PlanningPlaceDoor({
  tripId,
  tripSlug,
  destination,
  locations = [],
  days = [],
}: {
  tripId: string
  tripSlug: string
  destination: string
  locations?: ItineraryLocation[]
  days?: ItineraryDay[]
}) {
  const [locId, setLocId] = React.useState("")
  const [askedPlace, setAskedPlace] = React.useState("")

  const hasLocations = locations.length > 0
  const location = hasLocations
    ? locations.find((l) => l.id === locId) ?? locations[0]
    : null

  // With a location, anchor on it. Without, anchor on what they type -- never a
  // bare country fallback.
  const place = location ? location.name : askedPlace.trim()
  const needsPlace = !place
  const keyBase = location ? location.id : place
  const cta = location ? `add to ${location.name}` : "add to a day"

  const dayOptions = location
    ? days
        .filter((d) => d.locationId === location.id)
        .sort((a, b) => a.dayDate.localeCompare(b.dayDate))
        .map((d) => ({ id: d.id, dayDate: d.dayDate, label: `Day ${d.d} · ${d.date}` }))
    : []

  // Location picker when there is a choice; otherwise the "where?" prompt field.
  const header = location ? (
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
  ) : (
    <input
      type="text"
      value={askedPlace}
      onChange={(e) => setAskedPlace(e.target.value)}
      placeholder={`Where in ${destination} are you headed?`}
      className="block w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground"
    />
  )

  // Until a place is known, prompt instead of searching an empty destination.
  const prompt = (
    <p className="text-[13px] text-muted-foreground">
      Tell me where in {destination} first.
    </p>
  )

  const categories: DoorCategory[] = [
    {
      key: "food",
      title: "Food",
      content: needsPlace ? (
        prompt
      ) : (
        <DiscoverySection
          key={`${keyBase}-food`}
          category="food"
          tripId={tripId}
          tripSlug={tripSlug}
          destination={place}
          when="dinner"
          defaultNear={place}
          defaultWalkable={false}
          addTarget={{ kind: "select", days: dayOptions }}
          buildEventText={(s) => `Dinner · ${s.name}`}
          ctaLabel={cta}
        />
      ),
    },
    {
      key: "activity",
      title: "Activities",
      content: needsPlace ? (
        prompt
      ) : (
        <DiscoverySection
          key={`${keyBase}-activity`}
          category="activity"
          tripId={tripId}
          tripSlug={tripSlug}
          destination={place}
          when=""
          defaultNear={place}
          defaultWalkable={false}
          addTarget={{ kind: "select", days: dayOptions }}
          buildEventText={(s) => s.name}
          ctaLabel={cta}
        />
      ),
    },
    { key: "stay", title: "Accommodation", soon: true },
    { key: "transport", title: "Transport", soon: true },
  ]

  return <PlaceDoor categories={categories} header={header} />
}
```

Notes for the implementer:
- **With locations, behavior is byte-identical to before**: `place = location.name`, `needsPlace = false`, header is the `<select>`, and the two `DiscoverySection`s render exactly as they did.
- **`key={`${keyBase}-food`}` remounts the section when the anchor changes** (location switch, or editing the typed place) so the internal `near` field re-seeds — this mirrors the existing location-keyed remount.
- **Do not touch the add path**: with no locations there are no days, so `dayOptions` is `[]` and `DiscoverySection` already shows "add a day first" — unchanged. This slice changes only the search anchor, not adding.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors or warnings for `find-a-place-planning.tsx`.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build completes; no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/[slug]/find-a-place-planning.tsx
git commit -m "feat(assistant): planning door asks where instead of silent trip-header fallback"
```

---

### Final verification (both tasks, in-app)

Requires a logged-in session with AI mode on (expand the assistant block) and `ANTHROPIC_API_KEY` set.

- [ ] **Chat clarify — asks when place is missing.** On a trip with two-plus locations (or a country-only trip with none pinned), open the assistant block and ask "a sunny spot for a drink". Expected: the assistant asks one follow-up ("Where — which town?") and waits, rather than guessing. Reply with a place; it then recommends.
- [ ] **Chat clarify — answers when place is obvious.** On a single-location trip, or an active ("on the road right now") trip, ask the same thing. Expected: it answers directly with no clarifying question.
- [ ] **Door asks where.** On a trip with zero itinerary locations, open the itinerary planning door and pick Food. Expected: the header shows "Where in {country} are you headed?" and the category shows "Tell me where in {country} first." — no search runs against the bare country. Type a town; Expected: discovery runs anchored on that town.
- [ ] **Door unchanged with locations.** On a trip that has locations, the door still shows the location `<select>` and searches normally.

Update `docs/TODO.md` when shipped; if a non-obvious choice surfaced, add a row to `docs/DECISIONS.md`.

## Plan Self-Review

- **Spec coverage:** Harness artifact + clarify rule → Task 1. Chat clarify-then-act (no context enrichment) → Task 1 (context untouched by design). Planning door "where?" field → Task 2. On-the-road door untouched → not a task (correct). Two-modes behavior → verified in the final smoke. Deferred items → none implemented. All spec sections map to a task.
- **Placeholder scan:** none — every code step shows full content.
- **Type consistency:** `PlanningPlaceDoor` props unchanged; `DiscoverySection` / `PlaceDoor` / `DoorCategory` props match their definitions (`destination`, `when`, `defaultNear`, `defaultWalkable`, `addTarget`, `buildEventText`, `ctaLabel`; `header` slot). `chatSystem` signature unchanged; `CHAT_HARNESS` is a new module-level const.
