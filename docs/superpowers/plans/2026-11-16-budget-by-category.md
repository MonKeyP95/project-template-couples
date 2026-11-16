# Budget by Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only, tap-to-expand "By category" block inside the Budget tab's Spent card.

**Architecture:** The pure line shaping lives in a `*-types.ts` module (client-safe); one client component renders it and is mounted under `SpentFigure` in `budget-tab.tsx`. Data comes from props the tab already has; there are no schema or action changes.

**Tech Stack:** Next.js 16, React 19, Tailwind v4, existing `Bar` / `Label` from `@/components/together`.

**Spec:** `docs/superpowers/specs/2026-11-16-budget-by-category-design.md`

## Global Constraints

- No new table, column, server action or AI call. The on-the-road page and the desktop right column are untouched.
- Dates use `en-GB` (day before month). No emojis.
- Pre-trip category name is `"Pre-trip"`, displayed as "Before you go".
- The project has no test runner. Verification is `pnpm lint` + `pnpm build` plus reasoning about the data path (CLAUDE.md).

## Review Focus

1. A foreign-currency expense: the line amounts must use `homeCents(e)`, the same as the Spent total, or the lines won't add up.
2. A planned item with `amountCents` 0 (price unknown) and no spend: the line shows `€0 / €0` with an empty bar, with no division by zero.
3. A category renamed or deleted after spending: the rollup appends unknown categories, so the line must still render.
4. A dream (no `startDate`): it always uses the before-trip look; Pre-trip is never a footnote.
5. Pre-trip planned but nothing paid, during the trip: the footnote is hidden (actual = 0) and there's no Pre-trip line.

---

### Task 1: Pure line shaping

**Files:**
- Create: `src/lib/trips/budget-by-category-types.ts`

**Interfaces:**
- Consumes: `perCategoryRollup`, `CategoryRollup` from `@/lib/trips/budget-rollup-types`.
- Produces:
  - `type CategoryStatus = "ok" | "over" | "unplanned" | "paidAhead"`
  - `interface CategoryLine extends CategoryRollup { status: CategoryStatus; pct: number }`
  - `byCategoryLines(expenses: ExpenseSpend[], items: PlannedSpend[], catOrder: string[], tripStarted: boolean): { lines: CategoryLine[]; preTripFootCents: number }`

- [ ] **Step 1: Implement `byCategoryLines`.** Rules:
  - `pct` = planned > 0 ? round(actual / planned * 100) capped at 100 : (actual > 0 ? 100 : 0).
  - `status`: planned 0 and actual > 0 -> `unplanned`; actual > planned > 0 -> `over`; `!tripStarted` and actual >= planned > 0 -> `paidAhead`; else `ok`.
  - When `tripStarted`, the `"Pre-trip"` row is removed from `lines` and its `actualCents` becomes `preTripFootCents`; otherwise `preTripFootCents` = 0.
- [ ] **Step 2:** Run `pnpm lint`. Expected: clean.

### Task 2: The component

**Files:**
- Create: `src/app/trips/[slug]/budget-by-category.tsx` (`"use client"`)

**Interfaces:**
- Consumes: `byCategoryLines` (Task 1); `Expense`, `ExpenseCategoryRow`, `homeCents` from `expense-types`; `BudgetItem`; `ItineraryLocation`; `MemberToneEntry`; `Bar`, `Label`; `money`, `useCurrency`.
- Produces: `BudgetByCategory({ expenses, budgetItems, categories, locations, members, tripStarted }: {...})`, which returns null when `budgetItems.length === 0`.

- [ ] **Step 1: Render the block.** Top border rule, `Label` "By category", one row per line: chevron, name (`"Pre-trip"` -> "Before you go"), `Bar` (tone `clay` for over/unplanned, else `sea`), then `fmt(actual) / fmt(planned)` (the planned part is muted and omitted for unplanned). Note under the bar: "€X over" (clay), "unplanned" (clay) or "paid in advance" (moss). Footnote row `+ paid before the trip` / `fmt(preTripFootCents)` when > 0.
- [ ] **Step 2: Expand.** `openCategory` state (one open at a time; tapping again closes it). The open panel (sea-tint background) shows:
  - Planned: items with that category, each with its subject, place (location name or "Trip-wide"), "paid"/"not yet" from `paidExpenseId`, and amount.
  - Spent: non-settlement expenses in that category, sorted by `dayDate ?? createdAt` descending. It shows the first 5 with title, `en-GB` day/month date, `members[paidBy]?.displayName` and `homeCents`, then "+ N more". Each list is omitted when empty.
- [ ] **Step 3:** Run `pnpm lint`. Expected: clean.

### Task 3: Mount it, verify, document

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx` (the headline card, under `SpentFigure`)
- Modify: `docs/TODO.md`

- [ ] **Step 1:** Render `<BudgetByCategory ... tripStarted={startDate !== null && today >= startDate} />` inside the headline card after `SpentFigure`.
- [ ] **Step 2:** Make sure no dev server is running (memory: builds clobber `.next`), then run `pnpm lint && pnpm build`. Expected: both succeed.
- [ ] **Step 3:** Add a TODO.md entry marked *implemented, unverified in app* with the in-app checklist from the spec.
- [ ] **Step 4:** Commit on a branch `feat/budget-by-category`.
