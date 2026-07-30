# Multi-Currency and Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-30-multi-currency-design.md`

**Goal:** Let a workspace report in any currency, and let an expense be entered in a foreign currency that the app converts, stores alongside the original, and lets you correct later against a bank statement.

**Architecture:** Currency is a value copied downward at creation — workspace → trip → (optional) itinerary location — never a live lookup, so a recorded trip's numbers are immutable when the workspace setting changes. `expenses` keeps the fact (`amount_cents` + `currency`) and adds the derived home value (`home_amount_cents`, `fx_rate`, `home_amount_confirmed`); every total in the app sums `home_amount_cents ?? amount_cents`. Rates come from one keyless endpoint fetched per base currency and cached a day; conversion itself is local arithmetic in a pure module. Display currency reaches the 14 client components under `/trips/[slug]` through a small React context, mirroring `src/components/ai-mode.tsx`.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), React 19, TypeScript 5, Supabase (Postgres + RLS), Tailwind v4, `Intl.NumberFormat` / `Intl.DisplayNames` / `Intl.supportedValuesOf`.

## Global Constraints

These apply to **every** task. They come from `CLAUDE.md` and the project memory.

- **Package manager is `pnpm`.** `pnpm lint`, `pnpm build`. There is no test command and none is to be invented.
- **Never run `pnpm build` while `pnpm dev` is running** — they share `.next/` and the build clobbers the dev server. Stop dev first.
- **Migrations are applied by hand.** SQL files in `supabase/migrations/` are pasted into the Supabase SQL editor by the user. Committing a migration does nothing to the database. Every migration must be idempotent (`if not exists` / `drop`-then-`add` / `on conflict do nothing`) and safe to paste twice.
- **One shared Supabase project** for local dev and Vercel prod. There is no separate prod migration step.
- **Claude does not check work in the app.** Stop at `pnpm build` + `pnpm lint` + reasoning about the data path. Never say "done", "works", or "verified" for anything behind the UI — say *"implemented; build and lint clean; unverified in app"*.
- **No emojis** in code, comments, prints, or logs.
- **No defensive code, no speculative abstraction.** `getRates` returning `null` is a normal outcome the caller degrades on, not an error to guard against elsewhere.
- **Dates display day-before-month**, locale `en-GB`. All `Intl` formatters in this plan use `"en-GB"`.
- **Client/server split rule:** a `"use client"` file must never import from a `*-queries.ts` module (those pull `next/headers`). Types and pure helpers live in `*-types.ts` or a plain module.
- **`amount_cents` is hundredths of the currency unit for every currency**, including zero-decimal ones (JPY, VND). A 500 JPY expense stores `50000`. Never special-case storage; `Intl` handles the display.
- **Rate direction:** the API returns *foreign per one base unit*. We store `fx_rate` as *home per one foreign unit* — the inverse. This is the single most likely bug in the whole slice.
- **`home_amount_cents` is nullable** and means "no conversion happened". Every reader must use `home_amount_cents ?? amount_cents`.
- **Pure functions are verified by running them under Node**, which strips TypeScript types natively (Node 24 is installed):
  `node -e "import('./src/lib/fx/convert.ts').then(m => { ... })"`.
  Node prints a `MODULE_TYPELESS_PACKAGE_JSON` warning on stderr for these; that warning is expected and is not a failure.
- **Commit after every task.** Small commits, conventional-commit prefixes.

## Inventory (verified 2026-07-30)

The spec counted 62 euro glyphs across 18 files; the tree has since grown to **70 across the same 18 files**. Use `grep` as the source of truth, not the spec's number:

```bash
grep -rc '€' src/ --include=*.tsx --include=*.ts | grep -v ':0'
grep -rn '\bEUR\b' src/ --include=*.ts --include=*.tsx
```

Euro-glyph counts per file at the time of writing:

| File | Glyphs |
|---|---|
| `src/app/trips/[slug]/budget-figures.tsx` | 13 |
| `src/app/trips/[slug]/budget-drafter.tsx` | 8 |
| `src/app/trips/[slug]/budget-tab.tsx` | 6 |
| `src/app/profile/trip-journal.tsx` | 5 |
| `src/app/profile/budget-history.tsx` | 5 |
| `src/app/trips/[slug]/budget-scope-editor.tsx` | 4 |
| `src/app/trips/[slug]/budget-move-row.tsx` | 4 |
| `src/app/trips/[slug]/budget-by-category.tsx` | 4 |
| `src/app/profile/trip-budget.tsx` | 3 |
| `src/app/trips/[slug]/page.tsx` | 2 |
| `src/app/trips/[slug]/ledger-row.tsx` | 1 |
| `src/app/trips/[slug]/itinerary-tab.tsx` | 1 |
| `src/app/trips/[slug]/expense-fields.tsx` | 1 |
| `src/app/trips/[slug]/event-expense.tsx` | 1 |
| `src/app/trips/[slug]/budget-ledger.tsx` | 1 |
| `src/app/trips/[slug]/budget-drafter-pretrip.tsx` | 1 |
| `src/app/on-the-road/quick-expense.tsx` | 1 |
| `src/app/home/trip-cards.tsx` | 1 |

`"EUR"` string literals: `src/lib/trips/actions.ts` ×4 (expense inserts), `src/lib/ai/suggestion-actions.ts` ×5, `src/lib/nudges/near-daily-cap.ts` ×2, `src/lib/ai/agents/budget-planner.ts` ×1.

**Confirmed not to change:** the four `.select("amount_cents")` sums at `src/lib/trips/actions.ts:2465, 2577, 2679, 2816` all read `trip_budget_items`, which is a planning table and is by definition already in the trip's currency.

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260730000001_multi_currency.sql` | The five columns. Idempotent. |
| `src/lib/fx/convert.ts` | Pure arithmetic: invert a rate, convert to home cents, back-compute a rate. No I/O. Importable from client and server. |
| `src/lib/fx/get-rates.ts` | The one network call. Server-only by usage, plain `fetch` with Next revalidation. |
| `src/lib/fx/currency-list.ts` | Pure: ISO codes + display names from `Intl`, ordered for a picker. No hardcoded table. |
| `src/components/currency-context.tsx` | `CurrencyProvider` / `useCurrency`. Mirrors `src/components/ai-mode.tsx`. |
| `src/app/trips/[slug]/currency-chip.tsx` | The entry chip + live preview. Client. |

The workspace currency setting needs **no new file** — it is a plain `<form action={...}>` in the existing server component `src/app/profile/page.tsx`, matching the `updateProfile` form already there.

**Modified (in plan order):** `src/lib/money.ts`, `src/lib/trips/queries.ts`, `src/lib/trips/list-queries.ts`, `src/lib/workspace/queries.ts`, `src/lib/workspace/actions.ts`, `src/lib/trips/actions.ts`, `src/lib/trips/expense-types.ts`, `src/lib/trips/expense-queries.ts`, `src/lib/trips/location-types.ts`, `src/lib/trips/location-queries.ts`, `src/lib/trips/budget-history-queries.ts`, `src/lib/trips/budget-history-types.ts`, `src/lib/journal/journal-types.ts`, `src/lib/nudges/near-daily-cap.ts`, `src/lib/ai/suggestion-actions.ts`, `src/lib/ai/agents/budget-planner.ts`, the 18 display files above, `src/app/trips/[slug]/edit/edit-trip-form.tsx`, `src/app/profile/page.tsx`, `src/app/on-the-road/page.tsx`, `docs/TODO.md`, `docs/DECISIONS.md`.

## Slice map

| Slice | Tasks | Visible change |
|---|---|---|
| 1 — Foundation | 1–3 | **None.** Everything still defaults EUR. |
| 2 — Non-EUR app | 4–8 | Symbols change once a currency is set. |
| 3 — Foreign entry | 9–12 | Foreign expenses work. |
| 4 — Correction | 13–14 | Reconciliation works. |
| 5 — History + AI | 15–17 | Profile and AI stop assuming EUR. |

**Stop after Task 8 and use the app.** Slice 2 alone delivers a non-EUR app, which is the first of the two problems and possibly the more valuable one.

## Out of scope

Do not build these, even if a task looks like it wants them. Each is a deliberate exclusion from the spec:

- Rate override at entry. Mid-market only; correction happens after the fact (Task 13).
- A per-trip markup percentage.
- A dedicated reconcile view with drift totals and filters. `home_amount_confirmed` is in the schema, so this is a later UI addition rather than a migration.
- Foreign currency on any planning table — `trips.planned_budget_cents`, `trips.saved_cents`, `trip_budget_items`, `savings_contributions`, `budget_moves`, `itinerary_locations.budget_cents` are all in the trip's currency by definition and get a display symbol only. Plan and actual therefore stay directly comparable, because both are home amounts.
- Re-converting historical trips when the workspace currency changes.
- Offline entry. The app needs the network to save at all.

---

## Slice 1 — Foundation (no visible change)

### Task 1: The migration

**Files:**
- Create: `supabase/migrations/20260730000001_multi_currency.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: columns `expenses.home_amount_cents` (`integer`, nullable), `expenses.fx_rate` (`numeric(18,8)`, nullable), `expenses.home_amount_confirmed` (`boolean not null default false`), `workspaces.currency` (`text not null default 'EUR'`), `trips.currency` (`text not null default 'EUR'`), `itinerary_locations.currency` (`text`, nullable).

- [ ] **Step 1: Write the migration**

```sql
-- Multi-currency: per-workspace/trip/location currency, plus the converted home
-- amount on each expense. Safe to run repeatedly.

alter table public.expenses
  add column if not exists home_amount_cents integer,
  add column if not exists fx_rate numeric(18,8),
  add column if not exists home_amount_confirmed boolean not null default false;

alter table public.workspaces
  add column if not exists currency text not null default 'EUR';

alter table public.trips
  add column if not exists currency text not null default 'EUR';

alter table public.itinerary_locations
  add column if not exists currency text;

-- 3-letter ISO codes only, matching the existing check on expenses.currency.
-- Dropped first so a re-run replaces rather than collides.
alter table public.workspaces drop constraint if exists workspaces_currency_check;
alter table public.workspaces
  add constraint workspaces_currency_check check (char_length(currency) = 3);

alter table public.trips drop constraint if exists trips_currency_check;
alter table public.trips
  add constraint trips_currency_check check (char_length(currency) = 3);

alter table public.itinerary_locations
  drop constraint if exists itinerary_locations_currency_check;
alter table public.itinerary_locations
  add constraint itinerary_locations_currency_check
  check (currency is null or char_length(currency) = 3);
```

