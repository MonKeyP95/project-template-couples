# Slice B — Itinerary for Dreams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the read-only `DreamItineraryStub` on dateless dream trips with a real, editable, drag-reorderable numbered-day itinerary.

**Architecture:** A parallel `dream_itinerary_days` table keyed on `(trip_id, day_index)` instead of `day_date` — the dated `itinerary_days` path stays completely untouched. New types + query + four server actions + a self-contained client tab component mirror the dated itinerary minus the calendar. Drag-to-reorder permutes `day_index` via a deferred-unique RPC, exactly like Slice C did for dates.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Supabase (Postgres + RLS + Realtime), `@dnd-kit`, TypeScript, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-05-30-slice-b-dream-itinerary-design.md`

**Note on verification:** This repo has no test framework (CLAUDE.md: "do not invent a test command"). Every task verifies with `pnpm build` (+ `pnpm lint` where TS/TSX changed) and, for DB tasks, by confirming the SQL is idempotent. Manual in-app verification happens at the end. Commit after each task.

**User action required at the end:** paste `supabase/migrations/20260530000001_slice_b_dream_itinerary.sql` into the Supabase SQL Editor — the dream itinerary tab stays empty/non-functional until then.

---

### Task 1: Migration — `dream_itinerary_days` table, RLS, Realtime, reorder RPC

**Files:**
- Create: `supabase/migrations/20260530000001_slice_b_dream_itinerary.sql`

- [ ] **Step 1: Write the migration**

Mirrors `20260527000003_phase_3_itinerary.sql` (table + RLS) and `20260529000002_itinerary_reschedule.sql` (deferrable unique + permute RPC), keyed on `day_index`. Fully idempotent per the repo rule.

```sql
-- Slice B: itinerary for dreams (numbered days).
--
-- Dateless dream trips get a parallel, position-keyed itinerary. The dated
-- itinerary_days table is untouched. Mirrors the itinerary_days shape but keyed
-- on (trip_id, day_index) instead of (trip_id, day_date). Idempotent.

create table if not exists public.dream_itinerary_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_index int not null,
  title text not null check (length(trim(title)) > 0),
  sub text,
  tag text not null check (length(trim(tag)) > 0),
  tone text not null check (tone in ('sea', 'clay', 'moss', 'sand')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists dream_itinerary_days_trip_idx
  on public.dream_itinerary_days (trip_id, day_index);

-- Deferrable so the reorder RPC can permute indices in one statement without
-- tripping the per-statement unique check. INITIALLY IMMEDIATE keeps add/edit
-- fail-fast; only the RPC opts into deferral.
alter table public.dream_itinerary_days
  drop constraint if exists dream_itinerary_days_trip_id_day_index_key;
alter table public.dream_itinerary_days
  add constraint dream_itinerary_days_trip_id_day_index_key
  unique (trip_id, day_index) deferrable initially immediate;

alter table public.dream_itinerary_days enable row level security;

drop policy if exists dream_itinerary_days_select on public.dream_itinerary_days;
create policy dream_itinerary_days_select on public.dream_itinerary_days
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists dream_itinerary_days_insert on public.dream_itinerary_days;
create policy dream_itinerary_days_insert on public.dream_itinerary_days
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );

drop policy if exists dream_itinerary_days_update on public.dream_itinerary_days;
create policy dream_itinerary_days_update on public.dream_itinerary_days
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));

drop policy if exists dream_itinerary_days_delete on public.dream_itinerary_days;
create policy dream_itinerary_days_delete on public.dream_itinerary_days
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- Realtime broadcasts for partner sync (matches itinerary_days). Idempotent via
-- the do-block that swallows duplicate_object on re-run.
do $$
begin
  alter publication supabase_realtime add table public.dream_itinerary_days;
exception
  when duplicate_object then null;
end $$;

-- Atomic insertion-shift reorder. SECURITY INVOKER (default) so caller RLS still
-- gates. Existing day_index values sorted are the slots; day_ids[i] takes slot[i].
create or replace function public.reschedule_dream_itinerary_days(
  p_trip_id uuid,
  p_day_ids uuid[]
) returns void
language plpgsql
as $$
declare
  v_indexes int[];
