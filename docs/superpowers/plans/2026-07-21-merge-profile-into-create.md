# Merge Trip Profile into Create-a-New-Trip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the trip profile (idea, categories with detail tags, getting-around, vibe) into the `/trips/new` create form as a flat optional section, persisted in one submit, and demote the standalone Profile tab to later-edits only.

**Architecture:** One page, one save. `createTrip` grows optional `profile` + `categories` inputs and writes both at insert (no migration — `trips.trip_profile` jsonb and `expense_categories.details` already exist). The create form gets a **local** category editor (browser state until submit) plus idea/transport/vibe controls, sharing presentational components with the live Profile-tab wizard.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Supabase (`@supabase/ssr`), Tailwind v4. No test framework in this repo — the validation gate per task is `pnpm lint` + `pnpm build` clean (the established repo gate), plus in-app verification at the end.

## Global Constraints

- No new dependencies, no migration, no AI/prompt change.
- Idempotent-migrations rule N/A (no SQL this feature).
- No emojis in code/comments. Sparse comments; clear names. Short functions.
- Client components (`"use client"`) must import query-layer *types* from `*-types.ts`, never from `*-queries.ts`.
- European date order elsewhere (not relevant here — no date rendering added).
- Profile shape is exactly `{ idea: string; transport: string[]; vibe: string[] }` (jsonb `trips.trip_profile`).
- Allowed transport values: `TRIP_TRANSPORT`; allowed vibe values: `TRIP_VIBES` (both in `src/lib/trips/trip-profile-types.ts`).
- Default seeded categories: `EXPENSE_CATEGORIES` = `["Food","Groceries","Transportation","Accommodation","Activities","Other"]` (`src/lib/trips/expense-types.ts`).
- Applies to **both dreams and dated trips**. After create, routing stays `?tab=itinerary`.

---

### Task 1: Extend `createTrip` to accept and persist profile + categories

**Files:**
- Modify: `src/lib/trips/actions.ts` (`CreateTripInput` interface ~638-648; `createTrip` body ~664-779; imports near top)

**Interfaces:**
- Consumes: nothing new.
- Produces: `CreateTripInput` gains `profile?: TripProfile` and `categories?: { name: string; details: string[] }[]`. `createTrip` writes `trip_profile` on the trip insert and seeds `expense_categories` rows (with `details`) from `input.categories`, falling back to `EXPENSE_CATEGORIES` when omitted/empty.

- [ ] **Step 1: Ensure imports**

At the top of `src/lib/trips/actions.ts`, confirm the `trip-profile-types` import includes `EMPTY_TRIP_PROFILE` and the `TripProfile` type alongside the existing `TRIP_TRANSPORT` / `TRIP_VIBES`. If the import currently reads only some of these, extend it:

```ts
import {
  EMPTY_TRIP_PROFILE,
  TRIP_TRANSPORT,
  TRIP_VIBES,
  type TripProfile,
} from "@/lib/trips/trip-profile-types"
```

Confirm `EXPENSE_CATEGORIES` is imported from `@/lib/trips/expense-types` (it already is — used by the current category seed).

- [ ] **Step 2: Extend `CreateTripInput`**

Add the two optional fields to the interface (~638):

```ts
export interface CreateTripInput {
  name: string
  slug: string
  isDream: boolean
  startDate: string | null
  endDate: string | null
  fuzzyWhen: string | null
  country: string | null
  lat: number | null
  lng: number | null
  profile?: TripProfile
  categories?: { name: string; details: string[] }[]
}
```

- [ ] **Step 3: Clean the profile and write it on insert**

In `createTrip`, just after `const country = input.country?.trim() || null` (~725), add the profile cleaning (mirrors `saveTripProfile`):

```ts
  const p = input.profile ?? EMPTY_TRIP_PROFILE
  const tripProfile = {
    idea: p.idea.trim().slice(0, 2000),
    transport: p.transport.filter((t) =>
      (TRIP_TRANSPORT as readonly string[]).includes(t),
    ),
    vibe: p.vibe.filter((v) => (TRIP_VIBES as readonly string[]).includes(v)),
  }
```

