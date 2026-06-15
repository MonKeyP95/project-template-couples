# Semi-private Packing Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the per-trip packing list into three owner-scoped views — My list (semi-private), Shared, and Partner's list — selected by a switcher that replaces the progress bar.

**Architecture:** Add a nullable `owner_id` to `packing_items` and `packing_categories` (`null` = shared, a user id = personal). The three views are the same two tables filtered by owner. Privacy is UI-only; RLS stays member-gated for reads so either partner *can* view both lists, with an insert check preventing creation of rows owned by someone else.

**Tech Stack:** Next.js 16 App Router, React 19 client component, Supabase (Postgres + RLS + Realtime), `@dnd-kit` for category reorder, Tailwind v4.

**Testing note:** This repo has **no test runner** (per `CLAUDE.md` — do not invent one). Each task is verified with `pnpm lint`, `pnpm build`, and an explicit manual browser check. The DB migration is **applied by hand** in the Supabase SQL editor (no migration tooling); committing the `.sql` file does not touch the database.

---

## File Structure

- `supabase/migrations/20260615000001_packing_owner.sql` — **new.** Adds `owner_id` to both tables, swaps the category unique constraint to `nulls not distinct`, tightens insert RLS. Idempotent.
- `src/lib/trips/packing-types.ts` — **modify.** Add `ownerId` to both types; add pure `partitionByOwner` helper.
- `src/lib/trips/packing-queries.ts` — **modify.** Select `owner_id`, map to `ownerId`.
- `src/lib/trips/actions.ts` — **modify.** `owner` param on `addPackingItem` / `addPackingCategory`; owner-scoped sort order and category delete; shared-only `copyPackingFromTrip`.
- `src/app/trips/[slug]/packing-tab.tsx` — **modify.** Three-way switcher, owner partition, per-view `PackingList`, partner confirm gate + read-only partner view, `owner_id` in realtime mapping.
- `src/app/trips/[slug]/page.tsx` — **modify.** Pass `currentUserId` + `partnerId` to `PackingTab`; scope the right-rail packing count to shared + me.
- `docs/TODO.md`, `docs/DECISIONS.md` — **modify** on completion.

---

## Task 1: Database migration (owner_id + RLS)

**Files:**
- Create: `supabase/migrations/20260615000001_packing_owner.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Semi-private packing: add owner_id to packing_items and packing_categories.
-- null owner_id = shared (today's behaviour); a user id = personal/semi-private.
-- Privacy is UI-only; select stays member-gated so either partner can view both
-- lists. Insert is tightened so you can only create shared rows or rows you own.
-- Idempotent: safe to paste-and-run repeatedly.

alter table public.packing_items
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

alter table public.packing_categories
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

create index if not exists packing_items_owner_idx
  on public.packing_items (trip_id, owner_id);
create index if not exists packing_categories_owner_idx
  on public.packing_categories (trip_id, owner_id);

-- Swap unique(trip_id, name) -> unique nulls not distinct(trip_id, owner_id, name)
-- so each owner (and the shared scope) gets its own "Clothes" without collision,
-- while two shared "Clothes" still collide (NULLS NOT DISTINCT, Postgres 15+).
alter table public.packing_categories
  drop constraint if exists packing_categories_trip_id_name_key;
alter table public.packing_categories
  drop constraint if exists packing_categories_trip_owner_name_key;
alter table public.packing_categories
  add constraint packing_categories_trip_owner_name_key
  unique nulls not distinct (trip_id, owner_id, name);

-- Tighten insert RLS on both tables: member AND (shared OR owned by caller).
drop policy if exists packing_items_insert on public.packing_items;
create policy packing_items_insert on public.packing_items
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id)
    and added_by = auth.uid()
    and (owner_id is null or owner_id = auth.uid())
  );

drop policy if exists packing_categories_insert on public.packing_categories;
create policy packing_categories_insert on public.packing_categories
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id)
    and (owner_id is null or owner_id = auth.uid())
  );
```

- [ ] **Step 2: Apply it by hand**

Open the Supabase SQL editor for this project and paste-run the file. (There is no migration CLI in this repo; committing the file does nothing to the DB.)

- [ ] **Step 3: Verify the columns and constraint exist**

Run in the SQL editor:

```sql
select column_name from information_schema.columns
where table_name in ('packing_items','packing_categories') and column_name = 'owner_id';
-- Expected: two rows.

select conname from pg_constraint where conname = 'packing_categories_trip_owner_name_key';
-- Expected: one row.
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260615000001_packing_owner.sql
git commit -m "feat(db): add owner_id to packing tables for semi-private lists"
```

