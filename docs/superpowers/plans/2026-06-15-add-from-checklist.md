# Packing "Import items" Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-list packing import bars with one "Import items" button in the packing switcher row that opens a two-step modal dialog — import from another trip (Shared or My items) or from a checklist, into a chosen target list (My or Shared).

**Architecture:** Three server actions do the copying (`getImportableChecklists`, `copyChecklistToPacking`, and a `copyPackingFromTrip` extended with `sourceOwner` + `targetOwner`). A self-contained `ImportItemsDialog` client component drives the UI and calls the actions directly. `packing-tab.tsx` adds the trigger button + dialog and drops the old in-view import control. No schema change.

**Tech Stack:** Next.js 16 server actions, React 19 client component, Supabase, `@/components/ui/dialog` + `@/components/ui/select` (Base UI), Tailwind v4, lucide-react.

**Testing note:** This repo has **no test runner** (per `CLAUDE.md` — do not invent one). Each task is verified with `pnpm lint`, `pnpm build`, and a manual browser check. No migration in this feature.

---

## File Structure

- `src/lib/trips/actions.ts` — **modify.** Add `getImportableChecklists` + `copyChecklistToPacking`; extend `copyPackingFromTrip` with `sourceOwner` + `targetOwner`.
- `src/app/trips/[slug]/import-items-dialog.tsx` — **new.** The two-step import dialog (self-contained, calls the actions).
- `src/app/trips/[slug]/packing-tab.tsx` — **modify.** Add the "Import items" button to the switcher row + render the dialog; remove the old `ImportFromTripControl` block, the `onCopyShared` prop, and the now-unused `copyPackingFromTrip` import.
- `src/app/trips/[slug]/import-from-trip.tsx` — **untouched** (Notes tab still uses it).
- `docs/TODO.md`, `docs/DECISIONS.md` — **modify** on completion.

---

## Task 1: Server actions (checklist import + trip-scope copy)

**Files:**
- Modify: `src/lib/trips/actions.ts`

- [ ] **Step 1: Add the `listChecklists` import**

At the top of `actions.ts`, add the import (next to the other `@/lib/...` imports):

```ts
import { listChecklists } from "@/lib/checklists/queries"
```

(`getCurrentWorkspace` is already imported in this file.)

- [ ] **Step 2: Add `getImportableChecklists`**

Add this near `getImportableTrips` (it reuses the existing `ImportableTrip` type):

```ts
/** The current workspace's checklists, as packing import sources. */
export async function getImportableChecklists(): Promise<ImportableTrip[]> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return []
  const lists = await listChecklists(workspace.id)
  return lists.map((c) => ({ id: c.id, name: c.name }))
}
```

- [ ] **Step 3: Extend `copyPackingFromTrip` with source + target scope**

Replace the entire existing `copyPackingFromTrip` (currently
`copyPackingFromTrip(targetTripId, sourceTripId, tripSlug)`, shared→shared only) with:

```ts
/** Copy another trip's packing into this one. `sourceOwner`/`targetOwner` select
 * the source and destination scope (null = shared, a user id = that person's
 * personal list). Merge: same-name categories in the target scope are reused
 * (items link by name); items come in unpacked. Additive. */
export async function copyPackingFromTrip(
  targetTripId: string,
  sourceTripId: string,
  sourceOwner: string | null,
  targetOwner: string | null,
  tripSlug: string,
): Promise<CopyResult> {
  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }
  const userId = userData.user.id

  const srcCatQuery = supabase
    .from("packing_categories")
    .select("name, sort_order")
    .eq("trip_id", sourceTripId)
    .order("sort_order", { ascending: true })
  const srcItemQuery = supabase
    .from("packing_items")
    .select("category, label")
    .eq("trip_id", sourceTripId)
    .order("created_at", { ascending: true })
  const tgtCatQuery = supabase
    .from("packing_categories")
    .select("name, sort_order")
    .eq("trip_id", targetTripId)

  const [srcCats, srcItems, tgtCats] = await Promise.all([
    sourceOwner === null
      ? srcCatQuery.is("owner_id", null)
      : srcCatQuery.eq("owner_id", sourceOwner),
    sourceOwner === null
      ? srcItemQuery.is("owner_id", null)
      : srcItemQuery.eq("owner_id", sourceOwner),
    targetOwner === null
      ? tgtCatQuery.is("owner_id", null)
      : tgtCatQuery.eq("owner_id", targetOwner),
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
      owner_id: targetOwner,
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
    owner_id: targetOwner,
  }))
  if (newItems.length) {
    const { error } = await supabase.from("packing_items").insert(newItems)
    if (error) return { error: error.message }
  }

  revalidatePath(`/trips/${tripSlug}`)
  return { copied: newItems.length }
}
```

