# Profile-aware suggestions — design

Date: 2026-07-13
Status: approved, ready for a plan

## Goal

Make the on-demand `/ suggest` engine read the couple's profiles so its cards are
specific to who they are, instead of the current generic per-surface suggestions.
Today the introspective suggestion engine (`suggestForSurface` /
`buildScopedPrompt` in `src/lib/ai/suggestion-actions.ts`) reads only operational
trip data (budget items, packing labels, itinerary days, etc.); it never touches
any profile. The discovery engine already reads all the profile sources — this
brings `/ suggest` to parity.

Scope is **enrich `/ suggest` only**: no writes, no apply, no new proactive
triggers, no change to discovery.

## Core principle: profile is a prior, not a filter

A filter says "only burgers." A prior says "burgers are one signal about who these
people are — lean that way, don't collapse to it." We want the prior. Because the
model is handed context (not a SQL `WHERE`), a prior is the natural default: the
profile shifts the odds, it doesn't fence the answer.

The reframe that makes this safe: **the profile is evidence of taste, not a
shopping list.** "Burgers, sushi" is not "suggest burgers"; it is a signal to
generalize from — casual comfort + fresh/adventurous — so the model can suggest a
great taco place that was never on their list. That generalization is the "loose"
behavior we want, and it is enforced by prompt wording, not code.

## The taste dial (three sticky stops)

A per-person preference, three stops, controlling how heavily the prior weighs:

- `surprise` — stretch beyond their usual, help them discover
- `balanced` — the light lens (default); sounds like them but stays varied
- `feels-like-us` — lean into what they clearly love

Three stops rather than a 1-5 slider on purpose: the dial only works if the model
behaves differently at each setting, and an LLM cannot reliably distinguish five
gradations. Three intents map to three prompt framings the model reliably honors.

### Persistence and placement

Cookie-persisted per person, exactly mirroring the existing `ai` mode cookie
(`src/lib/ai/ai-mode.ts` + `src/components/ai-mode.tsx`):

- New cookie `taste`, values `surprise | balanced | feels-like-us`, default
  `balanced` when unset or unrecognized.
- Server read: a new `getTasteLevel()` in a small module (e.g.
  `src/lib/ai/taste-level.ts`), reading `cookies()` like `isAiEnabled()`.
- Client write: a 3-way toggle at the top of the `/ suggest` scope menu in
  `assistant-block.tsx`, writing `document.cookie` (path `/`, one-year max-age,
  samesite lax) the same way `useAiMode().setEnabled` does, then `router.refresh()`.
- It rides the existing AI on/off gate: the dial only renders inside the expanded
  assistant block (AI on), alongside the scope chips it already shows.

## The profile block

A new async helper `buildProfileBlock(workspaceId, tripId?)` in
`src/lib/ai/profile-context.ts` assembles one compact "who this couple is" string
from the real query layer:

- `getTripProfile(tripId)` (`src/lib/trips/queries.ts`) — idea, vibe[], transport[]
- `getTripExpenseCategories(tripId)` (`src/lib/trips/expense-queries.ts`) — category
  names and their `details[]` tags (Food -> burgers, sushi)
- `getDiningPreferences(workspaceId)` (`src/lib/preferences/dining-queries.ts`) —
  budget band, cuisines, dietary, activities
- `getCoupleSummary(workspaceId, "Food")` and `("Activities")`
  (`src/lib/preferences/couple-summary-queries.ts`) — the learned "what we've
  learned" text; included only when `summaryMd` is non-empty

Rules:

- Every piece is **omitted when empty**, so a bare trip yields a short block and a
  brand-new workspace with no profile yields an empty string (the caller then adds
  no background section at all).
- `tripId` is optional: workspace surfaces (`home`, `checklists`) have no trip, so
  only the workspace-level sources (dining prefs, learned summaries) contribute.
- The helper returns data only (suggest-only invariant under `lib/ai`), performs no
  writes, and is called only after the existing AI-enabled + workspace guards.

## Prompt framing

Two additions inside `buildScopedPrompt`, applied to every scope
(`page` / `trip` / `day` / `free`):

1. The profile block is appended **last and labelled as background**, e.g.:
   `Who they are (background - a lens, not a checklist): <block>`.
   Being last and labelled keeps it below the surface/scope data in priority — the
   budget gap, the day's events, or the free-text request always lead.
2. A single dial line, chosen by `getTasteLevel()`:
   - `surprise`: "Lean away from their usual patterns; suggest something outside
     their comfort zone to help them discover."
   - `balanced`: "Let their taste gently color the suggestion; generalize it, don't
     echo it, and feel free to stretch."
   - `feels-like-us`: "Lean into what they clearly love; suggest something that will
     feel unmistakably theirs."

The `balanced` line is the direct "burgers" fix: *generalize, don't echo*.

When the profile block is empty, **both** the background section and the dial line
are omitted: a taste dial over no taste data is meaningless, so the prompt falls
back to exactly today's behavior. The dial line is added only alongside a non-empty
profile block.

## Wiring

- `suggestForSurface(surface, tripSlug?, scope?)` additionally reads
  `getTasteLevel()`, resolves the trip id when a `tripSlug` is in play (it already
  loads the trip via `getTripBySlug`), calls `buildProfileBlock`, and threads both
  the block and the dial level into `buildScopedPrompt`.
- `buildScopedPrompt` (and the per-surface `buildPrompt` it falls through to)
  append the background section + dial line after their existing content.
- `generateSuggestion(prompt)` in `claude.ts` is **unchanged** — it already accepts
  an arbitrary prompt string.

## Two modes

No new mechanism. `buildScopedPrompt` already computes `modeLine` (planning vs
on-the-road, dates-driven). The profile block and dial line layer on top unchanged,
so a `feels-like-us` on-the-road suggestion and a `balanced` planning suggestion
both work without a mode branch of their own.

## Out of scope (holds the line on scope-1)

- No writes / no "apply" (suggestions stay advisory; discovery keeps the only write
  path).
- No new proactive triggers (the slice-2 nudge framework is untouched).
- No per-surface source gating — the dial handles domination, so every surface gets
  the one shared block and the model judges relevance.
- No change to the discovery engine or its own profile assembly (accepted mild
  duplication over a premature shared abstraction).
- No new tables and no migration — the dial is a cookie; all data sources already
  exist.
- No streaming.

## Files

- New: `src/lib/ai/profile-context.ts` (`buildProfileBlock`), `src/lib/ai/taste-level.ts`
  (`getTasteLevel` + the `TasteLevel` type / `TASTE_COOKIE`).
- Changed: `src/lib/ai/suggestion-actions.ts` (read dial, build block, thread into
  the prompt), `src/components/assistant-block.tsx` (the 3-way dial toggle in the
  suggest menu).
- Unchanged: `src/lib/ai/claude.ts`, the discovery engine, all query-layer modules.
