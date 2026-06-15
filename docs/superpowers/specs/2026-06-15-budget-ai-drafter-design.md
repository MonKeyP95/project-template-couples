# Guided budget assistant (mock)

Date: 2026-06-15
Status: approved (design)

## Goal

A mock AI assistant on the Budget (planning) side that helps a couple build and
understand their trip budget through a short guided interview, rather than a
single number. It walks the budget categories, pre-fills a suggested figure
where it can, and lets the user break any category into detailed line items.
"Mock" means no API calls — the steps, questions, and suggestions are derived
deterministically from the trip. The point of the slice is to build the whole
interaction surface and the seam, so swapping in real Claude later is one file.

First concrete piece of Phase 5. No Anthropic SDK, no new tables.

## Conceptual model

The app separates **Budget** (planning, before the trip) from **Expense**
(reality, on the road). This assistant is a planning tool. There is deliberately
**no planned-vs-actual** comparison — that is statistics, not planning.

The interview is **category-centric**: the steps are Accommodation, Transport,
Food & drink, Activities, and Anything else. Each category is a header with an
add-list of detailed items; every item is **subject + when + cost** (e.g.
"Sea hotel · 3 days · 350", "Beach hotel · 12 Jan · 200"). Itinerary locations
are not walked as separate steps — the per-item `when` captures dates/places.
Money rolls up to a single trip total; nothing is persisted per category or item.

## Scope

In scope:
- A "Plan a budget" button in the Budget view that opens a stepped interview.
- Five category steps, each an add-list of `subject / when / cost` rows.
- A seeded suggestion row for the estimable categories (accommodation,
  transport, food); activities + other start empty.
- Blank-cost rows estimated by the assistant; explicit 0 allowed and kept.
- An editable summary, then Apply sets the master planned budget to the total.
- The plan's line items are saved in the browser (localStorage, per trip) on
  Apply, so the assistant reopens as "Edit budget" with your entries restored.
- A pure module returning the interview, at the eventual Claude seam.

Explicitly deferred:
- Server-side / shared persistence of the plan items. The only server write is
  the master total via `updateTripBudget`; the per-item plan lives in
  localStorage on the device (not shared with the partner, lost on another
  device). Promote to a shared store if/when that limitation bites.
- Planned-vs-actual / spend analytics.
- Real Claude calls (Anthropic SDK, `lib/ai/claude.ts`).
- Reading logged expenses or itinerary text to seed items (where Claude gets
  smarter — the mock seeds only from duration + members).
- A real date picker for `when` (free text for now: "3 days", "12 Jan").

## The seam

A single pure module: `src/lib/ai/budget-planner.ts`. It returns the interview,
not a number — that is what real Claude makes adaptive later.

```ts
export interface BudgetPlanInput {
  totalDays: number // whole-trip nights; drives the seeded suggestions
  memberCount: number
  context?: string // reserved for Claude (trip notes). Unused by the mock.
}

export interface SeedItem {
  subject: string
  when: string
  suggestedCents: number | null // null = blank (user fills / assistant estimates)
}

export interface BudgetStep {
  key: string // "accommodation" | "transport" | "food" | "activities" | "other"
  title: string
  question: string
  hint: string | null
  addNoun: string // "accommodation" -> "+ add accommodation"
  seed: SeedItem[]
}

export function planBudgetSteps(input: BudgetPlanInput): BudgetStep[]
export function estimateItemCents(): number
```

Mock logic (deterministic, no randomness, no async, no network):
- Constants: `LODGING_PER_NIGHT_CENTS = 11000`, `TRANSPORT_PER_PERSON_CENTS =
  15000`, `FOOD_PER_PERSON_DAY_CENTS = 2500`, `ITEM_ESTIMATE_CENTS = 5000`.
- `memberCount` and `totalDays` floor at 1.
- Five steps, in order:
  - Accommodation: seed one row `when = "<n> nights"`, cost `totalDays *
    LODGING_PER_NIGHT_CENTS`.
  - Transport: seed one row, cost `TRANSPORT_PER_PERSON_CENTS * memberCount`.
  - Food & drink: seed one row `when = "<n> days"`, cost
    `FOOD_PER_PERSON_DAY_CENTS * memberCount * totalDays`.
  - Activities: no seed (empty add-list).
  - Anything else (`other`): no seed.
