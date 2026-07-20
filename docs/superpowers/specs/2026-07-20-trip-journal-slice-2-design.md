# Trip Journal — Slice 2 Design (trip summary at close)

Date: 2026-07-20
Status: Design approved; ready for an implementation plan.
Parent: `docs/superpowers/specs/2026-07-20-trip-journal-design.md` (pipeline, Slice 1).

## What this is

The **trip summary** layer of the journal pipeline. For a **closed** trip (today
past its end date), the `/profile` "By trip" section shows an AI taste summary of
that trip — the existing four per-category blocks (Food / Activities /
Accommodation / Transport) plus a **money block** — generated once at close and
hand-editable. Ongoing trips show only the raw Slice-1 journal.

This slice is deliberately **small**. The four decisions below (settled in
brainstorming) all resolve toward reusing what already works: the summary keeps
its per-category shape, the money block is the existing computed widget, and the
"generate once, no more churn" lifecycle falls out of gating on trip close rather
than any new machinery.

## The four settled decisions

1. **Shape — keep the 4 per-category blocks + a money block.** Not one cohesive
   narrative. Reuses `trip_summaries` (keyed `(trip_id, category)`) exactly as
   today. **No schema change, no migration.**
2. **Lifecycle — closed-only, generate once, frozen, manual regenerate.** A trip
   gets its AI summary only after it closes; generated lazily on the first
   profile view after close; frozen afterward. The existing **Refresh** button is
   the only redo path. Ongoing trips get no AI summary.
3. **Money block — reuse the computed `TripBudget`, relocated.** The money block
   *is* today's `TripBudget` widget (per-category spent / planned / variance +
   total), shown for closed trips inside the summary grouping. **No AI touches
   numbers** (numbers are the artifact). No new money code.
4. **AI input — unchanged.** `gatherTripTasteSignals` + `summarizeTaste` stay
   byte-identical. The journal remains the *visible raw record*, not the AI's
   input. Re-sourcing the prompt from the journal is a deferred follow-up, not
   this slice.

## Why the churn retires itself (the load-bearing insight)

Today the per-trip `LearnedSummary` auto-refreshes on mount whenever
`isSummaryStale` is true — which covers both "no summary yet" (first generation)
**and** "signals drifted since generation" (a redo). This is the continuous churn
the pipeline design wants to retire.

Once a trip is **closed**, its signals are frozen. So gating the per-trip AI
blocks to closed trips makes the drift case effectively never fire on its own:
the summary is generated once (on first view, when it is empty) and then stays
put. The lifecycle the user asked for is delivered almost entirely by **gating on
the existing date-driven buckets** (`listTripsForWorkspace` -> `now` /
`upcoming` / `past`), not by new lifecycle code.

## What actually changes

### A. Gate per-trip AI blocks + money block to closed trips (`src/app/profile/page.tsx`)

- **AI taste blocks** (`getTripLearnedBlocks`): computed for **`past`** trips
  only, not for `now`. (Today: computed for all started trips = `now` + `past`.)
- **Money block** (`TripBudget`, via `getProfileBudgetData(startedTrips).summaries`):
  the per-trip `budgetByTrip` map is filtered to **`past`** trip ids only. The
  cross-trip `BudgetHistory` zone at the bottom keeps reading all started trips
  (it is Slice-3 territory, untouched here).
- **Journal** (`TripJournal`): unchanged — still rendered for all started trips
  (`now` + `past`), per Slice 1.
- **Inclusion / ordering:** `byTripRows` still iterates started trips. A `now`
  trip appears only if it has a journal (shows journal alone). A `past` trip
  shows its heading -> AI taste blocks -> journal -> money block (current render
  order preserved). Nothing else in the "By trip" markup changes.

Concretely: build `pastTripIds = new Set(buckets.past.map(t => t.id))`; compute
`tripBlocks` over `buckets.past` (not `startedTrips`); when building
`budgetByTrip`, filter `budgetSummaries` to `pastTripIds`. `getProfileBudgetData`
stays called with `startedTrips` so `BudgetHistory` is unaffected.

### B. First-generation-only auto-fire for closed per-trip blocks (`src/app/profile/learned-summary.tsx`)

The one net behavior change. When `tripId` is set (the per-trip case), the
mount-time auto-generate must fire **only when there is no summary yet**
(`summaryMd.trim() === ""`), not on drift. Drift redo is left to the manual
**Refresh** button (already present, already wired to `refreshTripSummary`).

- Gate the existing `useEffect` auto-fire so that, when `tripId` is present, the
  trigger is "summary empty" rather than `stale`. The general (non-trip) sections
  keep today's drift-based auto-refresh (they are rewired in Slice 3).
- The Refresh button and its `stale` label / "N new — refresh" affordance stay as
  they are — that is the manual regenerate path the user chose.

Do **not** split the component or add state-reset effects (React-19 edit-in-place
rule); a single added condition on the auto-fire is sufficient.

## What is explicitly NOT in this slice

- No schema change, no migration, no new table.
- No change to `summarizeTaste`, `gatherTripTasteSignals`, or the AI prompt/input.
- No re-sourcing the AI from the journal (deferred follow-up).
- No touching the general top-level "what we like" sections or `BudgetHistory`
  (both Slice 3).
- No sharing / matching / export.
- No decluttering the closed-trip view: closed trips intentionally show **both**
  the raw journal and the summary for now. The journal is hidden on closed trips
  only in Slice 3, once summaries are trusted as the compressed replacement.

## Accepted trade-offs

- **Ongoing trips lose the AI taste blocks and the budget widget on `/profile`.**
  Intended — no profile learning during a trip. Their raw journal already shows
  per-location spend and totals, so no money information is lost mid-trip; only
  planned-vs-actual variance is deferred to close.
- **Closed trips show journal + summary + money together** — transitional
  overlap, accepted (mirrors Slice 1's philosophy), decluttered in Slice 3.

## Nothing lost vs. today

| Today on `/profile` | Slice 2 | Guard |
| --- | --- | --- |
| Per-trip taste blocks (editable, AI-refresh) | Same blocks, gated to closed trips; generated once at close | still editable; drift-auto-refresh retired, manual Refresh kept |
| "We run +X% over on food" (budget widget) | Relocated `TripBudget` inside closed-trip summary | computed, never AI'd |
| Manual regenerate | Existing Refresh button | unchanged |
| Cross-trip budget history | Untouched (`BudgetHistory`) | Slice 3 rewires |

## Success criteria

- On `/profile`, a **closed** (`past`) trip with enough signal shows its AI taste
  blocks and the relocated `TripBudget` money block under its heading; an
  **ongoing** (`now`) trip shows only its raw journal (no AI blocks, no budget
  widget).
- A closed trip's summary generates lazily once on first view (AI on) and does
  **not** auto-refresh afterward; the Refresh button still forces a redo.
- The general top-level sections and `BudgetHistory` are unchanged.
- Dreams and empty trips show no summary (unchanged).
- No schema/migration; `summarizeTaste` and the AI input are untouched.
- `pnpm lint` and `pnpm build` pass.
