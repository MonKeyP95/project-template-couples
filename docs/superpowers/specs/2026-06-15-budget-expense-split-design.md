# Budget tab — split Budget pill into Budget + Expense

**Date:** 2026-06-15
**Status:** Approved (design), pending implementation plan

## Goal

Separate "planning what you'll spend" from "tracking what you actually spent".
The Budget tab's current `Budget` pill mixes both — set-a-budget + per-location
allocation alongside add-expense + the ledger. Split it into two pills:
**Budget** (planning) and **Expense** (tracking).

## Current state

After the segmented-pill work (`2026-06-15-budget-segmented-pills-design.md`),
`budget-tab.tsx` has a `view` state `"budget" | "saved" | "settle"` and pills
`Budget / Saved / Settle up`. The `Budget` view renders:

- Header figure: `SpentFigure` (spent / planned + sea bar)
- Content: `LogExpenseRow` + `BudgetByLocation` + `Ledger`

## Design

Single-file change to `src/app/trips/[slug]/budget-tab.tsx` (plus docs). Pure
presentation — no data-model, query, server-action, or migration changes.

### Pills
Four pills, sea tone: `Budget` / `Expense` / `Saved` / `Settle up`. The `View`
type gains `"expense"`. Default view stays `"budget"`.

### Per-view header figure (dusk-tint header, under the pills)
- **Budget** → `SpentFigure` (spent / planned + sea bar) — unchanged
- **Expense** → a simple spent total: `€{fmt(totalCents)}` with a small mono
  `spent` label, reusing `SpentFigure`'s spent typography. Rendered inline in
  `budget-tab.tsx` — no new component/file.
- **Saved** → `SavedFigure` — unchanged
- **Settle up** → none — unchanged

### Per-view content (below the header)
- **Budget** → `BudgetByLocation` only
- **Expense** → `LogExpenseRow` + `Ledger`
- **Saved** → contributions log via the saved figure's expand — unchanged
- **Settle up** → `SettleUpCard` + `SplitBreakdown` — unchanged

The only structural move: `LogExpenseRow` and `Ledger` leave the Budget view
and render under Expense; `BudgetByLocation` stays under Budget.

## Out of scope
- No new top-level trip tab (the split stays inside the Budget tab).
- No data/query/migration changes.
- No change to Saved or Settle up views, or to `BudgetFigures`,
  `BudgetByLocation`, `LogExpenseRow`, `Ledger`, `SettleUpCard`.

## Risks / notes
- Four pills may wrap on a narrow phone — the pill row already uses
  `flex flex-wrap`, so wrapping is acceptable.
- The Expense spent total and `SpentFigure`'s spent number are the same value
  (`summary.expenseTotalCents`); that intentional repetition across pills is fine.
