# Packing Categories (first-class, draggable) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workspace member add (incl. empty), delete, and drag-reorder packing categories on `/trips/[slug]?tab=packing`.

**Architecture:** A new `packing_categories` table is the ordered registry of categories per trip; `packing_items` keep linking by their existing `category` *text* column (name match — no rename, so no drift). The packing tab renders all categories in `sort_order` (including empty ones), with item checks staying on their existing Realtime channel and category structure changes syncing via `revalidatePath` + the already-mounted `RefreshOnVisible`.

**Tech Stack:** Next.js 16 Server Actions, Supabase (Postgres + RLS), `@dnd-kit` for drag-and-drop.

**Spec:** `docs/superpowers/specs/2026-05-29-packing-categories-design.md`

**Project note — no test framework.** This repo has no test runner (`CLAUDE.md`). The validation gate for every task is `pnpm lint` then `pnpm build` (both must be clean), plus a manual browser check where noted. There are no failing-test-first steps.

---

### Task 1: Migration — `packing_categories` table, RLS, backfill

**Files:**
- Create: `supabase/migrations/20260529000001_packing_categories.sql`

- [ ] **Step 1: Write the migration file**

Idempotent (safe to paste-and-run repeatedly): `create table if not exists`, a `do $$ … exception when duplicate_object` block for the policies, and `on conflict do nothing` on the backfill. The RLS helper `public.is_trip_workspace_member(p_trip_id uuid)` already exists (`20260526000001_phase_3_trips.sql`); policies scope `to authenticated` to match the existing `packing_items` policies.

```sql
-- First-class, orderable packing categories per trip. Items link by the
-- existing packing_items.category text column (name match) -- no rename means
-- no drift, so a category_id FK isn't needed.

create table if not exists public.packing_categories (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sort_order int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (trip_id, name)
);

create index if not exists packing_categories_trip_idx
  on public.packing_categories (trip_id, sort_order);

alter table public.packing_categories enable row level security;

do $$
begin
  create policy packing_categories_select on public.packing_categories
    for select to authenticated using (public.is_trip_workspace_member(trip_id));
  create policy packing_categories_insert on public.packing_categories
    for insert to authenticated with check (public.is_trip_workspace_member(trip_id));
  create policy packing_categories_update on public.packing_categories
    for update to authenticated using (public.is_trip_workspace_member(trip_id));
  create policy packing_categories_delete on public.packing_categories
    for delete to authenticated using (public.is_trip_workspace_member(trip_id));
exception
  when duplicate_object then null;
end $$;

-- Backfill: turn categories already present in items into rows, ordered by
-- when each category first appeared. Idempotent via the unique constraint.
insert into public.packing_categories (trip_id, name, sort_order)
select trip_id,
       category,
       row_number() over (
         partition by trip_id order by min(created_at)
       ) - 1 as sort_order
from public.packing_items
group by trip_id, category
on conflict (trip_id, name) do nothing;
```

- [ ] **Step 2: Verify SQL is self-consistent (no local DB to run against)**

This repo applies migrations by pasting into the Supabase SQL Editor, not via a local CLI. Re-read the file: confirm `if not exists`, the `do $$` policy guard, and `on conflict do nothing` are all present so a second paste is a no-op. No command to run.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260529000001_packing_categories.sql
git commit -m "feat(packing): packing_categories table, RLS, backfill migration"
```

---

### Task 2: Types + query (additive — build stays green)

**Files:**
- Modify: `src/lib/trips/packing-types.ts` (add `PackingCategory`; do NOT change `groupPackingItems` yet)
- Modify: `src/lib/trips/packing-queries.ts` (add `getPackingCategories`)

- [ ] **Step 1: Add the `PackingCategory` type**

Append to `src/lib/trips/packing-types.ts` (leave the existing `PackingItem`, `PackingGroup`, and `groupPackingItems` untouched in this task):

```ts
export interface PackingCategory {
  id: string
  tripId: string
  name: string
  sortOrder: number
}
```

- [ ] **Step 2: Add the query**

Append to `src/lib/trips/packing-queries.ts`:

```ts
import type { PackingCategory } from "./packing-types"

