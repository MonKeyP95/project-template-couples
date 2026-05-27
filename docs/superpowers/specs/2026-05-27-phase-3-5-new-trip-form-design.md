# Phase 3.5 — `+ new trip` form

**Status:** spec, awaiting plan.
**Phase:** 3.5 — Basic CRUD (task 3 of 3).
**Predecessors:** `+ add packing item` (2026-05-27), `+ log expense` (2026-05-27) — same Server Action + return-value-Result pattern, but a dedicated route instead of inline expansion.

## Problem

The `/home` page has a dashed `+ new trip` button that does nothing (`<button type="button">` with no `onClick`). The `trips` + `trip_members` schema and RLS exist from Phase 3 task 5, but the only trip in the database is the Lombok seed. Without a create flow, the app has exactly one trip forever — the route, packing tab, budget tab, and itinerary view aren't field-testable for anything except Lombok.

This task wires up a form that inserts a `trips` row, populates `trip_members`, and lands the user on the new trip page.

## Goals

- A signed-in workspace member can create a new trip in a few taps on a phone.
- The form supports the schema's optional fields without making them feel mandatory.
- On success, the user lands on `/trips/[slug]` for the trip they just made — empty packing tab, empty budget tab, "Arriving soon" itinerary stub all work out of the box.
- Slug collisions surface inline, not as a 500 page.

## Non-goals

- Edit or delete an existing trip.
- Multi-step wizard (one screen, one submit).
- Country picker / autocomplete — free text.
- Map or geocoding helper for lat/lng — paste-only.
- Planned-budget column on `trips` — addressed indirectly by hiding the planned-cap bar when `plannedBudgetCents === 0`. The Lombok hardcoded value in `fixtures.ts` stays put.
- Duplicate-trip or templating.
- Seed data for new trips (no default packing categories, no itinerary skeleton).
- Trip archive / soft-delete.

## UX

### Trigger

The dashed `+ new trip` button on `/home` (currently a `<button>`) becomes a `<Link href="/trips/new">` styled with the same `border-dashed border-rule` classes. No layout change.

### Route

`/trips/new` — a dedicated focused page. Auth-redirects to `/signin?next=/trips/new` if logged out. 404s (via `notFound()`) if the user has no workspace. Otherwise renders a back-arrow + `Together · New trip` header and the form below.

```
─── /trips/new (390px) ─────────────
‹ home
Together · New trip
────────────────────────────────────

NEW TRIP

Name
│ Iceland ring road

Slug
│ iceland-ring-road    (auto)

Start              End
│ 2026-08-12        │ 2026-08-22

Country
│ Iceland

› advanced (lat / lng)

      [ cancel ]      [ create trip ]
────────────────────────────────────
```

### Fields

- **Name** — text input, autofocused on mount, placeholder `Where to?`, required.
- **Slug** — text input prefilled live by slugifying the name (`lowercase, spaces→hyphens, strip non-alphanumeric, collapse repeated hyphens, trim leading/trailing hyphens`). The slug field tracks a `slugDirty` flag: while `false`, every keystroke in name updates slug; on the first user keystroke in the slug field, `slugDirty` flips to `true` and the auto-derive stops. Hint text under the input: `URL: /trips/<slug>`.
- **Start date, End date** — two `<input type="date">` side by side, both optional. Native picker on mobile.
- **Country** — text input, optional.
- **Advanced (lat / lng)** — a `<details>` (or roll-our-own collapsible button) that hides two `inputMode="decimal"` text inputs labeled `Latitude` and `Longitude`. Both optional, but must come as a pair.

### States

- **Empty name or invalid slug** → submit button disabled. (Date ordering and lat/lng pair-validity surface as inline server errors, not as submit-gating — keeps client logic small.)
- **In-flight (pending)** → all inputs + buttons disabled, submit shows `…`.
- **Server error** → inline `font-mono text-[10px] text-clay` row above the action buttons, same shape as `LogExpenseRow`'s error line. Form stays mounted; user fixes and resubmits.
- **Success** → client `router.push('/trips/' + result.slug)`. The new trip page renders empty packing / empty budget / "Arriving soon" itinerary.
- **Cancel** → `router.back()`.

## Architecture

### File layout

