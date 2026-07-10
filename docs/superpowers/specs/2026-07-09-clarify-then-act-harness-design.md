# Clarify-then-act harness — design

Date: 2026-07-09
Slice 1 of the proactive-assistant work (the other half — proactive
data-triggered suggestions — is a separate later slice).

## Problem

The assistant acts on under-specified requests instead of asking first.

- **Chat** ("ask me anything") answers even when a request turns on a
  specific it doesn't have — above all *which place*. "A sunny spot for a
  drink" on a multi-city trip gets a guess, not a question.
- **The planning discovery door** silently falls back to the trip header
  when a trip has no itinerary locations: `find-a-place-planning.tsx`
  `const near = location ? location.name : destination`. It then searches
  a bare country name ("restaurants in Denmark") instead of asking where.

The memo (`project-assistant-proactive-vision`) calls the clarify-then-act
loop the sharpest missing piece and names this exact door fallback as why
we stopped hard-coding these fixes one at a time.

## Core insight

The clarify-then-act contract is inherently a **chat-surface** property.
Discovery, budget, and suggestion are one-shot tool calls that *cannot*
receive a reply — `discoverySystem` in `claude.ts` literally instructs
"Never ask the user questions ... you cannot receive a reply." So the slice
splits into two distinct mechanisms:

- **Chat** → a model behavior contract (the "harness"): the model asks a
  focused follow-up when a request needs context it doesn't have.
- **Planning door** → a deterministic app-level fix: stop silently falling
  back to the trip header; ask where instead.

No new AI machinery, no new tables, no deps, no migration. Chat is already
multi-turn (full history sent each call), so the clarify → reply → answer
loop already works end to end — this is a prompt rewrite plus one small UI
change.

## Design

### 1. The harness artifact (chat behavior contract)

Rewrite `chatSystem` in `src/lib/ai/claude.ts` into a named, well-defined
`CHAT_HARNESS` contract — the "defined behavior contract" the memo asks for.
It states:

- Warm, concise, practical, **suggest-only**: it advises; it never claims to
  have edited the trip, budget, or itinerary.
- **Clarify-then-act**: when a request turns on a specific it doesn't have —
  above all *which place* — ask **one** focused follow-up **before**
  answering, then answer once told. Explicitly do **not** ask when the
  context already pins the answer down or a reasonable general answer exists.
  One question, only when genuinely needed — this guards against becoming
  annoying.
- Treat the itinerary places listed in context as the known set: if a
  request implies a place and none is pinned, ask which one.

This strengthens and formalizes the existing weak line ("ask a brief
clarifying question only when you genuinely cannot answer otherwise").

**Out of scope on purpose:** the other three system prompts
(`discoverySystem`, `BUDGET_SYSTEM`, `SUGGESTION_SYSTEM`) are **not**
refactored into a shared constant. Their "never ask, one-shot" rule is the
opposite of the clarify rule, and they work today. The harness is
chat-scoped. (Deliberate scope discipline — no speculative cross-surface
abstraction.)

### 2. Chat clarify-then-act

Pure prompt change in `claude.ts`. `sendChatMessage` / `tripContextFor`
(`chat-actions.ts`) stay as-is — the thin context (country, dates, itinerary
places, planning-vs-road hint) is enough for the model to know what it lacks.
No enriching of chat context in this slice (that belongs to the proactive
slice).

Example, Denmark trip, no single location pinned:

> user: a sunny spot for a drink
> assistant: Where are you — Copenhagen, or somewhere else in Denmark?
> user: Copenhagen
> assistant: <concrete recommendations>

And when the place is obvious (on-the-road context pins today's location, or
the trip has one place), it answers directly with no question.

### 3. Planning door: ask instead of silently falling back

In `PlanningPlaceDoor` (`src/app/trips/[slug]/find-a-place-planning.tsx`),
when `locations.length === 0`, replace the `near = destination` fallback
with an inline **"Where in {destination} are you headed?"** free-text field.

- The entered value becomes `near` / `destination` for the `Food` and
  `Activities` `DiscoverySection`s.
- Until it is filled, the door prompts for a place rather than searching
  against a bare country name. (Search stays disabled / the field is the
  first thing shown.)
- When locations exist, behavior is **unchanged** — the existing `<select>`
  picker drives everything.

This applies the harness principle (ask, don't guess) deterministically
where the app already knows context is missing. The on-the-road door
(`find-a-place.tsx`) is untouched: it already has today's location, so it has
no silent-fallback problem.

### 4. Two modes

- **Planning**: chat clarify + the door "where?" prompt both apply.
- **On the road**: the on-the-road door already has today's location — no
  fallback, untouched. Chat clarify still applies but naturally fires *less*,
  because the "on this trip right now" context usually pins the place. That
  is the correct behavior, not a special case.

## What ships

- `src/lib/ai/claude.ts`: `chatSystem` → `CHAT_HARNESS` (rewritten contract
  with the clarify-then-act rule). Only the chat prompt changes.
- `src/app/trips/[slug]/find-a-place-planning.tsx`: no-locations branch shows
  a "where in {destination}?" field that feeds `near`/`destination`, instead
  of the silent trip-header fallback.

No changes to actions, queries, schema, or the other AI seams.

## Deferred (explicitly not this slice)

- Proactive, data-triggered suggestions (the other half of the vision).
- A structured `need_context` tool / distinct "clarification pending" signal.
- Cross-surface harness refactor of the one-shot prompts.
- Enriching chat context with budget / packing / weather.
- The on-the-road door (has no fallback problem).

## Verification

- `pnpm build` clean.
- In-app, AI mode on:
  - Chat on a location-less multi-city trip asks "where?" before answering a
    place-specific request, and answers directly when the place is obvious.
  - The planning door on a trip with zero itinerary locations shows the
    "where?" field instead of searching the country-wide fallback; entering a
    place runs discovery around it.
