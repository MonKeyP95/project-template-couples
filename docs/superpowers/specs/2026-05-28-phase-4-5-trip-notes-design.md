# Phase 4.5 — Trip Notes (design)

**Date:** 2026-05-28
**Status:** Approved, ready for implementation plan.
**Carries from:** doc-audit gap-fill — `VISION.md:10` ("restaurant ideas"), `FEATURES.md:15` ("Trip notes and restaurant ideas"), `PLAN.md:22` ("per-trip notes"), `design_handoff_together_app/README.md:253` (`Notes` desktop nav item). None of these had a corresponding TODO line; this slice closes that gap.

## Goal

A new Notes tab on `/trips/[slug]` where any workspace member can jot down free-text notes (restaurant ideas, hire-scooter tips, "ask Andi about pho") for a specific trip, edit them, and delete them. Replaces "no place to capture it" — currently the only way to record a trip-related thought is to put it in the trip name or a packing-item label, neither of which fits.

## Non-goals

- **Workspace-level notes** (`/notes` route, notes that don't belong to a trip). The design handoff puts a `Notes` item in the workspace-level desktop nav, but per-trip-only ships in one slice and covers the most-cited use case ("restaurant ideas for *this* trip"). Revisit `/notes` if "general travel hacks" or untethered-restaurant-ideas become felt gaps.
- **Categories / tags** (restaurant / lodging / tip / idea / other). Opinionated taxonomy, hard to undo, YAGNI. Line-break paragraphs are enough for v1; categories can come later when the user has a real signal about which categories matter.
- **Day association** (note for day 3). Useful eventually but adds a select to the form. Defer.
- **Realtime sync.** Notes are asynchronous — the user is unlikely to be co-typing a note with their partner. `RefreshOnVisible` (already mounted on the trip page) covers cross-device freshness. Matches the expenses tab; differs from packing (which IS synchronous).
- **Edit history / version log.** `updated_at` is tracked but never surfaced. No undo.
- **Right-rail integration.** The desktop right rail is labeled "Pre-trip" and shows packing-done % + budget-spent %. Notes don't fit the readiness frame; rail stays unchanged.

## Schema

New migration: `supabase/migrations/20260528000003_phase_4_5_trip_notes.sql`. Idempotent per project pattern (see `memory/feedback-idempotent-migrations.md`).

```sql
create table if not exists public.trip_notes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  body text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trip_notes_trip_created_idx
  on public.trip_notes (trip_id, created_at desc);

alter table public.trip_notes enable row level security;

drop policy if exists trip_notes_select on public.trip_notes;
create policy trip_notes_select on public.trip_notes
  for select using (is_trip_workspace_member(trip_id));

drop policy if exists trip_notes_insert on public.trip_notes;
create policy trip_notes_insert on public.trip_notes
  for insert with check (
    is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );

drop policy if exists trip_notes_update on public.trip_notes;
create policy trip_notes_update on public.trip_notes
  for update using (is_trip_workspace_member(trip_id));

drop policy if exists trip_notes_delete on public.trip_notes;
create policy trip_notes_delete on public.trip_notes
  for delete using (is_trip_workspace_member(trip_id));
```

Notes:
- `body` is `not null` — a note must have content. Empty-body insert returns a friendly "Note body required." from the Server Action before hitting the DB.
- `created_by` locked at insert (`created_by = auth.uid()` in the insert policy). Updates don't touch it — "Monkey wrote this" stays true forever.
- `on delete cascade` from `trips(id)` so deleting a trip wipes its notes alongside packing/expenses/itinerary (matches the FK pattern of the other child tables).
- `trip_notes_trip_created_idx` supports the page query's `where trip_id = $1 order by created_at desc`.

## Server Actions

All three appended to `src/lib/trips/actions.ts`. Follow the existing patterns in that file.

### `addNote(input: AddNoteInput): Promise<AddNoteResult>`

```ts
export interface AddNoteInput {
  tripId: string
  tripSlug: string
  body: string
}

export interface AddNoteResult {
  error?: string
  /** Populated on success so the client can prepend optimistically if desired. */
  note?: TripNote
}
```

- Validates `body.trim().length > 0` (returns "Note body required." otherwise).
- Reads `auth.uid()` for `created_by`; relies on RLS to gate workspace membership.
- Inserts the row, selects it back so the action returns the full `TripNote` (with `id`, `created_at`, etc.) for an optimistic-prepend on the client.
- `revalidatePath('/trips/'+tripSlug)`. No `/home` revalidation — notes don't surface on home.

### `updateNote(input: UpdateNoteInput): Promise<UpdateNoteResult>`

```ts
export interface UpdateNoteInput {
  noteId: string
  tripSlug: string
  body: string
}

export interface UpdateNoteResult {
  error?: string
}
```

- Validates `body.trim().length > 0`.
- Single `UPDATE trip_notes SET body, updated_at = now() WHERE id = noteId` — RLS gates membership. `created_by` and `created_at` never touched.
- `revalidatePath('/trips/'+tripSlug)`.

### `deleteNote(noteId: string, tripSlug: string): Promise<void>`

- Throws on error (form-compatible like `deleteTrip` / `settleUp`).
- Single `DELETE FROM trip_notes WHERE id = noteId`. RLS gates membership.
- `revalidatePath('/trips/'+tripSlug)`. No redirect — the user stays on the Notes tab.

## Query layer

New file: `src/lib/trips/note-queries.ts`.

```ts
export interface TripNote {
  id: string
  tripId: string
  body: string
  createdBy: string
  createdAt: string  // ISO timestamptz
  updatedAt: string
}

export async function getTripNotes(tripId: string): Promise<TripNote[]>
```

- Selects `id, trip_id, body, created_by, created_at, updated_at`, filtered to `trip_id = tripId`, ordered `created_at desc`. Camel-cases at the query layer so the view doesn't see snake_case.
- Mirrors `packing-queries.ts` / `expense-queries.ts` shape.

The `TripNote` type also gets imported into `actions.ts` so `addNote` can return it.

## UI

### Tab integration (`src/app/trips/[slug]/page.tsx`)

Five small edits to add `"notes"` to the existing tab system:

1. `type TabId = "itinerary" | "packing" | "budget" | "notes"`
2. `TABS` array gains `{ id: "notes", label: "Notes" }` at the end.
3. `isTab` function adds `value === "notes"` to its union.
4. `DesktopTabs.labelFor` returns the bare integer for notes (no unit suffix — distinct from `days` / `€`).
5. Page-level fetch: `getTripNotes(header.id)` runs only when `activeTab === "notes"`, lazy like itinerary. Notes count is computed for `DesktopTabs` only when notes loaded.

`BottomNav` (mobile) and `DesktopTabs` (desktop) iterate over `TABS` so neither needs structural changes beyond the array entry. The href shape `?tab=notes` follows the existing pattern.

### `NotesTab` component (`src/app/trips/[slug]/notes-tab.tsx`, `"use client"`)

Layout (mobile and lg use the same single-column shape — no rail-specific variant):

```
/ NOTES                              drafted by ●M+G
─────────────────────────────────────────────────────

┌─────────────────────────────────────────────────┐
│ [textarea: jot down a note...]                  │ ← AddNoteRow (always at top)
│                                       [+ save]  │
└─────────────────────────────────────────────────┘

  Pho place near the temple, small alley near
  the harbour — ask for Andi
  ●M  2026-06-13                            ✎  ×

  Hire scooters from the rental shop opposite
  the harbour, €5/day
  ●G  2026-06-13                            ✎  ×
```

Header strip matches the Itinerary view's `/ NOTES` label + `drafted by ●M+G` byline (same `Label` primitive, same tone).

**Three sub-components in the same file:**

- **`AddNoteRow`** — Always visible at the top of the list. A `<textarea>` (3-row min, auto-grows up to ~8 rows via `field-sizing-content`), a `+ save` button below-right. On submit:
  - Calls `addNote({ tripId, tripSlug, body })` via `useTransition`.
  - On success → clears the textarea, **keeps focus** for batch-entry (same rhythm as `+ add packing item`).
  - On error → surfaces inline below the textarea in `text-clay font-mono text-[10px]`.
  - Submit is disabled when `body.trim() === ''` or pending.
  - The Server Action's return value is ignored on the client (no optimistic prepend in v1 — `revalidatePath` refreshes the Server Component's list naturally). The action still returns the note so a future optimistic version is trivial.