| File | Change |
| --- | --- |
| `src/lib/trips/actions.ts` | Add `createTrip(input)` Server Action. |
| `src/lib/trips/slugify.ts` | New pure helper `slugify(name)`. Co-located rather than inlined so the client form and the action share one definition. |
| `src/app/trips/new/page.tsx` | New Server Component route. Auth-guards, fetches workspace, renders the form. |
| `src/app/trips/new/new-trip-form.tsx` | New `"use client"` component — the form itself. |
| `src/app/home/page.tsx` | Convert the dashed `+ new trip` `<button>` into a `<Link href="/trips/new">` with the same classes. |
| `src/app/trips/[slug]/budget-tab.tsx` | When `plannedBudgetCents === 0`: hide the `<Bar />` planned-cap row and replace `{fmt(total)} / €{fmt(planned)}` with just `{fmt(total)}`; hide the `"X% spent"` line. Lombok (€2,800) unaffected. |

### Server Action

`src/lib/trips/actions.ts`:

```ts
export interface CreateTripInput {
  name: string
  slug: string
  startDate: string | null   // "YYYY-MM-DD"
  endDate: string | null
  country: string | null
  lat: number | null
  lng: number | null
}

export interface CreateTripResult {
  error?: string
  slug?: string   // populated on success — the client routes to /trips/<slug>
}

export async function createTrip(
  input: CreateTripInput,
): Promise<CreateTripResult>
```

Validation order (return early on first failure):

