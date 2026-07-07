# Couple profile on the category spine — slice 4 design

**Date:** 2026-07-07
**Status:** design approved; plan next.
**Roadmap:** item 4 of the two-level-profile vision
(`docs/superpowers/specs/2026-07-07-two-level-profile-vision.md`).
**Builds on:** slice 2 (couple `activities` on `dining_preferences`, `/profile`
promoted into nav).

## Goal

Reorganize the couple-taste zone of `/profile` onto the app's category spine —
**Food / Accommodation / Transport / Activities** — as collapsible accordion
sections. Populate **Food** and **Activities** from the existing
`dining_preferences` row; show **Accommodation** and **Transport** as empty
labelled homes with no fields. Presentation-only: no schema, no dependencies,
no new AI consumer.

## Scope

This is a presentational IA slice. The single non-cosmetic change is splitting
the one save action into two so each populated section saves independently.

**In scope**
- Restructure the couple-taste zone of `/profile` into four accordion sections.
- Split `saveDiningPreferences` into `saveFoodPreferences` + `saveActivities`.
- A small dedicated client accordion component for the profile category panels.

**Out of scope (explicitly)**
- No new columns for Accommodation / Transport — no consumer exists yet (that
  is slice 5's paired discovery door; the rule is a profile section ships with
  its discovery door).
- No AI wiring changes; the discovery route already reads food + activities.
- No sub-nav or routing changes; `/profile` stays one page.
- `vibe` stays under Food (it is the food vibe).
- The account zone (display name, email, member-since, AI toggle) is unchanged.

## Page shape (`/profile`)

Two zones, top to bottom:

1. **Account zone (unchanged):** the display-name form, the email /
   member-since list, and the AI toggle, exactly as today.
2. **Couple-taste zone (reorganized):** four collapsible category sections
   replacing today's single flat dining form.

## The four sections

Each is a collapsible panel with an always-visible header (category name + a
muted state hint) and a body that expands/collapses.

- **Food** — budget (select) / vibe / dietary / cuisines. Own **Save food**
  button inside the panel. Header hint: none when populated.
- **Activities** — the activities field. Own **Save activities** button.
- **Accommodation** — empty labelled home. Body is a single muted line:
  "Nothing here yet — this will hold what you look for in a place to stay."
  No fields, no Save.
- **Transport** — empty labelled home. Body: "Nothing here yet — this will
  hold how you like to get around." No fields, no Save.

**Default open/closed:** Food expanded on load; Activities, Accommodation, and
Transport collapsed. Each panel toggles independently (its own local state).
Empty panels (Accommodation, Transport) show a muted "empty" hint in the
collapsed header so they read as intentional, not broken.

## Accordion component

`manual-section.tsx`'s `Section` does **not** fit: it always renders a
mandatory prose paragraph, its toggle *reveals extra detail* rather than
collapsing the whole body, and it has no per-section default-open control. So
this slice adds a small dedicated client component (e.g.
`src/app/profile/profile-category.tsx`, `"use client"`):

- Props: `title`, an optional `hint` (the collapsed-state muted line, e.g.
  "empty"), `defaultOpen?: boolean`, and `children` (the panel body).
- Renders an always-visible header row (title + hint + a chevron/`more`/`less`
  affordance) and, when open, the `children` body below it.
- Local `useState(defaultOpen ?? false)`; each instance independent. No
  cross-section coordination, no URL state.

Server-rendered forms are passed as `children`; the component only toggles
visibility. Follows the existing warm design tokens (mono kicker / serif or
`t-display` title, muted hints), matching the Manual page's visual language
without reusing its component.

## Save model

Split the current single action (which upserts all five columns) into two
server actions on the same `dining_preferences` row, each in
`src/lib/preferences/dining-actions.ts`:

- `saveFoodPreferences(formData)` — upserts `workspace_id`, `budget_band`,
  `vibe_tags`, `dietary`, `cuisines`, `updated_at`, `onConflict: "workspace_id"`.
- `saveActivities(formData)` — upserts `workspace_id`, `activities`,
  `updated_at`, `onConflict: "workspace_id"`.

Both call `getCurrentWorkspace()` (return early if none), use the server
client, and `revalidatePath("/profile")` — same shape as today's
`saveDiningPreferences`, just narrowed columns.

**Partial upsert is safe.** Supabase upsert emits `INSERT ... ON CONFLICT DO
UPDATE`; the `DO UPDATE SET` touches only the columns in the payload, so saving
one section never clobbers the other's columns on an existing row. On first
insert (no row yet), the omitted columns take their table defaults
(`budget_band` default, `'{}'` arrays), which matches
`EMPTY_DINING_PREFERENCES`.

`saveDiningPreferences` is replaced by these two (no remaining caller once the
page is restructured). `dining_preferences` schema, `DiningPreferences` /
`EMPTY_DINING_PREFERENCES` types, `parsePreferenceList`, `normalizeBudgetBand`,
and `getDiningPreferences` are all untouched.

## Data flow

`ProfilePage` (server) still loads `getDiningPreferences(workspace.id)` once and
passes the values into the section forms as `defaultValue`s exactly as today.
The Food form posts to `saveFoodPreferences`; the Activities form posts to
`saveActivities`. Each form keeps its own `key` derived from its fields (as the
current form does) so a server refresh re-seeds the inputs.

## Files

- **Modify** `src/app/profile/page.tsx` — replace the single dining form with
  the four accordion sections (account zone unchanged).
- **Modify** `src/lib/preferences/dining-actions.ts` — replace
  `saveDiningPreferences` with `saveFoodPreferences` + `saveActivities`.
- **Create** `src/app/profile/profile-category.tsx` — the collapsible panel
  client component.

## Principles honored

- **Reuse, don't duplicate:** Food/Activities remain the same
  `dining_preferences` row and the same parse/normalize helpers; only the form
  layout and the save entry points change.
- **YAGNI:** Accommodation/Transport get labels only — no columns, no capture,
  until slice 5 gives them a consumer.
- **Suggest-only, one AI seam:** no change to `lib/ai` or the discovery route.
