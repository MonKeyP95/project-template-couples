# Budget assistant: location-aware seeding + Activities category

Date: 2026-06-16
Status: approved (design)

## Goal

Revisit the (mock) budget assistant to bring back the "walk through your places"
feel that location-by-location had, without losing the category structure that
made it correct. Accommodation and Activities become **grouped by itinerary
location** (each place a sub-group that can hold several hotels / activities),
pre-seeded from the itinerary; the other categories stay flat trip-wide lists.
Separately, add **"Activities"** to the default expense categories so logged
spend has a matching bucket.

Still mock-first: no API, no cost. Part B touches data (a seed constant + an
idempotent backfill migration applied by hand).

## Part A — Location-aware seeding within categories

### Two kinds of step

- **Flat** (Transport, Food, Other): a single add-list, unchanged from today.
- **Grouped** (Accommodation, Activities): one sub-group per itinerary location,
  each with a header (`Senaru · 8–11 Jun`), its own rows, and a per-group add
  button ("+ add hotel here" / "+ add activity here"). Multiple rows per location
  is intended (two hotels, three activities).

### Seeding

- Accommodation: each location group is pre-seeded with **one suggested hotel
  row** — `when` = the location's date label, cost = its nights ×
  `LODGING_PER_NIGHT_CENTS`, subject blank (you type the hotel).
- Activities: each location group starts **empty** (header + add button only).
- Transport / Food / Other: seeded as today (one trip-wide row each, or empty).

### No-locations fallback

If the trip has no locations, grouped steps show a single group named after the
trip (`key: "trip"`). Accommodation seeds one whole-trip row (totalDays × rate);
Activities starts empty. This preserves today's behaviour for location-less trips.

### The seam

`src/lib/ai/budget-planner.ts`:

```ts
export interface BudgetPlanInput {
  tripName: string
  totalDays: number
  memberCount: number
  /** Itinerary places in order; empty for a location-less trip. */
  locations: { id: string; name: string; nights: number; dateLabel: string | null }[]
  context?: string
}

export interface SeedItem {
  subject: string
  when: string
  suggestedCents: number | null
}

export interface BudgetGroup {
  key: string // location id, or "trip" for the no-location fallback
  title: string // location name (or trip name)
  when: string // date label / nights, shown in the group header
  seed: SeedItem[]
}

export interface BudgetStep {
  key: string
  title: string
  question: string
  hint: string | null
  addNoun: string
  seed?: SeedItem[] // flat step
  groups?: BudgetGroup[] // grouped step (by location)
}

export function planBudgetSteps(input: BudgetPlanInput): BudgetStep[]
export function estimateItemCents(): number // unchanged
```

A step has exactly one of `seed` (flat) or `groups` (grouped). Constants
(`LODGING_PER_NIGHT_CENTS = 11000`, `TRANSPORT_PER_PERSON_CENTS = 15000`,
`FOOD_PER_PERSON_DAY_CENTS = 2500`, `ITEM_ESTIMATE_CENTS = 5000`) unchanged.

Mock build (deterministic):
- `places` = `locations` if non-empty, else `[{ id: "trip", name: tripName,
  nights: max(totalDays,1), dateLabel: null }]`.
- accommodation (grouped): one group per place; `title` = place name; `when` =
  `dateLabel ?? "<nights> nights"`; `seed` = `[{ subject: "", when: dateLabel ??
  "", suggestedCents: nights * LODGING_PER_NIGHT_CENTS }]`.
- activities (grouped): one group per place; same `key`/`title`/`when`; `seed`
  `[]`.
- transport / food / other (flat): same `seed` as the current implementation.

### The component

`src/app/trips/[slug]/budget-drafter.tsx`:

- Rows are keyed per **bucket**: a flat step's bucket is `step.key`; a grouped
  step's bucket is `` `${step.key}:${group.key}` ``. State stays
  `items: Record<string, ItemRow[]>` keyed by bucket id.
- `open()` computes per-location `nights` (count of itinerary days mapped to the
  location via `dayLocationMap`, floored at 1) and `dateLabel` (via
  `locationDateLabel(startDate, endDate, dayDatesForLocation)`), passes
  `locations` + `tripName` to `planBudgetSteps`, then seeds each bucket from its
  `seed` (flat: `step.seed`; grouped: each `group.seed`). localStorage is loaded
  first per bucket id; saved rows win over seeds.
