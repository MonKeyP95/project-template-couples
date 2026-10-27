# One Trip Model, Step 5: Drag a Day onto Any Day

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every one of a trip's days shows in the itinerary, including empty ones, on dreams and dated trips alike. A planned day can be dragged onto any empty day, in any location.

**Architecture:** Empty positions are derived, not stored: positions 1..length that have no row. A pure module decides where each empty position belongs (which location, or none) and what a drop means (`planDrop`). The tab gets one `DndContext` for the whole itinerary instead of one per location, so a drag can cross locations. Each location keeps its own `SortableContext` for today's in-place reordering. Empty positions render as slim one-line rows (`EmptyDaySlot`, a `useDroppable`). Dropping a day onto one calls a new `moveItineraryDay` action that sets the day's number and location in one write.

**Tech Stack:** Next.js 16, React 19, TypeScript, `@dnd-kit/core` + `@dnd-kit/sortable` (already used). No migration.

**Spec:** `docs/superpowers/specs/2026-10-27-one-trip-model-design.md`, step 5. Design choices made with the user on 2026-10-27 (below). Step 4 plan: `docs/superpowers/plans/2026-10-27-one-trip-model-step-4.md`.

## Global Constraints

- Positions are 1-based day numbers. A trip's length is `max(day_count, highest day_index)`; an older dream with no `day_count` uses its highest day.
- Labels: `positionLabel(i, tripStartDate)` gives "14 Jan" on a dated trip and "Day 4" on a dream (European order, `en-GB`). No date ever shows on a dream.
- On a live dated trip, nothing before `todayIndex` is a drop target and past empty positions are not rendered.
- Every `DndContext` keeps an explicit `id` (dnd-kit SSR id mismatch).
- No migration. No change to the moving RPCs.
- No test runner. Checks are `pnpm exec tsc --noEmit`, `pnpm lint`, and Node 24 scripts for pure helpers (scratchpad `alias.mjs` hook maps `@/` to `src/`). Ask before `pnpm build` if the dev server runs.

## Decisions (with the user, 2026-10-27)

