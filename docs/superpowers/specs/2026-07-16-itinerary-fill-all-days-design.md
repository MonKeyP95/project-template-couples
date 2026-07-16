# Fill All Days: Empty Days Become Real Rows

**Date:** 2026-07-16

## Goal

Remove "empty day" as a separate concept. A location with a date span has a
real `itinerary_days` row for **every** date in that span. A row with no events
renders with the current dashed "empty" look — but as a normal day card. No gap
placeholders, no run-coalescing, no `empty:<date>` slots.

## Motivation

The derived-gap model (empties are computed dates with no row, drawn as
`EmptyDayButton`, faked as `empty:<date>` slots for drag) added a parallel code
path that isn't worth its complexity. Making every day a real row collapses that
path: an empty day is just a day with no events.

## Model

**Invariant:** a location with a declared span `[start, end]` has exactly one
`itinerary_days` row per date in the span. No gaps.

- **Empty day** = a real row with zero events. Not a special type.
- Data model shape is unchanged; only the invariant is new.
- Locationless / transit days and dateless dreams are out of scope — unchanged.

## Behavior

- **Fill / reconcile:** when a location's span is set or edited, reconcile its
  rows to the span — insert a row for each missing date, delete rows whose date
  falls outside the new span. A reconcile is a single server-side operation.
- **Render:** a 0-event row draws with the dashed empty visual inside the normal
  day card. There is no separate empty component.
- **Drag:** every date in the span is now a real row, so reordering is a plain
  permutation of real days over their own dates — the existing
  `reorderRangeSlots` (fed occupied-only dates) + `rescheduleItineraryDaysTo`
  path already does this. No new RPC or action.
- **One-time backfill:** an idempotent migration inserts the missing rows for
  existing spanned locations so current trips have no gaps.

## Code removed (in `itinerary-tab.tsx` unless noted)

- `EmptyDayButton`, `SortableEmptyDay`.
- The gap computation (`rangeStart` / `rangeEnd` / `occupied` / `empties`) and
  the `Item` → `Row` → `emptyRun` coalescing model. `rows` becomes just the
  segments from `toSegments(group.days)`.
- `expandedRuns` state + `setExpandedRuns` + `toggleRun`, and `fillEmpty`.
- In `itinerary-types.ts`: simplify `reorderRangeSlots` (its `empty:<date>`
  branch is now dead); remove `effectiveRange` / `gapDates` if unused.

## Code added

- A reconcile operation (server action + helper) that materializes/prunes a
  location's rows to its span, called from the location-span edit path.
- An empty (0-event) state on the day card using the existing dashed styling.
- Backfill migration (idempotent; manual apply per repo convention).

## Kept

- `rescheduleItineraryDaysTo` action + `reschedule_itinerary_days_to` RPC.
- The on-the-road "earlier days" collapse (`earlierOpen` / `toggleEarlier`) —
  real past days, unrelated to empties.
- The location date span itself and its header display.

## Deferred (handle when it actually comes up, not before)

- Shrinking a span (or deleting a boundary day) when a dropped date has events:
  simplest behavior for now; revisit if it bites.
- No-span locations and loose days: keep current behavior.

## Verification

- `pnpm lint && pnpm build`.
- In-app: set a location span with gaps → every date appears as a day, empty
  ones dashed; drag reorders real days; partner sees it via Realtime; the
  backfill filled the existing trip.

## Build order (incremental)

1. Reconcile helper + server action; call it on span edit.
2. Backfill migration; apply manually.
3. Day-card empty state (dashed) for 0-event rows.
4. Remove the empty-rendering code path; simplify `reorderRangeSlots`.
5. Docs: `TODO.md`, `DECISIONS.md` (note the reversal of the derived-gap /
   drag-empties approach).
