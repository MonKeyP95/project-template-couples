# Trip Documents + Trip Folder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload any trip document, have Claude read its key details and dated entries, show it on the trip page (phone Documents box, desktop Trip folder tab) and on the on-the-road page on every day an entry covers.

**Architecture:** Documents are rows in the existing `receipts` table with `kind = 'document'`, an `entries` jsonb and `original_name`. The receipt upload path is reused with a `kind` argument; `runRead` dispatches to a new `read-document` agent for documents. Pure functions in `document-types.ts` own normalising and the per-day filter. `PackingTab` gains a `between` slot and a `"checklist"` layout so one component instance (one Realtime channel) can place Packing and Checklist apart.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + Storage + RLS), `@anthropic-ai/sdk` 0.106 (Haiku 5.5), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-22-trip-documents-design.md`

## Global Constraints

- Reader model `claude-haiku-5-5`, via `runAgent`, no forced `toolChoice` (same as `read-receipt`).
- Table/bucket names stay `receipts`; `kind` in (`receipt`, `document`), default `receipt`.
- A read writes `entries` only while it is null; it never overwrites a hand edit.
- Receipt pile and `suggestExpenseMatches` only ever see `kind = 'receipt'`.
- Exactly one `PackingTab` mounted per rendered trip page (one `packing-${tripId}` channel).
- Phone box order: Trip, Budget, Packing, Documents, Notes, Checklist. Desktop tab label "Trip folder" (id stays `notes`), content Documents, Notes, Checklist; the "Documents" category no longer shows in the desktop Packing tab.
- Dates shown `en-GB` day-before-month. No emojis. Migration re-runnable, pasted by the user.
- No test runner: pure functions checked with a scratch `node` script (not committed); per task `pnpm lint` + `pnpm exec tsc --noEmit`. No local `pnpm build` while the dev server runs; the Vercel build is the build check.
- Git: add explicit paths only (five unrelated files are dirty in the tree).

## Review Focus

1. **A PDF with nothing dated** (insurance policy): read succeeds with `entries: []`; it lists under Documents (undated last) and never on the road page. Pinned in Task 2 (`documentsForDay` with empty entries).
2. **Return flight read as one span** by the model: the user fixes it in the view by splitting into two entries; saving replaces `entries`. Pinned in Task 6 (entry add/remove in the view) and Task 2 (two single-day entries → exactly two days).
3. **Entry with end before start or garbage time** from the model: normalised (end → null, time → null) before storing. Pinned in Task 2.
4. **Desktop user deep-linked to `?tab=notes`**: lands on Trip folder. Pinned in Task 5 (tab id unchanged).
5. **Two phones ticking the Checklist**: still syncs, because it's the same `PackingTab` channel. Pinned in Task 5 (no second mount) and in the user's in-app check.

---

### Task 1: Migration

**Files:** Create `supabase/migrations/20261022000002_trip_documents.sql`

- [ ] **Step 1:** `alter table public.receipts add column if not exists kind text not null default 'receipt'`, `add column if not exists entries jsonb`, `add column if not exists original_name text`; `drop constraint if exists receipts_kind_check` then `add constraint receipts_kind_check check (kind in ('receipt','document'))`; `create index if not exists receipts_trip_kind_idx on public.receipts (trip_id, kind)`. RLS and storage policies are unchanged (already per trip).
- [ ] **Step 2:** Commit; ask the user to paste it twice.

---

### Task 2: Document types and pure functions

**Files:** Create `src/lib/trips/document-types.ts`. Scratch check: `<scratchpad>/document-types.check.ts`.

**Produces:**
```ts
export interface DocumentEntry { label: string | null; startDate: string; endDate: string | null; startTime: string | null; endTime: string | null; address: string | null }
export interface DocumentReading { title: string | null; summary: string | null; reference: string | null; link: string | null; entries: DocumentEntry[] }
export interface TripDocument { id: string; tripId: string; storagePath: string; mimeType: ReceiptMime; readStatus: "pending" | "done" | "failed"; reading: DocumentReading | null; entries: DocumentEntry[] | null; originalName: string | null; createdAt: string; url: string }
export function normalizeDocumentReading(raw: DocumentReading): DocumentReading
export function entryCovers(entry: DocumentEntry, day: string): boolean
export function documentsForDay(docs: TripDocument[], day: string): { doc: TripDocument; entry: DocumentEntry }[]   // first covering entry per doc, ordered by that entry's startTime (nulls last)
export function entryTimeForDay(entry: DocumentEntry, day: string): string | null   // startTime on startDate, endTime on endDate, null between; single-day → startTime
export function documentTitle(doc: TripDocument): string   // reading.title ?? originalName ?? "Document"
export function firstEntryDate(doc: TripDocument): string | null   // min startDate over entries, for sorting
```

- [ ] **Step 1: Write the check script** (`node:assert`), cases:
  - normalise: entry `startDate: "14/10/2026"` is dropped; `endDate` before `startDate` → null; `startTime: "3pm"` → null, `"15:00"` kept; `link: "javascript:x"` → null, `"https://a.b"` kept; `entries` missing/non-array → `[]`.
  - `documentsForDay`: return flight entries 2026-11-03 and 2026-11-17 → shown on 03 and 17, not on 10; span 03→07 shown on 03, 05, 07, not 08; doc with `entries: []` and doc with `entries: null` never shown.
  - `entryTimeForDay`: span 03→07 with 15:00/11:00 → "15:00" on 03, null on 05, "11:00" on 07; single day 06:40 → "06:40".
  - `documentTitle` falls back to `originalName`, then "Document".
- [ ] **Step 2:** Run it → fails (module missing).
- [ ] **Step 3:** Implement. Date validity reuses the receipt rule (`yyyy-mm-dd` that round-trips through `Date`); time rule `/^([01]\d|2[0-3]):[0-5]\d$/`; link rule `/^https?:\/\//i`.
- [ ] **Step 4:** Run → pass; lint + tsc clean.
- [ ] **Step 5:** Commit `feat(documents): types, normaliser and per-day filter`.

