# Plan-your-itinerary — Stepper Reshape (design)

**Date:** 2026-07-14
**Status:** design, awaiting review
**Supersedes the UI of:** `2026-07-14-plan-your-itinerary-design.md` (Slice 2). The seam, action, and event model from Slice 2 are reused; only the guide UI and the draft prompt change.

## Why

Slice 2 shipped a working guided itinerary drafter, but two things read wrong in use:

1. **One long scroll.** The guide dumps a full AI draft into a single scrolling page grouped per place. It is hard to move through and it feels like the AI did the planning for you.
2. **The AI over-reaches.** It pads categories and can invent places/days that were never given (country -> city leaps, places conjured from the trip name).

The budget planner already solved the first problem with a calm one-thing-per-page **stepper**. This reshape makes the itinerary guide its twin: a category stepper, a **sparse** draft that leaves gaps on purpose, and grounding rules that stop the invention.

## What stays (reused from Slice 2, unchanged in shape)

- The AI seam `draftItinerary` (`src/lib/ai/claude.ts`) — plain `messages.create`, forced structured tool, no web_search, `MODEL = claude-sonnet-4-6`.
- The server action `draftItineraryForTrip` (`src/lib/ai/itinerary-actions.ts`) — workspace/trip guard, `buildAssistantContext`, non-throwing fallback to the deterministic scaffold when AI is off or fails.
- The write path — `applyItinerarySkeleton` and the existing itinerary actions that create/reuse a location by name and add days (`addItineraryDay`), skipping taken dates.
- The event model — `ItineraryEvent` with its optional `category`.

**No migration. No new dependencies.**

## What changes

1. **Category set widens 3 -> 5.** From `Activities, Food, Transportation` to the **budget five**: `Accommodation, Transportation, Activities, Food, Other`. Same labels as the budget planner so the two guides feel identical; the walk order is the user's stated one (`Accommodation -> Transportation -> Activities -> Food -> Other`).
2. **UI: one long scroll -> a 5-step wizard.** Setup screen, then one category per page, then Apply.
3. **Draft prompt: sparse + grounded.** A few anchored items per category (empty is fine), and three grounding rules.
4. **Seam gains a clarifying-question path.** The draft can return one short question instead of items when the input is too thin to ground on.

## The flow

### Step 0 — Setup (one screen)

Fields:
- **Places** — the user types their place names (ordered). Populates the per-item place picker and grounds the AI.
- **Dates** — prefilled from the trip's date range (read-only display; dated trips only).
- **Anything else?** — one free-text line, optional.

Actions: **Generate** (one AI call, seeds all five categories sparingly) or **Skip** (straight to empty pages). Either way, lands on Step 1.

If Generate returns a **clarifying question** instead of seeds (see below), the question renders on this screen with an input. The user answers (or skips), presses Generate again, and it drafts using the answer. At most one question; always skippable; never blocks.

### Steps 1-5 — one category per page

Order: **Accommodation -> Transportation -> Activities -> Food -> Other.**

Each page shows that category's items as editable rows and a `+ add` control. A row is:
- **text** (what the event is),
- an **optional place** (dropdown of the setup places),
- an **optional date** (within the trip range),
- a delete (`x`).

A small **N of 5** progress marker. **Back** / **Next** move between categories. AI seeds (if any) are already sitting on their pages for the user to edit, keep, or delete.

### Final — Apply

On the last page (Other), **Next** becomes **Apply**. Apply writes every filled-in item into the real itinerary via the existing write path: each item files under its chosen place (place-less items -> the first place) on its date, reusing location-by-name + day creation, skipping taken dates. Then `router.refresh()`.

## Invariant: the AI needs approval before anything enters the itinerary

- Generate/draft **only fills the wizard's own pages** — a client-side staging area. It writes **nothing** to the itinerary.
- The user reviews, edits, or deletes each seeded item on its page (per-item `x` = granular approval).
- **Apply is the single write**, and that press is the human approving. The AI proposes into staging; the human commits.

