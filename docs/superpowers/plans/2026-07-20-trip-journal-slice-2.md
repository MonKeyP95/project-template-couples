# Trip Journal — Slice 2 Implementation Plan (trip summary at close)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/profile`, show a closed trip's AI taste summary (the 4 per-category blocks + the relocated `TripBudget` money block), generated once at close; ongoing trips show only the raw Slice-1 journal.

**Architecture:** Two surgical changes. (1) In `learned-summary.tsx`, make the per-trip block auto-generate only when it has no summary yet (first view at close), leaving drift-redo to the existing manual Refresh button. (2) In `profile/page.tsx`, gate the per-trip AI blocks and the `TripBudget` money block to `past` (closed) trips only; the raw journal keeps rendering for all started trips. No schema, no migration, no change to `summarizeTaste` or the AI input.

**Tech Stack:** Next.js 16 App Router (React 19 Server + Client Components), TypeScript, Supabase, Tailwind v4. Package manager: `pnpm`.

## Global Constraints

- Verification per task is `pnpm lint` and `pnpm build` (repo has no test framework — do not invent one).
- No schema change, no migration, no new dependency.
- Do NOT modify `summarizeTaste`, `gatherTripTasteSignals`, or the AI prompt/input.
- Do NOT touch the general top-level "what we like" sections or `BudgetHistory` (Slice 3).
- Do NOT split `LearnedSummary` into subcomponents or add state-reset effects (React-19 edit-in-place rule); a single condition change is sufficient.
- The raw journal (`TripJournal`) keeps rendering for all started trips (`now` + `past`) — unchanged from Slice 1.
- European date order everywhere it applies (`en-GB`); no new dates introduced here.
- No emojis in code.
- Spec: `docs/superpowers/specs/2026-07-20-trip-journal-slice-2-design.md`.

---

### Task 1: First-generation-only auto-fire for per-trip blocks

Make the per-trip (`tripId` set) `LearnedSummary` auto-generate on mount **only when it has no summary yet**, instead of whenever it is stale. Drift-redo stays on the manual Refresh button (already wired to `refreshTripSummary`). General (non-trip) sections keep today's drift-based auto-refresh.

**Files:**
- Modify: `src/app/profile/learned-summary.tsx`

**Interfaces:**
- Consumes: existing `LearnedSummary` props (`category`, `summaryMd`, `ratingCount`, `countAtGeneration`, `aiOn`, `tripId?`) — signature unchanged.
- Produces: no new exports; behavior change only. Page consumers in Task 2 rely on `LearnedSummary` NOT auto-refreshing a per-trip block once it has a summary.

- [ ] **Step 1: Read the current auto-fire block**

Open `src/app/profile/learned-summary.tsx`. The relevant code today:

```tsx
  const stale = isSummaryStale(
    ratingCount,
    countAtGeneration,
    summaryMd.trim() !== "",
  )
  const newCount = Math.max(0, ratingCount - countAtGeneration)

  const refresh = React.useCallback(async () => {
    setBusy(true)
    const res = tripId
      ? await refreshTripSummary(tripId, category)
      : await refreshCoupleSummary(category)
    if (res.summaryMd !== undefined) setText(res.summaryMd)
    setBusy(false)
  }, [category, tripId])

  // Background-regenerate once on mount when stale and AI is on. The current
  // summary shows instantly; the fresh one swaps in when ready.
  const started = React.useRef(false)
  React.useEffect(() => {
    if (stale && aiOn && !started.current) {
      started.current = true
      void refresh()
    }
  }, [stale, aiOn, refresh])
```

- [ ] **Step 2: Add the per-trip auto-fire condition**

Replace the `const started = ...` + `React.useEffect(...)` block above with:

