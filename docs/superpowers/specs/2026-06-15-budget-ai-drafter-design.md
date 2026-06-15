# Guided budget assistant (mock)

Date: 2026-06-15
Status: approved (design)

## Goal

A mock AI assistant on the Budget (planning) side that helps a couple build and
understand their trip budget through a short guided interview, rather than a
single number. It reads the trip's itinerary, pre-fills what it can infer, asks
only the genuine unknowns, and assembles a total. "Mock" means no API calls — the
interview steps, questions, and suggested amounts are derived deterministically
from the itinerary. The point of the slice is to build the whole interaction
surface and the seam, so swapping in real Claude later is one file.

This is the first concrete piece of Phase 5. It does not install the Anthropic
SDK and adds no tables.

## Conceptual model

The app separates **Budget** (planning, before the trip) from **Expense**
(reality, on the road). This assistant is a planning tool: it lives on the Budget
side and helps build the plan. There is deliberately **no planned-vs-actual**
comparison — that is statistics, not planning.

The itinerary's day-groups (called "locations") are flat **places/cities**
(Tel Aviv, Haifa, Rome). There is no country/region level; "flat cities" was
chosen over a region hierarchy. Two grains exist and differ:
- The assistant **asks** at the place level (2 weeks in Tel Aviv earns its own
  question, distinct from 5 nights in Haifa).
