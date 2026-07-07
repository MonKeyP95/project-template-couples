# Couple profile in nav + activities — two-level profile slice 2

**Date:** 2026-07-07
**Status:** design agreed; migration applied.
**Builds on:** the two-level profile vision
(`docs/superpowers/specs/2026-07-07-two-level-profile-vision.md`, roadmap item 2)
and slice A couple `dining_preferences` (`/profile`, migration
`20260629000001_dining_preferences.sql`).

## Goal

Promote the existing `/profile` page into the app nav as a first-class **Couple
profile** destination, and add an **activities** layer to the couple's durable
taste alongside the existing dining preferences. Manual only — no AI wiring in
this slice (discovery picks up `activities` for free once it is a column, but
ranking is not touched here).

## Scope

Two small, self-contained changes:

1. **Add couple activities** to `dining_preferences` (free-text list, same shape
   as `vibe_tags`/`dietary`/`cuisines`).
2. **Promote `/profile` into the nav** with the standard app shell (`LeftRail` +
   `MobileHeaderNav`), heading "Couple profile".

Out of scope (later slices): AI reads the trip profile (slice 3); the learned
layer derived from ratings (slice 4).

## 1. Data model — couple activities

Migration `20260707000002_dining_activities.sql` (**applied 2026-07-07**):

```sql
alter table public.dining_preferences
  add column if not exists activities text[] not null default '{}';
```

Code changes:

- `src/lib/preferences/dining-types.ts`: add `activities: string[]` to
  `DiningPreferences` and to `EMPTY_DINING_PREFERENCES` (`activities: []`).
- `src/lib/preferences/dining-queries.ts`: add `activities` to the select;
  map `data.activities ?? []`.
- `src/lib/preferences/dining-actions.ts`: parse `activities` from the form via
  the existing `parsePreferenceList` and include it in the upsert.

No RLS change — the column rides the existing `dining_preferences` policies.

## 2. Nav wiring (`src/components/app-nav.tsx`)

- `NavKey` gains `"profile"`.
- `buildNavDestinations` pushes
  `{ key: "profile", label: "Profile", href: "/profile" }` after `manual`, so
  Profile appears on every shell page's `LeftRail`.
- `MOBILE_NAV_ORDER` gains `"profile"` at the end:
  `home -> trip -> on-the-road -> manual -> profile`.

## 3. Reshape `/profile` into the app shell (`src/app/profile/page.tsx`)

Mirror the Manual page shell (`src/app/manual/page.tsx`):

- Keep the auth guard (`redirect("/signin?next=/profile")`); add a workspace
  guard (`redirect("/home")` when no workspace) since the rail needs it.
- Load `buckets = listTripsForWorkspace(workspace.id)` and build
  `navDestinations` (`onTheRoad: buckets.now.length > 0`, `tripSlug` from the
  hero) exactly as Manual does.
- Wrap the content in the `LeftRail` (`current="profile"`) + `MobileHeaderNav`
  shell (the `max-w-[440px] lg:flex` container).
- Heading becomes **"Couple profile"**.
- **Drop** the in-body Appearance toggle and the "Back to home" link — the rail
  carries appearance and navigation. On mobile the `MobileHeaderNav` supplies the
  arrows and sign-out.
- **Keep:** the display-name form, the email / member-since facts, the AI-toggle
  row, and the couple-taste form (dining preferences + the new activities input).

The `dining` form still renders only when a workspace exists (always true now,
given the workspace guard), and keeps its `key` reseed pattern.

## 4. Activities in the taste form

Add one input to the dining-preferences form, after cuisines:

```tsx
<Input
  name="activities"
  placeholder="Activities you love (e.g. surf, hike, museums)"
  defaultValue={dining.activities.join(", ")}
  className="mt-3"
/>
```

Add `dining.activities.join(",")` to the form's `key` array so it re-seeds after
a save.

## Principles honored

- **Reuse existing systems:** activities is one more column and input on the
  existing `dining_preferences` row/form — no parallel table or component.
- **Cheapest first / manual before learning:** pure manual layer; discovery
  ranking untouched.
- **Suggest-only:** nothing under `lib/ai` changes; profiles only inform recs.

## Deferred

- AI reading the trip profile chips/brief into discovery (slice 3).
- The visible learned layer from Slice D ratings (slice 4).
- A fixed activities vocabulary / chip UI (chose free-text for consistency with
  the sibling taste fields; revisit only if free-text proves noisy).
