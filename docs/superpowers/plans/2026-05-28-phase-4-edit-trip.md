# Phase 4 — Edit Trip / Promote Dream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per project memory, when each step has fully concrete code, default to inline execution rather than per-task subagent dispatch.

**Goal:** Add an `// edit trip` flow on `/trips/[slug]` that lets a workspace member rename, edit, promote (dream → trip), demote (trip → dream), and delete a trip — backed by two new Server Actions and one new route.

**Architecture:** New dedicated `/trips/[slug]/edit` route hosting an `EditTripForm` duplicated from `NewTripForm` (visible slug, delete button, no `slugDirty` auto-derive). Two new Server Actions in `src/lib/trips/actions.ts` (`updateTrip`, `deleteTrip`) that mirror `createTrip`'s validation. A small `// edit trip` link added to the trip hero on `src/app/trips/[slug]/page.tsx`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4, `@supabase/ssr` 0.10. No new dependencies. No new migrations (child tables already cascade on `DELETE FROM trips`, verified in spec).

**Spec:** `docs/superpowers/specs/2026-05-28-phase-4-edit-trip-design.md`

**Note on commits:** Per project pattern (see `git log`, e.g. Phase 4 dream pipeline: 5 feat commits + 1 docs commit), each task in this plan produces one commit. Task 4 is docs-only.

**Note on tests:** This project has no test suite yet (per `CLAUDE.md`: "There are no tests yet; do not invent a test command until one exists."). Validation per task is `pnpm lint && pnpm build`. Manual UI verification happens after Task 3.

**Note on the hero entry-point placement:** The spec proposed absolute-positioned top-right, but the existing hero's top row is a `flex justify-between` containing a back link and the `<Label>` — absolute positioning would collide. Task 3 places the `// edit trip` link inline next to the `<Label>` instead. Same visual area, just composed via flex.

---

### Task 1: Add `updateTrip` + `deleteTrip` Server Actions

**Files:**
- Modify: `src/lib/trips/actions.ts` (append two exports + one new import)

- [ ] **Step 1: Add `redirect` import**

At the top of `src/lib/trips/actions.ts`, add a new import line directly under the existing `import { revalidatePath } from "next/cache"` line:

```ts
import { redirect } from "next/navigation"
```

- [ ] **Step 2: Append `updateTrip` to the bottom of the file**

Append this block AFTER the existing `createTrip` function (last line of the current file is its closing `}`):

```ts
export interface UpdateTripInput {
  tripId: string
  currentSlug: string
  name: string
  slug: string
  isDream: boolean
  startDate: string | null
  endDate: string | null
  fuzzyWhen: string | null
  country: string | null
  lat: number | null
  lng: number | null
}

export interface UpdateTripResult {
  error?: string
  /** New slug on success; client routes to /trips/<slug>. */
  slug?: string
}

/**
 * Updates an existing trip in-place. Validation mirrors `createTrip` so the
 * schema invariant (dream rows have null dates + optional fuzzy_when; trip
 * rows have both dates set + fuzzy_when null) is enforced on edit too.
 * Returns `{ error }` on validation/DB failure; `{ slug }` on success so the
 * client can route to the (possibly renamed) trip page.
 */
export async function updateTrip(
  input: UpdateTripInput,
): Promise<UpdateTripResult> {
  const name = input.name.trim()
  if (!name) return { error: "Name required." }

  const slug = input.slug.trim()
  if (!SLUG_RE.test(slug)) {
    return { error: "Slug must be lowercase letters, numbers, hyphens." }
  }

  let startDate: string | null
  let endDate: string | null
  let fuzzyWhen: string | null

  if (input.isDream) {
    if (input.startDate || input.endDate) {
      return { error: "Dreams have no dates." }
    }
    startDate = null
    endDate = null
    fuzzyWhen = input.fuzzyWhen?.trim() || null
    if (fuzzyWhen && fuzzyWhen.length > 64) {
      return { error: "When? must be 64 characters or fewer." }
    }
  } else {
    if (!input.startDate || !input.endDate) {
      return { error: "Start and end dates required." }
    }
    if (input.endDate < input.startDate) {
      return { error: "End date must be on or after start date." }
    }
    if (input.fuzzyWhen) {
      return { error: "Trips don't have a 'when?' label." }
    }
    startDate = input.startDate
    endDate = input.endDate
    fuzzyWhen = null
  }

  const hasLat = input.lat !== null
  const hasLng = input.lng !== null
  if (hasLat !== hasLng) {
    return { error: "Coordinates invalid." }
  }
  if (hasLat) {
    if (!Number.isFinite(input.lat) || input.lat! < -90 || input.lat! > 90) {
      return { error: "Coordinates invalid." }
    }
    if (!Number.isFinite(input.lng) || input.lng! < -180 || input.lng! > 180) {
      return { error: "Coordinates invalid." }
    }
  }

  const supabase = await createClient()
  const country = input.country?.trim() || null

  const { error: updateError } = await supabase
    .from("trips")
    .update({
      name,
      slug,
      country,
      start_date: startDate,
      end_date: endDate,
      fuzzy_when: fuzzyWhen,
      lat: input.lat,
      lng: input.lng,
    })
    .eq("id", input.tripId)

  if (updateError) {
    if (updateError.code === "23505") {
      return { error: "A trip with that slug already exists." }
    }
    return { error: updateError.message }
  }

  revalidatePath("/home")
  revalidatePath(`/trips/${input.currentSlug}`)
  return { slug }
}
```