---

### Task 3: read-document agent

**Files:** Modify `src/lib/ai/registry.ts` (tool `submit_document`); Create `src/lib/ai/agents/read-document.ts`; Modify `src/lib/ai/claude.ts` (re-export).

**Produces:** `readDocumentFile(file: ReceiptFile): Promise<DocumentReading>` from `@/lib/ai/claude` (throws when no tool block).

- [ ] **Step 1:** `submit_document`, strict, all `DocumentReading` fields required/nullable, entries items with every `DocumentEntry` field required (`startDate` described "yyyy-mm-dd", times "HH:MM 24-hour").
- [ ] **Step 2:** Descriptor mirrors `read-receipt.ts` (Haiku, maxTokens 4096, same image/PDF input). System prompt: read bookings, confirmations, tickets, policies; report only what's printed; one entry per separate leg/event (outbound and return flights are two entries), one span entry for a continuous stay or rental (check-in→check-out, pickup→return) with start/end times; `link` only a URL printed in the document; title short and specific ("Hostel Lisboa", "Flights TLV–LIS").
- [ ] **Step 3:** Live probe from a scratch script with a text return-flight + hostel confirmation: expect two single-day entries for the flight, one span for the hostel. Record tokens.
- [ ] **Step 4:** lint + tsc; commit `feat(ai): read-document agent`.

---

### Task 4: Server side — queries, actions, upload kind

**Files:** Modify `src/lib/trips/receipt-queries.ts`, `src/lib/trips/receipt-actions.ts`, `src/lib/trips/receipt-upload.ts`.