---

## Task 2: Types + query + partition helper

**Files:**
- Modify: `src/lib/trips/packing-types.ts`
- Modify: `src/lib/trips/packing-queries.ts`

- [ ] **Step 1: Add `ownerId` to both types**

In `packing-types.ts`, add the field to each interface:

```ts
export interface PackingItem {
  id: string
  tripId: string
  category: string
  label: string
  done: boolean
  addedBy: string
  ownerId: string | null
  createdAt: string
}

export interface PackingCategory {
  id: string
  tripId: string
  name: string
  sortOrder: number
  ownerId: string | null
}
```

- [ ] **Step 2: Add the `partitionByOwner` helper**

Append to `packing-types.ts`:

```ts
export interface OwnerScope {
  categories: PackingCategory[]
  items: PackingItem[]
}

/**
 * Splits the trip's packing rows into the three views by owner. `null` owner is
 * shared; `meId` is the current user's personal list; `partnerId` (when present)
 * is the partner's. Pure — the client derives the three scopes on each render.
 */
export function partitionByOwner(
  categories: PackingCategory[],
  items: PackingItem[],
  meId: string,
  partnerId: string | null,
): { shared: OwnerScope; mine: OwnerScope; partner: OwnerScope } {
  const pick = (owner: string | null): OwnerScope => ({
    categories: categories.filter((c) => c.ownerId === owner),
    items: items.filter((i) => i.ownerId === owner),
  })
  return {
    shared: pick(null),
    mine: pick(meId),
    partner: partnerId ? pick(partnerId) : { categories: [], items: [] },
  }
}
```

- [ ] **Step 3: Select and map `owner_id` in the queries**

In `packing-queries.ts`, add `owner_id` to both selects and both row mappers:

```ts
// getPackingItems: select string
.select("id, trip_id, category, label, done, added_by, owner_id, created_at")
// getPackingItems: mapper gains
ownerId: row.owner_id,

// getPackingCategories: select string
.select("id, trip_id, name, sort_order, owner_id")
// getPackingCategories: mapper gains
ownerId: row.owner_id,
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm lint`
Expected: no errors. (Type errors for missing `ownerId` will surface in `packing-tab.tsx` next task — that's fine; lint here only covers these two files' syntax.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/packing-types.ts src/lib/trips/packing-queries.ts
git commit -m "feat(packing): surface owner_id and add partitionByOwner helper"
```

---

## Task 3: Server actions (owner-aware)

**Files:**
- Modify: `src/lib/trips/actions.ts`

- [ ] **Step 1: Add `owner` param to `addPackingItem`**

Replace the `addPackingItem` body's signature and insert:

```ts
export async function addPackingItem(
  tripId: string,
  category: string,
  label: string,
  owner: string | null,
): Promise<AddPackingItemResult> {
  const trimmed = label.trim()
  if (!trimmed) return { error: "Label required." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { error } = await supabase.from("packing_items").insert({
    trip_id: tripId,
    category,
    label: trimmed,
    added_by: userData.user.id,
    owner_id: owner,
  })

  if (error) return { error: error.message }
  return {}
}
```

- [ ] **Step 2: Make `addPackingCategory` owner-scoped**

Replace its signature and the sort-order query + insert so order restarts per owner:

```ts
export async function addPackingCategory(
  tripId: string,
  tripSlug: string,
  name: string,
  owner: string | null,
): Promise<AddPackingCategoryResult> {
  const trimmed = name.trim()
  if (!trimmed) return { error: "Name required." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const maxQuery = supabase
    .from("packing_categories")
    .select("sort_order")
    .eq("trip_id", tripId)
    .order("sort_order", { ascending: false })
    .limit(1)
  const { data: maxRow } = await (owner === null
    ? maxQuery.is("owner_id", null)
    : maxQuery.eq("owner_id", owner)
  ).maybeSingle()
  const nextOrder = (maxRow?.sort_order ?? -1) + 1

  const { data, error } = await supabase
    .from("packing_categories")
    .insert({
      trip_id: tripId,
      name: trimmed,
      sort_order: nextOrder,
      created_by: userData.user.id,
      owner_id: owner,
    })
    .select("id, trip_id, name, sort_order, owner_id")
    .single()

  if (error) return { error: error.message }
  return {
    category: {
      id: data.id,
      tripId: data.trip_id,
      name: data.name,
      sortOrder: data.sort_order,
      ownerId: data.owner_id,
    },
  }
}
```

(If the existing `.select(...)` already returns the row, just add `owner_id` to it and `ownerId: data.owner_id` to the returned object — keep the rest of the function as-is.)

- [ ] **Step 3: Scope `deletePackingCategory` to the category's owner**

The current delete removes items by `trip_id` + `category` name, which would wipe a same-named category in another scope. Filter by the category's `owner_id` too:

```ts
export async function deletePackingCategory(
  categoryId: string,
  tripSlug: string,
): Promise<DeletePackingCategoryResult> {
  const supabase = await createClient()

  const { data: cat, error: catError } = await supabase
    .from("packing_categories")
    .select("trip_id, name, owner_id")
    .eq("id", categoryId)
    .maybeSingle()
  if (catError) return { error: catError.message }
  if (!cat) return {}

  const itemsDelete = supabase
    .from("packing_items")
    .delete()
    .eq("trip_id", cat.trip_id)
    .eq("category", cat.name)
  const { error: itemsError } = await (cat.owner_id === null
    ? itemsDelete.is("owner_id", null)
    : itemsDelete.eq("owner_id", cat.owner_id))
  if (itemsError) return { error: itemsError.message }

  const { error } = await supabase
    .from("packing_categories")
    .delete()
    .eq("id", categoryId)
  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}
```

- [ ] **Step 4: Make `copyPackingFromTrip` copy only the shared list**

In `copyPackingFromTrip`, scope both the source category and source item reads to shared rows, and insert copies with `owner_id: null`. Add `.is("owner_id", null)` to the source `packing_categories` and `packing_items` selects, and ensure inserted rows set `owner_id: null` (add the field to the insert objects). Leave the rest of the copy logic unchanged.

- [ ] **Step 5: Verify it compiles**

Run: `pnpm lint`
Expected: errors only in `packing-tab.tsx` for the not-yet-updated `addPackingItem` / `addPackingCategory` call sites. Those are fixed in Task 4.

- [ ] **Step 6: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(packing): owner-aware add/delete actions, shared-only copy"
```

---

## Task 4: PackingTab — switcher, partition, per-view list, partner gate

**Files:**
- Modify (full rewrite): `src/app/trips/[slug]/packing-tab.tsx`

This task replaces the whole file. The orchestrator (`PackingTab`) owns state, realtime, and the switcher; a new `PackingList` renders one owner scope; the existing sub-components gain `readOnly`/`owner` threading.

- [ ] **Step 1: Replace `packing-tab.tsx` with the full content below**

```tsx
"use client"

import * as React from "react"

import { CheckRow, Coord, Label, SuggestionCard, TopoBg } from "@/components/together"
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
import { createClient } from "@/lib/supabase/client"
import {
  addPackingCategory,
  addPackingItem,
  copyPackingFromTrip,
  deletePackingCategory,
  deletePackingItem,
  reorderPackingCategories,
  togglePackingItem,
  updatePackingItem,
} from "@/lib/trips/actions"
import { ImportFromTripControl } from "./import-from-trip"
import {
  groupPackingItems,
  partitionByOwner,
  type OwnerScope,
  type PackingCategory,
  type PackingItem,
} from "@/lib/trips/packing-types"

export interface MemberToneEntry {
  initial: string
  displayName: string
  tone: "sea" | "clay"
}

export interface PackingTabProps {
  tripId: string
  tripSlug: string
  currentUserId: string
  partnerId: string | null
  initialItems: PackingItem[]
  initialCategories: PackingCategory[]
  members: Record<string, MemberToneEntry>
  daysOut: number | null
}

interface RealtimeRow {
  id: string
  trip_id: string
  category: string
  label: string
  done: boolean
  added_by: string
  owner_id: string | null
  created_at: string
}

function fromRow(row: RealtimeRow): PackingItem {
  return {
    id: row.id,
    tripId: row.trip_id,
    category: row.category,
    label: row.label,
    done: row.done,
    addedBy: row.added_by,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  }
}

type View = "mine" | "shared" | "partner"

export function PackingTab({
  tripId,
  tripSlug,
  currentUserId,
  partnerId,
  initialItems,
  initialCategories,
  members,
  daysOut,
}: PackingTabProps) {
  const [items, setItems] = React.useState<PackingItem[]>(initialItems)
  const [lastInitial, setLastInitial] = React.useState(initialItems)
  const [categories, setCategories] =
    React.useState<PackingCategory[]>(initialCategories)
  const [lastCategories, setLastCategories] = React.useState(initialCategories)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [view, setView] = React.useState<View>("shared")
  const [partnerUnlocked, setPartnerUnlocked] = React.useState(false)

  // Sync local state when the server re-fetches (RefreshOnVisible after the tab
  // returns from background, where Realtime may have missed events).
  if (initialItems !== lastInitial) {
    setLastInitial(initialItems)
    setItems(initialItems)
  }
  if (initialCategories !== lastCategories) {
    setLastCategories(initialCategories)
    setCategories(initialCategories)
  }

  React.useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`packing-${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "packing_items",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            const next = fromRow(payload.new as RealtimeRow)
            setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)))
          } else if (payload.eventType === "INSERT") {
            const next = fromRow(payload.new as RealtimeRow)
            setItems((prev) =>
              prev.some((i) => i.id === next.id) ? prev : [...prev, next],
            )
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string }
            if (old.id) setItems((prev) => prev.filter((i) => i.id !== old.id))
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tripId])

  async function toggle(id: string) {
    const current = items.find((i) => i.id === id)
    if (!current) return
    const next = !current.done
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: next } : i)))
    const result = await togglePackingItem(id, next)
    if (result.error) {
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, done: current.done } : i)),
      )
    }
  }

  async function update(id: string, label: string): Promise<{ error?: string }> {
    const current = items.find((i) => i.id === id)
    if (!current) return {}
    const trimmed = label.trim()
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, label: trimmed } : i)),
    )
    const result = await updatePackingItem(id, trimmed)
    if (result.error) {
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, label: current.label } : i)),
      )
    }
    return result
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this item?")) return
    const snapshot = items
    setItems((prev) => prev.filter((i) => i.id !== id))
    const result = await deletePackingItem(id)
    if (result.error) setItems(snapshot)
  }

  async function addCategory(
    name: string,
    owner: string | null,
  ): Promise<{ error?: string }> {
    const result = await addPackingCategory(tripId, tripSlug, name, owner)
    if (result.error) return { error: result.error }
    if (result.category) {
      const created = result.category
      setCategories((prev) => [...prev, created])
    }
    return {}
  }

  async function removeCategory(
    categoryId: string,
    name: string,
    count: number,
    owner: string | null,
  ) {
    const msg =
      count > 0
        ? `Delete '${name}' and its ${count} item${count === 1 ? "" : "s"}?`
        : `Delete '${name}'?`
    if (!window.confirm(msg)) return

    const catSnapshot = categories
    const itemSnapshot = items
    setCategories((prev) => prev.filter((c) => c.id !== categoryId))
    setItems((prev) =>
      prev.filter((i) => !(i.category === name && i.ownerId === owner)),
    )

    const result = await deletePackingCategory(categoryId, tripSlug)
    if (result.error) {
      setCategories(catSnapshot)
      setItems(itemSnapshot)
    }
  }

  const [, startReorder] = React.useTransition()

  function reorder(owner: string | null, orderedIds: string[]) {
    const snapshot = categories
    const orderMap = new Map(orderedIds.map((id, i) => [id, i]))
    const reorderedScope = categories
      .filter((c) => c.ownerId === owner)
      .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))
    let k = 0
    const next = categories.map((c) =>
      c.ownerId === owner ? reorderedScope[k++] : c,
    )
    setCategories(next)
    startReorder(async () => {
      const result = await reorderPackingCategories(tripSlug, orderedIds)
      if (result.error) setCategories(snapshot)
    })
  }

  const parts = partitionByOwner(categories, items, currentUserId, partnerId)
  const partnerName = partnerId ? members[partnerId]?.displayName ?? "Partner" : null
  const daysOutLabel = daysOut == null ? null : `${Math.max(0, daysOut)} days out`

  function openPartner() {
    if (!partnerName) return
    if (partnerUnlocked) {
      setView("partner")
      return
    }
    if (window.confirm(`This is ${partnerName}'s list — open it?`)) {
      setPartnerUnlocked(true)
      setView("partner")
    }
  }

  const active: { scope: OwnerScope; owner: string | null; readOnly: boolean } =
    view === "mine"
      ? { scope: parts.mine, owner: currentUserId, readOnly: false }
      : view === "partner"
        ? { scope: parts.partner, owner: partnerId, readOnly: true }
        : { scope: parts.shared, owner: null, readOnly: false }

  return (
    <section>
      <div className="relative overflow-hidden bg-clay-tint px-5 pt-6 pb-4">
        <TopoBg tone="clay" opacity={0.1} />
        <div className="relative flex items-start justify-between">
          <Label>Packing</Label>
          {daysOutLabel ? <Coord>{daysOutLabel}</Coord> : null}
        </div>
        <div className="relative mt-3 flex gap-1.5">
          <SegBtn active={view === "mine"} onClick={() => setView("mine")}>
            My list
          </SegBtn>
          <SegBtn active={view === "shared"} onClick={() => setView("shared")}>
            Shared
          </SegBtn>
          {partnerName ? (
            <SegBtn active={view === "partner"} onClick={openPartner}>
              {partnerName}&rsquo;s list
            </SegBtn>
          ) : null}
        </div>
      </div>

      <div className="border-t border-border bg-background">
        <PackingList
          key={view}
          tripId={tripId}
          owner={active.owner}
          readOnly={active.readOnly}
          categories={active.scope.categories}
          items={active.scope.items}
          members={members}
          editingId={editingId}
          onToggle={toggle}
          onStartEdit={setEditingId}
          onStopEdit={() => setEditingId(null)}
          onUpdate={update}
          onDelete={remove}
          onAddCategory={addCategory}
          onRemoveCategory={removeCategory}
          onReorder={reorder}
          onCopyShared={(src) => copyPackingFromTrip(tripId, src, tripSlug)}
        />
      </div>
    </section>
  )
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors " +
        (active
          ? "border-clay bg-clay text-background"
          : "border-rule bg-transparent text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  )
}

