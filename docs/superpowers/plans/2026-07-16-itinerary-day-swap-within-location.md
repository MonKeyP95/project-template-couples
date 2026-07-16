# Itinerary Drag-to-Swap Days Within a Location — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drag a day up/down within its location group on the dated itinerary to reorder it; the day's plan moves to the new date while the location's dates stay put, applied instantly and mirrored to the partner via existing Realtime.

**Architecture:** UI-only slice. Two pure helpers added to `itinerary-types.ts`; the itinerary tab gains dnd-kit sensors, a `SortableDayCard` wrapper, and per-location `DndContext`/`SortableContext` regions. Reordering reuses the existing `rescheduleItineraryDays` action + `reschedule_itinerary_days` RPC (dates as fixed slots; permute the group's members into them). No migration, no new server action.

**Tech Stack:** Next.js 16 client component, React 19, dnd-kit (`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` — already installed and used in `dream-itinerary-tab.tsx`), Supabase Realtime.

## Global Constraints

- No emojis in code, prints, or logs.
- No test runner exists in this repo and CLAUDE.md forbids inventing one. Validation is `pnpm lint` + `pnpm build` + manual verification. Keep the two new helpers pure so they are correct by inspection.
- `"use client"` files import types/helpers from `*-types.ts`, never `*-queries.ts`. The new helpers go in `itinerary-types.ts` (safe).
- Display dates use `en-GB` (day-before-month). The new helper reuses the module's existing formatters, so this is automatic.
- Mobile-first: whole-card drag must not break touch scrolling. Use a `MouseSensor` (distance 8) for pointer + a `TouchSensor` (press delay) for touch — a quick swipe scrolls, a long-press starts a drag. No visible grip.
- Reuse existing systems: reuse `rescheduleItineraryDays` / `reschedule_itinerary_days`; do not add a new action or RPC.

---

### Task 1: Pure helpers `reassignDayDate` and `reorderWithinGroup`

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts` (append two exported functions)

**Interfaces:**
- Produces:
  - `reassignDayDate(day: ItineraryDay, newDate: string): ItineraryDay` — returns a copy with `dayDate = newDate` and derived labels `dow`/`date`/`dom`/`mon` recomputed; all other fields unchanged. `d` is left as-is (re-padded later by `withOrdinals`).
  - `reorderWithinGroup(allDays: ItineraryDay[], groupOrderedIds: string[]): string[]` — all trip day ids sorted ascending by current `dayDate`, with the slots occupied by the group's members overwritten (in ascending order) by `groupOrderedIds`; every other slot keeps its current day id. Feed the result to `rescheduleItineraryDays`.

- [ ] **Step 1: Add the two helpers**

Append to `src/lib/trips/itinerary-types.ts` (after `daySummary`, end of file). The `toUtc`, `DOW_FMT`, `SHORT_DATE_FMT`, `DOM_FMT`, `MON_FMT` bindings already exist above in this module.

```ts
/** Copy of `day` moved to `newDate` (yyyy-mm-dd) with the derived date labels
 * recomputed. `d` is untouched; re-pad with `withOrdinals` after reordering.
 * Used for the optimistic reorder update before the server round-trip. */
export function reassignDayDate(day: ItineraryDay, newDate: string): ItineraryDay {
  const utc = toUtc(newDate)
  return {
    ...day,
    dayDate: newDate,
    dow: DOW_FMT.format(utc),
    date: SHORT_DATE_FMT.format(utc),
    dom: DOM_FMT.format(utc),
    mon: MON_FMT.format(utc),
  }
}

/** Full trip day-id order (ascending by current date) with one location group's
 * members permuted into `groupOrderedIds`, every other day left in place. The
 * group's slots in the sorted array are filled, ascending, with
 * `groupOrderedIds` in order. Fed to reschedule_itinerary_days: only the
 * group's members change date, so the location's date span is unchanged. */
export function reorderWithinGroup(
  allDays: ItineraryDay[],
  groupOrderedIds: string[],
): string[] {
  const ids = [...allDays]
    .sort((a, b) => (a.dayDate < b.dayDate ? -1 : a.dayDate > b.dayDate ? 1 : 0))
    .map((d) => d.id)
  const inGroup = new Set(groupOrderedIds)
  let g = 0
  return ids.map((id) => (inGroup.has(id) ? groupOrderedIds[g++] : id))
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/itinerary-types.ts
git commit -m "feat(itinerary): pure helpers for within-location day reorder"
```

---

### Task 2: Wire drag-to-swap into the itinerary tab

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`

**Interfaces:**
- Consumes from Task 1: `reassignDayDate`, `reorderWithinGroup`.
- Consumes existing: `rescheduleItineraryDays(tripId, tripSlug, orderedDayIds)` from `@/lib/trips/actions`; `arrayMove` from `@dnd-kit/sortable`.

- [ ] **Step 1: Add imports**

In the `@dnd-kit`/actions/types import area at the top of the file:

Add a new import block (dnd-kit is already a dependency):

```ts
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
```

Add `rescheduleItineraryDays` to the existing `@/lib/trips/actions` import list.

Add `reassignDayDate` and `reorderWithinGroup` to the existing `@/lib/trips/itinerary-types` import list.

- [ ] **Step 2: Add sensors, transition, and the reorder handler inside the component**

Inside the itinerary tab component (the one holding `const [days, setDays] = React.useState`), after the `days`/`locations` state and before `const timeline = buildTimeline(...)`, add:

```ts
const dragSensors = useSensors(
  useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
  useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
)
const [, startReschedule] = React.useTransition()

/** Reorder `groupDays` (one location's days, or all days when locationless) so
 * the dragged day takes the dropped day's slot. Optimistic; rolls back on error.
 * Dates are fixed slots — only which day sits on each of the group's dates moves. */
function reorderDays(groupDays: ItineraryDay[], activeId: string, overId: string) {
  if (activeId === overId) return
  const oldIndex = groupDays.findIndex((d) => d.id === activeId)
  const newIndex = groupDays.findIndex((d) => d.id === overId)
  if (oldIndex === -1 || newIndex === -1) return

  const reordered = arrayMove(groupDays, oldIndex, newIndex)
  const datesAsc = groupDays.map((d) => d.dayDate).sort()
  const newDateById = new Map<string, string>()
  reordered.forEach((d, i) => newDateById.set(d.id, datesAsc[i]))

  const snapshot = days
  setDays((prev) =>
    withOrdinals(
      prev.map((d) =>
        newDateById.has(d.id) ? reassignDayDate(d, newDateById.get(d.id)!) : d,
      ),
    ),
  )

  const fullOrder = reorderWithinGroup(days, reordered.map((d) => d.id))
  startReschedule(async () => {
    const result = await rescheduleItineraryDays(tripId, tripSlug, fullOrder)
    if (result.error) setDays(snapshot)
  })
}

function onGroupDragEnd(groupDays: ItineraryDay[], e: DragEndEvent) {
  const { active, over } = e
  if (over) reorderDays(groupDays, String(active.id), String(over.id))
}
```

- [ ] **Step 3: Add the `SortableDayCard` wrapper (module-level, near `DayCard`)**

Place this just above `function DayCard(` :

```tsx
function SortableDayCard({ id, ...rest }: DayCardProps & { id: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: rest.isEditing })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    zIndex: isDragging ? 10 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <DayCard {...rest} />
    </div>
  )
}
```

- [ ] **Step 4: Make `DaySegmentView` render sortable cards when asked**

Add a `sortable: boolean` field to `DaySegmentView`'s props type, and swap the card element based on it. Change the `cards` mapping:

```tsx
  const cards = seg.days.map((day) => {
    const cardProps = {
      day,
      tripId,
      tripSlug,
      expanded: !collapsedDays.has(day.id),
      onToggle: () => toggleDay(day.id),
      dimBefore,
      today,
      isLast: day.id === lastDayId,
      isEditing: editingId === day.id,
      onStartEdit: () => setEditingId(day.id),
      onStopEdit: () => setEditingId(null),
      locations,
      categories,
      members,
      currentUserId,
    }
    return sortable ? (
      <SortableDayCard key={day.id} id={day.id} {...cardProps} />
    ) : (
      <DayCard key={day.id} {...cardProps} />
    )
  })
```

Add `sortable,` to the destructured params and `sortable: boolean` to the inline props type of `DaySegmentView`.

- [ ] **Step 5: Wrap each location group's day list in a `DndContext`/`SortableContext`**

In the location-group branch, the day rows render inside `{open ? (<div className="pb-3 pl-10">{(() => { ... })()}<div className="pt-2"><AddDayRow .../> ...` .

Wrap ONLY the day-rows IIFE (not `AddDayRow`/`BudgetScopeEditor`). Replace `{(() => { ...rows... })()}` with:

```tsx
{group.days.length > 0 ? (
  <DndContext
    id={`dnd-${group.key}`}
    sensors={dragSensors}
    collisionDetection={closestCenter}
    onDragEnd={(e) => onGroupDragEnd(group.days, e)}
  >
    <SortableContext
      items={group.days.map((d) => d.id)}
      strategy={verticalListSortingStrategy}
    >
      {(() => { ...existing rows IIFE body unchanged... })()}
    </SortableContext>
  </DndContext>
) : (
  (() => { ...existing rows IIFE body unchanged... })()
)}
```

To avoid duplicating the ~180-line IIFE body: assign it to a const first. Immediately inside the `<div className="pb-3 pl-10">`, keep the IIFE as-is but capture it:

```tsx
{(() => {
  const dayRows = (() => { ...existing IIFE body unchanged... })()
  if (group.days.length === 0) return dayRows
  return (
    <DndContext
      id={`dnd-${group.key}`}
      sensors={dragSensors}
      collisionDetection={closestCenter}
      onDragEnd={(e) => onGroupDragEnd(group.days, e)}
    >
      <SortableContext
        items={group.days.map((d) => d.id)}
        strategy={verticalListSortingStrategy}
      >
        {dayRows}
      </SortableContext>
    </DndContext>
  )
})()}
```

In that same location branch, the `DaySegmentView` used by `renderRow` must pass `sortable={true}`. Add `sortable` to that `<DaySegmentView .../>` call (the one inside `renderRow`, around the `seg` case).

- [ ] **Step 6: Handle the locationless case (all days draggable as one list)**

Loose timeline items render via `<DaySegmentView .../>` inside the `item.kind === "loose"` branch of `timeline.map`. Pass `sortable={locations.length === 0}` to that `DaySegmentView`.

Then wrap the whole `timeline.map(...)` result in a single `DndContext`/`SortableContext` only when there are no locations. Capture the mapped array and conditionally wrap:

```tsx
{(() => {
  const rendered = timeline.map((item) => { ...existing map body unchanged... })
  if (locations.length !== 0) return rendered
  return (
    <DndContext
      id="dnd-loose"
      sensors={dragSensors}
      collisionDetection={closestCenter}
      onDragEnd={(e) => onGroupDragEnd(days, e)}
    >
      <SortableContext
        items={days.map((d) => d.id)}
        strategy={verticalListSortingStrategy}
      >
        {rendered}
      </SortableContext>
    </DndContext>
  )
})()}
```

(When locations exist, loose days keep `sortable={false}` and are not wrapped — they stay non-draggable, per spec.)

- [ ] **Step 7: Lint and build**

Run: `pnpm lint`
Expected: no new errors.

Run: `pnpm build`
Expected: build succeeds (Turbopack; if it panics with 0xc0000142 on Windows, stop, delete `.next/`, retry — that is the known subprocess flake, not a code error).

- [ ] **Step 8: Manual verification**

Start `pnpm dev`. On a trip with a location that has 3+ days:
- Long-press (touch) or press-and-drag ≥8px (mouse) a day and drop it on another day in the same location. Expect: the two swap, dates stay in place, the location header span is unchanged, ordinal numbers re-pad.
- A quick vertical swipe on mobile still scrolls the list (does not start a drag).
- Tapping a day still expands/collapses it; the edit (✎) still opens the editor.
- Dragging a day onto another location's day, or onto an empty slot, does nothing.
- On a trip with no locations, days reorder freely as one list.
- With a second browser/session on the same trip, the swap appears live.

- [ ] **Step 9: Commit**

```bash
git add src/app/trips/[slug]/itinerary-tab.tsx
git commit -m "feat(itinerary): drag a day to reorder it within its location"
```

---

### Task 3: Update the manual copy

**Files:**
- Modify: `src/app/manual/manual-content.tsx` (the itinerary `<Section>`, ~line 99)

**Interfaces:** none.

- [ ] **Step 1: Fix the drag description**

The current copy says "Drag a day by its handle to reschedule it; the dates stay put and the activities shuffle into place." There is no handle now and reordering is within a location. Replace that sentence with:

```tsx
        Drag a day to reorder it within its place; the dates stay put and the
        plan moves to the new day.
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/manual/manual-content.tsx
git commit -m "docs(manual): describe drag-to-reorder within a location"
```

---

## Self-Review

**Spec coverage:**
- Within-location instant swap → Task 2 Steps 5–6. ✓
- Dates stay put / plan moves via existing RPC → Task 1 `reorderWithinGroup` + Task 2 `reorderDays`. ✓
- No migration / no new action → confirmed; reuses `rescheduleItineraryDays`. ✓
- No-locations trip fully reorderable → Task 2 Step 6. ✓
- Cross-location drop is a no-op → `onGroupDragEnd`/`reorderDays` findIndex guard (over id not in group). ✓
- Optimistic + rollback + Realtime → Task 2 Step 2 (`snapshot`, `setDays`, existing subscription reconciles). ✓
- Whole-card drag, mobile-safe → Task 2 Steps 1–3 (Mouse+Touch sensors, `SortableDayCard`). ✓
- `reassignDayDate` recomputes derived fields → Task 1. ✓
- Manual copy stale → Task 3. ✓

**Placeholder scan:** none — every code step shows full code.

**Type consistency:** `reorderDays(groupDays, activeId, overId)`, `onGroupDragEnd(groupDays, e)`, `reassignDayDate(day, newDate)`, `reorderWithinGroup(allDays, groupOrderedIds)`, `SortableDayCard({ id, ...rest }: DayCardProps & { id: string })`, `DaySegmentView` gains `sortable: boolean` — used consistently across Tasks 1–2.

**Note on testing:** The spec listed unit tests; this repo has no test runner and CLAUDE.md forbids inventing one, so validation is lint + build + manual (Task 2 Step 8). The two helpers are pure and small, correct by inspection.
