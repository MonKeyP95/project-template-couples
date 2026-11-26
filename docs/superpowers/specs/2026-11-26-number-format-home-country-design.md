# Number format follows home country — design

**Why.** Partner feedback (2026-11-25): numbers use `.` for decimals and `,` for
thousands everywhere, and typing `12,50` into an amount field fails silently
(`Number("12,50")` is NaN, so Save greys out or the amount drops). The couple is
Danish; numbers should read and type the Danish way.

## Goals
- Every displayed amount follows the workspace's home country (profile Basics):
  Denmark -> `1.234,56 kr.`
- Every amount field accepts `,` or `.` as the decimal mark, and pre-fills an
  edit in the couple's style (`12,50`).

## Non-goals
- No new setting, column, or migration. Home country stays free text.
- No thousands separators in inputs: `1.234` typed means 1.234, not 1234.
- AI prompt text and the trip-note amount parser (`trip-note-parse.ts`) are
  untouched.
- Dates are separate (already en-GB day-first).

## Anti-goals
- Server and client rendering different formats (hydration mismatch, flicker).
- A hand-maintained country -> locale table.

## Approaches
- **A. Locale as an argument** to `money(cents, currency, locale)` at all 72
  calls, threaded as props into client components. Explicit, but largest diff.
- **B. Read once per file (picked).** Client files: `const { money } =
  useMoney()`; server files: `const { money } = await getMoney()`. Call sites
  stay unchanged; one line per file.
- **C. Cookie read on both sides.** Rejected: client components can't read it
  during SSR, so first paint can disagree with hydration.

## The design
- **Country -> locale** (pure, in `src/lib/money.ts`): match the free-text home
  country case-insensitively against `Intl.DisplayNames("en", { type: "region" })`
  names of ISO region codes; maximize `und-<CC>` with `Intl.Locale` to get the
  language (`da-DK`). Blank or no match -> `en-GB` (today's behaviour).
- **Formatters** take the locale: `money`, `moneyRounded`, `moneyPlain`,
  `moneyInput`, `currencySymbol` are built per locale (cache key includes it).
  `narrowSymbol` and per-currency decimals stay.
- **Parsing:** one `parseAmount(text)` helper: trim, replace `,` with `.`,
  `Number()`. Replaces the bare `Number(amount)` reads on amount fields and in
  the expense server actions.
- **Inputs:** amount fields that are `type="number"` become `type="text"
  inputMode="decimal"` (a number input rejects `12,50` in most browsers).
- **Client access:** root layout resolves the active workspace's locale and
  mounts a `MoneyProvider` (context); `useMoney()` returns the bound functions.
- **Server access:** `getMoney()` resolves the locale via
  `resolveActiveMembership()` wrapped in React `cache()` so a request queries
  once. Pure lib helpers that format (e.g. `near-daily-cap.ts`) take the locale
  as an argument from their caller.

## Left to the builder
- Exact per-file split where a non-async component without `"use client"` is
  rendered inside a client tree (it gets `useMoney` or a prop, whichever fits).
- Which `Number(...)` calls are amounts vs. counts/percentages (only amounts
  switch to `parseAmount`).

## Success criteria
*Verified by Claude*
1. `pnpm lint` clean, `tsc` clean, `pnpm build` passes.
2. `countryLocale("Denmark")` -> `da-DK`; `countryLocale("denmark ")` -> `da-DK`;
   `countryLocale("")` and `countryLocale("Narnia")` -> `en-GB`.
3. `money(123456, "DKK", "da-DK")` gives `1.234,56 kr.`; with `en-GB` it is
   unchanged from today.
4. `parseAmount("12,50")` and `parseAmount("12.50")` both give 12.5.
5. No remaining direct `money*`/`currencySymbol` import that bypasses
   `useMoney`/`getMoney`/an explicit locale.

*Verified by the user in-app*
1. With home country "Denmark": trip budget, ledger, home cards, on-the-road
   cards, and profile budget history show `1.234,56 kr.` style.
2. Add an expense typing `12,50`: Save is enabled and it saves as 12.50.
3. Edit that expense: the field shows `12,50`; saving unchanged keeps 12.50.
4. Budget drafter / add-cost / budget figures fields accept `12,50`.
5. Clear home country, save: numbers return to `kr 1,234.56` style.
6. Phone width: no amount wraps or overflows where it didn't before.