begin
  set constraints all deferred;

  select array_agg(day_index order by day_index)
    into v_indexes
  from public.dream_itinerary_days
  where trip_id = p_trip_id;

  if array_length(v_indexes, 1) is distinct from array_length(p_day_ids, 1) then
    raise exception 'reschedule id count % does not match day count %',
      array_length(p_day_ids, 1), array_length(v_indexes, 1);
  end if;

  update public.dream_itinerary_days d
  set day_index = m.new_index
  from (
    select i.id, ix.new_index
    from unnest(p_day_ids) with ordinality as i(id, ord)
    join unnest(v_indexes) with ordinality as ix(new_index, ord) using (ord)
  ) m
  where d.id = m.id and d.trip_id = p_trip_id;
end;
$$;
```

- [ ] **Step 2: Verify idempotency by inspection**

Confirm every statement is re-run-safe: `create table if not exists`, `create index if not exists`, `drop constraint if exists` before add, `drop policy if exists` before each policy, the realtime `do`-block swallows `duplicate_object`, and the RPC is `create or replace`. No bare `create`/`alter add` that would fail on a second paste.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260530000001_slice_b_dream_itinerary.sql
git commit -m "feat(itinerary): dream_itinerary_days table + reorder RPC"
```

---

### Task 2: Types — `dream-itinerary-types.ts`

**Files:**
- Create: `src/lib/trips/dream-itinerary-types.ts`

Mirrors `itinerary-types.ts` but position-keyed: no `dayDate`/`dow`/`date`. Reuses `ItineraryTone` so the tone palette stays single-sourced. Client-safe (no `next/headers`), so the client tab imports from here, not the queries module.

- [ ] **Step 1: Write the module**

```ts
import { type ItineraryTone } from "@/lib/trips/itinerary-types"

export interface DreamDay {
  /** Row id — needed by edit/delete/reorder UI. */
  id: string
  /** 1-based position. The sort + reorder key (dreams have no dates). */
  dayIndex: number
  /** 1-based ordinal padded to 2 digits ("01", "02"). Derived from sort position. */
  d: string
  title: string
  sub: string
  tag: string
  tone: ItineraryTone
}

export interface DreamRow {
  id: string
  day_index: number
  title: string
  sub: string | null
  tag: string
  tone: string
}

/** Single row -> DreamDay. `d` is a placeholder; pass through withDreamOrdinals to set correctly. */
export function rowToDreamDay(row: DreamRow): DreamDay {
  return {
    id: row.id,
    dayIndex: row.day_index,
    d: "",
    title: row.title,
    sub: row.sub ?? "",
    tag: row.tag,
    tone: row.tone as ItineraryTone,
  }
}

/** Sort by dayIndex ascending and re-pad `d` ordinals. Pure; safe for client-side use after Realtime deltas. */
export function withDreamOrdinals(days: DreamDay[]): DreamDay[] {
  const sorted = [...days].sort((a, b) => a.dayIndex - b.dayIndex)
  return sorted.map((day, i) => ({
    ...day,
    d: String(i + 1).padStart(2, "0"),
  }))
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: clean (module is pure types/functions, no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/dream-itinerary-types.ts
git commit -m "feat(itinerary): DreamDay types + ordinal helpers"
```

---

### Task 3: Query — `dream-itinerary-queries.ts`

**Files:**
- Create: `src/lib/trips/dream-itinerary-queries.ts`

Mirrors `itinerary-queries.ts`, ordered by `day_index`.

- [ ] **Step 1: Write the module**

```ts
import { createClient } from "@/lib/supabase/server"

import {
  rowToDreamDay,
  withDreamOrdinals,
  type DreamDay,
} from "@/lib/trips/dream-itinerary-types"

export async function getDreamItineraryDays(
  tripId: string,
): Promise<DreamDay[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("dream_itinerary_days")
    .select("id, day_index, title, sub, tag, tone")
    .eq("trip_id", tripId)
    .order("day_index", { ascending: true })

  return withDreamOrdinals((data ?? []).map(rowToDreamDay))
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/dream-itinerary-queries.ts
git commit -m "feat(itinerary): getDreamItineraryDays query"
```

---

### Task 4: Server actions — append to `actions.ts`

**Files:**
- Modify: `src/lib/trips/actions.ts` (add an import, append four actions at end of file)

