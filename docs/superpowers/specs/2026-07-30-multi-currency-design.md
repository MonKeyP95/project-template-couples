# Multi-currency and conversion

Date: 2026-07-30
Status: designed, not implemented

## Problem

Every amount in the app is a euro. `expenses.currency` exists in the schema
(text, default `'EUR'`, 3-char check) but nothing reads it. The currency comes
instead from 62 hardcoded euro-sign characters across 18 files, and 7 prompt
strings tell Claude the money is EUR.

The 62 are not equivalent edits:

| Kind | Count | The edit |
|---|---|---|
| Prose in docstrings | 4 | reword; no behaviour |
| Static symbol beside an `<input>` | 10 | becomes the trip symbol, or the currency chip on the 3 expense forms |
| Inline display | 48 | `euro(x)` plus its adjacent glyph collapse into `money(x, currency)` |

Two things are missing, and they are separate:

1. **A home currency that is not the euro.** A workspace that thinks in DKK
   should see DKK everywhere, with no foreign currency involved at all.
2. **Spending in a currency you do not report in.** In Bangkok you pay THB. You
   want the record to say you paid 500 THB *and* what that cost you at home.

## What we are building

Enter an expense in any currency. The app converts it at the current rate,
stores both the original and the converted amount, and every total in the app
sums the converted one. Later, when the bank statement lands, correct the
converted amount to what it really cost.

## Decisions

| Question | Decision |
|---|---|
| What is stored | Both: the original amount + currency, and the converted home amount + the rate used |
| Whose currency is "home" | Workspace-level default, copied into each trip at creation |
| Changing the workspace currency | Affects the next trip only; recorded trips keep their numbers |
| How entry knows the currency | Each itinerary location carries an optional currency; the expense form pre-fills from it |
| Which tables accept foreign currency | `expenses` only; all planning stays in the trip's currency |
| Correcting the rate | Not at entry. Edit the home amount later; the effective rate back-computes |
| Tracking what has been reconciled | A confirmed flag per expense, shown only on foreign rows |
| Cross-trip aggregation in /profile | Normalised to the workspace currency at read time, for display only |

## Data model

### Money columns

```sql
alter table public.expenses
  add column if not exists home_amount_cents integer,
  add column if not exists fx_rate numeric(18,8),
  add column if not exists home_amount_confirmed boolean not null default false;
```

- `amount_cents` + `currency` — **the fact.** What you handed over. Never derived.
- `home_amount_cents` — the converted amount, in the trip's currency. `null`
  means the expense was already in the trip's currency; readers use
  `home_amount_cents ?? amount_cents`.
- `fx_rate` — **home units per one foreign unit.** Seeded from the API at save,
  overwritten when the user corrects the home amount. `null` when no conversion
  happened.
- `home_amount_confirmed` — true once the user has checked this row against
  reality. Set automatically when the home amount is edited, and tappable
  directly.

`amount_cents` keeps meaning **hundredths of the currency unit for every
currency**, including zero-decimal ones. A 500 JPY expense stores `50000`.
Display divides by 100 and lets `Intl.NumberFormat` decide the decimals, which
renders it `¥500`. One rule, no per-currency minor-unit table.

### Currency columns

```sql
alter table public.workspaces          add column if not exists currency text not null default 'EUR';
alter table public.trips               add column if not exists currency text not null default 'EUR';
alter table public.itinerary_locations add column if not exists currency text;
```

Each level is a **default for the level below, copied at creation** — never a
live lookup. That is what makes a recorded trip immutable when the workspace
setting changes later.

| Level | Means | When it changes |
|---|---|---|
| `workspaces.currency` | your home money | the next trip inherits it; existing trips untouched |
| `trips.currency` | this trip's reporting unit; **every total is in this** | editable on the trip; does not rewrite any row |
| `itinerary_locations.currency` | what you spend here; `null` = the trip's currency | pre-fills the expense form only |

All three migrations are idempotent (`if not exists`) per the house rule, and
default to `'EUR'` so existing rows and existing behaviour are unchanged.

### What does not change

The other six money surfaces — `trips.planned_budget_cents`,
`trips.saved_cents`, `trip_budget_items`, `savings_contributions`,
`budget_moves`, `itinerary_locations.budget_cents` — are in the trip's currency
by definition. They get a display symbol and **no schema change**. Plan and
actual therefore stay directly comparable, because both are home amounts.

## FX layer

One new file, shaped after `lib/weather/get-weather.ts`:

```ts
// src/lib/fx/get-rates.ts
/**
 * Every rate against `base`, from open.er-api.com (free, no key). One call
 * returns ~161 currencies, so a conversion is local arithmetic rather than a
 * request. Cached a day. Returns null if the call fails -- the caller offers
 * home-currency entry only rather than inventing a rate.
 */
export async function getRates(base: string): Promise<Record<string, number> | null> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${base}`, {
    next: { revalidate: 86400 },
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.result === "success" ? data.rates : null
}
```

**Why open.er-api.com and not Frankfurter.** Frankfurter is ECB-only: 29
currencies, and it has no VND, EGP or MAD — a Vietnam trip would not work.
open.er-api.com is free, keyless, and returns 161 currencies. Both verified
live on 2026-07-29.

### Rate direction

The response is keyed *foreign per one base unit*. With `base=DKK` it returns
`"THB": 5.122502`, meaning **1 DKK = 5.122502 THB**. We store the inverse:

```
fx_rate            = 1 / rates[foreign]          // home per one foreign unit
home_amount_cents  = round(amount_cents * fx_rate)
```

Worked example: `฿500` with `fx_rate = 0.19521710` gives `kr 97.61`.

Getting this backwards is the single most likely bug in the slice, so the pure
conversion function is the one piece worth testing directly.

### Money formatting

`src/lib/money.ts` today holds three formatters that are not actually
euro-aware — the euro-ness is 62 `EUR` glyphs sitting beside them in JSX. It
becomes currency-aware, collapsing glyph and call into one thing:

```ts
/** "kr 97.61" / "THB 500.00" / "JPY 500". Decimals follow the currency. */
export function money(cents: number, currency: string): string
export function moneyRounded(cents: number, currency: string): string
export function moneyInput(cents: number): string   // unchanged, no symbol
```

Built on `Intl.NumberFormat("en-GB", { style: "currency", currency,
currencyDisplay: "narrowSymbol" })`, which was verified to give `kr 500.00`,
`฿500.00`, `€500.00` and — correctly — `¥500` and `₫500` with **zero**
decimals. Formatters are cached in a `Map` by currency code, since constructing
one per render is measurably slow.

## Currency resolution and threading

Each of the 58 non-comment sites needs the currency in scope. 14 of the 18 files
are client components, 4 are server.

- **Under `/trips/[slug]`** the whole subtree is one currency. A small context
  provider at the trip layout serves every client component with no prop
  drilling; the server components already have the trip in scope.
- **`/home` `trip-cards.tsx`** renders one card per trip, each using its own
  `trip.currency`. No context — it comes off the row.
- **`/profile`** aggregates across trips and is handled below.

## Entry and correction

### Entry

Three surfaces, each currently a static `EUR` span beside an `<input>`:
`expense-fields.tsx` (budget tab), `quick-expense.tsx` (`/on-the-road`),
`event-expense.tsx` (itinerary event cost).

The span becomes a **currency chip** — a button pre-filled from the location's
currency, falling back to the trip's:

```
  Dinner at Raan Jay Fai
  [THB v]  500
           ~ kr 97.61
```

Tapping it opens the trip's currency, then any currency used by a location on
this trip, then a search field for the rest.

The preview updates **as you type** — the rate table is already in memory, so
it is arithmetic, not a request. It is a preview only: the server action
recomputes authoritatively at save, so a stale client cannot write a bad rate.

**When the chip would show the trip's own currency, the chip and the preview
are not rendered** — the form looks exactly as it does today. A DKK expense on
a DKK trip pays no UI cost for a feature it is not using.

If `getRates` returns null, the picker offers the trip currency only. No expense
is ever saved with a guessed rate.

### Correction

In the expense edit form both amounts are editable:

```
  THB 500          <- what you paid
  kr  97.61        <- what it cost you    [x] confirmed
