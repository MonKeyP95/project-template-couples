# Notes becomes a pill; trip profile folds into /edit

**Date:** 2026-07-22
**Status:** Design approved, ready for planning.

## Problem

Since trip creation captures the whole profile (idea, vibe, categories + detail
tags, getting-around) in a guided walkthrough, the trip's **Profile pill** is
now half-redundant: its edit wizard duplicates the create form, and its only
unique job is a read-only overview. Meanwhile **Notes** has no pill of its own —
it is bolted onto the bottom of the Profile tab (`ProfileTab` renders
`<ProfileOverview>` then `<NotesTab>`). Notes is the daily-use content; Profile
editing is rare.

## Goal

- Promote **Notes** to its own top-level pill (the single hub to read/write
  notes; it already groups by location).
- Fold the **profile** (idea, vibe, categories, getting-around) into the
  existing `/trips/[slug]/edit` page, next to name/dates/destination — unifying
  it with the create form's data model, field components, and one-save shape.
- Delete the now-dead Profile tab surfaces.

Pills become **Budget · Itinerary · Packing · Notes**.

## Non-goals (explicitly deferred)

- **Capture-in-context notes** (a note attached to a budget line or itinerary
  event). This slice keeps one central Notes hub only.
- Any change to the create walkthrough itself.
- Any change to notes' data model, location grouping, assistant door, or
  import-from-trip.
- Migrations, new dependencies, AI/prompt changes. None are needed —
  `trips.trip_profile` (jsonb) and `expense_categories.details` already exist.

## Current state (grounding)

- **Tabs** (`src/app/trips/[slug]/page.tsx`):
  `type TabId = "itinerary" | "packing" | "budget" | "profile"`, default
  `"budget"`. `TABS` array drives both `BottomNav` and `DesktopTabs`. `isTab`
  guards the URL param.
- **Data fetch gating** (`page.tsx` ~178-199): `getTripNotes` runs only when
  `activeTab === "profile"`; `getTripExpenseCategories` runs when
  `budget || profile || (itinerary && !dream)`. `getItineraryLocations` and
  `memberTones` always load.
- **The 4th-tab render** (`page.tsx` ~331) is `<ProfileTab>`, which takes
  `profile`, `expenseCategories`, and the notes props, and internally renders
  `<ProfileOverview>` (swaps to `<ProfileWizard>` on "edit") above `<NotesTab>`.
- **Create** (`src/app/trips/new/new-trip-form.tsx`) is a 5-step walkthrough
  (idea → vibe → categories → getting-around → review) using shared components
  from `src/app/trips/profile-fields.tsx` (`OptionRow`, `LocalCategoryEditor`,
  `StepShell`, `CategoryCard`, `type LocalCategory`). `createTrip` already
  accepts `profile?: TripProfile` and `categories?: { name; details }[]`.
- **Edit** (`src/app/trips/[slug]/edit/` — `page.tsx` + `edit-trip-form.tsx`):
  a flat form for name/slug/dream/dates/country/lat-lng calling `updateTrip`,
  plus a danger-zone delete. It does **not** currently load or edit the profile
  or categories.
- **Profile shape:** `{ idea: string; transport: string[]; vibe: string[] }`
  (`src/lib/trips/trip-profile-types.ts`; `EMPTY_TRIP_PROFILE`, `TRIP_TRANSPORT`,
  `TRIP_VIBES`). Categories: `expense_categories` rows `{ name, details, sort_order }`.

## Design

Two increments on one branch. Increment 1 is purely additive (profile editing
gains a second home) so the Profile tab can be deleted in Increment 2 without a
window where profile is uneditable.

### Increment 1 — profile editing in /edit (additive)

**A. `updateTrip` accepts and persists `profile` + `categories`**
(`src/lib/trips/actions.ts`), mirroring the existing `createTrip` extension.

- Grow the input type with `profile?: TripProfile` and
  `categories?: { name: string; details: string[] }[]`.
- Clean the profile exactly as `createTrip`/`saveTripProfile` do (trim idea to
  2000; filter transport to `TRIP_TRANSPORT`, vibe to `TRIP_VIBES`) and write
  `trip_profile` on the trips update. Omit-safe: when `profile` is undefined,
  leave `trip_profile` untouched.
- **Category reconcile** (only when `categories` is provided): clean +
  de-dupe by name (mirror `createTrip`: trim, drop blanks, dedupe, cap details
  at 20). Then against the trip's existing `expense_categories` rows:
  - **delete** rows whose name is not in the submitted set,
  - **update** `details` (and `sort_order`) on rows whose name matches,
  - **insert** submitted names that don't exist yet,
  - keep `sort_order` = submitted index.
  Accepted consequence: removing a category drops it from the Budget picker;
  existing expenses store their category as a string, so their rows are
  unaffected. This is the same net effect as today's per-action wizard remove,
  just batched.

