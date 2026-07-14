# Plan your itinerary — Slice 2 (AI feed + category-organized draft) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Swap Slice 1's empty even-split skeleton for a profile-fed AI draft whose events are organized **per place by category** (Activities / Food / Transportation), each carrying a date + time — the budget-blueprint flow applied to the itinerary.

**Architecture:** Mirror `draftBudgetSeeds`/`draftBudget` exactly. A `draftItinerary` seam in `lib/ai/claude.ts` (forced `propose_itinerary` tool, no web_search) returns flat events `{ category, place, text, date, time }`. A `draftItinerary` server action loads `buildAssistantContext` + trip data, calls the seam, and falls back to the deterministic `planItinerarySkeleton` (Slice 1) when AI is off or fails. The draft model gains a `category` on each event; `applyItinerarySkeleton` writes it. The UI's context step gains activity-type chips + free text, and the draft renders category-first.

**Tech Stack:** Next.js 16, React 19, TS 5, `@anthropic-ai/sdk` (already installed, used by `claude.ts`). No new deps, no migration.

## Scope

- **Category enum: `Activities`, `Food`, `Transportation`** (matches the event `category` idiom; `mapDiscoveryCategory` already emits `Food`/`Activities`).
- **Single-day events only.** Multi-day activity blocks ("3 days surfing") + move/resize are **deferred** — they reuse the existing itinerary editor's multi-day blocks / spans / gap-aware push (per the design's non-goal). This slice does not build them.
- **Dated trips only** (unchanged from Slice 1).
- AI-gated + graceful fallback: with AI off or on failure, the flow still works on the deterministic skeleton (empty events), exactly like `draftBudget`'s `drafted:false`.

## Global Constraints

- No test framework (CLAUDE.md). Verify with `pnpm lint` and `pnpm build` (pnpm only). The AI seam cannot be unit-tested without a key — build-verify the types/wiring; live verification is deferred to the controller/user.
- Subagents do NOT run git/commit — the controller commits. No emojis. Sparse comments. `en-GB` dates. No new dep/migration. All AI stays in `lib/ai/`.
- The seam mirrors the existing `draftBudgetSeeds` structure in `src/lib/ai/claude.ts` (read it first): `MODEL = "claude-sonnet-4-6"`, `messages.create` + `tool_choice: { type: "tool", name: ... }`, extract the `tool_use` block, return `[]` if none.

## File Structure

- Modify `src/lib/ai/claude.ts` — add the `draftItinerary` seam (types + tool + system + prompt + function) next to `draftBudgetSeeds`.
- Modify `src/lib/ai/itinerary-planner.ts` — add `category` to `SkeletonEvent`; add a `CATEGORIES` export.
- Modify `src/lib/ai/itinerary-actions.ts` — write `category` in the apply; add the `draftItinerary` server action.
- Modify `src/app/trips/[slug]/plan-itinerary.tsx` — context preamble (activity chips + free text), the AI draft call with fallback, category-first draft rendering.

---

### Task 1: `draftItinerary` AI seam

**Files:** Modify `src/lib/ai/claude.ts` (add next to `draftBudgetSeeds`, ~line 433).

**Interfaces — Produces:**
- `DraftedItineraryEvent = { category: string; place: string; text: string; date: string; time: string }`
- `ItineraryDraftContext = { destination: string; startDate: string; dayCount: number; locations: { name: string; nights: number; dateLabel: string | null }[]; vibe: string[]; brief: string; activityTypes: string[]; freeText: string; profileBlock: string; tasteDirective: string }`
- `draftItinerary(context: ItineraryDraftContext): Promise<DraftedItineraryEvent[]>`

- [ ] **Step 1: Add the seam** (mirror `draftBudgetSeeds`; read it first for the exact idioms)

