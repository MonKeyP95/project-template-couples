# Packing imports: from checklists and from any trip scope — design

**Date:** 2026-06-15
**Status:** Approved, ready for implementation plan

## Problem

Two gaps in the packing tab's "bring items in" story:

1. **No checklist bridge.** Checklists are workspace-level reusable templates (camping,
   trek, surfing…) on their own `/checklists` route. When packing for a trip there is no
   way to pull a checklist's items into the trip's packing — you'd retype them.
2. **Import asymmetry from the semi-private work.** "Copy packing from another trip" only
   appears on the **Shared** list and only ever copies the *source trip's shared* packing.
   The new My list / Partner views have no import at all.

We considered surfacing checklists as a fourth packing switcher segment (My / Shared /
Partner / Checklists) and rejected it: checklists are workspace-scoped and reusable (a
*library of named lists*), while the packing segments are this-trip and each a *single
list*. Mixing them conflates scopes, breaks the "one tap, one list" segment metaphor, and
lets a tap inside the packing tab silently mutate a shared workspace template. The bridge
the checklists feature was designed for is a copy: `checklist_items` already share the
`category` + `label` + `done` shape of `packing_items`.

We also considered merging both imports into one combined control and rejected that too —
the user prefers **two distinct, clearly-labelled buttons**. So the fix is: show both
import buttons on My + Shared, and give the trip-copy a source-scope choice.

## What it does

On the packing tab's **My list** and **Shared** views (not the read-only Partner view),
two dashed buttons sit beside the add-category control:

- **Add from checklist** — pick a checklist → its items copy into the list you're on.
- **Copy from another trip** — pick a trip **and** toggle its **Shared / My list** as the
  source → those items copy into the list you're on.

All copies are one-time and **additive**: items arrive **unpacked** (`done = false`),
merged into the target scope's same-name categories, source templates/trips untouched.
"My list" as a source means *your own* personal items in that other trip
(`owner_id = you`); the partner's personal items are never an import source.

The target scope is always the view you triggered the import from. So trip-copy supports
all four scope combinations (Shared→Shared, Shared→My, My→Shared, My→My); the source
toggle **defaults to Shared**.

## Server actions

All in `src/lib/trips/actions.ts`.

### `getImportableChecklists()` (new)

```ts
export async function getImportableChecklists(): Promise<ImportableTrip[]>
```

Returns the current workspace's checklists as `{ id, name }[]` (reuses the existing
`ImportableTrip` shape so the generic picker stays one type). Resolves the workspace via
`getCurrentWorkspace()` and maps `listChecklists(workspace.id)`. Returns `[]` when there
is no workspace or no checklists.

### `copyChecklistToPacking(targetTripId, checklistId, owner, tripSlug)` (new)

```ts
export async function copyChecklistToPacking(
  targetTripId: string,
  checklistId: string,
  owner: string | null,
  tripSlug: string,
): Promise<CopyResult>
```

Mirrors the (revised) `copyPackingFromTrip`, with a checklist as the source and `owner`
as the target scope:

1. Auth via `getUser()`; `{ error: "Not signed in." }` if absent.
2. Read in parallel: source `checklist_categories` (`name, sort_order`, ordered) and
   `checklist_items` (`category, label`) for `checklistId`; target `packing_categories`
   (`name, sort_order`) for `targetTripId` filtered to the `owner` scope
   (`.is("owner_id", null)` when `owner === null`, else `.eq("owner_id", owner)`).
3. Insert checklist categories not present in the target scope: `owner_id = owner`,
   `created_by = me`, `sort_order` continuing from the scope's max.
4. Insert all checklist items as packing items: `owner_id = owner`, `added_by = me`,
   `done` omitted (defaults false), `category` copied verbatim (links by name).
5. `revalidatePath(/trips/${tripSlug})`; return `{}` or `{ error }`.

### `copyPackingFromTrip` — gains source + target scope (changed)

Current signature copies the source's shared list into the target's shared list:

```ts
// before
copyPackingFromTrip(targetTripId, sourceTripId, tripSlug)
```

New signature adds both scopes:

```ts
export async function copyPackingFromTrip(
  targetTripId: string,
  sourceTripId: string,
  sourceOwner: string | null,
  targetOwner: string | null,
  tripSlug: string,
): Promise<CopyResult>
```

