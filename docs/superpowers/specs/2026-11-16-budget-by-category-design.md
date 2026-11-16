# Budget by category: design

Date: 2026-11-16. Size: a small change.

## Intent

Once a budget is planned, the trip's Budget tab should show the budget **by category**: one line per category,
so you can see where the money is going. This matters both while planning (some costs, like activities, are paid
in advance) and during the trip (which category is running hot). Inspired by the "By category" block in a
reference screenshot.

## Goals / non-goals

- Goal: a read-only "By category" block on the trip page's Budget tab (phone: inside the opened Budget box;
  desktop: the Budget tab).
- Goal: tap a line to see what is behind its number.
- Non-goal: the on-the-road page. It stays simple and unchanged.
- Non-goal: the desktop right column. Its single Budget bar stays.
- Non-goal: editing. Amounts are still edited in the existing "Planned" by-place card.
- Anti-goal: a new table, column or AI call.

## Approaches considered

- A) Bar = the category's share of the plan. Good for seeing where money goes, but it hides advance payments.
- **B) Bar = spent against that category's plan (picked).** It shows advance payments while planning and
  overruns during the trip.
- A before the trip and B during it: rejected. The user wants B in both, because of advance payments.

## Design

- **Placement:** inside the existing "Spent" card in `budget-tab.tsx`, under the spent bar. It is not a new card,
  and the block is hidden when the trip has no budget lines.
- **Data:** the existing `perCategoryRollup(expenses, budgetItems, catOrder)` with expenses converted to home
  currency via `homeCents`. Order follows the trip's `expenseCategories`.
- **Line:** name, bar, then `spent / planned`. Every bar is the same sea colour.
  - Over plan: the bar fills completely in clay, with a small "€X over" note.
  - Spent but not planned: a clay bar marked "unplanned".
  - Fully paid before the trip starts (spent >= planned > 0): a moss "paid in advance" note.
- **Pre-trip category:** shown as "Before you go".
  - Before the trip starts, or for a trip without dates, it is a normal line.
  - From the start date on, it becomes a grey footnote `+ paid before the trip €X` (actual Pre-trip spend) with no
    bar. The footnote is hidden when that amount is 0. The lines plus the footnote add up to the Spent total.
- **Expand:** tap a line to open it. One line is open at a time, and tapping again closes it. It shows:
  - Planned: that category's budget items from every scope, each with its place name (or "Trip-wide") and
    "paid" / "not yet" (from `paidExpenseId`).
  - Spent: that category's non-settlement expenses, newest first, with date (en-GB) and who paid. It shows the
    first 5, then "+ N more".
- **Code shape:** one new client component (e.g. `budget-by-category.tsx`) plus a few lines in `budget-tab.tsx`.
  The mode is decided by comparing `today` with `startDate`.

## Left to the builder

Exact spacing and type sizes follow the existing `SpentFigure` styles. The mockups are in
`.superpowers/brainstorm/156-1794817805/content/` (`full-page.html`, `desktop.html`, `by-category-expand.html`).

## Success criteria

Verified by Claude:
1. `pnpm build` passes and `pnpm lint` is clean.
2. The block renders only when `budgetItems.length > 0`.
3. The category lines plus the Pre-trip footnote (during the trip) sum to `summary.expenseTotalCents` (reasoned
   from the rollup excluding settlements and the same `homeCents` conversion).
4. On or after `startDate`, Pre-trip is never rendered as a line; before it, or with no dates, it is never
   rendered as a footnote.
5. No changes to the on-the-road page, the desktop right column, the schema or any server action.

Verified by the user in-app:
1. Phone: opening the Budget box shows "By category" under the Spent bar with one line per category.
2. A category over its plan shows a full clay bar and an "over" note.
3. An expense in a category with no plan shows as "unplanned".
4. Tapping a line opens its planned and spent lists; tapping another closes the first.
5. Before the trip, "Before you go" is a line; during the trip it is the grey footnote.
6. Desktop Budget tab shows the same block; the right column is unchanged.
