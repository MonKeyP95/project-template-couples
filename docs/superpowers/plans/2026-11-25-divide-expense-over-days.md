# Divide Expense Over Days Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Divide button in the budget add-expense form opens a calendar of trip days; saving writes one expense per picked day with the amount split evenly.

**Architecture:** Two pure helpers (split cents, default days) in one lib file; one small client calendar component; `LogExpenseRow` holds the picked days and, on save, calls the existing `logExpense` server action once per day. No migration, no new server action. `itineraryDays` (already loaded, dated rows only) is threaded to every `LogExpenseRow` call site.

**Tech Stack:** Next.js 16 App Router, React 19 client components, Tailwind v4, existing `logExpense` server action.

**Spec:** `docs/superpowers/specs/2026-11-25-divide-expense-over-days-design.md`

## Global Constraints

- No migration, no new table, no new server action (approach A).
- No test runner exists; pure functions are checked with a throwaway scratch script run by `node` (Node 24 strips TS types), not a committed test.
- Dates display `en-GB` (day before month).
- No emojis. Sparse comments. Short functions.
- Only `LogExpenseRow` changes behaviour; `ExpenseFields` (shared with the edit form) is untouched.
- Don't run `pnpm build` while the dev server may be running -- ask the user to stop it first.

## Review Focus

1. Location changed while the calendar is open -> selection resets to the new location's default days (handled in `chooseLocation`, not an effect).
2. A location with no days filed under it -> falls back to all trip days (helper test).
3. Accommodation over a single-day location -> keeps that one day, never empty (helper test).
4. Exactly one day picked -> behaves like a normal single expense on that date.
5. A receipt attached while dividing -> attaches to the first day's expense only.

---

### Task 1: Pure helpers

**Files:**
- Create: `src/lib/trips/divide-expense.ts` (no imports, so the scratch script can load it)
- Scratch: `<scratchpad>/divide-check.mts`

**Interfaces:**
- Produces:
  - `splitCents(totalCents: number, parts: number): number[]` -- `parts` values summing to `totalCents`; leftover cents go on the first entries, one each.
  - `defaultDivideDays(days: { dayDate: string; locationId: string | null }[], locationId: string | null, category: string): string[]` -- sorted dates: the location's days if `locationId` is set and has any, else all days; for `category === "Accommodation"` drop the last date when 2+ remain.

- [ ] **Step 1: Write the scratch check** importing `../../path/src/lib/trips/divide-expense.ts` by absolute path, with `node:assert`:
  - `splitCents(10000, 3)` deep-equals `[3334, 3333, 3333]`
  - `splitCents(10001, 3)` deep-equals `[3334, 3334, 3333]`
  - `splitCents(500, 1)` deep-equals `[500]`
  - days `[{d:"2026-03-12",L:"a"},{d:"2026-03-13",L:"a"},{d:"2026-03-14",L:"b"}]`:
    - location `"a"`, `"Food"` -> `["2026-03-12","2026-03-13"]`
    - location `null`, `"Food"` -> all three dates
    - location `"zzz"` (no days) -> all three dates
    - location `"a"`, `"Accommodation"` -> `["2026-03-12"]`
    - location `"b"`, `"Accommodation"` -> `["2026-03-14"]` (single day kept)
    - unsorted input returns sorted output
- [ ] **Step 2: Run** `node <scratchpad>/divide-check.mts` -- expect failure (module missing).
- [ ] **Step 3: Implement** both functions in `src/lib/trips/divide-expense.ts`, one docstring each.
- [ ] **Step 4: Run** the scratch check -- expect no output, exit 0.
- [ ] **Step 5: Commit** `feat: pure helpers for dividing an expense over days`

### Task 2: Calendar picker component

**Files:**
- Create: `src/app/trips/[slug]/divide-days-picker.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `DivideDaysPicker({ dates, selected, onChange, disabled }: { dates: string[]; selected: string[]; onChange: (next: string[]) => void; disabled: boolean })`

Behaviour: a 7-column month grid, weeks starting Monday, `en-GB` month headings (`"March 2026"`) and weekday initials. Only dates in `dates` are tappable toggle buttons (`aria-pressed`); other cells are blank. Selected days use the `bg-sea text-background` look already used by the payer pills. Below the grid: `"{n} days"` and two text buttons, `all` / `none`. `onChange` always receives a sorted array. Use `dateRange` from `@/lib/trips/itinerary-types` only if needed for padding; parse dates as UTC.

- [ ] **Step 1: Implement** the component (client, no state of its own).
- [ ] **Step 2: Run** `pnpm lint` -- expect clean.
- [ ] **Step 3: Commit** `feat: divide-days calendar picker`

### Task 3: Wire Divide into the add form

**Files:**
- Modify: `src/app/trips/[slug]/log-expense-row.tsx`
- Modify: `src/app/trips/[slug]/budget-tab.tsx:162` (pass `itineraryDays`)
- Modify: `src/app/trips/[slug]/budget-by-category.tsx` (`Props` gains `itineraryDays: DayLocation[]`; `CategoryDetail` passes it to `RowDetail`; `RowDetail` takes it and passes it to `LogExpenseRow`)
- Modify: `src/app/trips/[slug]/budget-by-place.tsx:89` (pass `itineraryDays` to `RowDetail`)

**Interfaces:**
- Consumes: `splitCents`, `defaultDivideDays` (Task 1); `DivideDaysPicker` (Task 2); `DayLocation` from `@/lib/trips/location-budget-types`.
- Produces: `LogExpenseRowProps.itineraryDays: DayLocation[]` (required).

Behaviour:
- State `divideDays: string[] | null` (null = not dividing).
- A `divide` text button sits under the fields, hidden when `itineraryDays` is empty (dreams). Tapping it sets `divideDays` to `defaultDivideDays(itineraryDays, locationId, category)`; tapping again (label `don't divide`) sets null.
- While dividing, the picker renders under the button with `dates = itineraryDays.map(d => d.dayDate)` sorted.
- `chooseLocation` also resets `divideDays` to the new default when it is non-null.
- Submit: if `divideDays` has 2+ days, `splitCents(Math.round(Number(amount) * 100), n)` and call `logExpense` once per day, in order, with `amount: (cents / 100).toFixed(2)` and `dayDate: day`; stop on the first error and show it. 0 days disables submit. 1 day saves normally on that date. Receipt attaches to the first returned `expenseId`. After success, clear `divideDays` with title and amount.
- Submit button label while dividing: `add over {n} days`.

- [ ] **Step 1: Thread `itineraryDays`** through the three call-site files and add the prop. Run `pnpm lint` -- clean.
- [ ] **Step 2: Add the Divide state, button, picker and the `chooseLocation` reset.** Run `pnpm lint` -- clean.
- [ ] **Step 3: Change submit** to the per-day loop. Run `pnpm lint` -- clean.
- [ ] **Step 4: Ask the user to stop the dev server, then run `pnpm build`** -- expect success.
- [ ] **Step 5: Update `docs/TODO.md`** (implemented, unverified in app) and add a `docs/DECISIONS.md` row: divided expense = N independent rows, no link column, until real use asks for one.
- [ ] **Step 6: Commit** `feat: divide an expense over picked days`

## In-app checklist (for the user)

1. Add-expense on a dated trip shows `divide`; on a dream it does not.
2. With a location chosen, `divide` pre-ticks that location's days (Accommodation: all but the last).
3. With "Auto", it pre-ticks every trip day.
4. Changing the location while open re-ticks the new location's days.
5. €100 over 3 days creates 3 rows: €33.34, €33.33, €33.33 on those dates.
6. The on-the-road day card counts only that day's share.