- [ ] **Step 3: Append `deleteTrip` to the bottom of the file**

After `updateTrip`, append:

```ts
/**
 * Permanently deletes a trip. Child tables (trip_members, packing_items,
 * expenses, itinerary_days) cascade automatically per the FKs declared in
 * the Phase 3 / 3.5 migrations. RLS enforces that the caller is a workspace
 * member of the trip.
 *
 * Throws on error (form-compatible like `settleUp`). On success, redirects
 * server-side to /home — the form caller does not need to handle navigation.
 */
export async function deleteTrip(
  tripId: string,
  currentSlug: string,
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from("trips").delete().eq("id", tripId)
  if (error) throw new Error(error.message)

  revalidatePath(`/trips/${currentSlug}`)
  revalidatePath("/home")
  redirect("/home")
}
```

- [ ] **Step 4: Verify lint + build**

Run: `pnpm lint && pnpm build`

Expected: both pass. There should be no unused-var warning (the `_currentSlug` becomes `currentSlug` and is actually used in the `revalidatePath` call).

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(trips): updateTrip + deleteTrip server actions"
```

---

### Task 2: Create `/trips/[slug]/edit` route + form

**Files:**
- Create: `src/app/trips/[slug]/edit/page.tsx`
- Create: `src/app/trips/[slug]/edit/edit-trip-form.tsx`

- [ ] **Step 1: Create the route's page file**

Create `src/app/trips/[slug]/edit/page.tsx` with this exact content:

```tsx
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { Label } from "@/components/together"
import { createClient } from "@/lib/supabase/server"
import { getTripBySlug } from "@/lib/trips/queries"
import { getCurrentWorkspace } from "@/lib/workspace/queries"

import { EditTripForm } from "./edit-trip-form"

