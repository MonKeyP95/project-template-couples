# Number Format Follows Home Country Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display and typing of amounts follow the workspace home country (Denmark -> `1.234,56 kr.`, `12,50` accepted).

**Architecture:** Pure formatters in `src/lib/money.ts` take a `locale`; `countryLocale` derives it from the free-text home country. Client files get bound formatters from `useMoney()` (context mounted in the root layout); server files from `await getMoney()` or, where helpers are synchronous or the file is shared with client code, an explicit `locale` prop. One `parseAmount` reads either decimal mark.

**Tech Stack:** Next.js 16 App Router, React 19 context + `cache()`, `Intl.NumberFormat` / `Intl.DisplayNames` / `Intl.Locale`.

**Spec:** `docs/superpowers/specs/2026-11-26-number-format-home-country-design.md`

## Global Constraints

- Fallback locale is `en-GB` (blank or unmatched home country) -- output identical to today.
- No migration, no new column, no new setting.
- Inputs take no thousands separators: `1.234` parses as 1.234.
- `"use client"` files never import `money-server.ts` (it pulls `next/headers`).
- No test runner exists; pure checks run as a scratch Node script (`node` with native type stripping), not a committed test.

## Review Focus

1. Pre-filled edit fields round-trip: `moneyInput(1250, "da-DK")` -> `"12,5"`, then `parseAmount("12,5")` -> 12.5 (Task 1 check).
2. Empty field still reads as 0, not NaN: `parseAmount("")` -> 0 (Task 1 check), so existing `> 0` guards behave as before.
3. Logged-out pages (login, invite) render with `en-GB` and don't throw when there is no membership (Task 2).
4. A server component file also imported by a client file (`trip-side-cards.tsx` via `packing-mini.tsx`) must not import `money-server.ts` (Task 4).
5. Count/percentage/day inputs (`budget-drafter` count and buffer %, `day-input`) stay `type="number"` and keep `Number()` -- only money amounts change (Task 5).

---

### Task 1: Pure locale-aware money layer

**Files:**
- Modify: `src/lib/money.ts`
- Check script (not committed): `<scratchpad>/money-check.mts`

**Interfaces:**
- Produces:
  - `countryLocale(country: string): string` -- `"Denmark"`/`"denmark "`/`"DK"` -> `"da-DK"`; `""`, `"Narnia"` -> `"en-GB"`.
  - `money(cents, currency, locale = "en-GB")`, `moneyRounded(...)`, `moneyPlain(...)`, `currencySymbol(currency, locale = "en-GB")`, `moneyInput(cents, locale = "en-GB")` -- default is temporary, removed in Task 6.
  - `parseAmount(text: string): number`

- [ ] **Step 1:** Write `money-check.mts` asserting (via `node:assert`):
  - `countryLocale("Denmark") === "da-DK"`, `countryLocale("denmark ") === "da-DK"`, `countryLocale("DK") === "da-DK"`, `countryLocale("") === "en-GB"`, `countryLocale("Narnia") === "en-GB"`
  - `money(123456, "DKK", "da-DK") === "1.234,56 kr."`; `money(123456, "DKK", "en-GB") === "kr 1,234.56"` (exact strings as printed by Node; adjust NBSP to what Intl emits, confirmed once)
  - `moneyRounded(50000, "JPY", "da-DK")` has no decimals
  - `moneyInput(123456, "da-DK") === "1234,56"`, `moneyInput(1250, "da-DK") === "12,5"`, `moneyInput(123456, "en-GB") === "1234.56"`
  - `parseAmount("12,50") === 12.5`, `parseAmount(" 12.50 ") === 12.5`, `parseAmount("") === 0`
- [ ] **Step 2:** Run `node <scratchpad>/money-check.mts` -> fails (exports missing).
- [ ] **Step 3:** Implement in `money.ts`. `countryLocale`: build once a map of lowercase English region name -> code by iterating all two-letter A-Z codes through `new Intl.DisplayNames("en", { type: "region", fallback: "none" })`; match trimmed lowercase input against names, or uppercase input against codes; locale = `${new Intl.Locale("und-" + cc).maximize().language}-${cc}`. Formatter cache key becomes `locale:currency:decimals`. `moneyInput` formats `cents / 100` with `{ useGrouping: false, maximumFractionDigits: 2 }`. `parseAmount` = `Number(text.trim().replaceAll(",", "."))`.
- [ ] **Step 4:** Run the check -> passes. `pnpm lint` clean, `pnpm exec tsc --noEmit` clean (defaults keep every caller compiling).
- [ ] **Step 5:** Commit `feat: locale-aware money formatters and parseAmount`.

### Task 2: Access layer (`useMoney`, `getMoney`)

**Files:**
- Create: `src/components/money-context.tsx` (`"use client"`)
- Create: `src/lib/money-server.ts`
- Modify: `src/lib/workspace/active.ts` (wrap in `cache()`), `src/app/layout.tsx`

