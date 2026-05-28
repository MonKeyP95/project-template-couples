# Phase 4 — Edit Trip / Promote Dream (design)

**Date:** 2026-05-28
**Status:** Approved, ready for implementation plan.
**Carries from:** `2026-05-28-phase-4-dream-trip-pipeline-design.md` ("Carried into the next Phase 4 slice" → promote-a-dream / edit-a-trip flow).

## Goal

A single `// edit trip` flow that lets a workspace member change a trip's editable fields, rename it (slug + URL), promote a dream (null dates → real dates) or demote a trip back to a dream, and delete a trip entirely. One form, schema-faithful (same dream/trip invariant as `createTrip`), one new route, two new Server Actions.

## Non-goals

- No slug-history table / old-URL redirects. Bookmarked old slugs will 404 after rename. Revisit if external trip-URL sharing happens.
- No edit affordance on `/home` cards — entry point is only the trip page itself.
- No edit-in-place for packing items / expenses / itinerary days. Those are separate slices.
- No role gate beyond the existing RLS rule ("any workspace member of the trip can read/write"). In a 2-person workspace, a role gate is pointless friction.

## Route + form

### New file: `src/app/trips/[slug]/edit/page.tsx` (Server Component)

- Loads the trip via `getTripBySlug(workspaceId, slug)` (existing query, already returns the `TripHeader` shape this needs); calls `notFound()` on miss.
- Renders `<EditTripForm initial={...} tripId={...} />` inside the same column wrapper used by `/trips/new` (max-w-[440px] mobile, lifts at lg). No tabs, no hero — this is a focused form page. A small `‹ back to trip` link at the top points to `/trips/<slug>`.

### New file: `src/app/trips/[slug]/edit/edit-trip-form.tsx` (`"use client"`)

Duplicated from `src/app/trips/new/new-trip-form.tsx`, then diverges. We accept the duplication this slice; if a third trip form ever appears, factor a shared `TripForm` then.

Differences from `NewTripForm`:

- **Defaults pre-populated** from `initial: { name, slug, isDream, startDate, endDate, fuzzyWhen, country, lat, lng }`. `isDream` is derived in the page from `initial.startDate === null` and passed in (cleaner than re-deriving in the client).
- **Slug field is always visible** under the name field (in `NewTripForm` it's auto-derived from name). Reason: editing implies intent to rename; hiding the slug behind auto-derive would be surprising on an existing trip. The `slugDirty` auto-derive behavior of `NewTripForm` is dropped — slug is plain text on this form.
- **`is a dream` toggle** kept verbatim, including the date / `When?` swap. This is what makes promotion symmetric: uncheck `is a dream` on a dream + fill dates + save = promotion. Check it on a trip + clear `When?` (or leave default) + save = demotion. Mixed states are rejected by the action just as `createTrip` rejects them.
- **Submit copy:** `save changes` (replacing `create trip` / `save dream`). The dream/trip distinction is already visible in the toggle state; the submit label doesn't need to echo it.
- **On success:** `router.push("/trips/" + result.slug)` — handles the rename case naturally because the action returns the new slug. (Same-slug edits also navigate, which is fine: the `/trips/[slug]` page revalidates and shows updated fields.)
- **Delete affordance** at the bottom (see "Delete UX" below). Not a hover-revealed thing; a deliberate small button beneath the submit, separated by a horizontal rule.

`NewTripForm` is **not modified** by this slice.

## Server Actions

Two new exports in `src/lib/trips/actions.ts`. Both follow the existing patterns in that file.

### `updateTrip(input: UpdateTripInput): Promise<UpdateTripResult>`

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
```

- **Validation:** identical rules to `createTrip` — `name.trim()` required, `SLUG_RE` test, dream/trip invariant guard (`isDream` → both dates null + optional `fuzzyWhen` ≤ 64 chars; not-dream → both dates set, `endDate >= startDate`, `fuzzyWhen` must be null), lat/lng pair-or-null + ranges. Copy the constants and the validation block from `createTrip` rather than extracting a shared validator this slice (premature abstraction).
- **DB call:** single `UPDATE public.trips SET name, slug, country, start_date, end_date, fuzzy_when, lat, lng WHERE id = tripId`. No transaction needed — one row, one statement. `workspace_id`, `created_by`, `created_at` are never touched. RLS gates membership.
- **Slug collision:** Postgres returns code `23505` on the `unique (workspace_id, slug)` constraint — surfaced as `"A trip with that slug already exists."` (matches `createTrip`).
- **Revalidation:** `revalidatePath('/home')` (band counts may change) + `revalidatePath('/trips/' + currentSlug)` (covers same-slug edits; a rename leaves the old URL to 404 on next visit, which is the documented non-goal).
- **Returns** `{ slug: newSlug }` on success. Client navigates.

### `deleteTrip(tripId: string, currentSlug: string): Promise<void>`

- Throws on error (form-compatible like `settleUp`); the client wraps it in a `<form action={deleteTrip.bind(null, tripId, slug)}>`.
- Single `DELETE FROM public.trips WHERE id = tripId`. RLS gates membership.
- Cascade verified safe: `trip_members`, `packing_items`, `expenses`, `itinerary_days` all reference `public.trips(id)` with `on delete cascade` (per `20260526000001_phase_3_trips.sql`, `20260526000003_phase_3_packing.sql`, `20260527000001_phase_3_expenses.sql`, `20260527000003_phase_3_itinerary.sql`). No migration required.
- `revalidatePath('/home')`, then `redirect('/home')` from `next/navigation`. Server-side redirect — the browser lands on `/home` and the trip is gone from all bands.

## Entry point

A small mono `// edit trip` link in the trip hero, top-right corner.

- **Mobile (`/trips/[slug]` hero):** `absolute top-3 right-3` over the `TopoBg`-painted hero. Tone `text-foreground/60 hover:text-foreground`, `t-mono` recipe (lowercase). Same `<Link href={\`/trips/${slug}/edit\`}>` in both dream and trip variants — copy stays `// edit trip` since dreams are still trips at the data layer.
- **Desktop (`lg:` 3-col layout):** the same absolute-corner link stays in place inside the wider hero. No duplicate copy in the left rail.
- **Z-index / tap target:** the topo background is purely decorative; the link sits above it. Minimum tap target 32×32 enforced via padding.

## Delete UX

Below the submit button in `EditTripForm`, separated by a horizontal rule and a `t-mono` "danger zone"-ish label (kept understated — single small line, no boxes):

```
─────────────────────────
/ danger                       // delete trip
```

- **Confirmation:** native `window.confirm("Delete this trip? Packing list, expenses, and itinerary will be removed.")` on the button's `onClick`. If false → preventDefault + no-op. If true → the surrounding `<form action={deleteTrip.bind(null, tripId, currentSlug)}>` submits.
- **Why native:** zero new components, accessible by default, matches the project's "don't over-engineer" rule. We have no Dialog primitive in the app yet; introducing one for a single destructive action is overkill. The trade-off — native dialogs look unstyled — is acceptable for a one-shot destructive action.
- **No undo.** Cascade deletes everything. The confirmation copy makes that explicit.

## Auth / membership

RLS already enforces "the caller must be a workspace member of the trip" on both `UPDATE trips` and `DELETE trips` (the existing policies cover all CRUD). No application-layer check is added in `updateTrip` or `deleteTrip` — if RLS rejects, the error bubbles up with the standard Postgres / Supabase message and the form surfaces it.

## Decisions worth a `DECISIONS.md` row after shipping

- **Duplicate `NewTripForm` rather than factoring a shared `TripForm`.** Edits diverge enough (visible slug, delete affordance, different submit copy, pre-populated defaults, dropped `slugDirty` auto-derive) that a polymorphic `mode: "create" | "edit"` prop would proliferate conditionals. Factor when a third trip form appears.
- **No slug-history table.** Bookmarked old slugs 404 after rename. Acceptable today (no external sharing); add a slug-history table or `permalink` column if/when external sharing becomes a thing.
- **Native `confirm()` for delete.** Trades visual polish for zero new primitives; matches the project's anti-over-engineering rule.
- **No role gate.** Any workspace member can edit or delete any trip in the workspace. In a 2-person workspace it's pointless friction; revisit if/when workspaces grow.

## File-level summary

**New files:**

- `src/app/trips/[slug]/edit/page.tsx` — Server Component, loads trip, renders form.
- `src/app/trips/[slug]/edit/edit-trip-form.tsx` — `"use client"`, duplicated from `NewTripForm`, diverged as above.

**Modified files:**

- `src/lib/trips/actions.ts` — append `updateTrip` + `deleteTrip` (plus their input/result types and any constants copy-pasted from `createTrip`).
- `src/app/trips/[slug]/page.tsx` — add the `// edit trip` link in the hero (top-right corner), both dream and trip variants.

**Unmodified (called out so the plan doesn't drift):**

- `src/app/trips/new/new-trip-form.tsx` — not touched.
- `src/lib/trips/queries.ts` — `getTripBySlug` already returns everything the form needs.
- No new migrations. No schema changes.

## Out-of-spec follow-ups (carried)

- Edit affordance on `/home` cards (jump straight into edit from the home dashboard).
- Slug history / permalink redirect for renamed trips.
- Trash/restore flow (currently delete is permanent — fine for the user's own workspace, may warrant a soft-delete column if the trust model changes).