```tsx
  // Per-trip blocks (closed trips) auto-generate only on first view — when there
  // is no summary yet — then stay put; a redo is manual via Refresh. The general
  // sections keep drift-based auto-refresh (Slice 3 rewires them).
  const autoFire = tripId ? summaryMd.trim() === "" : stale
  const started = React.useRef(false)
  React.useEffect(() => {
    if (autoFire && aiOn && !started.current) {
      started.current = true
      void refresh()
    }
  }, [autoFire, aiOn, refresh])
```

Leave `stale` and `newCount` as-is — they still drive the Refresh button's label ("N new — refresh") and the AI-off hint below.

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: no errors (no unused vars — `stale`/`newCount` are still referenced by the button/hint).

- [ ] **Step 4: Run build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Reason through behavior (no test framework)**

Confirm by reading:
- `tripId` set + `summaryMd` empty -> `autoFire === true` -> generates once on mount.
- `tripId` set + `summaryMd` present (drifted or not) -> `autoFire === false` -> no auto-fire; Refresh button still shows "N new — refresh" when `stale`.
- `tripId` undefined (general sections) -> `autoFire === stale` -> unchanged from today.

- [ ] **Step 6: Commit**

```bash
git add src/app/profile/learned-summary.tsx
git commit -m "feat(journal): per-trip summary auto-generates once, no drift auto-refresh"
```

---

### Task 2: Gate per-trip AI blocks + money block to closed trips

In `profile/page.tsx`, compute the per-trip AI taste blocks and the `TripBudget` money block for `past` (closed) trips only. The raw journal keeps rendering for all started trips. The cross-trip `BudgetHistory` zone stays over all started trips (untouched).

**Files:**
- Modify: `src/app/profile/page.tsx`

**Interfaces:**
- Consumes: `listTripsForWorkspace` buckets (`now`, `upcoming`, `past`); `getTripLearnedBlocks(tripId)`; `getProfileBudgetData(startedTrips)` returning `{ history, summaries }` where each summary has a `tripId`; `getTripJournal`; `LearnedSummary` (Task 1); `TripJournal`; `TripBudget`.
- Produces: no new exports.

- [ ] **Step 1: Add the closed-trip id set**

Find (around line 75):

```tsx
  const startedTrips = [...buckets.now, ...buckets.past]
```

Immediately after it, add:

```tsx
  const pastTripIds = new Set(buckets.past.map((t) => t.id))
```

- [ ] **Step 2: Compute AI taste blocks for closed trips only**

Find the `tripBlocks` computation:

```tsx
  const tripBlocks = (
    await Promise.all(
      startedTrips.map(async (trip) => ({
        trip,
        blocks: await getTripLearnedBlocks(trip.id),
      })),
    )
  ).filter((tb) => tb.blocks.length > 0)
```

Change the iterated source from `startedTrips` to `buckets.past`:

```tsx
  const tripBlocks = (
    await Promise.all(
      buckets.past.map(async (trip) => ({
        trip,
        blocks: await getTripLearnedBlocks(trip.id),
      })),
    )
  ).filter((tb) => tb.blocks.length > 0)
```

- [ ] **Step 3: Gate the money block map to closed trips**

Find:

```tsx
  const { history: budgetHistory, summaries: budgetSummaries } =
    await getProfileBudgetData(startedTrips)
  const tasteByTrip = new Map(tripBlocks.map((tb) => [tb.trip.id, tb.blocks]))
  const budgetByTrip = new Map(budgetSummaries.map((s) => [s.tripId, s]))
```

Leave the `getProfileBudgetData(startedTrips)` call and `budgetHistory` unchanged (so `BudgetHistory` still spans all started trips). Filter only the per-trip `budgetByTrip` map to closed trips:

```tsx
  const { history: budgetHistory, summaries: budgetSummaries } =
    await getProfileBudgetData(startedTrips)
  const tasteByTrip = new Map(tripBlocks.map((tb) => [tb.trip.id, tb.blocks]))
  const budgetByTrip = new Map(
    budgetSummaries
      .filter((s) => pastTripIds.has(s.tripId))
      .map((s) => [s.tripId, s]),
  )
```

