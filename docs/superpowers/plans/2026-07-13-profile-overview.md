# Trip Profile Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the trip Profile tab land on a read-only overview of the saved profile, with an "Edit profile" button that opens the existing 4-step wizard.

**Architecture:** `ProfileTab` (already a client component) holds one `editing` boolean and renders either a new read-only `ProfileOverview` or the existing `ProfileWizard`. The wizard gains one optional `onDone` prop so it can hand control back to the tab on save or cancel. No schema, no server action, no migration — same props (`profile`, `expenseCategories`) already flow into the tab.

**Tech Stack:** Next.js 16 App Router, React 19 client components, Tailwind v4. Verification is `pnpm lint` + `pnpm build` (no test framework in this repo).

## Global Constraints

- No emojis in code, comments, or copy.
- No new dependency, no migration, no server-action change.
- Reuse existing design tokens: `t-display` heading, mono uppercase micro-labels (`font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground`), `rounded-xl border-rule` chips, `bg-foreground text-background` button. Section padding matches the wizard: `px-5 pt-5 lg:px-10 lg:pt-6`.
- `"use client"` files import profile types from `@/lib/trips/trip-profile-types` and category types from `@/lib/trips/expense-types` (type-only), never from a `*-queries.ts` module.
- European date order is irrelevant here (no dates rendered).
- Verify each task with `pnpm lint` then `pnpm build`; both must be clean before commit.

---

### Task 1: Add optional `onDone` to `ProfileWizard`

Make the wizard able to hand control back to its parent: call `onDone` after a successful save, and turn the step-0 Back button into a "cancel" that calls `onDone`. When `onDone` is absent, behavior is unchanged (Back disabled on step 0, save stays on the wizard).

**Files:**
- Modify: `src/app/trips/[slug]/profile-wizard.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ProfileWizard` now accepts an optional prop `onDone?: () => void`.

- [ ] **Step 1: Add `onDone` to the props type and signature**

In the `ProfileWizard` props object type, add the optional prop. Change:

```tsx
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
```

to:

```tsx
export function ProfileWizard({
  tripId,
  tripSlug,
  profile,
  categories,
  onDone,
}: {
  tripId: string
  tripSlug: string
  profile: TripProfile
  categories: ExpenseCategoryRow[]
  onDone?: () => void
}) {
```

- [ ] **Step 2: Call `onDone` after a successful save**

In `save()`, after `router.refresh()`, hand control back to the parent. Change the `.then` body:

```tsx
    }).then((r) => {
      setSaving(false)
      if (r.error) return
      setSaved(true)
      router.refresh()
    })
```

to:

```tsx
    }).then((r) => {
      setSaving(false)
      if (r.error) return
      setSaved(true)
      router.refresh()
      onDone?.()
    })
```

The `router.refresh()` still runs so the parent's server props (and thus the overview) re-render with the saved profile; `onDone` flips the tab back to the overview.

- [ ] **Step 3: Make the step-0 Back button a cancel when `onDone` is present**

The Back button is currently `disabled` on step 0. When `onDone` is provided, step 0 should instead cancel back to the overview. Change:

```tsx
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="rounded-full border border-rule px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          back
        </button>
```

to:

```tsx
        <button
          type="button"
          onClick={() => {
            if (step === 0) {
              onDone?.()
              return
            }
            setStep((s) => Math.max(0, s - 1))
          }}
          disabled={step === 0 && !onDone}
          className="rounded-full border border-rule px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          {step === 0 && onDone ? "cancel" : "back"}
        </button>
```

When `onDone` is absent, the button stays disabled on step 0 and reads "back" — unchanged.

- [ ] **Step 4: Verify lint and build**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds (Compiled successfully).

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/[slug]/profile-wizard.tsx
git commit -m "feat(profile): ProfileWizard accepts optional onDone (save/cancel)"
```

---

### Task 2: Add `ProfileOverview` and land the tab on it

Create the read-only overview as a sibling file, and give `ProfileTab` an `editing` toggle that switches between the overview and the wizard.

**Files:**
- Create: `src/app/trips/[slug]/profile-overview.tsx`
- Modify: `src/app/trips/[slug]/profile-tab.tsx`

**Interfaces:**
- Consumes: `ProfileWizard`'s `onDone` prop (Task 1); `TripProfile` from `@/lib/trips/trip-profile-types`; `ExpenseCategoryRow` from `@/lib/trips/expense-types`.
- Produces: `ProfileOverview` with props `{ profile: TripProfile; categories: ExpenseCategoryRow[]; onEdit: () => void }`.

- [ ] **Step 1: Create `profile-overview.tsx`**

```tsx
"use client"

import * as React from "react"

import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import type { TripProfile } from "@/lib/trips/trip-profile-types"

/** Read-only summary of the trip profile. Each section is hidden when its data
 * is empty. When idea/transport/vibe are all empty the card shows a quiet
 * set-up prompt and the button reads "Set up profile". Categories are always
 * seeded, so that section is effectively always present. */
