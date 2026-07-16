# Budget "How often" — repeating events on walk rows

**Status:** Design approved, ready to plan.
**Branch:** `onboarding-routing` (continues the budget-generate redesign).

## Problem

The budget walk lets a couple enter a per-line price, and last session added an
optional date range that turns a row into a per-day price multiplied by its span.
But real budget lines repeat in ways a date range can't express:

- **A count, undated** — "dinner out x4", "surf lesson x3".
- **Whole-trip / whole-location daily** — a daily coffee, without picking dates.
- **Weekly / every-few-days** — "laundry once a week" (really just a small count).

And for the consecutive-daily case the range already handles, picking two dates is
an extra step when "every day here" is what you mean.

## Insight

Every one of these is the same shape: **total = unit price x quantity.** The only
thing that differs is how the quantity is filled in. So instead of the date range
being its own parallel mechanism, each row gets one **"How often"** control that
resolves to a quantity.

## The control

Each walk row becomes:

```
Note (optional)   [ Once | x times | Daily ]   EUR price
```

Exactly one mode is selected per row (chips). One multiplier per row — the old
"two multipliers at once" ambiguity never arises.

- **Once** (default) — total = price.
- **x times** — a small count box appears; total = price x count. A quiet
  **"pick dates"** link reveals the date-range picker; picking a range sets the
  count = its span (per-day price x span). You type a number *or* pick dates —
  either resolves to one count. The date range built last session lives here.
- **Daily** — total = price x day-slots, in one click, **no date picker at all**.
  For a location bucket that's the location's day-slots; for a trip-wide bucket
  (transport / other) it's the whole-trip day count.

**Daily is dateless. The date range lives only under x times.**

Dropped from v1 (YAGNI):
- **No dedicated "Weekly"** — it's "x times" with the week count typed in.

## Quantity resolution

| Mode | Quantity |
|---|---|
| Once | 1 |
| x times — typed | the number entered (min 1) |
| x times — dated range | span of the range |
| Daily — location bucket | that location's day-slot count |
| Daily — trip-wide bucket | whole-trip day count |

**Span / day-slot counting rule (unchanged from the range feature):**
accommodation counts **nights** (span or slots minus 1, min 1); every other
category counts **inclusive days** (min 1).

## Where day-slots come from

`datedItinerary` is a list of days, each tagged with `locationId`. So:

- **location day-slots** = number of days whose `locationId` matches, and
- **whole-trip days** = total day count.

These are always defined from the itinerary structure — no dependence on whether
a location was given an explicit date span, so Daily always has a number to
multiply by.

`page.tsx` already computes `itinerarySeeds` in the `activeTab === "budget"`
block by walking `datedItinerary`. In the same loop it will build:

- `locationDays: Record<string, number>` — `locationId` -> slot count, and
- `tripDays: number` — `datedItinerary.length`,

and pass both to `<BudgetTab>` -> `<BudgetDrafter>` next to `itinerarySeeds`.

## Persistence — smallest delta

`trip_budget_items` already carries `amount_cents`, `when_start`, `when_end`, and
the mark columns (`estimated`, `source_url`, `price_unknown`).

- `amount_cents` stays the **computed total** — settle-up and expense math are
  untouched.
- Reuse `when_start` / `when_end` for the dated-range case under **x times**.
- Add **two** columns:
  - `freq text not null default 'once'` — one of `once` / `times` / `daily`.
  - `count integer not null default 1` — the multiplier for `times`.

`freq` is needed because a whole-location Daily row (count 1, no dates) is
otherwise indistinguishable from Once.

**Restore** divides the stored total back to the per-unit price the row shows —
the same divide-back the range already does:

| freq | per-unit on restore |
|---|---|
| once | amount_cents |
| times, no dates | round(amount_cents / count) |
| times, dated | round(amount_cents / span(dates)) |
| daily, location | round(amount_cents / location day-slots) |
| daily, trip-wide | round(amount_cents / trip days) |

Migration file follows the idempotent `add column if not exists` pattern and is
pasted into the Supabase SQL editor by hand (no migration tooling in this repo).

## Generate — unaffected

Generate still only prices **blank** rows and sends whole-line totals; the model
never sees or re-prices a typed row. Filled rows come back as `freq = 'once'`,
`count = 1`. No double-counting, no re-pricing.

## Deliberate simplifications

- **Snapshot totals.** If the itinerary changes *after* a whole-location Daily row
  is applied, its saved total stays a snapshot until the row is re-opened and
  re-Applied. Same snapshot behavior everything else already has.
- **One resolved count under x times.** Typing a number and picking dates both
  feed the single `count`; if a range is set it wins and the box reflects the
  span. There is never more than one quantity on a row.

## Files touched (for the plan)

- `supabase/migrations/20260716000001_budget_item_freq.sql` — new, idempotent:
  add `freq`, `count` to `trip_budget_items`.
- `src/lib/trips/budget-item-types.ts` — `BudgetItem` / `BudgetItemRow` /
  `rowToBudgetItem` gain `freq`, `count`.
- `src/lib/trips/budget-item-queries.ts` — SELECT adds `freq, count`.
- `src/lib/trips/actions.ts` — `SaveBudgetItemInput` + `saveBudgetItems` row/insert
  carry `freq`, `count`.
- `src/app/trips/[slug]/page.tsx` — build `locationDays` + `tripDays` in the budget
  block; pass through `<BudgetTab>`.
- `src/app/trips/[slug]/budget-tab.tsx` — thread `locationDays` / `tripDays` props.
- `src/app/trips/[slug]/budget-drafter.tsx` — the control: `freq`/`count` on
  `ItemRow`; the chips + count box + "pick dates" link + dateless Daily;
  `rowTotalCents` resolves quantity per the table; `savedRows` divide-back;
  `collectLines` / `subtotalCents` / `apply` use the resolved total; review render
  shows the mode label ("x4", "daily", the range) and per-unit hint.
