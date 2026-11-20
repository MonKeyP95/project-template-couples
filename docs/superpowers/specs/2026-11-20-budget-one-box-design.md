# Budget: one box (step 4 of the boxes merge)

**Why.** The Budget tab shows the same spent-vs-plan numbers twice: the
headline box (by category) and the "Planned" box (editable, by place). One box,
sliced two ways, reads calmer; editing already lives in the drafter.

**Goals.**
- Delete the "Planned" box (`PlannedBudget` in `budget-tab.tsx`).
- Under the headline: the by-category view, as today.
- 2+ places: a `by category | by place` switch. 0-1 places: no switch
  (trips first, places secondary).
- By place is read-only, styled like by category: rows "Before you go", each
  place, "Trip-wide"; bar = spent / planned; tap a row for its planned lines and
  spending.

**Non-goals.** No editing in the box. No collapsed "details" toggle: the list
stays visible. `BudgetScopeEditor` stays (the itinerary tab uses it).

**Attribution (by place).** Planned: Pre-trip category -> Before you go;
`locationId` -> that place; else Trip-wide. Spent: Pre-trip category -> Before
you go; else `expenseLocationId(e, dayMap)`; null -> Trip-wide. Status and bar
reuse by-category's `lineStatus` / `linePct`. Empty rows (no plan, no spend) are
hidden.

**Approaches.** (a) New read-only `BudgetByPlace` + pure `byPlaceLines`
(picked: mirrors by-category, pure function is reasoned about directly).
(b) Keep `BudgetScopeEditor` in a read-only mode: rejected, adds a mode flag to
an editor for a view it wasn't built for. (c) Collapse everything behind a
details toggle: rejected by the user, the list is the point on the road.

**Calls made by Claude.** Drop the "Planned total" row (the planned/room line
already says it). Branch `feat/budget-one-box` off `feat/budget-planned-room`
(#135 unmerged).

## Success criteria

*Verified by Claude*
- `pnpm build` and `pnpm lint` clean.
- `byPlaceLines` puts a Pre-trip item/expense under Before you go, a
  location-tagged item under its place, an expense on a place's day under that
  place, and a location-less, day-less expense under Trip-wide.
- `budget-tab.tsx` no longer renders `PlannedBudget`.

*Verified by the user in-app*
1. One budget box; no "Planned" box below it.
2. Trip with 0 or 1 place: no switch, by-category list as before.
3. Trip with 2+ places: switch shows; "by place" lists Before you go, each
   place, Trip-wide with spent / planned bars.
4. Tapping a place row shows its planned lines and recent spending.
5. Editing a line in the drafter updates both views.
6. Phone viewport: switch and rows fit without horizontal scroll.