export function ProfileOverview({
  profile,
  categories,
  onEdit,
}: {
  profile: TripProfile
  categories: ExpenseCategoryRow[]
  onEdit: () => void
}) {
  const isEmpty =
    !profile.idea.trim() &&
    profile.transport.length === 0 &&
    profile.vibe.length === 0

  return (
    <section className="px-5 pt-5 lg:px-10 lg:pt-6">
      {isEmpty ? (
        <p className="t-display text-[20px] text-muted-foreground">
          No profile yet — add a few details
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {profile.idea.trim() ? (
            <h3 className="t-display text-[22px] text-foreground">
              {profile.idea}
            </h3>
          ) : null}

          {categories.length ? (
            <Section label="Categories">
              <div className="flex flex-col gap-2">
                {categories.map((c) => (
                  <div key={c.id} className="text-[15px] text-foreground">
                    {c.name}
                    {c.details.length ? (
                      <span className="text-muted-foreground">
                        {" · "}
                        {c.details.join(", ")}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {profile.transport.length ? (
            <Section label="Getting around">
              <Chips items={profile.transport} />
            </Section>
          ) : null}

          {profile.vibe.length ? (
            <Section label="Vibe">
              <Chips items={profile.vibe} />
            </Section>
          ) : null}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-full border-0 bg-foreground px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-background"
        >
          {isEmpty ? "set up profile" : "edit profile"}
        </button>
      </div>
    </section>
  )
}

function Section({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span
          key={t}
          className="inline-flex items-center rounded-xl border border-rule px-3 py-1.5 text-[14px] text-foreground"
        >
          {t}
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Wire the `editing` toggle into `ProfileTab`**

Replace the body of `src/app/trips/[slug]/profile-tab.tsx`. It must keep the same exported signature and props. New version:

```tsx
"use client"

import * as React from "react"

import { NotesTab } from "./notes-tab"
import { ProfileOverview } from "./profile-overview"
import { ProfileWizard } from "./profile-wizard"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"
import type { TripProfile } from "@/lib/trips/trip-profile-types"

/** The trip "Profile" tab: a read-only overview of the profile that swaps in
 * the guided wizard on "Edit profile" (its categories step is the shared
 * expense_categories, also edited in Budget), above the reused Notes. */
export function ProfileTab({
  profile,
  expenseCategories,
  ...notesProps
}: React.ComponentProps<typeof NotesTab> & {
  profile: TripProfile
  expenseCategories: ExpenseCategoryRow[]
}) {
  const { tripId, tripSlug } = notesProps
  const [editing, setEditing] = React.useState(false)

  return (
    <>
      {editing ? (
        <ProfileWizard
          tripId={tripId}
          tripSlug={tripSlug}
          profile={profile}
          categories={expenseCategories}
          onDone={() => setEditing(false)}
        />
      ) : (
        <ProfileOverview
          profile={profile}
          categories={expenseCategories}
          onEdit={() => setEditing(true)}
        />
      )}
      <NotesTab {...notesProps} />
    </>
  )
}
```

- [ ] **Step 3: Verify lint and build**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds (Compiled successfully).

- [ ] **Step 4: In-app check**

Run: `pnpm dev`, open a trip, go to the Profile tab.
Expected:
- The tab lands on the overview (idea heading, categories with details, transport chips, vibe chips), not the wizard.
- "Edit profile" opens the wizard at step 1, pre-filled.
- Adding/removing a category in the wizard still writes live.
- "save profile" on step 4 returns to the overview showing the change.
- "cancel" (step-0 Back) returns to the overview.
- A trip with an empty profile shows "No profile yet — add a few details" and a "set up profile" button.

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/[slug]/profile-overview.tsx src/app/trips/[slug]/profile-tab.tsx
git commit -m "feat(profile): land Profile tab on a read-only overview"
```

---

### Task 3: Update docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md` (only if a non-obvious choice is worth recording)

- [ ] **Step 1: Add a TODO entry**

Add a checked entry under a new dated heading in `docs/TODO.md` summarizing: Profile tab now lands on a read-only `ProfileOverview` (idea / categories+details / transport / vibe, empty sections hidden, empty-profile prompt); "Edit profile" swaps in the existing `ProfileWizard`, which gained an optional `onDone` prop wired to save-success and the step-0 Back-as-cancel; no schema/server change. Reference this plan and the spec `docs/superpowers/specs/2026-07-13-profile-overview-design.md`.

- [ ] **Step 2: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record profile overview slice"
```

---

## Self-Review

- **Spec coverage:** Overview-first landing (Task 2), Edit button opens wizard (Task 2), save + cancel return paths (Task 1), each section hidden when empty + empty-state prompt (Task 2 Step 1), no schema/server change (Global Constraints), sibling file `profile-overview.tsx` (Task 2). All spec sections map to a task.
- **Placeholder scan:** No TBD/TODO-in-code; all code steps show full code.
- **Type consistency:** `onDone?: () => void` defined in Task 1 and consumed in Task 2. `ProfileOverview` props `{ profile, categories, onEdit }` defined and consumed consistently. `ExpenseCategoryRow.details` (string[]) and `.id`/`.name` match `expense-types` usage in the existing wizard.