Leave `journalByTrip` (built from `startedTrips` above this) untouched — the raw journal still renders for ongoing and closed trips. The existing `byTripRows` filter (`tasteByTrip.has || budgetByTrip.has || journalByTrip.has`) and the render loop need no changes: an ongoing trip now matches only via `journalByTrip` (journal alone); a closed trip can match all three.

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 5: Run build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 6: Reason through behavior (no test framework)**

Confirm by reading the render loop:
- Ongoing (`now`) trip with content: appears via `journalByTrip` only -> heading + `TripJournal`; no `LearnedSummary` blocks, no `TripBudget`.
- Closed (`past`) trip with enough signal + spend: heading + AI taste blocks + `TripJournal` + `TripBudget` money block.
- `BudgetHistory` (bottom zone) still receives `budgetHistory` from all started trips — unchanged.
- Dream / empty trip: no journal (`isEmpty`), not in `past` with blocks -> not shown. Unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/app/profile/page.tsx
git commit -m "feat(journal): show per-trip AI summary + money block for closed trips only"
```

---

### Task 3: Docs — TODO + DECISIONS

Record the slice as shipped and the one non-obvious choice.

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Add a TODO entry**

Prepend a Slice-2 entry under the "Current Phase" block in `docs/TODO.md` summarizing: closed-trips-only gating of the per-trip AI taste blocks + relocated `TripBudget` money block; per-trip blocks auto-generate once on first view at close, drift-redo via the manual Refresh button; journal unchanged; no schema/migration, `summarizeTaste`/AI input untouched. Note in-app verification pending, and that Slice 3 (profile reads from summaries + declutter closed-trip journal + re-source AI from journal) is next. Reference the spec and this plan.

- [ ] **Step 2: Add a DECISIONS row**

Append a `2026-07-20` row to `docs/DECISIONS.md`: "Trip summary generates only at trip close (dates-driven, `past` bucket), once, lazily; per-trip drift auto-refresh retired in favor of a manual Refresh; money stays the computed `TripBudget` (never AI'd); AI input left unchanged (re-sourcing from the journal deferred)." Match the existing row format in that file.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs(journal): record Slice 2 shipped (TODO + DECISIONS)"
```

---

## Self-Review

**Spec coverage:**
- Decision 1 (keep 4 blocks, reuse `trip_summaries`, no schema) — inherent; no code change needed, blocks already per-category. Covered (nothing to do).
- Decision 2 (closed-only, generate once, frozen, manual regenerate) — Task 1 (first-gen-only auto-fire) + Task 2 (gate blocks to `past`). Covered.
- Decision 3 (money = relocated computed `TripBudget`) — Task 2 gates `budgetByTrip` to `past`; render already places it in the trip group. Covered.
- Decision 4 (AI input unchanged) — Global Constraints forbid touching `summarizeTaste`/gatherers; no task edits them. Covered.
- "Churn retires itself via gating" — Task 2 gates to `past`; Task 1 ensures no drift auto-refresh. Covered.
- Journal stays on all started trips — Global Constraints + Task 2 Step 3 leaves `journalByTrip` untouched. Covered.
- `BudgetHistory` untouched — Task 2 Step 3 keeps `getProfileBudgetData(startedTrips)` + `budgetHistory`. Covered.
- Success criteria (ongoing = journal only; closed = blocks + money; generate once, no auto-refresh; dreams/empty unchanged; lint+build) — Tasks 1-2 reasoning steps + verification. Covered.

**Placeholder scan:** No TBD/TODO-in-code; every code step shows exact before/after. Docs task (Task 3) describes content to write, matching how prior slices logged docs (acceptable — prose docs, not code). Clean.

**Type consistency:** `pastTripIds` is `Set<string>`; `s.tripId` is a string (from `budgetSummaries`); `autoFire` is `boolean`. `LearnedSummary` signature unchanged. Consistent.