- [ ] **Step 2: Verify idempotency by reading, not running**

You cannot run this — migrations are applied by hand by the user. Re-read the file and confirm every statement is one of: `add column if not exists`, or `drop constraint if exists` immediately followed by `add constraint`. There must be no bare `add column`, no `create index` without `if not exists`, and no `update` of existing rows.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260730000001_multi_currency.sql
git commit -m "feat(db): multi-currency columns on expenses, workspaces, trips, locations"
```

- [ ] **Step 4: Tell the user to apply it**

Report: "Migration written. Paste `supabase/migrations/20260730000001_multi_currency.sql` into the Supabase SQL editor before the next task — later tasks read these columns."

---

### Task 2: The FX layer

**Files:**
- Create: `src/lib/fx/convert.ts`
- Create: `src/lib/fx/get-rates.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `inverseRate(foreignPerHome: number): number`
  - `toHomeCents(amountCents: number, fxRate: number): number`
  - `rateFromAmounts(amountCents: number, homeAmountCents: number): number`
  - `getRates(base: string): Promise<Record<string, number> | null>`

- [ ] **Step 1: Write the pure conversion module**

Create `src/lib/fx/convert.ts`:

```ts
/**
 * Pure currency arithmetic. No I/O, no formatting -- importable from a client
 * component and from a server action alike.
 *
 * `fxRate` throughout is **home units per one foreign unit**. The rates API
 * gives the opposite direction, so `inverseRate` is the boundary between the
 * two conventions and every other function here assumes the stored one.
 */

/** API direction (foreign per one home unit) -> stored direction. */
export function inverseRate(foreignPerHome: number): number {
  return 1 / foreignPerHome
}

/** Foreign cents at a stored rate -> home cents. Rounded to a whole cent. */
export function toHomeCents(amountCents: number, fxRate: number): number {
  return Math.round(amountCents * fxRate)
}

/**
 * The rate implied by a corrected pair of amounts. Used when the user edits the
 * home amount to the figure their bank actually charged: the rate that applied
 * to *this transaction* is whatever makes the two amounts agree, fees included.
 */
export function rateFromAmounts(
  amountCents: number,
  homeAmountCents: number,
): number {
  return homeAmountCents / amountCents
}
```

- [ ] **Step 2: Verify the pure functions under Node**

Run from the repo root:

```bash
node -e "import('./src/lib/fx/convert.ts').then(m => {
  const a = m.toHomeCents(50000, 0.19521710)
  console.assert(a === 9761, 'toHomeCents ' + a)
  const r = m.inverseRate(5.122502)
  console.assert(Math.abs(r - 0.19521710) < 1e-8, 'inverseRate ' + r)
  const b = m.rateFromAmounts(50000, 10000)
  console.assert(b === 0.2, 'rateFromAmounts ' + b)
  console.log('convert ok', a, r, b)
})"
```

Expected: `convert ok 9761 0.1952171... 0.2` and no `Assertion failed` lines. (A `MODULE_TYPELESS_PACKAGE_JSON` warning on stderr is expected.)

- [ ] **Step 3: Write the rates fetcher**

Create `src/lib/fx/get-rates.ts`, shaped after `src/lib/weather/get-weather.ts`:

```ts
/**
 * Every rate against `base`, from open.er-api.com (free, no key). One call
 * returns ~161 currencies, so a conversion is local arithmetic rather than a
 * request. Cached a day. Returns null if the call fails -- the caller offers
 * home-currency entry only rather than inventing a rate.
 *
 * The response is keyed **foreign per one base unit**: with base=DKK,
 * `rates.THB === 5.122502` means 1 DKK = 5.122502 THB. Invert it with
 * `inverseRate` before storing.
 *
 * Chosen over Frankfurter, which is ECB-only (29 currencies, no VND/EGP/MAD).
 */
export async function getRates(
  base: string,
): Promise<Record<string, number> | null> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${base}`, {
    next: { revalidate: 86400 },
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.result === "success" ? data.rates : null
}
```

- [ ] **Step 4: Verify the endpoint is live and the direction is what the docstring claims**

```bash
node -e "fetch('https://open.er-api.com/v6/latest/DKK').then(r => r.json()).then(d => {
  console.log(d.result, 'THB per DKK =', d.rates.THB, '| currencies:', Object.keys(d.rates).length)
})"
```

Expected: `success`, a `THB` value near 5, and a currency count above 150. If the count is under 100 or `THB` is absent, stop and report — the provider changed and the spec's choice needs revisiting.

- [ ] **Step 5: Lint and build**

```bash
pnpm lint && pnpm build
```

Expected: both clean. (Stop `pnpm dev` first if it is running.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/fx
git commit -m "feat(fx): rate fetching and pure conversion arithmetic"
```

---

### Task 3: Currency-aware money formatting

**Files:**
- Modify: `src/lib/money.ts`
- Create: `src/lib/fx/currency-list.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `money(cents: number, currency: string): string` — e.g. `"kr 97.61"`, `"฿500.00"`, `"¥500"`
  - `moneyRounded(cents: number, currency: string): string` — e.g. `"kr 98"`, `"¥500"`
  - `moneyInput(cents: number): string` — unchanged behaviour, no symbol
  - `currencyOptions(): { code: string; label: string }[]`
- The existing `euro`, `euroRounded` and `euroInput` stay for now so nothing breaks; Task 8 deletes the first two and Task 7 renames `euroInput` usages.

- [ ] **Step 1: Rewrite `src/lib/money.ts`**

Replace the whole file with:

```ts
const formatters = new Map<string, Intl.NumberFormat>()

function formatter(currency: string, decimals: 0 | 2): Intl.NumberFormat {
  const key = `${currency}:${decimals}`
  const cached = formatters.get(key)
  if (cached) return cached
  // narrowSymbol so DKK renders "kr" rather than "DKK"; omitting the fraction
  // options lets Intl use each currency's own minor-unit count, which is what
  // makes JPY and VND come out with no decimals at all.
  const made = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    ...(decimals === 0
      ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
      : {}),
  })
  formatters.set(key, made)
  return made
}

/**
 * Cents as a currency-marked amount: (9761, "DKK") -> "kr 97.61". Decimals
 * follow the currency, so (50000, "JPY") -> "¥500". `cents` is always
 * hundredths of the currency unit, including for zero-decimal currencies.
 * Formatters are cached because constructing one per render is measurably slow.
 */
export function money(cents: number, currency: string): string {
  return formatter(currency, 2).format(cents / 100)
}

/** As `money` but whole units: (123456, "DKK") -> "kr 1,235". */
export function moneyRounded(cents: number, currency: string): string {
  return formatter(currency, 0).format(cents / 100)
}

/** Cents for an editable amount field: 123456 -> "1234.56". No separators — a
 * grouped string is invalid in `<input type="number">` (renders blank) and
 * parses back as NaN, so an edit would drop the price. */
export function moneyInput(cents: number): string {
  return String(Math.round(cents) / 100)
}

const grouped2 = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const grouped0 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 })

/** Deprecated: euro-only, symbol-less. Callers move to `money`. */
export function euro(cents: number): string {
  return grouped2.format(cents / 100)
}

/** Deprecated: euro-only, symbol-less. Callers move to `moneyRounded`. */
export function euroRounded(cents: number): string {
  return grouped0.format(cents / 100)
}

/** Deprecated alias of `moneyInput`. */
export function euroInput(cents: number): string {
  return moneyInput(cents)
}
```

- [ ] **Step 2: Verify the formatter against the spec's cases**

```bash
node -e "import('./src/lib/money.ts').then(m => {
  const jpy = m.money(50000, 'JPY')
  const thb = m.money(50000, 'THB')
  console.assert(!jpy.includes('.'), 'JPY should have no decimals: ' + jpy)
  console.assert(/\.\d{2}$/.test(thb), 'THB should have two decimals: ' + thb)
  console.assert(m.money(9761, 'DKK') === 'kr 97.61', m.money(9761, 'DKK'))
  console.assert(m.moneyRounded(123456, 'DKK') === 'kr 1,235', m.moneyRounded(123456, 'DKK'))
  console.assert(m.money(50000, 'EUR') === '€500.00', m.money(50000, 'EUR'))
  console.log('money ok |', jpy, '|', thb, '|', m.money(9761,'DKK'))
})"
```

Expected: `money ok | ¥500 | ฿500.00 | kr 97.61` with no assertion failures.

- [ ] **Step 3: Write the currency list**

Create `src/lib/fx/currency-list.ts`:

```ts
/**
 * Every ISO currency the runtime knows, with a readable label. Derived from
 * Intl rather than a hand-kept table, so it cannot drift. Sorted by code.
 */
export interface CurrencyOption {
  code: string
  /** "DKK — Danish Krone" */
  label: string
}

let cached: CurrencyOption[] | null = null

export function currencyOptions(): CurrencyOption[] {
  if (cached) return cached
  const names = new Intl.DisplayNames(["en-GB"], { type: "currency" })
  cached = Intl.supportedValuesOf("currency").map((code) => ({
    code,
    label: `${code} — ${names.of(code) ?? code}`,
  }))
  return cached
}
```

- [ ] **Step 4: Verify the list**

```bash
node -e "import('./src/lib/fx/currency-list.ts').then(m => {
  const all = m.currencyOptions()
  const dkk = all.find(o => o.code === 'DKK')
  console.assert(all.length > 150, 'too few currencies: ' + all.length)
  console.assert(dkk.label === 'DKK — Danish Krone', dkk.label)
  console.log('currencies ok', all.length, dkk.label)
})"
```

Expected: `currencies ok 162 DKK — Danish Krone` (count may differ by runtime; it must exceed 150).

- [ ] **Step 5: Lint and build**

```bash
pnpm lint && pnpm build
```

Expected: both clean. Nothing on screen has changed — every existing caller still uses `euro`/`euroRounded`, which behave exactly as before.

- [ ] **Step 6: Commit**

```bash
git add src/lib/money.ts src/lib/fx/currency-list.ts
git commit -m "feat(money): currency-aware formatters alongside the euro ones"
```

**Slice 1 is complete.** Nothing on screen has changed; the migration, the FX layer and the formatters are all in place.

---

## Slice 2 — A non-EUR app

### Task 4: Currency through the query layer, and copied at trip creation

**Files:**
- Modify: `src/lib/workspace/queries.ts`
- Modify: `src/lib/trips/queries.ts`
- Modify: `src/lib/trips/list-queries.ts`
- Modify: `src/lib/trips/actions.ts` (`createTrip`, around line 741)

**Interfaces:**
- Consumes: the columns from Task 1.
- Produces: `CurrentWorkspace.currency: string`, `TripHeader.currency: string`, `TripListItem.currency: string`. Every later task reads currency from one of these three.

- [ ] **Step 1: Add `currency` to `CurrentWorkspace`**

In `src/lib/workspace/queries.ts`, add to the interface:

```ts
export interface CurrentWorkspace {
  id: string
  name: string
  createdAt: string
  role: "owner" | "member"
  /** The workspace's home currency; the default a new trip is created with. */
  currency: string
  members: WorkspaceMember[]
}
```

Extend the embedded select and the row cast:

```ts
    .select("workspace_id, role, workspaces(name, created_at, currency)")