export default async function EditTripPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect(`/signin?next=/trips/${slug}/edit`)

  const workspace = await getCurrentWorkspace()
  if (!workspace) notFound()

  const trip = await getTripBySlug(workspace.id, slug)
  if (!trip) notFound()

  return (
    <main className="mx-auto min-h-screen w-full max-w-[440px] bg-background px-5 pt-10 pb-20">
      <Link
        href={`/trips/${slug}`}
        className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden>‹</span>
        <span>back to trip</span>
      </Link>
      <Label className="mt-6">Together · Edit trip</Label>
      <hr className="mt-3 border-rule" />
      <EditTripForm
        tripId={trip.id}
        initial={{
          name: trip.name,
          slug: trip.slug,
          isDream: trip.startDate === null,
          startDate: trip.startDate,
          endDate: trip.endDate,
          fuzzyWhen: trip.fuzzyWhen,
          country: trip.country,
          lat: trip.lat,
          lng: trip.lng,
        }}
      />
    </main>
  )
}
```

- [ ] **Step 2: Create the edit form component**

Create `src/app/trips/[slug]/edit/edit-trip-form.tsx` with this exact content:

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { deleteTrip, updateTrip } from "@/lib/trips/actions"

const SLUG_RE = /^[a-z0-9-]+$/

function parseFloatOrNull(s: string): number | null {
  const trimmed = s.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export interface EditTripInitial {
  name: string
  slug: string
  isDream: boolean
  startDate: string | null
  endDate: string | null
  fuzzyWhen: string | null
  country: string | null
  lat: number | null
  lng: number | null
}

export function EditTripForm({
  tripId,
  initial,
}: {
  tripId: string
  initial: EditTripInitial
}) {
  const router = useRouter()
  const [name, setName] = React.useState(initial.name)
  const [slug, setSlug] = React.useState(initial.slug)
  const [isDream, setIsDream] = React.useState(initial.isDream)
  const [startDate, setStartDate] = React.useState(initial.startDate ?? "")
  const [endDate, setEndDate] = React.useState(initial.endDate ?? "")
  const [fuzzyWhen, setFuzzyWhen] = React.useState(initial.fuzzyWhen ?? "")
  const [country, setCountry] = React.useState(initial.country ?? "")
  const [advancedOpen, setAdvancedOpen] = React.useState(
    initial.lat !== null || initial.lng !== null,
  )
  const [lat, setLat] = React.useState(
    initial.lat === null ? "" : String(initial.lat),
  )
  const [lng, setLng] = React.useState(
    initial.lng === null ? "" : String(initial.lng),
  )
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const canSubmit =
    name.trim().length > 0 && SLUG_RE.test(slug.trim()) && !isPending

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    startTransition(async () => {
      const result = await updateTrip({
        tripId,
        currentSlug: initial.slug,
        name,
        slug: slug.trim(),
        isDream,
        startDate: isDream ? null : startDate || null,
        endDate: isDream ? null : endDate || null,
        fuzzyWhen: isDream ? fuzzyWhen.trim() || null : null,
        country: country.trim() || null,
        lat: parseFloatOrNull(lat),
        lng: parseFloatOrNull(lng),
      })
      if (result.error) {
        setError(result.error)
        return
      }
      router.push(`/trips/${result.slug}`)
    })
  }

  return (
    <>
      <form onSubmit={submit} className="mt-6">
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={isDream}
            onChange={(e) => setIsDream(e.target.checked)}
            disabled={isPending}
            className="h-4 w-4 accent-foreground disabled:opacity-50"
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            This is a dream (no dates yet)
          </span>
        </label>

        <label className="mt-5 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Where to?"
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[16px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>

        <label className="mt-5 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Slug
          </span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="iceland-ring-road"
            disabled={isPending}
            className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
          <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
            URL: /trips/{slug || "—"}
          </span>
        </label>

        {isDream ? (
          <label className="mt-5 block">
            <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              When?
            </span>
            <input
              type="text"
              value={fuzzyWhen}
              onChange={(e) => setFuzzyWhen(e.target.value)}
              placeholder="summer 2030, someday, ..."
              maxLength={64}
              disabled={isPending}
              className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            />
          </label>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-4">
            <label className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Start
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isPending}
                className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
            <label className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                End
              </span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={isPending}
                className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
          </div>
        )}

        <label className="mt-5 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Country
          </span>
          <input
            type="text"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="Optional"
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>

        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          disabled={isPending}
          className="mt-5 inline-flex items-center gap-1 border-0 bg-transparent font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
          aria-expanded={advancedOpen}
        >
          <span>{advancedOpen ? "▾" : "›"}</span>
          <span>advanced (lat / lng)</span>
        </button>

        {advancedOpen ? (
          <div className="mt-3 grid grid-cols-2 gap-4">
            <label className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Latitude
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="-8.6500"
                disabled={isPending}
                className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
            <label className="block">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Longitude
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="116.3200"
                disabled={isPending}
                className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
            </label>
          </div>
        ) : null}

        {error ? (
          <div className="mt-5 font-mono text-[10px] text-clay">{error}</div>
        ) : null}

        <div className="mt-7 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            disabled={isPending}
            className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {isPending ? "…" : "save changes"}
          </button>
        </div>
      </form>

      <hr className="mt-10 border-rule" />
      <form
        action={deleteTrip.bind(null, tripId, initial.slug)}
        onSubmit={(e) => {
          if (
            !window.confirm(
              "Delete this trip? Packing list, expenses, and itinerary will be removed.",
            )
          ) {
            e.preventDefault()
          }
        }}
        className="mt-4 flex items-center justify-between"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          / danger
        </span>
        <button
          type="submit"
          disabled={isPending}
          className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-clay hover:text-foreground disabled:opacity-40"
        >
          // delete trip
        </button>
      </form>
    </>
  )
}
```

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint && pnpm build`

Expected: both pass. The new route will appear in the build output as `/trips/[slug]/edit` (dynamic, ƒ).

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/[slug]/edit/page.tsx src/app/trips/[slug]/edit/edit-trip-form.tsx
git commit -m "feat(trips): /trips/[slug]/edit route"
```

---

### Task 3: Add `// edit trip` link in trip hero

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx` (`TripHeaderView` function, lines 215–281)

- [ ] **Step 1: Modify the mobile top row to include the edit link**

In `src/app/trips/[slug]/page.tsx`, find the existing `TripHeaderView` block:

```tsx
      <div className="relative mb-6 flex items-center justify-between lg:hidden">
        <Link
          href="/home"
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          <Chevron dir="left" /> back
        </Link>
        <Label>{isDream ? "Dream" : `Trip · ${tripCount}`}</Label>
      </div>
