# Budget: "planned · unplanned room" line

Step 3 of the budget-boxes merge. Approved in conversation 2026-11-20.

## Why
The estimate is the couple's budget, what they think they should spend. Planned lines are only
what's known (groceries rarely get a line), so planned is naturally lower. Both numbers stay;
the gap between them is the useful signal (DECISIONS, budget boxes, 2026-11-20).

## Design
- One mono line under the headline's "€X left", in the headline box:
  `planned €2,550 · €450 unplanned room`. When planned is above the budget, in clay:
  `planned €3,200 · €200 over your budget`.
- **Planned** = the sum of every budget line, Pre-trip included, **buffer line excluded** (the
  buffer is unplanned room by design; user confirmed). **Room** = budget minus planned.
- Shows only when the trip has a budget and at least one non-buffer line.
- Same on the road as when planning: it stays "how much of the budget never had a plan".
- The drafter header's "€X of €Y allocated" bar (`AllocatedFigure`, which counted the buffer) is
  replaced by the same line, so the app shows one planned number. `AllocatedFigure` is deleted.

## Approaches
Only one sensible way: a small display component fed by the items the tab already loads. A
bar was rejected (the headline already has the spent bar; two bars compete).

## Success criteria
Verified by Claude: lint + `tsc` clean; build passes; `plannedLinesCents` excludes the buffer
line and includes Pre-trip (traced).

Verified by the user in-app:
1. Right after a first Apply with a 10% buffer, the line shows room equal to the buffer amount.
2. Adding a line in the drafter and applying lowers the room by that amount.
3. Raising lines above the budget turns the line clay with "over your budget".
4. The drafter header shows the same line, with the same numbers.
5. A trip with no budget, or no lines, shows no line.