Then add `trip_profile: tripProfile` to the `.insert({...})` object for the trips table (the block starting `supabase.from("trips").insert({`):

```ts
  const { error: insertError } = await supabase.from("trips").insert({
    workspace_id: workspace.id,
    slug,
    name,
    country,
    start_date: startDate,
    end_date: endDate,
    fuzzy_when: fuzzyWhen,
    lat: input.lat,
    lng: input.lng,
    trip_profile: tripProfile,
    created_by: userData.user.id,
  })
```

- [ ] **Step 4: Seed categories from input (with fallback)**

Replace the current category-seed block (~767):

```ts
  const categoryRows = EXPENSE_CATEGORIES.map((name, i) => ({
    trip_id: tripRow.id,
    name,
    sort_order: i,
    created_by: userData.user.id,
  }))
```

with a version that builds from `input.categories`, cleaned and de-duplicated by name, falling back to the defaults:

```ts
  const rawCategories =
    input.categories && input.categories.length > 0
      ? input.categories
      : EXPENSE_CATEGORIES.map((name) => ({ name, details: [] as string[] }))

  const seen = new Set<string>()
  const cleanCategories: { name: string; details: string[] }[] = []
  for (const c of rawCategories) {
    const nm = c.name.trim()
    if (!nm || seen.has(nm)) continue
    seen.add(nm)
    const details = Array.from(
      new Set(c.details.map((d) => d.trim()).filter(Boolean)),
    ).slice(0, 20)
    cleanCategories.push({ name: nm, details })
  }
  if (cleanCategories.length === 0) {
    for (const name of EXPENSE_CATEGORIES) {
      cleanCategories.push({ name, details: [] })
    }
  }

  const categoryRows = cleanCategories.map((c, i) => ({
    trip_id: tripRow.id,
    name: c.name,
    sort_order: i,
    details: c.details,
    created_by: userData.user.id,
  }))
```

Leave the subsequent `.from("expense_categories").insert(categoryRows)` untouched.

- [ ] **Step 5: Validate**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: clean (no callers pass the new fields yet — they are optional, so existing call sites still type-check).

- [ ] **Step 6: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(create): createTrip persists profile + custom categories"
```

---

### Task 2: Extract shared presentational profile components

**Files:**
- Create: `src/app/trips/profile-fields.tsx`
- Modify: `src/app/trips/[slug]/profile-wizard.tsx` (remove local `OptionRow` + `CategoryRow`, import from the shared file)

**Interfaces:**
- Produces (from `src/app/trips/profile-fields.tsx`):
  - `OptionRow({ label: string; selected: boolean; onClick: () => void })`
  - `CategoryCard({ name: string; details: string[]; expanded: boolean; pending: boolean; onToggle: () => void; onRemove: () => void; onAddDetail: (item: string) => void; onRemoveDetail: (item: string) => void })`
- Consumes: nothing new.

- [ ] **Step 1: Create the shared file with `OptionRow` + `CategoryCard`**

Create `src/app/trips/profile-fields.tsx`. `OptionRow` is moved verbatim from the wizard; `CategoryCard` is the wizard's `CategoryRow` generalized to take `name`/`details` directly (no `ExpenseCategoryRow` / id dependency) so a not-yet-saved local category can render too.

```tsx
"use client"

import * as React from "react"

