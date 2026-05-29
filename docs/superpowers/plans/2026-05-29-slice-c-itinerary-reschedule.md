# Slice C — Drag-to-reschedule Itinerary Days Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag itinerary day cards on `/trips/[slug]?tab=itinerary` to resequence them (insertion-shift across the trip's fixed date slots).

**Architecture:** A drop reassigns the trip's existing `day_date` values (sorted = slots) to rows by their new order. Because that permutes a uniquely-constrained column, the unique constraint becomes `DEFERRABLE INITIALLY IMMEDIATE` and an atomic `reschedule_itinerary_days` RPC does the permutation in one deferred `UPDATE`. The client reuses the `@dnd-kit` pattern from packing categories with optimistic state.

**Tech Stack:** Next.js 16 Server Actions, Supabase (Postgres function + RLS), `@dnd-kit` (already installed).

**Spec:** `docs/superpowers/specs/2026-05-29-slice-c-itinerary-reschedule-design.md`

**Project note — no test framework.** This repo has no test runner (`CLAUDE.md`). The validation gate for every task is `pnpm lint` then `pnpm build` (both clean), plus a manual browser check where noted. No failing-test-first steps.

---

### Task 1: Migration — deferrable constraint + reschedule function

**Files:**
- Create: `supabase/migrations/20260529000002_itinerary_reschedule.sql`

- [ ] **Step 1: Write the migration**

Idempotent. The Phase 3 constraint was created inline as `unique (trip_id, day_date)`, so its system name is `itinerary_days_trip_id_day_date_key`; `drop ... if exists` + re-add makes the constraint change safe to re-run, and `create or replace function` makes the function safe to re-run.

```sql
-- Slice C: drag-to-reschedule itinerary days.
--
-- 1) Make (trip_id, day_date) uniqueness DEFERRABLE so an insertion-shift can
--    permute dates within one transaction without tripping the per-statement
--    unique check. INITIALLY IMMEDIATE keeps add/edit behavior (fail-fast
--    23505) unchanged; only reschedule_itinerary_days opts into deferral.
alter table public.itinerary_days
  drop constraint if exists itinerary_days_trip_id_day_date_key;
alter table public.itinerary_days
  add constraint itinerary_days_trip_id_day_date_key
  unique (trip_id, day_date) deferrable initially immediate;

-- 2) Atomic insertion-shift. SECURITY INVOKER (default) so the caller's RLS
--    still gates the update. The trip's existing dates sorted ascending are the
--    slots; day_ids[i] takes slot[i].
create or replace function public.reschedule_itinerary_days(
  p_trip_id uuid,
  p_day_ids uuid[]
) returns void
language plpgsql
as $$
declare
  v_dates date[];
begin
  set constraints all deferred;

  select array_agg(day_date order by day_date)
    into v_dates
  from public.itinerary_days
  where trip_id = p_trip_id;

  if array_length(v_dates, 1) is distinct from array_length(p_day_ids, 1) then
    raise exception 'reschedule id count % does not match day count %',
      array_length(p_day_ids, 1), array_length(v_dates, 1);
  end if;

  update public.itinerary_days d
  set day_date = m.new_date
  from (
    select i.id, dt.new_date
    from unnest(p_day_ids) with ordinality as i(id, ord)
    join unnest(v_dates)  with ordinality as dt(new_date, ord) using (ord)
  ) m
  where d.id = m.id and d.trip_id = p_trip_id;
end;
$$;
```

- [ ] **Step 2: Verify SQL self-consistency (no local DB)**

