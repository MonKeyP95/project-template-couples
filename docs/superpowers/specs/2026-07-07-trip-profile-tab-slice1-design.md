# Two-level profile — Slice 1: Trip Profile tab

**Date:** 2026-07-07
**Status:** built + live-verified 2026-07-07
**Vision:** `docs/superpowers/specs/2026-07-07-two-level-profile-vision.md`
**Builds on:** the existing Notes tab (`trip_notes`, `NotesTab`), the `trips`
table.

## Why

First slice of the two-level profile vision. The per-trip **Notes tab becomes a
"Profile" tab**: a structured trip profile (headline + chips + free brief) with
the existing notes as a section below. Manual only — the AI does not read the
trip profile yet (that is Slice 3). Answers "what this trip is."

## Decisions (brainstorm 2026-07-07)

- **Shape:** hybrid — a headline, a few structured chips, and a free brief; notes
  below.
- **Fields (top → bottom):** headline (one line), **About this trip** (free
  brief, at the top), **Categories** (the trip's shared `expense_categories` —
  the same list as Budget, add/remove here), Vibe (fixed multi-pick chips),
  Who's coming (fixed single-pick). No separate activities list — the trip's
  "activities" *are* its categories, edited from Budget and Profile alike.
- **Data model:** one `jsonb` column `trip_profile` on `trips` (cheapest; 1:1;
  never queried by field; matches the events jsonb pattern).
- **Edit model:** one editable form with a single **Save** (`saveTripProfile`);
  chips held in local state; sidesteps React 19 edit-in-place gotchas.
- **Headline also shows as a subtitle under the trip header** (home hero
  deferred).
- **On creating a new trip/dream, land on the Profile tab** so the couple sets it
  up first.

## Scope

In:

1. `trip_profile` jsonb column + `TripProfile` type + tolerant parse + fixed tag
   constants (in a `*-types.ts`).
2. `saveTripProfile` action.
3. Rename the trip's `notes` tab to **Profile**; a `ProfileTab` that renders the
   profile form then the existing `<NotesTab>` unchanged.
4. Headline subtitle under the trip header.
5. New-trip / new-dream flow lands on `?tab=profile`.

Out (deferred):

- The AI reading the trip profile (Slice 3).
- Couple profile / activities / learned layer (Slices 2, 4).
- Home-hero subtitle; custom (free-add) tags; realtime on profile fields; edit
  history. (Notes keep their own actions + realtime.)

## Design

### 1. Data model

**Migration** (idempotent; applied by hand to the shared Supabase per the repo's
manual-migration convention):

```sql
alter table trips add column if not exists trip_profile jsonb;
```

**Types** — new `src/lib/trips/trip-profile-types.ts` (a `*-types.ts` so the
client `ProfileTab` imports type + constants without pulling server code):

```ts
export const TRIP_VIBES = [
  "Romantic", "Adventurous", "Relaxed", "Social/lively", "Cultural",
  "Off-the-beaten-path", "Luxe",
] as const

export const TRIP_WHO = ["Just us", "+ kids", "+ friends", "+ family"] as const

export interface TripProfile {
  headline: string
  vibe: string[]  // subset of TRIP_VIBES (fixed)
  who: string     // one of TRIP_WHO (fixed), or ""
  brief: string
}

export const EMPTY_TRIP_PROFILE: TripProfile = {
  headline: "", vibe: [], who: "", brief: "",
}
```

`trip_profile` holds only `headline`/`vibe`/`who`/`brief` — categories live in
`expense_categories` (§4a). `parseTripProfile(raw: unknown): TripProfile` —
tolerant, like `parseEvents`: coerces `headline`/`brief` to strings; `vibe` keeps
only entries in `TRIP_VIBES`; `who` only if in `TRIP_WHO`. Unknown/legacy JSON
(including any legacy `activities` key) never throws — extra keys are ignored.

### 2. Query

Extend the trip query that feeds the page (`getTripBySlug` / `TripHeader`) to
select `trip_profile` and expose it as `TripProfile` via `parseTripProfile`. This
single load serves both the Profile tab and the header subtitle (§5). Add
`tripProfile: TripProfile` (or `headline` at minimum) to the `TripHeader` shape.

### 3. `saveTripProfile` action

New action in `src/lib/trips/actions.ts`:

```ts
export interface SaveTripProfileInput {
  tripId: string
  tripSlug: string
  profile: TripProfile
}
export async function saveTripProfile(
  input: SaveTripProfileInput,
): Promise<{ error?: string }>
```