Four actions mirroring `addItineraryDay` / `updateItineraryDay` / `deleteItineraryDay` / `rescheduleItineraryDays`, minus dates. `add` appends at `max(day_index)+1`. Delete leaves a gap in `day_index`; `withDreamOrdinals` re-pads display ordinals on read, so gaps are invisible.

- [ ] **Step 1: Add the import**

In the existing import block at the top of `src/lib/trips/actions.ts`, immediately after the `itinerary-types` import (currently lines 14-19), add:

```ts
import {
  rowToDreamDay,
  type DreamDay,
} from "@/lib/trips/dream-itinerary-types"
```

- [ ] **Step 2: Append the four actions at the end of the file**

After the existing `rescheduleItineraryDays` function (the last function in the file), append:

```ts
export interface AddDreamDayInput {
  tripId: string
  tripSlug: string
  title: string
  sub: string
  tag: string
  tone: ItineraryTone
}

export interface AddDreamDayResult {
  error?: string
  /** Populated on success — full DreamDay (d ordinal is placeholder; client re-runs withDreamOrdinals). */
  day?: DreamDay
}

/**
 * Inserts a new dream itinerary day at the end (day_index = max + 1). RLS gates
 * membership. Returns the inserted row as a DreamDay so the client can apply it
 * via withDreamOrdinals optimistically.
 */
export async function addDreamItineraryDay(
  input: AddDreamDayInput,
): Promise<AddDreamDayResult> {
  const title = input.title.trim()
  if (!title) return { error: "Title required." }
  const tag = input.tag.trim()
  if (!tag) return { error: "Tag required." }
  if (!ITINERARY_TONES.includes(input.tone)) return { error: "Invalid tone." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { data: maxRow } = await supabase
    .from("dream_itinerary_days")
    .select("day_index")
    .eq("trip_id", input.tripId)
    .order("day_index", { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextIndex = (maxRow?.day_index ?? 0) + 1

  const sub = input.sub.trim()

  const { data, error } = await supabase
    .from("dream_itinerary_days")
    .insert({
      trip_id: input.tripId,
      day_index: nextIndex,
      title,
      sub,
      tag,
      tone: input.tone,
      created_by: userData.user.id,
    })
    .select("id, day_index, title, sub, tag, tone")
    .single()

  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return { day: rowToDreamDay(data) }
}

export interface UpdateDreamDayInput {
  dayId: string
  tripSlug: string
  title: string
  sub: string
  tag: string
  tone: ItineraryTone
}

export interface UpdateDreamDayResult {
  error?: string
}

/**
 * Edits an existing dream itinerary day. day_index is never user-edited, so no
 * collision concern. created_by and created_at never touched.
 */
export async function updateDreamItineraryDay(
  input: UpdateDreamDayInput,
): Promise<UpdateDreamDayResult> {
  const title = input.title.trim()
  if (!title) return { error: "Title required." }
  const tag = input.tag.trim()
  if (!tag) return { error: "Tag required." }
  if (!ITINERARY_TONES.includes(input.tone)) return { error: "Invalid tone." }

  const supabase = await createClient()
  const sub = input.sub.trim()

  const { error } = await supabase
    .from("dream_itinerary_days")
    .update({
      title,
      sub,
      tag,
      tone: input.tone,
    })
    .eq("id", input.dayId)

  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}

/**
 * Permanently deletes a dream itinerary day. Throws on error (form-action
 * shape). Leaves a gap in day_index; withDreamOrdinals re-pads display ordinals
 * on read, so the gap is invisible.
 */
export async function deleteDreamItineraryDay(
  dayId: string,
  tripSlug: string,
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("dream_itinerary_days")
    .delete()
    .eq("id", dayId)
  if (error) throw new Error(error.message)

  revalidatePath(`/trips/${tripSlug}`)
}

export interface RescheduleDreamResult {
  error?: string
}

/**
 * Insertion-shift reorder: reassigns the trip's existing day_index slots
 * (sorted) to the days in the given id order, via the
 * reschedule_dream_itinerary_days RPC which permutes them atomically under a
 * deferred unique constraint. The Realtime channel broadcasts the UPDATEs.
 */
export async function rescheduleDreamItineraryDays(
  tripId: string,
  tripSlug: string,
  orderedDayIds: string[],
): Promise<RescheduleDreamResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("reschedule_dream_itinerary_days", {
    p_trip_id: tripId,
    p_day_ids: orderedDayIds,
  })
  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}
```

