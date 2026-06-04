# Copy packing + notes from another trip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the trip you're viewing, copy a packing list or notes from another same-workspace trip/dream — a one-time additive snapshot.

**Architecture:** Per `docs/superpowers/specs/2026-06-04-share-packing-notes-design.md`. App-level server actions (no schema, no migration, no RPC): a shared `getImportableTrips` read, plus `copyPackingFromTrip` / `copyNotesFromTrip` that read the source rows and insert copies into the target. One reusable client component `ImportFromTripControl` (button → source `<select>` → copy) mounted on the Packing and Notes tabs, each wiring its own copy action. RLS gates same-workspace access. Merge/append; packing `done` resets; no dedup. Budget is out of scope (its own brainstorm later).

**Tech Stack:** Next.js 16 Server Actions, React 19 client component, Supabase. No migration.

**Note on testing:** No test suite (per `CLAUDE.md`). Each task is verified with `pnpm build` and `pnpm lint`, plus a manual viewing step at the end. Commit after each task.

---

### Task 1: `getImportableTrips` + the `ImportFromTripControl` picker

**Files:**
- Modify: `src/lib/trips/actions.ts` (add the read action + `ImportableTrip` type + `CopyResult` type)
- Create: `src/app/trips/[slug]/import-from-trip.tsx`

- [ ] **Step 1: Add the `ImportableTrip` / `CopyResult` types + `getImportableTrips` action**

In `src/lib/trips/actions.ts`, add (near the other packing/notes actions):

```ts
export interface ImportableTrip {
  id: string
  name: string
}

export interface CopyResult {
  error?: string
  copied?: number
}

/** Other trips/dreams in the same workspace as `tripId`, for the import picker. */
export async function getImportableTrips(
  tripId: string,
): Promise<ImportableTrip[]> {
  const supabase = await createClient()
  const { data: trip } = await supabase
    .from("trips")
    .select("workspace_id")
    .eq("id", tripId)
    .single()
  if (!trip) return []

  const { data } = await supabase
    .from("trips")
    .select("id, name")
    .eq("workspace_id", trip.workspace_id)
    .neq("id", tripId)
    .order("start_date", { ascending: true, nullsFirst: false })

  return (data ?? []).map((r) => ({ id: r.id, name: r.name }))
}
```

- [ ] **Step 2: Create the picker component**

Create `src/app/trips/[slug]/import-from-trip.tsx`:

```tsx
"use client"

import * as React from "react"

import {
  getImportableTrips,
  type ImportableTrip,
} from "@/lib/trips/actions"

export function ImportFromTripControl({
  tripId,
  label,
  onCopy,
}: {
  tripId: string
  label: string
  onCopy: (sourceTripId: string) => Promise<{ error?: string }>
}) {
  const [open, setOpen] = React.useState(false)
  const [trips, setTrips] = React.useState<ImportableTrip[]>([])
  const [selected, setSelected] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function openPicker() {
    setError(null)
    setOpen(true)
    startTransition(async () => {
      const list = await getImportableTrips(tripId)
      setTrips(list)
      setSelected(list[0]?.id ?? "")
    })
  }

  function copy() {
    if (!selected) return
    setError(null)
    startTransition(async () => {
      const result = await onCopy(selected)
      if (result.error) {
        setError(result.error)
        return
      }
      setOpen(false)
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPicker}
        className="block w-full rounded-lg border border-dashed border-rule py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"
      >
        {label}
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-clay p-3">
      {trips.length === 0 ? (
        <p className="font-mono text-[11px] text-muted-foreground">
          {isPending ? "Loading…" : "No other trips to copy from."}
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={isPending}
            className="flex-1 border-0 border-b border-rule bg-transparent py-1 text-[13px] text-foreground focus:border-clay focus:outline-none"
          >
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={copy}
            disabled={isPending || !selected}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-clay hover:text-foreground disabled:opacity-50"
          >
            {isPending ? "…" : "copy"}
          </button>
        </div>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
        >
          cancel
        </button>
      </div>
      {error ? (
        <p className="font-mono text-[10px] text-clay">{error}</p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds (the action + component are exported; unused until Tasks 2–3 — that's fine, no error).

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/actions.ts "src/app/trips/[slug]/import-from-trip.tsx"
git commit -m "feat(trips): getImportableTrips + ImportFromTripControl picker"
```

---