- [ ] **Step 4: Add `copyChecklistToPacking` right after it**

```ts
/** Copy a workspace checklist's items into this trip's packing under `owner`
 * (null = shared, a user id = personal). Merge by category name; unpacked. */
export async function copyChecklistToPacking(
  targetTripId: string,
  checklistId: string,
  owner: string | null,
  tripSlug: string,
): Promise<CopyResult> {
  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }
  const userId = userData.user.id

  const tgtCatQuery = supabase
    .from("packing_categories")
    .select("name, sort_order")
    .eq("trip_id", targetTripId)

  const [srcCats, srcItems, tgtCats] = await Promise.all([
    supabase
      .from("checklist_categories")
      .select("name, sort_order")
      .eq("checklist_id", checklistId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("checklist_items")
      .select("category, label")
      .eq("checklist_id", checklistId)
      .order("created_at", { ascending: true }),
    owner === null
      ? tgtCatQuery.is("owner_id", null)
      : tgtCatQuery.eq("owner_id", owner),
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
      owner_id: owner,
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
    owner_id: owner,
  }))
  if (newItems.length) {
    const { error } = await supabase.from("packing_items").insert(newItems)
    if (error) return { error: error.message }
  }

  revalidatePath(`/trips/${tripSlug}`)
  return { copied: newItems.length }
}
```

- [ ] **Step 5: Verify it compiles (expect one known break)**

Run: `pnpm lint`
Expected: one error in `packing-tab.tsx` — the old `copyPackingFromTrip(tripId, src, tripSlug)` call now has the wrong arity. That is fixed in Task 3. The three new/changed functions in `actions.ts` themselves lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(packing): scope-aware copy actions + checklist import"
```

---

## Task 2: `ImportItemsDialog` component

**Files:**
- Create: `src/app/trips/[slug]/import-items-dialog.tsx`

The dialog is self-contained: it calls the server actions directly. The body is rendered
only while the dialog is open, so its local state starts fresh on every open (no
`useEffect`-to-reset, which the project's `react-hooks/set-state-in-effect` rule forbids).

- [ ] **Step 1: Create the file with the full content below**

```tsx
"use client"

import * as React from "react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  copyChecklistToPacking,
  copyPackingFromTrip,
  getImportableChecklists,
  getImportableTrips,
  type ImportableTrip,
} from "@/lib/trips/actions"

type Step = "choose" | "trip" | "checklist"
type Scope = "mine" | "shared"