```ts
export interface DraftedItineraryEvent {
  /** One of: Activities, Food, Transportation. */
  category: string
  /** The exact itinerary location name this event belongs to. */
  place: string
  /** Short label, e.g. "Surf lesson at the point" or "Dinner - seafood". */
  text: string
  /** YYYY-MM-DD within the trip; may be empty if undated. */
  date: string
  /** HH:MM, may be empty. */
  time: string
}

export interface ItineraryDraftContext {
  destination: string
  startDate: string
  dayCount: number
  locations: { name: string; nights: number; dateLabel: string | null }[]
  vibe: string[]
  brief: string
  activityTypes: string[]
  freeText: string
  profileBlock: string
  tasteDirective: string
}

const ITINERARY_TOOL: Anthropic.Messages.ToolUnion = {
  name: "propose_itinerary",
  description: "Return the drafted itinerary events.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: {
              type: "string",
              enum: ["Activities", "Food", "Transportation"],
              description: "Which kind of event this is.",
            },
            place: {
              type: "string",
              description: "The exact itinerary location name given for this event.",
            },
            text: {
              type: "string",
              description: "Short label for the event, e.g. 'Surf lesson' or 'Dinner - seafood'.",
            },
            date: {
              type: "string",
              description: "YYYY-MM-DD within the trip dates. Empty if you can't place it.",
            },
            time: {
              type: "string",
              description: "HH:MM 24h, or empty.",
            },
          },
          required: ["category", "place", "text", "date", "time"],
        },
      },
    },
    required: ["events"],
  },
}

const ITINERARY_SYSTEM =
  "You draft a trip itinerary for a couple or family. You never ask questions " +
  "or reply conversationally - you cannot receive a reply. You MUST call " +
  "propose_itinerary with concrete events. For each itinerary place, propose a " +
  "few Activities, a couple of Food ideas (a notable meal, a market), and any " +
  "Transportation between places. Set place to the exact location name given. " +
  "Spread events across that place's dates (set date to a real YYYY-MM-DD in " +
  "range); leave date empty only if you truly cannot place it. Keep each event a " +
  "short label, not a paragraph. Weight the couple's stated taste and vibe as a " +
  "lens, never a checklist. Do not invent exact prices or booking details."

function itineraryPrompt(c: ItineraryDraftContext): string {
  const list = (label: string, items: string[]) =>
    items.length ? `${label}: ${items.join(", ")}.` : ""
  const places = c.locations.length
    ? c.locations.map((l) => `${l.name} (${l.dateLabel ?? `${l.nights} nights`})`).join("; ")
    : c.destination
  return [
    `Draft a ${c.dayCount}-day itinerary for ${c.destination}, starting ${c.startDate}.`,
    `Places in order: ${places}.`,
    list("Trip vibe", c.vibe),
    c.brief ? `Trip brief: ${c.brief}.` : "",
    list("Activity types they want", c.activityTypes),
    c.freeText ? `They also said: ${c.freeText}.` : "",
    c.profileBlock ? `Who they are (a lens, not a checklist): ${c.profileBlock}` : "",
    c.tasteDirective,
  ]
    .filter(Boolean)
    .join(" ")
}

/** Real Claude itinerary draft. Returns [] if the model finishes without proposing. */
export async function draftItinerary(
  context: ItineraryDraftContext,
): Promise<DraftedItineraryEvent[]> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: ITINERARY_SYSTEM,
    tools: [ITINERARY_TOOL],
    tool_choice: { type: "tool", name: "propose_itinerary" },
    messages: [{ role: "user", content: itineraryPrompt(context) }],
  })
  const proposal = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === "propose_itinerary",
  )
  if (!proposal) return []
  const input = proposal.input as { events?: DraftedItineraryEvent[] }
  return input.events ?? []
}
```

- [ ] **Step 2:** `pnpm lint && pnpm build` — clean. Report; do NOT commit.

---

### Task 2: Add `category` to the draft model + write it on apply

**Files:** Modify `src/lib/ai/itinerary-planner.ts`, `src/lib/ai/itinerary-actions.ts`.

**Interfaces — Produces:** `SkeletonEvent` gains `category: string`; new `export const ITINERARY_CATEGORIES = ["Activities", "Food", "Transportation"] as const`.

- [ ] **Step 1: `itinerary-planner.ts`** — add `category: string` to `SkeletonEvent` (place it after `time`). The deterministic `planItinerarySkeleton` still produces `events: []`, so no seed change. Add:
```ts
export const ITINERARY_CATEGORIES = ["Activities", "Food", "Transportation"] as const
```

- [ ] **Step 2: `itinerary-actions.ts` apply** — in `applyItinerarySkeleton`, the event map must carry the category. Change the `events` map inside `addItineraryDay(...)` to:
```ts
        events: day.events.map((e) => ({ text: e.text, time: e.time, category: e.category })),
```
(`ItineraryEvent.category` is an existing optional field — confirm in `itinerary-types.ts`.)

- [ ] **Step 3:** `pnpm lint && pnpm build` clean. Any `plan-itinerary.tsx` type errors from the new required `category` field are fixed in Task 4 — if the build fails only there, note it and proceed (Task 4 resolves it); if it fails elsewhere, fix here. Report; do NOT commit.

---

### Task 3: `draftItinerary` server action

**Files:** Modify `src/lib/ai/itinerary-actions.ts`.

**Interfaces:**
- Consumes: `draftItinerary`/`ItineraryDraftContext`/`DraftedItineraryEvent` (Task 1), `planItinerarySkeleton`/`ItinerarySkeleton`/`ITINERARY_CATEGORIES` (Task 2), `buildAssistantContext`, `getTripBySlug`, `getItineraryLocations`, `getItineraryDays`.
- Produces: `draftItineraryForTrip(input: { tripSlug: string; dayCount: number; placeNames: string[]; activityTypes: string[]; freeText: string }): Promise<{ skeleton: ItinerarySkeleton; drafted: boolean }>`

