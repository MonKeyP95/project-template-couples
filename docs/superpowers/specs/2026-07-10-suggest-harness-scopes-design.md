# Suggest harness — scope picker for `/ suggest`

**Date:** 2026-07-10
**Status:** design approved, ready for plan
**Slice:** assistant — suggest harness (aim it), item #1 of the proactive/harness vision

## Problem

Pressing `/ suggest` today is one blind press: `suggestForSurface(surface, tripSlug)`
builds a fixed per-surface prompt, calls Claude, and returns one card. The user
can't *aim* it. They want to point the suggestion at a scope before it runs.

Out of scope for this slice (parked, separate brainstorms):
- Merging suggest with the `⌕` "find a place" door — **decided: no merge.** The two
  are different engines (suggest looks inward at trip data, no web search; discovery
  looks outward via web_search with citations + the learning corpus). Door untouched.
- Unifying suggest with "ask me anything" chat (vision #4). Free-text suggest here is
  a **one-shot** aimed suggestion, deliberately not a back-and-forth chat.

## Design

`/ suggest` stops being one press. Pressing it reveals a compact **scope chip row**;
the chosen scope shapes the prompt, then the existing `SuggestionCard` renders the
result unchanged (label/body + "another" / "dismiss"). Suggest-only invariant holds:
reads context, writes nothing, no web search. `claude.ts` `generateSuggestion` is
untouched — it already accepts an arbitrary prompt string.

### Scopes

Each scope shows only when its data exists (no empty/dead options):

| Scope | Shown when | Prompt it builds |
|---|---|---|
| **page** *(default)* | always | Today's exact per-surface prompt (unchanged). The instant hit, preserved. |
| **trip overview** | a trip is in context | Look across the whole trip (locations, days, budget/packing state) → the single most valuable gap or next step. Mode-framed. |
| **a specific day** | itinerary days exist | One thing for the chosen day. Mode-aware day selection (below). |
| **free text** | always | A one-line input → one aimed suggestion. One-shot, not chat. |

### Mode awareness (planning vs. on the road)

Mode is dates-driven (existing principle: today within trip range = on the road),
not a toggle.

- **trip overview** — planning frames as "what's the most valuable thing to plan
  next"; on the road frames as "what matters most for the rest of the trip."
- **a specific day** — on the road: defaults to **today**, with tap-to-pick-another;
  planning: shows the itinerary day list with no today default. On day-less surfaces
  (home, checklists) the scope does not appear.

### Restraint guardrail (v1)

Because output is already **one card, one suggestion**, the overview cannot march
through the whole day in a single press — over-eagerness would only appear across
repeated "another" presses. As a cheap v1 guardrail, the trip/day prompts include a
restraint line: *"surface the single most valuable thing; don't assume every day
needs a dinner or every gap needs filling — some dead time is intentional."*

The fuller version (a learned or user-set **density/restraint preference** — how much
the couple wants planned vs. left open) is deferred to the behavior-harness slice.
See Deferred below.

### Interaction flow

1. Press `/ suggest` → chip row of the available scopes.
2. `page` / `trip overview` → run immediately.
3. `a specific day` → reveal a mode-aware day picker (today default on the road),
   pick → run.
4. `free text` → reveal a one-line input, submit → run.
5. Result renders in `SuggestionCard`. **"another"** re-runs the *same* scope (the
   last scope is remembered). **"dismiss"** clears the card back to the chip row.

## Code shape

Small and contained; four files, `claude.ts` untouched.

- **`src/lib/ai/suggestion-types.ts`** — add a client-safe `SuggestScope` union:
  `{ kind: "page" } | { kind: "trip" } | { kind: "day"; date: string } | { kind: "free"; text: string }`.
- **`src/lib/ai/suggestion-actions.ts`** —
  - `suggestForSurface(surface, tripSlug, scope)` (scope defaults to `{kind:"page"}`).
  - `buildPrompt` switches on **scope first**; `page` falls through to the current
    per-surface prompt (unchanged). New branches build trip-overview / day / free-text
    prompts from existing queries (`getTripBySlug`, `getItineraryLocations`,
    `getItineraryDays`, budget/packing summaries). Mode + restraint framing applied.
  - A small lazy action `getSuggestDays(tripSlug)` returns the day list
    (`{ date, title }[]` + a `todayInRange`/`today` hint) when the user taps
    "a specific day" — avoids threading day props through every surface and avoids
    loading days when unused.
- **`src/components/assistant-block.tsx`** — `SuggestLine` grows: chip row +
  day picker + free-text input + remembered-scope for "another". Rest of the block
  (nudge, door slot, ask) unchanged.
- **`src/lib/ai/claude.ts`** — no change.

## Testing / validation

No test harness in this repo. Validate by: `pnpm build` + `pnpm lint` clean, then
in-app smoke on a real trip across surfaces and both modes:
- page scope matches today's behavior.
- trip overview returns one holistic suggestion, not a fill-everything list.
- a specific day: on the road defaults to today, can pick another; planning lists days.
- free text returns one aimed suggestion.
- "another" re-runs the same scope; "dismiss" returns to the chip row.
- day-less surfaces (home, checklists) hide the day scope; trip-less surfaces
  (checklists) also hide trip overview.

## Deferred (noted for later)

1. **Density / restraint preference harness** — the real fix for over-eager overviews:
   a couple-level setting or learned signal for how much they want planned vs. left
   open, consumed by the trip/day prompts. Part of the behavior-harness slice
   (vision #2), alongside clarify-then-act.
2. **Suggest ⟷ ask unification** (vision #4) — whether free-text suggest and chat
   should converge, and intent-routing (inward suggestion vs. outward discovery).
3. **Suggest ⟷ door merge** — reconsidered and dropped for now; revisit only if the
   two front doors prove confusing in use.
