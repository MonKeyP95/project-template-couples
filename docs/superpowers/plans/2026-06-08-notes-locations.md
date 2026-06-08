# Location-filed Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** File `/notes` notes under the trip's existing itinerary locations, shown as a collapsible itinerary-style list (one block per location plus a General block), while keeping location-less notes possible.

**Architecture:** Add a nullable `location_id` FK on `trip_notes` referencing `itinerary_locations` (`on delete set null`, mirroring `itinerary_days`). The query/action layer carries `locationId`; the Notes tab is rebuilt into collapsible location blocks with an in-block add-note form, mirroring `itinerary-tab.tsx`.

**Tech Stack:** Next.js 16 App Router, React 19, Server Actions, Supabase (Postgres + RLS), Tailwind v4, TypeScript.

**Testing note:** This repo has no test framework (per `CLAUDE.md`). The validation gate for each code task is `pnpm lint` then `pnpm build`, both clean. The migration is applied by hand in the Supabase SQL editor (no migration tooling). Do not invent a test command.

---

### Task 1: Add `location_id` column to `trip_notes`

**Files:**
- Create: `supabase/migrations/20260608000003_trip_note_location.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260608000003_trip_note_location.sql` with exactly:

```sql
-- Location-filed notes: trip_notes can reference an itinerary_locations row.
-- Mirrors itinerary_days.location_id -- nullable, on delete set null, so
-- deleting a location turns its notes into General (location-less) notes
-- rather than destroying them. No RLS change: existing trip_notes policies
-- already gate by trip via is_trip_workspace_member().
--
-- Idempotent: safe to paste-and-run multiple times.

alter table public.trip_notes
  add column if not exists location_id uuid
  references public.itinerary_locations(id) on delete set null;

create index if not exists trip_notes_location_idx
  on public.trip_notes (location_id);
```

- [ ] **Step 2: Apply the migration by hand**

Open the Supabase SQL editor for this project, paste the file contents, and run it. It is idempotent, so re-running is safe. (There is no migration CLI in this repo — committing the file does nothing to the DB on its own.)

- [ ] **Step 3: Verify the column exists**

In the Supabase SQL editor run:

```sql
select column_name, data_type
from information_schema.columns
where table_name = 'trip_notes' and column_name = 'location_id';
```