```

Replace it with:

```tsx
      <div className="relative mb-6 flex items-center justify-between lg:hidden">
        <Link
          href="/home"
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          <Chevron dir="left" /> back
        </Link>
        <div className="flex items-center gap-3">
          <Label>{isDream ? "Dream" : `Trip · ${tripCount}`}</Label>
          <Link
            href={`/trips/${header.slug}/edit`}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            // edit trip
          </Link>
        </div>
      </div>
```

- [ ] **Step 2: Modify the desktop label row to include the edit link**

In the same `TripHeaderView`, find:

```tsx
      <div className="relative hidden lg:block lg:mb-2">
        <Label>{isDream ? "Dream" : `Trip · ${tripCount}`}</Label>
      </div>
```

Replace it with:

```tsx
      <div className="relative hidden lg:mb-2 lg:flex lg:items-center lg:justify-between">
        <Label>{isDream ? "Dream" : `Trip · ${tripCount}`}</Label>
        <Link
          href={`/trips/${header.slug}/edit`}
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          // edit trip
        </Link>
      </div>
```

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint && pnpm build`

Expected: both pass. Verify the route table in build output still lists `ƒ /trips/[slug]` and `ƒ /trips/[slug]/edit`.

- [ ] **Step 4: Manual UI verification (Lombok + a dream)**

