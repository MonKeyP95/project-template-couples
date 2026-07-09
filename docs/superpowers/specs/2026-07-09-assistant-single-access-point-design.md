# One assistant, one door — single AI access point

**Date:** 2026-07-09
**Status:** Draft (pending user spec review)

## Problem

AI is currently spread across three separate surfaces that can stack on one
page:

- a **floating assistant pill** (`assistant.tsx`) with a chat panel and, buried
  in its header, the AI on/off switch (`AiToggle`);
- per-surface **suggestion cards** (`AiSuggestion` on 7 surfaces);
- **discovery doors** (`FindAPlace` on-the-road, `FindAPlacePlanning` planning),
  each a four-category accordion.

On the itinerary and on-the-road pages you see a suggestion card *and* a door at
once. There is no single "this is the assistant" thing; the on/off is a switch
hidden inside the pill; and the doors open pre-expanded (Food showing, three more
categories stacked below).

We want **one access point**: a single, labelled, collapsible `assistant` block
that holds everything, with a **bare, press-to-open door** inside it.

## The model

One inline **`assistant` block** per page. Its header is the master control.

- **Collapsed = AI off.** All you see is the `assistant` label (moss, mono) and a
  chevron. Nothing else renders; no model is called.
- **Press the header = AI on.** The block unfolds to reveal, top to bottom:
  1. **suggest** — the existing on-demand `/ suggest` → Claude suggestion.
  2. **door** — a bare `⌕` line; press it to reveal the category list; pick one
     to reveal that category's search inputs (details below).
  3. **ask me anything** — the chat, inline.
- **Press again = AI off**, block collapses.

**Expand/collapse *is* the AI on/off.** It reuses the existing `ai` cookie +
`useAiMode()` context: expanded persists as "on", collapsed as "off", per person,
following the user across pages. **Default collapsed (off).**

This preserves the 2026-06-16 "AI off by default, explicit per-person opt-in"
decision — default state is off and nothing fires — with one deliberate
relaxation: the single `assistant` label is always visible, because it is the
entry point. Recorded in `DECISIONS.md` (see below). The "suggest-only, AI never
writes" invariant is unchanged.

## The door

Replaces the four-category accordion with progressive disclosure:

1. **Collapsed:** one bare line — a moss `⌕` icon and a chevron. **No text label.**
2. **Press:** the chevron rotates and a **vertical list** of categories drops in:
   Food, Activities, Accommodation (`soon`, disabled), Transport (`soon`,
   disabled). Press-only — no hover trigger (mobile-first; hover does not exist on
   touch).
3. **Pick a category:** its name becomes the door's breadcrumb next to the `⌕`,
   and that category's existing `DiscoverySection` inputs appear (craving / near /
   walkable / find), unchanged.

The door's per-mode context is supplied by the page:

- **On-the-road:** fixed add-target (today's `dayDate` / `dayId`), destination,
  meal-derived `when`, walkable default on.
- **Planning:** a location picker + day-select add-target, per the current
  `FindAPlacePlanning` inputs.

`DiscoverySection` (the find call, results list, add-to-day flow) is reused as-is.
Only the category-selection chrome changes: from stacked `CategorySection`
accordions to bare door → list → chosen category.

## Placement

The block renders **where AI renders today** — the same in-flow position the
current suggestion card / door occupy on each page (e.g. bottom of the itinerary,
top of on-the-road). No layout relocation this pass.

Doorless pages (home, packing, notes, checklists) show the block with **suggest +
ask-anything only** — no door section.

## Components & files

- **New:** `AssistantBlock` (client). Header toggles `useAiMode` (+ cookie); when
  expanded renders suggest + optional door + ask. Props: `surface` (for suggest),
  `tripSlug` (suggest + chat), and an optional `door` config describing mode +
  context. No `door` prop → no door section.
- **`assistant.tsx`:** removed. The floating pill and its chat panel go away; the
  chat logic (`sendChatMessage`) moves into `AssistantBlock`'s ask-anything line.
- **`ai-mode.tsx`:** keep `AiModeProvider` / `useAiMode` / cookie persistence;
  **remove the visible `AiToggle`** (the block header replaces it).
- **`ai-suggestion.tsx`:** its `/ suggest` → `SuggestionCard` logic is reused
  inside the block (moved or wrapped). The standalone component usages are removed.
- **`find-a-place.tsx` / `find-a-place-planning.tsx`:** their door bodies become
  the door section of `AssistantBlock`; `DiscoverySection` / `CategorySection`
  internals are reused (CategorySection likely retired in favour of the list).
- **~8 pages/tabs** currently rendering `AiSuggestion` / `FindAPlace` /
  `FindAPlacePlanning` swap to a single `AssistantBlock`.
- **`docs/DECISIONS.md`:** append a row for the relaxed off-by-default rule.

## Budget drafter — revisit later

The budget tab's `BudgetDrafter` is a multi-step tool, not a discovery door. It
**stays separate this pass.** Note the coupling to resolve when we revisit:
`useAiMode().enabled` now means "assistant block expanded", and the budget tab
currently swaps drafter ↔ manual field on that same flag — so expanding the block
on the budget page will show the drafter. Acceptable for now; **revisit folding
the drafter into the assistant block (or decoupling its gate) in a later slice.**

## Suggested slicing (for the plan)

1. Build `AssistantBlock` (header on/off + suggest + ask), no door; swap it onto
   the doorless pages. Ship.
2. Add the bare door section (on-the-road config, then planning config); swap it
   onto the itinerary and on-the-road pages. Ship.
3. Remove the floating pill (`assistant.tsx`), the `AiToggle`, and dead
   `AiSuggestion` / door render sites; update `DECISIONS.md` + `TODO.md`.

Each slice stays shippable (build + look + use).

## Out of scope

- Desktop "persistent side-column" placement of the block (possible later).
- A floating chat panel (removed; chat is inline in the block).
- Folding the budget drafter in (revisit, above).