interface PackingListProps {
  tripId: string
  owner: string | null
  readOnly: boolean
  categories: PackingCategory[]
  items: PackingItem[]
  members: Record<string, MemberToneEntry>
  editingId: string | null
  onToggle: (id: string) => void
  onStartEdit: (id: string) => void
  onStopEdit: () => void
  onUpdate: (id: string, label: string) => Promise<{ error?: string }>
  onDelete: (id: string) => void
  onAddCategory: (name: string, owner: string | null) => Promise<{ error?: string }>
  onRemoveCategory: (
    id: string,
    name: string,
    count: number,
    owner: string | null,
  ) => void
  onReorder: (owner: string | null, orderedIds: string[]) => void
  onCopyShared: (sourceTripId: string) => Promise<{ error?: string }>
}

function PackingList({
  tripId,
  owner,
  readOnly,
  categories,
  items,
  members,
  editingId,
  onToggle,
  onStartEdit,
  onStopEdit,
  onUpdate,
  onDelete,
  onAddCategory,
  onRemoveCategory,
  onReorder,
  onCopyShared,
}: PackingListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )
  const dndId = React.useId()

  const groups = groupPackingItems(categories, items)
  const sortableGroups = groups.filter((g) => g.categoryId)
  const orphanGroups = groups.filter((g) => !g.categoryId)

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = sortableGroups.map((g) => g.categoryId as string)
    const oldIndex = ids.indexOf(active.id as string)
    const newIndex = ids.indexOf(over.id as string)
    if (oldIndex === -1 || newIndex === -1) return
    onReorder(owner, arrayMove(ids, oldIndex, newIndex))
  }

  if (readOnly) {
    if (groups.length === 0) {
      return (
        <div className="px-5 py-10 text-center font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          Nothing here yet
        </div>
      )
    }
    return (
      <>
        {groups.map((g) => (
          <CategoryGroup
            key={g.categoryId ?? `orphan:${g.category}`}
            tripId={tripId}
            owner={owner}
            readOnly
            categoryId={g.categoryId}
            category={g.category}
            items={g.items}
            members={members}
            editingId={editingId}
            onToggle={onToggle}
            onStartEdit={onStartEdit}
            onStopEdit={onStopEdit}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onDeleteCategory={onRemoveCategory}
          />
        ))}
      </>
    )
  }

  return (
    <>
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={sortableGroups.map((g) => g.categoryId as string)}
          strategy={verticalListSortingStrategy}
        >
          {sortableGroups.map((g) => (
            <SortableCategoryGroup
              key={g.categoryId as string}
              id={g.categoryId as string}
              tripId={tripId}
              owner={owner}
              readOnly={false}
              categoryId={g.categoryId}
              category={g.category}
              items={g.items}
              members={members}
              editingId={editingId}
              onToggle={onToggle}
              onStartEdit={onStartEdit}
              onStopEdit={onStopEdit}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onDeleteCategory={onRemoveCategory}
            />
          ))}
        </SortableContext>
      </DndContext>

      {orphanGroups.map((g) => (
        <CategoryGroup
          key={`orphan:${g.category}`}
          tripId={tripId}
          owner={owner}
          readOnly={false}
          categoryId={null}
          category={g.category}
          items={g.items}
          members={members}
          editingId={editingId}
          onToggle={onToggle}
          onStartEdit={onStartEdit}
          onStopEdit={onStopEdit}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDeleteCategory={onRemoveCategory}
        />
      ))}

      <div className="px-5 pt-4">
        <AddCategoryRow onAdd={(name) => onAddCategory(name, owner)} />
      </div>

      {owner === null ? (
        <div className="px-5 pt-2">
          <ImportFromTripControl
            tripId={tripId}
            label="Copy packing from another trip"
            onCopy={onCopyShared}
          />
        </div>
      ) : null}

      <div className="px-5 pt-4 pb-6">
        <SuggestionCard label="/ suggested for Rinjani" expandable>
          Nights drop to 4&deg;C at the crater.{" "}
          <span className="font-serif italic text-foreground">
            Consider a packable down layer + thermal liner.
          </span>
        </SuggestionCard>
      </div>
    </>
  )
}