### Task 2: `copyPackingFromTrip` + mount on the Packing tab

**Files:**
- Modify: `src/lib/trips/actions.ts` (add `copyPackingFromTrip`)
- Modify: `src/app/trips/[slug]/packing-tab.tsx` (import + mount the control after `AddCategoryRow`, ~336)

- [ ] **Step 1: Add `copyPackingFromTrip`**

In `src/lib/trips/actions.ts`, add:

```ts
/** Copy another trip's packing list into this one. Merge: same-name categories
 * are reused (items link by name); items come in unpacked. Additive. */
export async function copyPackingFromTrip(
  targetTripId: string,
  sourceTripId: string,
  tripSlug: string,
): Promise<CopyResult> {
  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }
  const userId = userData.user.id

  const [srcCats, srcItems, tgtCats] = await Promise.all([
    supabase
      .from("packing_categories")
      .select("name, sort_order")
      .eq("trip_id", sourceTripId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("packing_items")
      .select("category, label")
      .eq("trip_id", sourceTripId)
      .order("created_at", { ascending: true }),
    supabase
      .from("packing_categories")
      .select("name, sort_order")
      .eq("trip_id", targetTripId),
  ])

  const existing = new Set((tgtCats.data ?? []).map((c) => c.name))
  let nextOrder =
    (tgtCats.data ?? []).reduce((m, c) => Math.max(m, c.sort_order), -1) + 1

  const newCats = (srcCats.data ?? [])
    .filter((c) => !existing.has(c.name))
    .map((c) => ({
      trip_id: targetTripId,
      name: c.name,
      sort_order: nextOrder++,
      created_by: userId,
    }))
  if (newCats.length) {
    const { error } = await supabase.from("packing_categories").insert(newCats)
    if (error) return { error: error.message }
  }

  const newItems = (srcItems.data ?? []).map((it) => ({
    trip_id: targetTripId,
    category: it.category,
    label: it.label,
    added_by: userId,
  }))
  if (newItems.length) {
    const { error } = await supabase.from("packing_items").insert(newItems)
    if (error) return { error: error.message }
  }

  revalidatePath(`/trips/${tripSlug}`)
  return { copied: newItems.length }
}
```

(`done` is omitted, so items default to unpacked. `packing_categories` has a unique `(trip_id, name)`; the `existing` filter avoids hitting it.)

- [ ] **Step 2: Mount the control on the Packing tab**

In `src/app/trips/[slug]/packing-tab.tsx`, add to the actions import (which already imports `addPackingCategory`):

```ts
import {
  // …existing imports…
  copyPackingFromTrip,
} from "@/lib/trips/actions"
import { ImportFromTripControl } from "./import-from-trip"
```

Then, just after the `AddCategoryRow` block (~line 335-337):

```tsx
        <div className="px-5 pt-4">
          <AddCategoryRow onAdd={addCategory} />
        </div>

        <div className="px-5 pt-2">
          <ImportFromTripControl
            tripId={tripId}
            label="Copy packing from another trip"
            onCopy={(src) => copyPackingFromTrip(tripId, src, tripSlug)}
          />
        </div>
```

(`tripId` and `tripSlug` are already in scope in `PackingTab` — `addPackingCategory(tripId, tripSlug, name)` is called nearby.)

- [ ] **Step 3: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds.

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/actions.ts "src/app/trips/[slug]/packing-tab.tsx"
git commit -m "feat(packing): copy a packing list from another trip"
```

---

### Task 3: `copyNotesFromTrip` + mount on the Notes tab

**Files:**
- Modify: `src/lib/trips/actions.ts` (add `copyNotesFromTrip`)
- Modify: `src/app/trips/[slug]/notes-tab.tsx` (import ~6 + mount after `AddNoteRow` ~45)

- [ ] **Step 1: Add `copyNotesFromTrip`**

In `src/lib/trips/actions.ts`, add:

```ts
/** Copy another trip's notes into this one. Additive; each note is re-authored
 * by the current user with fresh timestamps. */