- **`NoteCard`** — One note. Layout: body (with `whitespace-pre-wrap` so line breaks render), then an underline-style meta row with `Avatar` (size 18, tone from `members[createdBy]`) + author display name + ISO date in mono on the left, `✎` and `×` buttons on the right.
  - `✎` toggles edit mode for this note (see below).
  - `×` triggers `window.confirm("Delete this note? This can't be undone.")` → submits a `<form action={deleteNote.bind(null, noteId, tripSlug)}>`. Same pattern as `deleteTrip`.

- **Edit-in-place state** — `editingId` is a `useState<string | null>` lifted to the `NotesTab` parent so only one note is in edit mode at a time (clicking `✎` on another note exits the first). When `editingId === note.id`, the `NoteCard`'s body slot renders a textarea pre-filled with `note.body` + a `save` / `cancel` button pair below.
  - `save` calls `updateNote({ noteId, tripSlug, body })`, then on success `setEditingId(null)`.
  - `cancel` reverts (just `setEditingId(null)`, no DB call; the input state is local to the editing render).
  - Same error-surfacing pattern as `AddNoteRow`.

**Empty state:** when `notes.length === 0`, render the `AddNoteRow` plus a small italic line beneath it: *"No notes yet — jot the first one."* (`font-serif italic text-muted-foreground t-display text-[15px]`). Matches the voice of `DreamItineraryStub`. No empty illustration.