**Behaviour:** Build the deterministic scaffold (`planItinerarySkeleton`) for places+dated days. If AI is off (`isAiEnabled()` false) return `{ skeleton, drafted: false }`. Else load trip + `buildAssistantContext` + per-location nights/dateLabels (as `draftBudget`'s action does), call `draftItinerary`, then **merge** the returned events into the scaffold's days by matching `place` (case-insensitive to the scaffold place) and `date` (to a day in that place; if the date isn't one of the place's days, drop the event). On any error or empty result, return the plain scaffold with `drafted:false`.

- [ ] **Step 1:** Read `src/lib/ai/budget-actions.ts` `draftBudget` for the exact context-loading pattern (workspace guard, `getTripBySlug`, nights-by-location from `getItineraryDays`, the `{ steps, drafted }` fallback shape). Read `isAiEnabled` from `src/lib/ai/ai-mode.ts`.

- [ ] **Step 2:** Add `draftItineraryForTrip`. Construct the scaffold from `planItinerarySkeleton({ destination: trip.country ?? trip.name, startDate, dayCount, placeNames })`. Merge AI events: for each `DraftedItineraryEvent`, find the scaffold place whose name matches `place` (case-insensitive), then the day whose `date` equals the event `date`; push `{ text, time, category }` onto that day's `events`. Drop events with no place/date match. Return `{ skeleton, drafted: true }`. Guard the whole AI path in `try/catch` returning `{ skeleton, drafted: false }`.

- [ ] **Step 3:** `pnpm lint && pnpm build` clean. Report; do NOT commit.

---

### Task 4: Context preamble + category-first draft UI

**Files:** Modify `src/app/trips/[slug]/plan-itinerary.tsx`.

**Consumes:** `draftItineraryForTrip` (Task 3), `ITINERARY_CATEGORIES` + updated `SkeletonEvent` (Task 2), existing `applyItinerarySkeleton`.

**Spec:**
1. **Context step** — keep destination + Days + the place-name list; ADD an **activity-types** chip/text input (free-form comma or add-row list) and a **free-text** "anything else" textarea. Replace the "Generate draft" handler: it now calls `draftItineraryForTrip({ tripSlug, dayCount: days, placeNames, activityTypes, freeText })` inside a transition (button shows "drafting…"), stores the returned `skeleton`, and if `drafted === false` shows a small muted note "using a blank draft — turn the assistant on for suggestions." (Keep it working with AI off.)
2. **Draft/refine (category-first)** — for each place, group that place's events **by category** (`ITINERARY_CATEGORIES` order; a day's event carries `category`). Render each category as a labelled sub-section listing its events (each still shows/edits text + time, and now a small date field or the day it's on); add-event within a category defaults the new event's `category` to that section. A new manually-added event needs a `category` (default the section's) and a `date` (default the place's first day) so the model stays valid. Keep the immutable-update helpers; extend them to carry `category`.
3. **Apply** — unchanged call (`applyItinerarySkeleton`), which now persists `category`.

Because events are keyed to days internally (the skeleton is still `place → day → events`), "group by category" is a **view** over a place's days: flatten the place's `days[].events`, group by `category`, and when editing map back to the owning day. Keep the day/date visible on each event so it's clear when it happens.

- [ ] **Step 1:** Implement per the spec, following existing idioms. Ensure every event object always has a `category` (the build from Task 2 requires it).
- [ ] **Step 2:** `pnpm lint && pnpm build` clean.
- [ ] **Step 3: In-app (controller/user):** with AI on, open a dated future trip → Plan your itinerary → set places + activity types + free text → Generate → confirm category-grouped suggested events appear, edit one, Apply, confirm they land on the right days with the right category. With AI off, confirm the blank draft still works. Report.

---

## Self-Review

- **Spec coverage:** AI seam (T1), category on the model + write path (T2), profile-fed action with deterministic fallback (T3), context preamble + category-first draft UI (T4). Multi-day blocks + move/resize are explicitly deferred to the existing editor (design non-goal). Onboarding routing + dreams are later slices.
- **Placeholder scan:** T1 fully coded (transcription of the draftBudget pattern); T2 exact edits; T3/T4 are spec + fragments over existing patterns (`draftBudget` action, the Slice-1 component) — the executor authors them against the named references.
- **Type consistency:** `DraftedItineraryEvent`/`ItineraryDraftContext`/`draftItinerary` (T1) are consumed by `draftItineraryForTrip` (T3); `SkeletonEvent.category` + `ITINERARY_CATEGORIES` (T2) are consumed by T3/T4; the apply event map (T2) matches `ItineraryEvent`.

## After slice 2

Slice 3: onboarding routing (new trip → profile → guided itinerary). Slice 4: dreams + inline second-access + multi-day activity blocks. Parked: rebuild "Plan a budget" on this harness.