export async function getPackingCategories(
  tripId: string,
): Promise<PackingCategory[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("packing_categories")
    .select("id, trip_id, name, sort_order")
    .eq("trip_id", tripId)
    .order("sort_order", { ascending: true })

  return (data ?? []).map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    name: row.name,
    sortOrder: row.sort_order,
  }))
}
```

Note: `createClient` is already imported at the top of `packing-queries.ts`. Merge the `PackingCategory` import into the existing `import type { PackingItem } from "./packing-types"` line rather than adding a duplicate import.

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint; if ($?) { pnpm build }`
Expected: both clean. (`getPackingCategories` is unused so far — that's fine; it's an exported module member, not a local binding, so no lint error.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/packing-types.ts src/lib/trips/packing-queries.ts
git commit -m "feat(packing): PackingCategory type + getPackingCategories query"
```

---

### Task 3: Read path — render categories (incl. empty) in order

This task changes `groupPackingItems`'s signature, which breaks its only caller (`packing-tab.tsx`), so the helper rework, the page wiring, and the tab's consumption all land together to keep the build green. No add/delete/drag UI yet — categories simply display in `sort_order`, empty ones included.

**Files:**
- Modify: `src/lib/trips/packing-types.ts` (rework `PackingGroup` + `groupPackingItems`)
- Modify: `src/app/trips/[slug]/page.tsx` (load categories; pass `initialCategories` + `tripSlug`)
- Modify: `src/app/trips/[slug]/packing-tab.tsx` (accept new props, hold `categories` state, render from grouped categories)

- [ ] **Step 1: Rework `PackingGroup` + `groupPackingItems`**

Replace the existing `PackingGroup` interface and `groupPackingItems` function in `src/lib/trips/packing-types.ts` with:

```ts
export interface PackingGroup {
  /** Null for an "orphan" group — items whose category has no row yet. */
  categoryId: string | null
  category: string
  items: PackingItem[]
}

/**
 * Render order follows the given `categories` array order (the query returns
 * them by sort_order, and optimistic drag reorders the array in place — so the
 * helper must NOT re-sort). Empty categories are included. Any category present
 * on an item but missing a row is appended as an orphan group at the end — this
 * keeps a Realtime item-INSERT under a not-yet-loaded category visible until
 * the next refocus.
 */
export function groupPackingItems(
  categories: PackingCategory[],
  items: PackingItem[],
): PackingGroup[] {
  const byName = new Map<string, PackingItem[]>()
  for (const item of items) {
    const arr = byName.get(item.category) ?? []
    arr.push(item)
    byName.set(item.category, arr)
  }
  const groups: PackingGroup[] = categories.map((c) => ({
    categoryId: c.id,
    category: c.name,
    items: byName.get(c.name) ?? [],
  }))
  const known = new Set(categories.map((c) => c.name))
  for (const [name, list] of byName) {
    if (!known.has(name)) {
      groups.push({ categoryId: null, category: name, items: list })
    }
  }
  return groups
}
```

- [ ] **Step 2: Load categories at the page level and pass them down**

In `src/app/trips/[slug]/page.tsx`:

Update the query import:
```ts
import { getPackingCategories, getPackingItems } from "@/lib/trips/packing-queries"
```

Add the categories load to the existing `Promise.all` (it currently destructures `[itinerary, notes, packingItems, expenses]`):
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

Pass the two new props to `<PackingTab>`:
```tsx
          <PackingTab
            tripId={header.id}
            tripSlug={header.slug}
            initialItems={packingItems}
            initialCategories={packingCategories}
            members={memberTones}
            daysOut={computeDaysOut(header.startDate)}
          />
```

- [ ] **Step 3: Consume the new props in `PackingTab`**

In `src/app/trips/[slug]/packing-tab.tsx`:

Merge the type import to include `PackingCategory`:
```ts
import {
  groupPackingItems,
  type PackingCategory,
  type PackingItem,
} from "@/lib/trips/packing-types"
```

Extend `PackingTabProps`:
```ts
export interface PackingTabProps {
  tripId: string
  tripSlug: string
  initialItems: PackingItem[]
  initialCategories: PackingCategory[]
  members: Record<string, MemberToneEntry>
  daysOut: number | null
}
```

Update the component signature and add `categories` state with the same prop-identity sync the items already use. Replace the `PackingTab` parameter list and the two state lines at the top of the function body:
```tsx
export function PackingTab({
  tripId,
  tripSlug,
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

  if (initialItems !== lastInitial) {
    setLastInitial(initialItems)
    setItems(initialItems)
  }
  if (initialCategories !== lastCategories) {
    setLastCategories(initialCategories)
    setCategories(initialCategories)
  }
```

Change the grouping call (was `const groups = groupPackingItems(items)`):
```tsx
  const groups = groupPackingItems(categories, items)
```

Update the render to key by group identity (category id, falling back to name for orphans):
```tsx
        {groups.map((g) => (
          <CategoryGroup
            key={g.categoryId ?? `orphan:${g.category}`}
            tripId={tripId}
            category={g.category}
            items={g.items}
            members={members}
            editingId={editingId}
            onToggle={toggle}
            onStartEdit={setEditingId}
            onStopEdit={() => setEditingId(null)}
            onUpdate={update}
            onDelete={remove}
          />
        ))}
```

(`onToggle`/`onUpdate`/`onDelete` here are the existing **item** handlers — unchanged from the committed edit/delete work. `CategoryGroup`'s props are unchanged in this task.)

- [ ] **Step 4: Verify lint + build**

Run: `pnpm lint; if ($?) { pnpm build }`
Expected: both clean.

- [ ] **Step 5: Manual check**

Run `pnpm dev`, open `http://localhost:3000/trips/lombok?tab=packing`. Expected: the five seeded categories render in the same order as before. (Empty categories can't appear yet — none exist until Task 5. The migration from Task 1 must be pasted into Supabase for `getPackingCategories` to return rows; until then the orphan-append path keeps items visible under their current names.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/trips/packing-types.ts src/app/trips/[slug]/page.tsx src/app/trips/[slug]/packing-tab.tsx
git commit -m "feat(packing): render categories from the category registry"
```

---

### Task 4: Server Actions — add / delete / reorder categories (additive)

**Files:**
- Modify: `src/lib/trips/actions.ts`

- [ ] **Step 1: Import `PackingCategory`**

Add to the existing imports at the top of `src/lib/trips/actions.ts`:
```ts
import type { PackingCategory } from "@/lib/trips/packing-types"
```

- [ ] **Step 2: Append the three actions**

Add at the end of `src/lib/trips/actions.ts`. All three return-`{error}` shaped and `revalidatePath` the trip page (no Realtime channel for categories — sync via revalidate + RefreshOnVisible).

```ts
export interface AddPackingCategoryResult {
  error?: string
  /** Populated on success so the client can append it with a stable id. */
  category?: PackingCategory
}

/**
 * Creates a new (possibly empty) packing category at the end of the trip's
 * order. RLS gates trip membership. Duplicate name -> friendly error.
 */
export async function addPackingCategory(
  tripId: string,
  tripSlug: string,
  name: string,
): Promise<AddPackingCategoryResult> {
  const trimmed = name.trim()
  if (!trimmed) return { error: "Name required." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { data: maxRow } = await supabase
    .from("packing_categories")
    .select("sort_order")
    .eq("trip_id", tripId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (maxRow?.sort_order ?? -1) + 1

  const { data, error } = await supabase
    .from("packing_categories")
    .insert({
      trip_id: tripId,
      name: trimmed,
      sort_order: nextOrder,
      created_by: userData.user.id,
    })
    .select("id, trip_id, name, sort_order")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { error: "A category with that name already exists." }
    }
    return { error: error.message }
  }

  revalidatePath(`/trips/${tripSlug}`)
  return {
    category: {
      id: data.id,
      tripId: data.trip_id,
      name: data.name,
      sortOrder: data.sort_order,
    },
  }
}

export interface DeletePackingCategoryResult {
  error?: string
}

/**
 * Deletes a category and cascades to its items (matched by name within the
 * trip). The empty-vs-non-empty distinction is a client-side confirm only;
 * the server cascades unconditionally because the client already confirmed.
 */
export async function deletePackingCategory(
  categoryId: string,
  tripSlug: string,
): Promise<DeletePackingCategoryResult> {
  const supabase = await createClient()

  const { data: cat, error: catError } = await supabase
    .from("packing_categories")
    .select("trip_id, name")
    .eq("id", categoryId)
    .maybeSingle()
  if (catError) return { error: catError.message }
  if (!cat) return {}

  const { error: itemsError } = await supabase
    .from("packing_items")
    .delete()
    .eq("trip_id", cat.trip_id)
    .eq("category", cat.name)
  if (itemsError) return { error: itemsError.message }

  const { error } = await supabase
    .from("packing_categories")
    .delete()
    .eq("id", categoryId)
  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}

export interface ReorderPackingCategoriesResult {
  error?: string
}

/**
 * Rewrites sort_order to match the given id order (sort_order = index). N is
 * tiny (categories per trip), so a short update loop is fine.
 */
export async function reorderPackingCategories(
  tripSlug: string,
  orderedIds: string[],
): Promise<ReorderPackingCategoriesResult> {
  const supabase = await createClient()

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("packing_categories")
      .update({ sort_order: i })
      .eq("id", orderedIds[i])
    if (error) return { error: error.message }
  }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}
```

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint; if ($?) { pnpm build }`
Expected: both clean. (The actions are exported but not yet called — fine.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(packing): add/delete/reorder category Server Actions"
```

---

### Task 5: Add-category UI

**Files:**
- Modify: `src/app/trips/[slug]/packing-tab.tsx`

- [ ] **Step 1: Import the action**

Extend the actions import block in `packing-tab.tsx`:
```ts
import {
  addPackingCategory,
  addPackingItem,
  deletePackingItem,
  togglePackingItem,
  updatePackingItem,
} from "@/lib/trips/actions"
```

- [ ] **Step 2: Add the `addCategory` handler**

Inside `PackingTab`, after the existing `remove` item handler, add:
```tsx
  async function addCategory(name: string): Promise<{ error?: string }> {
    const result = await addPackingCategory(tripId, tripSlug, name)
    if (result.error) return { error: result.error }
    if (result.category) {
      const created = result.category
      setCategories((prev) => [...prev, created])
    }
    return {}
  }
```

- [ ] **Step 3: Render `AddCategoryRow` below the category list**

In the `<div className="border-t border-border bg-background">` block, insert the add-category control between the `groups.map(...)` and the `SuggestionCard` wrapper:
```tsx
        <div className="px-5 pt-4">
          <AddCategoryRow onAdd={addCategory} />
        </div>
```

- [ ] **Step 4: Add the `AddCategoryRow` component**

Add at the end of the file (mirrors `AddItemRow`):
```tsx
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
          ×
        </button>
      </div>
      {error ? (
        <div className="mt-1 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </form>
  )
}
```

- [ ] **Step 5: Verify lint + build, then manual check**

Run: `pnpm lint; if ($?) { pnpm build }` → both clean.
Then `pnpm dev` → on `/trips/lombok?tab=packing`, click `+ add category`, type "Medicines", `add`. Expected: an empty "Medicines" section appears at the bottom with its own `+ add item` row. (Requires the Task 1 migration pasted into Supabase.)

- [ ] **Step 6: Commit**

```bash
git add src/app/trips/[slug]/packing-tab.tsx
git commit -m "feat(packing): add-category control"
```

---

### Task 6: Delete-category UI

**Files:**
- Modify: `src/app/trips/[slug]/packing-tab.tsx`

- [ ] **Step 1: Import the action**

Add `deletePackingCategory` to the actions import block (keep alphabetical-ish ordering with the others):
```ts
import {
  addPackingCategory,
  addPackingItem,
  deletePackingCategory,
  deletePackingItem,
  togglePackingItem,
  updatePackingItem,
} from "@/lib/trips/actions"
```

- [ ] **Step 2: Add the `removeCategory` handler**

Inside `PackingTab`, after `addCategory`, add:
```tsx
  async function removeCategory(
    categoryId: string,
    name: string,
    count: number,
  ) {
    const msg =
      count > 0
        ? `Delete '${name}' and its ${count} item${count === 1 ? "" : "s"}?`
        : `Delete '${name}'?`
    if (!window.confirm(msg)) return

    const catSnapshot = categories
    const itemSnapshot = items
    setCategories((prev) => prev.filter((c) => c.id !== categoryId))
    setItems((prev) => prev.filter((i) => i.category !== name))

    const result = await deletePackingCategory(categoryId, tripSlug)
    if (result.error) {
      setCategories(catSnapshot)
      setItems(itemSnapshot)
    }
  }
```

- [ ] **Step 3: Thread `categoryId` + `onDeleteCategory` through the `CategoryGroup` call**

In the `groups.map(...)` render, add two props:
```tsx
          <CategoryGroup
            key={g.categoryId ?? `orphan:${g.category}`}
            tripId={tripId}
            categoryId={g.categoryId}
            category={g.category}
            items={g.items}
            members={members}
            editingId={editingId}
            onToggle={toggle}
            onStartEdit={setEditingId}
            onStopEdit={() => setEditingId(null)}
            onUpdate={update}
            onDelete={remove}
            onDeleteCategory={removeCategory}
          />
```

- [ ] **Step 4: Accept the props in `CategoryGroup` and render the `×`**

Update `CategoryGroup`'s prop type to add `categoryId` and `onDeleteCategory`:
```tsx
function CategoryGroup({
  tripId,
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
}: {
  tripId: string
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
  onDeleteCategory: (id: string, name: string, count: number) => void
}) {
```

Replace the header row (the `<div className="mb-0.5 flex items-center justify-between">` block) with one that shows the `×` only for real (non-orphan) categories:
```tsx
      <div className="mb-0.5 flex items-center justify-between">
        <Label>{category}</Label>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {done} / {items.length}
          </span>
          {categoryId ? (
            <button
              type="button"
              onClick={() => onDeleteCategory(categoryId, category, items.length)}
              aria-label="Delete category"
              className="border-0 bg-transparent px-1 font-mono text-[12px] text-muted-foreground hover:text-clay"
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
```

- [ ] **Step 5: Verify lint + build, then manual check**

Run: `pnpm lint; if ($?) { pnpm build }` → both clean.
`pnpm dev` → delete the empty "Medicines" category (simple confirm); add an item to a category then delete that category (confirm names the item count, items go with it).

- [ ] **Step 6: Commit**

```bash
git add src/app/trips/[slug]/packing-tab.tsx
git commit -m "feat(packing): delete-category control with smart confirm"
```

---

### Task 7: Drag-to-reorder with `@dnd-kit`

**Files:**
- Modify: `package.json` (add `@dnd-kit/*`)
- Modify: `src/app/trips/[slug]/packing-tab.tsx`

- [ ] **Step 1: Install the drag library**

Run: `pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
Expected: three deps added to `package.json`, lockfile updated.

- [ ] **Step 2: Import dnd-kit + the reorder action**

Add near the top of `packing-tab.tsx` (after the existing imports):
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

And add `reorderPackingCategories` to the actions import block:
```ts
import {
  addPackingCategory,
  addPackingItem,
  deletePackingCategory,
  deletePackingItem,
  reorderPackingCategories,
  togglePackingItem,
  updatePackingItem,
} from "@/lib/trips/actions"
```

- [ ] **Step 3: Extract a named `CategoryGroupProps` interface and add a `dragHandle` slot**

`SortableCategoryGroup` needs to spread props into `CategoryGroup`, so the inline prop type must become a named interface. Replace `CategoryGroup`'s inline param type with a named interface and add an optional `dragHandle`:
```tsx
interface CategoryGroupProps {
  tripId: string
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
  onDeleteCategory: (id: string, name: string, count: number) => void
  dragHandle?: React.ReactNode
}

function CategoryGroup({
  tripId,
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
```

Render `dragHandle` next to the `Label` (replace the header's left side so the handle sits before the title):
```tsx
      <div className="mb-0.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {dragHandle}
          <Label>{category}</Label>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {done} / {items.length}
          </span>
          {categoryId ? (
            <button
              type="button"
              onClick={() => onDeleteCategory(categoryId, category, items.length)}
              aria-label="Delete category"
              className="border-0 bg-transparent px-1 font-mono text-[12px] text-muted-foreground hover:text-clay"
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
```

- [ ] **Step 4: Add the `SortableCategoryGroup` wrapper**

Add after `CategoryGroup`:
```tsx
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
      ⠿
    </button>
  )

  return (
    <div ref={setNodeRef} style={style}>
      <CategoryGroup {...rest} dragHandle={handle} />
    </div>
  )
}
```

- [ ] **Step 5: Add sensors + the `onDragEnd` handler in `PackingTab`**

Inside `PackingTab`, after the `removeCategory` handler:
```tsx
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )
  const [, startReorder] = React.useTransition()

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = categories.findIndex((c) => c.id === active.id)
    const newIndex = categories.findIndex((c) => c.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const snapshot = categories
    const reordered = arrayMove(categories, oldIndex, newIndex)
    setCategories(reordered)
    startReorder(async () => {
      const result = await reorderPackingCategories(
        tripSlug,
        reordered.map((c) => c.id),
      )
      if (result.error) setCategories(snapshot)
    })
  }
```

- [ ] **Step 6: Wrap the sortable categories in `DndContext` + `SortableContext`**

Replace the single `groups.map(...)` render block (from Task 6) with split sortable + orphan rendering. First derive the two lists just before the `return` (next to `const groups = groupPackingItems(...)`):
```tsx
  const sortableGroups = groups.filter((g) => g.categoryId)
  const orphanGroups = groups.filter((g) => !g.categoryId)
```

Then replace the `{groups.map((g) => ( <CategoryGroup ... /> ))}` block with:
```tsx
        <DndContext
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
                categoryId={g.categoryId}
                category={g.category}
                items={g.items}
                members={members}
                editingId={editingId}
                onToggle={toggle}
                onStartEdit={setEditingId}
                onStopEdit={() => setEditingId(null)}
                onUpdate={update}
                onDelete={remove}
                onDeleteCategory={removeCategory}
              />
            ))}
          </SortableContext>
        </DndContext>

        {orphanGroups.map((g) => (
          <CategoryGroup
            key={`orphan:${g.category}`}
            tripId={tripId}
            categoryId={null}
            category={g.category}
            items={g.items}
            members={members}
            editingId={editingId}
            onToggle={toggle}
            onStartEdit={setEditingId}
            onStopEdit={() => setEditingId(null)}
            onUpdate={update}
            onDelete={remove}
            onDeleteCategory={removeCategory}
          />
        ))}
```

- [ ] **Step 7: Verify lint + build, then manual check (incl. mobile viewport)**

Run: `pnpm lint; if ($?) { pnpm build }` → both clean.
`pnpm dev` → on `/trips/lombok?tab=packing`: grab a category's ⠿ handle and drag it above/below another; it stays in the new order after release. Reload the page — order persists (reorder action wrote `sort_order`). In DevTools device mode (e.g. 390px), confirm dragging the handle reorders without the page scrolling away (the `touch-none` handle + 8px activation distance handle this).

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/app/trips/[slug]/packing-tab.tsx
git commit -m "feat(packing): drag-to-reorder categories with dnd-kit"
```

---

### Task 8: Docs + final end-to-end validation

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md` (append a row)

- [ ] **Step 1: Record the work in `docs/TODO.md`**

Add a completed entry under the appropriate section (the packing/CRUD area). Example line:
```markdown
- [x] **Packing categories (first-class, draggable).** Done 2026-05-29. New `packing_categories` table (id, trip_id, name, sort_order) + RLS + idempotent backfill. Items still link by `category` text (no rename = no drift). `PackingTab` renders all categories incl. empty in registry order; add-category control, smart-confirm delete (cascades items), and drag-to-reorder via `@dnd-kit` (grip handle, touch-safe). Category structure syncs via `revalidatePath` + RefreshOnVisible; item checks keep their live Realtime channel. Three Server Actions: `addPackingCategory` / `deletePackingCategory` / `reorderPackingCategories`. Spec + plan under `docs/superpowers/`. **User action required**: paste `supabase/migrations/20260529000001_packing_categories.sql` into the Supabase SQL Editor.
```

- [ ] **Step 2: Append two `docs/DECISIONS.md` rows**

`DECISIONS.md` is a `| Decision | Why | Date |` table. Append these two rows at the end of the table:
```markdown
| Packing categories link items by **name** (text), not a `category_id` FK | Rename is out of scope, so the only downside of name-linking (drift on rename) can't occur. Avoids a heavier backfill + churn across the action / Realtime / grouping layers. Revisit if rename is ever added. | 2026-05-29 |
| Adopt **`@dnd-kit`** for category drag-to-reorder | First drag library in the project — the dependency itinerary Slice C was deferred over. Pulled in deliberately at user request for packing-category reordering; reuse it for Slice C later rather than adding another. | 2026-05-29 |
```

- [ ] **Step 3: Full validation**

Run: `pnpm lint; if ($?) { pnpm build }` → both clean.

- [ ] **Step 4: End-to-end manual pass**

With the Task 1 migration pasted into Supabase and `pnpm dev` running, on `/trips/lombok?tab=packing`: add "Medicines" → add an item under it → check the item (confirms it syncs) → reorder Medicines up → reload (order persists) → delete a non-empty category (confirm names the count, items go too) → delete an empty category. If a second device/browser is handy, confirm the partner sees category changes after refocus and item checks live.

- [ ] **Step 5: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record packing-categories slice"
```

---

## Notes for the implementer

- **Migration is paste-to-apply.** Nothing in this repo runs migrations automatically. After Task 1 the table won't exist in Supabase until the SQL is pasted into the SQL Editor; `getPackingCategories` returns `[]` until then, and the orphan-append path keeps existing items visible meanwhile. Add-category will fail (no table) until pasted — do the paste before the Task 5 manual check.
- **Two `useTransition` calls** live in `PackingTab` after this plan (none before): only the reorder one is added here (`startReorder`). The item editor uses local `pending` booleans, not transitions — leave them as they are.
- **Don't add `packing_categories` to the Realtime publication.** That's a deliberate non-goal; category sync rides on `revalidatePath` + the existing `RefreshOnVisible`.

