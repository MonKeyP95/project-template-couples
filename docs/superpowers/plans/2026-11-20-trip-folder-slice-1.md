# Trip Folder Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the desktop trip folder: four sand pills in the title row (two of them open panels), documents and notes side by side, notes as one newest-first list with place tags.

**Architecture:** Note UI pieces move out of the 473-line `notes-tab.tsx` into `note-parts.tsx`; `NotesTab` becomes a flat list with a `layout: "phone" | "folder"` switch. A new client `FolderToolbar` owns the open-panel state for `+ note` / `import`. `TripFolder` (server) lays out the two columns.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, Shadcn `Select` on `@base-ui/react`.

**Spec:** `docs/superpowers/specs/2026-11-20-trip-folder-redesign-design.md` (slice 1 only)

## Global Constraints

- No tests exist; every task verifies with `pnpm lint` (clean) and `pnpm build` (passes). Do not add a test runner.
- Toolbar pills use `toolbarPill(active, "sand")` from `src/app/trips/[slug]/toolbar-pill.ts`.
- Dates `en-GB`, day before month.
- A null `location_id` is labelled **"Trip-wide"** everywhere (tag, add picker, edit picker), replacing "General (no location)".
- `"use client"` files import query types from `*-types.ts` / `type`-only imports, never runtime imports from `*-queries.ts`.
- No emojis. No migration.

## Review Focus

- A note whose `locationId` points at a deleted location: tag falls back to "Trip-wide" (Task 1 `placeName`).
- Trip with no locations: add-note picker shows only "Trip-wide" and still saves (Task 1).
- Saving a note from the folder `+ note` panel: list updates via the action's revalidate; the textarea clears and stays open for the next note (Task 1 `AddNoteForm`).
- Phone notes keep their add box, import control and assistant bar; only grouping changes (Task 2).
- Opening `import` while `+ note` is open closes the note panel; only one panel at a time (Task 4).

---

### Task 1: Extract note parts and add place tag + add form

**Files:**
- Create: `src/app/trips/[slug]/note-parts.tsx` (`"use client"`)
- Modify: `src/app/trips/[slug]/notes-tab.tsx` (remove moved code, import from `note-parts`)

**Interfaces:**
- Produces:
  - `placeName(locationId: string | null, locations: ItineraryLocation[]): string` — location name, or `"Trip-wide"` when null or not found.
  - `PlaceTag({ locationId, locations }: { locationId: string | null; locations: ItineraryLocation[] })` — small mono uppercase tag; text from `placeName`, colour `toneText[slugToTone(locationId)]` for a found location, `text-muted-foreground` for Trip-wide.
  - `PlacePicker({ value, onChange, locations, disabled }: { value: string | null; onChange: (v: string | null) => void; locations: ItineraryLocation[]; disabled?: boolean })` — the existing `Select` from `NoteEditor`, first item `null` = "Trip-wide".
  - `AddNoteForm({ tripId, tripSlug, locations }: { tripId: string; tripSlug: string; locations: ItineraryLocation[] })` — today's `AddNoteRow` plus a `PlacePicker` (default `null`) under the textarea; calls `addNote({ tripId, tripSlug, body, locationId })`; clears and refocuses on success.
  - `NoteCard` — moved unchanged in props; `NoteView` additionally renders `<PlaceTag>` in its footer next to the date, so `NoteCard`/`NoteView` gain `locations` (NoteCard already has it).
- `NoteEditor` uses `PlacePicker` instead of its inline `Select`.

- [ ] **Step 1:** Create `note-parts.tsx` with `formatNoteDate`, `toneText`, `placeName`, `PlaceTag`, `PlacePicker`, `AddNoteForm`, `NoteCard`, `NoteView`, `NoteEditor` (moved bodies; `AddNoteRow` becomes `AddNoteForm`). Export `AddNoteForm`, `NoteCard`, `PlaceTag`.
- [ ] **Step 2:** In `notes-tab.tsx`, delete the moved code and import from `./note-parts`. Keep the per-group `AddNoteForm` call for now, passing `locations` (grouping is removed in Task 2).
- [ ] **Step 3:** Run `pnpm lint` then `pnpm build`. Expected: lint clean, `✓ Compiled successfully`.
- [ ] **Step 4:** Commit: `refactor: note parts move to note-parts.tsx; notes get a place tag and picker`.

### Task 2: NotesTab becomes one flat list

**Files:**
- Modify: `src/app/trips/[slug]/notes-tab.tsx`
- Modify: `src/app/trips/[slug]/page.tsx` (the `notesSection` element)

**Interfaces:**
- Consumes: `AddNoteForm`, `NoteCard` from Task 1.
- Produces: `NotesTab` props: replace `assistantBar: boolean` with `layout: "phone" | "folder"`. Other props unchanged.

