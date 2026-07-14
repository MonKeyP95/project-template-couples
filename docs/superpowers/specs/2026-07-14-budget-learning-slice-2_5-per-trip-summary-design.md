# Budget learning — Slice 2.5: per-trip budget summary (on /profile "By trip")

**Date:** 2026-07-14
**Status:** design, ready to plan
**Part of:** the budget-learning arc. Follows Slice 1 (per-trip lens in the Budget tab) and Slice 2 (cross-trip history on /profile). A small addition, not a full slice — hence 2.5. Slice 3 (AI suggestion harness) is still the next real slice.

## Why

The taste layer has a **trip-first** record on `/profile`: the "By trip" zone groups by trip — "Denmark summer" as a heading with its learned summaries (`trip_summaries`). The budget layer has no trip-first equivalent: Slice 1's per-trip breakdown lives only in the trip's Budget tab, and Slice 2 is category-first (a trip is scattered across category lines). So there is no single place showing **one trip's whole money picture** — the budget half of that trip's shareable record ([[project-trip-summary-as-shareable-unit]]).

This adds it: under each trip's heading in the existing "By trip" zone, a **separate "Trip budget" header** with that trip's per-category spend-vs-plan. Still numeric, deterministic, no AI, no migration.

## Confirmed layout

```
By trip
  Denmark summer
    Food · Activities                 <- taste "what we've learned" (unchanged)
    Trip budget                        <- NEW separate header, this trip's budget
      Food           spent €520 / €400   +€120 over
      Accommodation  spent €700 / €700   on plan
      Activities     spent €180 / €150   +€30 over
      Total          spent €1,400 / €1,250
  ... other trips ...

Budget history (what our trips actually cost)   <- Slice 2, STAYS at bottom, untouched
```

## Decisions (confirmed in brainstorming)

