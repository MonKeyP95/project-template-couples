# `+ new trip` Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inert dashed `+ new trip` button on `/home` with a dedicated `/trips/new` route hosting a form that inserts into `trips` + `trip_members` and redirects to `/trips/[slug]`. Carry a small graceful-empty branch in `budget-tab.tsx` so trips without a planned budget look clean.

**Architecture:** A new `"use client"` component `NewTripForm` owns form state. It calls a new Server Action `createTrip` which validates, inserts the trip + N `trip_members` rows for the current workspace, and returns `{ slug }` on success so the client can `router.push('/trips/' + slug)`. The page route is a thin Server Component that auth-guards and renders the form. Slug auto-derives from name via a small pure helper, with a `slugDirty` flag stopping the auto-update once the user edits the slug.

**Tech Stack:** Next.js 16 App Router, React 19 (`useState` + `useTransition` + `useMemo` + `useRef`), Server Actions, `@supabase/ssr`, Tailwind v4. Spec: `docs/superpowers/specs/2026-05-27-phase-3-5-new-trip-form-design.md`.

**Validation approach (this codebase):** there is no test runner yet. Each task is validated with `pnpm lint` + `pnpm build` and finishes with a manual phone-viewport walkthrough at Task 7. Matches how `+ add packing item` (2026-05-27) and `+ log expense` (2026-05-27) shipped.

---

### Task 1: Slugify helper

**Files:**
- Create: `src/lib/trips/slugify.ts`

- [ ] **Step 1: Create the helper**

Write the full contents of `src/lib/trips/slugify.ts`:

```ts
/**
 * Turn a free-form trip name into a URL-safe slug. Lowercase, strips
 * combining diacritics, collapses anything non-[a-z0-9] into single hyphens,
 * and trims leading/trailing hyphens. Pure: same input → same output.
 *
 * Examples:
 *   "Iceland ring road"     → "iceland-ring-road"
 *   "São Paulo 2027"        → "sao-paulo-2027"
 *   "  ---tokyo---  "       → "tokyo"
 *   ""                      → ""
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors (pure addition).

- [ ] **Step 3: Type-check via build**

Run: `pnpm build`
Expected: build succeeds. (No consumers yet; this just confirms the file parses.)

---

### Task 2: `createTrip` Server Action

**Files:**
- Modify: `src/lib/trips/actions.ts`

- [ ] **Step 1: Add types and the action**

Append to `src/lib/trips/actions.ts` (at the end of the file, after `settleUp`):

```ts
import { getCurrentWorkspace } from "@/lib/workspace/queries"

export interface CreateTripInput {
  name: string
  slug: string
  startDate: string | null
  endDate: string | null
  country: string | null
  lat: number | null
  lng: number | null
}

export interface CreateTripResult {
  error?: string
  /** Populated on success. Client navigates to /trips/<slug>. */
  slug?: string
}

const SLUG_RE = /^[a-z0-9-]+$/

/**
 * Creates a trip in the current workspace plus a trip_members row for every
 * workspace member. Returns `{ error }` on validation / DB failure so the form
 * can surface the message inline; returns `{ slug }` on success and lets the
 * client route to /trips/<slug>.
 */
