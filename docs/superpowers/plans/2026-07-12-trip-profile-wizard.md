# Trip Profile Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the trip Profile tab's pill soup with a 4-step guided wizard (Idea → Categories → Getting around → Vibe) grounded in the trip's categories, using big option rows, and add transport capture.

**Architecture:** The Profile tab renders a client-side `ProfileWizard` (new `profile-wizard.tsx`) above the unchanged Notes section. The wizard walks one question per screen. Step 2 (categories) is the backbone — it edits the trip's `expense_categories` rows live via the existing add/remove server actions (the standalone Categories block is absorbed here). Steps 1/3/4 (idea, transport, vibe) are held in local state and saved once, at the end, via `saveTripProfile`. The `trip_profile` jsonb column is untouched; back-compat parsing pulls legacy `headline`/`brief` text into the new `idea` field.

**Tech Stack:** Next.js 16 App Router, React 19 client component, TypeScript 5, Tailwind v4. Supabase for persistence (existing). No new dependencies.

## Global Constraints

- **No test framework exists** in this repo. "Verify" means: `pnpm lint` passes, `pnpm build` passes, and a manual browser check where noted. Do not invent a test command.
- **No emojis** in code, comments, or copy.
- **Sparse comments** — clear names over comments; comment only non-obvious WHY.
- **Client components** import query-layer types only from `*-types.ts`. `trip-profile-types.ts` is a pure types module — safe to import from client code.
- **Categories are live server rows.** The category step must reuse the existing `addExpenseCategory` / `deleteExpenseCategory` actions and `router.refresh()`, exactly as the current `TripCategories` block does. Deleting a category moves its expenses to "Other" (the actions already do this) — keep the confirm dialog.
- **Commit only when the user asks.** The commit steps below are the intended commit points during execution; the user drives whether they run.
- **Turbopack Windows flake:** if `pnpm dev`/`pnpm build` fails with a `0xc0000142` subprocess panic, stop, delete `.next/`, and retry — it is not a code bug.

---

### Task 1: Data model, save action, and downstream reads

Rewrites the profile shape to `idea` / `transport` / `vibe`, drops `headline` / `brief` / `who` (and never adds `accommodation`), and updates every consumer that reads the old fields. Leaves `profile-tab.tsx` in a minimal working state (idea textarea + vibe pills + the existing Categories block + Notes) so the build stays green; the full wizard lands in Task 2.

**Files:**
- Modify: `src/lib/trips/trip-profile-types.ts` (whole file)
- Modify: `src/lib/trips/actions.ts` (`saveTripProfile` ~1423-1455 and its `TRIP_WHO` import ~line 34)
- Modify: `src/app/trips/[slug]/page.tsx:410-414` (trip header)
- Modify: `src/lib/ai/budget-actions.ts:91`
- Modify: `src/app/api/ai/discover/route.ts:65`
- Modify: `src/app/trips/[slug]/profile-tab.tsx` (whole file — interim minimal form)

**Interfaces:**
- Produces: `TripProfile = { idea: string; transport: string[]; vibe: string[] }`
- Produces: `TRIP_TRANSPORT`, `TRIP_VIBES` (readonly string tuples), `EMPTY_TRIP_PROFILE`, `parseTripProfile(raw: unknown): TripProfile`
- Produces: `saveTripProfile(input: { tripId: string; tripSlug: string; profile: TripProfile }): Promise<{ error?: string }>` (signature unchanged; validates the new fields)

- [ ] **Step 1: Rewrite `trip-profile-types.ts`**

Replace the entire file with:

