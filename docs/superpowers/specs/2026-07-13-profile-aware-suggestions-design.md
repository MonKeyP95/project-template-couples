# Profile-aware assistant — design

Date: 2026-07-13
Status: revised (assistant-wide) — ready for a plan

> **Increment history.** The first increment shipped enrich-`/ suggest`-only with
> the taste dial living inside the `/ suggest` menu (commits `ad365a3`..`5eff729`
> on `feat/profile-aware-suggestions`). This revision generalizes it to the whole
> assistant: one shared context, consumed by each sub's own harness, and the dial
> promoted to the assistant-block level. Sections below reflect the revised target.

## Goal

Make the **whole assistant** — `/ suggest`, the "ask me anything" chat, and the
find-a-place discovery door — read the couple's profiles and honor one shared
"taste" setting, so every sub-tool is specific to who they are instead of generic.

Mental model (the user's framing): the assistant is a **high-level thing that reads
everything we know** (the shared context); the three subs are **lower-level
harnesses** that each decide how to consume that context, and each harness is
expected to grow/refine independently later (proactive triggers, clarify-then-act,
etc.). We unify the **context**, not the **engines** — the three engines stay
separate on purpose (a one-shot structured suggestion, a multi-turn conversation,
and a cited web search are different calls; merging them was rejected 2026-07-10).

Scope: **enrich only** — no writes/apply, no new proactive triggers, no engine
merge, no change to how the couple profile *grows* (that is its own future slice).

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

The dial is an **assistant-wide** setting, not a suggest-only one. It is
cookie-persisted per person, mirroring the existing `ai` mode cookie
(`src/lib/ai/ai-mode.ts` + `src/components/ai-mode.tsx`):

- New cookie `taste`, values `surprise | balanced | feels-like-us`, default
  `balanced` when unset or unrecognized.
- Server read: `getTasteLevel()` in `src/lib/ai/taste-level.ts`, reading
  `cookies()` like `isAiEnabled()`. (Already built.)
- Client write: a 3-way toggle at the **assistant-block level** (`assistant-block.tsx`),
  rendered once whenever the block is expanded (AI on) — above all three sub-tools,
  not inside the `/ suggest` menu. It writes `document.cookie` (path `/`,
  one-year max-age, samesite lax). No `router.refresh()` — each sub reads the
  cookie fresh on its next server call.
- It rides the existing AI on/off gate: hidden while the block is collapsed (off),
  visible the moment the assistant is pressed open. This reads as "the assistant's
  overall taste," which is the point.

## The profile block

A new async helper `buildProfileBlock(workspaceId, tripId?)` in
`src/lib/ai/profile-context.ts` assembles one compact "who this couple is" string
from the real query layer:

- `getTripProfile(tripId)` (`src/lib/trips/queries.ts`) — idea, vibe[], transport[]
- `getTripExpenseCategories(tripId)` (`src/lib/trips/expense-queries.ts`) — category
  names and their `details[]` tags (Food -> burgers, sushi)
- `getDiningPreferences(workspaceId)` (`src/lib/preferences/dining-queries.ts`) —
  budget band, cuisines, dietary, activities
- `getCoupleSummary(workspaceId, "food")` and `("activity")`
  (`src/lib/preferences/couple-summary-queries.ts`) — the learned "what we've
  learned" text; included only when `summaryMd` is non-empty. Note the category
  values are the lowercase `LearnedCategory` union (`"food" | "activity"`).

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

## Shared context, per-sub harness

The heart of the revision. One builder assembles "everything we know" once; each
sub's harness picks the fields it needs.

### The shared context

New `buildAssistantContext(workspaceId, tripId?)` in `src/lib/ai/assistant-context.ts`
returns a small **structured object**, not a pre-baked string, so each harness can
consume selectively:

```ts
interface AssistantContext {
  profileBlock: string      // buildProfileBlock(...) — "" when no profile
  taste: TasteLevel         // getTasteLevel()
  tasteDirective: string    // TASTE_DIRECTIVE[taste]
}
```

It reuses the already-built `buildProfileBlock` and `getTasteLevel` + `TASTE_DIRECTIVE`.
It reads only; no writes (suggest-only invariant). This function *is* "the assistant
reads everything"; the subs below are the harnesses.

### Harness 1 — `/ suggest` (already built, refactored)

`suggestForSurface` calls `buildAssistantContext` and, when `profileBlock` is
non-empty, appends the labelled background section + `tasteDirective` to the prompt
(the current `withProfile` logic, lifted to consume the shared object instead of
calling `buildProfileBlock`/`getTasteLevel` itself). Empty profile → prompt
byte-identical to today (both lines omitted). `generateSuggestion` unchanged.

### Harness 2 — chat ("ask me anything")

`sendChatMessage` / `tripContextFor` (`src/lib/ai/chat-actions.ts`) today build only
basic trip facts. They additionally fold in `profileBlock` (labelled as background,
same wording as suggest) and `tasteDirective`, so chat is genuinely profile-aware
and honors the dial. Chat can be opened with no trip slug: it still resolves the
workspace and pulls workspace-level profile + dial. `chatReply` in `claude.ts` takes
the enriched context string unchanged (already a `(messages, context)` signature).

### Harness 3 — discovery door (dial only)

The door already reads the profile *structurally* (dining prefs, trip profile,
learned summary become `DiscoveryQuery` fields in `/api/ai/discover`), so it must
**not** also receive `profileBlock` — that would duplicate. It consumes only the
dial: the route reads `getTasteLevel()` and passes the level onto the query; a new
`taste` field on `DiscoveryQuery`; `discoveryPrompt` in `claude.ts` renders the
matching directive so `surprise` widens the picks and `feels-like-us` keeps them
safely on-taste. This layers on top of discovery's existing precedence ladder
(craving > this trip > couple defaults > learned) as an adventurousness weight.

## Two modes

No new mechanism. `buildScopedPrompt` already computes `modeLine` (planning vs
on-the-road, dates-driven). The profile block and dial line layer on top unchanged,
so a `feels-like-us` on-the-road suggestion and a `balanced` planning suggestion
both work without a mode branch of their own.

## Out of scope

- No writes / no "apply" (all three subs stay advisory; the door's accept-to-event
  is its existing, separate write path).
- No new proactive triggers (the slice-2 nudge framework is untouched). The per-sub
  harnesses are the place those grow later, but not in this slice.
- **No engine merge** — the three subs stay separate calls; only the context is
  shared.
- No change to how the couple profile *grows* — item databases / extended learning
  to accommodation/transport are a separate future brainstorm.
- Discovery does not receive the profile block (it already reads the profile
  structurally); it gets the dial only.
- No new tables and no migration — the dial is a cookie; all data sources already
  exist. No streaming.

## Files

- New: `src/lib/ai/assistant-context.ts` (`buildAssistantContext` + `AssistantContext`).
- Already built (first increment): `src/lib/ai/profile-context.ts` (`buildProfileBlock`),
  `src/lib/ai/taste-types.ts` (`TasteLevel`, `TASTE_COOKIE`, `TASTE_LEVELS`,
  `normalizeTaste`, `TASTE_DIRECTIVE`), `src/lib/ai/taste-level.ts` (`getTasteLevel`).
- Changed by this revision:
  - `src/lib/ai/suggestion-actions.ts` — `withProfile` consumes the shared context.
  - `src/lib/ai/chat-actions.ts` — chat harness folds in profile block + dial.
  - `src/app/api/ai/discover/route.ts` + `src/lib/ai/discovery-types.ts` +
    `src/lib/ai/claude.ts` (`discoveryPrompt`) — discovery harness gets the dial.
  - `src/components/assistant-block.tsx` — move the dial toggle out of the `/ suggest`
    menu up to the block level.
- Unchanged: `generateSuggestion` and `chatReply` signatures; all query-layer modules.