Expected: one row, `location_id | uuid`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260608000003_trip_note_location.sql
git commit -m "feat(notes): add location_id column to trip_notes"
```

---

### Task 2: Carry `locationId` through the note query layer

**Files:**
- Modify: `src/lib/trips/note-queries.ts`

- [ ] **Step 1: Add `locationId` to `TripNote`**

In `src/lib/trips/note-queries.ts`, add the field to the `TripNote` interface (after `body`):

```ts
export interface TripNote {
  id: string
  tripId: string
  body: string
  locationId: string | null
  createdBy: string
  /** ISO timestamptz from Postgres. */
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 2: Add `location_id` to the row type**

```ts
interface TripNoteRow {
  id: string
  trip_id: string
  body: string
  location_id: string | null
  created_by: string
  created_at: string
  updated_at: string
}
```

- [ ] **Step 3: Map it in `rowToNote`**

```ts
function rowToNote(r: TripNoteRow): TripNote {
  return {
    id: r.id,
    tripId: r.trip_id,
    body: r.body,
    locationId: r.location_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}
```

- [ ] **Step 4: Select the column in `getTripNotes`**

Change the `.select(...)` string to include `location_id`:

```ts
    .select("id, trip_id, body, location_id, created_by, created_at, updated_at")
```

- [ ] **Step 5: Validate**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/lib/trips/note-queries.ts
git commit -m "feat(notes): carry locationId through note query layer"
```

---

### Task 3: Accept `locationId` in the note actions

**Files:**
- Modify: `src/lib/trips/actions.ts` (`AddNoteInput`/`addNote` near line 841-882, `UpdateNoteInput`/`updateNote` near line 916-947)

- [ ] **Step 1: Add `locationId` to `AddNoteInput`**

```ts
export interface AddNoteInput {
  tripId: string
  tripSlug: string
  body: string
  /** Location to file the note under; null/undefined = General (no location). */
  locationId?: string | null
}
```

- [ ] **Step 2: Write `location_id` in `addNote`'s insert**

In `addNote`, change the `.insert({...})` to include `location_id`:

```ts
    .insert({
      trip_id: input.tripId,
      body,
      location_id: input.locationId ?? null,
      created_by: userData.user.id,
    })
```

- [ ] **Step 3: Add `locationId` to `UpdateNoteInput`**

```ts
export interface UpdateNoteInput {
  noteId: string
  tripSlug: string
  body: string
  /** New location for the note; null = move to General. */
  locationId?: string | null
}
```

- [ ] **Step 4: Write `location_id` in `updateNote`'s update**

In `updateNote`, change the `.update({...})` to include `location_id`:

```ts
    .update({
      body,
      location_id: input.locationId ?? null,
      updated_at: new Date().toISOString(),
    })
```

(Leave `copyNotesFromTrip` unchanged — copied notes stay General, since locations are per-trip.)

- [ ] **Step 5: Validate**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(notes): accept locationId in addNote and updateNote"
```

---

### Task 4: Rebuild the Notes tab into collapsible location blocks

**Files:**
- Modify: `src/app/trips/[slug]/notes-tab.tsx` (full rewrite)
- Modify: `src/app/trips/[slug]/page.tsx` (notes branch, near lines 156-172 and 244-251)

Both files change in one commit so the build stays green (the new `NotesTab` requires a `locations` prop that the page must supply).

- [ ] **Step 1: Rewrite `notes-tab.tsx`**

Replace the entire contents of `src/app/trips/[slug]/notes-tab.tsx` with:

```tsx
"use client"

import * as React from "react"

import { Avatar, Label } from "@/components/together"
import {
  addNote,
  copyNotesFromTrip,
  deleteNote,
  updateNote,
} from "@/lib/trips/actions"
import { ImportFromTripControl } from "./import-from-trip"
import type { TripNote } from "@/lib/trips/note-queries"
import type { ItineraryLocation } from "@/lib/trips/location-types"
import { slugToTone, type CardTone } from "@/lib/trips/slug-tone"

import type { MemberToneEntry } from "./packing-tab"

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
})

function formatNoteDate(iso: string): string {
  return SHORT_DATE.format(new Date(iso))
}

// Tone text color for the location header name (matches itinerary headers).
const toneText: Record<CardTone, string> = {
  sea: "text-sea",
  clay: "text-clay",
  moss: "text-moss",
  sand: "text-sand",
}

const GENERAL_KEY = "__general__"

interface NoteGroup {
  key: string
  name: string
  tone: CardTone | null
  /** Location to file new notes under; null = General. */
  locationId: string | null
  notes: TripNote[]
}

/** General block first, then one block per location in sort order. Notes keep
 * the newest-first order they arrive in from getTripNotes. */
function buildGroups(
  notes: TripNote[],
  locations: ItineraryLocation[],
): NoteGroup[] {
  const byLoc = new Map<string, TripNote[]>()
  const general: TripNote[] = []
  for (const n of notes) {
    if (n.locationId) {
      const arr = byLoc.get(n.locationId)
      if (arr) arr.push(n)
      else byLoc.set(n.locationId, [n])
    } else {
      general.push(n)
    }
  }
  const groups: NoteGroup[] = [
    {
      key: GENERAL_KEY,
      name: "General",
      tone: null,
      locationId: null,
      notes: general,
    },
  ]
  for (const loc of locations) {
    groups.push({
      key: loc.id,
      name: loc.name,
      tone: slugToTone(loc.id),
      locationId: loc.id,
      notes: byLoc.get(loc.id) ?? [],
    })
  }
  return groups
}

export function NotesTab({
  tripId,
  tripSlug,
  initialNotes,
  locations,
  members,
}: {
  tripId: string
  tripSlug: string
  initialNotes: TripNote[]
  locations: ItineraryLocation[]
  members: Record<string, MemberToneEntry>
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState<Set<string>>(new Set())

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const groups = buildGroups(initialNotes, locations)

  return (
    <section className="px-5 pt-5 lg:px-10 lg:pt-6">
      <div className="flex items-baseline justify-between">
        <Label>Notes</Label>
        <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          drafted by <span className="text-sea">● M+G</span>
        </span>
      </div>

      <div className="mt-4">
        <ImportFromTripControl
          tripId={tripId}
          label="Copy notes from another trip"
          onCopy={(src) => copyNotesFromTrip(tripId, src, tripSlug)}
        />
      </div>

      <div className="mt-5">
        {groups.map((group) => {
          const isOpen = open.has(group.key)
          const count = group.notes.length
          return (
            <div
              key={group.key}
              className="border-t border-rule first:border-t-0"
            >
              <button
                type="button"
                onClick={() => toggle(group.key)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={`t-display block text-[20px] leading-none ${
                      group.tone ? toneText[group.tone] : "text-foreground"
                    }`}
                  >
                    {group.name}
                  </span>
                  <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {count === 0
                      ? "no notes"
                      : `${count} ${count === 1 ? "note" : "notes"}`}
                  </span>
                </span>
                <span className="px-1 font-mono text-[13px] leading-none text-muted-foreground">
                  {isOpen ? "⌄" : "›"}
                </span>
              </button>

              {isOpen ? (
                <div className="pb-4">
                  <AddNoteRow
                    tripId={tripId}
                    tripSlug={tripSlug}
                    locationId={group.locationId}
                  />
                  {count === 0 ? null : (
                    <div className="mt-4 flex flex-col gap-5">
                      {group.notes.map((note) => (
                        <NoteCard
                          key={note.id}
                          note={note}
                          tripSlug={tripSlug}
                          locations={locations}
                          member={members[note.createdBy]}
                          isEditing={editingId === note.id}
                          onStartEdit={() => setEditingId(note.id)}
                          onStopEdit={() => setEditingId(null)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function AddNoteRow({
  tripId,
  tripSlug,
  locationId,
}: {
  tripId: string
  tripSlug: string
  locationId: string | null
}) {
  const [body, setBody] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || isPending) return
    setError(null)
    startTransition(async () => {
      const result = await addNote({ tripId, tripSlug, body, locationId })
      if (result.error) {
        setError(result.error)
        return
      }
      setBody("")
      textareaRef.current?.focus()
    })
  }

  return (
    <form onSubmit={submit}>
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="jot down a note…"
        rows={3}
        disabled={isPending}
        className="w-full resize-none rounded-lg border border-rule bg-card px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50 [field-sizing:content]"
      />
      {error ? (
        <div className="mt-2 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
      <div className="mt-2 flex justify-end">
        <button
          type="submit"
          disabled={!body.trim() || isPending}
          className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : "+ save"}
        </button>
      </div>
    </form>
  )
}

function NoteCard({
  note,
  tripSlug,
  locations,
  member,
  isEditing,
  onStartEdit,
  onStopEdit,
}: {
  note: TripNote
  tripSlug: string
  locations: ItineraryLocation[]
  member: MemberToneEntry | undefined
  isEditing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
}) {
  if (isEditing) {
    return (
      <NoteEditor
        note={note}
        tripSlug={tripSlug}
        locations={locations}
        onDone={onStopEdit}
      />
    )
  }
  return (
    <NoteView
      note={note}
      tripSlug={tripSlug}
      member={member}
      onStartEdit={onStartEdit}
    />
  )
}

function NoteView({
  note,
  tripSlug,
  member,
  onStartEdit,
}: {
  note: TripNote
  tripSlug: string
  member: MemberToneEntry | undefined
  onStartEdit: () => void
}) {
  return (
    <div>
      <p className="whitespace-pre-wrap text-[14px] leading-snug text-foreground">
        {note.body}
      </p>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {member ? (
            <Avatar name={member.displayName} size={18} tone={member.tone} />
          ) : null}
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            {formatNoteDate(note.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onStartEdit}
            className="border-0 bg-transparent px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            aria-label="Edit note"
          >
            ✎
          </button>
          <form
            action={deleteNote.bind(null, note.id, tripSlug)}
            onSubmit={(e) => {
              if (!window.confirm("Delete this note? This can't be undone.")) {
                e.preventDefault()
              }
            }}
            className="inline-flex"
          >
            <button
              type="submit"
              className="border-0 bg-transparent px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-clay"
              aria-label="Delete note"
            >
              ×
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function NoteEditor({
  note,
  tripSlug,
  locations,
  onDone,
}: {
  note: TripNote
  tripSlug: string
  locations: ItineraryLocation[]
  onDone: () => void
}) {
  const [body, setBody] = React.useState(note.body)
  const [locationId, setLocationId] = React.useState<string | null>(
    note.locationId,
  )
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || isPending) return
    setError(null)
    startTransition(async () => {
      const result = await updateNote({
        noteId: note.id,
        tripSlug,
        body,
        locationId,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      onDone()
    })
  }

  return (
    <form onSubmit={save}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        disabled={isPending}
        autoFocus
        className="w-full resize-none rounded-lg border border-clay bg-card px-3 py-2 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50 [field-sizing:content]"
      />
      <label className="mt-2 block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Location
        </span>
        <select
          value={locationId ?? ""}
          onChange={(e) =>
            setLocationId(e.target.value === "" ? null : e.target.value)
          }
          disabled={isPending}
          className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        >
          <option value="">General (no location)</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <div className="mt-2 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          disabled={isPending}
          className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          cancel
        </button>
        <button
          type="submit"
          disabled={!body.trim() || isPending}
          className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : "save"}
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Load locations for the notes tab in `page.tsx`**

In `src/app/trips/[slug]/page.tsx`, the `locations` entry of the `Promise.all` currently reads:

```ts
      (showItinerary && !isDream) || activeTab === "budget"
        ? getItineraryLocations(header.id)
        : Promise.resolve(null),
```

Change its condition to also load on the notes tab:

```ts
      (showItinerary && !isDream) ||
      activeTab === "budget" ||
      activeTab === "notes"
        ? getItineraryLocations(header.id)
        : Promise.resolve(null),
```

- [ ] **Step 3: Pass `locations` into `NotesTab` in `page.tsx`**

Change the `<NotesTab .../>` block (the final `else` branch) to add the prop:

```tsx
          <NotesTab
            tripId={header.id}
            tripSlug={header.slug}
            initialNotes={notes ?? []}
            locations={locations ?? []}
            members={memberTones}
          />
```

- [ ] **Step 4: Validate**

Run: `pnpm lint`
Expected: no errors. (Watch for the React 19 JSX-comment / unescaped-entity rules; there are none new here.)

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Manual check in the browser**

Run `pnpm dev`, open a trip with at least one itinerary location, go to the Notes tab. Verify:
- A `General` block appears first, then one block per location, all collapsed.
- Clicking a header expands it; the add-note form is the first thing inside.
- Adding a note inside a location block files it there; reload and confirm it stays under that location.
- Adding inside General creates a location-less note.
- Editing a note shows the Location select and can move the note (including to General).
- Each block's count subtitle (`no notes` / `N notes`) is correct.

- [ ] **Step 6: Commit**

```bash
git add src/app/trips/[slug]/notes-tab.tsx src/app/trips/[slug]/page.tsx
git commit -m "feat(notes): collapsible location blocks with location-filed notes"
```

---

### Task 5: Update docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Mark the task done in `docs/TODO.md`**

Add a completed entry for location-filed notes under the appropriate section (match the file's existing format for done items).

- [ ] **Step 2: Record the decision in `docs/DECISIONS.md`**

Append a row noting: notes reuse `itinerary_locations` (no separate notes-location concept); `trip_notes.location_id` is `on delete set null` so deleting a location preserves its notes as General; locations are created only in the Itinerary tab.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record location-filed notes"
```

---

## Self-Review

**Spec coverage:**
- Reuse `itinerary_locations` → Task 1 (FK), Task 4 (groups built from `locations`). ✓
- Collapsible itinerary-style list, no location hidden, all start collapsed → Task 4 `NotesTab` (`buildGroups` includes every location; `open` Set starts empty). ✓
- General block first → Task 4 `buildGroups` (General pushed first). ✓
- "+ add a note" first inside an open block, location implied → Task 4 (`AddNoteRow` rendered before notes, `locationId` bound from group). ✓
- Notes render as plain pre-wrapped text, no markdown → Task 4 `NoteView` (`whitespace-pre-wrap`, unchanged). ✓
- Editing re-files via Location select → Task 4 `NoteEditor`. ✓
- `on delete set null` preserves notes → Task 1. ✓
- `copyNotesFromTrip` leaves location null → Task 3 (left unchanged). ✓
- Locations created only in Itinerary (out of scope here) → no task adds creation. ✓
- Realtime unchanged → no realtime code added. ✓

**Placeholder scan:** No TBD/TODO-in-code/“handle edge cases” placeholders; every code step shows full content. ✓

**Type consistency:** `TripNote.locationId: string | null` (Task 2) is read in Task 4 (`n.locationId`, `note.locationId`) and written via `addNote`/`updateNote` `locationId?: string | null` (Task 3). `CardTone` from `slug-tone` keys `toneText` and types `NoteGroup.tone` (Task 4). `NotesTab` gains `locations: ItineraryLocation[]`, supplied by `page.tsx` (Task 4). All consistent. ✓