This preserves the project-wide suggest-only / never-auto-act rule.

## Draft behavior (sparse)

When Generate runs, the AI:
- Returns roughly **1-2 concrete items per category**, only where genuinely confident from the destination + couple profile. A category coming back **empty is expected and fine.**
- Fills `place` and `date` when obvious; leaves them blank when unsure.
- Does **not** pad with generic filler ("explore the old town") to look full.

## Grounding rules (prompt)

1. **Stay on the specific destination/place given.** "Faial" means Faial, not the whole country.
2. **No country -> city leaps.** Do not assume a capital or famous city the user did not name (the Madeira != Lisbon problem).
3. **Never invent a place or date from the trip's name.** A trip titled "Summer in the Azores" is not license to fabricate towns or days.

## The clarifying-question path (seam extension)

Today `draftItinerary` always returns events (forced `propose_itinerary`). This reshape lets it return **either** events **or** one question.

**Mechanism (kept minimal):** the `propose_itinerary` tool stays forced, but its input gains an optional `question: string`. Contract: when the input is too thin to ground on, return **empty `events` + a one-line `question`**; otherwise return events + empty `question`. This avoids `tool_choice: auto` and the risk of loose conversational text.

- `draftItinerary` returns `{ events, question }`.
- `draftItineraryForTrip` passes `question` through (return type gains optional `question`); its non-throwing AI-off/failure fallback returns `{ events: [], question: "" }` alongside the deterministic scaffold as today.
- The setup step shows the question when present; the user's answer is appended to the free-text/context on the next Generate.

Scope-honesty: this is *mostly* prompt work plus a small optional field and one branch in the seam and action — **not** purely prompt-only. Still no migration, no deps.

## Components / files

- **`src/lib/ai/itinerary-planner.ts`** — widen `ITINERARY_CATEGORIES` to the five, ordered `Accommodation, Transportation, Activities, Food, Other`. (Deterministic scaffold logic unchanged.)
- **`src/lib/ai/claude.ts`** — widen the `propose_itinerary` category enum to five; rewrite `ITINERARY_SYSTEM` for sparseness + the three grounding rules + the empty-events-plus-question contract; add the optional `question` field to the tool schema and to `draftItinerary`'s return.
- **`src/lib/ai/itinerary-actions.ts`** — `draftItineraryForTrip` returns `question` alongside events; fallback returns an empty question.
- **`src/app/trips/[slug]/plan-itinerary.tsx`** — reworked from single-scroll into the stepper. Given the size, split the client UI into focused pieces (e.g. a setup step, a category step with its row editor, and the stepper shell that owns staging state + navigation). Exact split decided in the plan.

## Scope / non-goals

- **Dated trips only** (unchanged from Slice 2; dreams render `DreamItineraryTab`).
- **Multi-day activity blocks, move/resize, span editing stay in the existing itinerary editor** — the "guide drafts, editor rearranges" split holds. The stepper does not gain them.
- No per-item AI (one Generate for all five, per decision A). No streaming.
- No change to how events are stored or to the public `/t/` projection.
- One clarifying question maximum, on the setup screen only — never mid-wizard.

## Verification

- `pnpm lint && pnpm build` clean.
- In-app (needs a logged-in session + key): Setup -> Generate returns a sparse draft (some categories may be empty, no invented places); walk the five pages editing/adding; Apply writes to the itinerary and it appears in the itinerary tab. Skip (no Generate) -> empty pages -> hand-fill -> Apply works. A deliberately thin setup triggers one clarifying question; answering it then drafts.
- Suggest-only held: nothing writes to the itinerary until Apply.

## Decisions log (for `docs/DECISIONS.md` on ship)

- Itinerary guide reshaped to a category stepper mirroring the budget planner; category set aligned to the budget five.
- Draft is sparse-by-design (anchors, not a full plan); grounding rules added to stop place/date invention.
- The itinerary draft seam may now ask one clarifying question (empty events + question), a small extension of the Slice-2 "never asks" contract, scoped to the guide's setup step.
