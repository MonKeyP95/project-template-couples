# One Trip Model, Step 3a: The Itinerary Screen Speaks Day Numbers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The itinerary tab orders, drags, spans and adds days by `dayIndex`, and the itinerary server actions take day numbers instead of dates. Dated trips look and behave exactly as before. After this step, no action or screen logic needs a date to place a day. That is what 3b needs to put dreams on this screen.

**Architecture:** Positions become numbers end to end. The tab compares and sorts `dayIndex`, `startIndex` and `endIndex`. Calendar facts (today, past, the planner floor) convert to an index once at the top of the tab. Date inputs stay on screen but read and write indexes through one small `DayInput` component. Actions take `dayIndex` / `endIndex` / `startIndex`, so the date-to-index conversion moves from the action into the tab. The AI apply path (`lib/ai/itinerary-actions.ts`) converts its dates once at the action boundary. Its planner logic is still date-based, and 3b switches it.

**Tech Stack:** Next.js 16, React 19, TypeScript. No migration.

**Spec:** `docs/superpowers/specs/2026-10-27-one-trip-model-design.md`. Step 3 is split (user decision 2026-10-27): **3a**, this plan, switches the screen and actions to numbers. **3b** switches the walk and AI planner to numbers, copies dream days into `itinerary_days`, renders dreams on this screen with "Day N", and runs the date-leak audit. Step 2 plan: `docs/superpowers/plans/2026-10-27-one-trip-model-step-2.md`.

## Global Constraints

- No visible change on a dated trip. The same dates, order, pushes, spans, drags, collapse and past-dimming.
- No migration. The schema from step 2 already stores and syncs indexes.
- `day_index` is 1-based: `date = start_date + day_index - 1` (`dateOfIndex` / `dayIndexOf` in `itinerary-types.ts`).
- No test runner. Checks are `pnpm exec tsc --noEmit`, `pnpm lint`, and Node 24 type stripping for pure helpers. Ask before `pnpm build` if the dev server runs.
- European date order in any label (`en-GB`).
- Every `DndContext` keeps its `id` (dnd-kit SSR mismatch).

## Decisions made here

- **`DayGroup.start` / `.end` and every slot list become numbers.** Labels go through `formatShortDate(dateOfIndex(i, tripStartDate))`.
- **Today becomes `todayIndex = dayIndexOf(today, tripStartDate)`.** `active` is still `tripActive(today, start, end)`. `groupZone`, `dimBefore`, "earlier days" and `plannerDays` compare indexes against `todayIndex`.
- **`planFloor` and `firstDayAtOrAfter` stay date-based for now.** Only the AI path uses them as dates. The tab converts `planFloor(...)` to an index once for the block editor. 3b converts them with the planner.
- **Actions drop the date inputs, not the start lookup.** `addItineraryDay` still needs the start to build its returned `ItineraryDay`. It keeps returning "This trip has no dates." for a dateless trip until 3b lets `rowToItineraryDay` take a null start.
- **The floor error text loses its date:** "That day is before the trip starts." The form's `min` already blocks the case, so it is almost never seen.
- **`rateEvent` writes `event_ratings.day_date = null` for a dateless trip** instead of throwing (step 2 minor). The column is nullable (`20260708000001`).
- **`addTodayEvent` keeps its `dayDate` input.** Its callers (on-the-road, discovery, dispatch) work with a real "today".

## Review Focus

1. **Drag inside a location that has empty slots.** Days must land on the same dates as before. `reorderRangeSlots` now works over numbers and the optimistic copy must carry the new `dayIndex`. Checked by the Task 1 script and the in-app check.
2. **The live trip (today inside the trip).** Past groups go to the Past bar, past days dim, "earlier days" collapse, and past slots can't be drop targets, all exactly as before. That depends on the `todayIndex` comparisons being `<` / `>=` in the same places the date strings were.
3. **Location span edit.** Opening the editor must pre-fill the span's real dates, and saving must send the same span. This is a round trip through `DayInput` (index → date → index).
4. **Add-day default.** The "+ day" form opens on the day after the last day, or on the trip start when there are none, as today.
5. **The AI walk and Generate** still write to the right dates. This is the converted call boundary in `itinerary-actions.ts`.

---