1. `name.trim()` non-empty → else `"Name required."`
2. `slug` matches `/^[a-z0-9-]+$/` and length > 0 → else `"Slug must be lowercase letters, numbers, hyphens."`
3. Dates: if both set, `endDate >= startDate` → else `"End date must be on or after start date."`
4. Lat/lng pair: must be both null or both set; if set, lat ∈ [-90, 90] and lng ∈ [-180, 180] → else `"Coordinates invalid."`
5. `getCurrentWorkspace()` returns a workspace → else `"No workspace."` (defensive; the route's loader already 404s, but the action is callable independently.)
6. `supabase.auth.getUser()` returns a user → else `"Not signed in."`

Insert sequence:

1. Insert into `trips`:
   ```ts
   {
     workspace_id: workspace.id,
     slug: input.slug,
     name: input.name.trim(),
     country: input.country?.trim() || null,
     start_date: input.startDate,
     end_date: input.endDate,
     lat: input.lat,
     lng: input.lng,
     created_by: userData.user.id,
   }
   ```
   On Postgres unique-constraint violation (code `23505`): return `{ error: "A trip with that slug already exists." }`.
2. Insert into `trip_members`: one row per `workspace_members.user_id` for the current workspace, all with `role: 'member'`. Use a single `.insert([…])` array call.
3. Return `{ slug: input.slug }`.

No `revalidatePath` — the client navigates to a dynamic `/trips/[slug]` route, which is server-rendered on demand on every navigation.

### Slugify helper

`src/lib/trips/slugify.ts`:

```ts
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")  // strip combining diacritics (U+0300..U+036F)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}
```

### Client form

`src/app/trips/new/new-trip-form.tsx`:

```ts
"use client"

export interface NewTripFormProps {
  // Nothing for now. Workspace is read server-side in the action;
  // current user is read server-side too. Keeping the props empty
  // means the form has no client-side dependence on workspace data.
}
```

Internal state:

- `name`, `slug`, `slugDirty`, `startDate`, `endDate`, `country`, `lat`, `lng`, `error`.
- `[isPending, startTransition] = React.useTransition()`.
- `React.useRef<HTMLInputElement>` on the name input for autofocus on mount.

Slug derivation:

```ts
const derivedSlug = React.useMemo(() => slugify(name), [name])
const displayedSlug = slugDirty ? slug : derivedSlug
```

The slug `<input>` is uncontrolled-ish: its `value` is `displayedSlug`, its `onChange` writes to `slug` state AND flips `slugDirty = true`.

Submit handler:

```ts
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
  if (result.error) { setError(result.error); return }
  router.push(`/trips/${result.slug}`)
})
```

`parseFloatOrNull(s)`: empty string → null; otherwise `Number(s)`. Co-located in the form file.

Submit-button gating: `name.trim().length > 0 && /^[a-z0-9-]+$/.test(displayedSlug) && !isPending`.

### Page route

`src/app/trips/new/page.tsx`:

```tsx
export default async function NewTripPage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/trips/new")

  const workspace = await getCurrentWorkspace()
  if (!workspace) notFound()

  return (
    <main className="mx-auto min-h-screen w-full max-w-[440px] bg-background px-5 pt-10 pb-20">
      <BackLink href="/home" label="home" />
      <Label className="mt-6">Together · New trip</Label>
      <hr className="mt-3 border-rule" />
      <NewTripForm />
    </main>
  )
}
```

`BackLink` is either an existing primitive or a small inline `<Link>` styled as mono uppercase tracking — pick whichever already exists in `@/components/together`. If none does, inline it; don't add a new primitive for one use site.

### Graceful empty budget tab

`src/app/trips/[slug]/budget-tab.tsx`:

```tsx
const hasPlannedBudget = plannedBudgetCents > 0
```

- Hero `"€{fmt(total)} / €{fmt(planned)}"` → when `!hasPlannedBudget`, render `"€{fmt(total)}"` alone.
- Planned-cap `<Bar … />` row → skip entirely when `!hasPlannedBudget`.
- `"X% spent"` mono row → skip when `!hasPlannedBudget`.

No props change — `plannedBudgetCents` is already passed; we just branch on it.

## Validation flow

```
Client (NewTripForm)             Server (createTrip)         Postgres
────────────────────────         ─────────────────────       ──────────────
name.trim() != ""           →    re-check                   NOT NULL + length check
slug matches /[a-z0-9-]+/   →    re-check                   unique (workspace_id, slug)
                                  start <= end check         CHECK (end_date >= start_date)
                                  lat/lng pair + range
                                  auth.getUser()             RLS: trips_insert (workspace member, created_by = uid)
                                  insert trips                ─────→ row (or 23505 → "slug taken")
                                  insert trip_members[]       ─────→ rows
                                  return { slug }
client → router.push(`/trips/${slug}`)
```

## Acceptance checklist

- [ ] `pnpm build` and `pnpm lint` clean.
- [ ] From `/home` on a phone viewport (390px), tapping `+ new trip` navigates to `/trips/new`; the Name input is focused.
- [ ] Typing `Iceland ring road` live-fills the slug field with `iceland-ring-road`; manually editing the slug stops the auto-derive.
- [ ] Submitting with a valid name + slug (and optional empty dates/country/coords) creates a row, navigates to `/trips/<slug>`, and the new trip page renders with empty Packing (0 / 0), empty Budget (no planned-cap bar, total `€0`), and "Arriving soon" Itinerary.
- [ ] Submitting with an empty name keeps the submit button disabled.
- [ ] Submitting with a slug that already exists in the workspace surfaces `"A trip with that slug already exists."` inline; the form stays mounted.
- [ ] Submitting with `endDate < startDate` surfaces `"End date must be on or after start date."` inline.
- [ ] Tapping `cancel` returns to `/home` via `router.back()`.
- [ ] The Lombok budget tab still renders with the planned-cap bar at `€2,800` (regression check on the graceful-empty branch).
- [ ] Sign out, then visit `/trips/new` → redirected to `/signin?next=/trips/new`.

## Decisions to record

If shipped, add a `DECISIONS.md` row noting:

- **Why a dedicated `/trips/new` route, not inline on `/home`.** The form has 5–6 fields; inline expansion (the pattern from packing + expense) was designed for short forms inside a contextual frame (a category row, a budget tab). `/home`'s `+ new trip` button has no such frame — it sits below a greeting, Upcoming card, and Dream board. A focused page sidesteps layout fights at all three breakpoints and matches the one-shot redirect rhythm. The form component is portable; if we ever want it inline or in a dialog, only the route shell changes.
- **Why no `planned_budget_cents` column yet.** Phase 3.5's TODO scoped fields are `name / slug / dates / country / optional lat/lng`. Adding a budget column + form field is real schema work for a value most newly-created trips won't have at creation time anyway. The budget tab's graceful-empty branch covers the UX cost; the migration can come later when there's enough demand for trip-level budget editing.