interface CategoryGroupProps {
  tripId: string
  owner: string | null
  readOnly: boolean
  categoryId: string | null
  category: string
  items: PackingItem[]
  members: Record<string, MemberToneEntry>
  editingId: string | null
  onToggle: (id: string) => void
  onStartEdit: (id: string) => void
  onStopEdit: () => void
  onUpdate: (id: string, label: string) => Promise<{ error?: string }>
  onDelete: (id: string) => void
  onDeleteCategory: (
    id: string,
    name: string,
    count: number,
    owner: string | null,
  ) => void
  dragHandle?: React.ReactNode
}

function CategoryGroup({
  tripId,
  owner,
  readOnly,
  categoryId,
  category,
  items,
  members,
  editingId,
  onToggle,
  onStartEdit,
  onStopEdit,
  onUpdate,
  onDelete,
  onDeleteCategory,
  dragHandle,
}: CategoryGroupProps) {
  const done = items.filter((i) => i.done).length
  return (
    <div className="border-b border-border px-5 pt-4 pb-1.5">
      <div className="mb-0.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {dragHandle}
          <Label>{category}</Label>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {done} / {items.length}
          </span>
          {categoryId && !readOnly ? (
            <button
              type="button"
              onClick={() =>
                onDeleteCategory(categoryId, category, items.length, owner)
              }
              aria-label="Delete category"
              className="border-0 bg-transparent px-1 font-mono text-[12px] text-muted-foreground hover:text-clay"
            >
              &times;
            </button>
          ) : null}
        </div>
      </div>
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          member={members[item.addedBy]}
          readOnly={readOnly}
          isEditing={editingId === item.id}
          onToggle={() => onToggle(item.id)}
          onStartEdit={() => onStartEdit(item.id)}
          onStopEdit={onStopEdit}
          onUpdate={onUpdate}
          onDelete={() => onDelete(item.id)}
        />
      ))}
      {readOnly ? null : (
        <AddItemRow tripId={tripId} owner={owner} category={category} />
      )}
    </div>
  )
}

