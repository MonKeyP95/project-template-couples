# Copy packing + notes from another trip — design

**Date:** 2026-06-04
**Status:** draft (awaiting user review)
**Scope:** packing lists and trip notes. Budget copy was considered and **dropped** (2026-06-04) — see Out of scope.

## Problem / vision

You often want a new trip (or dream) to start from a list you already built — "copy my Lombok packing list into this trip." Today there's no way to reuse a packing list or notes across trips; you re-type everything.

This adds a **one-time copy** (snapshot, not a live link): from the trip you're viewing, pull a packing list or notes from another trip/dream in the same workspace. The copy is independent — later edits to either trip don't affect the other.

## Decisions (from brainstorming)

- **Direction:** pull — you act from the **destination** (the trip you're viewing), choosing a **source** to copy in.
- **Merge / append:** copied content is added on top of what's there; nothing existing is deleted. Same-name packing categories merge (items link by name); duplicate labels/notes are allowed (no dedup).
- **Packing `done` resets** to unpacked on copy.
- **Source:** any trip or dream in the same workspace, except the current one.
- **Per tab:** the Packing tab copies packing; the Notes tab copies notes. (No cross-tab "what to copy" selector.)
- **One-time snapshot**, no ongoing link.

## Data model

**No schema change, no migration.** Existing tables:
- `packing_categories (id, trip_id, name, sort_order)`, `packing_items (id, trip_id, category /* name */, label, done, added_by, created_at)`. Items link to a category by **name** (text).
- `trip_notes (id, trip_id, body, created_by, created_at, updated_at)`.

RLS already gates everything: both trips are in the same workspace and the user is a member, so reading the source and inserting into the target are permitted by the existing `is_trip_workspace_member` policies. Copies are app-level inserts — no Postgres RPC needed (the merge is additive and low-stakes; RPCs stay reserved for the transactional date-shifts).

## Server actions (`src/lib/trips/actions.ts`)

### `getImportableTrips(tripId)` — shared read

Returns the other trips/dreams in the same workspace, for the source picker:

1. Look up the current trip's `workspace_id`.
2. Select `id, name` from `trips` where `workspace_id` matches and `id <> tripId`, ordered by `start_date` (nulls/dreams last) or name.
3. Return `{ id: string; name: string }[]`.

(Lists all siblings; picking an empty one simply copies nothing. Filtering to non-empty per domain is a possible later refinement, deliberately skipped.)

### `copyPackingFromTrip(targetTripId, sourceTripId, tripSlug)`

Returns `{ error?: string; copied?: number }`.

1. Read source categories + items, and the target's existing category **names**.
2. For each source category whose name is **not** already in the target, insert a `packing_categories` row (`trip_id = target`, `name`, `sort_order = targetMax + n`). Same-name categories are skipped (items will attach by name).
3. Insert all source items into the target: `{ trip_id: target, category: <name>, label, done: false, added_by: <auth.uid()> }`.
4. `revalidatePath('/trips/<slug>')`. Return the item count.

### `copyNotesFromTrip(targetTripId, sourceTripId, tripSlug)`

Returns `{ error?: string; copied?: number }`.

1. Read source notes (oldest-first).
2. Insert each into the target: `{ trip_id: target, body, created_by: <auth.uid()> }` (timestamps default).
3. `revalidatePath('/trips/<slug>')`. Return the note count.

## UI

A small reusable client component **`ImportFromTripControl`** (or inline equivalent) used by both tabs:

- A collapsed control — e.g. a dashed **"Copy from another trip"** button matching the existing add-control style (like "+ category" / "+ save").
- On open: calls `getImportableTrips(tripId)` (a `useTransition` load), renders a `<select>` of sources + a **copy** button (and a cancel).
- On copy: calls the tab's copy action (`copyPackingFromTrip` / `copyNotesFromTrip`) inside a transition; on success it collapses; the new content arrives via Realtime (packing items) and/or the `revalidatePath` + `RefreshOnVisible` refresh (categories, notes).
- Additive and non-destructive, so no confirm dialog.

Placement:
- **Packing tab** (`packing-tab.tsx`): the control sits with the add-category area; its copy action is `copyPackingFromTrip`.
- **Notes tab** (`notes-tab.tsx`): the control sits near the add-note area; its copy action is `copyNotesFromTrip`.

The picker component takes the source list + an `onCopy(sourceTripId)` callback, so each tab wires its own action — the component itself is domain-agnostic.

## Sync

- Packing **items**: the existing `packing_items` Realtime channel broadcasts the inserts to the partner; `revalidatePath` + `RefreshOnVisible` cover categories.
- **Notes**: `revalidatePath` + `RefreshOnVisible` (notes have no Realtime channel, by existing design).

## Build slices (for the plan step)

1. **`getImportableTrips` + the shared `ImportFromTripControl`** picker component (no copy wired yet, or wired to packing in slice 2).
2. **Packing copy:** `copyPackingFromTrip` + mount the control on the Packing tab.
3. **Notes copy:** `copyNotesFromTrip` + mount the control on the Notes tab.

## Decisions captured

1. Pull (act from destination); merge/append; no dedup; packing `done` resets.
2. App-level server actions, no schema/migration; RLS gates same-workspace access.
3. Per-tab controls sharing one domain-agnostic picker component.
4. Source picker lists all siblings (no non-empty filter).

## Out of scope

- **Budget copy — won't do** (decided 2026-06-04). Copying the real expense ledger into a new trip is meaningless, and there's no expected-cost template concept to copy. The `copy*FromTrip` + picker shape could host it if that ever changes.
- A live/synced link between trips (this is a one-time snapshot).
- Dedup of identical items/notes.
- Filtering the source picker to trips that actually have a list.
- Copying across workspaces.
