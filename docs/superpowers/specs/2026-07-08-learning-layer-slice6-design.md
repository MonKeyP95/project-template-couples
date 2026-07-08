# Learning layer (two-level profile, slice 6) — design

**Date:** 2026-07-08
**Status:** design agreed; spec for review.
**Roadmap:** the final item (6) of `docs/superpowers/specs/2026-07-07-two-level-profile-vision.md`.
**Builds on:** Slice D event `rating`/`note` (the raw signal), the couple
profile category accordion (slice 4), and the per-category discovery engine
(slice 5).

## One line

Ratings accumulate into a durable log → Claude distils a living, editable
per-category **markdown summary** → discovery reads the summary on every search.

## Vision fit

Roadmap item 6: "derive the visible learned preferences from ratings, show them
editable in the couple profile, and feed them into discovery ranking." This slice
also seeds the user's broader instinct that the profile becomes an **.md-like
living document** the AI reads — but scoped **only** to the learned couple
summary. Converting the manual trip/couple profile fields to markdown is a later,
separate reframe, explicitly out of scope here.

## The two stores (decided)

The raw data and the distillation are **two different things with two different
jobs** — never one blob.

1. **`event_ratings` (new, append-only) — the corpus. "All data saved."**
   - Every rating writes a row the moment it is saved, in *addition* to the
     existing event-jsonb write (that stays — it renders inline on the card).
   - Durable: survives editing/deleting the event, the day, or the whole trip,
     because `workspace_id` is the anchor.
   - Columns: `id uuid pk`, `workspace_id uuid not null`, `trip_id uuid null`
     (FK to `trips`, `on delete set null`), `day_date date null`,
     `event_text text not null`, `note text`, `rating smallint not null`
     (1-5), `category text not null`, `created_by uuid`, `created_at timestamptz
     default now()`.
   - **`category`** is a best-effort tag set at write time by a small heuristic
     (meal word in the event text → `food`, else `activity`). It exists so
     staleness and summary input can be computed **per category** (the % rule
     below needs per-category counts). It is best-effort only; the summariser
     still reads `event_text`, so a mis-tag is low-stakes.
   - Append-only: a re-rate appends a new row rather than mutating. The
     summariser sees history; we do not dedupe (YAGNI — keep it simple).
   - Only rows with a real 1-5 rating are logged. Clearing a rating does **not**
     append (the corpus is "ratings expressed").
   - RLS: workspace-member read/insert, mirroring `dining_preferences`
     (`20260629000001_dining_preferences.sql`). No update/delete policy needed.

2. **`couple_summaries` (new) — the distillation.** One row per
   `(workspace_id, category)`:
   - `workspace_id uuid`, `category text`, `summary_md text not null default ''`,
     `rating_count_at_generation int not null default 0`, `updated_at timestamptz`.
   - PK `(workspace_id, category)`.
   - Per-category (not columns on `dining_preferences`) so Accommodation /
     Transport can join later with no schema change.
   - RLS: workspace-member read/insert/update.

## Generation — the `lib/ai` seam

New `summarizeTaste(category, currentSummaryMd, ratings) → Promise<string>` in
`src/lib/ai/claude.ts`. One Claude call, **no `web_search` tool** — a plain
`messages.create`. Prompt shape:

> Here is the couple's current {category} summary (it may contain their own
> hand-edits — **respect them**): {currentSummaryMd}. Here are their {category}
> ratings (place · rating · note): {ratings}. Produce an updated, short markdown
> summary of what this couple likes and dislikes in {category}, evolving the
> current summary rather than discarding it.

Returns markdown text; the caller persists it. **Suggest-only** — the seam never
writes to the DB (CLAUDE.md invariant).

Because each pass **feeds the current summary (edits included) back as the base
and evolves it**, a hand-edit is never lost — it becomes authoritative input to
the next pass. This is what makes auto-replace safe. "Respect the edits" is a
soft prompt instruction (Claude may paraphrase); acceptable — the couple can
re-edit and the next pass respects that.

## Trigger — percentage staleness, lazy, non-blocking

`stale(category) = noSummaryYet OR (total − rating_count_at_generation) / total ≥
0.20`, where `total` is the count of `event_ratings` for that
`(workspace, category)`. Floor: **≥ 3 ratings** before the first summary is
offered (below that, no learned block).

Rationale (user): early ratings each carry more weight — 5 ratings, one more is
20% and worth a refresh; 30 ratings, one more is 3% and is not. Scaling the bar
to the corpus size beats a fixed "N new ratings."

**When it fires:** computed on couple-profile load, per category. When stale, the
learned block regenerates **in the background** (current summary shows instantly;
the fresh one swaps in when ready) so a stale load never blocks on a Claude call.
Replace is always safe (edit-preserving generation).