### Author lookup

`NotesTab` takes `members: Record<string, MemberToneEntry>` as a prop — same shape `PackingTab` consumes, built once in `page.tsx` via the existing `memberToneMap(workspace)` helper. No new lookup code; just thread the prop through.

### Dream variant

Identical behaviour — notes don't depend on dates. "Things to research before booking Patagonia" is a perfectly natural use case for a dream's Notes tab. No conditional rendering needed.

## File-level summary

**New files:**

- `supabase/migrations/20260528000003_phase_4_5_trip_notes.sql` — table + index + RLS.
- `src/lib/trips/note-queries.ts` — `TripNote` type + `getTripNotes`.
- `src/app/trips/[slug]/notes-tab.tsx` — `"use client"` Notes tab UI (AddNoteRow + NoteCard + edit state).

**Modified files:**

- `src/lib/trips/actions.ts` — append `addNote`, `updateNote`, `deleteNote` plus their input/result types.
- `src/app/trips/[slug]/page.tsx` — extend `TabId` union, `TABS`, `isTab`, `DesktopTabs.labelFor`; add lazy `getTripNotes` fetch and render `<NotesTab>` when active; pass `members` prop through.

**Unmodified (called out so the plan doesn't drift):**

- `src/app/trips/[slug]/page.tsx` `DesktopRightRail` — does not get a notes row. Rail stays "Pre-trip" / readiness-only.
- All other tab components (`itinerary` rendering, `PackingTab`, `BudgetTab`) — untouched.
- No new primitives in `src/components/together/`.

## Decisions worth a `DECISIONS.md` row after shipping

1. **Per-trip-only scope** (deferred workspace-level `/notes` despite the design handoff calling for a top-level Notes nav). Reason: most-cited use case is per-trip; workspace-level revisit-when-felt.
2. **No categories.** YAGNI; trust line-break paragraphs. Opinionated taxonomy is hard to undo once committed.
3. **`RefreshOnVisible` over Realtime for notes.** Notes are async-collaborative (you don't co-type them); not worth a second WebSocket channel.
4. **Right rail unchanged.** Notes don't fit the "Pre-trip readiness" frame the rail represents.

## Out-of-spec follow-ups (carried)

- Workspace-level `/notes` route (matches design handoff). Revisit after Lombok trip if "general restaurant ideas not tied to any trip" becomes a felt gap.
- Categories/tags (restaurant / lodging / tip / idea) — only if browsing notes by type becomes painful.
- Day association (`day_date` nullable column + day picker on form) — only if "morning of day 3" notes feel essential.
- Realtime channel for notes — only if simultaneous co-typing becomes a real scenario.
- Markdown rendering — only if notes start growing into formatted documents.
