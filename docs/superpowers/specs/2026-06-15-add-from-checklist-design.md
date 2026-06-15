# Packing "Import items" dialog — design

**Date:** 2026-06-15
**Status:** Approved, ready for implementation plan

## Problem

Two gaps in the packing tab's "bring items in" story:

1. **No checklist bridge.** Checklists are workspace-level reusable templates (camping,
   trek, surfing…) on their own `/checklists` route. When packing for a trip there is no
   way to pull a checklist's items into the trip's packing — you'd retype them.
2. **Import asymmetry from the semi-private work.** "Copy packing from another trip" only
   appears on the **Shared** list and only ever copies the *source trip's shared* packing.
   The My list / Partner views have no import at all.

Rejected alternatives: a fourth packing switcher segment for checklists (conflates the
this-trip single-list segments with a workspace-level library of lists, and risks editing
a shared template from the packing tab); and per-view dashed import buttons (the in-list
"copy from another trip" / "add from checklist" bars felt scattered).

**Chosen approach:** one global **"Import items"** button in the packing switcher row that
opens a modal dialog. The dialog picks a source (another trip, or a checklist) and a
target list (My or Shared), then copies. This retires every in-list import bar.

The bridge is a copy: `checklist_items` already share the `category` + `label` + `done`
shape of `packing_items`, and another trip's packing is the same table.

## What it does

The packing switcher row keeps `My list · Shared · Partner's list` on the left and adds a
visually distinct **"Import items"** button (ghost style, download icon, pushed right with
`ml-auto`) — an action, not a fourth view toggle. It is always visible, including when the
read-only Partner view is active.

Tapping it opens a modal dialog (built on the existing `@/components/ui/dialog`):

- **Step 1 — choose source:** two buttons, **From a trip** and **From a checklist**.
- **Step 2a — from a trip:** a **"To: ( My list )( Shared )"** target toggle, a trip
  dropdown, and a **"From: ( Shared )( My list )"** source toggle, plus **Import** / a
  back affordance to step 1.
- **Step 2b — from a checklist:** the same **"To: ( My list )( Shared )"** target toggle
  and a checklist dropdown, plus **Import** / back.

All copies are one-time and **additive**: items arrive **unpacked** (`done = false`),
merged into the target scope's same-name categories; source templates/trips are untouched.
"My list" as a trip source means *your own* personal items in that other trip
(`owner_id = you`); the partner's personal items are never an import source.

**Defaults:** the **To** toggle pre-selects the list that was active when the dialog
opened — `My list` if the active view is My, otherwise `Shared` (so Partner-active →
Shared). The trip **From** toggle defaults to **Shared**.

## Server actions

All in `src/lib/trips/actions.ts`.

### `getImportableChecklists()` (new)

```ts
export async function getImportableChecklists(): Promise<ImportableTrip[]>
```

Returns the current workspace's checklists as `{ id, name }[]` (reuses the existing
`ImportableTrip` shape). Resolves the workspace via `getCurrentWorkspace()` and maps
`listChecklists(workspace.id)`. Returns `[]` when there is no workspace or no checklists.

### `copyChecklistToPacking(targetTripId, checklistId, owner, tripSlug)` (new)

```ts
export async function copyChecklistToPacking(
  targetTripId: string,
  checklistId: string,
  owner: string | null,
  tripSlug: string,
): Promise<CopyResult>
```

Mirrors the revised `copyPackingFromTrip`, with a checklist as the source and `owner` the
target scope:

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