export async function createTrip(
  input: CreateTripInput,
): Promise<CreateTripResult> {
  const name = input.name.trim()
  if (!name) return { error: "Name required." }

  const slug = input.slug.trim()
  if (!SLUG_RE.test(slug)) {
    return { error: "Slug must be lowercase letters, numbers, hyphens." }
  }

  if (
    input.startDate &&
    input.endDate &&
    input.endDate < input.startDate
  ) {
    return { error: "End date must be on or after start date." }
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

  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "No workspace." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const country = input.country?.trim() || null

  const { error: insertError } = await supabase.from("trips").insert({
    workspace_id: workspace.id,
    slug,
    name,
    country,
    start_date: input.startDate,
    end_date: input.endDate,
    lat: input.lat,
    lng: input.lng,
    created_by: userData.user.id,
  })

  if (insertError) {
    if (insertError.code === "23505") {
      return { error: "A trip with that slug already exists." }
    }
    return { error: insertError.message }
  }

  const { data: tripRow, error: lookupError } = await supabase
    .from("trips")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("slug", slug)
    .maybeSingle()
  if (lookupError || !tripRow) {
    return { error: lookupError?.message ?? "Trip not found after insert." }
  }

  const memberRows = workspace.members.map((m) => ({
    trip_id: tripRow.id,
    user_id: m.user_id,
    role: "member" as const,
  }))
  const { error: membersError } = await supabase
    .from("trip_members")
    .insert(memberRows)
  if (membersError) return { error: membersError.message }

  return { slug }
}
```

The `createClient` import at the top of the file already exists; the `getCurrentWorkspace` import is new — add it at the top of the import block (after the other `@/lib/...` import).

Notes on the design:
- We insert the trip first, then look it up by `(workspace_id, slug)` to get the id. Supabase's `.insert(...).select().single()` is the more idiomatic shape, but a fresh-after-insert select keeps the action's two error branches obvious (insert vs. trip_members).
- We do NOT re-slugify on the server. The client owns slug derivation; the server only validates the regex. This keeps `slugify.ts` a client-only helper.
- `role: "member"` for everyone — the trip-level role is currently unused by anything in the app; we record it for forward-compat with the seed pattern.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Type-check via build**

Run: `pnpm build`
Expected: build succeeds. (No consumers yet — guards against import path / TS errors before wiring the UI.)

---

### Task 3: `NewTripForm` client component

**Files:**
- Create: `src/app/trips/new/new-trip-form.tsx`

- [ ] **Step 1: Create the file**

Write the full contents:

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { createTrip } from "@/lib/trips/actions"
import { slugify } from "@/lib/trips/slugify"

const SLUG_RE = /^[a-z0-9-]+$/

function parseFloatOrNull(s: string): number | null {
  const trimmed = s.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export function NewTripForm() {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [slugDirty, setSlugDirty] = React.useState(false)
  const [startDate, setStartDate] = React.useState("")
  const [endDate, setEndDate] = React.useState("")
  const [country, setCountry] = React.useState("")
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [lat, setLat] = React.useState("")
  const [lng, setLng] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const nameRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const derivedSlug = React.useMemo(() => slugify(name), [name])
  const displayedSlug = slugDirty ? slug : derivedSlug

  const canSubmit =
    name.trim().length > 0 &&
    SLUG_RE.test(displayedSlug) &&
    !isPending

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    startTransition(async () => {
      const result = await createTrip({
        name,
        slug: displayedSlug,
        startDate: startDate || null,
        endDate: endDate || null,
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
    <form onSubmit={submit} className="mt-6">
      <label className="block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Name
        </span>
        <input
          ref={nameRef}
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
          value={displayedSlug}
          onChange={(e) => {
            setSlug(e.target.value)
            setSlugDirty(true)
          }}
          placeholder="iceland-ring-road"
          disabled={isPending}
          className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
          URL: /trips/{displayedSlug || "—"}
        </span>
      </label>

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
          {isPending ? "…" : "create trip"}
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build succeeds. (No consumers yet — confirms TS / import wiring is sound.)

---

### Task 4: `/trips/new` route

**Files:**
- Create: `src/app/trips/new/page.tsx`

- [ ] **Step 1: Create the route**

Write the full contents of `src/app/trips/new/page.tsx`:

```tsx
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { Label } from "@/components/together"
import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"

import { NewTripForm } from "./new-trip-form"

export default async function NewTripPage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/trips/new")

  const workspace = await getCurrentWorkspace()
  if (!workspace) notFound()

  return (
    <main className="mx-auto min-h-screen w-full max-w-[440px] bg-background px-5 pt-10 pb-20">
      <Link
        href="/home"
        className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden>‹</span>
        <span>home</span>
      </Link>
      <Label className="mt-6">Together · New trip</Label>
      <hr className="mt-3 border-rule" />
      <NewTripForm />
    </main>
  )
}
```

Notes:
- The back link is inlined rather than a new primitive — only one use site, matches the spec's "don't add a primitive for one use site."
- Page is auth-guarded inline (no `redirect()` from the action) so the unauthenticated case is a clean redirect, not a useless render.
- `notFound()` is the right fallthrough when a signed-in user has no workspace — same shape used by `/trips/[slug]`.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build succeeds. The route list should now include `ƒ /trips/new`.

---

### Task 5: Wire `/home` dashed button to `/trips/new`

**Files:**
- Modify: `src/app/home/page.tsx`

- [ ] **Step 1: Locate the current button**

The button currently lives near the bottom of `src/app/home/page.tsx` — search for the literal text `+ new trip`. It looks like:

```tsx
<button
  type="button"
  className="mt-7 flex w-full items-center justify-between rounded-[10px] border border-dashed border-rule bg-transparent px-4 py-3.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground md:mt-9 md:max-w-[280px] md:px-5 md:py-5"