The dev server should still be running from earlier in the session (`pnpm dev` on http://localhost:3000). If not, start it.

1. Navigate to `http://localhost:3000/trips/lombok` — confirm the `// edit trip` link appears next to the `Trip · NN of NN` label, top-right of the hero. Click it.
2. On `/trips/lombok/edit` — confirm fields are pre-populated (name "Lombok", slug "lombok", dates filled, country "Indonesia", advanced section open with lat/lng).
3. Change the country to "Indonesia (test)" and click `save changes` — should navigate back to `/trips/lombok` and show the new country in the hero.
4. Revert the country.
5. Navigate to `/trips/faroe-islands` (or any seeded dream). Confirm:
   - Hero shows `Dream` label + `// edit trip` link
   - On `/trips/faroe-islands/edit`, the `is a dream` checkbox is checked, the `When?` field shows "someday", no date fields.
6. **Do not** test delete on a seeded row unless you're prepared to re-seed. Optionally: create a throwaway trip via `/trips/new`, edit it, then delete it to verify the redirect to `/home`.

If any step fails, fix before committing.

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/[slug]/page.tsx
git commit -m "feat(trips): edit-trip link in trip hero"
```

---

### Task 4: Docs (TODO + DECISIONS)

**Files:**
- Modify: `docs/TODO.md` (Phase 4 section, "Carried into the next Phase 4 slice" subsection)
- Modify: `docs/DECISIONS.md` (append new rows)

- [ ] **Step 1: Update `docs/TODO.md`**

In `docs/TODO.md`, find the section header:

```
### Carried into the next Phase 4 slice (post-trip)
- **Promote-a-dream / edit-a-trip flow.** A `// edit trip` action on `/trips/[slug]` that adds dates to a dream (promoting it) or changes dates / country / name on a trip. Mechanically simple (one UPDATE) but UX-shaped enough to deserve its own slice. Until then, promotion is manual via the Supabase Table Editor.
```

Replace ONLY the `Promote-a-dream / edit-a-trip flow.` bullet with a checked entry under the existing Phase 4 task list, AND remove it from the "Carried" section. The new entry goes at the end of the existing Phase 4 task list (after task 5), and reads:

```
- [x] **6. Edit trip / promote dream** — Done 2026-05-28. New `/trips/[slug]/edit` route with `EditTripForm` duplicated from `NewTripForm` — visible slug field (no auto-derive), all baseline fields editable, native `confirm()`-gated delete at bottom. Two new Server Actions in `src/lib/trips/actions.ts`: `updateTrip` (mirrors `createTrip` validation so the dream/trip invariant holds on edits too; surfaces `23505` slug collisions as a friendly error; revalidates `/home` + old trip path; returns the new slug so the client can route post-rename) and `deleteTrip` (cascades via existing FKs; server-side `redirect('/home')`). Promotion is implicit: uncheck `is a dream`, fill dates, save. Demotion is symmetric. Entry-point is a small `// edit trip` link in the trip hero (mobile: inline with the `Trip · NN of NN` label; desktop: right-aligned in the lg label row). Spec: `docs/superpowers/specs/2026-05-28-phase-4-edit-trip-design.md`. Plan: `docs/superpowers/plans/2026-05-28-phase-4-edit-trip.md`.
```

Then update the "Carried into the next Phase 4 slice" section by REMOVING the `Promote-a-dream / edit-a-trip flow.` bullet (the **Itinerary support for dreams** bullet stays).

Finally, update the "Current Phase" line at the top of the file from:

```
**Phase 4 — Dream-Trip Pipeline: code shipped 2026-05-28 (pending Supabase migration paste).** Dreams and trips now live in one `trips` table distinguished by whether dates are set. ...
```

to:

```
**Phase 4 — Dream-Trip Pipeline + Edit Trip: code shipped 2026-05-28 (pending Supabase migration paste for the dream-trip pipeline portion).** Dreams and trips now live in one `trips` table distinguished by whether dates are set. `/home` is a real query (Hero / Trips / Dreams / Past bands). `+ new trip` form has a "this is a dream" toggle with a free-text `When?` field. `/trips/[slug]` renders a dream variant when dates are NULL. `/trips/[slug]/edit` lets a workspace member rename, edit, promote/demote, or delete a trip. Six slices in six commits (`0139052..` + edit-trip slice). **User action required**: paste `supabase/migrations/20260528000001_phase_4_dreams.sql` then `20260528000002_seed_dreams.sql` into the Supabase SQL Editor.
```

- [ ] **Step 2: Update `docs/DECISIONS.md`**

`DECISIONS.md` is a 3-column markdown table: `| Decision | Why | Date |`. Append these four rows at the end of the table (after the last existing row, the `+ new trip` route decision dated 2026-05-28):

```markdown
| **Duplicate `NewTripForm` into `EditTripForm`**, not factor a shared `TripForm` | Edit and create diverge non-trivially: visible-slug field, dropped `slugDirty` auto-derive, delete affordance, different submit copy ("save changes" vs. "create trip / save dream"), pre-populated defaults. A polymorphic `mode: "create" \| "edit"` prop would proliferate conditionals. Two-file duplication is cheaper than that abstraction; factor when a third trip form appears. | 2026-05-28 |
| **No slug-history table** for renamed trips | When the slug changes via `/trips/[slug]/edit`, the old URL 404s. Acceptable today — no external trip-URL sharing exists. Add a slug-history table or `permalink` column if/when external sharing becomes a thing. | 2026-05-28 |
| **Native `window.confirm()` for trip deletion** | No Dialog primitive exists in the app yet; introducing one for a single destructive action is over-engineering. Trade-off accepted: native dialog is unstyled. | 2026-05-28 |
| **No role gate on `updateTrip` / `deleteTrip`** | Any workspace member can edit or delete any trip in the workspace; RLS membership is the only gate. In a 2-person workspace a role gate is pointless friction. Revisit if/when workspaces grow. | 2026-05-28 |
```

Note the escaped `\|` inside the first row's `"create" \| "edit"` snippet — required so the literal pipe doesn't end the table cell.

- [ ] **Step 3: Verify the docs edits are correct**

Run: `git diff docs/TODO.md docs/DECISIONS.md`

Skim the diff. Confirm:
- TODO.md: task 6 added under Phase 4, "Promote-a-dream / edit-a-trip flow" bullet removed from "Carried", "Current Phase" line updated.
- DECISIONS.md: four new rows appended, format matching the file's existing convention.

- [ ] **Step 4: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: phase 4 edit-trip slice complete"
```

---

## Self-review checklist (already done during plan-writing)

- **Spec coverage:** Every section of the spec maps to a task.
  - Spec § "Route + form" → Task 2
  - Spec § "Server Actions" → Task 1
  - Spec § "Entry point" → Task 3
  - Spec § "Delete UX" → Task 2 (form bottom) + Task 1 (`deleteTrip`)
  - Spec § "Auth / membership" → no application code; covered by RLS, no task needed
  - Spec § "Decisions worth a DECISIONS.md row" → Task 4
- **Placeholder scan:** All steps have concrete code or commands. No "TBD", "TODO", or vague phrasing.
- **Type consistency:** `UpdateTripInput.tripId` (Task 1) === `EditTripForm` `tripId` prop (Task 2) === `header.id` passed in (Task 3 unaffected). `UpdateTripInput.currentSlug` === `initial.slug` (form) === `header.slug` (page). `UpdateTripResult.slug` === what the form `router.push`es to.
- **Spec deviation:** Task 3 notes the hero entry-point uses inline flex instead of absolute positioning, with reason. Spec is a guideline; this is a small implementation refinement.