function SortableCategoryGroup({
  id,
  ...rest
}: CategoryGroupProps & { id: string }) {
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
      aria-label="Drag to reorder category"
      className="cursor-grab touch-none border-0 bg-transparent px-0.5 font-mono text-[13px] leading-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      &#x283F;
    </button>
  )

  return (
    <div ref={setNodeRef} style={style}>
      <CategoryGroup {...rest} dragHandle={handle} />
    </div>
  )
}

function ItemRow({
  item,
  member,
  readOnly,
  isEditing,
  onToggle,
  onStartEdit,
  onStopEdit,
  onUpdate,
  onDelete,
}: {
  item: PackingItem
  member?: MemberToneEntry
  readOnly: boolean
  isEditing: boolean
  onToggle: () => void
  onStartEdit: () => void
  onStopEdit: () => void
  onUpdate: (id: string, label: string) => Promise<{ error?: string }>
  onDelete: () => void
}) {
  if (isEditing && !readOnly) {
    return <ItemEditor item={item} onUpdate={onUpdate} onDone={onStopEdit} />
  }
  return (
    <div className="flex items-center gap-1">
      <CheckRow
        className="flex-1"
        done={item.done}
        label={item.label}
        who={member?.initial}
        whoTone={member?.tone ?? "sea"}
        tone="clay"
        onToggle={readOnly ? undefined : onToggle}
      />
      {readOnly ? null : (
        <>
          <button
            type="button"
            onClick={onStartEdit}
            aria-label="Edit item"
            className="border-0 bg-transparent px-1.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
          >
            &#x270E;
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete item"
            className="border-0 bg-transparent px-1.5 py-1 font-mono text-[12px] text-muted-foreground hover:text-clay"
          >
            &times;
          </button>
        </>
      )}
    </div>
  )
}

