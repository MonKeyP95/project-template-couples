# Trip documents + Trip folder — design

**Date:** 2026-10-22
**Status:** approved, not implemented
**Builds on:** `2026-10-22-receipt-attachments-design.md` (shipped)

## Why

Booking a hostel, an Airbnb, a car rental or a flight produces a confirmation.
On the day it matters (check-in, pickup, the flight, or a question about the
insurance mid-rental) you want its key details, the file and its link in front
of you, without digging through email. Receipts already upload, store and get
read by Claude; documents are the same pipeline with a different purpose.

## Goals

- Upload any document (PDF or photo) to a trip: bookings, confirmations,
  tickets, insurance, anything. **No fixed document types** — what a document
  is comes from Claude's reading, so new kinds need no change.
- Claude reads each document on upload into **key details** plus its **dated
  entries** (each leg or event on its own day or span: a return flight is two days, a hostel stay is check-in → check-out).
- A document shows on **every day any of its entries covers** on the on-the-road page:
  key details, open file, its link.
- Both modes: added while **planning** (trip page), surfaced **on the road**
  (on-the-road page) by date.

## Non-goals

- Linking a document to an expense (receipts do that; a document is not a payment record).
- Fixed document categories or per-kind screens.
- Email forwarding / inbox import.
- Reminders or notifications before a document's day.
- Full-text search across documents.

## Anti-goals

- Two different things on one screen both called "Documents".
- A document silently dated wrong with no way to fix it.

## User decisions

| Decision | Choice |
|---|---|
| Tagging | A file is tagged `receipt` or `document`. Receipts keep the receipt flow. Anything else is `document`. |
| Days shown | Separate days per leg/event; a stay or rental span shows every day of it ("we can always change it later"). |
| What a document shows | Key details **and** the file to open **and** its link. |
| Where you add documents | The trip page (planning). |
| Phone trip page | Three separate boxes, in this order: **Documents**, **Notes**, **Checklist**. |
| Checklist | Today's "Documents" box (the packing "Documents" category: passport, licence…), renamed **Checklist**. |
| Desktop trip page | The **Notes** tab is renamed **Trip folder** and holds documents, notes and the checklist. |
| On-the-road page | Today's documents in **their own section**, separate from today's notes. |

## Current state (from the code)

- `receipts` table + private `receipts` bucket (`supabase/migrations/20261022000001_receipts.sql`), `read-receipt` agent, upload helper `src/lib/trips/receipt-upload.ts`, pile/view components under `src/components/receipts/`.
- Phone trip page (`mobile-trip.tsx`): boxes are Trip, Budget, then `packing("boxes")` which renders **both** the Packing box and the Documents box from one `PackingTab` (one state, one Realtime channel `packing-${tripId}`), then Notes.
- Desktop tabs (`page.tsx` `TABS`): Budget, Itinerary, Packing, Notes. The "Documents" packing category shows inside the Packing tab on desktop today.
- Notes carry `day_date`; on-the-road loads `getNotesForDay(trip.id, today)`.

## Data model

Extend `public.receipts` (re-runnable migration):

| Column | Notes |
|---|---|
| `kind text not null default 'receipt'` check in (`receipt`, `document`) | Existing rows stay receipts. |
| `entries jsonb null` | The document's **dated entries** (user decision: separate days, not one span). Shape below. Null = not read / no dates. |
| `original_name text null` | File name at upload. *My call:* fallback title when the read fails or has no title. |

**Entries.** A document has zero or more entries; each is one leg or event,
either a single day or a span:

```json
[
  { "label": "Outbound TLV → LIS", "startDate": "2026-11-03", "endDate": null,
    "startTime": "06:40", "endTime": null, "address": "Ben Gurion, Terminal 3" },
  { "label": "Return LIS → TLV", "startDate": "2026-11-17", "endDate": null,
    "startTime": "21:15", "endTime": null, "address": "Lisbon Airport, T1" }
]
```

- A return flight is two single-day entries: it shows on the 3rd and the 17th only.
- A hostel stay is one span entry (check-in → check-out): it shows every day of
  the stay; the first day shows `startTime` (check-in), the last `endTime` (check-out).
