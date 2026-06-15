# Slice 1 — Mock budget-planning assistant

Date: 2026-06-15
Status: approved (design)

## Goal

A mock AI assistant in the Budget view that drafts a budget for a trip: a master
total plus a per-location split. "Mock" means no API calls — a deterministic
heuristic stands in for Claude's destination knowledge. The point of this slice
is to build the entire seam (input shape, drafter module, editable preview,
apply path) so that wiring real Claude later is one file change.

This is the first concrete piece of Phase 5. It does **not** install the
Anthropic SDK and does **not** add any tables.

## Scope

In scope:
- A "Draft a budget" button in the Budget view.
- An editable preview of a proposed total + per-location split.
- Apply writes the numbers through existing server actions.
- A pure heuristic drafter module at the eventual Claude seam.

Explicitly deferred (Slice 2+):
- Learning from past spend ("what the couple likes / spends on"). When built, it
  derives a spend profile from the existing `expenses` data — no new table.
- A "tell me about the trip" free-text capture surface. When built, it reuses
  the existing per-trip Notes as context.
- Real Claude calls (Anthropic SDK, `lib/ai/claude.ts`).
- Reactive overspending nudges ("Kuta is over; cover from Unallocated?").

## The seam

A single pure module: `src/lib/ai/budget-planner.ts`.

```ts
export interface BudgetDraftInput {
  totalDays: number // whole-trip duration; drives the total even when locations are partial/absent
  locations: { id: string; name: string; days: number }[]
  memberCount: number
  context?: string // reserved for Slice 2 / Claude (trip notes). Unused by the mock.
}

export interface BudgetDraft {
  totalCents: number
  perLocation: { locationId: string; name: string; cents: number }[]
  rationale: string // e.g. "12 nights x EUR 110/person/day x 2"
}

export function draftBudget(input: BudgetDraftInput): BudgetDraft
```

Mock logic (deterministic, no randomness, no async, no network):
- `DAILY_PER_PERSON_CENTS` constant (start at 11000 = EUR 110).
- `dailyShare = DAILY_PER_PERSON_CENTS * memberCount`.
- `totalCents = max(totalDays, sum of location days) * dailyShare` — the total
  reflects the whole trip and is never less than what the locations claim.
- With real locations: each gets its own true share `days * dailyShare`. The
  split may cover only part of the trip; uncovered nights stay unallocated (which
  the existing Budget-by-location surface already shows). No remainder
  redistribution needed since every share is an exact integer-cent product.
- With no locations: the whole trip is one synthetic envelope named after the
  trip (`tripName`), carrying the full `totalCents` and an empty `locationId`.
- `rationale` is a short human string built from the inputs.

Edge cases:
- No locations: the drafter shows a single editable row labelled with the trip
  name (the synthetic envelope) equal to the total. Apply only sets the master
  budget — there is no location row to write, so `setLocationBudget` is skipped
  for the empty `locationId`. This is the common case for a freshly created trip
  and must not be hidden.
- Location with 0 days (dateless): treat as 1 day so it still gets a share.
- `memberCount` falls back to 1 if the members map is empty.
- Duration source: `totalDays` is the trip's date-span day count; the drafter
  falls back to the itinerary day-row count when the span is absent. Only a bare
  dateless dream with no day rows and no locations has nothing to draft, and only
  then is the button hidden.

### Migration to real Claude (later, not now)

`draftBudget` becomes `async`, reads `context`, and calls `lib/ai/claude.ts`.
Call sites change from `draftBudget(input)` to `await draftBudget(input)`. The
input/output types are unchanged. That is the whole migration.

## UI

New client component: `src/app/trips/[slug]/budget-drafter.tsx`.

Placement: in `budget-tab.tsx`, the `"budget"` view, rendered just above
`BudgetByLocation` (the allocation surface it fills). Not shown in the expense /
saved / settle views.

Props (all already available in `BudgetTab`):
- `tripId`, `tripSlug`
- `locations: ItineraryLocation[]`
- `itineraryDays: DayLocation[]` (to compute days per location)
- `memberCount: number` (derived from the `members` record)

Behavior:
1. Collapsed state: a single "Draft a budget" button styled in the existing
   budget design language (mono uppercase, `sea` tone), shown whenever the trip
   has a duration signal (date span, itinerary day rows, or locations); hidden
   only for a bare dateless dream with none of those.
2. On click: compute `days` per location from `itineraryDays` (count of days
   mapped to each location id via the existing `dayLocationMap`), call
   `draftBudget`, and open an inline editable preview.
3. Preview: shows the `rationale` line, an editable total field, and one
   editable number field per location. All prefilled from the draft. Numbers are
   independent — the user can tweak any of them; Apply writes exactly what is
   shown (no forced reconciliation between total and sum).
4. Apply: calls `updateTripBudget({ tripId, tripSlug, plannedBudgetCents })`
   for the total, then `setLocationBudget({ locationId, tripSlug, budgetCents })`
   for each location with a positive amount. Sequential awaits inside a single
   `startTransition`. On any error, surface it inline and stop.
5. Cancel / dismiss closes the preview without writing.

Overwrite note: if a location already has a budget, Apply overwrites it. The
preview shows the proposed value; a small caption notes existing budgets will be
replaced. Keep it light — no per-row "was X" diff in this slice.

## Data flow

```
BudgetTab (budget view)
  -> BudgetDrafter (client)
       reads: locations, itineraryDays -> days per location; members -> count
       draftBudget(input): pure heuristic  ->  BudgetDraft
       editable preview (local state)
       Apply -> updateTripBudget(total)
             -> setLocationBudget(each location)
       (server actions revalidate; budget surface re-renders)
```

No new server action is needed — `updateTripBudget` and `setLocationBudget`
already exist and already validate amounts and enforce RLS.

## Testing

There are no tests in this repo yet; do not invent a test command. Validation is
manual: `pnpm build` passes, and on the seeded Lombok trip the button drafts a
plausible total and split, the preview edits, and Apply updates both the master
budget figure and the per-location envelopes.

## Files

- New: `src/lib/ai/budget-planner.ts` (pure heuristic + types).
- New: `src/app/trips/[slug]/budget-drafter.tsx` (button + editable preview).
- Edit: `src/app/trips/[slug]/budget-tab.tsx` (render `BudgetDrafter` in the
  budget view, pass `memberCount`).
- Edit: `docs/TODO.md`, `docs/DECISIONS.md` (record the mock-first seam choice).