```ts
export const TRIP_TRANSPORT = [
  "Own car",
  "Rental car",
  "Public transport",
  "Flights between stops",
  "Taxis & walking",
] as const

export const TRIP_VIBES = [
  "Romantic",
  "Adventurous",
  "Relaxed",
  "Social/lively",
  "Cultural",
  "Off-the-beaten-path",
  "Luxe",
] as const

export interface TripProfile {
  idea: string
  transport: string[]
  vibe: string[]
}

export const EMPTY_TRIP_PROFILE: TripProfile = {
  idea: "",
  transport: [],
  vibe: [],
}

/** Tolerant parse of the jsonb `trip_profile` column. Filters transport/vibe to
 * allowed sets; never throws on legacy/malformed data. Legacy trips: `idea`
 * falls back to the old `headline` then `brief` so their text is not lost.
 * (Categories are their own expense_categories rows, not stored here.) */
export function parseTripProfile(raw: unknown): TripProfile {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_TRIP_PROFILE }
  const r = raw as Record<string, unknown>
  const pickArr = (v: unknown, allowed: readonly string[]): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && allowed.includes(x))
      : []
  const legacyHeadline = typeof r.headline === "string" ? r.headline : ""
  const legacyBrief = typeof r.brief === "string" ? r.brief : ""
  const idea =
    typeof r.idea === "string" && r.idea.trim()
      ? r.idea
      : legacyHeadline || legacyBrief
  return {
    idea,
    transport: pickArr(r.transport, TRIP_TRANSPORT),
    vibe: pickArr(r.vibe, TRIP_VIBES),
  }
}
```

- [ ] **Step 2: Update `saveTripProfile` in `actions.ts`**

Find the import that pulls `TRIP_VIBES, TRIP_WHO` from `@/lib/trips/trip-profile-types` (near line 34) and change it to bring in `TRIP_TRANSPORT` and `TRIP_VIBES` (drop `TRIP_WHO`), keeping any other names already imported from that module (e.g. `type TripProfile`):

```ts
  TRIP_TRANSPORT,
  TRIP_VIBES,
```

Replace the `clean` object at `actions.ts:1440-1445`:

```ts
  const p = input.profile
  const clean = {
    idea: p.idea.trim().slice(0, 2000),
    transport: p.transport.filter((t) =>
      (TRIP_TRANSPORT as readonly string[]).includes(t),
    ),
    vibe: p.vibe.filter((v) => (TRIP_VIBES as readonly string[]).includes(v)),
  }
```

Update the doc comment above the function (~line 1429):

```ts
/** Writes the per-trip profile (idea + transport + vibe) to trips.trip_profile.
 * Values filtered to their allowed sets; idea capped. RLS gates the write to
 * workspace members. Manual — no AI. (Categories live in expense_categories.) */
```

- [ ] **Step 3: Update the trip header in `page.tsx`**

Replace `page.tsx:410-414`:

```tsx
          {header.tripProfile.idea ? (
            <div className="mt-1.5 truncate font-mono text-[11px] tracking-[0.06em] text-muted-foreground">
              {header.tripProfile.idea}
            </div>
          ) : null}
```

- [ ] **Step 4: Remap the AI read sites off `brief`**

In `src/lib/ai/budget-actions.ts:91`, change the line to:

```ts
      brief: trip.tripProfile.idea,
```

In `src/app/api/ai/discover/route.ts:65`, change the line to:

```ts
      trip: { vibe: profile.vibe, brief: profile.idea },
```

(The AI query objects keep their `brief` key; only the source becomes `idea`. `claude.ts` is unchanged.)

- [ ] **Step 5: Rewrite `profile-tab.tsx` to a minimal compiling form**

Interim: idea textarea + vibe pills + the existing Categories block + Notes. `transport` is carried through save untouched (no UI yet). Replace the whole file:

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { NotesTab } from "./notes-tab"
import {
  addExpenseCategory,
  deleteExpenseCategory,
  saveTripProfile,
} from "@/lib/trips/actions"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import { TRIP_VIBES, type TripProfile } from "@/lib/trips/trip-profile-types"

/** The trip "Profile" tab: interim single-page form above the reused Categories
 * and Notes features. The guided wizard replaces this top section next. */