>
  <span>+ new trip</span>
  <Chevron />
</button>
```

- [ ] **Step 2: Replace with a Link**

Replace the `<button>…</button>` block with:

```tsx
<Link
  href="/trips/new"
  className="mt-7 flex w-full items-center justify-between rounded-[10px] border border-dashed border-rule bg-transparent px-4 py-3.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground md:mt-9 md:max-w-[280px] md:px-5 md:py-5"
>
  <span>+ new trip</span>
  <Chevron />
</Link>
```

The classes are byte-identical. `Link` from `next/link` is already imported in this file (it's used for `/trips/lombok`). No new imports needed.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: build succeeds.

---

### Task 6: Graceful-empty branch in `budget-tab.tsx`

**Files:**
- Modify: `src/app/trips/[slug]/budget-tab.tsx`

- [ ] **Step 1: Replace `BudgetHeader` wholesale**

In `src/app/trips/[slug]/budget-tab.tsx`, replace the existing `BudgetHeader` function (lines ~112–149) with this version. The only change is a `hasPlanned` branch around the `/ €planned` text, the `<Bar>`, and the `"X% of planned"` row.

```tsx
function BudgetHeader({
  tripName,
  totalCents,
  plannedBudgetCents,
  leftCents,
  pct,
}: {
  tripName: string
  totalCents: number
  plannedBudgetCents: number
  leftCents: number
  pct: number
}) {
  const hasPlanned = plannedBudgetCents > 0
  return (
    <div className="relative overflow-hidden bg-dusk-tint px-5 pt-6 pb-4">
      <TopoBg tone="sea" opacity={0.1} />
      <div className="relative">
        <Label>Budget · {tripName}</Label>
        <div className="mt-2 flex items-baseline gap-1">
          <span className="t-display text-[22px] text-muted-foreground">€</span>
          <span className="t-display t-num text-[42px] leading-none text-foreground">
            {fmt(totalCents)}
          </span>
          {hasPlanned ? (
            <span className="t-display text-[22px] text-muted-foreground">
              {" "}/ €{fmt(plannedBudgetCents)}
            </span>
          ) : null}
        </div>
        {hasPlanned ? (
          <>
            <div className="mt-3">
              <Bar pct={pct} tone="sea" />
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
              <span>{pct}% of planned</span>
              <span>€{fmt(leftCents)} left</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Spot-check Lombok regression**

Open `src/lib/trips/fixtures.ts` and confirm `LOMBOK_DETAIL.plannedBudgetCents` is still `280000`. (It should be — this task didn't touch fixtures.) Lombok's budget tab will still render with the planned-cap bar at €2,800 during the walkthrough in Task 7.

---

### Task 7: Manual phone-viewport walkthrough

**Files:** none — runtime verification only.

- [ ] **Step 1: Start dev server**

Run: `pnpm dev`
Expected: server up on http://localhost:3000.

- [ ] **Step 2: Walk the new-trip happy path**

Open `/home` in a 390px viewport (DevTools → device toolbar → iPhone 14). Sign in if redirected. Confirm:

- The dashed `+ new trip` button is still styled the same.
- Tap it → URL becomes `/trips/new`; the Name input is focused.
- Type `Iceland ring road` → slug field live-fills to `iceland-ring-road`.
- Set Start `2026-08-12`, End `2026-08-22`, Country `Iceland`. Leave advanced collapsed.
- Tap `create trip` → spinner `…` briefly, then redirected to `/trips/iceland-ring-road`.
- The trip page renders: hero with "Iceland ring road", no coord string (lat/lng null), date range "Aug 12 – Aug 22".
- Itinerary tab shows the "Arriving soon" stub (no `itinerary_days` rows).
- Packing tab renders the hero (`0 / 0`, `0% ready`, the days-out label based on Start) and the suggestion card at the bottom — but NO category groups (since no items exist) and therefore NO `+ add item` row. **Known limitation:** adding the first packing item to a fresh trip is out of scope for this task per the spec's non-goals; today it requires SQL. The view itself rendering cleanly without errors is the acceptance criterion.
- Budget tab shows `€0.00` with **no** planned-cap bar (graceful-empty branch), settle-up `All square.`, no ledger rows, the `+ log expense` row visible at the bottom. Tap `+ log expense`, log a €10 Food expense → row appears, total updates to `€10.00`, still no planned-cap bar. Confirms the new trip's budget flow works end-to-end despite the lack of a planned budget.

- [ ] **Step 3: Walk the edge cases**

- Back to `/home`, tap `+ new trip` again. Type a name `Iceland ring road` (a duplicate of the trip you just made). Tap `create trip` → inline error `"A trip with that slug already exists."` appears in clay; the form stays mounted with all fields intact.
- Edit the slug field to `iceland-2027` → the auto-derive stops; further name edits no longer change the slug. Resubmit → succeeds, redirects to `/trips/iceland-2027`.
- Back to `/home`, tap `+ new trip`. Submit with empty name → submit button is disabled (no network call).
- Type a name. Set Start `2026-08-22`, End `2026-08-12` (end before start). Submit → inline error `"End date must be on or after start date."`.
- Fix the dates. Open advanced. Type lat `999` (out of range) → submit → inline error `"Coordinates invalid."`.
- Clear lat, leave lng filled → submit → inline error `"Coordinates invalid."` (pair mismatch).
- Both empty → succeeds.
- Tap `cancel` instead of submitting → returns to `/home` via `router.back()`.

- [ ] **Step 4: Lombok regression**

Visit `/trips/lombok?tab=budget` → confirm the planned-cap `Bar` is still there at €2,800 and `"X% of planned"` line still reads. The graceful-empty branch only fires when `plannedBudgetCents === 0`.

- [ ] **Step 5: Auth gate**

Sign out (footer link on `/home`). Visit `/trips/new` directly. Expected: redirect to `/signin?next=/trips/new`.

- [ ] **Step 6: Type-safety + lint final pass**

Stop the dev server. Run: `pnpm lint && pnpm build`
Expected: both clean.

---

### Task 8: Update TODO + DECISIONS, commit

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Check off TODO item 3**

In `docs/TODO.md`, change the line for Phase 3.5 task 3 from `[ ]` to `[x]` and append a "Done YYYY-MM-DD" annotation — same shape as task-1 and task-2 annotations already there.

Suggested annotation (adapt the date to the actual ship date):

> **3. `+ new trip` (form)** — Done 2026-05-27. New Server Action `createTrip(input)` in `src/lib/trips/actions.ts` validates name/slug/dates/coords, inserts a `trips` row + N `trip_members` rows for every workspace member, and returns `{ slug }` on success. New `/trips/new` route (`src/app/trips/new/page.tsx`) hosts a `"use client"` `NewTripForm` component: name, slug (auto-derived from name via `src/lib/trips/slugify.ts`, with a `slugDirty` override), start/end dates (native pickers), country, and a `› advanced` disclosure for lat/lng. On success the client `router.push`es to `/trips/<slug>`. The dashed `+ new trip` button on `/home` is now a `<Link>` to the route — same classes, byte-identical visual. `budget-tab.tsx` gained a graceful-empty branch: when `plannedBudgetCents === 0` it hides the planned-cap `<Bar>`, the `/ €0.00` text, and the `"X% of planned"` line. Lombok unaffected (still €2,800 from fixtures). Build + lint clean. **Phase 3.5 complete.**

Also update the "Current Phase" line at the top of `docs/TODO.md` to reflect Phase 3.5 being complete. Suggested wording:

> **Phase 3.5 — Basic CRUD: COMPLETE 2026-05-27.** All three add-flows shipped (packing item, log expense, new trip). The app is now field-testable end-to-end for the Lombok trip (Jun 12) — partners can add packing items, log expenses, and create additional trips without SQL. Next is Phase 4 (see `docs/PLAN.md`).

- [ ] **Step 2: Add a DECISIONS row**

Append a row to `docs/DECISIONS.md` in the existing table format (insert directly above the `Build iteratively in small steps` row at the bottom of the table). Wording:

> **`+ new trip` lives on a dedicated `/trips/new` route, not inline on `/home`** | Inline expansion (the pattern from `+ add packing item` and `+ log expense`) was designed for short forms inside a contextual frame (a category row, a budget tab). `/home`'s `+ new trip` button has no such frame — it sits below a greeting, Upcoming card, and Dream board. A focused page sidesteps layout fights at all three breakpoints (390 / md / lg) and matches the one-shot redirect rhythm of "create then leave." The form component is portable; moving to inline-on-home or a shadcn dialog later only changes the shell. | 2026-05-27

And a second row for the budget-tab graceful-empty branch:

> **Graceful-empty budget header instead of a `planned_budget_cents` column on `trips`** | The Phase 3.5 TODO scoped fields to `name / slug / dates / country / optional lat/lng`. Adding a planned-budget column + form field is real schema work for a value most newly-created trips won't have at creation time anyway. `budget-tab.tsx` instead branches on `plannedBudgetCents === 0`: hide the planned-cap `<Bar>`, the `/ €planned` text, and the `"X% of planned"` line. Lombok keeps its €2,800 hardcoded in `fixtures.ts` until a future task moves it to the row. | 2026-05-27

- [ ] **Step 3: Stage and commit**

Run:

```bash
git add src/lib/trips/slugify.ts src/lib/trips/actions.ts "src/app/trips/new/page.tsx" "src/app/trips/new/new-trip-form.tsx" src/app/home/page.tsx "src/app/trips/[slug]/budget-tab.tsx" docs/TODO.md docs/DECISIONS.md
```

Then create the commit (HEREDOC to preserve the multi-line message):

```bash
git commit -m "$(cat <<'EOF'
feat(trips): + new trip form at /trips/new

Replaces the inert dashed button on /home with a dedicated focused
route. Server Action validates + inserts trips + trip_members rows for
every workspace member; client router.pushes to the new /trips/<slug>
on success. Slug auto-derives from name with a slugDirty override.
Carries a graceful-empty branch in budget-tab.tsx so trips without a
planned budget hide the planned-cap bar instead of rendering "0%".
Phase 3.5 task 3 of 3 — Phase 3.5 complete.
EOF
)"
```

- [ ] **Step 4: Verify**

Run: `git status` — expected clean.
Run: `git log -1 --stat` — expected the commit lists these 8 files: `src/lib/trips/slugify.ts` (new), `src/lib/trips/actions.ts` (modified), `src/app/trips/new/page.tsx` (new), `src/app/trips/new/new-trip-form.tsx` (new), `src/app/home/page.tsx` (modified), `src/app/trips/[slug]/budget-tab.tsx` (modified), `docs/TODO.md` (modified), `docs/DECISIONS.md` (modified).

---

## Self-review

**Spec coverage:**
- Trigger (dashed button → Link) → Task 5.
- Route layout (back link, label, hr, form) → Task 4.
- Fields (name, slug w/ auto-derive + slugDirty, dates, country, advanced lat/lng) → Task 3.
- States (disabled submit when name empty / slug invalid; pending; error; success router.push; cancel router.back) → Task 3.
- `createTrip` action signature, validation order, slug-collision handling, trip_members batch insert → Task 2.
- `slugify` helper → Task 1.
- Graceful-empty budget header → Task 6.
- Acceptance checklist (happy path, slug collision, slugDirty stop, empty name disabled, date order, lat/lng pair + range, cancel, Lombok regression, auth gate) → Task 7 Steps 2–5.
- DECISIONS rows (dedicated route vs. inline; graceful-empty vs. schema column) → Task 8 Step 2.

**Placeholder scan:** no `TBD` / `TODO` / "implement later" / "similar to" in any task; every code block is concrete.

**Type consistency:** `CreateTripInput` field names (`name`, `slug`, `startDate`, `endDate`, `country`, `lat`, `lng`) match the props passed by the client form in Task 3's `submit` handler. `CreateTripResult.slug` (Task 2) is consumed as `result.slug` in Task 3. `slugify` (Task 1) is imported in Task 3. `getCurrentWorkspace` (existing) is imported in Task 2 and Task 4. The `BudgetHeader` props in Task 6 are unchanged — only the function body changes.