- **Layout A** — interleaved under each trip heading, budget as its own sub-header beside the taste sub-sections. Not a separate parallel zone.
- **Trip visibility = union.** The "By trip" zone today lists only trips with taste blocks. It now lists the **union** of trips with taste blocks and trips with a Trip budget (real spend), preserving `startedTrips` order. A trip with spend but no taste shows heading + Trip budget only; a trip with taste but no spend shows taste only.
- **Trip budget renders only when the trip has real spend** (total actual > 0). Pure-planning/dream trips get no Trip budget section.
- **Content:** per category `spent €{actual} / €{planned}` + variance (`+€X over` / `€X under` / `on plan`), plus a **Total** line (trip totals + overall variance). Categories shown = those with a plan or spend (the trip's full `perCategoryRollup`, so category lines sum to the totals). **No €/day here** — a single trip's daily rate isn't a comparison; €/day lives in the bottom cross-trip zone.
- **Deterministic, no AI, no migration.** Re-pivots Slice 2's per-trip rollups by trip; the bottom "Budget history" zone is untouched.

## Design

### 1. Pure layer — add the trip-first summary

In `src/lib/trips/budget-history-types.ts`, add:

```ts
export interface TripBudgetSummary {
  tripId: string
  tripName: string
  /** The trip's per-category rollup (categories with a plan or spend), ordered by catOrder. */
  categories: CategoryRollup[]
  totalPlannedCents: number
  totalActualCents: number
}

/** Trip-first view: the trip's full rollup plus totals. Render only when
 *  totalActualCents > 0 (real spend). */
export function buildTripBudgetSummary(input: TripRollupInput): TripBudgetSummary
```

`input.rollup` is already the `perCategoryRollup` output (union of planned/actual, ordered by `catOrder`), so `categories = input.rollup`; totals are the summed plan/actual. Reuses everything; no new fetch logic.

### 2. Server query — one budget fetch feeding both views

Refactor `src/lib/trips/budget-history-queries.ts` so `/profile` does a **single** batched read for all budget data:

- Extract the current fetch-and-rollup body of `getBudgetHistory` into `getTripRollups(trips: TripListItem[]): Promise<TripRollupInput[]>` (the two batched `.in()` reads + `perCategoryRollup` per trip + `dayCountInclusive`).
- Replace `getBudgetHistory` with:

  ```ts
  export async function getProfileBudgetData(
    trips: TripListItem[],
  ): Promise<{ history: CategoryHistory[]; summaries: TripBudgetSummary[] }> {
    const rollups = await getTripRollups(trips)
    const catOrder = [...EXPENSE_CATEGORIES]
    return {
      history: buildBudgetHistory(rollups, catOrder),
      summaries: rollups
        .map(buildTripBudgetSummary)
        .filter((s) => s.totalActualCents > 0),
    }
  }
  ```

  `getBudgetHistory` is removed (its only caller was the page, which now calls `getProfileBudgetData`). One DB fetch, both lenses derived from the same rollups. No duplicated fetch or rollup logic.

### 3. UI — the Trip budget section + union restructure

New presentational component `src/app/profile/trip-budget.tsx` (`TripBudget({ summary }: { summary: TripBudgetSummary })`) — **not** a client component (static, no hooks; renders inside the server page):
- A `Trip budget` sub-header (same `mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground` style as the taste category sub-labels).
- One line per `summary.categories`: `{category}` · `spent €{actual} / €{planned}` · variance (clay when over, muted otherwise), plus a `Total` line (`totalActualCents` / `totalPlannedCents` + overall variance).

In `src/app/profile/page.tsx`:
- Replace `const budgetHistory = await getBudgetHistory(startedTrips)` with `const { history: budgetHistory, summaries: budgetSummaries } = await getProfileBudgetData(startedTrips)`.
- Build the union rows:

  ```ts
  const tasteByTrip = new Map(tripBlocks.map((tb) => [tb.trip.id, tb.blocks]))
  const budgetByTrip = new Map(budgetSummaries.map((s) => [s.tripId, s]))
  const byTripRows = startedTrips
    .filter((t) => tasteByTrip.has(t.id) || budgetByTrip.has(t.id))
    .map((t) => ({
      trip: t,
      blocks: tasteByTrip.get(t.id) ?? [],
      budget: budgetByTrip.get(t.id) ?? null,
    }))
  ```
- Restructure the "By trip" block: guard on `byTripRows.length > 0`; iterate `byTripRows`; per row render the `<h3>` trip name, then the existing taste `blocks.map(...)`, then `{row.budget ? <TripBudget summary={row.budget} /> : null}`.
- Zone header copy: change `By trip (what each trip taught us)` -> `By trip` (it now holds budget too).

The bottom `<BudgetHistory categories={budgetHistory} />` zone is unchanged.

## Non-goals (deferred)

- **Durable snapshot** (survive trip deletion) — still Decision A / Slice 2.5-snapshot-if-needed.
- **AI** — no narrative, no suggestions (Slice 3).
- **€/day in the per-trip section** — cross-trip comparison stays in the bottom zone.
- **Editing / expense drill** from the summary — the live record is the Budget tab (Slice 1).
- **Making the per-trip summary a shared/exported artifact** — it now exists as a surface; packaging it as the shareable unit is future work.

## Testing / verification

- Unit-test the pure addition (throwaway tsx, delete after): `buildTripBudgetSummary` — `categories` equals input rollup; totals sum plan/actual; a rollup with all `actualCents === 0` yields `totalActualCents === 0` (so the page filters it out).
- `pnpm lint` + `pnpm build` clean.
- In-app (logged-in): on `/profile`, a trip with real spend shows, under its heading, the taste sections (if any) **and** a separate "Trip budget" section with correct per-category spent/planned + variance and a Total; category lines sum to the Total; a trip with spend but no taste appears with only Trip budget; a planning-only trip appears in neither the By-trip zone (unless it has taste) nor with a Trip budget; the bottom "Budget history" zone is unchanged.

## Risks

- **By-trip block restructure** touches working taste-rendering code. Mitigated: taste markup is copied verbatim into the new row loop; only the iteration source and guard change.
- **Category-name coupling** unchanged from Slices 1-2 (free-text category names). Acceptable.
