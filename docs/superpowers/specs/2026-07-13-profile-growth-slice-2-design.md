# Profile-growth slice 2 — per-trip taste summaries — design

Date: 2026-07-13
Status: ready for a plan
Refines: `2026-07-13-profile-growth-design.md` (slice 2 section) and supersedes its
"surface on the trip page, regenerate on trip open" framing.

## Goal

Give the couple `/profile` a **per-trip taste record**: for each trip they have
actually taken, a learned Food/Activity summary scoped to that one trip. It sits
below the existing general "What we've learned" blocks as a **"By trip"** history.

The purpose is not a trip-page feature — it is that the profile **accretes a
per-trip history** so the couple's footprint on past trips stays legible even as the
raw signals age, and so a single trip's taste becomes a **self-contained unit** that
can later be shared or imported by a different couple (out of scope here; the
sharing vision is recorded separately, not built in this slice).

## Relationship to the general summary (decided: added history layer)

The general `(workspace, category)` summary is **unchanged**. It keeps reading raw
signals across all trips directly, exactly as slice 1 shipped it. Per-trip summaries
are a **new, additive display layer** — a trip-by-trip breakdown — not a rollup the
general summary is rebuilt from. The summary-of-summaries model was considered and
deferred: it rewrites a working pipeline for scaling the profile does not yet need.

## Why per-trip summaries also future-proof the general summary

The current general summary reads **all raw signals across all trips, flat** — no
recency weighting, no notion of trip style. That is correct at a handful of trips.
Over many years it degrades in three ways, plus one mechanical limit:

1. **Blur** — averaging hundreds of places into a few bullets regresses to the mean;
   everything reads as "they like good food and nice views."
2. **No recency** — a place loved nine years ago counts the same as one from last
   month, though taste drifts.
3. **No context** — a backpacking trip and a luxury anniversary trip blend into one
   incoherent "taste" that describes neither.
4. **Scale/cost** — feeding thousands of raw signals to Claude eventually exceeds the
   context window and gets expensive. "Read everything" has a hard ceiling.

Slice 2 does **not** solve blur, and should not try. Its value here is that it makes
the per-trip summary a **stable, dated, context-carrying unit**, which is the
primitive the eventual fix needs:

- **Recency** — a trip summary is stamped with the trip's date, so a future general
  rollup can window (last ~N years / N trips) or weight recent trips heavier —
  impossible to do cleanly over raw signals.
- **Style** — each trip summary is tied to that trip's idea/vibe, so a future rollup
  can group by style ("on beach trips you like X; on city trips Y") instead of
  flattening it away.
- **Scale** — the general summary can later switch from "read all raw signals" to
  "read the N relevant trip summaries": bounded input regardless of how many years
  accrue.

That eventual switch **is** the deferred summary-of-summaries model. It is not built
here on purpose: a recency window or a style-clustering rule cannot be tuned with no
trip history — it would be guessing. Building the primitive now lets that decision be
deferred without repainting into a corner; flipping the general summary over later is
a small, non-destructive change because the dated, context-carrying unit already
exists. Per-trip summaries are the escape hatch for when the flat general summary
stops being correct.

**Cheap thing done now to keep the door open:** a trip summary must stay queryable
with its **trip date** and a pointer to the **trip idea/vibe**. No schema cost —
`trip_summaries.trip_id` joins straight to `trips` (which holds `start_date` and the
trip profile) — but the queries and display must not discard that join, so a future
rollup has date + style available for free.

## The model

### Scope and which trips qualify

- Scope key is `(trip, category)`, category in `food | activity` (accommodation and
  transport stay slice 3).
- A trip renders a block only when **`start_date <= today`** (local) — a started or
  finished trip. Upcoming trips still in planning, and dateless dream trips, show
  nothing. This matches the "history from past trips" intent and avoids thin,
  ratings-less summaries.
- Within a qualifying trip, a category renders only when its signal count clears the
  existing `RATING_FLOOR` (3), reusing the slice-1 gate.

### Signals (unchanged kinds, trip-scoped gather)

The same three signal kinds as slice 1, filtered to one trip by `trip_id` (all three
source tables carry it directly — no workspace join needed):

| Kind | Source, filtered by trip | Strength |
|------|--------------------------|----------|
| `rated` | `event_ratings` where `trip_id = :trip` and `category` | strong |
| `planned` | `itinerary_days` where `trip_id = :trip`; parse events; un-rated; `inferRatingCategory === category` | weak |
| `wanted` | `expense_categories` where `trip_id = :trip`; `expenseCategoryToLearned(name) === category` | weak |

A new `gatherTripTasteSignals(tripId, category)` returns the combined
`TasteSignal[]`. `signalToLine` and `summarizeTaste` are reused untouched — the
per-trip corpus is just a narrower slice of the same signal stream.

### Two-modes note