```

```ts
  const workspaceRow = membership.workspaces as unknown as {
    name: string
    created_at: string
    currency: string
  }
```

and add `currency: workspaceRow.currency,` to the returned object.

- [ ] **Step 2: Add `currency` to `TripHeader`**

In `src/lib/trips/queries.ts`: add `currency: string` to `TripHeader` (with the doc comment `/** This trip's reporting unit. Every total on the trip is in this. */`), add `currency: string` to `interface TripRow`, append `, currency` to the `.select(...)` string in `getTripBySlug`, and add `currency: trip.currency,` to the returned object.

- [ ] **Step 3: Add `currency` to `TripListItem`**

In `src/lib/trips/list-queries.ts`: add `currency: string` to `TripListItem` and to `interface TripRow`, append `, currency` to the trips `.select(...)`, and map `currency: r.currency,` wherever a `TripRow` becomes a `TripListItem`. Find every mapping site with:

```bash
grep -n 'plannedBudgetCents:' src/lib/trips/list-queries.ts
```

Every line that sets `plannedBudgetCents` from a row also needs `currency`.

- [ ] **Step 4: Copy the workspace currency into a new trip**

In `src/lib/trips/actions.ts`, `createTrip` already loads `const workspace = await getCurrentWorkspace()` before inserting. Add one line to the insert object (around line 741):

```ts
  const { error: insertError } = await supabase.from("trips").insert({
    workspace_id: workspace.id,
    slug,
    name,
    country,
    start_date: startDate,
    end_date: endDate,
    fuzzy_when: fuzzyWhen,
    lat: input.lat,
    lng: input.lng,
    // Copied, not looked up: changing the workspace currency later must not
    // rewrite a recorded trip's numbers.
    currency: workspace.currency,
    trip_profile: tripProfile,
    created_by: userData.user.id,
  })
```

- [ ] **Step 5: Lint and build**

```bash
pnpm lint && pnpm build
```

Expected: both clean. TypeScript will flag any `TripListItem` or `CurrentWorkspace` object literal you missed — fix those rather than casting.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspace/queries.ts src/lib/trips/queries.ts src/lib/trips/list-queries.ts src/lib/trips/actions.ts
git commit -m "feat(trips): read workspace/trip currency and copy it at trip creation"
```

---

### Task 5: The two currency settings

**Files:**
- Modify: `src/lib/workspace/actions.ts`
- Modify: `src/app/profile/page.tsx` (insert after the `<dl>` block, currently ending line 171)
- Modify: `src/lib/trips/actions.ts` (`UpdateTripInput`, `updateTrip`)
- Modify: `src/app/trips/[slug]/edit/edit-trip-form.tsx`

**Interfaces:**
- Consumes: `currencyOptions()` from Task 3, `CurrentWorkspace.currency` and `TripHeader.currency` from Task 4.
- Produces: `setWorkspaceCurrency(formData: FormData): Promise<void>`; `UpdateTripInput.currency: string`.

- [ ] **Step 1: Add the workspace currency action**

Append to `src/lib/workspace/actions.ts` (the file is already `"use server"`; add the two imports it needs at the top):

```ts
import { revalidatePath } from "next/cache"

import { currencyOptions } from "@/lib/fx/currency-list"
```

```ts
/**
 * Sets the workspace's home currency. Existing trips keep the currency they
 * were created with -- only the next trip inherits this.
 *
 * Wired straight to `<form action={...}>`, so it throws rather than returning
 * an error shape.
 */
export async function setWorkspaceCurrency(formData: FormData): Promise<void> {
  const currency = String(formData.get("currency") ?? "")
  if (!currencyOptions().some((o) => o.code === currency)) {
    throw new Error("Unknown currency")
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) throw new Error("Not signed in")

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userData.user.id)
    .limit(1)
    .maybeSingle()
  if (!membership) throw new Error("No workspace")

  const { error } = await supabase
    .from("workspaces")
    .update({ currency })
    .eq("id", membership.workspace_id)
  if (error) throw new Error(error.message)

  revalidatePath("/profile")
}
```

- [ ] **Step 2: Add the setting to /profile**

In `src/app/profile/page.tsx`, add the imports:

```ts
import { setWorkspaceCurrency } from "@/lib/workspace/actions"
import { currencyOptions } from "@/lib/fx/currency-list"
```

and insert this immediately after the `</dl>` that closes the Email / Member-since list:

```tsx
          <form action={setWorkspaceCurrency} className="mt-10">
            <label className="block text-xs text-muted-foreground">
              Home currency
              <select
                name="currency"
                defaultValue={workspace.currency}
                className="mt-1 block w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
              >
                {currencyOptions().map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              New trips start in this currency. Trips you have already recorded
              keep theirs.
            </p>
            <Button type="submit" size="lg" className="mt-3">
              Save currency
            </Button>
          </form>
```

- [ ] **Step 3: Let a trip's currency be edited**

In `src/lib/trips/actions.ts`, add `currency: string` to `UpdateTripInput`, and in `updateTrip` validate and include it. `updateTrip` branches (dream vs dated, slug changed vs not) and so has more than one `.from("trips").update(...)`. Enumerate them first and patch **every** one:

```bash
awk '/^export async function updateTrip/,/^export async function [^u]/' src/lib/trips/actions.ts | grep -n 'update({'
```

Add the validation just after the name/slug checks:

```ts
  if (!currencyOptions().some((o) => o.code === input.currency)) {
    return { error: "Unknown currency." }
  }
```

and add `currency: input.currency,` to the trips update payload. Import `currencyOptions` from `@/lib/fx/currency-list` at the top.

- [ ] **Step 4: Add the select to the trip edit form**

In `src/app/trips/[slug]/edit/edit-trip-form.tsx`: add `currency: string` to the `initial` prop type, add `const [currency, setCurrency] = React.useState(initial.currency)`, pass `currency` in the `updateTrip({...})` call, and add a select beside the Country field (around line 240):

```tsx
        <label className="mt-5 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Currency
          </span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="mt-1 block w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          >
            {currencyOptions().map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
```

Import `currencyOptions` from `@/lib/fx/currency-list` — it is a pure module with no `next/headers` import, so it is safe in a `"use client"` file. Then pass `currency={trip.currency}` from the page that renders this form (`src/app/trips/[slug]/edit/page.tsx`, in the `initial` object).

- [ ] **Step 5: Lint and build**

```bash
pnpm lint && pnpm build
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspace/actions.ts src/app/profile/page.tsx src/lib/trips/actions.ts "src/app/trips/[slug]/edit"
git commit -m "feat(settings): workspace home currency and per-trip currency"
```

---

### Task 6: The currency context

**Files:**
- Create: `src/components/currency-context.tsx`
- Modify: `src/app/trips/[slug]/page.tsx`
- Modify: `src/app/on-the-road/page.tsx`

**Interfaces:**
- Consumes: `TripHeader.currency` / `TripListItem.currency` from Task 4.
- Produces:
  - `<CurrencyProvider currency={string} rates={Record<string, number> | null}>` — wraps a trip subtree.
  - `useCurrency(): { currency: string; rates: Record<string, number> | null }`

`rates` is unused until Task 11 but is part of the provider from the start, so the entry chip does not need a second pass through both pages.

- [ ] **Step 1: Write the context**

Create `src/components/currency-context.tsx`, mirroring `src/components/ai-mode.tsx`:

```tsx
"use client"

import * as React from "react"

interface CurrencyValue {
  /** The trip's reporting currency. Every displayed total is in this. */
  currency: string
  /**
   * Foreign units per one unit of `currency`, or null when the rates call
   * failed. Null means the entry chip offers the trip currency only.
   */
  rates: Record<string, number> | null
}

const CurrencyContext = React.createContext<CurrencyValue>({
  currency: "EUR",
  rates: null,
})

export function CurrencyProvider({
  currency,
  rates,
  children,
}: {
  currency: string
  rates: Record<string, number> | null
  children: React.ReactNode
}) {
  const value = React.useMemo(() => ({ currency, rates }), [currency, rates])
  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency(): CurrencyValue {
  return React.useContext(CurrencyContext)
}
```

- [ ] **Step 2: Wrap the trip page**

In `src/app/trips/[slug]/page.tsx`, add:

```ts
import { CurrencyProvider } from "@/components/currency-context"
import { getRates } from "@/lib/fx/get-rates"
```

Fetch rates alongside the trip's other data:

```ts
  const rates = await getRates(trip.currency)
```

Then wrap the returned JSX. The page returns a top-level `<div className="relative mx-auto ...">`; wrap that whole element:

```tsx
  return (
    <CurrencyProvider currency={trip.currency} rates={rates}>
      {/* existing top-level <div> unchanged */}
    </CurrencyProvider>
  )
```

`page.tsx` stays a Server Component — `CurrencyProvider` is a client component receiving server-rendered children as a prop, which is the supported pattern.

- [ ] **Step 3: Wrap the on-the-road page**

Do the same in `src/app/on-the-road/page.tsx`, using `trip.currency` off the `TripListItem` from `buckets.now[0]`.

- [ ] **Step 4: Lint and build**

```bash
pnpm lint && pnpm build
```

Expected: both clean. Nothing on screen has changed yet — no consumer reads the context.

- [ ] **Step 5: Commit**