Migrations apply by pasting into the Supabase SQL Editor. Re-read the file: confirm `drop constraint if exists`, `create or replace function`, and the `using (ord)` join (pairs `day_ids[i]` with `sorted_dates[i]`). No command to run.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260529000002_itinerary_reschedule.sql
git commit -m "feat(itinerary): deferrable date constraint + reschedule RPC"
```

---

### Task 2: Server action `rescheduleItineraryDays`

**Files:**
- Modify: `src/lib/trips/actions.ts`

- [ ] **Step 1: Append the action**

Add at the end of `src/lib/trips/actions.ts`. Mirrors `reorderPackingCategories` (return-`{error}`, `revalidatePath`). No new imports needed — `createClient` and `revalidatePath` are already imported at the top.

```ts
export interface RescheduleItineraryResult {
  error?: string
}

/**
 * Insertion-shift reschedule: reassigns the trip's existing dates (sorted) to
 * the days in the given id order, via the reschedule_itinerary_days RPC which
 * permutes them atomically under a deferred unique constraint. The existing
 * Realtime channel broadcasts the per-row UPDATEs to the partner.
 */
export async function rescheduleItineraryDays(
  tripId: string,
  tripSlug: string,
  orderedDayIds: string[],
): Promise<RescheduleItineraryResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("reschedule_itinerary_days", {
    p_trip_id: tripId,
    p_day_ids: orderedDayIds,
  })
  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint; if ($?) { pnpm build }`
Expected: both clean. (Action is exported but not yet called — fine.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(itinerary): rescheduleItineraryDays server action"
```

---