export function ImportItemsDialog({
  open,
  onOpenChange,
  tripId,
  tripSlug,
  currentUserId,
  defaultTarget,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tripId: string
  tripSlug: string
  currentUserId: string
  defaultTarget: Scope
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import items</DialogTitle>
        </DialogHeader>
        {open ? (
          <ImportItemsBody
            tripId={tripId}
            tripSlug={tripSlug}
            currentUserId={currentUserId}
            defaultTarget={defaultTarget}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ImportItemsBody({
  tripId,
  tripSlug,
  currentUserId,
  defaultTarget,
  onDone,
}: {
  tripId: string
  tripSlug: string
  currentUserId: string
  defaultTarget: Scope
  onDone: () => void
}) {
  const [step, setStep] = React.useState<Step>("choose")
  const [target, setTarget] = React.useState<Scope>(defaultTarget)
  const [trips, setTrips] = React.useState<ImportableTrip[]>([])
  const [checklists, setChecklists] = React.useState<ImportableTrip[]>([])
  const [selected, setSelected] = React.useState("")
  const [sourceMine, setSourceMine] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function chooseTrip() {
    setStep("trip")
    setError(null)
    startTransition(async () => {
      const list = await getImportableTrips(tripId)
      setTrips(list)
      setSelected(list[0]?.id ?? "")
    })
  }

  function chooseChecklist() {
    setStep("checklist")
    setError(null)
    startTransition(async () => {
      const list = await getImportableChecklists()
      setChecklists(list)
      setSelected(list[0]?.id ?? "")
    })
  }

  function back() {
    setStep("choose")
    setSelected("")
    setError(null)
  }

  function runImport() {
    if (!selected) return
    setError(null)
    const targetOwner = target === "mine" ? currentUserId : null
    startTransition(async () => {
      const result =
        step === "trip"
          ? await copyPackingFromTrip(
              tripId,
              selected,
              sourceMine ? currentUserId : null,
              targetOwner,
              tripSlug,
            )
          : await copyChecklistToPacking(tripId, selected, targetOwner, tripSlug)
      if (result.error) {
        setError(result.error)
        return
      }
      onDone()
    })
  }

  if (step === "choose") {
    return (
      <div className="grid gap-2">
        <ChoiceButton onClick={chooseTrip}>From a trip</ChoiceButton>
        <ChoiceButton onClick={chooseChecklist}>From a checklist</ChoiceButton>
      </div>
    )
  }

  const sources = step === "trip" ? trips : checklists
  const emptyText =
    step === "trip"
      ? "No other trips to copy from."
      : "No checklists to copy from."

  return (
    <div className="grid gap-3">
      <ScopeToggle
        label="To"
        value={target}
        options={[
          { value: "mine", label: "My list" },
          { value: "shared", label: "Shared" },
        ]}
        onChange={setTarget}
      />

      {sources.length === 0 ? (
        <p className="font-mono text-[11px] text-muted-foreground">
          {isPending ? "Loading…" : emptyText}
        </p>
      ) : (
        <Select
          value={selected}
          onValueChange={(v) => setSelected(v ?? "")}
          disabled={isPending}
        >
          <SelectTrigger className="mt-0 w-full text-[13px]">
            <SelectValue>
              {(value: string | null) =>
                sources.find((s) => s.id === value)?.name ?? ""
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sources.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {step === "trip" ? (
        <ScopeToggle
          label="From"
          value={sourceMine ? "mine" : "shared"}
          options={[
            { value: "shared", label: "Shared" },
            { value: "mine", label: "My list" },
          ]}
          onChange={(v) => setSourceMine(v === "mine")}
        />
      ) : null}

      {error ? (
        <p className="font-mono text-[10px] text-clay">{error}</p>
      ) : null}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={back}
          disabled={isPending}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          back
        </button>
        <button
          type="button"
          onClick={runImport}
          disabled={isPending || !selected}
          className="rounded-md border-0 bg-clay px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : "import"}
        </button>
      </div>
    </div>
  )
}

function ChoiceButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-rule px-4 py-3 text-left text-[14px] text-foreground hover:border-clay hover:bg-clay-tint"
    >
      {children}
    </button>
  )
}

function ScopeToggle({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: Scope
  options: { value: Scope; label: string }[]
  onChange: (value: Scope) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <div className="flex gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={
              "rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors " +
              (value === o.value
                ? "border-clay bg-clay text-background"
                : "border-rule bg-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it lints**

Run: `pnpm lint`
Expected: this file is clean. (The `packing-tab.tsx` arity error from Task 1 is still
present until Task 3 — that is the only expected error.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/trips/[slug]/import-items-dialog.tsx"
git commit -m "feat(packing): ImportItemsDialog (trip + checklist, scope toggles)"
```

---

## Task 3: Wire the dialog into `packing-tab.tsx`

**Files:**
- Modify: `src/app/trips/[slug]/packing-tab.tsx`

- [ ] **Step 1: Swap the imports**

Replace:

```tsx
import {
  addPackingCategory,
  addPackingItem,
  copyPackingFromTrip,
  deletePackingCategory,
  deletePackingItem,
  reorderPackingCategories,
  togglePackingItem,
  updatePackingItem,
} from "@/lib/trips/actions"
import { ImportFromTripControl } from "./import-from-trip"
```

with:

```tsx
import {
  addPackingCategory,
  addPackingItem,
  deletePackingCategory,
  deletePackingItem,
  reorderPackingCategories,
  togglePackingItem,
  updatePackingItem,
} from "@/lib/trips/actions"
import { Download } from "lucide-react"
import { ImportItemsDialog } from "./import-items-dialog"
```

- [ ] **Step 2: Add the `importOpen` state**

Replace:

```tsx
  const [partnerUnlocked, setPartnerUnlocked] = React.useState(false)
```

with:

```tsx
  const [partnerUnlocked, setPartnerUnlocked] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
```

- [ ] **Step 3: Add the Import button to the switcher row + render the dialog**

Replace the switcher row block:

```tsx
        <div className="relative mt-3 flex gap-1.5">
          <SegBtn active={view === "mine"} onClick={() => setView("mine")}>
            My list
          </SegBtn>
          <SegBtn active={view === "shared"} onClick={() => setView("shared")}>
            Shared
          </SegBtn>
          {partnerName ? (
            <SegBtn active={view === "partner"} onClick={openPartner}>
              {partnerName}&rsquo;s list
            </SegBtn>
          ) : null}
        </div>
      </div>
```

with:

```tsx
        <div className="relative mt-3 flex flex-wrap items-center gap-1.5">
          <SegBtn active={view === "mine"} onClick={() => setView("mine")}>
            My list
          </SegBtn>
          <SegBtn active={view === "shared"} onClick={() => setView("shared")}>
            Shared
          </SegBtn>
          {partnerName ? (
            <SegBtn active={view === "partner"} onClick={openPartner}>
              {partnerName}&rsquo;s list
            </SegBtn>
          ) : null}
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="ml-auto flex items-center gap-1 rounded-full border border-rule px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:border-foreground hover:text-foreground"
          >
            <Download className="h-3 w-3" />
            Import items
          </button>
        </div>
      </div>

      <ImportItemsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        tripId={tripId}
        tripSlug={tripSlug}
        currentUserId={currentUserId}
        defaultTarget={view === "mine" ? "mine" : "shared"}
      />
```

- [ ] **Step 4: Drop the `onCopyShared` prop from the `PackingList` call**

Replace:

```tsx
          onReorder={reorder}
          onCopyShared={(src) => copyPackingFromTrip(tripId, src, tripSlug)}
        />
```

with:

```tsx
          onReorder={reorder}
        />
```

- [ ] **Step 5: Remove `onCopyShared` from `PackingListProps`**

Replace:

```tsx
  onReorder: (owner: string | null, orderedIds: string[]) => void
  onCopyShared: (sourceTripId: string) => Promise<{ error?: string }>
}
```

with:

```tsx
  onReorder: (owner: string | null, orderedIds: string[]) => void
}
```

- [ ] **Step 6: Remove `onCopyShared` from the `PackingList` destructure**

Replace:

```tsx
  onReorder,
  onCopyShared,
}: PackingListProps) {
```

with:

```tsx
  onReorder,
}: PackingListProps) {
```

- [ ] **Step 7: Remove the old in-view import block**

Replace:

```tsx
      {owner === null ? (
        <div className="px-5 pt-2">
          <ImportFromTripControl
            tripId={tripId}
            label="Copy packing from another trip"
            onCopy={onCopyShared}
          />
        </div>
      ) : null}
```

with nothing (delete the block entirely).

- [ ] **Step 8: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: both pass with no errors.

- [ ] **Step 9: Commit**

```bash
git add "src/app/trips/[slug]/packing-tab.tsx"
git commit -m "feat(packing): Import items button + dialog in switcher row"
```

---

## Task 4: Manual verification in the browser

**Files:** none (manual QA against the running dev server).

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`
(If Turbopack panics with `0xc0000142` on Windows, stop, delete `.next/`, restart — known
flake, not a code bug.)

- [ ] **Step 2: Verify the button + step 1**

Open a trip's Packing tab. Confirm an **Import items** button (download icon) sits at the
right end of the `My list · Shared · Partner's list` row. Tapping it opens a modal titled
"Import items" with two buttons: **From a trip** and **From a checklist**.

- [ ] **Step 3: Verify checklist import + target default**

From **Shared**, open the dialog → **From a checklist**. Confirm the **To** toggle defaults
to **Shared**. Pick a checklist, **import**; the dialog closes and the items appear in the
Shared list, unpacked, under the checklist's categories. Repeat from **My list** and
confirm the **To** toggle defaults to **My list** and items land there.

- [ ] **Step 4: Verify trip import with source/target scopes**

Open the dialog → **From a trip**. Confirm the **From** toggle defaults to **Shared**. Pick
another trip, import into both **To: Shared** and **To: My list**, and verify items land in
the right list. Switch **From** to **My list** and confirm it pulls your own personal items
from that source trip.

- [ ] **Step 5: Verify empty states + Partner view**

With a workspace that has no other trips / no checklists, confirm the respective step shows
"No other trips to copy from." / "No checklists to copy from." Confirm the Import button is
still present and usable while the read-only **Partner's list** view is active (it defaults
**To: Shared**).

- [ ] **Step 6: Verify realtime**

With two accounts on the same trip, import into Shared in one and confirm the items appear
live in the other (existing packing realtime channel).

---

## Task 5: Update docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Log the work in `docs/TODO.md`**

Add a completed entry under the semi-private packing section describing the "Import items"
dialog (global button in the switcher row; from-a-trip with Shared/My source + My/Shared
target, from-a-checklist with My/Shared target; replaces the in-list import bars; no
migration), following the file's existing format.

- [ ] **Step 2: Add a row to `docs/DECISIONS.md`**

Record the non-obvious choices: one global "Import items" dialog instead of a 4th packing
segment or per-view import bars; `copyPackingFromTrip` generalized with
`sourceOwner`/`targetOwner` and a sibling `copyChecklistToPacking` reusing the
checklist↔packing shape match; `import-from-trip.tsx` deliberately left for the Notes tab.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: log packing Import items dialog"
```

---

## Self-review notes

- **Spec coverage:** global Import button + modal (Task 3), two-step choose→trip/checklist
  with target toggle defaulting to active list and trip source toggle defaulting to Shared
  (Task 2), `getImportableChecklists` + `copyChecklistToPacking` + scoped
  `copyPackingFromTrip` (Task 1), removal of the in-view import bar / `onCopyShared` and
  Notes tab left untouched (Task 3), realtime/no-migration (inherent). All spec sections
  map to a task.
- **Type consistency:** `ImportableTrip` reused for both trips and checklists;
  `copyPackingFromTrip(tripId, selected, sourceOwner, targetOwner, tripSlug)` and
  `copyChecklistToPacking(tripId, selected, owner, tripSlug)` signatures match Task 1's
  definitions; `Scope = "mine" | "shared"` maps to owner via `=== "mine" ? currentUserId :
  null` consistently.
