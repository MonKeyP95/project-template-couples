# Divide an expense over days

## Why
One cost often covers several days (a hotel, a car rental, a pass). Today an
expense sits on one `dayDate`, so the whole cost lands on one day. Dividing it
spreads the cost across the days it really covers. A calendar fits better than
"repeat for N days": days need not be consecutive, and the defaults are visible.

## What
- The add-expense form (`LogExpenseRow`) gets a **Divide** button.
- It opens a calendar of the trip's days. The user ticks/unticks days.
- **Default selection:** the chosen location's days; with no location picked
  ("Auto"), the whole trip's days.
- On save, the expense is written as **one expense per picked day**, amount
  divided evenly; the leftover cent(s) go on the first day. Title, category,
  payer, currency and location are copied to every row.
- With no days picked (or Divide never opened), the form saves one expense as
  today.

## Non-goals (this slice)
- Linking the rows together, collapsing them in the ledger, or editing/deleting
  them as one (approach B, later if needed).
- Divide in the edit form or the on-the-road quick expense.
- Dreams (no dates): the button is hidden.

## Approaches
- **A. N separate expense rows (picked).** No migration; every total, day
  budget and settle-up works unchanged. Cost: N rows in the ledger.
- B. A plus a shared split-group id: collapse/edit together. Needs a migration;
  deferred until A is used for real.
- C. One expense holding a list of dates: every per-day reader must learn to
  spread it. Rejected: most code touched, easiest to get wrong.

## Calls left to the builder (Claude's calls)
- Accommodation default excludes the location's last day (nights, not days),
  matching `budget-drafter.tsx` night counting.
- Division is done in the trip's home amount via the existing `logExpense`
  path, one call per day or one batched server action -- builder's choice,
  whichever is smaller.

## Success criteria
Verified by Claude:
- `pnpm build` and `pnpm lint` clean.
- Pure split function: 10000 cents over 3 days -> [3334, 3333, 3333]; sum
  always equals the input.
- Default-days function returns the location's days when a location is set,
  the trip's days when not, minus the last day for Accommodation.

Verified by the user in-app:
1. Add-expense shows a Divide button on a dated trip; not on a dream.
2. Opening it with a location chosen pre-ticks that location's days.
3. Opening it with "Auto" pre-ticks every trip day.
4. Saving €100 over 3 picked days creates 3 rows (€33.34, €33.33, €33.33)
   on those dates.
5. The on-the-road day card counts only that day's share.