### Task 3: Client — drag-to-reschedule in `ItineraryTab`

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`

Reuses the `@dnd-kit` pattern already in `packing-tab.tsx`. The optimistic reassignment rebuilds each day via `rowToItineraryDay` (not just a spread) so the displayed weekday/short-date recompute from the new `day_date` — `withOrdinals` only re-pads the ordinal and sorts, it does not recompute `dow`/`date`.

- [ ] **Step 1: Add imports**

In `src/app/trips/[slug]/itinerary-tab.tsx`, add the dnd-kit imports after the existing `import * as React from "react"` block, and add `rescheduleItineraryDays` to the actions import.

Add these import blocks (place above the `@/components/together` import):
```ts
import {
  DndContext,
  PointerSensor,
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

Change the actions import to:
```ts
import {
  addItineraryDay,
  deleteItineraryDay,
  rescheduleItineraryDays,
  updateItineraryDay,
} from "@/lib/trips/actions"
```

- [ ] **Step 2: Add sensors + `onDragEnd` in `ItineraryTab`**

Insert right after the `const defaultDate = …` block (just before the `return (`):
```tsx
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )
  const [, startReschedule] = React.useTransition()

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = days.findIndex((d) => d.id === active.id)
    const newIndex = days.findIndex((d) => d.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const snapshot = days
    const reordered = arrayMove(days, oldIndex, newIndex)
    // The trip's existing dates, sorted, are the fixed slots. yyyy-mm-dd sorts
    // lexically = chronologically. Rebuild via rowToItineraryDay so dow/date
    // recompute from the reassigned day_date.
    const slots = days.map((d) => d.dayDate).sort()
    const reassigned = withOrdinals(
      reordered.map((d, i) =>
        rowToItineraryDay({
          id: d.id,
          day_date: slots[i],
          title: d.title,
          sub: d.sub,
          tag: d.tag,
          tone: d.tone,
        }),
      ),
    )
    setDays(reassigned)

    startReschedule(async () => {
      const result = await rescheduleItineraryDays(
        tripId,
        tripSlug,
        reordered.map((d) => d.id),
      )
      if (result.error) setDays(snapshot)
    })
  }
```

- [ ] **Step 3: Wrap the day list in `DndContext` + `SortableContext`**

Replace the `days.map(...)` branch of the list render. Find:
```tsx
        ) : (
          days.map((day, i) => (
            <DayCard
              key={day.id}
              day={day}
              tripSlug={tripSlug}
              isLast={i === days.length - 1}
              isEditing={editingId === day.id}
              onStartEdit={() => setEditingId(day.id)}
              onStopEdit={() => setEditingId(null)}
            />
          ))
        )}
```
Replace with:
```tsx
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={days.map((d) => d.id)}
              strategy={verticalListSortingStrategy}
            >
              {days.map((day, i) => (
                <SortableDayCard
                  key={day.id}
                  id={day.id}
                  day={day}
                  tripSlug={tripSlug}
                  isLast={i === days.length - 1}
                  isEditing={editingId === day.id}
                  onStartEdit={() => setEditingId(day.id)}
                  onStopEdit={() => setEditingId(null)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
```

- [ ] **Step 4: Extract `DayCardProps`, add `dragHandle`, pass it to `DayView`**

Replace the `DayCard` definition:
```tsx
function DayCard({
  day,
  tripSlug,
  isLast,
  isEditing,
  onStartEdit,
  onStopEdit,
}: {
  day: ItineraryDay
  tripSlug: string
  isLast: boolean
  isEditing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
}) {
  if (isEditing) {
    return <DayEditor day={day} tripSlug={tripSlug} onDone={onStopEdit} />
  }
  return (
    <DayView
      day={day}
      tripSlug={tripSlug}
      isLast={isLast}
      onStartEdit={onStartEdit}
    />
  )
}
```
with:
```tsx
interface DayCardProps {
  day: ItineraryDay
  tripSlug: string
  isLast: boolean
  isEditing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  dragHandle?: React.ReactNode
}

function DayCard({
  day,
  tripSlug,
  isLast,
  isEditing,
  onStartEdit,
  onStopEdit,
  dragHandle,
}: DayCardProps) {
  if (isEditing) {
    return <DayEditor day={day} tripSlug={tripSlug} onDone={onStopEdit} />
  }
  return (
    <DayView
      day={day}
      tripSlug={tripSlug}
      isLast={isLast}
      onStartEdit={onStartEdit}
      dragHandle={dragHandle}
    />
  )
}

function SortableDayCard({ id, ...rest }: DayCardProps & { id: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
  }

  const handle = (
    <button
      type="button"
      aria-label="Drag to reschedule day"
      className="cursor-grab touch-none border-0 bg-transparent px-0.5 font-mono text-[12px] leading-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      ⠿
    </button>
  )

  return (
    <div ref={setNodeRef} style={style}>
      <DayCard {...rest} dragHandle={handle} />
    </div>
  )
}
```

- [ ] **Step 5: Render the handle in `DayView`**

Add `dragHandle` to `DayView`'s props and render it in the card's meta row. Change the `DayView` signature:
```tsx
function DayView({
  day,
  tripSlug,
  isLast,
  onStartEdit,
}: {
  day: ItineraryDay
  tripSlug: string
  isLast: boolean
  onStartEdit: () => void
}) {
```
to:
```tsx
function DayView({
  day,
  tripSlug,
  isLast,
  onStartEdit,
  dragHandle,
}: {
  day: ItineraryDay
  tripSlug: string
  isLast: boolean
  onStartEdit: () => void
  dragHandle?: React.ReactNode
}) {
```

Then change the meta row from:
```tsx
        <div className="mb-1.5 flex items-center justify-between">
          <MonoBadge tone={day.tone}>{day.tag}</MonoBadge>
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            {day.date}
          </span>
        </div>
```
to:
```tsx
        <div className="mb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {dragHandle}
            <MonoBadge tone={day.tone}>{day.tag}</MonoBadge>
          </div>
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            {day.date}
          </span>
        </div>
```

- [ ] **Step 6: Verify lint + build**

Run: `pnpm lint; if ($?) { pnpm build }`
Expected: both clean.

- [ ] **Step 7: Manual check (needs the Task 1 migration pasted into Supabase)**

`pnpm dev` → `/trips/lombok?tab=itinerary`. Grab a day's `⠿` handle and drag it up/down. Expected: cards reorder; on release the dates stay the same set but the activities resequence (and the weekday/short-date labels update to match the new dates). Reload → order persists. Open a day's `✎` editor → no `⠿` handle while editing. At 390px viewport, dragging the handle reorders without scrolling the page away. If the migration is NOT pasted, the action returns an error and the optimistic reorder reverts (UI stays correct, no persistence).

- [ ] **Step 8: Commit**

```bash
git add src/app/trips/[slug]/itinerary-tab.tsx
git commit -m "feat(itinerary): drag-to-reschedule day cards"
```

---

### Task 4: Docs + final validation

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Record in `docs/TODO.md`**

Mark Slice C done in the Phase 4.6 carried list (the `- **Slice C — Drag to reschedule.**` bullet). Replace that bullet with:
```markdown
- [x] **Slice C — Drag to reschedule.** Done 2026-05-29. Insertion-shift: dragging a day card resequences activities across the trip's fixed date slots (dates stay the same set; only `day_date` reassigns by position). `@dnd-kit` grip handle on each day card (view-mode only), optimistic `arrayMove` + `rowToItineraryDay`/`withOrdinals` rebuild, revert on error. DB: `unique (trip_id, day_date)` made `DEFERRABLE INITIALLY IMMEDIATE` + `reschedule_itinerary_days(trip_id, day_ids[])` RPC permutes dates in one deferred UPDATE. Action `rescheduleItineraryDays` mirrors `reorderPackingCategories`. Existing Realtime channel syncs the partner. Dated trips only (dreams keep the stub — Slice B still open). **User action required**: paste `supabase/migrations/20260529000002_itinerary_reschedule.sql` into the Supabase SQL Editor.
```

- [ ] **Step 2: Append a `docs/DECISIONS.md` row**

`DECISIONS.md` is a `| Decision | Why | Date |` table. Append before the undated "Build iteratively" row:
```markdown
| **Deferrable unique constraint + `reschedule_itinerary_days` RPC** for itinerary drag | An insertion-shift permutes `day_date`, which Postgres rejects mid-statement under a non-deferrable `unique (trip_id, day_date)`. Making it `DEFERRABLE INITIALLY IMMEDIATE` leaves add/edit fail-fast (23505) untouched while letting one RPC defer the check and permute atomically in a single UPDATE — no transient out-of-range dates, so Realtime broadcasts only clean final values. supabase-js can't run a multi-row permutation transactionally, hence the SQL function. | 2026-05-29 |
```

- [ ] **Step 3: Full validation**

Run: `pnpm lint; if ($?) { pnpm build }`
Expected: both clean.

- [ ] **Step 4: End-to-end manual pass**

With the Task 1 migration pasted and `pnpm dev` running, on `/trips/lombok?tab=itinerary`: drag a middle day to the top → activities resequence, dates stay the set, labels update → reload (persists). Drag with only the handle on a 390px viewport. If a second device is handy, confirm the partner's timeline reorders after the drag (Realtime UPDATE + `withOrdinals`).

- [ ] **Step 5: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record Slice C itinerary reschedule"
```

---

## Notes for the implementer

- **Migration is paste-to-apply.** Until `supabase/migrations/20260529000002_itinerary_reschedule.sql` is pasted into the Supabase SQL Editor, `reschedule_itinerary_days` doesn't exist and a drag's action call errors → the optimistic reorder reverts, so the UI stays correct (no persistence). Paste before the Task 3 manual check.
- **`withOrdinals` does not recompute `dow`/`date`.** It only sorts by `dayDate` and re-pads the `d` ordinal. The optimistic reassignment in Task 3 Step 2 must rebuild each day through `rowToItineraryDay` (which derives `dow`/`date` from `day_date`) — don't shortcut it with a `{ ...d, dayDate }` spread, or the labels go stale.
- **Single-day / empty trips:** `days.length === 0` keeps the existing empty paragraph (outside `DndContext`); a one-item `SortableContext` is a no-op, so no special-casing needed for one day.