- `estimateItemCents()` is the assistant's guess for a row left without a cost:
  flat `ITEM_ESTIMATE_CENTS` in the mock; real Claude later assesses from the
  row's subject. An explicit 0 (e.g. staying with friends, borrowed car) is kept
  as-is and never estimated.

### Migration to real Claude (later, not now)

`planBudgetSteps` becomes `async`, reads `context`, and calls the LLM client;
`estimateItemCents` likewise becomes a real assessment from the subject. Call
sites add `await`. The input/output types are unchanged. That is the whole
migration.

## UI

Client component `src/app/trips/[slug]/budget-drafter.tsx`.

Placement: in `budget-tab.tsx`, the `"budget"` view, just above
`BudgetByLocation`. Not in the expense / saved / settle views.

Props: `tripId`, `tripSlug`, `tripDays`, `locations`, `itineraryDays`,
`memberCount`. (`locations`/`itineraryDays` are used only to derive `totalDays`
and to decide whether to show the button.)

Behavior:
1. Collapsed: a single button, shown whenever the trip has a duration signal
   (date span, itinerary day rows, or locations); hidden only for a bare dateless
   dream. Labelled "Edit budget" when a budget is already set
   (`plannedBudgetCents > 0`), else "Plan a budget".
2. On click: `totalDays = tripDays || itinerary day count`. Call
   `planBudgetSteps`. For each step, load the saved rows from localStorage when
   present; otherwise seed from the step's `seed` (cost prefilled when
   suggested). Start at step 0.
3. Stepping: each step shows its title + question + hint, the list of item rows,
   and a "+ add `<noun>`" button. Each row has three inputs: subject ("What"),
   when ("3 days, 12 Jan"), and a euro cost, plus a remove (×). "back" (disabled
   on first step) and "next"; "next" on the last step goes to the summary.
4. Leaving a step (`next`/`review`): drop rows that are entirely blank; for a row
   with a subject or when but no cost, fill `estimateItemCents()`. An explicit 0
   stays 0.
5. Summary: every row across all steps, labelled `subject` (falling back to the
   category title) with its `when` shown muted, cost editable, live total.
6. Apply: `updateTripBudget({ tripId, tripSlug, plannedBudgetCents: total })`
   inside a transition. On success, save the plan's rows to localStorage (per
   trip) so a later "Edit budget" restores them. On error, surface inline. No
   per-category server writes.
7. Cancel / dismiss closes without writing.

State note: wizard state (step index, rows per step) lives in `useState`; rows
are seeded once on open (not via `useEffect`), avoiding the React 19
set-state-in-effect lint. Row ids come from a `useRef` counter.

## Data flow

```
BudgetTab (budget view)
  -> BudgetDrafter (client)
       totalDays from tripDays / itinerary day count; memberCount
       planBudgetSteps(input): pure -> BudgetStep[]
       wizard (local state: step index + rows per step)  ->  summary
       Apply -> updateTripBudget(total)
       (server action revalidates; budget surface re-renders)
```

No new server action — `updateTripBudget` already exists, validates the amount,
and enforces RLS.

## Testing

No test framework in this repo; do not invent one. Verification is `pnpm lint` +
`pnpm build` passing, plus a manual check: the assistant steps through the five
categories; accommodation/transport/food come pre-filled with a suggestion;
adding a second accommodation row (subject + date + cost) works; an activity
added with no cost is estimated on next; an explicit 0 is kept; the summary lists
every row with its date and a live total; Apply sets the master budget.

## Files

- `src/lib/ai/budget-planner.ts` — interview seam + mock + `estimateItemCents`.
- `src/app/trips/[slug]/budget-drafter.tsx` — button + wizard + per-row add-list
  + summary.
- `budget-tab.tsx` renders `BudgetDrafter` and passes the props.
- `docs/TODO.md`, `docs/DECISIONS.md` record the slice.
