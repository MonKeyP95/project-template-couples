# Phase 4.5 — Trip Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per project memory, when each step has fully concrete code, default to inline execution rather than per-task subagent dispatch.

**Goal:** Add a Notes tab on `/trips/[slug]` where any workspace member can add, edit, and delete free-text notes for that trip — backed by a new `trip_notes` table, three Server Actions, and one new client component.

**Architecture:** New `trip_notes` table mirrors the existing child-table pattern (FK + cascade + RLS via `is_trip_workspace_member`). A new `NotesTab` client component lives in `src/app/trips/[slug]/notes-tab.tsx` and follows the inline-add-form-at-top + list-below rhythm of `+ add packing item` / `+ log expense`. Tab integration is four small edits to `src/app/trips/[slug]/page.tsx` (extend the `TabId` union, add to `TABS`, extend `isTab`, lazy-fetch + render). Edit-in-place uses a lifted `editingId` state so only one note is editable at a time. Delete uses the native `confirm()` pattern from `deleteTrip`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4, `@supabase/ssr` 0.10, Postgres. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-28-phase-4-5-trip-notes-design.md`

**Note on commits:** One commit per task, matching the project pattern (Phase 4 dream pipeline: 5 feat + 1 docs; edit-trip slice: 3 feat + 1 docs). Task 4 is docs-only.

**Note on tests:** Project has no test suite (per `CLAUDE.md`: "There are no tests yet; do not invent a test command until one exists."). Validation per task is `pnpm lint && pnpm build`. Manual UI verification depends on the user pasting Task 1's migration into the Supabase SQL Editor; flagged at the end of Task 1.

**Note on `MemberToneEntry`:** The type is already exported from `src/app/trips/[slug]/packing-tab.tsx` and imported in `page.tsx`. `NotesTab` imports it from the same place (`import type { MemberToneEntry } from "./packing-tab"`), matching the existing pattern — no extraction to a shared types module.

---

### Task 1: Schema migration

**Files:**
- Create: `supabase/migrations/20260528000003_phase_4_5_trip_notes.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260528000003_phase_4_5_trip_notes.sql` with this exact content:

```sql
-- Phase 4.5: trip_notes table for per-trip free-text notes.
-- Mirrors the child-table shape of packing_items / expenses / itinerary_days:
-- one row per note, cascade on trip delete, RLS via is_trip_workspace_member().
--
-- Idempotent: safe to paste-and-run multiple times.

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

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260528000003_phase_4_5_trip_notes.sql
git commit -m "feat(trips): trip_notes table + RLS"
```

No lint/build step — SQL files aren't part of the JS/TS build pipeline. The schema doesn't take effect until the user pastes the file into the Supabase SQL Editor (per the project's manual-application workflow).

**User action required (flag at end of plan execution):** paste this file into the Supabase SQL Editor. Until then, Task 2's `getTripNotes` will error and Task 3's Notes tab will fail to render. All other tabs continue to work unaffected.

---

### Task 2: Query layer + Server Actions

**Files:**
- Create: `src/lib/trips/note-queries.ts`
- Modify: `src/lib/trips/actions.ts` (append three exports + one type import)

- [ ] **Step 1: Create `note-queries.ts`**

Create `src/lib/trips/note-queries.ts` with this exact content:

```ts
import { createClient } from "@/lib/supabase/server"

export interface TripNote {
  id: string
  tripId: string
  body: string
  createdBy: string
  /** ISO timestamptz from Postgres. */
  createdAt: string
  updatedAt: string
}

interface TripNoteRow {
  id: string
  trip_id: string
  body: string
  created_by: string
  created_at: string
  updated_at: string
}

