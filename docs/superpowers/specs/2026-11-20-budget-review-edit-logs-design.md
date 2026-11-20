# Budget box: fix logs while reviewing (slice 1 of editing from the box)

**Why.** Day-to-day expenses are logged quickly in on-the-road mode. At the end
of a day, or after a few, the couple sits down to review, and they think by
category ("Food is over, why?"), not by ledger order. Fixing a wrong amount,
category or place should happen right there. Slice 2 (editing planned lines)
comes later.

**Goals.**
- In an opened category (or place) row, tapping a spent line opens the ledger's
  own expense editor in place. Saving revalidates the trip, so a line whose
  category or place changed moves to its new row.
- "+ add expense" in an opened row opens the add form prefilled with that
  category (by category) or place (by place; Trip-wide = untagged). Not on
  Before you go: Pre-trip isn't a log category. Added by the user after trying
  slice 1: "more important to add".
- "+ N more" becomes a tappable "show all N", so a multi-day review sees every
  expense.

**Non-goals.** Editing planned lines (slice 2). Editing a category total (no clean mapping to lines).

**Approaches.** (A) The full ledger row inside the detail: too big nested on a
phone and repeats the category badge. (B) Compact lines that open the ledger's
editor (picked: one editor in the app, list stays scannable). (C) Jump to a
category-filtered ledger: leaves the review and needs a new filter.

**Calls made by Claude.** Export `LedgerRowEditor` with an optional
`className` so it can sit inside the tinted detail. One line edits at a time.

## Success criteria

*Verified by Claude*
- `pnpm lint` and `tsc --noEmit` clean.
- `RowDetail` renders `LedgerRowEditor` for the tapped expense; `updateExpense`
  already calls `revalidatePath('/trips/<slug>')`.

*Verified by the user in-app*
1. Open a category, tap a spent line: the edit form opens in place.
2. Change its amount and save: the line and the category's bar update.
3. Change its category and save: it leaves this category and shows in the new one.
4. On a 2+ place trip, by place: change a line's place, it moves rows.
5. A category with more than 5 expenses shows "show all N"; tapping lists all.
6. Escape or × closes the form without saving.
7. Open Food, "+ add expense": the form opens with Food picked; save adds it
   to Food and the form stays open for the next one.
8. By place, open a place, "+ add expense": the form has that place picked.
9. Phone: the forms fit inside the detail without horizontal scroll.
