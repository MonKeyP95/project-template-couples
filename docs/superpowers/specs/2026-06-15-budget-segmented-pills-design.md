# Budget tab — segmented pill bar (Budget / Saved / Settle up)

**Date:** 2026-06-15
**Status:** Approved (design), pending implementation plan

## Goal

Give the budget tab the same look-and-feel as packing: a pill/segment bar at
the top of the tinted header that switches between views, instead of one long
scrolling stack. Three pills: **Budget**, **Saved**, **Settle up**.

## Current state

`budget-tab.tsx` is a server component that renders everything stacked at once:
`BudgetHeader`/`BudgetFigures` (spent + saved together), `LogExpenseRow`,
`SettleUpCard`, `SplitBreakdown`, `BudgetByLocation`, `Ledger`.

Packing's reference: `packing-tab.tsx:277-297` (the pill bar) and `SegBtn`
(`packing-tab.tsx:333-357`).

## Design

### 1. `BudgetTab` becomes a client component
Add `"use client"` and a `view` state: `"budget" | "saved" | "settle"`,
default `"budget"`. All children (`LogExpenseRow`, `BudgetByLocation`,
`Ledger`, `BudgetFigures`) are already client components receiving serializable
props, so the conversion is safe — no server-only APIs are used in the file.

### 2. Shared segment bar
Lift the pill bar out of packing into the `together` component library as a
reusable piece (e.g. `SegBar` + `SegBtn`) with a `tone` prop (`"clay" | "sea"`).
Refactor `packing-tab.tsx` to consume it (clay tone). Budget uses sea tone to
match its dusk-tint header.

### 3. Header + per-view figure
Keep the dusk-tint header with the `Budget · {tripName}` label. Under the label,
render the pill bar, then the big figure for the active view:

- **Budget** → spent / planned figure + sea bar
- **Saved** → saved figure + moss bar
- **Settle up** → no header figure (the settle-up card carries the number)

This requires splitting `BudgetFigures` (today renders spent **and** saved
stacked, `budget-figures.tsx:163-253`) into two blocks — a spent block and a
saved block — so each can render under its own pill. The contributions log
(`SavingsDetails`) moves to the Saved view content (below the saved figure).

### 4. Content per view
- **Budget**: spent figure (header) + `LogExpenseRow` + `BudgetByLocation` + `Ledger`
- **Saved**: saved figure (header) + `SavingsDetails` (contributions log)
- **Settle up**: `SettleUpCard` + `SplitBreakdown`

## Out of scope
- No data-model or query changes. Pure presentation/reorganization.
- No new figures, totals, or calculations beyond what already exists.
- Desktop 3-col layout unaffected (it consumes `BudgetTab` as one block).

## Risks / notes
- `BudgetTab` going client: confirm the parent page passes only serializable
  props (it already does — expenses, members, summary, etc.).
- Splitting `BudgetFigures` must preserve the existing inline-edit behaviors
  (set budget, add savings) — keep `AmountField` intact, just regroup the two
  blocks it renders.
