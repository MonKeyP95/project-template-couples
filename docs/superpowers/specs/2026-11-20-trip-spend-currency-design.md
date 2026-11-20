# Trip spend currency — design

## Intent
A Lanzarote trip banks in DKK (home, source of truth) but pays in EUR. Today the
new-trip walkthrough never asks, so every trip starts DKK/DKK and the spend
currency is only reachable via Edit trip. Ask it up front, and make the expense
form open in the right one for the moment: DKK while planning, EUR on the road.

## Goals
- New-trip first page asks "Which currency will you pay in there?"; saved as
  `trips.currency`. `home_currency` stays the workspace currency.
- Expense entry default: home currency before/after the trip, spend currency
  while today is within the trip's dates (dreams: always home).
- The existing dropdown order (spend, home, location currencies, rest) is kept.

## Non-goals
- No two-way toggle (option B, declined), no guessing the currency from the
  place, no profile change, no schema change.

## Approaches
- **A. Keep the dropdown (picked).** Order already puts spend + home on top;
  the missing piece is that spend was never set.
- B. EUR | DKK | ... toggle. Faster one-thumb switch, but a new shared
  component; declined.

## The how
- `note-page.tsx`: a currency select beside the place field, defaulting to the
  workspace currency. `TripDraft.currency` carries it; `createTrip` takes
  `currency`, validates it against `currencyOptions()`, writes `trips.currency`.
- `CurrencyProvider` gains `entryCurrency` (the form default), computed on the
  server by one pure helper: within `[start_date, end_date]` -> `currency`,
  otherwise `home_currency`. Both trip page and on-the-road page pass it.
- `log-expense-row.tsx` and `quick-expense.tsx` default to
  `location.currency ?? entryCurrency` (picking a location with its own
  currency still switches, as today). `spendCurrency` keeps its other job
  (the "~ local" figure beside totals).

## Left to the builder
- Exact label wording and placement within the place block.

## Success criteria
Verified by Claude: build + lint clean; `createTrip` writes the chosen code to
`currency` and the workspace code to `home_currency`; helper returns home for
a date before start, spend for start/end/mid, home after end and for a dream.

Verified in-app by the user:
1. New trip, pick EUR, create: Edit trip shows spend EUR, home DKK.
2. On that future trip, Log expense opens in DKK; switching to EUR shows "~ kr".
3. On a trip running today, Log expense and the on-the-road quick expense open in EUR.
4. Skipping the question leaves spend = home and the form behaves as before.