### Task 1: Pure position helpers on numbers

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts`

**Interfaces:**
- Produces:
  - `withOrdinals(days: ItineraryDay[]): ItineraryDay[]`, sorted by `dayIndex` (the step 2 ruling is undone here)
  - `reassignDayIndex(day: ItineraryDay, dayIndex: number, startDate: string): ItineraryDay` replaces `reassignDayDate`. It sets `dayIndex` and `dayDate = dateOfIndex(...)` and recomputes `dow` / `date` / `dom` / `mon`.
  - `reorderRangeSlots(days: ItineraryDay[], slotIndexes: number[], activeId: string, overId: string): { id: string; dayIndex: number }[]`. The same algorithm, keyed on `dayIndex`.

- [ ] **Step 1: Write the check script** `<scratchpad>/slots-check.mts`, importing from the absolute `file:///` path of `itinerary-types.ts`. Build three days with `rowToItineraryDay({id, day_index, title: "x", tag: "t", tone: "sea"}, "2026-02-27")` at indexes 1, 2 and 4. Assert:
  ```ts
  // move day@1 onto day@4 over slots [1,2,4]: 2->1, 4->2, 1->4
  assert.deepEqual(reorderRangeSlots(days, [1, 2, 4], "a", "c"),
    [{ id: "b", dayIndex: 1 }, { id: "c", dayIndex: 2 }, { id: "a", dayIndex: 4 }])
  const moved = reassignDayIndex(days[0], 4, "2026-02-27")
  assert.equal(moved.dayIndex, 4); assert.equal(moved.dayDate, "2026-03-02"); assert.equal(moved.dom, "2")
  assert.deepEqual(withOrdinals([days[2], days[0]]).map((d) => [d.id, d.d]), [["a", "01"], ["c", "02"]])
  ```