export async function copyNotesFromTrip(
  targetTripId: string,
  sourceTripId: string,
  tripSlug: string,
): Promise<CopyResult> {
  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }
  const userId = userData.user.id

  const { data: srcNotes } = await supabase
    .from("trip_notes")
    .select("body")
    .eq("trip_id", sourceTripId)
    .order("created_at", { ascending: true })

  const rows = (srcNotes ?? []).map((n) => ({
    trip_id: targetTripId,
    body: n.body,
    created_by: userId,
  }))
  if (rows.length) {
    const { error } = await supabase.from("trip_notes").insert(rows)
    if (error) return { error: error.message }
  }

  revalidatePath(`/trips/${tripSlug}`)
  return { copied: rows.length }
}
```

- [ ] **Step 2: Mount the control on the Notes tab**

In `src/app/trips/[slug]/notes-tab.tsx`, the actions import currently reads:

```ts
import { addNote, deleteNote, updateNote } from "@/lib/trips/actions"
```

Change it to add the copy action, and import the control:

```ts
import {
  addNote,
  copyNotesFromTrip,
  deleteNote,
  updateNote,
} from "@/lib/trips/actions"
import { ImportFromTripControl } from "./import-from-trip"
```

Then, just after the `AddNoteRow` block (~line 44-46):

```tsx
      <div className="mt-4">
        <AddNoteRow tripId={tripId} tripSlug={tripSlug} />
      </div>

      <div className="mt-2">
        <ImportFromTripControl
          tripId={tripId}
          label="Copy notes from another trip"
          onCopy={(src) => copyNotesFromTrip(tripId, src, tripSlug)}
        />
      </div>
```

(`tripId`/`tripSlug` are `NotesTab` props, already in scope.)

- [ ] **Step 3: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds.

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/actions.ts "src/app/trips/[slug]/notes-tab.tsx"
git commit -m "feat(notes): copy notes from another trip"
```

---

### Task 4: Manual verification + docs

**Files:** none (manual), then `docs/TODO.md`.

- [ ] **Step 1: Run the dev server**

Run: `pnpm dev`
Open a trip that has at least one OTHER trip/dream in the same workspace.

- [ ] **Step 2: Copy a packing list**

On the **Packing** tab, click **"Copy packing from another trip"** → the picker lists the workspace's other trips → choose one with a packing list → **copy**. Confirm its categories + items appear (appended), all **unpacked**, and a same-named existing category merged rather than duplicating.

- [ ] **Step 3: Copy notes**

On the **Notes** tab, click **"Copy notes from another trip"** → choose a source with notes → **copy**. Confirm the notes appear (appended), authored by you.

- [ ] **Step 4: Edge checks**

Confirm: copying from a source with an **empty** list copies nothing (no crash); the picker shows **"No other trips to copy from."** on a workspace with only this trip; copying is **additive** (existing content untouched); partner sees copied packing items via Realtime and notes after a refocus.

- [ ] **Step 5: Update docs**

Add a row to `docs/TODO.md` recording copy-packing + copy-notes done (one-time snapshot, pull, merge/append), referencing the spec/plan, and noting budget-copy is a deferred follow-up.

```bash
git add docs/TODO.md
git commit -m "docs: record copy packing + notes from another trip done"
```

---

## Self-Review

- **Spec coverage:** `getImportableTrips` (Task 1) ✓; `copyPackingFromTrip` merge/append + `done` reset + same-name merge (Task 2) ✓; `copyNotesFromTrip` append + re-author (Task 3) ✓; shared `ImportFromTripControl` mounted per tab (Tasks 1–3) ✓; pull direction, no dedup, all-siblings picker ✓. Budget out of scope ✓. No schema/migration ✓.
- **No placeholders:** full code for the actions and the component; exact import/mount edits for both tabs.
- **Type consistency:** `ImportableTrip` + `CopyResult` defined in Task 1 and used by `getImportableTrips`/`copyPackingFromTrip`/`copyNotesFromTrip`; `ImportFromTripControl({ tripId, label, onCopy })` defined in Task 1 and called with that exact shape in Tasks 2/3, both passing `copy*FromTrip(tripId, src, tripSlug)` which returns `CopyResult` (assignable to the `{ error?: string }` the `onCopy` prop expects).
- **Build stays green per task:** Task 1's exports are unused until Tasks 2–3 (no error); each later task adds an action + its consumer together.
- **Sync:** copied packing items broadcast on the existing `packing_items` Realtime channel; categories + notes refresh via `revalidatePath` + `RefreshOnVisible` (matches the existing add flows). No optimistic append for copies — they arrive on the refresh, acceptable for a one-shot import.
- **RLS:** same-workspace membership already permits reading the source and inserting into the target; no policy changes.
