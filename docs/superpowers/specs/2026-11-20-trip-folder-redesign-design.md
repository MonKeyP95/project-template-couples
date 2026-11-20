# Trip folder redesign

Date: 2026-11-20. Status: approved approach (A, two slices); doc awaiting approval.

## Why

The desktop trip folder is busy: actions are scattered (document buttons in the title row, a notes import inside notes, packing's import in packing), notes are hidden behind per-place groups, and documents are large stacked cards. The user wants one simple page: every action in the title row like the other tabs, and documents and notes visible at a glance.

## Goals

- All folder actions are pills in the title row, same `toolbarPill(…, "sand")` style as budget/itinerary/packing.
- Documents and notes side by side on wide screens.
- Notes are one flat list, newest first, each with a place tag.
- Reuse passport/insurance on a new trip without re-uploading (slice 2).

## Non-goals

- No change to the phone trip page layout beyond the notes list (see Notes below).
- No change to on-the-road documents.
- No shared-file model between trips; no new table.
- No narrowing of the checklist import to the folder's checklist category.

## Anti-goals

- A second notes component for desktop only (parallel systems).
- Deleting a document on one trip breaking it on another.

## Approaches

- **A (picked): change the notes component everywhere.** `NotesTab` becomes a flat list; the phone gets the same list. One component, no drift.
- B: a desktop-only notes list, phone keeps place groups. Rejected: two notes systems.
- For document import, **copy the file** (picked) vs. share one file. Sharing needs a new table, ownership rules and a reference-counted delete, because `deleteReceipt` removes the storage object and storage RLS keys access on the uploading trip's folder (`receipts/<trip_id>/…`), so a shared file dies with its original trip.

## Slice 1: folder layout

### Title row

```
Trip folder   [take a photo] [add documents] [+ note] [import]
```

- `take a photo`, `add documents`: unchanged behaviour (`AddDocumentButtons`).
- `+ note`: opens a note box under the row (`order-last w-full` panel, like budget's toolbar). Textarea + optional place picker (default: trip-wide, i.e. `location_id` null) + save. Uses the existing add-note action.
- `import`: opens a panel under the row with two choices: **notes** (existing `ImportFromTripControl` + `copyNotesFromTrip`) and **checklists** (existing `ImportItemsDialog`, unchanged: imports a packing list from another trip or a saved checklist). Slice 2 adds **documents**.
- Open pill is solid (`toolbarPill(true, "sand")`); one panel open at a time.
- Builder's call: the title row needs client state for the open panel, so the folder (or its toolbar) becomes a client component receiving the server-rendered sections as nodes.

### Body

```
 DOCUMENTS · 4                 │ NOTES · 3
 PDF  TAP boarding passes      │ ┌ Book the Pico Ruivo shuttle…   ┐
      12 Dec – 22 Dec          │ └ Funchal · N · 3 Nov            ┘
 IMG  Passport scan            │ ┌ Dinner list: Kampo, …          ┐
      no dates                 │ └ Trip-wide · M · 9 Nov          ┘
───────────────────────────────────────────────────────────────────
 CHECKLIST (full width, as today)
```

- Two columns at `xl` and up; stacked (documents first) below that. My call: the main column is too narrow for two columns on smaller laptop windows.
- Documents: compact rows with a small file-type icon (PDF / IMG, from `mime_type`), title, dates line; click opens `DocumentView` as today. Search box stays (from 4 documents). "read again" on failed reads stays.
- Notes: one list, newest first (`created_at` desc), each card shows text, a place tag ("Trip-wide" or the location name, in the location's tone), author initial and date (`en-GB`, `{day} {mon}`). Editing as today (`NoteEditor`).
- Removed from notes: the place groups, the per-group add box, the `AssistantBlock` at the top of the folder's notes, and the hard-coded "drafted by M+G" line.
- Checklist unchanged, full width below.

### Notes on the phone

Because of approach A, the phone notes become the same flat list. The phone has no title-row pills, so `NotesTab` keeps an add box at the top of the list there. My call: the phone keeps its assistant bar (`assistantBar`), since only the desktop folder was discussed.

## Slice 2: import documents

- `import` gets a third choice, **documents**: pick another trip in the workspace, tick its documents, import.
- New server action: for each picked document, `storage.copy` the object from `<source_trip>/…` to `<target_trip>/<new name>`, then insert a `receipts` row with `kind='document'`, the new `storage_path`, and the source's `mime_type`, `original_name`, `entries`, `reading`, `read_status`. No AI re-read.
- No migration: existing receipts RLS and storage policies already allow a workspace member to read the source and write the target.
- Deleting either copy only removes that copy.

## Success criteria

Verified by Claude:
- `pnpm lint` clean, `pnpm build` passes after each slice.
- Notes list is ordered by `created_at` desc and every note renders a place tag (null location -> "Trip-wide").
- Slice 2 action: copies the storage object to the target trip's folder and inserts a row whose `storage_path` starts with the target trip id; source row untouched.

Verified by the user in-app:
1. Desktop folder: four sand pills right of the title; nothing else above the content.
2. `+ note` opens a box; saving with no place shows the note at the top tagged "Trip-wide"; picking a place tags it with that place.
3. `import` -> notes copies another trip's notes; `import` -> checklists opens the existing import dialog.
4. Wide window: documents left, notes right; narrow window: stacked, documents first.
5. Documents show as compact rows with a PDF/IMG icon; clicking opens the document.
6. Phone notes: one newest-first list with place tags and an add box at the top.
7. (Slice 2) Import passport from an earlier trip: it appears with its details, no "reading…"; deleting it here leaves the original trip's copy intact.

## Left to the builder

- Exact component split for the client toolbar and panels.
- Whether the place picker is a select or chips (match `NoteEditor`).
