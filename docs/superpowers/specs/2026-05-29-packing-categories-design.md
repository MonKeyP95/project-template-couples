# Packing Categories (first-class, draggable) — design

**Date:** 2026-05-29
**Status:** Draft, awaiting user review.
**Carries from:** User request 2026-05-29 — "add the option of adding a category in packing, for example medicines." Today packing categories are *implicit*: `groupPackingItems` derives them from existing items, so a category exists only while it holds at least one item. There is no way to create a new (especially empty) category, reorder categories, or remove one.

## Goal

Make packing categories first-class objects a workspace member can **add** (including empty), **delete**, and **reorder by dragging**, all inline on `/trips/[slug]?tab=packing`. Items continue to live under a category and are checked/added/edited/deleted exactly as they are today.

## Non-goals (deferred)

- **Rename a category.** Explicitly out of scope per brainstorming. This is what lets us link items to categories by *name* (text) without rename-drift. If rename is wanted later, that is the moment to migrate items to a `category_id` FK.
- **Per-category color/tone, icons, collapse/expand.** Not requested.
- **Realtime sync of category add/delete/reorder.** Item checks keep their existing live Realtime channel. Category structure changes sync via `revalidatePath` (acting device) + the already-mounted `RefreshOnVisible` (partner device on refocus) — the same trade-off the budget tab makes. Categories change far less often than item checks; a live channel isn't worth the complexity.
- **Cross-trip / workspace-level category templates.** Each trip owns its own categories.

## Schema

New table `packing_categories` — the ordered registry of which categories exist per trip. Items keep their existing `packing_items.category` *text* column and match by name.

`supabase/migrations/20260529000001_packing_categories.sql` (idempotent):

```sql
-- First-class, orderable packing categories per trip. Items link by the
-- existing packing_items.category text column (name match) — no rename means
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

-- RLS mirrors packing_items: any workspace member of the trip can do anything.
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

-- Backfill: turn the categories already present in items into rows, ordered
-- by when each category first appeared. Idempotent via the unique constraint.
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

No change to `packing_items`. `packing_categories` is **not** added to the Realtime publication (see non-goals).

## Types + grouping (`src/lib/trips/packing-types.ts`)

New type and a reworked grouping helper. The helper now renders **all** categories in `sort_order` (including empty ones) and defensively appends any "orphan" category that appears on an item but has no category row yet — this keeps a Realtime item-INSERT under a not-yet-known category visible on the partner's device until the next refocus.

```ts
export interface PackingCategory {
  id: string
  tripId: string
  name: string
  sortOrder: number
}