## AI on/off interaction (decided — "position 3")

- **Logging is AI-free.** Writing an `event_ratings` row is a plain DB insert.
  The corpus grows whether AI is on or off; you never lose signal by having AI
  off.
- **Generation is AI-gated.** `summarizeTaste` lives behind `isAiEnabled()`,
  exactly like discovery's 403. No Claude call fires while AI is off.
- **The toggle does not itself generate.** Flipping AI on has no side effect. The
  work happens where the summary lives: the **next couple-profile load** with AI
  on and a stale category regenerates in the background. So the behaviour is
  "after AI is on — automatically, next time you're on the profile — no manual
  ask."
- **AI off but a summary exists:** still shown, still hand-editable (editing is a
  DB write, no Claude). Only *refresh* is disabled, replaced by a quiet "turn on
  AI to refresh from your N new ratings."
- **Discovery never triggers generation.** It reads whatever `summary_md` exists
  (or none → falls back to the structured prefs). Keeps discovery fast and
  generation in one place. Trade-off accepted: flip AI on and go straight to a
  search without visiting the profile, and that first search has no learned block
  yet.

## Show — couple profile

The Food and Activities `CategorySection`s (`src/app/profile/page.tsx`) each gain
a **"What we've learned"** block, rendered by a new client component
`src/app/profile/learned-summary.tsx` (`"use client"`):

- An editable `<textarea>` bound to `summary_md`, with a **Save** (calls
  `saveCoupleSummary`, no AI).
- A **refresh** affordance that auto-highlights when stale ("3 new ratings —
  refresh"); disabled with the "turn on AI" hint when AI is off.
- On mount, if `stale && aiOn`, it calls `refreshCoupleSummary` (background) and
  swaps in the result.
- Hidden entirely below the 3-rating floor.

Server props from the page: `summaryMd`, `ratingCount` (total for the category),
`countAtGeneration`, `aiOn`. Staleness is derived client-side from those.

## Rank — discovery

- `DiscoveryQuery` (`src/lib/ai/discovery-types.ts`) gains `learned: string`.
- The route (`src/app/api/ai/discover/route.ts`) loads
  `getCoupleSummary(workspace.id, category)` and passes `summary_md` as `learned`
  (`""` when none).
- `discoveryPrompt` (`claude.ts`) renders a block when non-empty: *"From past
  trips, this couple has especially enjoyed — {learned}"*. Precedence:
  **after** craving and this-trip, but as a **strong** couple signal (it is
  evidence-based, so it outweighs the static structured base). Prompt-level, like
  slice 3 — no code merge.

## Server actions & queries (new)

- `refreshCoupleSummary(category)` — `isAiEnabled()` guard; loads the category's
  ratings + current summary; `summarizeTaste`; upserts `couple_summaries` with
  the new `summary_md` **and** `rating_count_at_generation = current total`.
- `saveCoupleSummary(category, md)` — no AI; upserts `summary_md` only, leaving
  `rating_count_at_generation` untouched. So a manual edit does **not** clear
  staleness: if still stale, the next load regenerates and folds the edit in
  (user's "manual edit → generate anyway").
- `getCoupleSummary(workspaceId, category)` and `countRatings(workspaceId,
  category)` query helpers.
- `rateEvent` (`src/lib/trips/actions.ts`) gains the log append: after the
  existing jsonb update, when `rating` is a real 1-5, insert an `event_ratings`
  row (needs `workspace_id` + `trip_id` + `day_date` — read them alongside
  `events` from `itinerary_days`/`trips`). The event-jsonb write is unchanged.

## Migration

`supabase/migrations/20260708000001_learning_layer.sql` — both tables + RLS,
idempotent (`create table if not exists`, `drop policy if exists` then create).
Applied by hand in the Supabase SQL editor (single shared project — dev = prod).

## Deferred / non-goals

- Per-partner learning (ratings aren't per-partner — slice D deferred it).
- Accommodation / Transport learning (no rating source yet; inactive doors).
- Hard edit-locking / pinned lines (soft respect via prompt only).
- Converting the manual trip/couple profile fields to markdown (bigger reframe).
- Discovery-triggered generation; background job / cron.
- Deduping re-rates in the corpus.

## Principles honoured

- **Two modes:** generation + editing are couple-profile (always-on / planning);
  the learned summary feeds **both** discovery doors unchanged.
- **Cheapest first:** no new vendor, no cron, one Claude call per refresh; reuse
  the `lib/ai` seam, the category accordion, and the discovery prompt stack.
- **Suggest-only:** nothing under `lib/ai` writes; generation is gated by AI mode
  and never silently overwrites a hand-edit.
- **All data saved:** the append-only log is the durable corpus, independent of
  the fragile event jsonb and of the AI toggle.
