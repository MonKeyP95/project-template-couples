# Merge trip profile into "create a new trip/dream"

**Date:** 2026-07-21
**Status:** design approved (brainstorm), plan pending

## Problem

The trip profile (idea, categories with detail tags, getting-around, vibe) lives in
a separate 4-step wizard on the trip's **Profile tab**, disconnected from creation.
A brand-new trip is created bare, and the profile is only captured later if the
couple happens to open the Profile tab. The profile is exactly the kind of thing
you know at creation time ("2 weeks surfing in Portugal, chill, rental car"), so
asking for it separately is redundant friction.

**Goal:** fold the profile into the create-a-new-trip/dream page so a new trip is
born with its character already described, and demote the standalone Profile tab to
a later-edit surface.

## Decision

**One page, one save.** The `/trips/new` page keeps its existing create fields and
gains a **profile section below them** — Idea → Categories → Getting around → Vibe —
laid out flat (no stepper), all **optional**. A single submit ("Create trip" /
"Save dream") persists the trip *and* its profile atomically. Nothing is written
until that submit.

This applies to **both dreams and dated trips** (a dream is a natural place to
capture idea/vibe). Only the existing dates↔"when?" branch differs, already handled
by the form.

## Data model — no migration

Everything already has a home:

- **idea / transport / vibe** → the `trips.trip_profile` jsonb column (the exact
  `{ idea, transport, vibe }` shape `saveTripProfile` writes today).
- **categories** → `expense_categories` rows (`name`, `sort_order`, `details` text[],
  `created_by`, `trip_id`).

No new tables or columns.

## Server — expanded `createTrip`

`CreateTripInput` grows two optional fields:

- `profile: { idea: string; transport: string[]; vibe: string[] }`
- `categories: { name: string; details: string[] }[]`

`createTrip` changes:

1. Writes `trip_profile: cleaned(profile)` on the trip **insert** (reuse the same
   trim/whitelist cleaning `saveTripProfile` applies: idea trimmed & length-capped,
   transport/vibe filtered to `TRIP_TRANSPORT` / `TRIP_VIBES`).
2. Replaces the fixed `EXPENSE_CATEGORIES` seed with the caller's `categories` list —
   inserting each row with its `name`, `sort_order` = index, and `details` (cleaned
   like `setCategoryDetails`: trim, dedupe, cap 20). If `categories` is empty/omitted,
   fall back to the current 4 defaults so behavior is unchanged for any caller that
   doesn't send a list.

Same single action, same insert sequence (trip → members → categories) it already
runs. Category `details` are written inline on insert, so no follow-up
`setCategoryDetails` call is needed.

## Client — the profile section

New below the current create fields on `new-trip-form.tsx`, all optional:

- **Idea** — a textarea (mirrors the wizard's step 0).
- **Categories** — a **local editor** pre-filled with the 4 defaults
  (Food / Transportation / Accommodation / Other). Add/remove categories; each row
  expands to add/remove detail tags (Food → sushi). State is held entirely in React
  (`{ name, details }[]`) — no trip exists yet, so nothing writes until the page's
  single submit hands the array to `createTrip`.
- **Getting around** — `TRIP_TRANSPORT` multi-select.
- **Vibe** — `TRIP_VIBES` multi-select.

**Component reuse.** The wizard's presentational `OptionRow` (transport/vibe) and the
category row (name + detail chips) are extracted/shared so the create page and the
Profile-tab wizard render identically. Only the categories **controller** differs:
the wizard calls the live `addExpenseCategory` / `deleteExpenseCategory` /
`setCategoryDetails` actions; the create page mutates local state. This is the one
accepted divergence — two thin controllers behind a shared widget (see Tradeoffs).

Layout is flat sections with lightweight headers, not a stepper (matches the chosen
one-screen design). The existing advanced lat/lng disclosure and the dream toggle /
dates / country fields are unchanged.

After a successful create, routing stays `?tab=itinerary` as today (dreams land on
their itinerary variant; the guided dated planner is unaffected).

## Profile tab — demoted, internally unchanged

The Profile tab keeps hosting the **live** `ProfileWizard` for later edits (there the
trip exists, so categories stay live). It is simply no longer where the profile is
*first* filled.

The now-obsolete **onboarding baton** is removed: the `onboarding=1` bias that opened
the wizard on a fresh trip and relabeled its final button "save & plan itinerary →"
is dead once create does first-fill. Drop the `onboarding` prop threading through
`page.tsx` → `ProfileTab` → `ProfileWizard` and the create-form routing that set it.
(If create currently routes straight to `?tab=itinerary`, that path already bypasses
the baton; this just cleans up the unused flag.)

## Tradeoffs

- **Two category editors (accepted).** A live one (Budget + Profile tab) and a local
  one (create). They share the row components; the controllers differ. Chosen
  deliberately by picking the one-save flow — the alternative (create the trip first,
  then reveal the live wizard) would reuse the wizard verbatim but needs two presses
  and a mid-page state swap. One-save is the simpler mental model for the couple.
- **Longer create form.** Flat sections make `/trips/new` taller, especially on
  mobile. Mitigated by all-optional fields and pre-filled category defaults, so a
  quick "jot a dream" is still name + submit.

## Out of scope

- Any change to the Profile-tab wizard's steps or the itinerary planner.
- A stepper on the create page (explicitly chosen against — flat one screen).
- Editing categories' live behavior elsewhere (Budget unchanged).
- Migrating existing trips (nothing to migrate — additive to creation only).
- AI/prompt changes (consumers already read `trip_profile` + categories).

## Open questions

None. Design approved 2026-07-21.