**Produces:**
```ts
getTripReceipts(tripId)            // now filters kind = 'receipt'
getTripDocuments(tripId): Promise<TripDocument[]>   // kind = 'document', signed URLs, sorted by firstEntryDate (null last)
AddReceiptInput gains kind: "receipt" | "document"; originalName: string | null
updateDocument(id: string, patch: { title: string | null; entries: DocumentEntry[] }, tripSlug: string): Promise<{ error?: string }>
UploadReceiptInput gains kind?: "receipt" | "document" (default "receipt")
```
- [ ] **Step 1:** Extract the signed-URL step into a private `signPaths(supabase, paths)` used by both queries.
- [ ] **Step 2:** `runRead` selects `kind, entries, reading` too; for `document` calls `readDocumentFile` → `normalizeDocumentReading`, writes `reading`, `read_status: "done"`, and `entries` only when the row's `entries` is null. Receipts unchanged. `readReceipt` keeps its signature (its `reading` result is receipt-only; documents return `{}`).
- [ ] **Step 3:** `updateDocument`: normalise `entries` with `normalizeDocumentReading({ ...emptyReading, entries }).entries`; update `entries` and `reading` with `reading.title` replaced (read the row's `reading` first; null reading → `{ title, summary: null, reference: null, link: null, entries: [] }`). Revalidate trip + on-the-road.
- [ ] **Step 4:** `uploadReceipt` passes `kind` and `originalName: input.file.name` to `addReceipt`; `uploadAndRead` forwards `kind`.
- [ ] **Step 5:** lint + tsc; commit `feat(documents): queries, read dispatch, updateDocument`.

---

### Task 5: Checklist placement and Trip folder tab

**Files:** Modify `src/app/trips/[slug]/packing-tab.tsx`, `mobile-trip.tsx`, `page.tsx`.

- [ ] **Step 1: PackingTab.** `layout?: "tab" | "boxes" | "checklist"`; new prop `between?: ReactNode` (boxes only). `isDoc` now applies in **every** layout (the Documents category never shows inside Packing). `"boxes"` renders: Packing box, then `between`, then the **Checklist** box (summary label "Checklist", noun "ready", add placeholder "Add an item to bring…"). `"checklist"` renders only the checklist list (no BoxCard), for the desktop tab. Extract the list into a local `Checklist` component used by both.
- [ ] **Step 2: Phone.** `MobileTripProps`: replace `packingAndDocuments` + `notes` with `packingDocumentsNotesChecklist: ReactNode` — page passes `packing("boxes", <>{documentsBox}{notesBox}</>)` so the order is Packing, Documents, Notes, Checklist. The Notes `BoxCard` moves from `MobileTrip` into the page's `between` node (keep its `SummaryRow`; `MobileTrip` exports `SummaryRow` or the page builds the box via a small exported `NotesBox`). Documents box comes from Task 6.
- [ ] **Step 3: Desktop.** `TABS` notes label → "Trip folder". Notes tab body = `<TripFolder documents={…} notes={notesSection} checklist={packing("checklist")} />` (Task 6 supplies the documents part; until then render documents as null). Only one tab renders at a time, so one PackingTab.
- [ ] **Step 4:** lint + tsc; commit `feat(trip): Checklist box after Notes, Trip folder tab`.

---

### Task 6: Documents UI

**Files:** Create `src/components/documents/documents-section.tsx`, `src/components/documents/document-view.tsx`; Modify `src/components/receipts/add-receipts-button.tsx` (prop `kind`, label), `src/app/trips/[slug]/page.tsx`.

**Produces:**
```ts
DocumentsSection(props: { tripId: string; tripSlug: string; documents: TripDocument[]; nowMs: number })
DocumentView(props: { doc: TripDocument; tripSlug: string; open: boolean; onOpenChange: (o: boolean) => void })
AddReceiptsButton gains kind?: "receipt" | "document"
```
- [ ] **Step 1:** `AddReceiptsButton` forwards `kind` to `uploadAndRead`; page passes `label="add documents"`, `kind="document"`.
- [ ] **Step 2:** `DocumentsSection`: add button, then cards (title via `documentTitle`, dates from entries `"3 Nov · 17 Nov"` / `"3–7 Nov"` via `dayLabel`, reading/failed states via `receiptState` + "read again" like `PileCard`). Empty → just the button.
- [ ] **Step 3:** `DocumentView` (Dialog): open file (img or "open PDF"), link (if any, `target=_blank`), summary, reference, editable title input, entries list each with label, start/end date inputs, start/end time inputs, remove; "add entry"; save → `updateDocument`; delete → `deleteReceipt`. Edit state is local to the dialog body (split component so it mounts fresh on open — no reset effect).
- [ ] **Step 4:** Page loads `getTripDocuments` when `wants("notes")`; phone: Documents box (`BoxCard`/`BoxSection`, summary "Documents" + count) wrapping `DocumentsSection`; desktop Trip folder: `DocumentsSection` above notes.
- [ ] **Step 5:** lint + tsc; commit `feat(documents): documents section and view`.

---

### Task 7: Documents today on the on-the-road page

**Files:** Create `src/app/on-the-road/documents-today.tsx`; Modify `src/app/on-the-road/page.tsx`.

- [ ] **Step 1:** `DocumentsToday({ items: { doc: TripDocument; entry: DocumentEntry }[], today: string, tripSlug: string })` (client, for the view dialog): section label "Documents today"; per item: `documentTitle`, entry label, `entryTimeForDay(entry, today)`, address, reference, "open" (file URL), link. Tapping the title opens `DocumentView`. Renders null when empty.
- [ ] **Step 2:** Page: `documentsForDay(await getTripDocuments(trip.id), today)`; render after the receipt section, before `QuickNote`.
- [ ] **Step 3:** lint + tsc; commit `feat(road): documents today`.

---

### Task 8: Docs, push, hand-over

- [ ] **Step 1:** `docs/TODO.md` entry (implemented, unverified); `docs/DECISIONS.md` row: documents live in `receipts` with `kind`; entries jsonb (separate days, span = every day); read never overwrites edited entries; Checklist is a label on the "Documents" category; Trip folder keeps tab id `notes`.
- [ ] **Step 2:** Commit; push branch `trip-documents` (user approved pushing branches for previews); wait for the Vercel build; report the preview URL — reads fail on previews (no Anthropic key there), so in-app checks run on prod after merge or locally.
- [ ] **Step 3:** Final whole-branch review by a fresh reviewer, fix Critical/Important, report.
