# Merged budget walk — one "Plan a budget" button

The budget tab has two guided walks behind two buttons: **Before you go**
(`pre-trip-checklist.tsx`) and **Plan a budget** (`budget-drafter.tsx`). They
already write to the same table, separated only by `category = "Pre-trip"`.
Two buttons for one job is the problem.

Merge them into **one button, one walk** — the before-you-go questions come
first, then the trip categories. The AI `generate` call stays split: it never
sees the pre-trip lines.

## Shape

One card, "Plan a budget", with one button (`Plan a budget` / `Edit budget`,
plus `Start over`). The separate "Before you go" card is removed;
`pre-trip-checklist.tsx` is deleted and its walk moves into `BudgetDrafter` as
a new step kind.

## The walk

`session.steps` becomes:

```
1..5    the five fixed slots (Flights / Insurance / Docs & fees /
        Medicine / Gear) — one screen each, unchanged questions
6       "Anything else?" — free rows
7..n    the existing per-location category steps
n+1     buffer
n+2     review
```

One global `step N of M` counter across the whole walk.

Pre-trip rows live in the same `session.items` map, under bucket ids
`pretrip:<slot>` and `pretrip:extras`. They render the simpler row — fixed
label, note, amount — with no frequency toggle and no date pair, exactly as
today. Slot labels and their order are unchanged.

## Generate stays split

This is the requirement that shapes the code: the AI call must not mix the two.

- `collectLines()` skips every `pretrip:*` bucket, so `draftAndFillBudget`
  never receives them.
- `filledToItems()` rebuilds only the category buckets; the pre-trip buckets
  carry over from the previous session state untouched.

No new AI code, no prompt change, one call — two small filters. Before-you-go
amounts are whatever the couple typed; blanks stay blank.

## Review

Two sections in one list:

```
Before you go
  Flights                      €420
  Travel insurance              €60
  --------------------------   €480
Trip
  Lisbon · Hotel      × 4 =    €560
  Lisbon · Dinners    × 4 =    €180
  --------------------------   €740
  Buffer (10% of €740)          €74
============================
Total                         €1294
```

Buffer is `pct × trip subtotal` only. Flights and insurance are known prices;
they don't need a cushion.

## Apply — two writes, not one

1. `savePreTripItems` for the `pretrip:*` rows. It updates in place, which
   preserves the paid-links on rows already marked paid.
2. `saveBudgetItems` for the category rows plus the derived buffer line.

`saveBudgetItems` already carries `.neq("category", "Pre-trip")` on its delete
(`actions.ts:2448`), so it cannot clobber the pre-trip rows. Running it second
means its planned-total recompute sees the final state of both.

## Breakdown below the button

The always-visible `PlannedBudget` block gains a Before-you-go scope editor,
first, above the location scopes — editable inline like any other scope.

`BudgetScopeEditor` gains one scope discriminator prop that routes save to
`savePreTripItems` instead of `saveBudgetItemsForScope`, and locks the row
category to `Pre-trip` (hiding the per-row category picker).
`saveBudgetItemsForScope` needs no change. `PlannedBudget`'s `tripWide` filter
already excludes `Pre-trip`, so nothing double-lists.

## Files

| File | Change |
|---|---|
| `budget-drafter-pretrip.tsx` | **new** — pre-trip step definitions + row renderer |
| `budget-drafter.tsx` | prepend pre-trip steps; split `collectLines`/`filledToItems`; two-section review; two-action apply |
| `budget-scope-editor.tsx` | scope discriminator prop; fixed-category mode |
| `budget-tab.tsx` | drop the Before-you-go card; add the pre-trip scope editor |
| `pre-trip-checklist.tsx` | **deleted** |

`budget-drafter.tsx` is already 967 lines. The pre-trip step defs and row
renderer go in their own file rather than growing it further.

## Decisions

- **`Start over`** reseeds the trip categories from the itinerary but **keeps**
  the pre-trip rows. There is nothing to reseed them from, and blanking them
  would drop flight prices the assistant will not regenerate.
- **Pre-trip rows stay simple** — no frequency, no date spans.
- **Buffer excludes pre-trip.**

## Out of scope

- Any change to the pre-trip questions themselves.
- Any change to `draftBudgetFill` or its prompt.
- A pre-trip-specific AI call. Rejected deliberately: before-you-go prices are
  things the couple looks up (their flight, their policy), not things to guess.

## Success criteria

**Verified by Claude**

1. `pnpm build` passes and `pnpm lint` is clean.
2. `src/app/trips/[slug]/pre-trip-checklist.tsx` no longer exists and nothing
   imports it.
3. `budget-tab.tsx` renders exactly one button that opens a budget walk.
4. `collectLines()` returns no line whose bucket id starts with `pretrip:` —
   given a session holding both kinds, the returned array contains only
   category-bucket lines.
5. `filledToItems()` applied to a generate result leaves the `pretrip:*`
   buckets of the prior session identical (same rows, same amounts).
6. The review's buffer figure equals `round(tripSubtotal × pct / 100)` where
   `tripSubtotal` excludes every `pretrip:*` row.
7. `apply` issues `savePreTripItems` before `saveBudgetItems`, and the items
   passed to `saveBudgetItems` contain no `Pre-trip` category.
8. The Before-you-go scope editor's save path reaches `savePreTripItems` with
   `category: "Pre-trip"` on every row.

**Verified by the user in-app**

1. The budget tab shows one "Plan a budget" card, no separate "Before you go"
   card.
2. Opening the walk shows Flights as step 1, and the counter reads `step 1 of
   M` where M covers the whole walk through review.
3. Walking forward past step 6 lands on the first location category step; the
   `back` button walks back into the pre-trip steps.
4. Entering a flight price, pressing `generate`, then landing on review: the
   flight price is exactly what was typed and carries no `est.` mark.
5. Review shows a Before-you-go section and a Trip section with separate
   subtotals; the buffer line names only the trip subtotal.
6. Pressing `apply` and reloading: both the pre-trip and the category lines
   persist, and the planned total matches the review's grand total.
7. A pre-trip line already marked paid is still marked paid after an `apply`
   that did not touch it.
8. The breakdown below the button shows an editable Before-you-go section
   first; editing an amount there and saving persists it.
9. `Start over` clears the category rows back to itinerary seeds and leaves the
   pre-trip amounts in place.
10. Checked at a phone viewport.