- [ ] **Step 2: Run** `node <scratchpad>/slots-check.mts`. Expected: FAIL (`reassignDayIndex` is not exported).
- [ ] **Step 3: Implement** the three signatures above. Delete `reassignDayDate`.
- [ ] **Step 4: Re-run.** Expected: exit 0.
- [ ] **Step 5: Commit** (the tab won't typecheck until Task 2; ledger it).

---

### Task 2: Actions take day numbers; the tab, block editor and AI boundary follow

**Files:**
- Modify: `src/lib/trips/actions.ts`, `src/app/trips/[slug]/itinerary-tab.tsx`, `src/app/trips/[slug]/block-editor.tsx`, `src/lib/ai/itinerary-actions.ts`
- Create: `src/app/trips/[slug]/day-input.tsx`

**Interfaces:**
- Consumes: Task 1 helpers; `dayIndexOf`, `dateOfIndex`, `formatShortDate`.
- Produces (action signatures; every caller must match):
  - `AddItineraryDayInput`: `dayIndex: number; endIndex?: number` replace `dayDate` / `endDate`. The same shape is used by `insertItineraryDayWithShift`.
  - `UpdateItineraryDayInput`: `dayIndex: number` replaces `dayDate`.
  - `rescheduleItineraryDaysTo(tripId, tripSlug, assignments: { id: string; dayIndex: number }[])`
  - `renameItineraryLocation(locationId, tripId, tripSlug, name, startIndex: number | null, endIndex: number | null, currency)`
  - `setLocationSpanWithShift(locationId, tripId, tripSlug, name, startIndex: number, endIndex: number, currency)`
  - `EditItineraryBlockInput.floor: number | null` (a day number)
  - `DayInput({ value, onChange, startDate, min, ariaLabel, className }: { value: number | null; onChange: (dayIndex: number | null) => void; startDate: string; min?: number; ariaLabel: string; className?: string })`. It renders `<input type="date">` with `value = dateOfIndex`, `min = dateOfIndex(min)`, and `onChange` → `dayIndexOf`. An empty value gives null. 3b adds a "Day N" branch for a null start.

- [ ] **Step 1: Actions.** Each action validates `Number.isInteger(...)` (error "Invalid day."), keeps the floor `>= 1`, and stops calling `dayIndexOf`. `rateEvent` writes a null date when the trip has no start. Keep the existing collision and `needsPush` texts.
- [ ] **Step 2: `day-input.tsx`** per the interface. It uses the same classes the two date inputs in `DayForm` use today, passed through `className`.
- [ ] **Step 3: Tab internals to numbers.** In `itinerary-tab.tsx`, work through every site in the Step 4 grep. In summary:
  - `byDate` → `byIndex`. `orderTabs` uses `startIndex ?? earliest dayIndex`. `buildTimeline` sorts on numbers, and `DayGroup.start` / `.end` are `number | null`.
  - `groupZone(group, todayIndex: number)`. `defaultCollapsed` takes `todayIndex`.
  - `nextDayAfter` is deleted. `defaultIndex = lastDay ? lastDay.dayIndex + 1 : 1`, and `addDayDate` becomes `addDayIndex: number | null`.
  - Drag: `slotIndexes` instead of `slotDates`, and the optimistic copy uses `reassignDayIndex(d, i, tripStartDate)`.
  - Rename span: `renameStart` / `renameEnd` become `number | null`, prefilled from `group.start` / `.end`, with `DayInput` for both inputs. The span label is `formatShortDate(dateOfIndex(...))`.
  - `DayForm` / `AddDayRow` / `DayEditor`: index state, both date inputs become `DayInput`, and the payloads send `dayIndex` / `endIndex`.
  - Every `x.dayDate < today` becomes `x.dayIndex < todayIndex`. `dimBefore` is `todayIndex` or null.
  - `BlockEditor` gets `floor={floorIndex}`, where `floorIndex` is `planFloor(...)` converted to an index once, or null.
- [ ] **Step 4: Prove the tab no longer positions by date.**
  Run: `grep -n "dayDate\|nextDayAfter\|slotDates\|reassignDayDate\|type=\"date\"" src/app/trips/[slug]/itinerary-tab.tsx`
  Expected: no hits except `DayCard`'s label fields (`dom` / `mon` / `dow` are not matched) and `find-a-place` / `event-expense` props that pass `day.dayDate` on as a real calendar date. List each remaining hit in the ledger with why it stays.
- [ ] **Step 5: `block-editor.tsx`.** `floor: number | null`, and `pastCount` counts `d.dayIndex < floor`.
- [ ] **Step 6: AI boundary.** In `itinerary-actions.ts`, each `addItineraryDay` / `updateItineraryDay` call passes `dayIndex: dayIndexOf(date, trip.startDate)`, and the positional `renameItineraryLocation` call passes the location's existing `startIndex` / `endIndex`. These functions already require a dated trip. The planner's date logic is untouched.
- [ ] **Step 7: `pnpm exec tsc --noEmit` and `pnpm lint`.** Expected: clean.
- [ ] **Step 8: Commit.**

---

### Task 3: In-app check, then docs

**Files:**
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`, `docs/superpowers/specs/2026-10-27-one-trip-model-design.md` (step 3 split note)

- [ ] **Step 1: Hand the user the in-app checklist** below, then wait.
- [ ] **Step 2: Docs.** TODO: 3a *implemented*, then *verified in-app* once confirmed. DECISIONS row: "3a: positions are numbers in the tab and actions; dates only label and mark today. Step 3 is split into 3a (screen, actions) and 3b (walk + AI, dreams moved in, leak audit)." Spec: under Steps, note that step 3 is split into 3a and 3b.
- [ ] **Step 3: Commit docs.**

## Success Criteria

Verified by Claude:
- `pnpm exec tsc --noEmit` and `pnpm lint` clean.
- The Task 1 script exits 0 after failing first.
- The Task 2 Step 4 grep shows no date-based positioning in the tab.

Verified by the user in-app, on a dated trip, and on a trip whose dates include today if one exists:
1. The itinerary shows the same days, dates, order and location groups as before.
2. "+ day" opens on the day after the last day. Adding a day, a multi-day block, and a day on a taken date (push) all land on the dates picked.
3. Editing a day and changing its date moves it there. Picking a date before the trip start is blocked.
4. Opening a location's span editor shows its real dates. Changing the span, including one that pushes later days, saves the dates picked.
5. Dragging days inside a location, across empty days, lands them where dropped. A reload shows the same.
6. Block editing ("edit together") still works, and on a live trip the past days are left alone.
7. On a live trip: past locations sit in the Past bar, past days are dimmed, and past days can't be dragged into.
8. "Plan your itinerary" apply and Generate still put days on the right dates.
