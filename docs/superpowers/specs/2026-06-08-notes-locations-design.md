# Location-filed notes — design

**Date:** 2026-06-08
**Status:** Approved, ready for implementation plan

## Goal

Let notes in the `/notes` tab be filed under a location, so each location can
carry its own location-specific notes — while still allowing notes with no
location (general notes). Locations reuse the existing `itinerary_locations`
(the same list used by the itinerary and budget): any location created in the
itinerary is automatically available to file notes under. Locations are still
created only in the Itinerary tab; Notes only picks from the existing list.

## Behaviour

- The Notes tab shows a **list of collapsible blocks**, mirroring the
  itinerary's location list:
  - One block per location, ordered by the location `sort_order`.
  - One **General** block for notes with no location, shown **first** (preserves
    the quick "jot a note" path), followed by the location blocks.
  - **No location is hidden** — every location appears even with zero notes.
- Each block header matches the itinerary location header: tone-colored location
  name, a small count subtitle (`3 notes` / `no notes`), and an expand/collapse
  chevron. **All blocks start collapsed**; pressing the header opens it.
- Inside an open block: **"+ add a note" is the first item**, then the notes
  filed under that location (newest first), each rendered with the existing note
  card (plain pre-wrapped text, edit ✎ / delete ×).
- The add-note form lives inside the block, so the target location is implied —
  no location picker on add. Adding inside the General block sends
  `location_id = null`.
- Editing a note keeps a small **Location select** (like the itinerary day
  editor) so a note can be re-filed to another location or moved to General.
- Notes display as **plain pre-wrapped text** as today. No markdown rendering is
  added (out of scope).

## Data model

New migration `supabase/migrations/20260608000003_trip_note_location.sql`,
idempotent:

```sql
alter table public.trip_notes
  add column if not exists location_id uuid
  references public.itinerary_locations(id) on delete set null;

create index if not exists trip_notes_location_idx
  on public.trip_notes (location_id);
```

`on delete set null` matches `itinerary_days.location_id`: deleting a location
turns its notes into General notes rather than destroying them. No RLS change is
needed — the existing `trip_notes` policies already gate access by trip.

## Code changes

- **`src/lib/trips/note-queries.ts`** — add `locationId: string | null` to
  `TripNote`, `location_id: string | null` to `TripNoteRow`, map it in
  `rowToNote`, and add `location_id` to the select in `getTripNotes`.
- **`src/lib/trips/actions.ts`**
  - `AddNoteInput` gains optional `locationId?: string | null`; `addNote` writes
    it into the insert.
  - `UpdateNoteInput` gains optional `locationId?: string | null`; `updateNote`
    writes it into the update.
  - `copyNotesFromTrip` leaves `location_id` null (locations are per-trip and do
    not carry across trips).
- **`src/app/trips/[slug]/page.tsx`** — in the notes branch, also call
  `getItineraryLocations(header.id)` and pass the result to `NotesTab` as
  `locations`.
- **`src/app/trips/[slug]/notes-tab.tsx`** — rebuild the list into collapsible
  location blocks:
  - `NotesTab` takes a new `locations: ItineraryLocation[]` prop.
  - Group `initialNotes` by `locationId` (null → General).
  - Render General block first, then one block per location in `sort_order`,
    each collapsible with header + count + chevron, starting collapsed.
  - Inside an open block: an add-note form (with the block's location id bound,
    null for General) as the first item, then the block's notes via the existing
    note card components.
  - The note editor gains a Location `<select>` (General + each location) to
    re-file a note, wired to `updateNote`'s `locationId`.

## Out of scope

- Creating locations from the Notes tab (Itinerary stays the only place).
- Markdown rendering of note bodies.
- Realtime updates for notes (notes are not realtime today; unchanged).
- Carrying note locations across trips in `copyNotesFromTrip`.
