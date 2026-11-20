# Trip Spend Currency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask the spend currency in the new-trip walkthrough, and open expense forms in home currency before the trip and spend currency during it.

**Architecture:** `createTrip` takes a `currency`; a pure `entryCurrency` helper picks the form default from dates and today; `CurrencyProvider` carries it to the two expense forms.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase.

**Spec:** `docs/superpowers/specs/2026-11-20-trip-spend-currency-design.md`

## Global Constraints
- No schema change, no new component, dropdown order unchanged.
- No test runner exists: pure functions are checked with a throwaway Node script in the scratchpad; everything else by `pnpm lint` + `pnpm build` (dev server must be stopped first).

## Review Focus
- Trip ending today: today === end_date must still be on the road (spend).
- Dream (no dates): always home.
- Skipped question: currency defaults to workspace currency, so spend = home and the chip renders as before.
- `spendCurrency` must keep driving the "~ local" figure; only form defaults move to `entryCurrency`.
- Unknown code posted to `createTrip` is rejected, not written.

---

### Task 1: New-trip asks the spend currency

**Files:**
- Modify: `src/lib/trips/actions.ts` (`CreateTripInput`, `createTrip`)
- Modify: `src/app/trips/new/new-trip-form.tsx` (`TripDraft`, initial draft, `create`)
- Modify: `src/app/trips/new/note-page.tsx` (select after the place block)

**Interfaces:**
- Produces: `CreateTripInput.currency: string`; `TripDraft.currency: string`.

- [ ] Add `currency: string` to `CreateTripInput`; in `createTrip` return `{ error: "Currency invalid." }` unless `currencyOptions().some(o => o.code === input.currency)`; write `currency: input.currency`, keep `home_currency: workspace.currency`.
- [ ] `TripDraft.currency`, initialised from the `currency` prop (draft state starts `{ ...EMPTY_DRAFT, currency }`); pass `currency: draft.currency` to `createTrip`.
- [ ] In `NotePage`, after the place block: a labelled `<select>` "Which currency will you pay in there?" over `currencyOptions()`, value `draft.currency`, `onDraft({ currency })`.
- [ ] `pnpm lint` clean.

### Task 2: Expense forms default by mode

**Files:**
- Create: `src/lib/fx/entry-currency.ts`
- Modify: `src/components/currency-context.tsx` (add `entryCurrency`)
- Modify: `src/app/trips/[slug]/page.tsx` (both providers), `src/app/on-the-road/page.tsx`
- Modify: `src/app/trips/[slug]/log-expense-row.tsx`, `src/app/on-the-road/quick-expense.tsx`

**Interfaces:**
- Produces: `entryCurrency(trip: { startDate: string | null; endDate: string | null; currency: string; homeCurrency: string }, today: string): string`

- [ ] Implement: spend `currency` when `startDate && startDate <= today && today <= (endDate ?? startDate)`, else `homeCurrency`.
- [ ] Check with a scratch Node script: before start -> home; start, mid, end -> spend; day after end -> home; dream -> home.
- [ ] `CurrencyProvider` gains `entryCurrency` (context default `"EUR"`); pages pass `entryCurrency(header|trip, today)`.
- [ ] Both forms default to `location?.currency ?? entryCurrency` (log-expense-row's re-prefill on location change too).
- [ ] `pnpm lint` and `pnpm build` clean; update `docs/TODO.md`; commit.