```bash
git add src/components/currency-context.tsx "src/app/trips/[slug]/page.tsx" src/app/on-the-road/page.tsx
git commit -m "feat(trips): currency context over the trip and on-the-road subtrees"
```

---

### Task 7: Swap the display sites under `/trips/[slug]`

This is the large mechanical task. It is **pure display** — a wrong render here has miscalculated and miswritten nothing.

**Files (14, plus one helper):**
- Modify: `src/lib/money.ts` (add `currencySymbol`)
- Modify: `src/app/trips/[slug]/`: `budget-figures.tsx` (13 glyphs), `budget-drafter.tsx` (8), `budget-tab.tsx` (6), `budget-scope-editor.tsx` (4), `budget-move-row.tsx` (4), `budget-by-category.tsx` (4), `page.tsx` (2), `ledger-row.tsx` (1), `itinerary-tab.tsx` (1), `expense-fields.tsx` (1), `event-expense.tsx` (1), `budget-ledger.tsx` (1), `budget-drafter-pretrip.tsx` (1)

**Interfaces:**
- Consumes: `money`, `moneyRounded`, `moneyInput` (Task 3); `useCurrency` (Task 6); `TripHeader.currency` (Task 4).
- Produces: `currencySymbol(currency: string): string` in `src/lib/money.ts`.

- [ ] **Step 1: Add `currencySymbol` to `src/lib/money.ts`**

```ts
/** The bare symbol for an input prefix: "DKK" -> "kr", "THB" -> "฿". */
export function currencySymbol(currency: string): string {
  const part = formatter(currency, 2)
    .formatToParts(0)
    .find((p) => p.type === "currency")
  return part?.value ?? currency
}
```

- [ ] **Step 2: Verify it**

```bash
node -e "import('./src/lib/money.ts').then(m => {
  console.assert(m.currencySymbol('DKK') === 'kr', m.currencySymbol('DKK'))
  console.assert(m.currencySymbol('EUR') === '€', m.currencySymbol('EUR'))
  console.log('symbol ok', m.currencySymbol('DKK'), m.currencySymbol('THB'))
})"
```

Expected: `symbol ok kr ฿`.

- [ ] **Step 3: Apply the three substitution rules, file by file**

Work one file at a time. In each `"use client"` file, add at the top of the component body:

```ts
  const { currency } = useCurrency()
```

with `import { useCurrency } from "@/components/currency-context"`. In the two Server Components (`page.tsx`, and any other file without `"use client"`), use `trip.currency` directly — no context.

The rules, exhaustively:

| Before | After |
|---|---|
| `€{euro(x)}` or `€{fmt(x)}` (where `fmt` is the aliased import of `euro`) | `{money(x, currency)}` |
| `€{euroRounded(x)}` | `{moneyRounded(x, currency)}` |
| `+€{fmt(x)}` / `−€{fmt(x)}` (signed, in `budget-move-row.tsx`, `budget-ledger.tsx`) | `{"+"}{money(x, currency)}` / `{"−"}{money(x, currency)}` — keep the sign outside the call |
| `<span …>€</span>` standing beside an `<input>` | `<span …>{currencySymbol(currency)}</span>` |
| `euroInput(x)` | `moneyInput(x)` |

Note the React 19 lint gotcha from project memory: a bare `+` or `−` glyph adjacent to a JSX expression is fine, but any leading `//` in JSX text must be wrapped as `{"// text"}`. Signed amounts are cleanest as `{"+"}` expressions as shown.

Update each file's import line from `@/lib/money` accordingly. Several files import `euro as fmt` — keep the local alias if you like, but alias `money`, not `euro`.

- [ ] **Step 4: Verify the subtree is clean**

```bash
grep -rn '€' "src/app/trips/[slug]/"
grep -rn '\beuro\b\|euroRounded\|euroInput' "src/app/trips/[slug]/"
```

Expected: **no output** from either command.

- [ ] **Step 5: Lint and build**

```bash
pnpm lint && pnpm build
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/money.ts "src/app/trips/[slug]"
git commit -m "refactor(trips): render every money figure in the trip's currency"
```

---

### Task 8: Swap the remaining display sites and delete the euro helpers

**Files:**
- Modify: `src/app/home/trip-cards.tsx` (1 glyph)
- Modify: `src/app/on-the-road/quick-expense.tsx` (1 glyph)
- Modify: `src/app/profile/trip-journal.tsx` (5), `src/app/profile/budget-history.tsx` (5), `src/app/profile/trip-budget.tsx` (3)
- Modify: `src/lib/money.ts` (delete `euro`, `euroRounded`, `euroInput`)

**Interfaces:**
- Consumes: everything from Task 7.
- Produces: `src/lib/money.ts` exporting exactly `money`, `moneyRounded`, `moneyInput`, `currencySymbol`.

- [ ] **Step 1: `/home` trip cards**

`trip-cards.tsx` renders one card per trip and must **not** use the context — each card's unit comes off its own row. Use `trip.currency` from the `TripListItem` (Task 4) at the call site:

```tsx
{money(trip.spentCents, trip.currency)}
```

- [ ] **Step 2: `/on-the-road` quick expense**

`quick-expense.tsx` is inside the provider added in Task 6. Add `const { currency } = useCurrency()` and swap `€{euro(spentTodayCents)} today` for `{money(spentTodayCents, currency)} today`.

- [ ] **Step 3: `/profile`**

The three profile files aggregate across trips. In this slice they take a single `currency` prop, and `src/app/profile/page.tsx` passes `workspace.currency`. **This is display-only and is not yet correct for a mixed-currency history — Task 15 adds the actual normalisation.** Add the prop, thread it from the page, and apply the same substitution rules as Task 7.

- [ ] **Step 4: Delete the euro helpers**

Remove `euro`, `euroRounded`, `euroInput`, `grouped2` and `grouped0` from `src/lib/money.ts`. The file should now export only `money`, `moneyRounded`, `moneyInput`, `currencySymbol`.

- [ ] **Step 5: Verify no euro remains**

```bash
grep -rn '€' src/
grep -rn '\beuro\b\|euroRounded\|euroInput' src/
grep -rn '"EUR"' src/
```

Expected: the first two produce **no output**. The third produces only the four expense-insert literals in `src/lib/trips/actions.ts` (removed in Task 12), the AI prompt strings (Task 16), and any default value or comment — the spec permits defaults and comments.

- [ ] **Step 6: Lint and build**

```bash
pnpm lint && pnpm build
```

Expected: both clean. A missed call site is a type error, not a silent bug — `money` requires two arguments.

- [ ] **Step 7: Commit**

```bash
git add src/lib/money.ts src/app/home src/app/on-the-road src/app/profile
git commit -m "refactor(money): drop the euro-only formatters"
```

- [ ] **Step 8: Hand over for in-app verification**

Report: *"Slice 2 implemented; build and lint clean; unverified in app."* Then give the user this checklist:

1. Set the workspace currency to DKK on `/profile`.
2. Existing trips still show `€` on every budget, savings and expense figure.
3. Create a new trip — it shows `kr` on every budget, savings and expense figure.
4. Change that trip's currency on its edit page; the trip page follows.
5. `/home` cards, `/on-the-road`, and `/profile` all show a currency symbol on every amount, with no stray `€`.
6. All of the above on a phone viewport.

**This is the recommended stopping point.** Use the app on a real trip before starting Slice 3.

---

## Slice 3 — Foreign entry

### Task 9: Every total reads the home amount

This lands **before** anything writes a home amount, so it is a no-op in production data (`home_amount_cents` is null everywhere, and `null ?? amount_cents` is `amount_cents`) while making the write in Task 12 immediately correct everywhere.

**Files:**
- Modify: `src/lib/trips/expense-types.ts`
- Modify: `src/lib/trips/expense-queries.ts`
- Modify: `src/lib/trips/actions.ts` (`loadTripBalance`, ~line 296)
- Modify: `src/lib/trips/list-queries.ts` (~line 102)
- Modify: `src/lib/trips/budget-history-queries.ts` (~lines 18–64)
- Modify: `src/lib/journal/journal-types.ts` (~lines 101, 143)
- Modify: `src/app/trips/[slug]/budget-tab.tsx` (~line 260)
- Modify: `src/app/on-the-road/page.tsx` (~line 67)

**Interfaces:**
- Consumes: the `expenses` columns from Task 1.
- Produces:
  - `Expense.homeAmountCents: number | null`, `Expense.fxRate: number | null`, `Expense.homeAmountConfirmed: boolean`
  - `homeCents(e: { amountCents: number; homeAmountCents: number | null }): number`
  - `isForeign(e: Expense, tripCurrency: string): boolean`

- [ ] **Step 1: Extend the `Expense` type and add the two helpers**

In `src/lib/trips/expense-types.ts`:

```ts
export interface Expense {
  id: string
  tripId: string
  title: string
  /** What you handed over, in hundredths of `currency`. The fact; never derived. */
  amountCents: number
  currency: string
  /**
   * The converted amount in the trip's currency. Null means the expense was
   * already in the trip's currency -- readers use `homeCents`, never this
   * field bare.
   */
  homeAmountCents: number | null
  /** Home units per one foreign unit, as it applied to this transaction. */
  fxRate: number | null
  /** True once the user has checked this row against their bank. */
  homeAmountConfirmed: boolean
  paidBy: string
  category: string
  dayDate: string | null
  locationId: string | null
  isSettlement: boolean
  createdAt: string
}

/**
 * What this expense cost in the trip's currency. Every total in the app sums
 * this, never `amountCents` -- a same-currency expense has a null home amount
 * and would otherwise vanish from the totals.
 */
export function homeCents(e: {
  amountCents: number
  homeAmountCents: number | null
}): number {
  return e.homeAmountCents ?? e.amountCents
}

/** True when this expense was paid in something other than the trip's currency. */
export function isForeign(e: Expense, tripCurrency: string): boolean {
  return e.currency !== tripCurrency
}
```

Then in `summarizeBudget`, replace both uses of `e.amountCents` with `homeCents(e)`:

```ts
  for (const e of expenses) {
    if (e.isSettlement) {
      settlementsByUser[e.paidBy] =
        (settlementsByUser[e.paidBy] ?? 0) + homeCents(e)
    } else {
      const cents = homeCents(e)
      expenseTotalCents += cents
      expensePaidByUser[e.paidBy] = (expensePaidByUser[e.paidBy] ?? 0) + cents
    }
  }
```

