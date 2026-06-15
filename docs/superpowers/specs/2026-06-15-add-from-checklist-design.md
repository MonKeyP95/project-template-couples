# Add from checklist → packing — design

**Date:** 2026-06-15
**Status:** Approved, ready for implementation plan

## Problem

Checklists are workspace-level reusable templates (camping, trek, surfing…) living
on their own `/checklists` route. When packing for a trip there is no way to pull a
checklist's items into the trip's packing list — you'd retype them.

The user initially considered surfacing checklists as a fourth segment in the packing
switcher (My / Shared / Partner / Checklists). We rejected that: checklists are
workspace-scoped and reusable (a *library of named lists*), while the packing segments
are this-trip and each a *single list*. Mixing them conflates scopes, breaks the
"one tap, one list" segment metaphor (checklists are many lists), and lets a tap inside
the packing tab silently mutate a shared workspace template.

Instead we use the bridge the checklists feature was designed for: `checklist_items`
already share the `category` + `label` + `done` shape of `packing_items`, so copying a
checklist into a trip's packing is a small additive action — the same pattern as the
existing "Copy packing from another trip" import.

## What it does

On the Packing tab's **My list** and **Shared** views (not the read-only Partner view),
a dashed **"Add from checklist"** button sits beside the existing add-category control.
Tap it → a picker of the workspace's checklists → choose one → **copy**. The checklist's
items land in the view you are on (`owner_id = me` for My list, `null` for Shared),
**unpacked** (`done = false`), merged into that scope's categories. The checklist
template is untouched — this is a one-time copy.

Scope is chosen by which view you are on (per-view placement), mirroring how the
existing import control already works.

## Server actions

Both live in `src/lib/trips/actions.ts` (next to `copyPackingFromTrip` /
`getImportableTrips`).

### `getImportableChecklists()`

```ts
export async function getImportableChecklists(): Promise<ImportableTrip[]>
```

Returns the current workspace's checklists as `{ id, name }[]` (reusing the existing
`ImportableTrip` shape so the generalized picker stays one type). Resolves the workspace
via `getCurrentWorkspace()` and maps `listChecklists(workspace.id)` to `{ id, name }`.
Returns `[]` when there is no workspace or no checklists.

### `copyChecklistToPacking(targetTripId, checklistId, owner, tripSlug)`

```ts
export async function copyChecklistToPacking(
  targetTripId: string,
  checklistId: string,
  owner: string | null,
  tripSlug: string,
): Promise<CopyResult>
```

Mirrors `copyPackingFromTrip`, but the source is a checklist and the target scope is the
chosen `owner`:

1. Auth: `getUser()`; `{ error: "Not signed in." }` if absent.
2. Read in parallel:
   - source `checklist_categories` (`name, sort_order`, ordered) for `checklistId`,
   - source `checklist_items` (`category, label`) for `checklistId`,
   - target `packing_categories` (`name, sort_order`) for `targetTripId` filtered to the
     `owner` scope (`.is("owner_id", null)` when `owner === null`, else `.eq("owner_id", owner)`).
3. Insert checklist categories not already present in the target scope, with
   `owner_id = owner`, `created_by = me`, `sort_order` continuing from the scope's max.
4. Insert all checklist items as packing items: `owner_id = owner`, `added_by = me`,
   `done` defaults to false (omit it), `category` copied verbatim (links by name).
5. `revalidatePath(/trips/${tripSlug})`; return `{}` or `{ error }`.

RLS already covers this: reading the checklist is gated by
`is_checklist_workspace_member`; the packing inserts are gated by the
`owner_id is null or owner_id = auth.uid()` check — `owner` is only ever `null` (Shared)
or the current user (My list), both allowed. No new policies, no migration.

Additive, no item-level dedup (same as `copyPackingFromTrip`): copying the same checklist
twice duplicates items, which is acceptable and matches the existing import's behaviour.

## UI — generalize the existing picker

`ImportFromTripControl` (`src/app/trips/[slug]/import-from-trip.tsx`) is a dashed button
that opens to a `Select` + "copy". The checklist picker is the same control with a
different data source, so rather than clone it we **extract its generic core** into a
reusable picker and keep `ImportFromTripControl` as a thin wrapper. This keeps the
existing call sites (the Notes tab's "Copy notes from another trip", packing's "Copy
packing from another trip") completely unchanged.

New generic control in `src/app/trips/[slug]/import-picker.tsx` (markup/styles lifted
verbatim from the current `ImportFromTripControl`):

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

- `load` replaces the hard-coded `getImportableTrips(tripId)` call.
- `emptyText` replaces the hard-coded "No other trips to copy from." string.
- Everything else (open/close, `useTransition`, `Select`, error line) is unchanged.

`ImportFromTripControl` (same file as today, `import-from-trip.tsx`) becomes a wrapper so
its `{ tripId, label, onCopy }` API and both its callers stay as-is:

```tsx
export function ImportFromTripControl({ tripId, label, onCopy }: {
  tripId: string
  label: string
  onCopy: (sourceTripId: string) => Promise<{ error?: string }>
}) {
  return (
    <ImportPickerControl
      label={label}
      emptyText="No other trips to copy from."
      load={() => getImportableTrips(tripId)}
      onCopy={onCopy}
    />
  )
}
```

(`notes-tab.tsx` is therefore **not** touched.)

Call sites in `packing-tab.tsx`:

- **Copy from another trip** (Shared only, `owner === null`): unchanged — keeps using
  `ImportFromTripControl` with `onCopy={onCopyShared}`.
- **Add from checklist** (whenever `!readOnly`, i.e. My + Shared): use `ImportPickerControl`
  directly with `load={getImportableChecklists}`, `label="Add from checklist"`,
  `emptyText="No checklists to copy from."`, `onCopy={(id) => onAddFromChecklist(id, owner)}`.

`PackingList` gains one prop, `onAddFromChecklist: (checklistId: string, owner: string |
null) => Promise<{ error?: string }>`, wired in `PackingTab` to
`copyChecklistToPacking(tripId, checklistId, owner, tripSlug)` — mirroring the existing
`onAddCategory(name, owner)` threading. The checklist picker renders inside the
`!readOnly` branch (so it shows on My + Shared, never Partner); the copy-from-trip picker
stays inside the `owner === null` branch (Shared only), unchanged.

## Realtime & data flow

Copied packing items broadcast over the existing `packing-${tripId}` channel (INSERT), so
both partners see them live and the active view's owner partition places them correctly.
New categories ride `revalidatePath` + `RefreshOnVisible`, exactly like
`copyPackingFromTrip`. No new channel, no schema change, no migration.

## Files touched

- `src/app/trips/[slug]/import-picker.tsx` — **new.** Generic `ImportPickerControl`.
- `src/app/trips/[slug]/import-from-trip.tsx` — slim down to a wrapper over
  `ImportPickerControl` (API unchanged; callers untouched).
- `src/lib/trips/actions.ts` — add `getImportableChecklists` + `copyChecklistToPacking`.
- `src/app/trips/[slug]/packing-tab.tsx` — add the "Add from checklist" control
  (`ImportPickerControl`) on My + Shared; thread `onAddFromChecklist`.
- `docs/TODO.md`, `docs/DECISIONS.md` — log on completion.

## Out of scope (v1)

- Selecting individual items to copy (whole-checklist copy only).
- Copying into the Partner list (read-only view).
- Any reverse "packing → checklist" flow.
- Item-level dedup on repeat copies.
- A fourth packing switcher segment for checklists (explicitly rejected — see Problem).
