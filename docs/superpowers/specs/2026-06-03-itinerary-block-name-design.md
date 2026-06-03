# Itinerary block name — design

**Date:** 2026-06-03
**Status:** approved

## Problem

When you add a 2+ day span to the dated itinerary, the days share a `group_id`
and render inside a rounded border with a hardcoded caption that reads
**"added together"** (`itinerary-tab.tsx`). There is no way to name the block —
e.g. label a 3-day span "Rinjani Trek". The caption is fixed text and no name is
stored anywhere.

## Goal

Make the block caption an editable name. The block still appears automatically
for any run of 2+ consecutive same-`group_id` days. The caption shows the name
if set, else the existing "added together" placeholder. Clicking it edits the
name inline, the same pattern as the location rename already in the tab.

## Scope

Dated itinerary only (`itinerary_days`). The dream itinerary is unchanged. No
naming at creation time — the name is set/edited inline after the span exists.

## Approach (chosen)

**Denormalized `group_name` column on `itinerary_days`.** Every row of a span
carries the same name; an edit writes it to all rows of the group with one
`UPDATE ... WHERE group_id = $1`.

Chosen over a normalized `itinerary_groups` table because it reuses everything
already in place — existing RLS, the existing `itinerary_days` Realtime channel
(so name edits propagate to the partner for free), and the existing queries.
The redundancy (name repeated on each row of the span) is minor and kept
consistent by the group-wide UPDATE.

## Design

### Schema

Idempotent migration adding one nullable column:

```sql
alter table public.itinerary_days
  add column if not exists group_name text;
```

No index, no constraint, inherits the table's existing RLS.

### Action

New server action `renameItineraryGroup(groupId, tripSlug, name)`:

- Trims `name`; empty string clears the name (stores `null`), which makes the
  caption fall back to "added together".
- `update({ group_name: name || null }).eq("group_id", groupId)` — sets the name
  on every row of the span in one statement.
- `revalidatePath` for the trip, matching the other itinerary actions.

### Threading the field

`group_name` flows through the same path `group_id` already does:

- `ItineraryRow` / `ItineraryDay` gain `groupName: string | null`.
- `rowToItineraryDay` maps `row.group_name ?? null`.
- The itinerary query `.select(...)` adds `group_name`.
- `RealtimeRow` in `itinerary-tab.tsx` adds `group_name: string | null`.

The existing UPDATE Realtime handler replaces each changed row, so a group-wide
rename updates every row of the block and the caption re-renders.

### UI

In the multi-day segment branch (`seg.groupId && seg.days.length > 1`), the
fixed `<span>added together</span>` caption becomes an editable control:

- Display state: a button showing `seg.days[0].groupName` if set, else the
  "added together" placeholder text (placeholder styled muted, a set name styled
  as a real heading). Clicking enters edit mode.
- Edit state: an inline text input (autoFocus, submit on Enter, cancel/commit on
  blur) mirroring the location-rename input already in the file. Submit calls
  `renameItineraryGroup(seg.groupId, tripSlug, value)` inside a transition.
- Local edit state keyed by `groupId` (e.g. `editingGroupId` / `groupNameVal`),
  parallel to the existing `renamingId` / `renameVal` for locations.

The block border and layout are unchanged — only the caption becomes editable.

## Edge behavior

- Editing or deleting individual days keeps the name (it is on every remaining
  row). A name survives as long as one row of the group remains.
- Clearing the name (submit empty) reverts the caption to "added together".
- Pre-existing spans have `group_name = null` and show the placeholder until
  named — no data migration needed.
- A single day (no longer 2+ in a run) never shows the caption, so its
  `group_name`, if any, is simply not displayed; harmless.

## Out of scope

- Naming at creation time (the Add-day form is unchanged).
- A normalized groups table.
- Naming dream-itinerary multi-adds.
