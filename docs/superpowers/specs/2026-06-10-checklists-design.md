# Checklists — reusable, resettable templates

**Date:** 2026-06-10
**Status:** Design approved, pending spec review

## Purpose

A new top-level **Checklists** page for saved, reusable checklist templates — "one-day trek", "3-day trek", "camping", "surfing", and so on. Each checklist is built like the trip Packing tab (categories + items with checkboxes), but lives at the **workspace level**, independent of any trip, and can be **reset** (all items unchecked) so the template is fresh for the next use.

The differentiator from packing: packing is a per-trip list you build once and discard; a checklist is a durable template you reuse across many trips, resetting between uses.

## Scope

- **Workspace-level and standalone.** Checklists belong to the workspace (shared between both partners), not to any trip.
- **Shared check state.** Both members see and toggle the same checks, synced live (Realtime), exactly like packing.
- **Reusable via Reset.** A checklist's value is its definition (categories + items); checks are transient and cleared by Reset.
- **No trip link in v1** — but see "Future door" below.

## Data model

Three new tables, mirroring the packing shape (`packing_categories` + `packing_items`):

```
checklists
  id          uuid pk
  workspace_id uuid not null -> workspaces(id) on delete cascade
  name        text not null (non-empty)
  slug        text not null              -- for /checklists/[slug]
  created_by  uuid not null -> auth.users(id)
  created_at  timestamptz
  unique (workspace_id, slug)

checklist_categories
  id           uuid pk
  checklist_id uuid not null -> checklists(id) on delete cascade
  name         text not null (non-empty)
  sort_order   int not null default 0
  created_by   uuid
  created_at   timestamptz
  unique (checklist_id, name)

checklist_items
  id           uuid pk
  checklist_id uuid not null -> checklists(id) on delete cascade
  category     text not null (non-empty)  -- links to a category by NAME (no FK, no rename drift)
  label        text not null (non-empty)
  done         boolean not null default false
  added_by     uuid not null -> auth.users(id)
  created_at   timestamptz
```

**Why category-by-name:** identical to packing — categories are not renamed, so a name match avoids a category_id FK and any drift. This also keeps `checklist_items` structurally identical to `packing_items` (category name + label + done), which is what makes a future "copy into a trip's packing" trivial.

**RLS:** every table gated by workspace membership through a `SECURITY DEFINER` helper `is_checklist_workspace_member(p_checklist_id uuid)` that joins `checklists -> workspace_members` on `auth.uid()` (same shape as `is_trip_workspace_member`). Select/insert/update/delete policies mirror packing's.

**Realtime:** `checklist_items` added to the `supabase_realtime` publication so checking syncs across devices, exactly like `packing_items`.

## Routes & pages

### `/checklists` — overview
- Lists the workspace's saved checklists as rows/cards: name + a progress count ("4 / 12").
- **+ add checklist**: a name input creates an empty checklist (slug derived from the name, deduped within the workspace) and opens its detail page.
- **Delete** per row, native-confirm gated.
- Empty state: a friendly "No checklists yet — add your first one."

### `/checklists/[slug]` — detail
- Header: the checklist **name** (rename in place), a **Reset** button (native-confirm, sets every item `done = false`), and **delete**.
- Body: categories with their items and checkboxes — the same UI as the trip **Packing tab** (`PackingTab`): add item (label under a category), add category, delete item, delete category, check/uncheck.
- Realtime channel on `checklist_items` for live sync, mirroring packing.
- Empty state: "No items yet — add a category and items."

## Navigation

Add **Checklists** as a permanent destination in the shared nav (`buildNavDestinations` → `LeftRail` + `MobileTopNav`). It is always present (not trip-dependent). Order:

1. On the road (only when a trip is active)
2. Home
3. **Checklists**
4. Trip (only when viewing one)

The active item highlights on `/checklists` and `/checklists/[slug]`.

## Reset & editing

- **Reset** clears all checks for one checklist (`update ... set done = false where checklist_id = …`), native-confirm gated so progress isn't wiped by accident.
- **Editing** mirrors packing's core actions: add/delete items, add/delete categories, check/uncheck, plus rename the checklist itself.

## Out of scope (v1)

- **Linking to trips** — no "copy into packing" action yet.
- Drag-to-reorder categories (packing has it; deferred here).
- Pre-seeded starter templates — you build your own (empty start).
- Sharing templates between workspaces; per-user check state; due dates.

## Future door (deliberately kept open)

Because `checklist_items` carry the same shape as `packing_items` (a category **name** + a **label**), a later **"copy this checklist into [trip]'s packing"** action is a small, additive feature: read a checklist's items and insert `packing_items` (and `packing_categories`) for the chosen trip. No schema change to checklists is needed to enable it, so nothing in v1 should block it.

## Reused patterns

- Slug generation + dedupe: same approach as trips (`slug-tone` / trip slug creation).
- Per-list detail UI: reuse / closely mirror `PackingTab` so categories + items + checkboxes behave identically.
- RLS helper + policies + Realtime: mirror `is_trip_workspace_member`, packing policies, and the packing Realtime publication.