- **Empty days show as a slim row each**, in their place: "Day 4 · free" / "14 Jan · free".
- **An empty position belongs to a location** when that location's declared span covers it. A location with no span owns the positions between its first and last day. Otherwise the position is loose and renders in the timeline between locations, at its number. This is the same rule the walk's `locationForIndex` uses for spans, extended to implied ranges.
- **Dropping a day onto an empty day moves it there and files it under that position's location** (or none: a travel day). This works across locations.
- **Dropping onto a planned day reorders, within the same location only** (today's behaviour, `reorderRangeSlots`). Dropping onto a planned day in a different location does nothing (the card snaps back).
- **On the road**, past empty days are hidden and nothing before today is a target.
- **Block membership on a move (Claude's call):** a day dropped onto an empty position keeps its block (`group_id`, `group_name`) only if the new position is directly next to (±1) another day of the same block, not counting the moved day itself. Otherwise it leaves the block. This keeps blocks contiguous without asking.
- Supersedes the memory note "empty days stay derived, not day cards": empty days still are not rows, but they now render.

## Review Focus

1. **A day dropped onto an empty day in another location** shows up under that location, at that date or Day N, and stays there after a reload. Pinned by `planDrop` in the Task 1 script and in-app item 3.
2. **Reordering inside one location still behaves as today**, including across a multi-day block, and a drop onto a planned day in another location does nothing. Pinned in the Task 1 script (`reorder` and `none` cases) and in-app item 4.
3. **On a live trip**, no past empty day renders and a drop on a past position is refused. Pinned in the Task 1 script (`floor`) and in-app item 6.
4. **A location with no declared span** shows its in-between empty days inside it, not after it. Pinned by `positionOwner` in the Task 1 script.
5. **A partner moves a day into the slot you are dropping on.** The unique `(trip_id, day_index)` constraint rejects the second write; the action returns "That day is taken." and the optimistic move rolls back. Pinned by the action's error mapping (Task 2) and in-app item 7.

---

### Task 1: Pure slot logic

**Files:**
- Create: `src/lib/trips/itinerary-slots.ts`

**Interfaces:**
- Produces:
  - `tripLength(days: { dayIndex: number }[], dayCount: number | null): number`, returning `max(dayCount ?? 0, highest dayIndex)`.
  - `emptyPositions(days: { dayIndex: number }[], length: number): number[]`, ascending.
  - `positionOwner(i: number, locations: ItineraryLocation[], days: ItineraryDay[]): string | null`. Declared span first, then the implied range (min..max `dayIndex` of that location's days), else null.
  - `EMPTY_PREFIX = "empty:"`; slot id is `` `${EMPTY_PREFIX}${i}` ``.
  - `type DropPlan = { kind: "none" } | { kind: "reorder"; changes: { id: string; dayIndex: number }[] } | { kind: "move"; dayId: string; dayIndex: number; locationId: string | null; keepGroup: boolean }`
  - `planDrop(input: { days: ItineraryDay[]; locations: ItineraryLocation[]; activeId: string; overId: string; floor: number | null }): DropPlan`
    - Over an empty slot at `i`: `none` if `floor !== null && i < floor`; else `move` with `locationId = positionOwner(i, ...)` and `keepGroup` per Decisions.
    - Over a day with the same `locationId` as the active day: `reorder` with `reorderRangeSlots(sameLocationDays, slotIndexes, activeId, overId)`, where `slotIndexes` are those days' numbers, ascending, with numbers below `floor` removed. Return `none` when there are no changes.
    - Anything else (different location, same id, unknown id): `none`.

- [ ] **Step 1: Write** `<scratchpad>/slots5-check.mts`. Fixture, built with `rowToItineraryDay(row, null)` (a dream) and `rowToLocation(row, null)`: Lisbon has a span of 1-4 with days at 1 and 3 (a and b). Porto has no span, with days at 6 and 8 (c and d). Loose day e is at 10. Length is 11.
  ```ts
  assert.equal(tripLength(days, 11), 11); assert.equal(tripLength(days, null), 10)
  assert.deepEqual(emptyPositions(days, 11), [2, 4, 5, 7, 9, 11])
  assert.equal(positionOwner(2, locs, days), "lisbon")   // declared span
  assert.equal(positionOwner(7, locs, days), "porto")    // implied range 6..8
  assert.equal(positionOwner(5, locs, days), null)       // between places
  // cross-location onto an empty day: joins Porto
  assert.deepEqual(planDrop({ days, locations: locs, activeId: "a", overId: "empty:7", floor: null }),
    { kind: "move", dayId: "a", dayIndex: 7, locationId: "porto", keepGroup: false })
  // onto a planned day in another place: nothing
  assert.deepEqual(planDrop({ days, locations: locs, activeId: "a", overId: "c", floor: null }), { kind: "none" })
  // same place: reorder as today
  assert.deepEqual(planDrop({ days, locations: locs, activeId: "a", overId: "b", floor: null }),
    { kind: "reorder", changes: [{ id: "b", dayIndex: 1 }, { id: "a", dayIndex: 3 }] })
  // live trip: an empty day before today refuses
  assert.deepEqual(planDrop({ days, locations: locs, activeId: "c", overId: "empty:4", floor: 5 }), { kind: "none" })
  // block kept only when the new spot touches the block: give c and d group "g"
  const grouped = days.map((d) => (d.id === "c" || d.id === "d" ? { ...d, groupId: "g" } : d))
  assert.equal((planDrop({ days: grouped, locations: locs, activeId: "d", overId: "empty:7", floor: null }) as { keepGroup: boolean }).keepGroup, true)
  assert.equal((planDrop({ days: grouped, locations: locs, activeId: "d", overId: "empty:2", floor: null }) as { keepGroup: boolean }).keepGroup, false)
  ```
- [ ] **Step 2: Run** with `node --import ./alias.mjs slots5-check.mts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the signatures above. Reuse `reorderRangeSlots` from `itinerary-types.ts`.
- [ ] **Step 4: Re-run.** Expected: `ok`.
- [ ] **Step 5: Commit.**

---

### Task 2: `moveItineraryDay` action

**Files:**
- Modify: `src/lib/trips/actions.ts` (beside `rescheduleItineraryDaysTo`)

**Interfaces:**
- Produces: `moveItineraryDay(input: { tripId: string; tripSlug: string; dayId: string; dayIndex: number; locationId: string | null; keepGroup: boolean }): Promise<{ error?: string }>`

- [ ] **Step 1: Implement.** Validate `Number.isInteger(dayIndex) && dayIndex >= 1` (error "Invalid day."). One `update` on `itinerary_days` sets `day_index` and `location_id`, plus `group_id: null, group_name: null` when `!keepGroup`, scoped by `.eq("id", dayId).eq("trip_id", tripId)`. Error code `23505` returns "That day is taken."; any other error returns its message. Then `revalidatePath(`/trips/${tripSlug}`)`. No length growth: every empty slot lies within the trip's length.
- [ ] **Step 2: `pnpm exec tsc --noEmit` and `pnpm lint`.** Expected: clean.
- [ ] **Step 3: Commit.**

---

### Task 3: The tab renders empty days and drops across locations

**Files:**
- Create: `src/app/trips/[slug]/empty-day-slot.tsx`
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`

**Interfaces:**
- Consumes: Task 1 (`tripLength`, `emptyPositions`, `positionOwner`, `planDrop`, `EMPTY_PREFIX`), Task 2 (`moveItineraryDay`), `positionLabel`, `reassignDayIndex`.
- Produces: `EmptyDaySlot({ dayIndex, label }: { dayIndex: number; label: string })`. It calls `useDroppable({ id: `${EMPTY_PREFIX}${dayIndex}` })` and renders one dashed-border line "`{label}` · free", highlighted (`isOver`) while a day hovers it. The styling matches the existing dashed rows (`border-dashed border-rule`, mono 10px uppercase muted).

- [ ] **Step 1: `empty-day-slot.tsx`** per the interface.
- [ ] **Step 2: One drag area.** Replace the per-location `DndContext`s and the loose one with a single `<DndContext id="dnd-itinerary" ...>` around the whole timeline. Each location keeps its `SortableContext` over its live day ids. Loose days get one `SortableContext` too, and are now sortable even when locations exist. `onDragEnd` calls `planDrop({ days, locations, activeId, overId, floor: active ? todayIndex : null })`:
  - `reorder`: today's optimistic path (`reassignDayIndex`, then `rescheduleItineraryDaysTo`, rolling back on error).
  - `move`: an optimistic update of that one day (`reassignDayIndex`, plus `locationId`, plus group cleared when `!keepGroup`), then `moveItineraryDay`, rolling back and showing nothing more on error. The error text is ignored like the reorder path's.
  - `none`: return.
  `onGroupDragEnd` is replaced by this one handler.
- [ ] **Step 3: Render empty positions.** Compute `length = tripLength(days, tripDayCount)` and `empties = emptyPositions(days, length)`, dropping any `< todayIndex` when `active`. Then:
  - Inside a location group, merge that location's empties (`positionOwner === group.key`) with its segments by number, so each empty renders as an `EmptyDaySlot` in place. The "earlier days" split ignores empties, because past ones are already gone.
  - `buildTimeline` gains `{ kind: "empty"; dayIndex: number }` items for loose empties (`positionOwner === null`), sorted by number with the other items. They render as `EmptyDaySlot` in a row with the loose-day styling (`border-t border-rule py-1 pl-10`).
  - A collapsed location hides its empties with its days.
- [ ] **Step 4: Check the tab no longer has per-group drag areas:**
  `grep -n "DndContext\|onGroupDragEnd\|looseSlotIndexes" src/app/trips/\[slug\]/itinerary-tab.tsx`
  Expected: the import, and exactly one `<DndContext` / `</DndContext>` pair; no `onGroupDragEnd`, no `looseSlotIndexes`.
- [ ] **Step 5: `pnpm exec tsc --noEmit` and `pnpm lint`.** Expected: clean. Re-run the Task 1 script: `ok`.
- [ ] **Step 6: Commit.**

---

### Task 4: In-app check, then docs

**Files:**
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`; update memory `project-empty-days-stay-derived` (superseded) and `project-one-trip-model-planned` (step 5 done)

- [ ] **Step 1: Hand the user the in-app checklist** below, then wait.
- [ ] **Step 2: Docs.** TODO: step 5 *implemented*, then *verified in-app* once confirmed; next is step 6. DECISIONS rows: (a) every position renders, with empties derived and shown as "free" rows owned by span-or-implied-range; (b) a drop onto an empty day moves the day and refiles its location, a drop onto a planned day reorders only within its own location, and a moved day keeps its block only when it lands next to it.
- [ ] **Step 3: Commit docs.**

## Success Criteria

Verified by Claude:
- `pnpm exec tsc --noEmit` and `pnpm lint` clean.
- The Task 1 script exits 0 after failing first.
- The Task 3 Step 4 grep shows one drag area.

Verified by the user in-app, on a dated trip and on a dream (Patagonia):
1. Every day of the trip shows: planned days as before, and empty ones as "14 Jan · free" on a dated trip or "Day 4 · free" on a dream, in their place inside their location or between locations.
2. Drag a day onto an empty day in the same location: it moves there and stays after a reload.
3. Drag a day onto an empty day in another location (or between locations): it moves there, now shows under that location (or as a travel day), and stays after a reload.
4. Drag a day onto a planned day in the same location: the days reorder as before. Onto a planned day in another location: it snaps back and nothing changes.
5. A day dragged out of a multi-day block leaves it. One dragged to the empty day right next to its block stays in the block.
6. On a live trip (today inside it), no past empty days show, and past days can't be dropped onto.
7. With a partner moving a day at the same time, a clash shows the day back where it was (no duplicate, no lost day) after the refresh.
8. On the phone, long-press drag onto an empty day works.