// Was groupPackingItems(items). Now driven by the ordered category list.
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
  const ordered = [...categories].sort((a, b) => a.sortOrder - b.sortOrder)
  const groups = ordered.map((c) => ({
    category: c.name,
    items: byName.get(c.name) ?? [],
  }))
  // Orphan categories present on items but missing a row — append at end.
  const known = new Set(ordered.map((c) => c.name))
  for (const [name, list] of byName) {
    if (!known.has(name)) groups.push({ category: name, items: list })
  }
  return groups
}
```

`PackingGroup` stays `{ category: string; items: PackingItem[] }`.

## Query layer (`src/lib/trips/packing-queries.ts`)

New `getPackingCategories(tripId)` returning `PackingCategory[]` ordered by `sort_order`. `getPackingItems` is unchanged.

## Server Actions (append to `src/lib/trips/actions.ts`)

All three `revalidatePath('/trips/'+tripSlug)`. Return-`{error}` shape so the optimistic client can revert.

### `addPackingCategory(tripId, tripSlug, name): Promise<{ error?: string; category?: PackingCategory }>`
Trims name; rejects empty. Computes `sort_order = (max for trip) + 1`. Inserts, returns the created row (so the client appends it with a stable id). `23505` (duplicate name) → "A category with that name already exists."

### `deletePackingCategory(categoryId, tripSlug): Promise<{ error?: string }>`
Looks up the category (its `trip_id` + `name`), deletes `packing_items` where `trip_id` matches and `category = name`, then deletes the category row. The empty-vs-non-empty distinction is a **client-side confirm only** — the server cascades unconditionally because the client already confirmed.

### `reorderPackingCategories(tripSlug, orderedIds): Promise<{ error?: string }>`
Takes the full ordered array of category ids for the trip and writes `sort_order = index` for each (a short loop of updates; N is tiny). RLS gates each update.

## UI (`src/app/trips/[slug]/packing-tab.tsx`)

### New prop
`PackingTab` gains `initialCategories: PackingCategory[]` and `tripSlug: string` (needed for the category actions' `revalidatePath`). It holds `categories` in local state with the same "sync when the prop identity changes" pattern already used for `items`.

### Drag-and-drop (new dependency)
Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (latest). The category list is wrapped in `DndContext` + `SortableContext` (vertical strategy). Each `CategoryGroup` becomes a sortable item.

- **Drag handle, not whole header.** A small grip glyph (⠿) on the category header carries the drag listeners; the rest of the header stays tappable. This avoids fighting page scroll on mobile.
- **Sensor:** `PointerSensor` with `activationConstraint: { distance: 8 }` (covers mouse + touch; the small distance keeps taps from starting a drag).
- **On drag end:** reorder the local `categories` array (optimistic), then call `reorderPackingCategories(tripSlug, orderedIds)`; revert to the pre-drag snapshot on error.

### Add category
Below the last category (near the existing `+ add item` idiom) a dashed **`+ add category`** control expands to a single text input + `add` / `×`, mirroring `AddItemRow`. On submit it calls `addPackingCategory`, appends the returned category to local state, and the new (empty) section renders immediately — including its own `+ add item` row, so you can start filling it.

### Delete category
Each category header gets a `×` affordance. If the category has items, `window.confirm("Delete 'Medicines' and its N items?")`; if empty, `window.confirm("Delete 'Medicines'?")`. On confirm: optimistically remove the category **and its items** from local state, call `deletePackingCategory`, revert the snapshot on error.

### Existing item behavior
Unchanged. `CategoryGroup` still renders `ItemRow` (view: `CheckRow` + `✎`/`×`) and `ItemEditor`, plus the `AddItemRow` at the bottom of each category. The item Realtime channel is untouched.

## Data flow / sync summary

- **Item check / add / edit / delete:** optimistic local update + existing Realtime channel (live on both devices). Unchanged.
- **Category add / delete / reorder:** optimistic local update + `revalidatePath` (acting device re-renders from fresh props) + `RefreshOnVisible` (partner device on refocus). No new Realtime channel.
- **Race guard:** `groupPackingItems` appends orphan categories, so a Realtime item-INSERT under a category the partner hasn't loaded yet still appears.

## Files touched

- `supabase/migrations/20260529000001_packing_categories.sql` — new table, RLS, backfill (idempotent).
- `src/lib/trips/packing-types.ts` — `PackingCategory` type; `groupPackingItems` reworked to take `(categories, items)`.
- `src/lib/trips/packing-queries.ts` — `getPackingCategories(tripId)`.
- `src/lib/trips/actions.ts` — `addPackingCategory`, `deletePackingCategory`, `reorderPackingCategories`.
- `src/app/trips/[slug]/page.tsx` — load categories alongside items; pass `initialCategories` + `tripSlug` to `PackingTab`.
- `src/app/trips/[slug]/packing-tab.tsx` — DnD wiring, add/delete category UI, local `categories` state.
- `package.json` — `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`.

## User action required after merge

Paste `supabase/migrations/20260529000001_packing_categories.sql` into the Supabase SQL Editor (idempotent — safe to re-run). Until then `getPackingCategories` returns empty and the orphan-append path keeps existing items visible under their current category names, but you can't add/delete/reorder.