- `addItem` / `patchItem` / `removeItem` take a **bucket id** (was step key).
- `normalizeStep` normalizes **every bucket of the current step** (flat: one;
  grouped: each group) — same drop-empty + blank-cost→estimate logic, 0 kept.
- `totalCents` sums all buckets.
- Render: a grouped step renders each group with its header (`title` + `when`),
  the group's rows, and a "+ add `<addNoun>` here" button; a flat step renders as
  today. The summary lists every row; grouped rows are labelled `place ·
  subject` (subject falling back to the category title).
- On Apply: save all buckets to localStorage (keyed by bucket id), then
  `updateTripBudget({ plannedBudgetCents: total })`. Edit-budget label and
  estimate/0 behaviour unchanged.

Persistence note: bucket ids for grouped steps now embed the location id, so
plans saved by the previous (flat) version won't match the new accommodation /
activities buckets — those fall back to seeds. Acceptable for a device-local
mock; not worth a migration.

## Part B — "Activities" expense category

The default expense categories (`EXPENSE_CATEGORIES` in
`src/lib/trips/expense-types.ts`) are `Food, Transportation, Accommodation,
Other`. New trips seed from this constant in `createTrip`. There is no
"Activities", so activity spend has no matching bucket and the assistant's
Activities planning doesn't line up with logged categories.

Change:
- `EXPENSE_CATEGORIES` becomes `["Food", "Transportation", "Accommodation",
  "Activities", "Other"]` (Activities before Other). New trips seed it
  automatically (createTrip maps the constant by index to `sort_order`).
- Backfill existing trips with a new idempotent migration
  `supabase/migrations/20260616000001_expense_category_activities.sql`: for every
  trip, insert an `Activities` category at the end (`sort_order` = that trip's
  current max + 1), `on conflict (trip_id, name) do nothing`. Pasted into the
  Supabase SQL editor by hand (the project's migration process). Safe to re-run.

```sql
insert into public.expense_categories (trip_id, name, sort_order)
select t.id,
       'Activities',
       coalesce(
         (select max(ec.sort_order) + 1
          from public.expense_categories ec
          where ec.trip_id = t.id),
         0)
from public.trips t
on conflict (trip_id, name) do nothing;
```

New trips get Activities before Other (index order); existing trips get it
appended last. The order difference is cosmetic and accepted.

## Data flow

```
BudgetTab (budget view)
  -> BudgetDrafter (client)
       locations + itineraryDays -> per-location nights + dateLabel
       planBudgetSteps({ tripName, totalDays, memberCount, locations })
         -> BudgetStep[] (flat seed | grouped groups)
       buckets of rows in useState (key: step.key or step.key:group.key)
       summary -> Apply -> updateTripBudget(total) + save buckets to localStorage
```

No new server action. Part B adds one manual migration; no new table or RLS.

## Error handling

`planBudgetSteps` / `estimateItemCents` are pure and cannot fail. The migration
is idempotent. `createTrip`'s category insert already surfaces its error.

## Testing

No test framework; do not invent one. Gate is `pnpm lint` + `pnpm build`, plus a
manual check: on a multi-location trip, Accommodation shows a group per place
with a seeded hotel row and "+ add hotel here"; adding a second hotel keeps it
under that place; Activities shows the same groups (empty, with add buttons);
Transport/Food/Other stay flat; the summary and total include every row; Apply
sets the budget and reopening ("Edit budget") restores rows into their places.
For Part B: after pasting the migration, existing trips show an Activities
expense category; a newly created trip lists Food/Transportation/Accommodation/
Activities/Other.

## Files

- Edit: `src/lib/ai/budget-planner.ts` (grouped steps + locations input).
- Edit: `src/app/trips/[slug]/budget-drafter.tsx` (bucket-keyed rows, grouped
  render, location-aware open()).
- Edit: `src/lib/trips/expense-types.ts` (`EXPENSE_CATEGORIES` add Activities).
- New: `supabase/migrations/20260616000001_expense_category_activities.sql`.
- Edit: `docs/TODO.md`, `docs/DECISIONS.md`.
