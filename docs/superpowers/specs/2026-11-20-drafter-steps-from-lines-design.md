# Drafter: steps from the lines, paid chip, custom categories

Step 2 of the budget-boxes merge (see `docs/DECISIONS.md` 2026-11-20).

## Why
In step 4 the place editor becomes read-only and the drafter is the only place to edit the
budget. So the drafter must show and edit every line: custom categories, place-tagged
Transportation/Other, and paid state. Step 1 made Apply leave those lines alone by hiding them;
this step shows them.

## Goals
- Every saved non-Pre-trip line appears in exactly one drafter step.
- Each saved, priced line shows the same "to pay / paid ✓" chip as the place editor.
- A couple can add a category (existing or new) for a place or trip-wide from the edit list.

## Non-goals
- No change to rows (no new pickers), no change to the fresh-trip walk.
- No change to how a paid expense's amount follows later edits (pre-existing behaviour).

## Approaches
1. **Pickers per line** (place + category on each row in trip-wide steps, plus one "Your
   categories" step). Rejected: the densest row in the app gets denser, and a step's total stops
   meaning one category in one scope.
2. **Steps from the lines (picked).** The fixed steps stay; any (category, place) pair present in
   saved lines that no fixed step covers gets its own step. Rows stay identical; the list reads
   the same pattern everywhere.

## Design
- **Bucket = (category, locationId).** The session keeps a map bucketId -> `{ category,
  locationId }` instead of parsing keys, so custom names (which may contain ":") are safe.
  Fixed steps keep their current keys.
- **Extra steps.** After `planBudgetSteps`, append a step for each saved (category, place) pair
  with no fixed step: per place, after that place's fixed steps; trip-wide ones after the
  trip-wide steps. Title is the category name; generic question "Anything in {category}?".
- **No fallback move.** `savedRows` today puts a trip-wide Accommodation/Food/Groceries/
  Activities line (location null, e.g. added in the trip-wide editor) on the first place, and
  Apply then saves it there. With buckets from lines, such a line gets its own "Trip ·
  Accommodation" step and keeps `location_id` null.
- **One place = no place** (DECISIONS 2026-11-20, trips first). With 0 or 1 places the drafter
  treats the trip as the only place: step titles carry no place prefix, and the edit list has no
  place groups. Each row carries its own `locationId` (a step only sets it for new rows), so on a
  1-place trip a place-tagged and a trip-wide Accommodation line share one "Accommodation" step
  and each keeps its `location_id` on Apply.
- **Edit list.** With 2+ places, groups by place (each place, then Trip), not one flat "Trip" group. A last row
  "+ add a category" opens a small inline form: category (trip's list, or type a new one) and
  place (each place or Trip-wide). Confirming creates the step (new name -> `addExpenseCategory`
  first) and opens it. A pair that already has a step just opens it.
- **Generate.** `filledToItems` maps a line back to its bucket by (category, place) through the
  same map, so custom and place-tagged lines survive Generate. The fill is already 1:1.
- **Paid.** Rows carry `paidExpenseId`. Chip shows on saved rows with an amount (category and
  pre-trip rows). Tapping flips local state only; Apply runs, after both saves, `payBudgetItem`
  / `unpayBudgetItem` for rows whose state changed. Cancel discards it, like every other edit.
- **Removing a paid line.** Apply deletes its linked expense too, matching `deleteBudgetItem`
  (today the drafter's delete would leave the expense behind). My call.

## Left to the builder
Exact copy and spacing of the add-a-category form; keep it in the list's existing visual style.

## Success criteria
Verified by Claude:
- `pnpm lint` and `tsc --noEmit` clean; `pnpm build` passes.
- Every saved non-Pre-trip, non-buffer line maps to exactly one bucket on open (reasoned through
  `savedRows`; no `continue` that drops a line).
- `filledToItems` returns a line for every line sent to Generate.
- Apply calls pay/unpay only for rows whose paid state changed, after the item saves.

Verified by the user in-app:
1. A custom-category line shows in the edit list under its place, opens, and edits save.
2. A Transportation line tagged to a place shows as "{place} · Transportation" and stays there after Apply.
3. "+ add a category" with a new name: the step opens, a line saves, and the category appears in the expense picker.
4. Mark a line paid in the drafter and Apply: it shows paid; the expense appears in the ledger.
5. Mark paid then Cancel: nothing changes.
6. Unmark a paid line and Apply: the expense is gone.
7. Generate with a custom-category line present: it is still there after Apply.
8. A fresh trip's walk looks the same as before, except a 1-place trip's steps drop the place prefix ("Accommodation", not "Lisbon · Accommodation").