export function ProfileTab({
  profile,
  expenseCategories,
  ...notesProps
}: React.ComponentProps<typeof NotesTab> & {
  profile: TripProfile
  expenseCategories: ExpenseCategoryRow[]
}) {
  const router = useRouter()
  const { tripId, tripSlug } = notesProps
  const [idea, setIdea] = React.useState(profile.idea)
  const [vibe, setVibe] = React.useState<string[]>(profile.vibe)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)

  function toggleVibe(tag: string) {
    setSaved(false)
    setVibe((list) =>
      list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag],
    )
  }

  function save() {
    setSaving(true)
    saveTripProfile({
      tripId,
      tripSlug,
      profile: { idea, vibe, transport: profile.transport },
    }).then((r) => {
      setSaving(false)
      if (r.error) return
      setSaved(true)
      router.refresh()
    })
  }

  return (
    <>
      <section className="px-5 pt-5 lg:px-10 lg:pt-6">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          The idea
        </span>
        <textarea
          value={idea}
          onChange={(e) => {
            setIdea(e.target.value)
            setSaved(false)
          }}
          placeholder="Sum up this trip in a line — e.g. 2 weeks surfing in Portugal"
          rows={3}
          className="mt-1.5 w-full resize-y rounded-lg border border-rule bg-transparent p-2.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
        />

        <div className="mt-4">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Vibe
          </span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {TRIP_VIBES.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => toggleVibe(v)}
                aria-pressed={vibe.includes(v)}
                className={`rounded-full border px-3 py-1 font-mono text-[11px] tracking-[0.06em] ${
                  vibe.includes(v)
                    ? "border-foreground bg-foreground text-background"
                    : "border-rule text-muted-foreground hover:text-foreground"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="mt-4 rounded-full border-0 bg-foreground px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {saving ? "saving…" : saved ? "saved" : "save profile"}
        </button>

        <TripCategories
          tripId={tripId}
          tripSlug={tripSlug}
          categories={expenseCategories}
        />
      </section>

      <NotesTab {...notesProps} />
    </>
  )
}

/** The trip's categories — the same expense_categories used in Budget. Add/remove
 * here writes the shared list (deleting moves that category's expenses to
 * "Other", as in Budget). */
function TripCategories({
  tripId,
  tripSlug,
  categories,
}: {
  tripId: string
  tripSlug: string
  categories: ExpenseCategoryRow[]
}) {
  const router = useRouter()
  const [adding, setAdding] = React.useState(false)
  const [name, setName] = React.useState("")
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  function add() {
    const t = name.trim()
    if (!t || pending) return
    startTransition(async () => {
      const r = await addExpenseCategory(tripId, tripSlug, t)
      if (r.error) {
        setError(r.error)
        return
      }
      setName("")
      setAdding(false)
      setError(null)
      router.refresh()
    })
  }

  function remove(c: ExpenseCategoryRow) {
    if (pending) return
    if (
      !confirm(
        `Delete "${c.name}"? Its expenses move to "Other" and its planned budget items are removed.`,
      )
    )
      return
    startTransition(async () => {
      const r = await deleteExpenseCategory(c.id, tripSlug)
      if (r.error) {
        setError(r.error)
        return
      }
      setError(null)
      router.refresh()
    })
  }

  return (
    <div className="mt-4">
      <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Categories
      </span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] tracking-[0.06em] text-foreground"
          >
            {c.name}
            <button
              type="button"
              onClick={() => remove(c)}
              disabled={pending}
              aria-label={`Delete ${c.name}`}
              className="text-muted-foreground hover:text-clay disabled:opacity-50"
            >
              ×
            </button>
          </span>
        ))}
        {adding ? (
          <input
            type="text"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
              if (e.key === "Escape") {
                setAdding(false)
                setName("")
              }
            }}
            placeholder="New category…"
            disabled={pending}
            className="w-32 rounded-full border border-dashed border-rule bg-transparent px-3 py-1 font-mono text-[11px] tracking-[0.06em] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-full border border-dashed border-rule px-3 py-1 font-mono text-[11px] tracking-[0.06em] text-muted-foreground hover:border-foreground hover:text-foreground"
          >
            + add category
          </button>
        )}
      </div>
      {error ? (
        <div className="mt-1 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 6: Verify lint and build**

Run: `pnpm lint`
Expected: no errors (pre-existing warnings tolerated).

Run: `pnpm build`
Expected: build succeeds. On a `0xc0000142` panic, delete `.next/` and re-run.

- [ ] **Step 7: Manual smoke check**

Run: `pnpm dev`, open an existing trip's **Profile** tab.
Expected: "The idea" textarea (pre-filled from old headline/brief if any), a Vibe row, Save, then the Categories block and Notes. Save, refresh — idea + vibe persist. The trip header under the title shows the idea text.

- [ ] **Step 8: Commit**

```bash
git add src/lib/trips/trip-profile-types.ts src/lib/trips/actions.ts src/app/trips/[slug]/page.tsx src/lib/ai/budget-actions.ts src/app/api/ai/discover/route.ts src/app/trips/[slug]/profile-tab.tsx
git commit -m "refactor(trip-profile): idea/transport/vibe model, drop who/brief"
```

---

### Task 2: The guided wizard

Adds the step-by-step wizard with the categories backbone step and big option rows, then wires the Profile tab to it. Removes the interim form and the standalone Categories block.

**Files:**
- Create: `src/app/trips/[slug]/profile-wizard.tsx`
- Modify: `src/app/trips/[slug]/profile-tab.tsx` (render `<ProfileWizard/>` + `<NotesTab/>`; drop the interim form, the `TripCategories` block, and now-unused imports)

**Interfaces:**
- Consumes: `TripProfile`, `TRIP_TRANSPORT`, `TRIP_VIBES` (Task 1); `saveTripProfile`, `addExpenseCategory`, `deleteExpenseCategory` (existing); `ExpenseCategoryRow` (existing).
- Produces: `ProfileWizard({ tripId, tripSlug, profile, categories }: { tripId: string; tripSlug: string; profile: TripProfile; categories: ExpenseCategoryRow[] })` — named export, client component.

- [ ] **Step 1: Create `profile-wizard.tsx`**

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  addExpenseCategory,
  deleteExpenseCategory,
  saveTripProfile,
} from "@/lib/trips/actions"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import {
  TRIP_TRANSPORT,
  TRIP_VIBES,
  type TripProfile,
} from "@/lib/trips/trip-profile-types"

const STEP_COUNT = 4

/** Guided 4-step trip profile: idea, categories (the backbone), getting around,
 * vibe. One question per screen with big option rows. Categories write live (as
 * in Budget); idea/transport/vibe save once on the final step. Reopening starts
 * at step 1 pre-filled with the saved answers and current category set. */
export function ProfileWizard({
  tripId,
  tripSlug,
  profile,
  categories,
}: {
  tripId: string
  tripSlug: string
  profile: TripProfile
  categories: ExpenseCategoryRow[]
}) {
  const router = useRouter()
  const [step, setStep] = React.useState(0)
  const [idea, setIdea] = React.useState(profile.idea)
  const [transport, setTransport] = React.useState<string[]>(profile.transport)
  const [vibe, setVibe] = React.useState<string[]>(profile.vibe)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)

  const toggle = (list: string[], set: (v: string[]) => void, tag: string) =>
    set(list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag])

  function save() {
    setSaving(true)
    saveTripProfile({
      tripId,
      tripSlug,
      profile: { idea, transport, vibe },
    }).then((r) => {
      setSaving(false)
      if (r.error) return
      setSaved(true)
      router.refresh()
    })
  }

  const isLast = step === STEP_COUNT - 1

  return (
    <section className="px-5 pt-5 lg:px-10 lg:pt-6">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {step + 1} of {STEP_COUNT}
        </span>
        <div className="flex gap-1.5">
          {Array.from({ length: STEP_COUNT }).map((_, i) => (
            <span
              key={i}
              className={`h-1 w-6 rounded-full ${
                i <= step ? "bg-foreground" : "bg-rule"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="mt-5 min-h-[240px]">
        {step === 0 ? (
          <StepShell title="Sum up this trip in a line">
            <textarea
              value={idea}
              autoFocus
              onChange={(e) => {
                setIdea(e.target.value)
                setSaved(false)
              }}
              placeholder="e.g. 2 weeks surfing in Portugal"
              rows={3}
              className="w-full resize-y rounded-lg border border-rule bg-transparent p-3 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
            />
          </StepShell>
        ) : null}

        {step === 1 ? (
          <StepShell
            title="What's this trip made of?"
            hint="Your categories — they shape the budget too"
          >
            <CategoryStep
              tripId={tripId}
              tripSlug={tripSlug}
              categories={categories}
            />
          </StepShell>
        ) : null}

        {step === 2 ? (
          <StepShell title="How will you get around?" hint="Pick any that apply">
            {TRIP_TRANSPORT.map((t) => (
              <OptionRow
                key={t}
                label={t}
                selected={transport.includes(t)}
                onClick={() => {
                  setSaved(false)
                  toggle(transport, setTransport, t)
                }}
              />
            ))}
          </StepShell>
        ) : null}

        {step === 3 ? (
          <StepShell title="What's the vibe?" hint="Pick any that apply">
            {TRIP_VIBES.map((v) => (
              <OptionRow
                key={v}
                label={v}
                selected={vibe.includes(v)}
                onClick={() => {
                  setSaved(false)
                  toggle(vibe, setVibe, v)
                }}
              />
            ))}
          </StepShell>
        ) : null}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="rounded-full border border-rule px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          back
        </button>
        {isLast ? (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-full border-0 bg-foreground px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {saving ? "saving…" : saved ? "saved" : "save profile"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(STEP_COUNT - 1, s + 1))}
            className="rounded-full border-0 bg-foreground px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-background"
          >
            next
          </button>
        )}
      </div>
    </section>
  )
}