- [ ] **Step 2: Verify `summarizeBudget` sums home amounts**

```bash
node -e "import('./src/lib/trips/expense-types.ts').then(m => {
  const base = { id:'x', tripId:'t', title:'d', currency:'THB', fxRate:0.2,
    homeAmountConfirmed:false, category:'Food', dayDate:null, locationId:null,
    isSettlement:false, createdAt:'' }
  const foreign = { ...base, amountCents: 50000, homeAmountCents: 9761, paidBy: 'a' }
  const home    = { ...base, amountCents: 1000, homeAmountCents: null, currency:'DKK', paidBy: 'b' }
  const s = m.summarizeBudget([foreign, home], ['a','b'])
  console.assert(s.expenseTotalCents === 10761, 'total ' + s.expenseTotalCents)
  console.assert(m.homeCents(home) === 1000, 'null home must fall back')
  console.log('readers ok', s.expenseTotalCents, s.netBalanceCents)
})"
```

Expected: `readers ok 10761 4381` (the net is `(9761 - 1000) / 2` rounded). No assertion failures. The second assert is the guard for the "same-currency expenses vanish" gotcha.

- [ ] **Step 3: Select the new columns**

In `src/lib/trips/expense-queries.ts`, extend the select and the mapping:

```ts
    .select(
      "id, trip_id, title, amount_cents, currency, home_amount_cents, fx_rate, home_amount_confirmed, paid_by, category, day_date, location_id, is_settlement, created_at",
    )
```

```ts
    homeAmountCents: row.home_amount_cents,
    fxRate: row.fx_rate === null ? null : Number(row.fx_rate),
    homeAmountConfirmed: row.home_amount_confirmed,
```

`fx_rate` is a Postgres `numeric`, which PostgREST returns as a **string**. The `Number(...)` conversion is required, not cosmetic.

- [ ] **Step 4: Fix the remaining raw-SQL readers**

Three places read `amount_cents` off `expenses` outside `getTripExpenses`. Each needs `home_amount_cents` in the select and `?? ` at the use:

`src/lib/trips/actions.ts`, `loadTripBalance` (~line 296):

```ts
    .select("amount_cents, home_amount_cents, paid_by, is_settlement")
```

```ts
  for (const e of expenseRows ?? []) {
    const cents = e.home_amount_cents ?? e.amount_cents
    if (e.is_settlement) {
      if (e.paid_by === a) aTransfers += cents
      else if (e.paid_by === b) bTransfers += cents
    } else {
      if (e.paid_by === a) aPaid += cents
      else if (e.paid_by === b) bPaid += cents
    }
  }
```

`src/lib/trips/list-queries.ts` (~line 102):

```ts
      .select("trip_id, amount_cents, home_amount_cents")
```

```ts
      spentByTrip[e.trip_id] =
        (spentByTrip[e.trip_id] ?? 0) + (e.home_amount_cents ?? e.amount_cents)
```

`src/lib/trips/budget-history-queries.ts` (~lines 18–64): add `home_amount_cents: number | null` to `interface ExpenseRow`, add it to the `.select(...)`, and build `ExpenseSpend` with `amountCents: r.home_amount_cents ?? r.amount_cents`.

- [ ] **Step 5: Fix the two in-memory sums over `Expense[]`**

`src/lib/journal/journal-types.ts` — replace `e.amountCents` with `homeCents(e)` at the category rollup (~line 101) and the per-expense row (~line 143). Import `homeCents` from `@/lib/trips/expense-types`. Leave the `preTripItems` sums alone: those come from `trip_budget_items`, a planning table already in the trip's currency.

`src/app/trips/[slug]/budget-tab.tsx` (~line 260):

```ts
      out[e.category] = (out[e.category] ?? 0) + homeCents(e)
```

`src/app/on-the-road/page.tsx` (~line 67):

```ts
    .reduce((sum, e) => sum + homeCents(e), 0)
```

- [ ] **Step 6: Prove no bare reader remains**

```bash
grep -rn 'amountCents' src/ --include=*.ts --include=*.tsx | grep -iv 'budgetitem\|budget-item\|budget-drafter\|budget-scope\|savings\|move\|journal-queries\|preTrip\|amountEuros'
```

Read every remaining hit and confirm each is either a planning-table amount (`trip_budget_items`, `savings_contributions`, `budget_moves`, `itinerary_locations.budget_cents`) or an `Expense` field feeding `homeCents`. There must be no expense **totalling** left that uses bare `amountCents`. Note that `ledger-row.tsx` still displays `expense.amountCents` directly — that is correct, it is the fact being shown, not a total.

- [ ] **Step 7: Lint and build**

