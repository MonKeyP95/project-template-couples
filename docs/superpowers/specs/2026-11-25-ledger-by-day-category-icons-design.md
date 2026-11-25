# Ledger by day + category icons

## Why
Partner feedback: the ledger is hard to scan (rows sort by entry time, each
repeats its date) and the category name takes too much room. Group by day and
show a coloured icon per category instead of the name, in the ledger and on
the road.

## What
- **Ledger:** one framed box per day, header `Wed 12 Mar` (en-GB) with the
  day's total on the right (non-settlement home amounts). Days newest first;
  rows in a day newest entry first. "Undated" box after the days, then a
  "Savings & moves" box (they have no trip day). The per-row date column is
  replaced by the category icon; the category name badge goes.
- **On the road:** "Trip by category" rows show the icon before the name. The
  quick-expense category dropdown becomes a row of icon buttons; the picked
  category's name shows beside them.
- **Icons (approach 1, picked):** fixed name -> lucide icon map in code: Food
  fork-knife, Groceries basket, Transportation bus, Accommodation bed,
  Activities ticket, Other circle-dot, Settlement handshake; any other name a
  tag icon.
- **Colour:** one rule app-wide -- a category's colour is its position in the
  trip's category list, through the existing `categoryTone` palette (6 tones,
  red reserved; the 7th repeats). Replaces the ledger's hard-coded tone map,
  and the category bars switch to the same name-based rule so bar and icon
  match. Unknown names (Settlement, deleted categories) are muted.

## Non-goals
User-picked icons per category (approach 2; needs a column + picker).

## Approaches
1. Fixed map in code (picked): no migration, works on every trip; custom
   categories share the tag icon, told apart by colour.
2. User-chosen icon per category: distinct icons, but a new column and picker.

## Success criteria
Verified by Claude: lint, `tsc`, build clean; pure grouping helper returns
days newest-first with correct totals (settlements excluded), undated last.

Verified by the user in-app:
1. Budget ledger shows one box per day with `Wed 12 Mar`-style header and total.
2. Each row has a coloured icon, no category name, no date column.
3. A category's icon colour matches its bar colour in "by category".
4. Undated expenses sit in an "Undated" box; savings and moves in their own box.
5. On the road, "Trip by category" rows show icons.
6. Quick expense: tapping an icon picks that category; its name shows.
7. Phone width: no sideways scroll.
