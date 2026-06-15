# Budget pill — also show add-expense + ledger

**Date:** 2026-06-15
**Status:** Approved (design), pending implementation plan

## Goal

Add `LogExpenseRow` (add expense) and `Ledger` to the **Budget** pill, in
addition to the **Expense** pill where they already live.

## Current state

After the budget/expense split, the Budget view renders `SpentFigure` +
`CompactSettle` + `BudgetByLocation` (`budget-tab.tsx:95-123`). `LogExpenseRow`
and `Ledger` live only in the Expense view.

## Design

Single-file change to `budget-tab.tsx`. Append `LogExpenseRow` then `Ledger` to
the Budget view, after `BudgetByLocation`, using the same props already passed
in the Expense view. Expense view unchanged. Pure presentation — no data, query,
or migration changes.

Resulting Budget view order: spent figure → compact settle → budget-by-location
→ add expense → ledger.

## Out of scope
- No change to the Expense, Saved, or Settle up views.
- No data/query/migration changes.

## Risks / notes
- `LogExpenseRow` and `Ledger` now mount in two views; both are independent
  client components with no shared instance state, so duplication is safe.
