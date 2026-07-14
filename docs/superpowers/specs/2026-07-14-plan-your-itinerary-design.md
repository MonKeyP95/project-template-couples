# Plan your itinerary — guided, profile-fed itinerary drafting

**Status:** design (2026-07-14). Execute slice by slice after review.

## Why

The itinerary is the trip's backbone. Today it's edited only by hand (add a
location, add a day, add events). This mirrors the guided **"Plan a budget"**
experience onto the itinerary: fed by the trip profile and a short context
preamble, an AI **draft-then-refine** flow proposes a full
`places → days → events` itinerary you then edit. Same guided-planner idea as
budget; the itinerary is the shared dataset, reached two ways.

This also fixes why the budget felt bolted-on: we were treating the budget as
the backbone when the itinerary is. Once this harness exists, "Plan a budget"
can be rebuilt to share it (parked — separate follow-up).

## Product flow (onboarding)

Creating a new trip or dream:

1. **Step 1 — Trip profile.** Reuse the existing `ProfileWizard` (idea / vibe /
   transport / per-category activity tags). Fill it, save.
2. **On save → Step 2 — Plan your itinerary** (the guided flow below).

After onboarding the guided flow stays available (**two accesses**): a
"Plan your itinerary" entry on the itinerary tab, and — later — inline on the
spine. Day-to-day editing continues in the existing itinerary UI, on the same
`itinerary_locations` / `itinerary_days` / `events` data.

## The guided flow (draft-then-refine)

- **Step 0 · Context.** The preamble that feeds the draft:
  - *where* — prefilled from the trip destination / profile,
  - *how many days* — from the trip's dates; asked outright for a dateless dream,
  - *what kinds of activities* — chips prefilled from the profile's category
    detail tags (`Food → burgers, sushi`; `Activities → surfing`),
  - a **free-text** "anything else."
- **Draft.** Send the context **+** `buildAssistantContext(workspaceId, tripId)`
  (couple profile + trip profile + taste dial — already built) to a new
  `draftItinerary` seam. Claude returns, **per place, its events grouped by
  category** (Activities / Food / Transportation — the budget blueprint applied
  to events, reusing the event `category` field), each event carrying an
  optional **day + time**, and a multi-day activity expressed as a **block**
  ("surfing · 3 days").
- **Refine.** The draft renders **per place, walked by category** (like the
  budget planner's per-category flow), events under each. Accept / edit / delete,
  set a day/time, add your own. **Malleable rearranging is NOT rebuilt here** —
  moving a block, growing/shrinking a day, shifting the rest lives in the
  **existing itinerary editor** after Apply (multi-day "added-together" blocks,
  spans, and gap-aware push already exist). The guide drafts; the itinerary
  editor rearranges.
- **Review → Apply.** Write the accepted draft to the itinerary (locations +
  days + events) via the existing itinerary mutation actions, then drop into the
  normal itinerary UI to keep refining.

## Data & write path

No new tables. Reuse `itinerary_locations`, `itinerary_days`, and the day
`events` jsonb, written through the existing itinerary actions (add location /
add day / append events). Apply maps the accepted draft onto those. Events carry
the existing optional **`category`** (`Food` / `Activities` / …); a **multi-day
activity block** maps to the itinerary's existing multi-day "added-together"
block via `addItineraryDay`'s `endDate` + `groupName` — no new mechanism.

**Apply semantics (key decision — see Open #1):** additive / merge, **not**
replace-all. First run populates an empty itinerary; a re-run **augments** (fills
empty days, adds proposed events) and never blind-wipes existing days. This is
the direct lesson from the budget's replace-all coupling, which caused the stale
-state and "two editors fighting" mess.

## AI seam

Mirror the budget planner exactly (`DECISIONS.md` 2026-06-15, 2026-07-09):

- `draftItinerary(context)` in `lib/ai/claude.ts` — a plain `messages.create`
  with a **forced** structured tool (`propose_itinerary`), **no `web_search`**
  (parametric knowledge + the profile answer in one round-trip; web-grounded
  place lookup is a later concern, and web search tripled latency before).
- A `"use server"` action that loads `buildAssistantContext` + trip data, calls
  the seam, and on any failure returns a **deterministic skeleton** (destination
  as one location + N blank days) so the flow still functions with AI off —
  same `drafted: false` fallback pattern as `draftBudget`.

## Dreams vs trips (two modes)

- **Trip** (dated): days carry real dates derived from the trip / location spans.
- **Dream** (dateless): the parallel numbered itinerary — the flow asks for a day
  count and produces **numbered** days, no dates. Promotion to a dated trip is
  the existing pipeline, untouched.

## Slice plan (design-first, then execute)

1. **Shell + write path — SHIPPED 2026-07-14 (dated trips only; in-app verified).**
   The guided flow with a deterministic skeleton (no AI), one access
   (itinerary-tab button). Proved the harness + additive write end-to-end.
   Dreams deferred (separate write path). Note: the shipped skeleton is
   place→day with empty events — the category-organized structure below lands in
   slice 2.
2. **AI feed + category-organized draft.** Context preamble +
   `buildAssistantContext` + the `draftItinerary` seam, returning events grouped
   **per place by category** (Activities / Food / Transportation) with an
   optional day/time and multi-day blocks. The profile-fed generation — the
   "wow," and the budget-blueprint flow the shipped shell was missing.
3. **Onboarding routing.** New trip/dream routes profile-first → guided itinerary.
4. **Two-access + polish.** Inline access on the spine, per-section free text,
   dream/trip parity refinements.

Parked (separate follow-up): rebuild "Plan a budget" to share this harness.

## Open decisions (for review)

1. **Apply semantics** — additive/merge (recommended: first-run populate, re-run
   augment, never blind-replace) vs replace-on-explicit-confirm.
2. **Refine granularity** — RESOLVED (2026-07-14, post-slice-1): **category-first
   per place** (Activities / Food / Transportation, the budget blueprint), events
   carrying an optional day + time (days are an event field, not a walk level),
   and multi-day activities as blocks. Malleable move/resize is **not** rebuilt in
   the guide — it reuses the existing itinerary editor. (Supersedes the earlier
   "single scrollable draft grouped by place→day.")
3. **Free text** — captured as AI context only (recommended) vs also saved as a
   day/location note.
4. **Profile step gating** — does Step 1 block creation, or is it skippable?
   (recommended: default-first but skippable, so a quick trip isn't forced
   through it.)

## Non-goals

- No new itinerary data model; no migration.
- No web-grounded place search in the draft (parametric + profile only for now).
- Not rebuilding "Plan a budget" in this feature (parked).
- Not replacing the hand-editing itinerary UI — the guided flow drafts and
  augments; the day UI stays the fine-grained editor.
- **Not building a parallel move/resize/timeline editor in the guide.** Moving a
  block, adding/reducing a day, and shifting the rest reuse the itinerary's
  existing multi-day blocks, spans, and gap-aware push. The guide only drafts.