The block reads naturally in both modes because timing decides the signal mix:
a started-but-current trip (on the road) is accumulating `rated` signals ("what
we're loving"), a finished trip is dominated by them ("what we loved"). The copy
stays neutral; no mode toggle. Pure-planning trips are excluded by the start-date
gate, so the awkward "summary of a trip we haven't taken" case never renders.

## Storage — new `trip_summaries` table

Mirrors `couple_summaries`, keyed by trip instead of workspace:

```sql
create table if not exists public.trip_summaries (
  trip_id uuid not null references public.trips(id) on delete cascade,
  category text not null,
  summary_md text not null default '',
  signal_count_at_generation int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (trip_id, category)
);
```

- A **separate table**, not a nullable `trip_id` column on `couple_summaries`: a
  primary-key column cannot be null, and a trip's summaries want to be a clean,
  independently-queryable unit (the future shareable artifact).
- Column is named `signal_count_at_generation` (not the legacy
  `rating_count_at_generation`) since it is new and always held a signal count.
- RLS: select/insert/update to `authenticated`, gated on workspace membership
  reached **through the trip** — `public.is_workspace_member((select workspace_id
  from public.trips where id = trip_id))`. Follows the existing trip-scoped-table
  pattern (`itinerary_days`, `expense_categories`); the plan confirms the exact
  policy shape against one of those.
- Idempotent migration (`create table if not exists`, `do $$ … duplicate_object`
  guard on policies), per the repo convention.

## Regeneration — lazy on `/profile` view

No cron. Each per-trip block auto-regenerates the first time `/profile` is opened
after enough new signal has landed, identical to today's general block:

- Staleness = current trip signal count vs `signal_count_at_generation`, `>= 20%`
  new (reuses `isSummaryStale`).
- On mount, if stale and AI is on, the block fires `refreshTripSummary` in the
  background; the stored summary shows instantly and the fresh one swaps in.

For a personal app with a handful of trips this is a small number of blocks and at
most one AI call each — no batching or queue.

## Server actions and queries

- `couple-summary-queries.ts` gains `gatherTripTasteSignals(tripId, category)`,
  `getTripSummary(tripId, category)`, and `countTripSignals(tripId, category)`.
  The three existing single-kind gathers are parameterized (or given trip-scoped
  twins) to filter by `trip_id`; `gatherTasteSignals` (workspace-wide) is unchanged.
- `couple-summary-actions.ts` gains `refreshTripSummary(tripId, category)` and
  `saveTripSummary(tripId, category, md)`, mirroring the workspace pair but
  upserting into `trip_summaries` and stamping `signal_count_at_generation`. They
  `revalidatePath("/profile")`.

## Display — reuse the editable `LearnedSummary`

Generalize the existing `LearnedSummary` component and the two actions it calls to
take an **optional `tripId`**:

- When `tripId` is present it calls `refreshTripSummary` / `saveTripSummary`;
  otherwise the existing workspace actions. Same editable-textarea + Save + Refresh
  UI, no new markdown rendering. Editable per-trip blocks also serve the future
  "tidy a trip up before sharing" case for free.
- On `/profile`, a **"By trip"** section lists qualifying trips newest-first. For
  each trip, render Food and/or Activity `LearnedSummary` blocks that clear the
  floor, under the trip name. Trips are sourced from the started/finished buckets of
  `listTripsForWorkspace` (the exact bucket keys are confirmed in the plan).

## The assistant retrieval harness (named north star, not built here)

The eventual payoff of this corpus: at scale the assistant should assemble
suggestion context by **relevance-ranked retrieval**, not a flat read. Per suggestion
it (1) reads the current trip profile to derive its style, (2) **cheaply and
deterministically** selects the top-K most similar past trips by vibe/transport/budget
overlap (no model call for selection — the style key already lives on the trip
profile), (3) reads those trips' per-trip summaries, and (4) synthesizes from a
**bounded** context: current trip + one coarse couple backdrop (the
summary-of-summaries) + K neighbour summaries. Raw signals never reach the model.
Context stays O(1) regardless of trip count, which is the real answer to "is it too
much data at ten years?" — retrieval *replaces* reading everything.

Slice 2 is the corpus this stands on. Two layers sit above it and are **not built
here**: the summary-of-summaries backdrop, then the retrieval harness itself (only
worth building once there are enough trips that style-matching is selective — at a
few trips it returns all of them). The one obligation slice 2 carries for it: the
trip summary must stay queryable with its **vibe/idea — that is the retrieval key**,
never stored as a bare blob.

## Out of scope

- The rollup / summary-of-summaries model (general keeps reading raw signals).
- The retrieval harness above (style-matched top-K selection + synthesis).
- Sharing, export, or cross-couple import of a trip summary — future; this slice
  only makes the per-trip unit exist and persist cleanly.
- Any trip-page surface for the summary.
- Accommodation and Transport categories, and trip-profile context-header routing —
  slice 3.
- Dream trips and upcoming-but-unstarted trips.

## Open questions for the plan (not the design)

- Exact `listTripsForWorkspace` bucket shape for "started or finished" (it already
  buckets `now` / `upcoming`; confirm the past/started key and whether `now`
  qualifies — it should).
- Exact RLS policy phrasing against the `itinerary_days` / `expense_categories`
  precedent (subquery vs a helper).
- Whether the per-trip auto-fire should stagger to avoid a burst of AI calls when a
  couple with many past trips opens `/profile` — likely unnecessary at current
  scale; decide with a real trip count.