function ItemEditor({
  item,
  onUpdate,
  onDone,
}: {
  item: PackingItem
  onUpdate: (id: string, label: string) => Promise<{ error?: string }>
  onDone: () => void
}) {
  const [value, setValue] = React.useState(item.label)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const label = value.trim()
    if (!label || pending) return
    setPending(true)
    setError(null)
    const result = await onUpdate(item.id, label)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    onDone()
  }

  return (
    <form onSubmit={submit} className="py-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onDone()
          }}
          disabled={pending}
          className="flex-1 border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="rounded-md border-0 bg-clay px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-background disabled:opacity-40"
        >
          save
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="border-0 bg-transparent px-1 font-mono text-[12px] text-muted-foreground hover:text-foreground"
          aria-label="Cancel"
        >
          &times;
        </button>
      </div>
      {error ? (
        <div className="mt-1 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </form>
  )
}

function AddItemRow({
  tripId,
  owner,
  category,
}: {
  tripId: string
  owner: string | null
  category: string
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [value, setValue] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  function reset() {
    setExpanded(false)
    setValue("")
    setError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const label = value.trim()
    if (!label || pending) return
    setPending(true)
    setError(null)
    const result = await addPackingItem(tripId, category, label, owner)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setValue("")
    inputRef.current?.focus()
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="border-0 bg-transparent py-2 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground"
      >
        + add item
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="py-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") reset()
          }}
          placeholder={`Add to ${category.toLowerCase()}…`}
          disabled={pending}
          className="flex-1 border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="rounded-md border-0 bg-clay px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-background disabled:opacity-40"
        >
          add
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="border-0 bg-transparent px-1 font-mono text-[12px] text-muted-foreground hover:text-foreground"
          aria-label="Cancel"
        >
          &times;
        </button>
      </div>
      {error ? (
        <div className="mt-1 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </form>
  )
}