function rowToNote(r: TripNoteRow): TripNote {
  return {
    id: r.id,
    tripId: r.trip_id,
    body: r.body,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export async function getTripNotes(tripId: string): Promise<TripNote[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("trip_notes")
    .select("id, trip_id, body, created_by, created_at, updated_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .returns<TripNoteRow[]>()
  if (error) throw new Error(error.message)
  return (data ?? []).map(rowToNote)
}

export { rowToNote }
```

`rowToNote` is exported so `actions.ts` can reuse it when `addNote` selects back the inserted row.

- [ ] **Step 2: Add `TripNote` + `rowToNote` import to `actions.ts`**

At the top of `src/lib/trips/actions.ts`, after the existing `import { getCurrentWorkspace } from "@/lib/workspace/queries"` line, add:

```ts
import { rowToNote, type TripNote } from "@/lib/trips/note-queries"
```

- [ ] **Step 3: Append `addNote` to `actions.ts`**

Append this block at the very bottom of `src/lib/trips/actions.ts` (after the closing `}` of `deleteTrip`):

```ts
export interface AddNoteInput {
  tripId: string
  tripSlug: string
  body: string
}

export interface AddNoteResult {
  error?: string
  /** Populated on success — full row, so the client can prepend optimistically if it wants. */
  note?: TripNote
}

/**
 * Inserts a free-text note on a trip. RLS requires the caller to be a
 * workspace member of the trip and `created_by = auth.uid()`. Returns
 * `{ error }` on validation/DB failure; `{ note }` on success.
 */
export async function addNote(
  input: AddNoteInput,
): Promise<AddNoteResult> {
  const body = input.body.trim()
  if (!body) return { error: "Note body required." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { data, error } = await supabase
    .from("trip_notes")
    .insert({
      trip_id: input.tripId,
      body,
      created_by: userData.user.id,
    })
    .select("id, trip_id, body, created_by, created_at, updated_at")
    .single()

  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return { note: rowToNote(data) }
}
```

- [ ] **Step 4: Append `updateNote` to `actions.ts`**

Append after `addNote`:

```ts
export interface UpdateNoteInput {
  noteId: string
  tripSlug: string
  body: string
}

export interface UpdateNoteResult {
  error?: string
}

/**
 * Edits the body of an existing note. RLS gates membership; `created_by`
 * and `created_at` are never touched. `updated_at` is set explicitly because
 * Postgres column defaults only fire on INSERT.
 */
export async function updateNote(
  input: UpdateNoteInput,
): Promise<UpdateNoteResult> {
  const body = input.body.trim()
  if (!body) return { error: "Note body required." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("trip_notes")
    .update({ body, updated_at: new Date().toISOString() })
    .eq("id", input.noteId)

  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}
```

- [ ] **Step 5: Append `deleteNote` to `actions.ts`**

Append after `updateNote`:

```ts
/**
 * Permanently deletes a note. Throws on error (form-compatible like
 * `deleteTrip` / `settleUp`). No cascade concerns — notes have no children.
 */
export async function deleteNote(
  noteId: string,
  tripSlug: string,
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("trip_notes")
    .delete()
    .eq("id", noteId)
  if (error) throw new Error(error.message)

  revalidatePath(`/trips/${tripSlug}`)
}
```

- [ ] **Step 6: Verify lint + build**

Run: `pnpm lint && pnpm build`

Expected: both pass. No new routes appear in the build output (this task is backend-only).

- [ ] **Step 7: Commit**

```bash
git add src/lib/trips/note-queries.ts src/lib/trips/actions.ts
git commit -m "feat(trips): trip-notes queries + addNote/updateNote/deleteNote"
```

---

### Task 3: NotesTab UI + tab integration

**Files:**
- Create: `src/app/trips/[slug]/notes-tab.tsx`
- Modify: `src/app/trips/[slug]/page.tsx` (extend tabs, lazy-fetch notes, render NotesTab)

- [ ] **Step 1: Create `notes-tab.tsx`**

Create `src/app/trips/[slug]/notes-tab.tsx` with this exact content:

```tsx
"use client"

import * as React from "react"

import { Avatar, Label } from "@/components/together"
import { addNote, deleteNote, updateNote } from "@/lib/trips/actions"
import type { TripNote } from "@/lib/trips/note-queries"

import type { MemberToneEntry } from "./packing-tab"

const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
})

function formatNoteDate(iso: string): string {
  return SHORT_DATE.format(new Date(iso))
}

export function NotesTab({
  tripId,
  tripSlug,
  initialNotes,
  members,
}: {
  tripId: string
  tripSlug: string
  initialNotes: TripNote[]
  members: Record<string, MemberToneEntry>
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null)

  return (
    <section className="px-5 pt-5 lg:px-10 lg:pt-6">
      <div className="flex items-baseline justify-between">
        <Label>Notes</Label>
        <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          drafted by <span className="text-sea">● M+G</span>
        </span>
      </div>

      <div className="mt-4">
        <AddNoteRow tripId={tripId} tripSlug={tripSlug} />
      </div>

      {initialNotes.length === 0 ? (
        <p className="mt-5 font-serif text-[15px] italic text-muted-foreground">
          No notes yet — jot the first one.
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-5">
          {initialNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              tripSlug={tripSlug}
              member={members[note.createdBy]}
              isEditing={editingId === note.id}
              onStartEdit={() => setEditingId(note.id)}
              onStopEdit={() => setEditingId(null)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function AddNoteRow({
  tripId,
  tripSlug,
}: {
  tripId: string
  tripSlug: string
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
      const result = await addNote({ tripId, tripSlug, body })
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
  member,
  isEditing,
  onStartEdit,
  onStopEdit,
}: {
  note: TripNote
  tripSlug: string
  member: MemberToneEntry | undefined
  isEditing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
}) {
  const [body, setBody] = React.useState(note.body)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (isEditing) setBody(note.body)
  }, [isEditing, note.body])

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || isPending) return
    setError(null)
    startTransition(async () => {
      const result = await updateNote({ noteId: note.id, tripSlug, body })
      if (result.error) {
        setError(result.error)
        return
      }
      onStopEdit()
    })
  }

  function cancel() {
    setBody(note.body)
    setError(null)
    onStopEdit()
  }

  if (isEditing) {
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
        {error ? (
          <div className="mt-2 font-mono text-[10px] text-clay">{error}</div>
        ) : null}
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
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

  return (
    <div>
      <p className="whitespace-pre-wrap text-[14px] leading-snug text-foreground">
        {note.body}
      </p>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {member ? (
            <Avatar
              name={member.displayName}
              size={18}
              tone={member.tone}
            />
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
              if (
                !window.confirm("Delete this note? This can't be undone.")
              ) {
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
```

- [ ] **Step 2: Extend `TabId` and `TABS` in `page.tsx`**

In `src/app/trips/[slug]/page.tsx`, find:

```tsx
type TabId = "itinerary" | "packing" | "budget"

const TABS: { id: TabId; label: string }[] = [
  { id: "itinerary", label: "Itinerary" },
  { id: "packing", label: "Packing" },
  { id: "budget", label: "Budget" },
]
```

Replace with:

```tsx
type TabId = "itinerary" | "packing" | "budget" | "notes"

const TABS: { id: TabId; label: string }[] = [
  { id: "itinerary", label: "Itinerary" },
  { id: "packing", label: "Packing" },
  { id: "budget", label: "Budget" },
  { id: "notes", label: "Notes" },
]
```

- [ ] **Step 3: Extend `isTab` in `page.tsx`**

In the same file, find:

```tsx
function isTab(value: string | undefined): value is TabId {
  return value === "itinerary" || value === "packing" || value === "budget"
}
```

Replace with:

```tsx
function isTab(value: string | undefined): value is TabId {
  return (
    value === "itinerary" ||
    value === "packing" ||
    value === "budget" ||
    value === "notes"
  )
}
```

- [ ] **Step 4: Add the `NotesTab` + `getTripNotes` imports in `page.tsx`**

Find the existing imports block at the top of `page.tsx`. Add to the imports:

```tsx
import { getTripNotes } from "@/lib/trips/note-queries"
```

(Place it alphabetically alongside the other `@/lib/trips/*` imports, between `getItineraryDays` and `getPackingItems`.)

In the same file, find the local-component imports near the top:

```tsx
import { BudgetTab } from "./budget-tab"
import {
  PackingTab,
  type MemberToneEntry,
} from "./packing-tab"
```

Replace with:

```tsx
import { BudgetTab } from "./budget-tab"
import { NotesTab } from "./notes-tab"
import {
  PackingTab,
  type MemberToneEntry,
} from "./packing-tab"
```

- [ ] **Step 5: Add lazy `notes` fetch in `page.tsx`**

Find the existing `Promise.all` block:

```tsx
  const [itinerary, packingItems, expenses] = await Promise.all([
    activeTab === "itinerary" ? getItineraryDays(header.id) : Promise.resolve(null),
    getPackingItems(header.id),
    getTripExpenses(header.id),
  ])
```

Replace with:

```tsx
  const [itinerary, notes, packingItems, expenses] = await Promise.all([
    activeTab === "itinerary" ? getItineraryDays(header.id) : Promise.resolve(null),
    activeTab === "notes" ? getTripNotes(header.id) : Promise.resolve(null),
    getPackingItems(header.id),
    getTripExpenses(header.id),
  ])
```

- [ ] **Step 6: Pass `notes` count to `DesktopTabs`**

Find:

```tsx
        <DesktopTabs
          slug={header.slug}
          active={activeTab}
          counts={{
            itinerary: itinerary?.length ?? null,
            packing: packingTotal,
            budget: budgetSummary.expenseTotalCents,
          }}
        />
```

Replace with:

```tsx
        <DesktopTabs
          slug={header.slug}
          active={activeTab}
          counts={{
            itinerary: itinerary?.length ?? null,
            packing: packingTotal,
            budget: budgetSummary.expenseTotalCents,
            notes: notes?.length ?? null,
          }}
        />
```

- [ ] **Step 7: Render `NotesTab` when active**

Find the existing active-tab render switch:

```tsx
        ) : activeTab === "packing" ? (
          <PackingTab
            tripId={header.id}
            initialItems={packingItems}
            members={memberTones}
            daysOut={computeDaysOut(header.startDate)}
          />
        ) : (
          <BudgetTab
            tripId={header.id}
            tripSlug={header.slug}
            tripName={header.name}
            expenses={expenses}
            summary={budgetSummary}
            members={memberTones}
            plannedBudgetCents={detail?.plannedBudgetCents ?? 0}
            startDate={header.startDate}
            endDate={header.endDate}
            currentUserId={userData.user.id}
          />
        )}
```

Replace with:

```tsx
        ) : activeTab === "packing" ? (
          <PackingTab
            tripId={header.id}
            initialItems={packingItems}
            members={memberTones}
            daysOut={computeDaysOut(header.startDate)}
          />
        ) : activeTab === "budget" ? (
          <BudgetTab
            tripId={header.id}
            tripSlug={header.slug}
            tripName={header.name}
            expenses={expenses}
            summary={budgetSummary}
            members={memberTones}
            plannedBudgetCents={detail?.plannedBudgetCents ?? 0}
            startDate={header.startDate}
            endDate={header.endDate}
            currentUserId={userData.user.id}
          />
        ) : (
          <NotesTab
            tripId={header.id}
            tripSlug={header.slug}
            initialNotes={notes ?? []}
            members={memberTones}
          />
        )}
```

- [ ] **Step 8: Extend `DesktopTabs` to label the notes count**

Find the `DesktopTabs` component definition near the bottom of `page.tsx`:

```tsx
function DesktopTabs({
  slug,
  active,
  counts,
}: {
  slug: string
  active: TabId
  counts: { itinerary: number | null; packing: number; budget: number }
}) {
  const labelFor = (t: TabId) => {
    if (t === "itinerary") {
      return counts.itinerary != null ? `${counts.itinerary} days` : null
    }
    if (t === "packing") return `${counts.packing}`
    return `€${(counts.budget / 100).toFixed(0)}`
  }
```

Replace with:

```tsx
function DesktopTabs({
  slug,
  active,
  counts,
}: {
  slug: string
  active: TabId
  counts: {
    itinerary: number | null
    packing: number
    budget: number
    notes: number | null
  }
}) {
  const labelFor = (t: TabId) => {
    if (t === "itinerary") {
      return counts.itinerary != null ? `${counts.itinerary} days` : null
    }
    if (t === "packing") return `${counts.packing}`
    if (t === "notes") {
      return counts.notes != null ? `${counts.notes}` : null
    }
    return `€${(counts.budget / 100).toFixed(0)}`
  }
```

- [ ] **Step 9: Verify lint + build**

Run: `pnpm lint && pnpm build`

Expected: both pass. The build output's route table should still show `ƒ /trips/[slug]` and `ƒ /trips/[slug]/edit` — no new route (Notes is a tab, not a route).

Watch for `react/jsx-no-comment-textnodes` (the rule that bit us in the edit-trip slice on `// edit trip`). The notes code uses no `//` literals in JSX text, so this should not fire. If it does, wrap the offending string in `{"..."}`.

- [ ] **Step 10: Manual UI verification (if migration applied)**

If the user has not yet pasted Task 1's SQL into the Supabase SQL Editor, skip this step — `getTripNotes` will error and the tab will fail. Note in the completion summary that this remains to-do.

If the migration is applied:

1. Navigate to `http://localhost:3000/trips/lombok?tab=notes` (or click `Notes` in the pill nav at the bottom on mobile, or in the desktop tab strip).
2. Confirm the tab renders with `Notes` label, `drafted by ●M+G` byline, empty-state copy "No notes yet — jot the first one.", and the textarea + `+ save` button.
3. Type a note ("test note from Claude"), click `+ save`. The textarea should clear and the new note should appear above the empty-state line (which then disappears).
4. Click the `✎` button on the new note. The body should swap to a textarea pre-filled with the body, with `cancel` and `save` buttons. Edit the text, click `save`. Should return to read mode with the updated body.
5. Click the `✎` on the same note, then the `×` button without saving. The native confirm dialog should appear. Click OK; the note should disappear.

- [ ] **Step 11: Commit**

```bash
git add src/app/trips/[slug]/notes-tab.tsx src/app/trips/[slug]/page.tsx
git commit -m "feat(trips): Notes tab on /trips/[slug]"
```

---

### Task 4: Docs (TODO.md + DECISIONS.md)

**Files:**
- Modify: `docs/TODO.md` (new Phase 4.5 section, update Current Phase header)
- Modify: `docs/DECISIONS.md` (append 4 table rows)

- [ ] **Step 1: Update Current Phase header in `TODO.md`**

In `docs/TODO.md`, find:

```
**Phase 4 — Dream-Trip Pipeline + Edit Trip: code shipped 2026-05-28 (pending Supabase migration paste for the dream-trip pipeline portion).** Dreams and trips now live in one `trips` table distinguished by whether dates are set. `/home` is a real query (Hero / Trips / Dreams / Past bands). `+ new trip` form has a "this is a dream" toggle with a free-text `When?` field. `/trips/[slug]` renders a dream variant when dates are NULL. `/trips/[slug]/edit` lets a workspace member rename, edit, promote/demote, or delete a trip. Six slices, eight commits (`0139052..` + edit-trip slice). **User action required**: paste `supabase/migrations/20260528000001_phase_4_dreams.sql` then `20260528000002_seed_dreams.sql` into the Supabase SQL Editor.
```

Replace with:

```
**Phase 4.5 — Trip Notes: code shipped 2026-05-28 (pending Supabase migration paste for the trip_notes table).** New Notes tab on `/trips/[slug]` lets any workspace member jot, edit, and delete free-text notes for a trip. Backed by a new `trip_notes` table (FK to `trips` with cascade, RLS via `is_trip_workspace_member`). Three Server Actions (`addNote` / `updateNote` / `deleteNote`) mirror the existing patterns. Per-trip-only scope; workspace-level `/notes` deferred per the spec. **User action required**: paste `supabase/migrations/20260528000003_phase_4_5_trip_notes.sql` into the Supabase SQL Editor.

**Phase 4 — Dream-Trip Pipeline + Edit Trip: shipped 2026-05-28.** Dreams and trips live in one `trips` table distinguished by whether dates are set. `/home` is a real query (Hero / Trips / Dreams / Past bands). `+ new trip` form has a "this is a dream" toggle with a free-text `When?` field. `/trips/[slug]` renders a dream variant when dates are NULL. `/trips/[slug]/edit` lets a workspace member rename, edit, promote/demote, or delete a trip. Six slices, eight commits.
```

- [ ] **Step 2: Add the Phase 4.5 section between Phase 4 and Phase 3.5**

In `docs/TODO.md`, find this exact block (the end of the Phase 4 "Carried" subsection and the start of Phase 3.5):

```
### Carried into the next Phase 4 slice (post-trip)
- **Itinerary support for dreams.** The empty stub is honest but limiting. Decide whether to relax `itinerary_days.day_date NOT NULL` or add a parallel "ideas" sub-table when the empty-state actually starts annoying someone.

## Phase 3.5 — Basic CRUD (do one at a time)
```

Replace with:

```
### Carried into the next Phase 4 slice (post-trip)
- **Itinerary support for dreams.** The empty stub is honest but limiting. Decide whether to relax `itinerary_days.day_date NOT NULL` or add a parallel "ideas" sub-table when the empty-state actually starts annoying someone.

## Phase 4.5 — Trip Notes
- [x] **1. Trip notes** — Done 2026-05-28. New `/trips/[slug]?tab=notes` Notes tab backed by `trip_notes (id, trip_id, body, created_by, created_at, updated_at)` with FK cascade + RLS via `is_trip_workspace_member`. Three Server Actions: `addNote` (validates, inserts, returns the full `TripNote` for optional optimistic prepend), `updateNote` (body-only edit, bumps `updated_at` explicitly), `deleteNote` (form-action throws-on-error pattern, no cascade concerns). `NotesTab` client component: always-visible textarea + `+ save` at top, list of `NoteCard`s newest-first below. Each card shows body (whitespace-preserved), author avatar from the existing `memberToneMap`, ISO date in mono, and `✎` + `×` affordances. Edit-in-place uses a lifted `editingId` state so only one note edits at a time; native `confirm()` gates delete. Per-trip-only scope; workspace-level `/notes` route deferred. No categories, no day association, no Realtime. Spec: `docs/superpowers/specs/2026-05-28-phase-4-5-trip-notes-design.md`. Plan: `docs/superpowers/plans/2026-05-28-phase-4-5-trip-notes.md`.

### Carried into the next Phase 4.5 slice (post-trip)
- **Workspace-level `/notes` route.** The design handoff has `Notes` in the top-level desktop nav. Revisit if "general restaurant ideas not tied to any trip" becomes a felt gap during the Lombok trip.
- **Categories / tags** (restaurant / lodging / tip / idea). Only if browsing notes by type becomes painful.
- **Day association** (`day_date` nullable column + day picker on form). Only if "morning of day 3" notes feel essential.
- **Realtime channel for notes.** Only if simultaneous co-typing becomes a real scenario.

## Phase 3.5 — Basic CRUD (do one at a time)
```

- [ ] **Step 3: Append 4 rows to `DECISIONS.md`**

In `docs/DECISIONS.md`, find the last existing row (it ends with the `... swap to a column read and the call sites don't move. | 2026-05-28 |` row about slug-tone). Append these four rows after it:

```markdown
| **Trip notes are per-trip only**, no workspace-level `/notes` route in v1 | The design handoff puts `Notes` in the top-level desktop nav (workspace-level), but the most-cited use case across `VISION.md`/`FEATURES.md`/`PLAN.md` is per-trip ("restaurant ideas for *this* trip"). Per-trip-only ships in one slice, matches the existing tab pattern (Itinerary / Packing / Budget / Notes), and trivially extends to workspace-level later via a nullable `trip_id` if/when felt. | 2026-05-28 |
| **No categories on notes** (no `category` column, no tag select on the form) | Categories are an opinionated taxonomy (restaurant / lodging / tip / idea / other) that's hard to undo once the schema commits to it. Line-break paragraphs handle structure for the v1 use case; if browsing notes by type later becomes painful, add `category text null` then. YAGNI applied. | 2026-05-28 |
| **`RefreshOnVisible` over Realtime for `trip_notes`** | Unlike packing items, notes aren't synchronously co-edited — partner writes a note while you're at dinner, you see it next time you open the app. `RefreshOnVisible` (already mounted on the trip page) covers cross-device freshness. Skipping a second Supabase Realtime channel keeps the WebSocket footprint smaller. Matches the expenses tab pattern. | 2026-05-28 |
| **Desktop right rail unchanged for the Notes tab** | The rail is labeled "Pre-trip" and shows packing-done % + budget-spent %. Both are readiness metrics; notes are contextual reference material, not a readiness signal. Adding a "Notes: 3" row would dilute the rail's frame. Browse notes via the tab itself. | 2026-05-28 |
```

- [ ] **Step 4: Verify the docs edits**

Run: `git diff docs/TODO.md docs/DECISIONS.md`

Confirm:
- `TODO.md`: Current Phase header now leads with Phase 4.5; Phase 4 line is preserved without the user-action call (since Phase 4 migrations are already applied). New `## Phase 4.5 — Trip Notes` section added between Phase 4 and Phase 3.5. New "Carried into the next Phase 4.5 slice" subsection lists the 4 deferred items from the spec.
- `DECISIONS.md`: 4 new table rows appended, each ending with `| 2026-05-28 |`.

- [ ] **Step 5: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: phase 4.5 trip-notes slice complete"
```

---

## Self-review checklist (already done during plan-writing)

- **Spec coverage:** every section of the spec maps to a task.
  - Spec § "Schema" → Task 1
  - Spec § "Server Actions" → Task 2 steps 3-5
  - Spec § "Query layer" → Task 2 step 1
  - Spec § "UI / Tab integration" → Task 3 steps 2-8
  - Spec § "UI / NotesTab component" → Task 3 step 1
  - Spec § "Author lookup" → Task 3 step 1 (NotesTab takes `members` prop; page.tsx passes existing `memberTones`)
  - Spec § "Dream variant" → no code needed (the NotesTab doesn't depend on dates; verified mentally — no conditional rendering)
  - Spec § "Decisions worth a row" → Task 4 step 3
- **Placeholder scan:** every step has concrete code or commands. No "TBD", "implement later", or vague phrasing. The one conditional is in Task 3 step 10 ("if the migration is applied"), which is unavoidable and matches the project's manual-migration pattern.
- **Type consistency:**
  - `TripNote` defined in `note-queries.ts` (Task 2 step 1); imported as `type` into `actions.ts` (Task 2 step 2) and `notes-tab.tsx` (Task 3 step 1). Same shape everywhere.
  - `AddNoteInput.tripId`/`tripSlug` (Task 2 step 3) === `NotesTab` `tripId`/`tripSlug` props (Task 3 step 1) === `header.id`/`header.slug` passed in (Task 3 step 7).
  - `UpdateNoteInput.noteId` (Task 2 step 4) === `note.id` used in `NoteCard.save()` (Task 3 step 1).
  - `deleteNote(noteId, tripSlug)` (Task 2 step 5) === `deleteNote.bind(null, note.id, tripSlug)` in `NoteCard` (Task 3 step 1).
  - `MemberToneEntry` imported from `./packing-tab` in `NotesTab` (Task 3 step 1), matching the page.tsx import pattern.
- **CSS / browser support:** `[field-sizing:content]` is the only modern CSS property used; supported in Chromium 123+, Firefox 138+, Safari 18.4+ — all shipped well before 2026. Tailwind v4 passes arbitrary properties through unchanged.