- A car rental is one span entry (pickup → return), shown every day (user:
  "all days of rental could be useful, if we have a question about … the
  insurance"), pickup time on the first day, return time on the last.

A document shows on a day when **any** entry covers it
(`startDate <= day <= coalesce(endDate, startDate)`). Documents per trip are
few, so the filter runs in code over the trip's documents, no SQL date query.

*My call — re-reads never undo a hand fix:* a read writes `entries` only while
it is null. ("Read again" exists only for failed reads, which have none, so
this costs nothing.) The document view lets you edit each entry's label,
dates and times, add or remove an entry, and edit the **title**; an edited
title is stored in `reading.title`.

*My call — no re-tagging:* a file's kind is set by where it was added and
can't be switched. A booking photographed with the receipt camera is deleted
and re-added from the Documents box.

*My call — Checklist is a label:* the packing category keeps its stored name
"Documents" (`DOCUMENTS_CATEGORY`); only the box/section heading reads
"Checklist". After this change the category is lifted out of Packing on both
phone and desktop, so the word "Documents" no longer appears for it in the
trip page; no data migration.

*My call:* keep the table and bucket names `receipts` (a bucket can't be
renamed; renaming the table now churns every query for no behaviour change).
Code-side, the type gains `kind`; a DECISIONS row records the naming.

`reading` for a document (separate shape from a receipt's):

```json
{
  "title": "Hostel Lisboa",
  "summary": "4 nights, private double, breakfast included",
  "reference": "HB-48213",
  "link": "https://...",
  "entries": [
    { "label": "Stay", "startDate": "2026-11-03", "endDate": "2026-11-07",
      "startTime": "15:00", "endTime": "11:00", "address": "Rua ..., Lisboa" }
  ]
}
```

All fields nullable; `entries` may be empty. Dates normalised like receipts
(invalid → null; an entry with no valid `startDate` is dropped; an `endDate`
before `startDate` becomes null). Times must be `HH:MM` or null. `link` must be
an `http(s)` URL or null.

## Reading

- New agent descriptor `src/lib/ai/agents/read-document.ts` (Haiku 5.5, tool
  `submit_document`, same no-forced-tool-choice pattern as `read-receipt`).
  One file per agent, per CLAUDE.md.
- On a successful read, the `entries` column is set from `reading.entries`
  (only while null — see above). The prompt asks for one entry per separate
  leg/event, and one span entry for a continuous stay or rental.
- Upload path is the receipts one (browser → Storage → server action → read in
  background), with `kind: "document"` and no expense.

## UI

**Phone trip page**, boxes in this order: Trip, Budget, Packing, **Documents**,
**Notes**, **Checklist**.

- **Documents box:** "add document" button (multi-file, photo/PDF), then one
  card per document, ordered by earliest entry date (undated last): title,
  its entry dates (`en-GB`, e.g. "3 Nov · 17 Nov" or "3–7 Nov"),
  "reading…"/"couldn't read" states as receipts. Tapping opens a document
  view: key details, open file, link, the entries (editable), delete.
- **Notes box:** unchanged.
- **Checklist box:** today's Documents packing box, renamed. Constraint: it is
  still rendered by the single `PackingTab` that also renders Packing (one
  state, one Realtime channel) — do not mount a second `PackingTab`. How the
  one component places its two boxes apart is the builder's call.

**Desktop:** tab label **Trip folder** (tab id may stay `notes` so old
`?tab=notes` links keep working — builder's call). Content top to bottom:
Documents, Notes, Checklist. The "Documents" category leaves the desktop
Packing tab (it now lives in Trip folder), with the same single-`PackingTab`
constraint.

**On-the-road page:** a "Documents today" section listing documents with an
entry covering today. Per document: title, today's entry label, the time that
applies today (start time on an entry's first day, end time on its last, none
in between), address, reference, open file, link. Shown only when non-empty.
Separate from today's notes.

**Receipts stay as they are:** the receipt pile and suggestions only consider
`kind = 'receipt'`.

## Left to the builder

- Card and view styling within `DESIGN.md`.
- Exact read prompt wording.
- How `PackingTab` exposes Packing and Checklist as two placeable pieces.

## Success criteria

**Verified by Claude**
1. `pnpm lint` and `pnpm exec tsc --noEmit` clean; Vercel build passes.
2. Migration re-runnable; existing receipts rows read back as `kind = 'receipt'`.
3. Pure functions checked: document reading normaliser (bad date drops the entry, end-before-start → null end, bad time → null, non-http link → null); "documents for day" filter (two single-day entries show on exactly those two days; span shows start/middle/end; outside every entry not shown; no entries never shown); "time for day" (start time on first day, end time on last, none in between).
4. Receipt pile and `suggestExpenseMatches` input exclude documents.
5. Only one `PackingTab` (one `packing-${tripId}` channel) mounted per trip page.

**Verified by the user in-app**
1. Phone trip page shows boxes in order Packing, Documents, Notes, Checklist; Checklist holds passport/licence items and still syncs between two phones.
2. Desktop tab reads "Trip folder" and shows Documents, Notes, Checklist; the Packing tab no longer shows the Documents category.
3. Upload a hostel PDF: it is read, titled, dated check-in → check-out.
4. On each day of that stay (use a throwaway trip with today inside it), the on-the-road page shows it under "Documents today" with details, open file, link.
5. Fix a wrong date in the document view; it moves to the right days.
6. A flight ticket shows on its one day only.
7. Receipts still behave as before.
