# Budget Generate Redesign — Design Spec

**Date:** 2026-07-15
**Status:** Approved design; implementation plan next.

## Goal

Reshape "Plan a budget" into the budget twin of the guided itinerary planner:
the couple walks their trip's costs entering the prices they know, and a
**Generate** button at the end calls the assistant to fill the gaps — looking up
real prices with bounded web search where it can, estimating where it can't, and
**honestly marking** every number it supplied (and every price it could not find)
so the couple always knows what is theirs, what is a citation, and what is a
guess.

## Context

- Today's budget drafter (`budget-drafter.tsx`) runs the model **up front**:
  pressing "Plan a budget" seeds the walk with mock/LLM estimates, then the walk
  is edit-only and "apply" just saves. This spec **inverts** that: the model
  works at the **end**, exactly like the itinerary planner (walk → Generate).
- Planning-mode only. On the road the budget already exists, so this flow does
  not appear then (dates-driven, same gate as the itinerary planner).
- Reuses existing systems: `planBudgetSteps` (walk scaffold), the itinerary
  days/events already stored per (location, category), `buildAssistantContext`
  (trip + couple profile + budget band), the discovery flow's built-in
  `web_search` tool pattern, and `saveBudgetItems`. No new infrastructure.

## The Flow

```
Plan a budget
  -> WALK  (per-place category steps, seeded from the itinerary)
       accommodation: [Star Hostel  ____]   <- subject from itinerary, price blank
       food:          [ + add food ]
       activities:    [surf school  ____]
       transport:     [ + add transport ]   (trip-wide)
       other:         [ + add item ]        (trip-wide)
  -> BUFFER step   (pick 5% / 10% / custom)
  -> REVIEW
       Generate  -> one LLM call: fills blank prices + adds missing lines,
                    marks them, flags what it couldn't price, recomputes total
       Apply     -> saves the budget (marks persisted)
```

- **Money gets a review before it is written.** Unlike the itinerary planner
  (which writes on Generate), Generate here drafts *into the review screen*; the
  couple sees the filled numbers, the "est." marks, the links, and the honest
  total, then presses **Apply** to save. Apply is the only write.
- **Apply works before Generate too** — save just the prices you entered, no
  fills — but Generate is the intended path.

## Walk Seeding From the Itinerary

The walk is the existing per-place category scaffold from `planBudgetSteps`, but
its rows come from the itinerary instead of mock estimates.

- Read the trip's itinerary days + events (the same data the itinerary tab
  renders). Each planner-written event carries a `category` and sits under a
  `locationId`.
- For each event with a location + category, add a **candidate row** to the
  budget step `${categoryKey}:${locationId}`: `subject` = the event text,
  `price` = blank. Trip-wide categories (Transportation, Other) seed the
  trip-wide steps.
- Category sets already match (Accommodation / Food / Activities / Transportation
  / Other), so the mapping is direct.
- **Honest note:** subjects come verbatim from the itinerary event text
  ("Check into Star Hostel", not a cleaned "Star Hostel"). The couple can edit
  them; Generate also normalizes/deduplicates when it reads the full itinerary.
- The **mock cost estimates** in `planBudgetSteps` (LODGING_PER_NIGHT etc.) are
  removed — no more fake €270 defaults. Steps seed empty, then itinerary
  candidates overlay. The model owns all price-filling now.

## Buffer Step

- A final walk step after the categories: "How much buffer?" with choices
  **5% / 10% / custom %**.
- Stored as a single trip-wide **Other** line, `subject = "Buffer (10%)"`, with
  `amountCents = round(subtotal * pct)`.
- Computed **after** Generate fills the gaps (buffer rides on the real subtotal),
  and recomputed at save. It is a deterministic computation, not an estimate, so
  it carries **no** "est." mark.

## The Generate Seam (`lib/ai/claude.ts`)

A new suggest-only function (working name `draftBudgetFill`) — the old up-front
`draftBudgetSeeds` / `draftBudget` seed-merge path is removed.

- **Input:** the couple's entered lines (read-only context), the trip's
  locations + dates, the trip/couple profile block, and the budget band — all
  via `buildAssistantContext`, mirroring `draftAndApplyItinerary`.
- **Tools:** reuses the built-in **`web_search`** tool exactly as the discovery
  flow does (`web_search_20250305`, bounded `max_uses`) **plus** a structured
  submit tool for the final budget lines. The agentic loop: search the
  worth-it items, then submit.
- **Bounded search (decision):** the system prompt tells the model to search
  only **named / big-ticket** items (specific accommodation, transport, named
  activities like "surf school") and to **estimate** the generic gaps (daily
  food, misc). This gets provenance where it matters at a fraction of the
  searches — controlling both latency and cost.
- **Output:** per line `{ category, place, subject, amountEuros | null,
  estimated: true, sourceUrl?: string }`. The model returns **only** (a) prices
  for the couple's un-priced lines and (b) new gap lines it recommends. It is
  never asked to touch a line the couple already priced — so "never overwrites
  your number" is a **structural** guarantee, not a prompt hope.
- **Suggest-only:** returns data; the server action merges and the couple's
  Apply writes. Nothing under `lib/ai` mutates.
- On any failure the action falls back to the entered lines unchanged (the
  existing `usedFallback` "couldn't reach the assistant" affordance stays).

## Four-State Line Marking + Honest Total

Every budget line is exactly one of:

| State | How it looks | Data |
|-------|--------------|------|
| **yours** (typed) | plain number, no mark | `estimated=false`, `price_unknown=false` |
| **found** (search-backed) | number + "est." + source link | `estimated=true`, `source_url` set |
| **estimated** (reasoned) | number + "est." | `estimated=true`, `source_url` null |
| **no reliable price** | no number, "couldn't price — add it" | `price_unknown=true` |

- **Total is honest:** sum the priced lines; render unknown lines as a count,
  e.g. **"€1,240 + 2 items still to price."** An estimate you can trust to be
  complete-or-not, instead of a fake-precise figure.

### Data model (additive, idempotent migration)

Three columns on `budget_items`, all additive — **no nullability change** to
`amount_cents` (keeps totals math and settle logic simple; an unknown line keeps
`amount_cents = 0` but is flagged):

```sql
alter table budget_items add column if not exists estimated boolean not null default false;
alter table budget_items add column if not exists source_url text;
alter table budget_items add column if not exists price_unknown boolean not null default false;
```

Migration is pasted into the Supabase SQL editor by hand (repo has no migration
tooling) and must be safe to re-run.

### Ripple touch points

- **Totals / rollups** (`perCategoryRollup`, spent-vs-planned, `SavedFigure`):
  unknown lines contribute `0` to the numeric sum but surface in the "N to
  price" indicator. Priced est. lines count normally.
- **Mark-paid:** disabled on an unknown-price line (you can't pay a line with no
  amount) — it must be given a price first.
- **`SaveBudgetItemInput` / `saveBudgetItems`:** carry the three new fields
  through; `rowToBudgetItem` maps them.
- Editing an est. line's number in the review **clears its marks** (it becomes
  "yours").

## "No Reliable Price" — What We Guarantee

- **Caught reliably:** (1) web search comes back empty / no price in the
  snippets — our code sees that directly; (2) the model declines — the system
  prompt says *never fabricate a price; if you cannot ground or reasonably
  estimate one, return no price.* Either path yields `price_unknown=true`.
- **Honest limit:** a model self-rating its own confidence is unreliable, so we
  **cannot** promise to catch every over-confident wrong estimate. We add a soft
  "low confidence → flag as unknown" signal that catches some, and we guarantee
  no line ever shows a **fabricated** hard number presented as fact.

## Files

- **Migration** — new `supabase/migrations/*.sql`: the three columns above.
- `src/lib/trips/budget-item-types.ts` — add `estimated`, `sourceUrl`,
  `priceUnknown` to `BudgetItem` + `BudgetItemRow` + `rowToBudgetItem`.
- `src/lib/trips/actions.ts` — `SaveBudgetItemInput` + `saveBudgetItems` (and the
  scope variant) carry the three fields.
- `src/lib/ai/budget-planner.ts` — drop the mock cost seeds; steps seed empty.
  Add the buffer step. Keep the pure step model.
- `src/lib/ai/claude.ts` — remove `draftBudgetSeeds`; add `draftBudgetFill`
  (web_search + structured submit), a `BUDGET_FILL_SYSTEM` prompt.
- `src/lib/ai/budget-actions.ts` — remove the up-front `draftBudget` seed-merge;
  add `draftAndFillBudget` (guards, context, call `draftBudgetFill`, merge onto
  entered lines, return the assembled review model). Mirrors
  `draftAndApplyItinerary` but returns for review rather than writing.
- `src/app/trips/[slug]/budget-drafter.tsx` — reshape: seed the walk from the
  itinerary, add the buffer step, move Generate to the review, render the four
  line states + links + honest total, disable mark-paid on unknown lines.
- `src/app/trips/[slug]/budget-tab.tsx` — pass the itinerary events/days the
  drafter now needs to seed.

## What Gets Removed

- The up-front seeding path: `draftBudgetSeeds`, the `mergeSeeds` / `toSeed`
  overlay in `budget-actions.ts`, and the mock cost constants in
  `budget-planner.ts`. The model no longer pre-fills the walk.

## Testing

No test framework exists. Validation per increment:

- `pnpm lint` + `pnpm build` clean after each task.
- Pure pieces (`planBudgetSteps` shape, the itinerary→candidate mapping, the
  merge that preserves typed prices, buffer computation, the honest-total
  reducer) are written as small pure functions and exercised via the type
  checker + a manual node/tsx spot check where useful.
- Manual click-path (assistant on): new dated trip → plan itinerary → Plan a
  budget → walk shows itinerary items → price some, leave some blank → buffer →
  Generate → review shows filled numbers, "est." marks, at least one source
  link, at least one "no reliable price" line, and an honest total → Apply →
  budget persists with marks intact.

## Out of Scope / Deferred

- **Google Custom Search swap** — built-in web search is v1; swapping to the
  cheaper-at-scale Google Custom Search JSON API is a contained change behind the
  same `lib/ai/claude.ts` seam if volume ever justifies it.
- **Apply-to-plan auto-write** — Generate drafts into a review; it never writes
  without the couple's Apply.
- **Catching every over-confident estimate** — see the honest limit above.

## Decisions To Record (DECISIONS.md on implementation)

- Budget Generate inverts the drafter: model works at the end (fill gaps), not
  the start (seed) — the budget twin of the itinerary planner, but with a
  **review-before-write** because it is money.
- Four-state line marking (yours / found+link / estimated / no-reliable-price)
  via three additive columns; `amount_cents` stays non-null (unknown = 0 +
  flag) to avoid rippling nullability through totals and settle math.
- Bounded built-in web search (named/big-ticket only), reusing the discovery
  pattern; Google Custom Search deferred behind the seam.
- The "never overwrites your typed price" guarantee is structural: the model is
  only asked for un-priced lines and new lines.