```

- Edit the **foreign** amount: the home amount recomputes at **this row's
  stored rate**, not today's market rate.
- Edit the **home** amount: `fx_rate` back-computes from the two amounts and
  `home_amount_confirmed` flips true.
- The checkbox is independently tappable, inline in the ledger as well as in
  the form, so a reconciliation pass does not require opening each row.

Because `fx_rate` is *"the rate that applied to this transaction"* rather than
*"the market rate that day"*, a correction survives a later unrelated edit with
no extra column. A flat ATM fee absorbed into one expense stays contained to
that expense.

### The estimate is the data

An unconfirmed expense is **not** a placeholder. `home_amount_cents` is
populated from the moment of save and is summed by every total identically to a
confirmed row. Nothing is blocked, pending, or rendered as `-`. A trip where
the user confirms nothing is complete and correct; the numbers are simply a
percent or two off in the direction of card markup.

`~` and the checkbox are honesty, not state. They mean "this came from a
mid-market rate, not from your bank."

The stored values are **frozen**: they never re-run. Opening a July expense in
December shows July's rate. An unconfirmed row is not drifting while ignored.

Visibility rules:

- The marker appears **only** when `currency != trips.currency`. Home-currency
  rows are exact and render as they do today.
- If any unconfirmed foreign expense exists on the trip, the trip's spent
  figure gets a `~` prefix. One character, no new layout, and the headline
  number stops overclaiming.

## Cross-trip aggregation

`trip-journal.tsx`, `trip-budget.tsx` and `budget-history.tsx` under `/profile`
aggregate across trips. `budget-history.tsx:59` prints
`euro(category.avgPerDayCents)` — an average per category over every past trip.
Once `trips.currency` varies, that sums kroner with euros. It is only correct
today because everything is EUR.

Fix: the profile query layer converts each trip's totals into the **current
workspace currency** at read time, using today's rate, for display only. Stored
values are untouched — opening Thailand still shows DKK. Only the comparison
view normalises, which is exactly where a shared unit is required. One
conversion per trip, not per expense.

The section carries a line naming the unit and the fact that other-currency
trips were converted.

## AI prompts

7 strings hardcode `EUR` in `suggestion-actions.ts` (5),
`near-daily-cap.ts` (2) and `budget-planner.ts` (1). These feed Claude, so a
wrong unit means the model reasons and answers in the wrong money. Each takes
the trip's currency code. Budget figures handed to the model are always home
amounts, so the model never sees a mixed-currency list.

## Rollout

Five slices, each independently shippable and verifiable.

| # | Slice | Visible change |
|---|---|---|
| 1 | `lib/fx/get-rates.ts`, currency-aware `money.ts`, the migration | **None** — everything still defaults EUR |
| 2 | Workspace + trip currency settings; swap the 48 inline displays and 10 input prefixes | Symbols change once a currency is set |
| 3 | Location currency, entry chip, conversion at save | Foreign expenses work |
| 4 | Correction, confirm checkbox, `~` markers | Reconciliation works |
| 5 | Profile cross-trip normalisation; 7 AI prompt strings | History and AI stop assuming EUR |

Slice 1 lands the whole foundation while changing nothing on screen, so a
mistake surfaces in a build rather than in the app. Slice 2 is the large
mechanical one and is pure display — a wrong render there has miscalculated and
miswritten nothing.

**Stop after slice 2 and use it.** That alone delivers a non-EUR app, which is
the first of the two problems and possibly the more valuable one.

## Out of scope

- Rate override at entry. Mid-market only; correction happens after the fact.
- A per-trip markup percentage.
- A dedicated reconcile view with drift totals and filters. The flag is in the
  schema, so this is a later UI addition rather than a migration.
- Foreign currency on any planning table.
- Re-converting historical trips when the workspace currency changes.
- Offline entry. The app needs the network to save at all.

## Gotchas

- **Rate direction.** The API gives foreign-per-base; we store home-per-foreign.
  Invert it.
- **Two identical amounts can differ.** Two `฿500` dinners a week apart may land
  on different home amounts, because the rate genuinely moved and each row froze
  its own. Correct, but it reads as a bug the first time it is seen.
- **Zero-decimal currencies.** `amount_cents` is hundredths for JPY and VND too.
  Do not special-case the storage; let `Intl` handle the display.
- **`home_amount_cents` is nullable.** Every reader must use
  `home_amount_cents ?? amount_cents` or same-currency expenses vanish from
  totals.
- **`getRates` returning null is normal**, not an error to handle defensively.
  The picker degrades to the trip currency.

## Success criteria

### Verified by Claude

1. `pnpm build` and `pnpm lint` clean after each slice.
2. The migration file is idempotent — running it twice produces no error and no
   duplicate column.
3. The pure conversion function returns `9761` for
   `(amount_cents: 50000, fx_rate: 0.19521710)`.
4. `money(50000, "JPY")` returns a string with **no** decimal places;
   `money(50000, "THB")` returns one with two.
5. Saving a foreign expense writes non-null `currency`, `home_amount_cents` and
   `fx_rate`; saving a home-currency expense writes `home_amount_cents = null`.
6. Editing an expense's home amount writes a changed `fx_rate` and sets
   `home_amount_confirmed = true`.
7. Changing the foreign amount on a corrected row recomputes the home amount at
   the row's stored `fx_rate`, not at today's market rate.
8. `summarizeBudget` and the per-category rollup read
   `home_amount_cents ?? amount_cents` — verified by reading every call site,
   with no remaining reader of bare `amount_cents` for totalling.
9. No `EUR` glyph or `"EUR"` literal remains in `src/` outside a default value
   or a comment.
10. Changing `workspaces.currency` leaves every existing `trips.currency`
    unchanged (query before and after).
11. A trip created after the workspace change inherits the new currency.

### Verified by the user in-app

1. Set the workspace currency to DKK; a new trip shows `kr` on every budget,
   savings and expense figure, and existing trips still show `EUR`.
2. Set a location's currency to THB; adding an expense from that location
   pre-fills THB without any tapping.
3. Typing `500` in a THB field shows a live `~ kr 97.61` beneath it that
   updates per keystroke without lag.
4. The saved ledger row shows both `THB 500` and the converted amount.
5. On a trip whose currency matches the expense, the currency chip and the
   preview are absent — the form looks unchanged.
6. Editing the home amount to a bank-statement figure updates the trip total and
   the settle-up figure immediately, and the row's `~` becomes a tick.
7. Tapping the checkbox inline in the ledger confirms a row without opening it.
8. The trip's spent figure carries `~` while any unconfirmed foreign expense
   exists, and loses it once all are confirmed.
9. Settle-up on a mixed-currency trip shows a single number in the trip's
   currency.
10. `/profile` budget history shows one unit, names it, and includes trips
    recorded in another currency.
11. The AI assistant, asked about the budget, answers in the trip's currency.
12. All of the above on a phone viewport — the currency chip must not push the
    amount field out of the expense form.