Behaviour: sanitise the incoming profile — trim `headline`/`brief` (headline ≤
80, brief ≤ 2000); keep only allowed `vibe`/`who` values — build the
`trip_profile` jsonb, `update` the trip row (RLS already gates trip writes to
workspace members), `revalidatePath(/trips/<slug>)`. Categories are **not** in
`trip_profile` — they persist via the existing expense-category actions (§4a).

### 4. Tab rename + `ProfileTab`

- In `src/app/trips/[slug]/page.tsx`: `TabId` `"notes"` → `"profile"`; the `TABS`
  entry label `"Notes"` → `"Profile"`; update the `isTab` guard and the
  `activeTab === "notes"` load/render branches to `"profile"`. Grep the repo for
  any other `?tab=notes` / `=== "notes"` references and update them (bottom nav /
  desktop tabs derive from `TABS`, so those follow automatically).
- **New `ProfileTab`** (`src/app/trips/[slug]/profile-tab.tsx`, `"use client"`):
  renders the form top → bottom — headline input → **About this trip** textarea →
  **Categories** (§4a) → Vibe chips → Who's-coming single-select → **Save**
  (persists headline/vibe/who/brief via `saveTripProfile`; local state until
  save; `router.refresh()` after) — then the existing `<NotesTab .../>`
  **unchanged** below. `NotesTab` is reused as-is; `ProfileTab` wraps it. The page
  renders `<ProfileTab>` for the profile tab, passing the loaded `TripProfile`,
  the trip's `expenseCategories`, and the notes props `NotesTab` already takes.

### 4a. Categories = the trip's shared expense categories

The Profile's **Categories** section is a second access point to the trip's
`expense_categories` (the same list Budget uses — starting from the seeded
defaults Food / Transportation / Accommodation / Activities / Other). A
`TripCategories` helper in `profile-tab.tsx` lists them as chips with an `×`
remove and an `+ add category` input, calling the existing `addExpenseCategory` /
`deleteExpenseCategory` actions (deleting moves that category's expenses to
"Other", same confirm as Budget) then `router.refresh()`. These persist
**immediately**, independent of the profile **Save**. The page loads
`getTripExpenseCategories` for the profile tab (as it already does for budget)
and passes them to `ProfileTab`. Nothing category-shaped lives in `trip_profile`.

### 5. Headline subtitle under the trip header

In `TripHeaderView` (`page.tsx`), when `header` carries a non-empty
`tripProfile.headline`, render it as a small subtitle beneath the trip name (both
the dated and dream variants). Absent headline → nothing. Presentation only.

### 6. New-trip / new-dream lands on Profile

`src/app/trips/new/new-trip-form.tsx` currently does
`router.push(\`/trips/${result.slug}\`)` after `createTrip`. Change it to
`router.push(\`/trips/${result.slug}?tab=profile\`)` so a freshly created trip or
dream opens on the Profile tab. (`createTrip` handles both trips and dreams and
returns `{ slug }`; one change covers both.)

## Files touched

- `supabase/migrations/<ts>_trip_profile.sql` — new column.
- `src/lib/trips/trip-profile-types.ts` — new types, constants, `parseTripProfile`.
- `src/lib/trips/actions.ts` — `saveTripProfile` + `SaveTripProfileInput`.
- `src/lib/trips/queries.ts` — `TripHeader.tripProfile`; select + parse
  `trip_profile` in `getTripBySlug`.
- `src/app/trips/[slug]/page.tsx` — tab rename; load `getTripExpenseCategories`
  for the profile tab; render `<ProfileTab>`; headline subtitle in
  `TripHeaderView`.
- `src/app/trips/[slug]/profile-tab.tsx` — new; profile form + `TripCategories`
  (shared expense categories) + `<NotesTab>`.
- `src/app/trips/new/new-trip-form.tsx` — post-create nav to `?tab=profile`.

No new dependency. One manual migration.

## Principles / two-modes

- **Planning-facing:** the trip profile is set before/early in a trip; it feeds
  planning and (later) on-the-road recs once Slice 3 wires the AI. Nothing here
  is AI-gated — the profile is plain trip data, editable AI-off.
- **Cheapest first:** one jsonb column, one action, reuse `NotesTab`; no realtime,
  no AI yet.

## Acceptance

- The trip tab reads "Profile"; it shows the profile form above the existing
  notes.
- Setting headline + About + vibe/who and pressing Save persists them; reload
  shows them; either partner can edit (RLS).
- The Categories section lists the trip's categories; add/remove writes the
  shared `expense_categories` (a category added here appears in Budget too).
- The headline appears as a subtitle under the trip header when set.
- Creating a new trip or dream opens on the Profile tab.
- Old trips (null `trip_profile`) render an empty profile form and unchanged
  notes; nothing throws.
- Verified on a 390px phone viewport.
