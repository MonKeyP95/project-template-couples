# Edit-trip profile becomes a walkthrough — design

**Date:** 2026-07-28
**Status:** approved, not yet implemented

## Problem

`/trips/new` captures the trip profile (idea, vibe, categories, getting-around) as a
guided walkthrough — one question per screen, back/next. `/trips/[slug]/edit` captures
the same four fields as a flat section with everything visible at once. The user wants
the walkthrough on the edit page too, with back/forward navigation.

This reverses the `docs/DECISIONS.md` row of 2026-07-22, which chose flat for edit on
the reasoning that "edit is a quick-change surface, unlike create's guided walkthrough."
That row is superseded: the user prefers the same rhythm on both pages. The
quick-change concern is answered by keeping the basics block flat and letting save work
from any step (see below), not by flattening the profile.

## Scope

In scope:

- A shared walkthrough component used by both `/trips/new` and `/trips/[slug]/edit`.
- Replacing the flat profile section in `edit-trip-form.tsx` with that walkthrough.
- No visible change to `/trips/new`.

Out of scope:

- The basics block (name, slug, dream checkbox, dates, country, lat/lng) stays a plain
  always-visible form above the walkthrough on both pages. Dates and slug are the
  fields `/edit` is most often opened to change; burying them behind steps would cost
  clicks and would stop matching create.
- Unifying the two forms wholesale. They diverge on slug derivation, the
  dream-promotion date preview, and the delete form — too much for this change.
- Any server-action, schema, migration, dependency, or AI-prompt change.

## Design

### New component

`src/app/trips/profile-walkthrough.tsx` (`"use client"`), beside the existing
`profile-fields.tsx`.

It is **controlled**: it owns only which step is showing. Every profile value lives in
the parent, so both pages keep their existing single-save server action untouched.

```
ProfileWalkthrough props
  value        { idea, vibe, vibeNote, transport, categories }
  onChange     (patch: Partial<value>) => void
  disabled     boolean
  extraStep?   React.ReactNode   // create's Review recap, appended as a last step
  finalAction? React.ReactNode   // replaces "next" on the last step
```

Step count is `4 + (extraStep ? 1 : 0)`.

The component renders three parts, all lifted verbatim from today's `new-trip-form.tsx`
so the create page's appearance does not change:

1. The header — `step N of M` counter and the progress bars.
2. The step body in its `min-h-[220px]` box, reusing `StepShell`, `OptionRow`, and
   `LocalCategoryEditor` from `profile-fields.tsx`. Steps, in order:
   Describe this trip → What's the vibe? → What's this trip made of? →
   How will you get around?
3. The footer — `back` on the left (disabled on step 1); on the right, `next`, or
   `finalAction` when one is supplied and the last step is showing.

When no `finalAction` is supplied, `next` is disabled on the last step.

### `new-trip-form.tsx`

Behavior identical to today. It keeps all its state and its `create()`, drops the
stepper JSX (roughly lines 245–411), and renders:

```
<ProfileWalkthrough
  value={...} onChange={...} disabled={isPending}
  extraStep={<review recap/>}
  finalAction={<><cancel/><create trip button/></>}
/>
```

The `cancel` button moves into the `finalAction` slot so the footer stays visually the
same. The review recap keeps counting vibe tags only, as today.

### `edit-trip-form.tsx`

The flat Profile section (currently lines 307–379) is replaced by:

```
<ProfileWalkthrough value={...} onChange={...} disabled={isPending} />
```

Four steps, no review, no `finalAction`. The existing form footer (`cancel` /
`save changes`) stays where it is and stays enabled on every step. Because all five
profile values live in the parent regardless of which step is visible, saving from step
2 still writes vibe *and* categories *and* transport — the payload sent to `updateTrip`
is unchanged.

The step resets to 1 on each page load: local state, not reflected in the URL.

`updateTrip` is not touched. No migration, no new dependency.

## Risks

The real risk is a **silent field drop** while moving the JSX — the same class of bug as
the earlier `vibeNote` threading, where a new field had to be wired into both forms by
hand. The extraction removes that duplication permanently, but the move itself must be
verified field by field.

## Verification

`pnpm lint` and `pnpm build` clean, then in-app with a logged-in session:

1. Open `/edit` on an existing trip with a filled profile. Confirm each of the four
   steps is **pre-filled from saved data** (idea text, vibe chips, the free-text vibe
   note, categories with their details, transport chips).
2. Confirm `back` and `next` move between steps and `back` is disabled on step 1.
3. Change one field on step 2, press `save changes` **from step 2** without visiting
   steps 3 and 4.
4. Reload `/edit`. Confirm the step-2 change persisted and that categories and
   transport are unchanged.
5. Create a new trip end to end. Confirm `/trips/new` looks and behaves as before,
   including the Review step and the create button.

## Follow-up

- Update the 2026-07-22 `DECISIONS.md` row — it currently asserts flat-is-correct for
  edit — and add a row for this change.
- Add a `docs/TODO.md` entry.