- Source `packing_categories` / `packing_items` reads gain an owner filter on
  `sourceOwner` (`.is("owner_id", null)` for Shared, `.eq("owner_id", sourceOwner)` for
  My — where `sourceOwner` is the current user's id).
- Target existing-category read and both inserts use `targetOwner` (categories
  `owner_id = targetOwner` / `created_by = me`; items `owner_id = targetOwner` /
  `added_by = me`, `done` reset). Category merge is within the target scope.
- The sole caller is `packing-tab.tsx`; its call site is updated (below).

### RLS / migration

No new policies, no migration. Reading a checklist is gated by
`is_checklist_workspace_member`; reading another trip's packing (shared or your own items)
is gated by `is_trip_workspace_member` (importable trips are same-workspace siblings, so
the current user is a member). Packing inserts are gated by the existing
`owner_id is null or owner_id = auth.uid()` check — `targetOwner` is only ever `null`
(Shared) or the current user (My list), both allowed.

Additive, no item-level dedup (same as today's import): copying twice duplicates items,
which is acceptable.

## UI components

### Generic picker (checklist + Notes)

`ImportFromTripControl` (`src/app/trips/[slug]/import-from-trip.tsx`) is a dashed button
that opens to a single `Select` + "copy". Extract its generic core into a reusable
control and keep `ImportFromTripControl` as a thin wrapper so its callers don't change.

New `src/app/trips/[slug]/import-picker.tsx` (markup/styles lifted verbatim):

```ts
export function ImportPickerControl({
  label,
  emptyText,
  load,
  onCopy,
}: {
  label: string
  emptyText: string
  load: () => Promise<ImportableTrip[]>
  onCopy: (id: string) => Promise<{ error?: string }>
})
```

`ImportFromTripControl` becomes a wrapper supplying
`load={() => getImportableTrips(tripId)}` and
`emptyText="No other trips to copy from."`, keeping its `{ tripId, label, onCopy }` API.
**The Notes tab (`notes-tab.tsx`) is therefore not touched.** The packing **checklist**
button uses `ImportPickerControl` directly with `load={getImportableChecklists}`,
`label="Add from checklist"`, `emptyText="No checklists to copy from."`.

### Packing trip-copy control (new, has the source toggle)

Packing's "copy from another trip" needs a source-scope toggle that the generic picker and
the Notes use-case don't, so it is its own control rather than bloating the generic one.

New `src/app/trips/[slug]/copy-packing-from-trip.tsx`:

```ts
export function CopyPackingFromTripControl({
  tripId,
  onCopy,
}: {
  tripId: string
  // sourceMine=false -> source Shared; true -> source My list
  onCopy: (sourceTripId: string, sourceMine: boolean) => Promise<{ error?: string }>
})
```

Same open/close + `useTransition` + trip `Select` + error line as the generic picker,
plus a small segmented **"From: ( Shared )( My list )"** toggle (state `sourceMine`,
defaulting to `false` = Shared). Copy calls `onCopy(selectedTripId, sourceMine)`. Loads
trips via `getImportableTrips(tripId)`; empty text "No other trips to copy from.".

### Wiring in `packing-tab.tsx`

`PackingList` renders both controls inside its `!readOnly` branch (My + Shared, never
Partner), replacing the current `owner === null`-only import block. It gains two props:

```ts
onAddFromChecklist: (checklistId: string, owner: string | null) => Promise<{ error?: string }>
onCopyPacking: (sourceTripId: string, sourceMine: boolean, targetOwner: string | null) => Promise<{ error?: string }>
```

`PackingList` passes its own `owner` as the target:
- checklist: `onCopy={(id) => onAddFromChecklist(id, owner)}`.
- trip: `onCopy={(id, mine) => onCopyPacking(id, mine, owner)}`.

`PackingTab` wires them to the actions, mapping `sourceMine` to an owner id:
- `onAddFromChecklist = (checklistId, owner) => copyChecklistToPacking(tripId, checklistId, owner, tripSlug)`
- `onCopyPacking = (sourceTripId, sourceMine, targetOwner) => copyPackingFromTrip(tripId, sourceTripId, sourceMine ? currentUserId : null, targetOwner, tripSlug)`

The old single `onCopyShared` prop and its `ImportFromTripControl` usage in `PackingList`
are removed (superseded by `CopyPackingFromTripControl`).

## Realtime & data flow

Copied packing items broadcast over the existing `packing-${tripId}` channel (INSERT), so
both partners see them live and the active view's owner partition places them correctly.
New categories ride `revalidatePath` + `RefreshOnVisible`, exactly like today's import.
No new channel, no schema change.

## Files touched

- `src/app/trips/[slug]/import-picker.tsx` — **new.** Generic `ImportPickerControl`.
- `src/app/trips/[slug]/import-from-trip.tsx` — slim to a wrapper over
  `ImportPickerControl` (API unchanged; Notes + any other caller untouched).
- `src/app/trips/[slug]/copy-packing-from-trip.tsx` — **new.** Trip-copy control with the
  Shared/My source toggle.
- `src/lib/trips/actions.ts` — add `getImportableChecklists` + `copyChecklistToPacking`;
  extend `copyPackingFromTrip` with `sourceOwner` + `targetOwner`.
- `src/app/trips/[slug]/packing-tab.tsx` — render both import controls on My + Shared;
  thread `onAddFromChecklist` + `onCopyPacking`; drop `onCopyShared`.
- `docs/TODO.md`, `docs/DECISIONS.md` — log on completion.

## Out of scope (v1)

- Selecting individual items to copy (whole-source copy only).
- Importing into the Partner list (read-only view).
- Partner's personal items as an import source.
- Any reverse "packing → checklist" flow.
- Item-level dedup on repeat copies.
- A fourth packing switcher segment for checklists, or one merged import control (both
  explicitly rejected — see Problem).