- Money **rolls up** to a single trip total. A country subtotal (e.g. "Israel
  EUR X") is explicitly out of scope; revisit as a separate itinerary-grouping
  feature only if missed.

## Scope

In scope:
- A "Plan a budget" button in the Budget view that opens a stepped interview.
- One step per itinerary place (lodging + activities), then trip-wide steps
  (transport, food, other), then an editable summary.
- Suggested amounts seeded from itinerary facts (nights, members).
- Apply sets the master planned budget to the total.
- A pure module returning the interview, at the eventual Claude seam.

Explicitly deferred:
- Per-place or per-category budget persistence (the assistant writes only the
  master total).
- Country/region rollups and subtotals.
- Planned-vs-actual / spend analytics.
- Reading already-logged expenses or itinerary event text to seed answers (the
  mock uses only places + nights + members; this is where Claude gets smarter).
- Real Claude calls (Anthropic SDK, `lib/ai/claude.ts`).

## The seam

A single pure module: `src/lib/ai/budget-planner.ts`. It returns the interview,
not a number — that is what real Claude makes adaptive later.

```ts
export interface BudgetPlanInput {
  tripName: string
  totalDays: number // whole-trip nights, drives trip-wide suggestions
  memberCount: number
  locations: { id: string; name: string; nights: number }[] // flat cities, in order
  context?: string // reserved for Claude (trip notes). Unused by the mock.
}

export interface BudgetField {
  key: string // unique within a step, e.g. "lodging"
  label: string // "Accommodation"
  suggestedCents: number | null // seed; null = blank field the user fills
}

export interface BudgetStep {
  key: string // unique step id, e.g. "loc:<id>" or "transport"
  title: string // "Tel Aviv" or "Getting around"
  subtitle: string | null // "14 nights" or null
  question: string
  hint: string | null
  fields: BudgetField[]
}

export function planBudgetSteps(input: BudgetPlanInput): BudgetStep[]
```

Mock logic (deterministic, no randomness, no async, no network):
- Constants: `LODGING_PER_NIGHT_CENTS = 11000`, `TRANSPORT_PER_PERSON_CENTS =
  15000`, `FOOD_PER_PERSON_DAY_CENTS = 2500`.
- `memberCount` floors at 1; each location's `nights` floors at 1.
- One step per location (in input order): title = name, subtitle =
  "`<nights>` night(s)", fields = `lodging` (suggested `nights *
  LODGING_PER_NIGHT_CENTS`) and `activities` (suggested null).
- No-locations default: when the trip has no locations, the whole trip is treated
  as one place named after the trip (`tripName`, nights = `totalDays`), so the
  same per-location step still asks lodging + activities. This is the only place
  the trip name becomes a "location," and only for the interview — nothing is
  persisted per place.
- Trip-wide steps, always appended:
  - Transport: one field suggested `TRANSPORT_PER_PERSON_CENTS * memberCount`.
  - Food & drink: one field suggested `FOOD_PER_PERSON_DAY_CENTS * memberCount *
    max(totalDays, 1)`.
  - Other: one field suggested null.
- A trip with no locations yields one trip-named place step (lodging +
  activities) plus the three trip-wide steps, so the assistant still works
  (e.g. a trip with dates but no places yet).

### Migration to real Claude (later, not now)

`planBudgetSteps` becomes `async`, reads `context`, and calls the LLM client.
Call sites change from `planBudgetSteps(input)` to `await planBudgetSteps(input)`.
The input/output types are unchanged. That is the whole migration.

## UI

Client component `src/app/trips/[slug]/budget-drafter.tsx` (replaces the prior
one-number drafter on this branch).

Placement: in `budget-tab.tsx`, the `"budget"` view, just above
`BudgetByLocation`. Not in the expense / saved / settle views.

Props (all already available in `BudgetTab`): `tripId`, `tripSlug`, `tripName`,
`tripDays`, `locations: ItineraryLocation[]`, `itineraryDays: DayLocation[]`,
`memberCount`.

Behavior:
1. Collapsed: a "Plan a budget" button, shown whenever the trip has a duration
   signal (date span, itinerary day rows, or locations); hidden only for a bare
   dateless dream with none of those.
2. On click: compute `nights` per location (count of itinerary days mapped to it
   via `dayLocationMap`, floored at 1) and `totalDays` (`tripDays`, else
   itinerary day count). Call `planBudgetSteps`. Seed a value map from each
   field's `suggestedCents` (formatted whole euros, or "" when null). Start at
   step 0.
3. Stepping: show the current step's title/subtitle/question/hint and its
   field(s) as euro number inputs. "back" (disabled on first step) and "next".
   "next" on the last step goes to the summary.
4. Summary: list every field grouped by step title, each editable, with a live
   total (sum of all field values). Apply / Dismiss.
5. Apply: `updateTripBudget({ tripId, tripSlug, plannedBudgetCents: total })`
   inside a transition. On error, surface inline. No per-location writes.
6. Dismiss / back-out closes without writing.

State note: wizard state (step index, value map) lives in the component as plain
`useState`; values are seeded once on open, not via `useEffect`, to avoid the
React 19 set-state-in-effect lint.

## Data flow

```
BudgetTab (budget view)
  -> BudgetDrafter (client)
       reads: locations + itineraryDays -> nights per place; tripDays; members
       planBudgetSteps(input): pure -> BudgetStep[]
       wizard (local state: step index + value map)  ->  summary
       Apply -> updateTripBudget(total)
       (server action revalidates; budget surface re-renders)
```

No new server action — `updateTripBudget` already exists, validates the amount,
and enforces RLS.

## Testing

No test framework in this repo; do not invent one. Verification is `pnpm lint` +
`pnpm build` passing, plus a manual check: on a trip with two places (e.g. a
two-city itinerary), the assistant steps through each place then the trip-wide
questions, the summary total updates as values change, and Apply sets the master
budget. On a trip with dates but no places, the assistant asks about one place
named after the trip (lodging + activities) followed by the trip-wide steps.

## Files

- Rewrite: `src/lib/ai/budget-planner.ts` (interview seam + mock).
- Rewrite: `src/app/trips/[slug]/budget-drafter.tsx` (button + wizard + summary).
- Already wired: `budget-tab.tsx` renders `BudgetDrafter` and passes the props.
- Edit: `docs/TODO.md`, `docs/DECISIONS.md`.
