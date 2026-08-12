# Remove the daily road suggestion

**Date:** 2026-08-12
**Status:** proposed

## Decision

Remove the once-a-day AI suggestion card from the `/on-the-road` dispatch box. Keep the box, the weather card, the daily findings, the search door, the on-demand `/ suggest` button, and all three deterministic nudges.

## Why

The card was the only thing in the rotating box that asked to be answered. That is the wrong register for the box: weather and findings are glanceable and can rotate past you harmlessly, while a card holding a decision cannot — which is why answering it has to freeze the rotation for the session. The freeze is a workaround for a mismatch, not a feature.

The value it was meant to add is better served by the search door, which is invoked with intent and already knows how to file a result onto a chosen day (`AddTarget`'s `select` kind, `discovery-section.tsx:25`). Proactivity is not lost: the three nudges (weather-packing, near-daily-cap, unlogged-days) fire on real data, cost zero tokens, and cannot be wrong about facts. The daily card was the only proactive surface that guessed.

The learning loop is the one real loss — `added` / `refused` is signal nothing else captures, and a refusal in particular leaves no other trace. It is a small loss today because the `refused` `TasteSignal` that would have carried it into the trip summary and the couple profile was deferred and never built. As shipped, the history only dedupes the next day's prompt.

## Scope

### Deleted outright

Five files that exist only for this feature:

- `src/lib/ai/agents/road-suggestion.ts`
- `src/components/road-suggestion-card.tsx`
- `src/lib/trips/road-suggestion-actions.ts`
- `src/lib/trips/road-suggestion-queries.ts`
- `src/lib/trips/road-suggestion-types.ts`

### Edited

**`src/lib/trips/dispatch-actions.ts`** — drop the suggestion half of `ensureDispatch`: the `getSuggestionForDay` call and the `dispatch && suggestion` early return (lines 39-41), the whole `if (!suggestion)` block (lines 79-112), the `getAnsweredSuggestions` / `getSuggestionForDay` imports and `proposeRoadSuggestion` from the `@/lib/ai/claude` import. The early return becomes `if (dispatch) return`. `getTripExpenseCategories` becomes unused here and its import goes too.

**`src/components/dispatch-box.tsx`** — drop the `suggestion` prop from `DispatchBox`, `LiveDeck` and `buildCards`, the `RoadSuggestionCard` and `SuggestionCardData` imports, the `onInteract` parameter, and the `stopped` state plus its term in the timer effect's guard and dependency array. The `paused` hover/focus behaviour predates the card and stays. The null guard at line 86 becomes `if (!weather && items.length === 0) return null`.

**`src/app/on-the-road/page.tsx`** — drop the `getSuggestionForDay` import, the `suggestionRow` fetch (line 137) and the `suggestion` object built from it (lines 140-148), the `suggestion` prop on `DispatchBox` (line 208), and the `!suggestionRow` half of the trigger condition (line 212), which becomes `{!dispatch && aiOn ? <DispatchTrigger … /> : null}`.

**`src/lib/ai/claude.ts`** — drop the `proposeRoadSuggestion` / `RoadSuggestionQuery` re-export (lines 28-30).

**`src/lib/ai/registry.ts`** — drop the `propose_road_suggestion` tool entry (line 211).

### Kept, deliberately

- **The `trip_suggestions` table and its migration file.** No drop migration. The table is empty, its RLS policies are harmless, and migrations here are a hand-pasted ledger — leaving it costs nothing and means the schema is already there if the idea returns. Recorded as a DECISIONS row so a future reader knows the orphan is intentional.
- **`trip_dispatch`, the `dispatch` agent and its web search.** The findings cards are unaffected.
- **The rotation itself**, which reverts to weather + findings, all read-only.
- **`Math.min(index, count - 1)` in `LiveDeck`** (line 167), with its comment rewritten. Its original reason — answering shortens the deck — is gone, but the deck still grows from one card to several when `DispatchTrigger` refreshes the page after generating findings, and a held index surviving that transition is cheaper to clamp than to reason about.

## Rollback

The removal lands as one commit. Reinstating is `git revert` of that commit; the table it writes to is still in the database, so nothing else is needed.

## Success criteria

### Verified by Claude

1. `rg "road-suggestion|roadSuggestion|RoadSuggestion|propose_road_suggestion|SuggestionCardData|trip_suggestions"` over `src/` returns no matches.
2. `pnpm lint` is clean.
3. `npx tsc --noEmit` is clean.
4. `pnpm build` succeeds (run only when the dev server is not holding `.next`).
5. `ensureDispatch` contains exactly one model call (`generateDispatch`) and one table write (`trip_dispatch`).
6. `DispatchBox` has no prop, state or import referring to a suggestion, and `buildCards` returns weather + items only.

### Verified by the user in-app

1. `/on-the-road` loads with no error, on a trip that is active today.
2. The box shows the weather card and, on a day with findings, the findings cards — and no card anywhere in the rotation has buttons on it.
3. The box still auto-advances every 7 seconds, and still pauses while you hover or keep focus inside it.
4. With only a weather card, the box is static — no dots, no timer — as before.
5. On a brand-new trip-day the findings still generate: the box fills in a few seconds after the page paints.
6. The assistant block still opens, `/ suggest` still returns a suggestion, and the search door still finds places and adds them to today.
7. All three nudges still appear when their conditions hold (near-daily-cap, unlogged days, weather-packing on the packing tab).
8. Readable at a phone viewport, light and dark.