```bash
pnpm lint && pnpm build
```

Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib src/app
git commit -m "feat(expenses): every total reads the home amount"
```

---

### Task 10: Location currency

**Files:**
- Modify: `src/lib/trips/location-types.ts`
- Modify: `src/lib/trips/location-queries.ts`
- Modify: `src/lib/trips/actions.ts` (`renameItineraryLocation`, ~line 2885; `setLocationSpanWithShift`, ~line 2967)
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (rename form, ~lines 560–640 and the JSX at ~830–850)

**Interfaces:**
- Consumes: the `itinerary_locations.currency` column from Task 1.
- Produces: `ItineraryLocation.currency: string | null`; `renameItineraryLocation(locationId, tripId, tripSlug, name, startDate, endDate, currency)`.

- [ ] **Step 1: Extend the location type**

In `src/lib/trips/location-types.ts`:

```ts
export interface ItineraryLocation {
  id: string
  name: string
  sortOrder: number
  startDate: string | null
  endDate: string | null
  budgetCents: number | null
  /** What you spend here; null = the trip's currency. Pre-fills the expense
   * form only -- it never changes how anything is totalled. */
  currency: string | null
}
```

Add `currency?: string | null` to `ItineraryLocationRow` and `currency: row.currency ?? null,` to `rowToLocation`.

- [ ] **Step 2: Select it**

In `src/lib/trips/location-queries.ts`, append `, currency` to every `itinerary_locations` select. Find them with:

```bash
grep -n 'select(' src/lib/trips/location-queries.ts
```

- [ ] **Step 3: Accept it on rename**

In `src/lib/trips/actions.ts`, add a seventh parameter to `renameItineraryLocation`:

```ts
export async function renameItineraryLocation(
  locationId: string,
  tripId: string,
  tripSlug: string,
  name: string,
  startDate: string | null,
  endDate: string | null,
  currency: string | null,
): Promise<RenameLocationResult> {
```

Validate it right after the name check:

```ts
  if (currency !== null && !currencyOptions().some((o) => o.code === currency)) {
    return { error: "Unknown currency." }
  }
```

and add `currency,` to the `itinerary_locations` update payload in that function. Do the same for `setLocationSpanWithShift`, which the rename flow calls on the push path — it must carry the currency through or a confirmed push would silently drop the edit. (See the project memory on tracing the write path: the itinerary actions re-shape their payloads and drop new fields.)

- [ ] **Step 4: Add the select to the rename form**

In `src/app/trips/[slug]/itinerary-tab.tsx`:

Add state beside `renameStart` / `renameEnd` (~line 567):

```ts
  const [renameCurrency, setRenameCurrency] = React.useState<string>("")
```

Seed it wherever `renameStart` / `renameEnd` are seeded when a rename opens: `setRenameCurrency(location.currency ?? "")`.

In `submitRename`, pass it through both calls:

```ts
      const result = await renameItineraryLocation(
        locationId,
        tripId,
        tripSlug,
        name,
        useSpan ? start : null,
        useSpan ? end : null,
        renameCurrency || null,
      )
```

and identically in the `setLocationSpanWithShift(...)` call inside the `needsPush` branch.

Add the control after the two date inputs (~line 845):

```tsx
                          <select
                            value={renameCurrency}
                            onChange={(e) => setRenameCurrency(e.target.value)}
                            className="mt-2 block w-full rounded-lg border border-rule bg-transparent px-2 py-1.5 font-mono text-[11px] text-foreground"
                          >
                            <option value="">Trip currency</option>
                            {currencyOptions().map((o) => (
                              <option key={o.code} value={o.code}>
                                {o.label}
                              </option>
                            ))}
                          </select>
```

Import `currencyOptions` from `@/lib/fx/currency-list`.

- [ ] **Step 5: Lint and build**

```bash
pnpm lint && pnpm build
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/trips "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): optional per-location currency"
```

---

### Task 11: The entry chip

**Files:**
- Create: `src/app/trips/[slug]/currency-chip.tsx`

**Interfaces:**
- Consumes: `useCurrency()` (Task 6), `inverseRate`/`toHomeCents` (Task 2), `money` (Task 3), `currencyOptions` (Task 3).
- Produces: `<CurrencyChip value={string} onChange={(code: string) => void} amount={string} tripCurrencies={string[]} />`, rendering nothing at all when `value === currency`.

- [ ] **Step 1: Write the chip**

Create `src/app/trips/[slug]/currency-chip.tsx`:

```tsx
"use client"

import * as React from "react"

import { useCurrency } from "@/components/currency-context"
import { currencyOptions } from "@/lib/fx/currency-list"
import { inverseRate, toHomeCents } from "@/lib/fx/convert"
import { money } from "@/lib/money"

export interface CurrencyChipProps {
  /** The currency the amount is being entered in. */
  value: string
  onChange: (code: string) => void
  /** The raw amount field text, for the live preview. */
  amount: string
  /** Currencies any location on this trip uses, for the shortlist. */
  tripCurrencies: string[]
  disabled?: boolean
}

/**
 * Currency selector plus a live home-currency preview, for the three expense
 * entry forms.
 *
 * Renders **nothing** when the amount is already in the trip's currency, so a
 * DKK expense on a DKK trip pays no UI cost for a feature it is not using. The
 * preview is arithmetic on a rate table already in memory, not a request -- and
 * it is a preview only: the server action recomputes authoritatively at save,
 * so a stale client cannot write a bad rate.
 */
export function CurrencyChip({
  value,
  onChange,
  amount,
  tripCurrencies,
  disabled,
}: CurrencyChipProps) {
  const { currency, rates } = useCurrency()

  // No rates means no honest conversion, so the trip currency is the only
  // offer -- and if that is all there is, there is nothing to pick.
  const codes = React.useMemo(() => {
    if (!rates) return [currency]
    const near = [currency, ...tripCurrencies.filter((c) => c !== currency)]
    const rest = currencyOptions()
      .map((o) => o.code)
      .filter((c) => !near.includes(c) && rates[c] !== undefined)
    return [...near, ...rest]
  }, [rates, currency, tripCurrencies])

  if (value === currency && codes.length === 1) return null

  const foreignPerHome = rates?.[value]
  const amountNum = Number(amount)
  const previewCents =
    value !== currency && foreignPerHome && Number.isFinite(amountNum) && amountNum > 0
      ? toHomeCents(Math.round(amountNum * 100), inverseRate(foreignPerHome))
      : null

  return (
    <div className="flex flex-col gap-0.5">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label="Currency"
        className="w-[4.5rem] shrink-0 rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-foreground"
      >
        {codes.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      {previewCents === null ? null : (
        <span className="font-mono text-[10px] text-muted-foreground">
          ~ {money(previewCents, currency)}
        </span>
      )}
    </div>
  )
}
```

A native `<select>` handles the "tap to open" behaviour, so the chip needs no open/closed state. (Keeping the trip currency and the trip's location currencies at the top of the option list is what the spec's "then a search field for the rest" asks for; a native select's type-ahead is the search.)

- [ ] **Step 2: Verify the chip's arithmetic path by hand**

The chip has no separate test surface. Confirm by reading: with `rates.THB = 5.122502` and `value = "THB"`, `inverseRate(5.122502) ≈ 0.1952171` and `toHomeCents(50000, 0.1952171) = 9761`, so a typed `500` shows `~ kr 97.61`. This matches the spec's worked example and Task 2's verified assertion.

- [ ] **Step 3: Lint and build**

```bash
pnpm lint && pnpm build
```

Expected: both clean. Nothing renders it yet.

- [ ] **Step 4: Commit**

```bash
git add "src/app/trips/[slug]/currency-chip.tsx"
git commit -m "feat(expenses): currency chip with live home-amount preview"
```

---

### Task 12: Convert at save

**Files:**
- Modify: `src/lib/trips/actions.ts` (`LogExpenseInput`, `logExpense` ~line 223; `settleUp` ~line 348; `partialSettleUp` ~line 392; `payBudgetItem` ~line 2732)
- Modify: `src/app/trips/[slug]/expense-fields.tsx`
- Modify: `src/app/trips/[slug]/log-expense-row.tsx` (the add form that owns `ExpenseFields` state)
- Modify: `src/app/trips/[slug]/ledger-row.tsx` (the edit form that owns `ExpenseFields` state)
- Modify: `src/app/on-the-road/quick-expense.tsx`
- Modify: `src/app/trips/[slug]/event-expense.tsx`

**Interfaces:**
- Consumes: `getRates` (Task 2), `inverseRate`/`toHomeCents` (Task 2), `CurrencyChip` (Task 11), `ItineraryLocation.currency` (Task 10).
- Produces: `LogExpenseInput.currency: string`; a private `resolveHomeAmount(tripId, currency, cents)` helper in `actions.ts`.

- [ ] **Step 1: Add the server-side conversion helper**

In `src/lib/trips/actions.ts`, above `logExpense`:

```ts
/**
 * The home-currency side of an expense. Returns nulls when the expense is
 * already in the trip's currency -- that is the normal case and the reason
 * every reader uses `home_amount_cents ?? amount_cents`.
 *
 * Recomputed here rather than trusted from the client, so a stale rate table
 * in a long-open tab cannot write a bad rate.
 */
async function resolveHomeAmount(
  tripId: string,
  currency: string,
  cents: number,
): Promise<
  | { homeAmountCents: number | null; fxRate: number | null }
  | { error: string }
> {
  const supabase = await createClient()
  const { data: trip } = await supabase
    .from("trips")
    .select("currency")
    .eq("id", tripId)
    .maybeSingle()
  if (!trip) return { error: "Trip not found." }
  if (currency === trip.currency) {
    return { homeAmountCents: null, fxRate: null }
  }

  const rates = await getRates(trip.currency)
  const foreignPerHome = rates?.[currency]
  if (!foreignPerHome) {
    return { error: "No rate available for that currency right now." }
  }
  const fxRate = inverseRate(foreignPerHome)
  return { homeAmountCents: toHomeCents(cents, fxRate), fxRate }
}
```

with imports at the top of the file:

```ts
import { getRates } from "@/lib/fx/get-rates"
import { inverseRate, toHomeCents } from "@/lib/fx/convert"
```

- [ ] **Step 2: Use it in `logExpense`**

Add `currency: string` to `LogExpenseInput`, and in `logExpense` replace the insert:

```ts
  const home = await resolveHomeAmount(input.tripId, input.currency, cents)
  if ("error" in home) return { error: home.error }

  const { error } = await supabase.from("expenses").insert({
    trip_id: input.tripId,
    title,
    amount_cents: cents,
    currency: input.currency,
    home_amount_cents: home.homeAmountCents,
    fx_rate: home.fxRate,
    paid_by: input.paidBy,
    category: input.category,
    day_date: input.dayDate,
    location_id: input.locationId,
    is_settlement: false,
  })
```

- [ ] **Step 3: Fix the three other expense inserts**

`settleUp` (~line 348), `partialSettleUp` (~line 392) and `payBudgetItem` (~line 2732) each hardcode `currency: "EUR"`. All three write amounts that are **already** in the trip's currency — a settlement is computed from home amounts, and a budget item is a planning row. So each takes the trip's currency and leaves the home fields null. Replace the literal in each with a lookup:

```ts
  const { data: tripRow } = await supabase
    .from("trips")
    .select("currency")
    .eq("id", tripId)
    .maybeSingle()
```

and `currency: tripRow?.currency ?? "EUR"` in the insert. (In `payBudgetItem` the id is `item.trip_id`.) The `"EUR"` fallback is a default value, which the spec permits.

- [ ] **Step 4: Thread the currency through `ExpenseFields`**

Add to `ExpenseFieldsProps`:

```ts
  currency: string
  onCurrencyChange: (value: string) => void
  /** Currencies used by locations on this trip, for the chip's shortlist. */
  tripCurrencies: string[]
```

Replace the static euro span (currently `{currencySymbol(currency)}` after Task 7) in the Amount field with the chip:

```tsx
          <div className="mt-1 flex items-baseline gap-1.5 border-b border-rule pb-1 focus-within:border-clay">
            <CurrencyChip
              value={currency}
              onChange={onCurrencyChange}
              amount={amount}
              tripCurrencies={tripCurrencies}
              disabled={disabled}
            />
            <input … unchanged … />
          </div>
```

`CurrencyChip` returns `null` when the currency is the trip's own, so the field falls back to exactly today's layout. Keep the `currencySymbol(currency)` span, rendered only when the chip is hidden — i.e. render `{currency === tripCurrency ? <span …>{currencySymbol(currency)}</span> : null}` beside the chip, so a home-currency field still shows its symbol. Read `tripCurrency` from `useCurrency()` inside `ExpenseFields`.

The chip must not push the amount field out of the form on a phone: it is `w-[4.5rem] shrink-0` and the input is `w-full` inside a flex row, so the input absorbs the remainder.

- [ ] **Step 5: Wire the three entry forms**

Each form owns the state and passes it down. The default is the location's currency, falling back to the trip's.

`src/app/trips/[slug]/log-expense-row.tsx` (add form) — add:

```ts
  const { currency: tripCurrency } = useCurrency()
  const [currency, setCurrency] = React.useState(tripCurrency)
```

and re-derive when the chosen location changes. Because a `useEffect` that resets local state is banned by the project's React 19 rules, key the whole form on the location instead — the parent already re-keys forms this way elsewhere in this file. Seed from `locations.find((l) => l.id === locationId)?.currency ?? tripCurrency`.

Pass `currency`, `onCurrencyChange={setCurrency}`, and `tripCurrencies={Array.from(new Set(locations.map((l) => l.currency).filter(Boolean) as string[]))}` into `ExpenseFields`, and `currency` into the `logExpense({...})` call.

`src/app/trips/[slug]/ledger-row.tsx` (`LedgerRowEditor`) — same, seeded from `expense.currency`, passed into the `updateExpense({...})` call (Task 13 completes that action).

`src/app/on-the-road/quick-expense.tsx` — no `ExpenseFields`; render `<CurrencyChip>` directly beside the amount input, seeded from the current location's currency. The page must pass `locationCurrency` down: in `src/app/on-the-road/page.tsx`, `todayDay?.locationId` already resolves a location, so pass `locations.find((l) => l.id === todayDay?.locationId)?.currency ?? null`.

`src/app/trips/[slug]/event-expense.tsx` — same, seeded from the `locationId` prop it already receives; the parent passes the location list or just its currency.

- [ ] **Step 6: Prove the write path end to end by reading it**

Trace and confirm, in writing, for each of the four forms: form state → `logExpense`/`updateExpense` argument → `resolveHomeAmount` → the insert object → the column. This is the project's standing rule for expense writes — the actions re-shape their payloads and silently drop new fields.

- [ ] **Step 7: Lint and build**

```bash
pnpm lint && pnpm build
```

Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/trips/actions.ts src/app
git commit -m "feat(expenses): enter an expense in any currency, converted at save"
```

- [ ] **Step 9: Hand over for in-app verification**

Report: *"Slice 3 implemented; build and lint clean; unverified in app."* Checklist:

1. Set a location's currency to THB; adding an expense from that location pre-fills THB without any tapping.
2. Typing `500` in a THB field shows a live `~ kr 97.61` beneath it that updates per keystroke without lag.
3. On a trip whose currency matches the expense, the currency chip and the preview are absent — the form looks unchanged.
4. The saved ledger row's amount contributes the converted figure to the trip total.
5. On a phone viewport, the chip does not push the amount field out of the expense form.

---

## Slice 4 — Correction

### Task 13: Correcting the home amount

**Files:**
- Modify: `src/lib/trips/actions.ts` (`UpdateExpenseInput`, `updateExpense` ~line 424)

**Interfaces:**
- Consumes: `rateFromAmounts`, `toHomeCents` (Task 2); `resolveHomeAmount` (Task 12).
- Produces: `UpdateExpenseInput.currency: string`, `UpdateExpenseInput.homeAmount: string | null`; `setExpenseConfirmed(expenseId, tripSlug, confirmed): Promise<{ error?: string }>`.

The rule the spec sets, restated as the branch table this step implements:

| What the user changed | `home_amount_cents` | `fx_rate` | `home_amount_confirmed` |
|---|---|---|---|
| Nothing about money | unchanged | unchanged | unchanged |
| The **home** amount | the typed value | back-computed from the two amounts | set `true` |
| The **foreign** amount, row already has an `fx_rate` | recomputed at the **row's stored rate** | unchanged | unchanged |
| The **foreign** amount or currency, no stored rate | fetched fresh via `resolveHomeAmount` | today's rate | unchanged |

Recomputing at the stored rate is the whole point: `fx_rate` means *"the rate that applied to this transaction"*, not *"the market rate that day"*, so a correction (a flat ATM fee absorbed into one expense) survives a later unrelated edit with no extra column.

- [ ] **Step 1: Extend the input and the action**

In `src/lib/trips/actions.ts`:

```ts
export interface UpdateExpenseInput {
  expenseId: string
  tripSlug: string
  title: string
  amount: string
  /** The currency the amount was paid in. */
  currency: string
  /** The corrected home amount as typed, or null to leave it derived. */
  homeAmount: string | null
  category: string
  paidBy: string
  dayDate: string | null
  locationId: string | null
}
```

In `updateExpense`, after the existing `cents` validation and before the `.update(...)`:

```ts
  const { data: existing } = await supabase
    .from("expenses")
    .select("trip_id, amount_cents, currency, fx_rate, home_amount_cents")
    .eq("id", input.expenseId)
    .maybeSingle()
  if (!existing) return { error: "Expense not found." }

  const storedRate = existing.fx_rate === null ? null : Number(existing.fx_rate)

  let homePatch: {
    home_amount_cents: number | null
    fx_rate: number | null
    home_amount_confirmed?: boolean
  }

  if (input.homeAmount !== null) {
    // The user typed what it really cost. That figure is the truth and the
    // rate is whatever reconciles the two -- fees included.
    const homeNum = Number(input.homeAmount)
    if (!Number.isFinite(homeNum) || homeNum <= 0) {
      return { error: "Home amount must be greater than zero." }
    }
    const homeCentsTyped = Math.round(homeNum * 100)
    if (homeCentsTyped >= MAX_AMOUNT_CENTS) {
      return { error: "Amount out of range." }
    }
    homePatch = {
      home_amount_cents: homeCentsTyped,
      fx_rate: rateFromAmounts(cents, homeCentsTyped),
      home_amount_confirmed: true,
    }
  } else if (storedRate !== null && input.currency === existing.currency) {
    // Foreign amount changed on a row that already has a rate: hold the rate.
    homePatch = {
      home_amount_cents: toHomeCents(cents, storedRate),
      fx_rate: storedRate,
    }
  } else {
    const home = await resolveHomeAmount(existing.trip_id, input.currency, cents)
    if ("error" in home) return { error: home.error }
    homePatch = {
      home_amount_cents: home.homeAmountCents,
      fx_rate: home.fxRate,
    }
  }
```

and extend the update payload:

```ts
    .update({
      title,
      amount_cents: cents,
      currency: input.currency,
      ...homePatch,
      paid_by: input.paidBy,
      category: input.category,
      day_date: input.dayDate,
      location_id: input.locationId,
    })
```

Import `rateFromAmounts` alongside the existing `toHomeCents` / `inverseRate` import.

- [ ] **Step 2: Add the standalone confirm toggle**

The checkbox must be tappable inline in the ledger without opening the row, so it needs its own action. Add to `src/lib/trips/actions.ts`:

```ts
/**
 * Marks an expense as checked against the bank (or unmarks it). Touches no
 * amount -- the numbers were already real; the flag is honesty about where
 * they came from.
 */
export async function setExpenseConfirmed(
  expenseId: string,
  tripSlug: string,
  confirmed: boolean,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("expenses")
    .update({ home_amount_confirmed: confirmed })
    .eq("id", expenseId)
  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}
```

- [ ] **Step 3: Verify the branch arithmetic**

```bash
node -e "import('./src/lib/fx/convert.ts').then(m => {
  // Correction: paid THB 500, bank charged kr 101.20 -> rate absorbs the fee.
  const r = m.rateFromAmounts(50000, 10120)
  console.assert(Math.abs(r - 0.2024) < 1e-9, 'rate ' + r)
  // A later edit of the foreign amount to THB 600 holds that rate.
  console.assert(m.toHomeCents(60000, r) === 12144, m.toHomeCents(60000, r))
  console.log('correction ok', r, m.toHomeCents(60000, r))
})"
```

Expected: `correction ok 0.2024 12144`. This is success criterion 7 — the recomputation uses the row's stored rate, not today's market rate.

- [ ] **Step 4: Lint and build**

```bash
pnpm lint && pnpm build
```

Expected: both clean. `ledger-row.tsx` will need `currency` and `homeAmount` in its `updateExpense` call — pass `homeAmount: null` for now; Task 14 adds the field.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/actions.ts "src/app/trips/[slug]/ledger-row.tsx"
git commit -m "feat(expenses): correct the home amount and back-compute the rate"
```

---

### Task 14: Both amounts, the tick, and the `~`

**Files:**
- Modify: `src/app/trips/[slug]/ledger-row.tsx`
- Modify: `src/app/trips/[slug]/budget-figures.tsx` (~line 150)
- Modify: `src/app/trips/[slug]/budget-tab.tsx` (to compute and pass the flag)

**Interfaces:**
- Consumes: `isForeign`, `homeCents` (Task 9); `setExpenseConfirmed` (Task 13); `money` (Task 3); `useCurrency` (Task 6).
- Produces: `BudgetFigures` gains `hasUnconfirmed: boolean`.

The spec's framing, which governs every choice here: **an unconfirmed expense is not a placeholder.** `home_amount_cents` is populated from the moment of save and is summed identically to a confirmed row. Nothing is blocked, pending, or rendered as `—`. The `~` and the tick are honesty, not state: they mean "this came from a mid-market rate, not from your bank."

- [ ] **Step 1: Show both amounts in `LedgerRowView`**

Replace the single amount block (~line 165):

```tsx
      <div className="flex flex-col items-end gap-1">
        <div className="t-num text-[15px] text-foreground">
          {money(expense.amountCents, expense.currency)}
        </div>
        {foreign ? (
          <button
            type="button"
            onClick={toggleConfirmed}
            disabled={isPending}
            aria-pressed={expense.homeAmountConfirmed}
            aria-label={
              expense.homeAmountConfirmed
                ? "Confirmed against your bank"
                : "Converted at a mid-market rate; tap to confirm"
            }
            className="t-num border-0 bg-transparent p-0 text-[12px] text-muted-foreground hover:text-foreground"
          >
            {expense.homeAmountConfirmed ? "✓" : "~"}{" "}
            {money(homeCents(expense), currency)}
          </button>
        ) : null}
        …existing edit/delete buttons unchanged…
      </div>
```

with, at the top of `LedgerRowView`:

```ts
  const { currency } = useCurrency()
  const foreign = isForeign(expense, currency)

  function toggleConfirmed() {
    if (isPending) return
    startTransition(async () => {
      const result = await setExpenseConfirmed(
        expense.id,
        tripSlug,
        !expense.homeAmountConfirmed,
      )
      if (result.error) setError(result.error)
    })
  }
```

A home-currency row renders exactly as it does today: `foreign` is false, so no second line and no marker.

- [ ] **Step 2: Add the home-amount field to `LedgerRowEditor`**

Add state and the field, shown only for a foreign row:

```ts
  const { currency } = useCurrency()
  const [expenseCurrency, setExpenseCurrency] = React.useState(expense.currency)
  const [homeAmount, setHomeAmount] = React.useState(
    expense.homeAmountCents === null ? "" : moneyInput(expense.homeAmountCents),
  )
```

```tsx
      {expenseCurrency === currency ? null : (
        <label className="mt-3 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            What it cost you
          </span>
          <div className="mt-1 flex items-baseline gap-1.5 border-b border-rule pb-1 focus-within:border-clay">
            <span className="font-mono text-[14px] text-muted-foreground">
              {currencySymbol(currency)}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={homeAmount}
              onChange={(e) => setHomeAmount(e.target.value)}
              placeholder="0.00"
              disabled={isPending}
              className="t-num w-full border-0 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
            />
          </div>
          <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
            Set this from your bank statement and we will keep this row&apos;s rate.
          </span>
        </label>
      )}
```

In `submit`, send it only when the user actually changed it — an untouched field must not flip `home_amount_confirmed`:

```ts
      const originalHome =
        expense.homeAmountCents === null
          ? ""
          : moneyInput(expense.homeAmountCents)
      const result = await updateExpense({
        expenseId: expense.id,
        tripSlug,
        title: title.trim(),
        amount,
        currency: expenseCurrency,
        homeAmount: homeAmount === originalHome ? null : homeAmount,
        category,
        paidBy,
        dayDate,
        locationId,
      })
```

- [ ] **Step 3: Add the `~` to the trip's spent figure**

In `src/app/trips/[slug]/budget-tab.tsx`, compute:

```ts
  const hasUnconfirmed = expenses.some(
    (e) => !e.isSettlement && isForeign(e, currency) && !e.homeAmountConfirmed,
  )
```

and pass it to `BudgetFigures`. In `src/app/trips/[slug]/budget-figures.tsx`, add `hasUnconfirmed: boolean` to the props and render (~line 150):

```tsx
          {hasUnconfirmed ? "~" : null}
          {money(spentCents, currency)}
```

One character, no new layout, and the headline number stops overclaiming.

- [ ] **Step 4: Lint and build**

```bash
pnpm lint && pnpm build
```

Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/trips/[slug]"
git commit -m "feat(expenses): reconcile a foreign expense against the bank"
```

- [ ] **Step 6: Hand over for in-app verification**

Report: *"Slice 4 implemented; build and lint clean; unverified in app."* Checklist:

1. The saved ledger row shows both `THB 500` and the converted amount.
2. Editing the home amount to a bank-statement figure updates the trip total and the settle-up figure immediately, and the row's `~` becomes a tick.
3. Tapping the tick inline in the ledger confirms a row without opening it.
4. The trip's spent figure carries `~` while any unconfirmed foreign expense exists, and loses it once all are confirmed.
5. Settle-up on a mixed-currency trip shows a single number in the trip's currency.
6. Two `฿500` dinners a week apart may show different home amounts. That is correct — each row froze its own rate — but check it reads as intended rather than as a bug.

---

## Slice 5 — History and AI

### Task 15: Cross-trip normalisation in /profile

Once `trips.currency` varies, `budget-history.tsx` sums kroner with euros. It is only correct today because everything is EUR.

**Files:**
- Modify: `src/lib/trips/budget-history-queries.ts`
- Modify: `src/app/profile/budget-history.tsx`
- Modify: `src/app/profile/page.tsx`

**Interfaces:**
- Consumes: `getRates` (Task 2), `TripListItem.currency` (Task 4), `CurrentWorkspace.currency` (Task 4).
- Produces: `getProfileBudgetData(trips, workspaceCurrency)` returning the existing shape with every figure already in `workspaceCurrency`, plus `convertedTripCount: number`.

One conversion **per trip**, not per expense. Stored values are untouched — opening Thailand still shows DKK. Only the comparison view normalises, which is exactly where a shared unit is required.

- [ ] **Step 1: Normalise in the query layer**

In `src/lib/trips/budget-history-queries.ts`, change `getTripRollups` to take the workspace currency and scale each trip's rollup:

```ts
export async function getTripRollups(
  trips: TripListItem[],
  workspaceCurrency: string,
): Promise<TripRollupInput[]> {
```

After building `expByTrip` / `itemsByTrip` and before the final `map`, fetch one rate table and build a per-trip multiplier:

```ts
  // Display-only normalisation: a cross-trip average has to be in one unit.
  // Today's rate, applied once per trip, never written back.
  const foreign = new Set(
    dated.map((t) => t.currency).filter((c) => c !== workspaceCurrency),
  )
  const rates = foreign.size > 0 ? await getRates(workspaceCurrency) : null
  function toWorkspace(cents: number, tripCurrency: string): number {
    if (tripCurrency === workspaceCurrency) return cents
    const foreignPerHome = rates?.[tripCurrency]
    if (!foreignPerHome) return cents
    return toHomeCents(cents, inverseRate(foreignPerHome))
  }
```

Scale at the leaf, as each row is bucketed. That keeps `perCategoryRollup` and `buildTripBudgetSummary` completely untouched:

```ts
  const currencyByTrip = new Map(dated.map((t) => [t.id, t.currency]))

  const expByTrip = new Map<string, ExpenseSpend[]>()
  for (const r of expRows ?? []) {
    const arr = expByTrip.get(r.trip_id) ?? []
    arr.push({
      category: r.category,
      amountCents: toWorkspace(
        r.home_amount_cents ?? r.amount_cents,
        currencyByTrip.get(r.trip_id) ?? workspaceCurrency,
      ),
      isSettlement: r.is_settlement,
    })
    expByTrip.set(r.trip_id, arr)
  }

  const itemsByTrip = new Map<string, PlannedSpend[]>()
  for (const r of itemRows ?? []) {
    const arr = itemsByTrip.get(r.trip_id) ?? []
    arr.push({
      category: r.category,
      amountCents: toWorkspace(
        r.amount_cents,
        currencyByTrip.get(r.trip_id) ?? workspaceCurrency,
      ),
    })
    itemsByTrip.set(r.trip_id, arr)
  }
```

`trip_budget_items` rows carry no home amount — they are planning figures already in the trip's currency, so they scale by the same per-trip multiplier and nothing else.

- [ ] **Step 2: Report what was converted**

Change `getProfileBudgetData` to accept the workspace currency, pass it through, and add to its return:

```ts
    /** How many trips were recorded in another currency and converted for this view. */
    convertedTripCount: dated.filter((t) => t.currency !== workspaceCurrency).length,
```

(Lift `dated` out of `getTripRollups` or recompute it — a trip is "dated" when it has both a start and an end date.)

- [ ] **Step 3: Name the unit in the UI**

In `src/app/profile/page.tsx`, pass `workspace.currency` into `getProfileBudgetData` and down to `BudgetHistory`. In `src/app/profile/budget-history.tsx`, add a line under the section heading:

```tsx
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
        All figures in {currency}
        {convertedTripCount > 0
          ? `, including ${convertedTripCount} trip${convertedTripCount === 1 ? "" : "s"} recorded in another currency`
          : null}
        .
      </p>
```

- [ ] **Step 4: Lint and build**

```bash
pnpm lint && pnpm build
```

Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/budget-history-queries.ts src/app/profile
git commit -m "feat(profile): normalise cross-trip budget history to the workspace currency"
```

---

### Task 16: The AI prompts

Seven strings hardcode `EUR`. These feed Claude, so a wrong unit means the model reasons and answers in the wrong money.

**Files:**
- Modify: `src/lib/ai/suggestion-actions.ts` (5, at lines 18, 72, 77, 158)
- Modify: `src/lib/nudges/near-daily-cap.ts` (2, at lines 4, 15)
- Modify: `src/lib/ai/agents/budget-planner.ts` (1, at line 39)

**Interfaces:**
- Consumes: `TripHeader.currency` (Task 4).
- Produces: no new exports; each of the three modules takes a currency code from its caller.

Every budget figure handed to the model is a **home** amount, so the model never sees a mixed-currency list — one code labels the whole prompt.

- [ ] **Step 1: `suggestion-actions.ts`**

Replace the module-level helper:

```ts
const EUR = (cents: number) => `EUR ${Math.round(cents / 100)}`
```

with a currency-taking one:

```ts
const amount = (cents: number, currency: string) =>
  `${currency} ${Math.round(cents / 100)}`
```

and update the four call sites (lines 72, 77, 158) to pass the trip's currency. Each of these functions already has the trip in scope — check what it holds and thread `trip.currency` in; if a function only receives `plannedBudgetCents`, add a `currency: string` parameter and pass it from the caller.

- [ ] **Step 2: `near-daily-cap.ts`**

Same substitution. `detectNearDailyCap` takes an input object — add `currency: string` to it and use it in the message:

```ts
    text: `You've spent ${amount(spentTodayCents, currency)} of today's ~${amount(dailyCap, currency)} budget.`,
```

Its one caller is `src/app/on-the-road/page.tsx`, which has `trip.currency` in scope.

- [ ] **Step 3: `budget-planner.ts`**

Line 39 builds `- ${line(p)} = EUR ${p.amountEuros}`. Replace `EUR` with the currency the function is given; add a `currency: string` parameter if it does not have one, threaded from its caller in `src/lib/ai/budget-actions.ts`.

Note the field is named `amountEuros`. Renaming it is out of scope for this task and touches the AI tool schema; leave the name and only fix the emitted unit label. Add a one-line comment at its declaration noting it is trip-currency units despite the name.

- [ ] **Step 4: Prove no stale unit remains**

```bash
grep -rn '\bEUR\b' src/
```

Expected: only the `"EUR"` default fallbacks in `src/lib/trips/actions.ts` (Task 12, step 3) and the `currency: "EUR"` context default in `src/components/currency-context.tsx` — both defaults, which the spec permits. No prompt string.

- [ ] **Step 5: Lint and build**

```bash
pnpm lint && pnpm build
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai src/lib/nudges src/app/on-the-road
git commit -m "feat(ai): prompts carry the trip's currency"
```

---

### Task 17: Docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/superpowers/specs/2026-07-30-multi-currency-design.md` (status line)

- [ ] **Step 1: Update `docs/TODO.md`**

Mark the multi-currency slices *implemented* (not *verified in-app*). Follow whatever the file's existing split is; do not restructure it.

- [ ] **Step 2: Append the non-obvious choices to `docs/DECISIONS.md`**

Add rows, matching the file's existing column format, for:

- Currency is copied downward at creation (workspace → trip → location), never looked up live, so a recorded trip's numbers are immutable when the workspace setting changes.
- `fx_rate` stores **home per one foreign unit** — the inverse of what the API returns.
- `fx_rate` means "the rate that applied to this transaction", not "the market rate that day", so a correction absorbs fees and survives later edits with no extra column.
- `amount_cents` is hundredths for every currency including zero-decimal ones; `Intl` handles display, so there is no per-currency minor-unit table.
- open.er-api.com over Frankfurter: 161 currencies vs ECB's 29, which has no VND, EGP or MAD.
- `/profile` normalises cross-trip figures to the workspace currency at read time, for display only.

- [ ] **Step 3: Flip the spec's status line**

Change `Status: designed, not implemented` to `Status: implemented 2026-07-30; in-app verification pending`.

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs: record multi-currency decisions and progress"
```

- [ ] **Step 5: Final hand-over**

Report: *"All five slices implemented; build and lint clean; unverified in app."* Give the user the full spec checklist (`docs/superpowers/specs/2026-07-30-multi-currency-design.md`, "Verified by the user in-app", items 1–12).

---

## Verification summary

Mapping the spec's "Verified by Claude" criteria to where this plan discharges each:

| # | Criterion | Where |
|---|---|---|
| 1 | `pnpm build` / `pnpm lint` clean after each slice | every task's lint-and-build step |
| 2 | Migration is idempotent | Task 1, step 2 |
| 3 | `toHomeCents(50000, 0.19521710) === 9761` | Task 2, step 2 |
| 4 | `money(50000,"JPY")` has no decimals; `"THB"` has two | Task 3, step 2 |
| 5 | Foreign save writes `currency`/`home_amount_cents`/`fx_rate`; home save writes null | Task 12, steps 1–2 and 6 |
| 6 | Editing the home amount changes `fx_rate` and sets confirmed | Task 13, step 1 |
| 7 | Foreign-amount edit recomputes at the row's stored rate | Task 13, steps 1 and 3 |
| 8 | `summarizeBudget` and the rollup read `home_amount_cents ?? amount_cents`, with no bare reader left | Task 9, steps 1–2 and 6 |
| 9 | No euro glyph or `"EUR"` literal outside a default or comment | Task 8 step 5, Task 16 step 4 |
| 10 | Changing `workspaces.currency` leaves `trips.currency` alone | Task 4, step 4 (copy, not lookup) — the user runs the before/after query |
| 11 | A trip created after the change inherits the new currency | Task 4, step 4 |

Criteria 10 and 11 need a live database, so they are checks the **user** runs in the Supabase SQL editor after Slice 2:

```sql
select slug, currency from public.trips order by created_at desc limit 5;
select currency from public.workspaces;
```

