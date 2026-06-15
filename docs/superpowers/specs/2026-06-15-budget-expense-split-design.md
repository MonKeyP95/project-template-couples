# Budget tab — split Budget pill into Budget + Expense, with compact settle-up

**Date:** 2026-06-15
**Status:** Approved (design), pending implementation plan

## Goal

Two things on the Budget tab:

1. Separate "planning what you'll spend" from "tracking what you actually
   spent" — split the current `Budget` pill into **Budget** (planning) and
   **Expense** (tracking).
2. Make settling-up reachable from where you work: a **compact settle strip**
   in both Budget and Expense, while the **Settle up** pill keeps the full
   breakdown plus settlement **history**.

## Current state

After the segmented-pill work (`2026-06-15-budget-segmented-pills-design.md`),
`budget-tab.tsx` has a `view` state `"budget" | "saved" | "settle"` and pills
`Budget / Saved / Settle up`. The `Budget` view renders `SpentFigure` +
`LogExpenseRow` + `BudgetByLocation` + `Ledger`. The `Settle up` view renders
`SettleUpCard` (who owes whom + `partial`/`settle` buttons, `settle-up-card.tsx`)
+ `SplitBreakdown`. Settlements are stored as expense rows with
`is_settlement = true` (`Expense.isSettlement`).

## Design

Pure presentation — no data-model, query, server-action, or migration changes.
Touches `budget-tab.tsx` and `settle-up-card.tsx` (plus docs).

### Pills
Four pills, sea tone: `Budget` / `Expense` / `Saved` / `Settle up`. The `View`
type becomes `"budget" | "expense" | "saved" | "settle"`. Default stays
`"budget"`. Saved is unchanged.

### Per-view header figure (dusk-tint header, under the pills)
- **Budget** → `SpentFigure` (spent / planned + sea bar) — unchanged
- **Expense** → a simple spent total: `€{fmt(totalCents)}` + a small mono
  `spent` label (inline in `budget-tab.tsx`, reusing `SpentFigure`'s spent
  typography). No new file.
- **Saved** → `SavedFigure` — unchanged
- **Settle up** → none — unchanged

### Per-view content (below the header)
- **Budget** → compact settle strip, then `BudgetByLocation`
- **Expense** → compact settle strip, then `LogExpenseRow` + `Ledger`
- **Saved** → contributions log via the saved figure's expand — unchanged
- **Settle up** → `SettleUpCard` + `SplitBreakdown` + settlement history

### Compact settle strip (Budget + Expense)
A one-line strip rendered as the first content block under the header figure.
Left → right:

1. `settle up` button (full settle — the existing `settleUp` action)
2. `partial` button (opens the amount input → `partialSettleUp`, same flow as
   the full card)
3. right-aligned amount **from the current user's perspective**:
   - current user is the debtor → `you pay €X`
   - current user is the creditor → `you're owed €X`

`X` is `Math.abs(summary.netBalanceCents)`; debtor/creditor come from
`summary.debtorUserId` / `summary.creditorUserId` compared to `currentUserId`.
The strip renders **only when there's a balance** (`!isSettled` and both
debtor/creditor exist). When all square it hides entirely (no contextless
buttons).

### Extract `SettleUpButtons`
Pull the `partial` → amount-input flow + the `settle` form (with its pending
state and error) out of `SettleUpCard` into a new exported `SettleUpButtons`
component in `settle-up-card.tsx`, rendering the two controls in the order the
compact strip wants: `settle` then `partial`. `SettleUpCard` uses it internally
(its button order standardizes from partial-then-settle to settle-then-partial —
the only visual change to the Settle up pill); the compact strip reuses it too.
One source of truth for the settle actions.

### Settlement history (Settle up pill)
Below `SettleUpCard` + `SplitBreakdown`, list past settlements — the expense
rows where `isSettlement` is true — newest first. Each row shows the date,
who paid whom (payer from `paidBy` via `members`), and the amount. When there
are none, a muted "No settlements yet" line. Derived from the `expenses` prop
already passed to `BudgetTab`; no new query.

## Out of scope
- No new top-level trip tab. Saved stays a pill, unchanged.
- No data/query/migration changes.
- No change to `BudgetFigures`, `BudgetByLocation`, `LogExpenseRow`, `Ledger`,
  or the savings views.

## Risks / notes
- Four pills + the compact strip may wrap on a narrow phone; the pill row and
  the strip both use flex with wrapping, which is acceptable.
- The Expense spent total and `SpentFigure`'s spent number are the same value
  (`summary.expenseTotalCents`); intentional repetition across pills.
- The compact strip and the full card drive the same actions, so a settle from
  any of the three places revalidates and updates all views.
