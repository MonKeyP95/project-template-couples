# Note Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A note can carry a "remind me" date and time. Once that time has passed, the Notes box (road, phone trip page) and the desktop "Trip folder" pill turn clay until someone taps "done".

**Architecture:** One nullable `remind_at timestamptz` column on `trip_notes`. Pure helpers decide due-ness and format times. Pages compute "any due" at render and pass a boolean down. Done is a tiny server action that nulls the column.

**Tech Stack:** Next.js 16 App Router, Server Actions, Supabase (`@supabase/ssr`), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-11-24-note-reminders-design.md`

## Global Constraints

- No test runner exists. Do not add one. Verify with `pnpm exec tsc --noEmit` (no output) and `pnpm lint` (no problems).
- Do not run `pnpm build` while the user's dev server may be running.
- The migration must be re-runnable. The user pastes it into the Supabase SQL editor by hand.
- Colour for due is clay (`text-clay`, `border-clay`, `bg-clay-tint`). Red is reserved for over budget.
- Dates are en-GB, day before month, e.g. "18:00 · 25 Nov".
- Times are entered and shown in the device timezone from `localTimeZone()` (`src/lib/time/local-today.ts`). Pass it from the server page as a `tz: string` prop so server and client render the same string.
- No emojis, sparse comments, short functions.

## Review Focus

- **Saving a note with no change to its reminder** must keep the reminder. The editor must send the original value back, not null. Covered in Task 3 Step 3.
- **Clearing the field in the editor** removes the reminder (`remind_at` becomes null). Covered in Task 3 Step 3.
- **On the road, a due note from another day** must appear in the Notes list, or the box is coloured with no visible cause. Covered in Task 4 Step 2.
- **A due note that is also today's note** must be listed once, not twice. Covered in Task 4 Step 2.
- **The desktop pill when "Trip folder" is the active tab** stays the normal active style. You're already looking at the notes. Covered in Task 5 Step 2.

---

### Task 1: Column, type and pure helpers

**Files:**
- Create: `supabase/migrations/20261124000001_note_reminders.sql`
- Modify: `src/lib/trips/note-queries.ts` (type, row, `rowToNote`, `NOTE_COLS`)
- Create: `src/lib/trips/note-reminders.ts`

**Interfaces:**
- Produces: `TripNote.remindAt: string | null` (ISO timestamptz).
- Produces, in `note-reminders.ts` (no server imports, so it's client-safe):
  - `isDue(note: { remindAt: string | null }, now: Date): boolean`. True when `remindAt` is set and `<= now`.
  - `hasDue(notes: { remindAt: string | null }[], now: Date): boolean`
  - `reminderLabel(iso: string, tz: string): string`. Returns `"HH:MM · D Mon"` in `tz`, e.g. `"18:00 · 25 Nov"`.
  - `toLocalInput(iso: string | null, tz: string): string`. Returns `"yyyy-mm-ddThh:mm"` in `tz`, or `""` for null, as a `datetime-local` value.
  - `fromLocalInput(value: string): string | null`. Returns `""` → null, otherwise `new Date(value).toISOString()`. Called in the browser, so the device's local time is used.

- [ ] **Step 1:** Write the migration: `alter table public.trip_notes add column if not exists remind_at timestamptz;` with a header comment noting that the existing RLS covers it and that it's idempotent.
- [ ] **Step 2:** Add `remindAt` / `remind_at` to `TripNote`, `TripNoteRow` and `rowToNote`. Add `remind_at` to `NOTE_COLS`.
- [ ] **Step 3:** Write `note-reminders.ts` with the five functions above. Use `Intl.DateTimeFormat("en-GB", { timeZone: tz, ... })` with `hourCycle: "h23"`.
- [ ] **Step 4:** Run `pnpm exec tsc --noEmit` and `pnpm lint`. Expected: clean.
- [ ] **Step 5:** Commit: `feat: remind_at on trip notes + reminder helpers`.

### Task 2: Actions write and clear `remind_at`

**Files:**
- Modify: `src/lib/trips/actions.ts` (`AddNoteInput`/`addNote` ~1370-1416, `UpdateNoteInput`/`updateNote` ~1449-1495)

**Interfaces:**
- Consumes: `TripNote.remindAt` (Task 1).
- Produces:
  - `AddNoteInput.remindAt?: string | null`. It's inserted as `remind_at: input.remindAt ?? null`. The `.select(...)` string in `addNote` must include `remind_at`.
  - `UpdateNoteInput.remindAt: string | null`. It's required, and `updateNote` always writes `remind_at`.
  - `clearNoteReminder(noteId: string, tripSlug: string): Promise<{ error?: string }>`. It sets `remind_at` to null and runs `revalidatePath(\`/trips/${tripSlug}\`)`.

- [ ] **Step 1:** Extend both inputs and the insert/update payloads as above. Add `clearNoteReminder` after `updateNote`.
- [ ] **Step 2:** Run `pnpm exec tsc --noEmit`. Expected: an error in `note-parts.tsx` because `NoteEditor` doesn't pass the now-required `remindAt` yet. That proves every caller is found. Leave it for Task 3.
- [ ] **Step 3:** Don't commit yet. This task's commit happens together with Task 3, because the tree doesn't typecheck in between.

### Task 3: Trip-page note UI (set, show, done)

**Files:**
- Modify: `src/app/trips/[slug]/note-parts.tsx` (`AddNoteForm`, `NoteCard`, `NoteView`, `NoteEditor`)
- Create: `src/app/trips/[slug]/remind-field.tsx`
- Modify: `src/app/trips/[slug]/notes-tab.tsx`, `src/app/trips/[slug]/folder-toolbar.tsx`, `src/app/trips/[slug]/page.tsx` (pass `tz`)

**Interfaces:**
- Consumes: helpers (Task 1), actions (Task 2).
- Produces: `RemindField({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean })`. It's a labelled `datetime-local` input with the label "Remind me". `value` is the local-input string.
- `NoteCard`, `AddNoteForm` and `NotesTab` each gain `tz: string`. `NoteCard` also gains `now: number` (ms, computed once by the server page and passed down). It's a prop rather than `Date.now()` in the client so server and client agree.

- [ ] **Step 1:** Write `remind-field.tsx`. Style it like `PlacePicker` (same label style and spacing).
- [ ] **Step 2:** `AddNoteForm`: add a `remind` state (`""`) plus a `RemindField`, and send `remindAt: fromLocalInput(remind)`.
- [ ] **Step 3:** `NoteEditor`: initialise `remind` to `toLocalInput(note.remindAt, tz)`. On save, send `remindAt: fromLocalInput(remind)`. When the field is unchanged, that converts back to the same minute (Review Focus 1), and an empty field sends null (Review Focus 2).
- [ ] **Step 4:** `NoteView`: when `isDue(note, new Date(now))`, give the note a clay left border plus a clay `reminderLabel` and a "done" button that calls `clearNoteReminder` in a transition. When it has a reminder that isn't due, show a grey `remind {reminderLabel}` next to the date.
- [ ] **Step 5:** Thread `tz` and `now` from `page.tsx` (`await localTimeZone()`, `Date.now()`) through `NotesTab` and `FolderToolbar` to `NoteCard` and `AddNoteForm`.
- [ ] **Step 6:** Run `pnpm exec tsc --noEmit` and `pnpm lint`. Expected: clean, including the Task 2 error.
- [ ] **Step 7:** Commit Tasks 2 and 3 together: `feat: set, show and clear note reminders on the trip page`.

### Task 4: On the road: quick note reminder, due notes, coloured box

**Files:**
- Modify: `src/lib/trips/note-queries.ts` (add `getDueNotes`)
- Modify: `src/app/on-the-road/quick-note.tsx`, `src/app/on-the-road/road-cards.tsx` (`KeepCard`), `src/app/on-the-road/page.tsx`

**Interfaces:**
- Consumes: helpers, `addNote`, `clearNoteReminder`, `RemindField`.
- Produces: `getDueNotes(tripId: string): Promise<TripNote[]>`, using `.not("remind_at", "is", null).lte("remind_at", new Date().toISOString())`, ordered by `remind_at`.
- `KeepCard` gains `notesDue: boolean`. `QuickNote` gains `tz: string` and `now: number`.

- [ ] **Step 1:** Add `getDueNotes`.
- [ ] **Step 2:** In the road `page.tsx`, list notes as the due notes first, then today's notes whose id isn't already among the due ones. That covers Review Focus 3 and 4. Pass `notesDue={due.length > 0}`.
- [ ] **Step 3:** `KeepCard`: when `notesDue`, the Notes summary detail reads `"reminder due"` in `text-clay`, and that `BoxCard` gets `border-clay bg-clay-tint`.
- [ ] **Step 4:** `QuickNote`: add a `RemindField` under the input and send `remindAt`. Each listed note that's due shows its clay `reminderLabel` and a "done" button calling `clearNoteReminder`.
- [ ] **Step 5:** Run `pnpm exec tsc --noEmit` and `pnpm lint`. Expected: clean.
- [ ] **Step 6:** Commit: `feat: due note reminders on the road`.

### Task 5: Phone Notes box and desktop pill

**Files:**
- Modify: `src/app/trips/[slug]/mobile-trip.tsx` (Notes `BoxCard` ~58-64, props ~19-26)
- Modify: `src/app/trips/[slug]/page.tsx` (`DesktopTabs` ~605-630 and both call sites)

**Interfaces:**
- Consumes: `hasDue` (Task 1). Compute it once in `page.tsx` as `const notesDue = hasDue(notes ?? [], new Date(now))`.
- `MobileTripProps` gains `notesDue: boolean`. `DesktopTabs` gains `notesDue: boolean`.

- [ ] **Step 1:** Mobile: when `notesDue`, the Notes `BoxCard` gets `border-clay bg-clay-tint`, and its detail reads `"reminder due"` in `text-clay` instead of the count.
- [ ] **Step 2:** `DesktopTabs`: when `t.id === "notes" && notesDue && !isActive`, the pill uses `border-clay bg-clay-tint text-clay`. When it's the active tab, it keeps the active style (Review Focus 5).
- [ ] **Step 3:** Run `pnpm exec tsc --noEmit` and `pnpm lint`. Expected: clean.
- [ ] **Step 4:** Update `docs/TODO.md`: add an entry marked "implemented; unverified in app; migration `20261124000001_note_reminders.sql` to paste", with the in-app checks below.
- [ ] **Step 5:** Commit: `feat: note reminder colour on phone notes box and desktop pill`.

## Success criteria

**Verified by Claude:** `tsc` and lint are clean after each task. The migration is re-runnable (`if not exists`). `addNote`, `updateNote` and `clearNoteReminder` each write `remind_at`. `addNote`'s select returns it. `updateNote` always sends it, so an untouched editor keeps it.

**Verified by the user in-app** (after pasting the migration):
1. Edit a note, set "Remind me" to two minutes from now and save. The note shows a grey "remind HH:MM · D Mon".
2. After that time, reload. On desktop the "Trip folder" pill is clay. On the phone trip page the Notes box is clay and reads "reminder due". The note has a clay edge and a "done" button.
3. On the road, the Notes box is clay, and the due note is listed even if it was written on another day.
4. Tap "done". The colour goes away everywhere after reload, for your partner too.
5. Edit a note that has a reminder, change only the text and save. The reminder stays. Clear the field and save, and the reminder is gone.
6. On the road, a quick note saved with a reminder shows it the same way.