function AddCategoryRow({
  onAdd,
}: {
  onAdd: (name: string) => Promise<{ error?: string }>
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [value, setValue] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  function reset() {
    setExpanded(false)
    setValue("")
    setError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const name = value.trim()
    if (!name || pending) return
    setPending(true)
    setError(null)
    const result = await onAdd(name)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    reset()
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="block w-full rounded-lg border border-dashed border-rule py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"
      >
        + add category
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="py-1">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") reset()
          }}
          placeholder="New category, e.g. Medicines"
          disabled={pending}
          className="flex-1 border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="rounded-md border-0 bg-clay px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-background disabled:opacity-40"
        >
          add
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="border-0 bg-transparent px-1 font-mono text-[12px] text-muted-foreground hover:text-foreground"
          aria-label="Cancel"
        >
          &times;
        </button>
      </div>
      {error ? (
        <div className="mt-1 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </form>
  )
}
```

- [ ] **Step 2: Verify lint passes**

Run: `pnpm lint`
Expected: errors only at the `PackingTab` call site in `page.tsx` (missing `currentUserId` / `partnerId`). Fixed in Task 5.

- [ ] **Step 3: Commit** (after Task 5 makes it build — or commit now and let Task 5 finish the build)

```bash
git add src/app/trips/[slug]/packing-tab.tsx
git commit -m "feat(packing): three-way owner switcher with read-only partner view"
```

---

## Task 5: Wire up `page.tsx`

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx`

- [ ] **Step 1: Compute `partnerId` and scope the rail count**

After `const memberIds = workspace.members.map((m) => m.user_id)` (around line 150), add:

```ts
const partnerId =
  workspace.members.find((m) => m.user_id !== userData.user!.id)?.user_id ?? null
```

Then replace the existing rail count lines:

```ts
const packingTotal = packingItems.length
const packingDone = packingItems.filter((i) => i.done).length
```

with a count scoped to what the current user is responsible for (shared + their own), so the partner's personal items don't leak into the visible total:

```ts
const myPackingItems = packingItems.filter(
  (i) => i.ownerId === null || i.ownerId === userData.user!.id,
)
const packingTotal = myPackingItems.length
const packingDone = myPackingItems.filter((i) => i.done).length
```

- [ ] **Step 2: Pass the new props to `PackingTab`**

In the `<PackingTab ... />` block (around line 224), add `currentUserId` and `partnerId`:

```tsx
<PackingTab
  tripId={header.id}
  tripSlug={header.slug}
  currentUserId={userData.user.id}
  partnerId={partnerId}
  initialItems={packingItems}
  initialCategories={packingCategories}
  members={memberTones}
  daysOut={computeDaysOut(header.startDate)}
/>
```

- [ ] **Step 3: Verify the build**

Run: `pnpm lint && pnpm build`
Expected: both pass with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/[slug]/page.tsx
git commit -m "feat(packing): pass current user and partner to PackingTab; scope rail count"
```

---

## Task 6: Manual verification in the browser

**Files:** none (manual QA against the running dev server).

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`
(If Turbopack panics with `0xc0000142` on Windows, stop, delete `.next/`, and restart — known flake, not a code bug.)

- [ ] **Step 2: Verify the switcher and shared list**

Open a trip's Packing tab. Confirm:
- The progress bar is gone; a **My list · Shared · [Partner]&rsquo;s list** switcher shows, defaulting to **Shared**.
- The Shared view is identical to before (same items/categories, add item, add category, drag-reorder, import, suggestion).

- [ ] **Step 3: Verify My list is independent**

Switch to **My list**. Add a category (e.g. "My meds") and an item under it. Confirm it appears only in My list, not in Shared. Reorder a category and confirm it sticks after a refresh.

- [ ] **Step 4: Verify the partner gate and read-only view**

As the same user (the partner's list is populated if the other account added personal items — or add some via the other account):
- Tap **[Partner]&rsquo;s list**. Confirm a dialog appears: "This is {name}'s list — open it?".
- Cancel → stays on the current view. Tap again, confirm → partner's list opens.
- In the partner view there are **no** add/edit/delete/drag controls and checkboxes do nothing.
- Switch away and back to the partner tab in the same session → no second confirm. Full page reload → confirm appears again.

- [ ] **Step 5: Verify the rail count**

Confirm the right-rail / packing summary count reflects **shared + your own** items only (a partner-only personal item does not change your total).

- [ ] **Step 6: Verify Realtime still works**

With two browsers (two accounts) on the same trip, check a shared item in one and confirm it updates live in the other (unchanged behaviour). A personal item added by the partner appears in your **[Partner]&rsquo;s list** after a refocus.

---

## Task 7: Update docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Log the work in `docs/TODO.md`**

Add a completed entry describing the semi-private packing lists (owner-scoped My/Shared/Partner views, partner confirm gate, read-only partner view), following the file's existing format.

- [ ] **Step 2: Add a row to `docs/DECISIONS.md`**

Record the non-obvious choices, matching the table's columns:
- Semi-private packing modelled as a single nullable `owner_id` on `packing_items` + `packing_categories` (`null` = shared), not a separate table or visibility enum.
- Privacy is **UI-only**: select RLS stays member-gated so either partner can read both lists; the partner view is read-only in the UI, not server-enforced.
- Category uniqueness uses `unique nulls not distinct (trip_id, owner_id, name)` so each scope gets its own category names while shared duplicates are still blocked.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: log semi-private packing lists"
```

---

## Self-review notes

- **Spec coverage:** model (Task 1–2), RLS insert tightening + member-gated reads (Task 1), `NULLS NOT DISTINCT` constraint (Task 1), per-view partition (Task 2), owner-aware actions + shared-only copy (Task 3), switcher / no counts / partner confirm once-per-session / read-only partner view (Task 4), partner id plumbing + rail-count scoping (Task 5), realtime `owner_id` (Task 4). All spec sections map to a task.
- **Out of scope (unchanged):** fully-private items, moving items between scopes, copying personal lists, per-view counts, server-enforced partner read-only.