```ts
// before: copyPackingFromTrip(targetTripId, sourceTripId, tripSlug)
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
  My, where `sourceOwner` is the current user's id).
- Target existing-category read and both inserts use `targetOwner` (categories
  `owner_id = targetOwner` / `created_by = me`; items `owner_id = targetOwner` /
  `added_by = me`, `done` reset). Category merge is within the target scope.
- The sole caller becomes the new import dialog (below); the old `packing-tab.tsx`
  call site is removed.

### RLS / migration

No new policies, no migration. Reading a checklist is gated by
`is_checklist_workspace_member`; reading another trip's packing (shared or your own items)
is gated by `is_trip_workspace_member` (importable trips are same-workspace siblings).
Packing inserts are gated by the existing `owner_id is null or owner_id = auth.uid()`
check — `targetOwner` is only ever `null` (Shared) or the current user (My), both allowed.
Additive, no item-level dedup (matches today's import).

## UI component — `ImportItemsDialog`

New `src/app/trips/[slug]/import-items-dialog.tsx`, a packing-specific client component.
It is self-contained: it calls the server actions directly (no prop-drilled callbacks).

```ts
export function ImportItemsDialog({
  open,
  onOpenChange,
  tripId,
  tripSlug,
  currentUserId,
  defaultTarget, // "mine" | "shared"
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tripId: string
  tripSlug: string
  currentUserId: string
  defaultTarget: "mine" | "shared"
})
```

Structure: a controlled `<Dialog open onOpenChange>` whose `DialogContent` renders an inner
`ImportItemsBody` **only while open and keyed on each open** (`key={open ? "open" :
"closed"}`), so the body's local state resets per open via `useState` initializers — no
`useEffect`-to-reset (respects the project's `react-hooks/set-state-in-effect` rule).

`ImportItemsBody` holds:
- `step: "choose" | "trip" | "checklist"` (initial `"choose"`).
- `target: "mine" | "shared"` (initial `defaultTarget`).
- trip flow: lazily-loaded `trips` (`getImportableTrips(tripId)`), `selectedTrip`,
  `sourceMine: boolean` (initial `false`).
- checklist flow: lazily-loaded `checklists` (`getImportableChecklists()`),
  `selectedChecklist`.
- `pending`, `error`.

Behaviour:
- Step 1 shows two buttons; choosing one sets `step` and triggers that flow's `load` in a
  `useTransition`. Each step-2 screen has a "back" control returning to `"choose"`.
- The **To** and **From** toggles are small segmented controls (same look as the packing
  `SegBtn`). Empty source lists show "No other trips to copy from." / "No checklists to
  copy from." in place of the dropdown.
- Import maps toggles to owners and calls the action:
  - trip: `copyPackingFromTrip(tripId, selectedTrip, sourceMine ? currentUserId : null,
    target === "mine" ? currentUserId : null, tripSlug)`.
  - checklist: `copyChecklistToPacking(tripId, selectedChecklist, target === "mine" ?
    currentUserId : null, tripSlug)`.
  - On success: `onOpenChange(false)`. On `{ error }`: show it inline, stay open.

The `Select` dropdowns reuse `@/components/ui/select` exactly as `import-from-trip.tsx`
does today.

### Wiring in `packing-tab.tsx`

- Add `importOpen` state and an **"Import items"** button at the end of the switcher row
  (`ml-auto`, ghost styling, lucide `Download` icon).
- Render `<ImportItemsDialog open={importOpen} onOpenChange={setImportOpen} tripId={tripId}
  tripSlug={tripSlug} currentUserId={currentUserId} defaultTarget={view === "mine" ?
  "mine" : "shared"} />` once, at the section level (outside `PackingList`).
- **Remove** the old in-`PackingList` import block: the `ImportFromTripControl` usage
  (Shared view), the `onCopyShared` prop, and the `copyPackingFromTrip` import in
  `packing-tab.tsx`. `PackingList` no longer renders any import control.

`import-from-trip.tsx` is left **unchanged** — the Notes tab still uses it for "Copy notes
from another trip". No generic extraction is needed.

## Realtime & data flow

Copied packing items broadcast over the existing `packing-${tripId}` channel (INSERT), so
both partners see them live and the active view's owner partition places them correctly.
New categories ride `revalidatePath` + `RefreshOnVisible`, exactly like today's import.
No new channel, no schema change.

## Files touched

- `src/app/trips/[slug]/import-items-dialog.tsx` — **new.** The two-step import dialog.
- `src/lib/trips/actions.ts` — add `getImportableChecklists` + `copyChecklistToPacking`;
  extend `copyPackingFromTrip` with `sourceOwner` + `targetOwner`.
- `src/app/trips/[slug]/packing-tab.tsx` — add the "Import items" button + dialog; remove
  the in-view import control, `onCopyShared`, and the now-unused `copyPackingFromTrip`
  import.
- `docs/TODO.md`, `docs/DECISIONS.md` — log on completion.

## Out of scope (v1)

- Selecting individual items to copy (whole-source copy only).
- Importing into the Partner list (read-only) or using the partner's items as a source.
- Any reverse "packing → checklist" flow.
- Item-level dedup on repeat copies.
- A fourth packing switcher segment, or per-view import bars (both explicitly rejected —
  see Problem).