- [ ] **Step 1:** Remove `buildGroups`, `NoteGroup`, `GENERAL_KEY`, the `open` state and `toggle`, and the "drafted by" line.
- [ ] **Step 2:** Render, in order:
  - `layout === "phone"` only: `AssistantBlock` with `bar` (as today), then the `Notes` label row, then `ImportFromTripControl` (as today), then `AddNoteForm`.
  - Both layouts: the notes in `initialNotes` order (already newest first from `getTripNotes`), each a `NoteCard` with `locations`, separated by `border-t border-rule`; empty list shows `no notes yet` in `text-[13px] text-muted-foreground`.
  - `layout === "folder"`: drop the section's `pt-5 lg:pt-6` top padding to `pt-3` (the folder column supplies the heading).
- [ ] **Step 3:** In `page.tsx`, pass `layout={isMobile ? "phone" : "folder"}` instead of `assistantBar={isMobile}`.
- [ ] **Step 4:** `pnpm lint`, `pnpm build`. Expected: clean, compiles.
- [ ] **Step 5:** Commit: `feat: notes are one newest-first list with place tags`.

### Task 3: Compact document rows

**Files:**
- Modify: `src/components/documents/documents-section.tsx` (`DocumentCard`)

- [ ] **Step 1:** Replace the card with a row: `flex items-center gap-3 py-2.5 border-t border-rule first:border-t-0`, a file icon box `flex h-8 w-[26px] shrink-0 items-end justify-center rounded-[4px] border border-border bg-sand-tint pb-[3px] font-mono text-[8px] text-muted-foreground` showing `PDF` when `doc.mimeType === "application/pdf"`, else `IMG`; then the existing title/dates button; "read again" button and `DocumentView` unchanged. The icon matches `FolderMini` in `page.tsx`.
- [ ] **Step 2:** `pnpm lint`, `pnpm build`. Expected: clean, compiles.
- [ ] **Step 3:** Commit: `style: documents show as compact rows with a file icon`.

### Task 4: Folder toolbar and two-column layout

**Files:**
- Create: `src/app/trips/[slug]/folder-toolbar.tsx` (`"use client"`)
- Modify: `src/app/trips/[slug]/trip-folder.tsx`
- Modify: `src/app/trips/[slug]/page.tsx` (TripFolder call)

**Interfaces:**
- Consumes: `AddNoteForm` (Task 1); `AddDocumentButtons` (`@/components/documents/document-search`); `ImportFromTripControl` (`./import-from-trip`) with `copyNotesFromTrip`; `ImportItemsDialog` (`./import-items-dialog`); `toolbarPill`.
- Produces:
  - `FolderToolbar({ tripId, tripSlug, locations, currentUserId }: { tripId: string; tripSlug: string; locations: ItineraryLocation[]; currentUserId: string })`. State `panel: "note" | "import" | null`. Renders, in one `flex flex-wrap items-center gap-2` row: `AddDocumentButtons` with `buttonClassName={toolbarPill(false, "sand")}`, a `+ note` button and an `import` button (`toolbarPill(panel === x, "sand")`, clicking toggles; opening one closes the other). Open panel below as `order-last w-full rounded-xl border border-border bg-card p-4`:
    - `note`: `AddNoteForm`.
    - `import`: `ImportFromTripControl` (label `Copy notes from another trip`), and a `checklists` button that opens `ImportItemsDialog` with `defaultTarget="shared"`.
  - `TripFolder` props: `{ toolbar: ReactNode; documents: ReactNode; documentsCount: number; notes: ReactNode; notesCount: number; checklist: ReactNode }` (`actions` removed).

- [ ] **Step 1:** Create `folder-toolbar.tsx` per the interface.
- [ ] **Step 2:** `TripFolder` layout:
  - Title row: `h2` "Trip *folder*" with `mr-auto`, then `{toolbar}` (the toolbar's own row wraps under the title on narrow widths).
  - Body: `grid gap-8 px-5 pt-4 lg:px-10 xl:grid-cols-2`, each column starts with `<Label>Documents · {documentsCount}</Label>` / `<Label>Notes · {notesCount}</Label>`. Strip the inner `px-5` side padding from both sections inside the grid by wrapping each in `-mx-5` so content aligns with the label.
  - Then the checklist `FolderPart label="Checklist"` as today (full width, `border-t`).
- [ ] **Step 3:** In `page.tsx`, pass `toolbar={<FolderToolbar tripId={header.id} tripSlug={header.slug} locations={locations ?? []} currentUserId={userData.user!.id} />}`, `documentsCount={documents.length}`, `notesCount={(notes ?? []).length}`; drop the `actions` prop and the now-unused `AddDocumentButtons` / `toolbarPill` imports if nothing else uses them.
- [ ] **Step 4:** `pnpm lint`, `pnpm build`. Expected: clean, compiles.
- [ ] **Step 5:** Commit: `feat: trip folder toolbar with note and import panels, two columns`.

### Task 5: Record it

**Files:**
- Modify: `docs/TODO.md`

- [ ] **Step 1:** Add an entry at the top of the status list: "Trip folder slice 1: implemented 2026-11-20; lint clean; `pnpm build` passes; unverified in app; no migration." followed by in-app checks 1–6 from the spec's success criteria.
- [ ] **Step 2:** Commit: `docs: TODO entry for trip folder slice 1`.
