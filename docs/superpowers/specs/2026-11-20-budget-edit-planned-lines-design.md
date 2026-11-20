# Budget box: edit planned lines (slice 2 of editing from the box)

**Why.** Same review sitting as slice 1: the couple thinks by category and
fixes what's wrong where they read it. Slice 1 fixed the spent side; this fixes
the plan side without opening the drafter.

**Goals.**
- In an opened row (by category or by place), tapping a planned line opens a
  small editor in place: subject, amount, save, cancel, delete, and a
  "mark paid" / "unpay" button.
- Saving changes only the plan (user's pick, option a). A paid line's expense
  keeps its amount; the real figure is fixed on the spent line (slice 1).
- Mark paid uses `payBudgetItem` dated today (as the scope editor does); unpay
  uses `unpayBudgetItem`; delete uses `deleteBudgetItem` (takes its expense).
- "+ add planned" in an opened row adds a line: by category, that category,
  Trip-wide; by place, that place, with a category picker; Before you go,
  Pre-trip, Trip-wide.
- Same UI in planning and on the road.

**Non-goals.** Changing a planned line's category, place, dates or how-often
(the drafter). Editing the buffer line (drafter-derived): it stays read-only.
Syncing a paid line's expense amount.

**Approaches.** (A) A compact planned-line editor in `RowDetail` plus two
single-line actions, `updateBudgetItem` and `addBudgetItem` (picked).
(B) Embed `BudgetScopeEditor`: it is scope-shaped (one place, every category)
and saves a whole scope, wrong fit for a category row. (C) Jump to the drafter:
leaves the review.

**Calls made by Claude.** Stored amounts are totals; editing a "daily" or
"x n" line's total just changes its derived per-unit price in the drafter.
`updateBudgetItem` touches only `subject` and `amount_cents`; `addBudgetItem`
appends with `sort_order` after the category's last line. Both validate like
`saveBudgetItems`. Amounts allow 0 (unpriced); mark paid needs > 0, as today.
One planned line edits at a time.

## Success criteria

*Verified by Claude*
- `pnpm lint` and `tsc --noEmit` clean; `pnpm build` passes.
- `updateBudgetItem` writes only `subject` and `amount_cents` and revalidates
  `/trips/<slug>`; it never touches `expenses`.
- `addBudgetItem` inserts with the given category and location and revalidates.
- The buffer line renders without an edit button.

*Verified by the user in-app*
1. Open a category, tap a planned line: the editor opens in place.
2. Change its amount and save: the line, the row's "/ planned" figure and the
   headline's "planned · room" line update.
3. On a paid line, change the amount: the spent line keeps its old amount.
4. "Mark paid" on an unpaid line: it shows "paid" and a spent line appears.
5. "Unpay": the tag goes back to "not yet" and that spent line is gone.
6. Delete a line: it disappears (and its spent line too, if it was paid).
7. "+ add planned" in Food: the new line shows under Food's Planned.
8. By place, "+ add planned" in a place: pick a category, save, it shows in
   that place and in that category.
9. The buffer line is not tappable.
10. Phone: the editor fits inside the detail without horizontal scroll.
