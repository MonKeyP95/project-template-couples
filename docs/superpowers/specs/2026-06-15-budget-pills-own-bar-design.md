# Budget tab — pills bar on its own (figures move to content)

**Date:** 2026-06-15
**Status:** Approved (design), pending implementation plan

## Goal

Make the pills bar a clean strip of its own. Today the dusk-tint header holds
the label, the pills, and the per-view figure (spent / spent-total / saved)
stacked together. Move the figures out of the header into the content area so
the header reads as just `label + pills`.

## Current state

`budget-tab.tsx` dusk-tint header (`budget-tab.tsx:74-123`) renders, in order:
`Label`, the pills row, then three per-view figure conditionals (`SpentFigure`,
the inline Expense spent-total, `SavedFigure`). The content blocks below
(`CompactSettle`, `BudgetByLocation`, `LogExpenseRow`, `Ledger`, settle view)
follow the header.

## Design

Single-file change to `budget-tab.tsx`. Pure presentation — no data, query, or
migration changes.

### Header
The dusk-tint header keeps only `Label` (`Budget · {tripName}`) + the pills row.
The three figure conditionals are removed from it.

### Figures move to the top of each view's content (white area)
- **Budget** → `SpentFigure` wrapped in `px-5 pt-4 pb-4 border-b border-border`,
  then `CompactSettle`, then `BudgetByLocation`.
- **Expense** → the spent-total block in the same wrapper (`px-5 pt-4 pb-4
  border-b border-border`), then `CompactSettle`, `LogExpenseRow`, `Ledger`.
- **Saved** → a new saved content block: `SavedFigure` wrapped in
  `px-5 pt-4 pb-4` (no bottom border; its expandable contributions carry their
  own divider). Today the saved figure was the only saved content and lived in
  the header, so this adds the block.
- **Settle up** → unchanged (no figure).

## Out of scope
- No change to `SpentFigure`, `SavedFigure`, `CompactSettle`,
  `SettlementHistory`, or any child component's internals.
- No data/query/migration changes.

## Risks / notes
- `SpentFigure` and `SavedFigure` start with a `mt-2` on their first row; inside
  the new `pt-4` wrapper that yields a little extra top space, which is
  acceptable and consistent across views.
- The header's `pb-4` now sits directly under the pills, giving the bar its own
  bottom edge against the white content.