- [ ] **Step 3: Verify build + lint**

Run: `pnpm build && pnpm lint`
Expected: clean. (`ITINERARY_TONES` and `ItineraryTone` are already imported in this file from the existing itinerary import block, so the new actions resolve them.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(itinerary): dream day add/update/delete/reschedule actions"
```

---

### Task 5: Client component — `dream-itinerary-tab.tsx`

**Files:**
- Create: `src/app/trips/[slug]/dream-itinerary-tab.tsx`

Self-contained (per the spec's component-sharing decision). Mirrors `itinerary-tab.tsx`: optimistic state + prop-sync guard, Realtime channel, `@dnd-kit` reorder, add/edit/delete with the `DayView`/`DayEditor` split (React 19 set-state-in-effect lint). Differences from the dated version: no date field/picker, the left column shows only `DAY / {d}` (no weekday line), the card has no top-right date, no `tripStartDate` prop, no `SuggestionCard` (the dated one's was a hardcoded Lombok line — out of scope for dreams).

- [ ] **Step 1: Write the full component**

```tsx
"use client"

import * as React from "react"

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
import { Label, MonoBadge } from "@/components/together"
import { createClient } from "@/lib/supabase/client"
import {
  addDreamItineraryDay,
  deleteDreamItineraryDay,
  rescheduleDreamItineraryDays,
  updateDreamItineraryDay,
} from "@/lib/trips/actions"
import {
  rowToDreamDay,
  withDreamOrdinals,
  type DreamDay,
} from "@/lib/trips/dream-itinerary-types"
import { ITINERARY_TONES, type ItineraryTone } from "@/lib/trips/itinerary-types"

const itineraryBorder: Record<ItineraryTone, string> = {
  sea: "border-l-sea",
  clay: "border-l-clay",
  moss: "border-l-moss",
  sand: "border-l-sand",
}

interface RealtimeRow {
  id: string
  trip_id: string
  day_index: number
  title: string
  sub: string | null
  tag: string
  tone: string
  created_by: string
  created_at: string
}

export function DreamItineraryTab({
  tripId,
  tripSlug,
  initialItems,
}: {
  tripId: string
  tripSlug: string
  initialItems: DreamDay[]
}) {
  const [days, setDays] = React.useState<DreamDay[]>(initialItems)
  const [lastInitial, setLastInitial] = React.useState(initialItems)
  const [editingId, setEditingId] = React.useState<string | null>(null)

  if (initialItems !== lastInitial) {
    setLastInitial(initialItems)
    setDays(initialItems)
  }

  React.useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`dream-itinerary-${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dream_itinerary_days",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const incoming = rowToDreamDay(payload.new as RealtimeRow)
            setDays((prev) =>
              prev.some((d) => d.id === incoming.id)
                ? prev
                : withDreamOrdinals([...prev, incoming]),
            )
          } else if (payload.eventType === "UPDATE") {
            const incoming = rowToDreamDay(payload.new as RealtimeRow)
            setDays((prev) =>
              withDreamOrdinals(
                prev.map((d) => (d.id === incoming.id ? incoming : d)),
              ),
            )
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string }
            if (old.id) {
              setDays((prev) =>
                withDreamOrdinals(prev.filter((d) => d.id !== old.id)),
              )
            }
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tripId])

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
    // The trip's existing day_index values, sorted, are the fixed slots; the
    // card at position i takes slot[i]. withDreamOrdinals re-pads display d.
    const slots = days.map((d) => d.dayIndex).sort((a, b) => a - b)
    const reassigned = withDreamOrdinals(
      reordered.map((d, i) => ({ ...d, dayIndex: slots[i] })),
    )
    setDays(reassigned)

    startReschedule(async () => {
      const result = await rescheduleDreamItineraryDays(
        tripId,
        tripSlug,
        reordered.map((d) => d.id),
      )
      if (result.error) setDays(snapshot)
    })
  }

  return (
    <section>
      <div className="flex items-baseline justify-between px-5 pt-5 lg:px-10 lg:pt-6">
        <Label>Itinerary</Label>
        <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          dream plan
        </span>
      </div>

      <div className="px-5 pt-2.5 lg:px-10">
        {days.length === 0 ? (
          <p className="font-serif text-[15px] italic text-muted-foreground">
            No days dreamed up yet — add the first one.
          </p>
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
                <SortableDreamDayCard
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
      </div>

      <div className="px-5 pt-4 pb-6 lg:px-10">
        <AddDreamDayRow tripId={tripId} tripSlug={tripSlug} />
      </div>
    </section>
  )
}

interface DreamDayCardProps {
  day: DreamDay
  tripSlug: string
  isLast: boolean
  isEditing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  dragHandle?: React.ReactNode
}

function DreamDayCard({
  day,
  tripSlug,
  isLast,
  isEditing,
  onStartEdit,
  onStopEdit,
  dragHandle,
}: DreamDayCardProps) {
  if (isEditing) {
    return <DreamDayEditor day={day} tripSlug={tripSlug} onDone={onStopEdit} />
  }
  return (
    <DreamDayView
      day={day}
      tripSlug={tripSlug}
      isLast={isLast}
      onStartEdit={onStartEdit}
      dragHandle={dragHandle}
    />
  )
}

function SortableDreamDayCard({
  id,
  ...rest
}: DreamDayCardProps & { id: string }) {
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
      aria-label="Drag to reorder day"
      className="cursor-grab touch-none border-0 bg-transparent px-0.5 font-mono text-[12px] leading-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      ⠿
    </button>
  )

  return (
    <div ref={setNodeRef} style={style}>
      <DreamDayCard {...rest} dragHandle={handle} />
    </div>
  )
}

function DreamDayView({
  day,
  tripSlug,
  isLast,
  onStartEdit,
  dragHandle,
}: {
  day: DreamDay
  tripSlug: string
  isLast: boolean
  onStartEdit: () => void
  dragHandle?: React.ReactNode
}) {
  return (
    <div className="relative flex gap-3.5 py-3.5">
      <div className="relative w-9 flex-shrink-0">
        <div className="font-mono text-[9px] uppercase leading-none tracking-[0.14em] text-muted-foreground">
          DAY
        </div>
        <div className="mt-0.5 font-mono text-[22px] leading-none tracking-[-0.02em] text-foreground">
          {day.d}
        </div>
        {!isLast ? (
          <div className="absolute -bottom-3.5 left-[11px] top-9 w-px bg-border" />
        ) : null}
      </div>
      <div
        className={`flex-1 rounded-lg border border-border bg-card px-3.5 py-3 border-l-[3px] ${itineraryBorder[day.tone]}`}
      >
        <div className="mb-1.5 flex items-center gap-1.5">
          {dragHandle}
          <MonoBadge tone={day.tone}>{day.tag}</MonoBadge>
        </div>
        <div className="t-display mb-1 text-[22px] leading-tight text-foreground">
          {day.title}
        </div>
        {day.sub ? (
          <div className="text-[12.5px] leading-snug text-muted-foreground">
            {day.sub}
          </div>
        ) : null}
        <div className="mt-2 flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onStartEdit}
            aria-label="Edit day"
            className="border-0 bg-transparent px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
          >
            ✎
          </button>
          <form
            action={deleteDreamItineraryDay.bind(null, day.id, tripSlug)}
            onSubmit={(e) => {
              if (!window.confirm("Delete this day? This can't be undone.")) {
                e.preventDefault()
              }
            }}
            className="inline-flex"
          >
            <button
              type="submit"
              aria-label="Delete day"
              className="border-0 bg-transparent px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-clay"
            >
              ×
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function DreamDayEditor({
  day,
  tripSlug,
  onDone,
}: {
  day: DreamDay
  tripSlug: string
  onDone: () => void
}) {
  const [tag, setTag] = React.useState(day.tag)
  const [title, setTitle] = React.useState(day.title)
  const [sub, setSub] = React.useState(day.sub)
  const [tone, setTone] = React.useState<ItineraryTone>(day.tone)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !title.trim() || !tag.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await updateDreamItineraryDay({
        dayId: day.id,
        tripSlug,
        title,
        sub,
        tag,
        tone,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      onDone()
    })
  }

  return (
    <DreamDayForm
      heading="Edit day"
      tag={tag}
      setTag={setTag}
      title={title}
      setTitle={setTitle}
      sub={sub}
      setSub={setSub}
      tone={tone}
      setTone={setTone}
      error={error}
      isPending={isPending}
      submitLabel="save"
      onSubmit={save}
      onCancel={onDone}
    />
  )
}

function AddDreamDayRow({
  tripId,
  tripSlug,
}: {
  tripId: string
  tripSlug: string
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [tag, setTag] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [sub, setSub] = React.useState("")
  const [tone, setTone] = React.useState<ItineraryTone>("sea")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function reset() {
    setExpanded(false)
    setTag("")
    setTitle("")
    setSub("")
    setTone("sea")
    setError(null)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !title.trim() || !tag.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await addDreamItineraryDay({
        tripId,
        tripSlug,
        title,
        sub,
        tag,
        tone,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      reset()
    })
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="block w-full rounded-lg border border-dashed border-rule py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"
      >
        + add day
      </button>
    )
  }

  return (
    <DreamDayForm
      heading="Add day"
      tag={tag}
      setTag={setTag}
      title={title}
      setTitle={setTitle}
      sub={sub}
      setSub={setSub}
      tone={tone}
      setTone={setTone}
      error={error}
      isPending={isPending}
      submitLabel="add"
      onSubmit={submit}
      onCancel={reset}
    />
  )
}

function DreamDayForm({
  heading,
  tag,
  setTag,
  title,
  setTitle,
  sub,
  setSub,
  tone,
  setTone,
  error,
  isPending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  heading: string
  tag: string
  setTag: (s: string) => void
  title: string
  setTitle: (s: string) => void
  sub: string
  setSub: (s: string) => void
  tone: ItineraryTone
  setTone: (t: ItineraryTone) => void
  error: string | null
  isPending: boolean
  submitLabel: string
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-clay bg-card p-3.5"
    >
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        / {heading}
      </div>

      <label className="block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Tag
        </span>
        <input
          type="text"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          disabled={isPending}
          className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] uppercase text-foreground placeholder:normal-case placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
      </label>

      <label className="mt-3 block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Title
        </span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isPending}
          className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[16px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
      </label>

      <label className="mt-3 block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Sub
        </span>
        <input
          type="text"
          value={sub}
          onChange={(e) => setSub(e.target.value)}
          placeholder="Optional"
          disabled={isPending}
          className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
      </label>

      <div className="mt-4">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Tone
        </span>
        <div className="mt-1.5 flex gap-1.5">
          {ITINERARY_TONES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTone(t)}
              disabled={isPending}
              aria-pressed={tone === t}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors disabled:opacity-50 ${
                tone === t
                  ? "border-foreground bg-foreground text-background"
                  : "border-rule bg-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className={`h-2 w-2 rounded-full bg-${t}`} aria-hidden />
              {t}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="mt-3 font-mono text-[10px] text-clay">{error}</div>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          cancel
        </button>
        <button
          type="submit"
          disabled={isPending || !title.trim() || !tag.trim()}
          className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : submitLabel}
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Verify build + lint**

Run: `pnpm build && pnpm lint`
Expected: clean. The component isn't rendered yet (Task 6 wires it), but it must type-check and lint. Watch for the React 19 set-state-in-effect lint — the `DreamDayEditor`/`AddDreamDayRow` split (local state seeded from props on mount, no reset effect) is what avoids it; do not add a `useEffect` to sync form fields.

- [ ] **Step 3: Commit**

```bash
git add "src/app/trips/[slug]/dream-itinerary-tab.tsx"
git commit -m "feat(itinerary): DreamItineraryTab client component"
```

---

### Task 6: Wire `page.tsx` — render the dream tab, delete the stub

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx`

Branch the itinerary fetch + render on `header.startDate === null`. To keep types clean (no casts), fetch the dated and dream itineraries into two separate `Promise.all` slots — each stays strongly typed (`ItineraryDay[] | null` vs `DreamDay[] | null`).

- [ ] **Step 1: Add the two imports**

After the existing `getItineraryDays` import (line 20: `import { getItineraryDays } from "@/lib/trips/itinerary-queries"`), add:

```ts
import { getDreamItineraryDays } from "@/lib/trips/dream-itinerary-queries"
```

After the existing `ItineraryTab` import (line 30: `import { ItineraryTab } from "./itinerary-tab"`), add:

```ts
import { DreamItineraryTab } from "./dream-itinerary-tab"
```

- [ ] **Step 2: Split the itinerary fetch**

Replace the `Promise.all` block (currently lines 136-143):

```ts
  const [itinerary, notes, packingItems, packingCategories, expenses] =
    await Promise.all([
      activeTab === "itinerary" ? getItineraryDays(header.id) : Promise.resolve(null),
      activeTab === "notes" ? getTripNotes(header.id) : Promise.resolve(null),
      getPackingItems(header.id),
      getPackingCategories(header.id),
      getTripExpenses(header.id),
    ])
```

with:

```ts
  const showItinerary = activeTab === "itinerary"
  const isDream = header.startDate === null
  const [datedItinerary, dreamItinerary, notes, packingItems, packingCategories, expenses] =
    await Promise.all([
      showItinerary && !isDream ? getItineraryDays(header.id) : Promise.resolve(null),
      showItinerary && isDream ? getDreamItineraryDays(header.id) : Promise.resolve(null),
      activeTab === "notes" ? getTripNotes(header.id) : Promise.resolve(null),
      getPackingItems(header.id),
      getPackingCategories(header.id),
      getTripExpenses(header.id),
    ])
```

- [ ] **Step 3: Update the itinerary tab count**

Replace the counts line (currently line 160):

```ts
            itinerary: itinerary?.length ?? null,
```

with:

```ts
            itinerary: (datedItinerary ?? dreamItinerary)?.length ?? null,
```

- [ ] **Step 4: Swap the render branch**

Replace the itinerary render block (currently lines 171-182):

```tsx
        {activeTab === "itinerary" ? (
          header.startDate === null ? (
            <DreamItineraryStub />
          ) : (
            <ItineraryTab
              tripId={header.id}
              tripSlug={header.slug}
              tripStartDate={header.startDate}
              initialItems={itinerary ?? []}
            />
          )
        ) : null}
```

with:

```tsx
        {activeTab === "itinerary" ? (
          header.startDate === null ? (
            <DreamItineraryTab
              tripId={header.id}
              tripSlug={header.slug}
              initialItems={dreamItinerary ?? []}
            />
          ) : (
            <ItineraryTab
              tripId={header.id}
              tripSlug={header.slug}
              tripStartDate={header.startDate}
              initialItems={datedItinerary ?? []}
            />
          )
        ) : null}
```

- [ ] **Step 5: Delete the now-unused `DreamItineraryStub`**

Remove the `DreamItineraryStub` function (currently lines 326-335):

```tsx
function DreamItineraryStub() {
  return (
    <section className="px-5 pt-6">
      <Label>Itinerary</Label>
      <p className="mt-3 font-serif text-[15px] italic text-muted-foreground">
        No days planned yet — add dates to plan day-by-day.
      </p>
    </section>
  )
}
```

If `Label` becomes unused in `page.tsx` after this deletion, remove it from its import too (build/lint will flag it; check whether other call sites in the file still use `Label` before removing the import).

- [ ] **Step 6: Verify build + lint**

Run: `pnpm build && pnpm lint`
Expected: clean. The mobile `WeatherStrip` block (lines 166-170) already guards on `header.startDate`, so dreams correctly render no weather strip — no change needed there.

- [ ] **Step 7: Commit**

```bash
git add "src/app/trips/[slug]/page.tsx"
git commit -m "feat(itinerary): render dream itinerary tab, drop stub"
```

---

### Task 7: Final verification + docs

**Files:**
- Modify: `docs/TODO.md` (check off Slice B; carry Slice B.2)
- Modify: `docs/DECISIONS.md` (append a row)

- [ ] **Step 1: Full build + lint**

Run: `pnpm build && pnpm lint`
Expected: both clean.

- [ ] **Step 2: Manual in-app verification**

Paste `supabase/migrations/20260530000001_slice_b_dream_itinerary.sql` into the Supabase SQL Editor first. Then `pnpm dev` and, on a dream trip (a trip with no dates, e.g. one of the seeded dreams) at `/trips/<slug>` (itinerary is the default tab):
  - Empty state shows "No days dreamed up yet — add the first one." with the dashed `+ add day` row.
  - Add a day (tag + title + tone, optional sub) → appears as DAY 01.
  - Add two more → DAY 02 / 03, contiguous ordinals.
  - Edit a day (`✎`) → save reflects immediately.
  - Drag the `⠿` handle to reorder → ordinals re-number; reload keeps the new order.
  - Delete a day (`×`, confirm) → remaining days re-number contiguously (no visible gap).
  - The Itinerary tab count reads "N days".
  - Open the same dream on a second device/browser → adds/edits/reorders/deletes sync live.
  - Sanity check a dated trip's itinerary still works unchanged (add/edit/delete/drag).

- [ ] **Step 3: Update `docs/TODO.md`**

In the "Phase 4.6 — Itinerary Editing" section, change the `Slice B` bullet from open to done. Replace:

```markdown
- **Slice B — Itinerary for dreams** (numbered days 1, 2, 3…). Real schema decision: relax `itinerary_days.day_date NOT NULL` and add a `day_index int` column (single-table option), or add a parallel `dream_itinerary` sub-table (two-table option). Brainstorm separately; pick after the Lombok trip surfaces whether numbered days is even the right frame for dreams.
```

with:

```markdown
- [x] **Slice B — Itinerary for dreams.** Done 2026-05-30. Numbered days (1, 2, 3…) for dateless dreams via a parallel `dream_itinerary_days` table keyed on `(trip_id, day_index)` — dated `itinerary_days` untouched. New `dream-itinerary-types.ts` (`DreamDay` / `rowToDreamDay` / `withDreamOrdinals`) + `dream-itinerary-queries.ts` + four Server Actions (`addDreamItineraryDay` / `updateDreamItineraryDay` / `deleteDreamItineraryDay` / `rescheduleDreamItineraryDays`). `DreamItineraryTab` mirrors `ItineraryTab` minus the calendar (no date field, `DAY / 01` left column, no weather/suggestion card); drag-to-reorder permutes `day_index` via the deferred-unique `reschedule_dream_itinerary_days` RPC. Realtime channel on `dream_itinerary_days`. Spec + plan under `docs/superpowers/`. **User action required**: paste `supabase/migrations/20260530000001_slice_b_dream_itinerary.sql` into the Supabase SQL Editor.
- **Slice B.2 — Promotion converts dream days to dated days** (open, designed in the Slice B spec). Adding a start date to a dream moves its `dream_itinerary_days` rows into `itinerary_days` with consecutive dates from the start; end date auto-derives to start + (count − 1). No schema change. Build next.
```

- [ ] **Step 4: Append a row to `docs/DECISIONS.md`**

Match the existing table/row format in that file. Add a row capturing: dream itineraries use a **separate `dream_itinerary_days` table** (not a nullable `day_date` on `itinerary_days`) — keeps the working dated path free of `null`-date forking, at the cost of a parallel query/action/component layer; reorder mirrors Slice C's deferred-unique permute on `day_index`.

- [ ] **Step 5: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record Slice B dream itinerary"
```

---

## Self-Review (completed during plan authoring)

- **Spec coverage:** §1 data model → Task 1; §2 types → Task 2; §2 query → Task 3; §3 actions → Task 4; §4 client component → Task 5; §5 page wiring + stub deletion → Task 6; docs/verification → Task 7. Slice B.2 is explicitly out of scope (its own future plan). No gaps.
- **Placeholder scan:** No TBD/TODO/"handle errors"/"similar to" — every code step is complete and copy-ready.
- **Type consistency:** `DreamDay` / `DreamRow` / `rowToDreamDay` / `withDreamOrdinals` are defined in Task 2 and referenced identically in Tasks 3-5. Action names (`addDreamItineraryDay` / `updateDreamItineraryDay` / `deleteDreamItineraryDay` / `rescheduleDreamItineraryDays`) match between Task 4 (definition) and Task 5 (import). RPC name `reschedule_dream_itinerary_days` matches between Task 1 (definition) and Task 4 (caller). Table name `dream_itinerary_days` consistent across Tasks 1, 3, 4, 5.