export function OptionRow({
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

/** One category card: a header (name toggles expand, times removes it) and,
 * when expanded, its detail tags as removable chips plus an add input. Owns the
 * add-detail input's text state. Presentational only — the caller supplies the
 * name/details and the mutation callbacks (live actions or local state). */
export function CategoryCard({
  name,
  details,
  expanded,
  pending,
  onToggle,
  onRemove,
  onAddDetail,
  onRemoveDetail,
}: {
  name: string
  details: string[]
  expanded: boolean
  pending: boolean
  onToggle: () => void
  onRemove: () => void
  onAddDetail: (item: string) => void
  onRemoveDetail: (item: string) => void
}) {
  const [detail, setDetail] = React.useState("")

  function add() {
    const t = detail.trim()
    if (!t || pending) return
    if (!details.includes(t)) onAddDetail(t)
    setDetail("")
  }

  return (
    <div className="rounded-xl border border-rule">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 text-left text-[15px] text-foreground"
        >
          {name}
          {details.length ? (
            <span className="ml-2 font-mono text-[11px] text-muted-foreground">
              {"·"} {details.length}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={pending}
          aria-label={`Delete ${name}`}
          className="font-mono text-[15px] text-muted-foreground hover:text-clay disabled:opacity-50"
        >
          {"×"}
        </button>
      </div>
      {expanded ? (
        <div className="border-t border-rule px-4 py-3">
          {details.length ? (
            <div className="flex flex-wrap gap-1.5">
              {details.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] tracking-[0.06em] text-foreground"
                >
                  {d}
                  <button
                    type="button"
                    onClick={() => onRemoveDetail(d)}
                    disabled={pending}
                    aria-label={`Remove ${d}`}
                    className="text-muted-foreground hover:text-clay disabled:opacity-50"
                  >
                    {"×"}
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <input
            type="text"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
            placeholder="add specific…"
            disabled={pending}
            className="mt-2 w-full rounded-lg border border-dashed border-rule bg-transparent px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Repoint the wizard to the shared components**

In `src/app/trips/[slug]/profile-wizard.tsx`:
1. Delete the local `OptionRow` function and the local `CategoryRow` function (the two presentational helpers at the bottom).
2. Add an import at the top: `import { CategoryCard, OptionRow } from "../profile-fields"`.
3. In `CategoryStep`, replace the `<CategoryRow ... />` usage with `<CategoryCard ... />`, passing `name={c.name}` and `details={c.details}` instead of `category={c}`:

```tsx
      {categories.map((c) => (
        <CategoryCard
          key={c.id}
          name={c.name}
          details={c.details}
          expanded={expandedId === c.id}
          pending={pending}
          onToggle={() =>
            setExpandedId((id) => (id === c.id ? null : c.id))
          }
          onRemove={() => removeCategory(c)}
          onAddDetail={(item) => saveDetails(c, [...c.details, item])}
          onRemoveDetail={(item) =>
            saveDetails(
              c,
              c.details.filter((d) => d !== item),
            )
          }
        />
      ))}
```

Leave the rest of `CategoryStep` (the add-category input row, `addCategory`/`removeCategory`/`saveDetails`) and `StepShell` unchanged.

- [ ] **Step 3: Validate**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: clean. The Profile tab renders and behaves exactly as before (pure component extraction).

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/profile-fields.tsx src/app/trips/[slug]/profile-wizard.tsx
git commit -m "refactor(profile): extract OptionRow + CategoryCard to shared profile-fields"
```

---

### Task 3: Local category editor for the create page

**Files:**
- Modify: `src/app/trips/profile-fields.tsx` (add `LocalCategory` type + `LocalCategoryEditor`)

**Interfaces:**
- Consumes: `CategoryCard` (Task 2).
- Produces:
  - `type LocalCategory = { name: string; details: string[] }`
  - `LocalCategoryEditor({ categories: LocalCategory[]; onChange: (next: LocalCategory[]) => void; disabled?: boolean })` — a controlled, browser-only category editor (add/remove category, add/remove detail tags) with no server calls.

- [ ] **Step 1: Append `LocalCategory` + `LocalCategoryEditor` to `profile-fields.tsx`**

```tsx
export type LocalCategory = { name: string; details: string[] }

/** Browser-only category editor used at create time (no trip row exists yet, so
 * nothing writes until the page's single submit). Controlled: the parent holds
 * the list; this manages the new-category input and which row is expanded. */
export function LocalCategoryEditor({
  categories,
  onChange,
  disabled = false,
}: {
  categories: LocalCategory[]
  onChange: (next: LocalCategory[]) => void
  disabled?: boolean
}) {
  const [name, setName] = React.useState("")
  const [expanded, setExpanded] = React.useState<number | null>(null)

  function addCategory() {
    const t = name.trim()
    if (!t || disabled) return
    if (categories.some((c) => c.name === t)) {
      setName("")
      return
    }
    onChange([...categories, { name: t, details: [] }])
    setName("")
  }

  function removeCategory(i: number) {
    onChange(categories.filter((_, idx) => idx !== i))
    setExpanded(null)
  }

  function setDetails(i: number, details: string[]) {
    onChange(categories.map((c, idx) => (idx === i ? { ...c, details } : c)))
  }

  return (
    <div className="flex flex-col gap-2">
      {categories.map((c, i) => (
        <CategoryCard
          key={`${c.name}-${i}`}
          name={c.name}
          details={c.details}
          expanded={expanded === i}
          pending={disabled}
          onToggle={() => setExpanded((e) => (e === i ? null : i))}
          onRemove={() => removeCategory(i)}
          onAddDetail={(item) => setDetails(i, [...c.details, item])}
          onRemoveDetail={(item) =>
            setDetails(
              i,
              c.details.filter((d) => d !== item),
            )
          }
        />
      ))}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addCategory()
            }
          }}
          placeholder="Add a category…"
          disabled={disabled}
          className="flex-1 rounded-xl border border-dashed border-rule bg-transparent px-4 py-3 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={addCategory}
          disabled={disabled || !name.trim()}
          className="rounded-xl border-0 bg-foreground px-4 py-3 font-mono text-[11px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          add
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Validate**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: clean (`LocalCategoryEditor` is not yet used — that's Task 4).

- [ ] **Step 3: Commit**

```bash
git add src/app/trips/profile-fields.tsx
git commit -m "feat(create): add browser-only LocalCategoryEditor"
```

---

### Task 4: Wire the profile section into the create form

**Files:**
- Modify: `src/app/trips/new/new-trip-form.tsx`

**Interfaces:**
- Consumes: `createTrip` (Task 1, now accepts `profile` + `categories`); `LocalCategory`, `LocalCategoryEditor`, `OptionRow` (Tasks 2-3); `EXPENSE_CATEGORIES` (`expense-types`); `TRIP_TRANSPORT`, `TRIP_VIBES` (`trip-profile-types`).

- [ ] **Step 1: Add imports**

At the top of `src/app/trips/new/new-trip-form.tsx`, add:

```ts
import {
  LocalCategoryEditor,
  OptionRow,
  type LocalCategory,
} from "../profile-fields"
import { EXPENSE_CATEGORIES } from "@/lib/trips/expense-types"
import { TRIP_TRANSPORT, TRIP_VIBES } from "@/lib/trips/trip-profile-types"
```

- [ ] **Step 2: Add profile state + a toggle helper**

Inside `NewTripForm`, alongside the existing `useState` calls, add:

```ts
  const [idea, setIdea] = React.useState("")
  const [categories, setCategories] = React.useState<LocalCategory[]>(
    EXPENSE_CATEGORIES.map((name) => ({ name, details: [] })),
  )
  const [transport, setTransport] = React.useState<string[]>([])
  const [vibe, setVibe] = React.useState<string[]>([])

  const toggle = (list: string[], set: (v: string[]) => void, tag: string) =>
    set(list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag])
```

- [ ] **Step 3: Pass profile + categories to `createTrip`**

In `submit`, extend the `createTrip({...})` call with two fields (keep the existing ones):

```ts
      const result = await createTrip({
        name,
        slug: displayedSlug,
        isDream,
        startDate: isDream ? null : startDate || null,
        endDate: isDream ? null : endDate || null,
        fuzzyWhen: isDream ? fuzzyWhen.trim() || null : null,
        country: country.trim() || null,
        lat: parseFloatOrNull(lat),
        lng: parseFloatOrNull(lng),
        profile: { idea, transport, vibe },
        categories,
      })
```

- [ ] **Step 4: Render the profile section**

Insert this block immediately after the closing `</label>` of the Country field and before the `advanced (lat / lng)` toggle button:

```tsx
      <div className="mt-8 border-t border-rule pt-6">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Profile · optional
        </span>

        <label className="mt-5 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Sum up this trip
          </span>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="e.g. 2 weeks surfing in Portugal"
            rows={3}
            disabled={isPending}
            className="mt-1 w-full resize-y rounded-lg border border-rule bg-transparent p-3 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>

        <div className="mt-5">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Categories
          </span>
          <div className="mt-2">
            <LocalCategoryEditor
              categories={categories}
              onChange={setCategories}
              disabled={isPending}
            />
          </div>
        </div>

        <div className="mt-5">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Getting around
          </span>
          <div className="mt-2 flex flex-col gap-2">
            {TRIP_TRANSPORT.map((t) => (
              <OptionRow
                key={t}
                label={t}
                selected={transport.includes(t)}
                onClick={() => toggle(transport, setTransport, t)}
              />
            ))}
          </div>
        </div>

        <div className="mt-5">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Vibe
          </span>
          <div className="mt-2 flex flex-col gap-2">
            {TRIP_VIBES.map((v) => (
              <OptionRow
                key={v}
                label={v}
                selected={vibe.includes(v)}
                onClick={() => toggle(vibe, setVibe, v)}
              />
            ))}
          </div>
        </div>
      </div>
```

- [ ] **Step 5: Validate**

Run: `pnpm lint && pnpm build`
Expected: clean. Then in-app (a logged-in session): create a trip and a dream with an idea, a removed/added category with a detail tag, and a couple of transport/vibe picks; confirm on the new trip the Profile tab overview shows the idea/transport/vibe and the Budget categories match what was entered.

- [ ] **Step 6: Commit**

```bash
git add src/app/trips/new/new-trip-form.tsx
git commit -m "feat(create): profile section (idea, categories, transport, vibe) on new trip"
```

---

### Task 5: Remove the now-dead onboarding baton

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx` (searchParams `onboarding`, prop pass ~341)
- Modify: `src/app/trips/[slug]/profile-tab.tsx` (`onboarding` prop, `editing` init)
- Modify: `src/app/trips/[slug]/profile-wizard.tsx` (`onboarding` prop, `save()` branch, final-button label)

**Interfaces:**
- Consumes: nothing.
- Produces: `ProfileTab` and `ProfileWizard` no longer accept an `onboarding` prop; `page.tsx` no longer reads/forwards it.

- [ ] **Step 1: `page.tsx`**

- In the `searchParams` type, drop `onboarding?: string` (leave `tab?: string`).
- Remove `onboarding` from the `const { tab, onboarding } = await searchParams` destructure (leave `tab`).
- Remove the `onboarding={onboarding === "1"}` prop from the `<ProfileTab ... />` usage (~341).

- [ ] **Step 2: `profile-tab.tsx`**

Remove the `onboarding` prop and initialize editing to `false`:

```tsx
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
```

And drop `onboarding={onboarding}` from the `<ProfileWizard ... />` usage.

- [ ] **Step 3: `profile-wizard.tsx`**

- Remove `onboarding = false,` from the props destructure and `onboarding?: boolean` from the prop type.
- In `save()`, delete the onboarding branch so it always does the normal path:

```ts
      setSaved(true)
      router.refresh()
      onDone?.()
```

- On the final button, drop the onboarding label branch:

```tsx
            {saving ? "saving…" : saved ? "saved" : "save profile"}
```

- [ ] **Step 4: Validate**

Run: `pnpm lint && pnpm build`
Expected: clean. Confirm no remaining references: `grep -rn "onboarding" src/` returns nothing (or only unrelated matches).

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/[slug]/page.tsx src/app/trips/[slug]/profile-tab.tsx src/app/trips/[slug]/profile-wizard.tsx
git commit -m "chore(profile): drop dead onboarding baton (create now does first-fill)"
```

---

## Docs wrap-up (after all tasks)

- [ ] Update `docs/TODO.md`: add a completed entry summarizing the merge (one screen, one save; createTrip persists profile + categories; Profile tab demoted; onboarding baton removed; no migration).
- [ ] Add a `docs/DECISIONS.md` row: "Trip profile captured at creation (one page, one save); create uses a browser-local category editor while Budget/Profile-tab stay live — accepted two-controller divergence behind shared row components."
- [ ] Commit the docs.
