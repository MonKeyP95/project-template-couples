# Dispatch Budget Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-trip "check budget per day / week / whole trip" setting, and a budget card in the on-the-road dispatch box that shows over/under for that period, replacing `PaceLine`.

**Architecture:** One new `trips.budget_period` column, written by `createTrip`/`updateTrip`. A pure `periodCheck` reads the per-day plan/spend that `budgetPace` already computes (exposed as a serialisable `byDay` array) and returns one figure; the server page computes it and passes a plain object to a new `BudgetCard` rendered by `DispatchBox` after weather.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (SQL pasted by hand), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-11-05-dispatch-budget-card-design.md`

## Global Constraints

- Values are exactly `'day' | 'week' | 'trip'`; default `'trip'`.
- Migration must be re-runnable (if-not-exists column, drop-then-add constraint).
- Dates shown day-before-month via the existing `dayLabel` ("4 Nov").
- No emojis; sparse comments; no tests framework exists, so pure-function checks run as a throwaway `pnpm dlx tsx` script in the scratchpad, never committed.
- Do not run `pnpm build` while the dev server runs; use `pnpm exec tsc --noEmit` + `pnpm lint`.
- Client components import types from `*-types.ts` / pure modules, never from `*-queries.ts`.

## Review Focus

1. Trip shorter than 7 days or last trip-week short (e.g. day 15 of a 15-day trip): week covers only the remaining days, no out-of-range dates. Pinned in Task 3 script (15-day case).
2. Week mode with nothing logged since the week began: reads "nothing logged yet", planned/spent 0, never a fake underspend. Pinned in Task 3 script.
3. Day mode on a day with no planned share (items mode, nothing spread to today) and some spend: delta = spend, bar capped at 100, no divide-by-zero. Pinned in Task 3 script.
4. Box with no weather and no dispatch items but a budget card: box still renders with one static card. Checked by reading `DispatchBox`'s early return in Task 4.
5. Dream trip (no dates) created with "per day": saves fine; card simply never shows (pace is null). Covered by `budgetPace` returning null without dates; no extra code.

---

### Task 1: Column, type, and the write/read path

**Files:**
- Create: `supabase/migrations/20261105000002_trip_budget_period.sql`
- Create: `src/lib/trips/budget-period.ts`
- Modify: `src/lib/trips/actions.ts` (`CreateTripInput` ~798, `createTrip` ~830 row, `UpdateTripInput` ~924, `updateTrip` ~1048 patches)
- Modify: `src/lib/trips/list-queries.ts` (row type ~48, select ~85, mapping ~127)
- Modify: `src/lib/trips/queries.ts` (row type ~44, select ~63, mapping ~98)

**Interfaces:**
- Produces: `export type BudgetPeriod = "day" | "week" | "trip"`, `export const BUDGET_PERIODS: readonly BudgetPeriod[]`, `export function isBudgetPeriod(v: string): v is BudgetPeriod` in `budget-period.ts`. `CreateTripInput.budgetPeriod: BudgetPeriod`; `UpdateTripInput.budgetPeriod: BudgetPeriod`; `TripListItem.budgetPeriod` and the slug-query trip's `budgetPeriod: BudgetPeriod`.

- [ ] **Step 1:** Write the migration: `alter table public.trips add column if not exists budget_period text not null default 'trip';` then `drop constraint if exists trips_budget_period_check` and `add constraint trips_budget_period_check check (budget_period in ('day','week','trip'))`. Header comment like other migrations ("Idempotent: safe to paste-and-run multiple times.").
- [ ] **Step 2:** Create `budget-period.ts` with the type, `BUDGET_PERIODS = ["day", "week", "trip"]`, `isBudgetPeriod`. No imports (client-safe).
- [ ] **Step 3:** `createTrip`: reject `!isBudgetPeriod(input.budgetPeriod)` with `{ error: "Budget check invalid." }`; write `budget_period: input.budgetPeriod` in the row. `updateTrip`: same check after the currency checks; add `budget_period: input.budgetPeriod` to every trips `.update({...})` that spreads `...homePatch, ...profilePatch` (lines ~1246, ~1301, ~1361; not the ~590 one, which is a different action — confirm by reading).
- [ ] **Step 4:** Add `budget_period` to both selects and map to `budgetPeriod` (cast row type `budget_period: BudgetPeriod`).
- [ ] **Step 5:** `pnpm exec tsc --noEmit` — expected: errors only at the callers of `createTrip`/`updateTrip` (new-trip form, edit form), fixed in Task 2. Do not commit yet; Task 2 completes the compile.

### Task 2: The picker in the new-trip flow and the edit form

**Files:**
- Create: `src/components/budget-period-picker.tsx`
- Modify: `src/app/trips/new/new-trip-form.tsx` (`TripDraft`, `EMPTY_DRAFT`, `create`, NotePage props)
- Modify: `src/app/trips/new/note-page.tsx` (under the Budget `<label>`, ~line 87)
- Modify: `src/app/trips/[slug]/edit/page.tsx` (~68, pass `budgetPeriod`)
- Modify: `src/app/trips/[slug]/edit/edit-trip-form.tsx` (initial type ~52, state ~82, submit ~165, UI after the "Totals are in" label ~384)

**Interfaces:**
- Consumes: `BudgetPeriod`, `BUDGET_PERIODS` (Task 1).
- Produces: `export function BudgetPeriodPicker({ value, onChange, disabled }: { value: BudgetPeriod; onChange: (p: BudgetPeriod) => void; disabled?: boolean })`.

- [ ] **Step 1:** `BudgetPeriodPicker` (`"use client"`): a caption "Check budget" and three `type="button"` pills, labels exactly `per day` / `per week` / `whole trip`, `aria-pressed` on the selected one. Styling: rounded-full border pills in the mono-uppercase style used by the budget drafter buttons; selected pill `text-foreground border-foreground`, others muted.
- [ ] **Step 2:** New trip: `TripDraft.budgetPeriod: BudgetPeriod`, `EMPTY_DRAFT.budgetPeriod = "trip"`; NotePage gets `onBudgetPeriod: (p: BudgetPeriod) => void` (a plain `setDraft` updater, not a `DraftField`, so note re-reads never touch it); render the picker directly under the Budget label; `create` sends `budgetPeriod: draft.budgetPeriod`.
- [ ] **Step 3:** Edit: thread `budgetPeriod` from the page's trip into `initial`, hold it in state, render the picker after the "Totals are in" label with `disabled={isPending}`, send it in `updateTrip`.
- [ ] **Step 4:** `pnpm exec tsc --noEmit` and `pnpm lint` — expected: both clean.
- [ ] **Step 5:** Commit: `git add` the migration, `budget-period.ts`, `actions.ts`, both query files, the picker, and the four form/page files; message `feat(budget): per-trip budget check period, set in the new-trip flow and edit form`.

### Task 3: `periodCheck`, the pure figure

**Files:**
- Modify: `src/lib/trips/budget-pace.ts` (add `byDay` to `BudgetPace` and its return)
- Modify: `src/lib/trips/budget-period.ts` (add `PeriodCheck`, `periodCheck`)
- Test: throwaway `<scratchpad>/period-check.ts`, run with `pnpm dlx tsx`

**Interfaces:**
- Consumes: `BudgetPace` (now with `byDay: { date: string; plannedCents: number; spentCents: number }[]`, one entry per trip date in order, unrounded values from `plannedByDay`/`spentByDay`, 0 when absent).
- Produces:
  ```ts
  export interface PeriodCheck {
    period: BudgetPeriod
    plannedCents: number   // rounded
    spentCents: number     // rounded
    deltaCents: number     // spent - planned; positive = over
    asOf: string | null    // yyyy-mm-dd watermark for week/trip; null for day or nothing logged
    nothingLogged: boolean // week/trip only; always false for day
  }
  export function periodCheck(pace: BudgetPace, period: BudgetPeriod, today: string): PeriodCheck
  ```
  `budget-period.ts` imports `type BudgetPace` only (`import type`), so it stays client-safe.

Rules (from the spec):
- **day:** the `byDay` entry whose `date === today`; no watermark.
- **week:** trip-weeks; `start = floor((pace.dayIndex - 1) / 7) * 7`, days `byDay.slice(start, start + 7)`. If `pace.lastLogged` is null or before the week's first date → `nothingLogged: true`, planned/spent 0, `asOf: null`. Else sum entries with `date <= lastLogged`, `asOf = lastLogged`.
- **trip:** `pace.plannedToDateCents`, `pace.spentToDateCents`, `pace.deltaCents`, `asOf = pace.lastLogged`, `nothingLogged = pace.lastLogged === null`.

- [ ] **Step 1: Write the check script** in the scratchpad importing by absolute path from `src/lib/trips/budget-pace.ts` and `budget-period.ts`, building `budgetPace` input with `startDate "2026-11-01"`, `endDate "2026-11-10"`, `plannedBudgetCents 100000`, `budgetItems []`, `locationDays {}`, and asserting (`node:assert/strict`):
  - case A, `today "2026-11-09"`, one expense `{ category: "Food", dayDate: "2026-11-08", isSettlement: false, amountCents: 12000 }`:
    - day → `{ plannedCents: 10000, spentCents: 0, deltaCents: -10000, asOf: null, nothingLogged: false }`
    - week → `{ plannedCents: 10000, spentCents: 12000, deltaCents: 2000, asOf: "2026-11-08", nothingLogged: false }`
    - trip → `deltaCents === pace.deltaCents`
  - case B, same trip, `today "2026-11-09"`, one expense on `"2026-11-03"` only: week → `nothingLogged: true, plannedCents: 0, spentCents: 0, asOf: null`.
  - case C, 15-day trip `"2026-11-01"`–`"2026-11-15"`, `today "2026-11-15"`, expense on `"2026-11-15"`: week entries = 1 day (planned = 100000/15 rounded = 6667).
  - case D, items mode: one budget item dated `"2026-11-02"` only (`whenStart "2026-11-02"`, `freq "once"`, amount 5000), `today "2026-11-05"`, expense 3000 on `"2026-11-05"`: day → `plannedCents: 0, spentCents: 3000, deltaCents: 3000`.
- [ ] **Step 2:** Run `pnpm dlx tsx <scratchpad>/period-check.ts` — expected: fails (no `periodCheck` / no `byDay`).
- [ ] **Step 3:** Add `byDay` to `budgetPace`'s return, and implement `periodCheck` per the rules.
- [ ] **Step 4:** Rerun — expected: exits 0, prints nothing. Then `pnpm exec tsc --noEmit` clean.
- [ ] **Step 5:** Commit `budget-pace.ts`, `budget-period.ts`: `feat(budget): periodCheck reads day, trip-week or trip-to-date over/under`.

### Task 4: `BudgetCard` in the box; `PaceLine` removed

**Files:**
- Create: `src/components/budget-card.tsx`
- Modify: `src/components/dispatch-box.tsx` (props, early return ~89, `buildCards` ~125, `LiveDeck` count/pickStart ~171)
- Modify: `src/app/on-the-road/page.tsx` (~114 pace, ~204 DispatchBox, ~260 remove PaceLine, ~39 import)
- Modify: `src/components/budget-pace-strip.tsx` (delete `PaceLine` if no other user — `grep -rn PaceLine src`)

**Interfaces:**
- Consumes: `PeriodCheck`, `periodCheck` (Task 3); `trip.budgetPeriod` (Task 1).
- Produces: `export function BudgetCard({ check }: { check: PeriodCheck })`; `DispatchBox` gains prop `budget: PeriodCheck | null`.

Copy (exact; `m` = `money(Math.abs(delta), currency)` via `useCurrency`):

| period | delta < 0 | delta > 0 | delta = 0 |
|---|---|---|---|
| day | `${m} left today` | `${m} over today` | `on budget` |
| week | `${m} under this week` | `${m} over this week` | `on budget` |
| trip | `${m} under` | `${m} over` | `on budget` |

Right side (week/trip only): `as of ${dayLabel(asOf)}`. When `nothingLogged`, the left text is `nothing logged yet` (muted), there is no right side, and the bar is empty — never "on budget". Tone: `text-clay` when delta > 0, else `text-muted-foreground`. Bar: `Bar` with `pct = planned <= 0 ? (spent > 0 ? 100 : 0) : min(100, round(spent / planned * 100))`, tone clay/muted to match. Shell: same as `WeatherCard` (`rounded-lg border border-border bg-card px-3.5 py-2.5`), a `div`, not a button.

- [ ] **Step 1:** Write `BudgetCard` per the table.
- [ ] **Step 2:** `DispatchBox`: add `budget` prop; early return only when `!weather && items.length === 0 && !budget`; `buildCards` inserts `<BudgetCard key="budget" check={budget} />` right after weather; the item `offset` becomes `(weather ? 1 : 0) + (budget ? 1 : 0)`; `LiveDeck` count passed to `pickStart` includes the budget card. `pickStart`'s "first visit opens on weather" stays index 0; later visits' random pool still starts after weather (budget card is in the pool).
- [ ] **Step 3:** Road page: `const budget = pace ? periodCheck(pace, trip.budgetPeriod, today) : null`, pass `budget={budget}` to `DispatchBox`; delete the `<PaceLine .../>` line and its import; keep `pace` (catch-up nudge uses it). Remove `PaceLine` from `budget-pace-strip.tsx` if the grep shows no other user.
- [ ] **Step 4:** `pnpm exec tsc --noEmit` and `pnpm lint` — expected: clean. `grep -rn "PaceLine" src` — expected: no render on `/on-the-road`.
- [ ] **Step 5:** Commit: `feat(budget): budget card in the dispatch box replaces PaceLine on the road`.

### Task 5: Docs

**Files:**
- Modify: `docs/TODO.md` (after the budget-estimate entry: replace the "Next: budget status" bullet with an *implemented; unverified in app* entry carrying the spec's 8 in-app checks; add a separate backlog bullet: partner cannot save Home currency on `/profile` because `workspaces_update_owner` is owner-only; **paste `20261105000002_trip_budget_period.sql` first**)
- Modify: `docs/DECISIONS.md` (one row superseding the 2026-08-03 budget-card cut: the card replaces `PaceLine` so the number shows once; the period is per trip, set beside the estimate; trip-weeks not calendar weeks; day mode has no watermark)

- [ ] **Step 1:** Write both entries.
- [ ] **Step 2:** Commit: `docs: dispatch budget card`.
