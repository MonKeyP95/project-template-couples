# Trip profile overview — design

Date: 2026-07-13

## Problem

The trip **Profile** tab drops the user straight into the 4-step editing wizard
(`ProfileWizard`). There is no way to simply *see* the profile you already
entered — idea, categories + details, transport, vibe — without stepping through
the wizard screens. The user wants a read-only overview they can glance at, and
edit only on demand.

## Approach

Profile tab lands on a **read-only overview card**. An **"Edit profile"** button
swaps in the existing wizard. Saving (or cancelling) the wizard returns to the
overview. No schema change, no server change — it renders the same `profile` +
`expenseCategories` props the tab already receives.

## Behavior

- **Default view**: the overview card (read-only).
- **Edit**: the "Edit profile" button swaps the card for `<ProfileWizard>`, whose
  flow is unchanged (4 steps, live category writes, text fields saved on the last
  step).
- **Return to overview — two paths**:
  1. **Save** on the wizard's last step (on success) returns to the overview so
     the user sees the result.
  2. **Cancel** — the wizard's step-0 Back button (currently just `disabled` on
     step 0) becomes a "cancel" that returns to the overview without a text-field
     save.
- Category add/remove/detail edits remain **live** in the wizard exactly as today
  (they call `addExpenseCategory` / `deleteExpenseCategory` / `setCategoryDetails`
  directly). Neither return path undoes them.

## Components

### `ProfileTab` (existing, `src/app/trips/[slug]/profile-tab.tsx`)

Already a client component. Gains one `editing` boolean state. Renders either:

- `<ProfileOverview profile={profile} categories={expenseCategories} onEdit={() => setEditing(true)} />`, or
- `<ProfileWizard … onDone={() => setEditing(false)} />`

Notes tab stays below, unchanged.

### `ProfileOverview` (new, in `profile-tab.tsx` or a sibling file)

Read-only summary. Props: `{ profile: TripProfile; categories: ExpenseCategoryRow[]; onEdit: () => void }`.

Sections, **each hidden when its data is empty**:

- **Idea** — `profile.idea` as a `t-display` heading.
- **Categories** — one row per `categories[]`: the name, and its `details[]`
  rendered inline as `name · detail, detail` (or as chips). Categories are always
  seeded, so this section is effectively always present.
- **Getting around** — `profile.transport[]` as chips.
- **Vibe** — `profile.vibe[]` as chips.
- **Edit profile** button, bottom-right.

**Empty state**: when `idea` is blank *and* `transport` and `vibe` are both empty,
show a quiet prompt ("No profile yet — add a few details") and the button label
reads **"Set up profile"** instead of "Edit profile". (Categories may still list
the seeded defaults; that is fine.)

### `ProfileWizard` (existing, `profile-wizard.tsx`) — minimal change

Add one **optional** `onDone?: () => void` prop:

- In `save()`, on success, call `onDone?.()` instead of (or in addition to) the
  current stay-and-`router.refresh()`. The router refresh is still needed so the
  overview re-renders with fresh server props; `onDone` flips the tab back to the
  overview.
- The step-0 Back button, when `onDone` is provided, becomes a **cancel** that
  calls `onDone()` (instead of being `disabled`). When `onDone` is absent,
  behavior is unchanged (Back disabled on step 0).

If `onDone` is not passed, the wizard behaves exactly as it does today.

## Styling

Reuse the wizard's existing tokens: `t-display` for the idea heading, mono
uppercase micro-labels for section titles, `rounded-xl border-rule` chips for
transport/vibe/detail tags, and `bg-foreground text-background` for the Edit
button. Match the wizard's `px-5 pt-5 lg:px-10 lg:pt-6` section padding so the
overview and wizard occupy the same footprint.

## Out of scope

- No schema/migration, no new server action, no change to how the profile is
  stored or parsed (`parseTripProfile` unchanged).
- No change to the Notes tab or the Budget categories editor.
- No new "planning vs on the road" branching — the overview is a pure display of
  saved data, identical in both modes.

## Files

- `src/app/trips/[slug]/profile-tab.tsx` — add `editing` state; render overview
  or wizard; add `ProfileOverview` (here or a sibling `profile-overview.tsx`).
- `src/app/trips/[slug]/profile-wizard.tsx` — add optional `onDone` prop; wire
  save-success and step-0 Back to it.

No migration. Build + lint must stay clean.