**Interfaces:**
- Consumes: Task 1 formatters, `countryLocale`.
- Produces:
  - `type MoneyFns = { locale: string; money(c, cur): string; moneyRounded(c, cur): string; moneyPlain(c, cur): string; moneyInput(c): string; currencySymbol(cur): string }` -- exported from `money.ts` with `bindMoney(locale: string): MoneyFns`.
  - `MoneyProvider({ locale, children })`, `useMoney(): MoneyFns` (default context = `bindMoney("en-GB")`).
  - `getMoney(): Promise<MoneyFns>` -- `countryLocale(membership?.workspace.home_country ?? "")`.

- [ ] **Step 1:** `resolveActiveMembership` becomes `export const resolveActiveMembership = cache(async () => ...)` (React `cache`), so layout + page share one query per request.
- [ ] **Step 2:** Add `bindMoney`, provider/hook, `getMoney`.
- [ ] **Step 3:** Root layout: `const { locale } = await getMoney()`; wrap children in `<MoneyProvider locale={locale}>`.
- [ ] **Step 4:** lint + tsc clean.
- [ ] **Step 5:** Commit `feat: money locale provider and getMoney`.

### Task 3: Client files use `useMoney`

**Files (all `"use client"`):** `profile/budget-history.tsx`, `trips/new/new-trip-form.tsx`, and under `trips/[slug]/`: `budget-by-category`, `budget-by-place`, `budget-drafter-pretrip`, `budget-drafter`, `budget-figures`, `budget-ledger`, `budget-move-row`, `budget-planned-list`, `budget-scope-editor`, `budget-tab`, `currency-chip`, `edit/edit-trip-form`, `expense-fields`, `itinerary-tab`, `ledger-row`, `settle-up-card`, `suggestion-dialogs`; `components/budget-card`, `budget-pace-strip`, `local-equivalent`, `receipts/receipt-pile`, `receipts/receipt-view`.

- [ ] **Step 1:** In each component that formats, replace the `@/lib/money` import with `const { money, ... } = useMoney()` at the top of the component. A module-level helper (not a component) that formats takes the needed function or `locale` as an argument from its component caller.
- [ ] **Step 2:** `grep -rn 'from "@/lib/money"'` lists none of these files (except imports of `parseAmount`).
- [ ] **Step 3:** lint + tsc clean. Commit `feat: client amounts follow home-country locale`.

### Task 4: Server files

**Files:** `home/trip-cards.tsx`, `on-the-road/road-cards.tsx`, `profile/trip-budget.tsx`, `profile/trip-journal.tsx`, `trips/[slug]/mobile-trip.tsx`, `trips/[slug]/trip-side-cards.tsx`, `lib/nudges/near-daily-cap.ts`, and their importing pages.

- [ ] **Step 1:** Exported components that format take a `locale: string` prop and call the pure formatters with it; the importing page/server component passes `(await getMoney()).locale`. Sub-helpers take `locale` as an argument. `NearDailyCapContext` gains `locale`.
- [ ] **Step 2:** `trip-side-cards.tsx` does not import `money-server.ts` (Review Focus 4).
- [ ] **Step 3:** lint + tsc clean. Commit `feat: server amounts follow home-country locale`.

### Task 5: Parsing and amount inputs

**Files:** amount reads in `on-the-road/quick-expense.tsx`, `trips/[slug]/{add-cost-box,budget-drafter-pretrip,budget-drafter,budget-figures,budget-planned-list,budget-scope-editor,currency-chip,ledger-row,log-expense-row,edit/edit-trip-form}.tsx`, `trips/new/new-trip-form.tsx`, `lib/trips/actions.ts` (lines ~289, 451, 518, 555).

- [ ] **Step 1:** Every `Number(x)` where `x` is a typed money amount becomes `parseAmount(x)`. Counts, percentages, days, `fx_rate` and DB numerics stay `Number`.
- [ ] **Step 2:** Every money `<input type="number">` becomes `type="text" inputMode="decimal"` (drop `step`/`min` attributes that only apply to number inputs). Non-money number inputs unchanged (Review Focus 5).
- [ ] **Step 3:** lint + tsc clean. Commit `feat: amount fields accept comma decimals`.

### Task 6: Remove defaults, full build, docs

- [ ] **Step 1:** Drop the `= "en-GB"` defaults from the formatters in `money.ts`; tsc must pass, proving no call site skips the locale (spec criterion 5).
- [ ] **Step 2:** Re-run `money-check.mts` (passing locales explicitly) -> passes.
- [ ] **Step 3:** Ask the user to stop the dev server; `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build` all pass.
- [ ] **Step 4:** `docs/TODO.md`: mark the `.` vs `,` backlog item implemented, with the in-app checklist from the spec. `docs/DECISIONS.md`: row for "locale from free-text home country via Intl; inputs accept either mark, no grouping".
- [ ] **Step 5:** Commit `docs: number format follows home country`.