function StepShell({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="t-display text-[20px] text-foreground">{title}</h3>
      {hint ? (
        <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {hint}
        </span>
      ) : null}
      <div className="mt-4 flex flex-col gap-2">{children}</div>
    </div>
  )
}

function OptionRow({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-[15px] transition-colors ${
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-rule text-foreground hover:border-foreground"
      }`}
    >
      {label}
      <span
        className={`font-mono text-[13px] ${
          selected ? "text-background" : "text-muted-foreground"
        }`}
      >
        {selected ? "✓" : "+"}
      </span>
    </button>
  )
}

/** The backbone step: the trip's expense_categories as removable rows plus an
 * add row. Writes live (add inserts, remove deletes and moves expenses to
 * "Other") — same actions and behavior as the Budget categories editor. */
function CategoryStep({
  tripId,
  tripSlug,
  categories,
}: {
  tripId: string
  tripSlug: string
  categories: ExpenseCategoryRow[]
}) {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)

  function add() {
    const t = name.trim()
    if (!t || pending) return
    startTransition(async () => {
      const r = await addExpenseCategory(tripId, tripSlug, t)
      if (r.error) {
        setError(r.error)
        return
      }
      setName("")
      setError(null)
      router.refresh()
    })
  }

  function remove(c: ExpenseCategoryRow) {
    if (pending) return
    if (
      !confirm(
        `Delete "${c.name}"? Its expenses move to "Other" and its planned budget items are removed.`,
      )
    )
      return
    startTransition(async () => {
      const r = await deleteExpenseCategory(c.id, tripSlug)
      if (r.error) {
        setError(r.error)
        return
      }
      setError(null)
      router.refresh()
    })
  }

  return (
    <>
      {categories.map((c) => (
        <div
          key={c.id}
          className="flex w-full items-center justify-between rounded-xl border border-rule px-4 py-3 text-[15px] text-foreground"
        >
          {c.name}
          <button
            type="button"
            onClick={() => remove(c)}
            disabled={pending}
            aria-label={`Delete ${c.name}`}
            className="font-mono text-[15px] text-muted-foreground hover:text-clay disabled:opacity-50"
          >
            ×
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              add()
            }
          }}
          placeholder="Add a category…"
          disabled={pending}
          className="flex-1 rounded-xl border border-dashed border-rule bg-transparent px-4 py-3 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={add}
          disabled={pending || !name.trim()}
          className="rounded-xl border-0 bg-foreground px-4 py-3 font-mono text-[11px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          add
        </button>
      </div>
      {error ? (
        <div className="font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </>
  )
}
```

- [ ] **Step 2: Wire `profile-tab.tsx` to the wizard**

Replace the whole file (drops the interim form and the standalone `TripCategories` block; passes `expenseCategories` into the wizard):

```tsx
"use client"

import * as React from "react"

import { NotesTab } from "./notes-tab"
import { ProfileWizard } from "./profile-wizard"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import type { TripProfile } from "@/lib/trips/trip-profile-types"

/** The trip "Profile" tab: the guided profile wizard (its categories step is the
 * shared expense_categories, also edited in Budget) above the reused Notes. */
export function ProfileTab({
  profile,
  expenseCategories,
  ...notesProps
}: React.ComponentProps<typeof NotesTab> & {
  profile: TripProfile
  expenseCategories: ExpenseCategoryRow[]
}) {
  const { tripId, tripSlug } = notesProps

  return (
    <>
      <ProfileWizard
        tripId={tripId}
        tripSlug={tripSlug}
        profile={profile}
        categories={expenseCategories}
      />
      <NotesTab {...notesProps} />
    </>
  )
}
```

- [ ] **Step 3: Verify lint and build**

Run: `pnpm lint`
Expected: no errors. Watch for the React 19 gotcha: a bare `//` in JSX text must be an expression (`{"..."}`) — not used here, but relevant if you tweak copy.

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Manual browser check (mobile viewport)**

Run: `pnpm dev`, open a trip's **Profile** tab at a phone width. Verify each:
- Opens on step 1 ("1 of 4"), idea pre-filled from saved data.
- Step 2 lists the trip's categories as rows; adding one appends it and it persists on refresh; removing one prompts the confirm and drops it. (These are live writes — no need to hit Save.)
- Step 3 (Getting around) and step 4 (Vibe) are multi-select big rows; Back preserves selections.
- Step 4 shows "save profile"; saving shows "saved". Refresh: reopening starts at step 1 with idea/transport/vibe and the current categories pre-filled.
- Notes renders unchanged below the wizard.
- The trip header under the title shows the idea line.

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/[slug]/profile-wizard.tsx src/app/trips/[slug]/profile-tab.tsx
git commit -m "feat(trip-profile): guided wizard grounded in categories + transport"
```

- [ ] **Step 6: Update docs**

Update `docs/TODO.md` — mark the trip-profile wizard done. Append a row to `docs/DECISIONS.md` recording the non-obvious choices: categories are the profile backbone (a wizard step, not a separate block); accommodation dropped; transport stored but not yet fed to AI. Commit:

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record trip-profile wizard"
```

---

## Notes for the implementer

- **Why the interim form in Task 1:** TypeScript compiles the whole project, so removing `headline`/`brief`/`who` from `TripProfile` breaks `profile-tab.tsx` immediately. Task 1's minimal form keeps the build green and the tab usable; Task 2 replaces the top section with the wizard. Validate Task 1 before starting Task 2.
- **Two-speed persistence is intentional:** the categories step writes live (insert/delete rows), while idea/transport/vibe save on the final step. This mirrors how categories already behave in Budget; do not try to defer category writes into the final Save.
- **No migration:** the `trip_profile` jsonb column is written with whatever keys `saveTripProfile` sends. Old rows keep `headline`/`brief` until re-saved; `parseTripProfile` reads them into `idea`. Expected, not a bug.
- **Single shared Supabase DB:** saving in dev writes the same database as prod; there is no separate prod migration step.