**B. Edit page loads profile + categories**
(`src/app/trips/[slug]/edit/page.tsx`): fetch the trip's `trip_profile` (already
on the `getTripBySlug` header as `tripProfile`) and its
`getTripExpenseCategories(trip.id)`, and pass both into `EditTripForm` as
`initialProfile` + `initialCategories` (mapped to `LocalCategory[]`:
`{ name, details }`).

**C. `EditTripForm` renders a flat profile section**
(`src/app/trips/[slug]/edit/edit-trip-form.tsx`), below the country field and
above the danger zone. **Flat, not stepped** — all fields visible at once, since
edit is a quick-change surface. Reuse the shared components:
- **Idea** — a `<textarea>` (same styling as create's step 0).
- **Vibe** — `TRIP_VIBES.map(OptionRow)` with a local `toggle` helper (copied
  from create/new-trip-form).
- **Categories** — `<LocalCategoryEditor>` seeded from `initialCategories`.
- **Getting around** — `TRIP_TRANSPORT.map(OptionRow)`.

State: `idea`, `vibe`, `transport`, `categories` initialised from the props.
On submit, extend the existing `updateTrip({...})` call with
`profile: { idea, transport, vibe }` and `categories`. The existing
name/slug/dates/country logic and the delete form are untouched.

Verify in-app: editing profile + categories from `/edit` saves and shows up in
Budget (categories) and wherever profile is consumed. Nothing removed yet.

### Increment 2 — Notes pill, delete Profile tab

**D. Rename the tab and render Notes** (`page.tsx`):
- `TabId`: `"profile"` → `"notes"`.
- `TABS`: `{ id: "profile", label: "Profile" }` → `{ id: "notes", label: "Notes" }`.
- `isTab`: swap the `"profile"` check for `"notes"`.
- Notes fetch gate: `activeTab === "profile"` → `activeTab === "notes"`.
- `expenseCategories` fetch gate: drop the `activeTab === "profile"` disjunct
  (Notes doesn't need categories); keep `budget || (itinerary && !dream)`.
- The 4th-tab render branch: replace `<ProfileTab .../>` with `<NotesTab .../>`,
  passing `tripId`, `tripSlug`, `destination`, `initialNotes={notes ?? []}`,
  `locations={locations ?? []}`, `members={memberTones}`.
- `BottomNav` / `DesktopTabs` need no change — they derive from `TABS`.

**E. Delete dead files:** `profile-tab.tsx`, `profile-overview.tsx`,
`profile-wizard.tsx`. First grep to confirm nothing else imports them or links
to `tab=profile` (`grep -rn "tab=profile\|ProfileTab\|ProfileOverview\|ProfileWizard" src/`)
and fix any stray reference (e.g. a home/link pointing at the old tab). Keep
`profile-fields.tsx` — it is shared by create and the new edit section.

## Files touched

- `src/lib/trips/actions.ts` — extend `updateTrip` (profile + category reconcile).
- `src/app/trips/[slug]/edit/page.tsx` — load profile + categories.
- `src/app/trips/[slug]/edit/edit-trip-form.tsx` — flat profile section + save.
- `src/app/trips/[slug]/page.tsx` — tab rename, fetch gates, render `NotesTab`.
- **Delete:** `src/app/trips/[slug]/profile-tab.tsx`,
  `src/app/trips/[slug]/profile-overview.tsx`,
  `src/app/trips/[slug]/profile-wizard.tsx`.
- (Docs) `docs/TODO.md`, `docs/DECISIONS.md`.

## Risks / trade-offs

- **Category reconcile deletes removed categories.** Intended and matches
  current wizard behavior; call it out in the DECISIONS row. Expenses are
  unaffected (category stored as string).
- **Edit diverges from create (flat vs walkthrough).** Deliberate: same data,
  same components, same one-save; different chrome suited to editing.
- **Discoverability of profile editing** now depends on the trip's existing
  "edit trip" entry point. Verify that entry point is reachable from the trip
  header during Increment 1; if it isn't obvious, surface it (out of scope to
  redesign, in scope to confirm).
- **`ProfileWizard` was previously part of onboarding routing.** The
  merge-profile-into-create plan removed the onboarding baton; the grep in E
  confirms no live reference remains before deleting.

## Validation gate

Per task: `pnpm lint` + `pnpm build` clean (repo standard; no test framework).
End-to-end in-app checks:
1. `/edit` shows and saves idea/vibe/categories/getting-around; a removed
   category disappears from Budget; a changed vibe persists.
2. The 4th pill reads **Notes**, opens the notes hub (General + per-location
   groups), on both dated and dream trips.
3. No route or link points at `tab=profile`; no console/build reference to the
   deleted files.
