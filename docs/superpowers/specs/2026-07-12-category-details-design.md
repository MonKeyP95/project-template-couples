# Elaborate Categories (per-category details) — Design

**Date:** 2026-07-12
**Status:** Approved, ready for implementation plan

## Problem

The trip profile wizard's category step (step 2) lets you keep/drop/add the
trip's categories, but a category is just a name. The user wants to **drill into
a category and elaborate it** — Food → burgers, sushi; Activities → surfing — so
the profile carries the *specifics*, not only the headline category. Today,
tapping a category row does nothing (only the `×` remove control reacts).

## Purpose and scope

The specifics are **describe-only**: they enrich the trip profile so the AI
helper can use them later. They are **not** budget/expense sub-items and touch
no money. This slice **captures and stores** them; wiring them (and the rest of
the profile) into the AI prompts is a **separate later slice** — see below.

There is no existing per-category detail mechanism to reuse: `ExpenseCategoryRow`
is only `{ id, name, sortOrder }`, and the couple-level `dining_preferences`
(free-text activities/cuisines) is a different axis (durable couple taste, not
this-trip-per-category intent). So this adds genuinely new data, hung off the
existing category row per the user's reuse rule.

## Data model

Extend the existing `expense_categories` row with a string array:

- **Migration** (idempotent; single shared Supabase, so the user pastes it into
  the SQL editor): `supabase/migrations/20260712000001_expense_category_details.sql`

  ```sql
  alter table public.expense_categories
    add column if not exists details text[] not null default '{}';
  ```

  Existing rows get `'{}'`; new rows already default via the column. No RLS
  change — the existing member-gated update policy covers writing `details`.

- `ExpenseCategoryRow` gains `details: string[]`.
- `getTripExpenseCategories` selects `details` and maps `details: row.details ?? []`.
- `addExpenseCategory` selects/returns `details` too (a new category returns
  `[]`) so its returned `ExpenseCategoryRow` still satisfies the type.
- Any other constructor of `ExpenseCategoryRow` the build flags must add
  `details` (expected: only the two above; `createTrip`'s insert relies on the
  column default and needs no change).

Details live with the category row: they survive a rename (same row) and are
removed by the existing `on delete cascade` when the category is deleted.

## Server action

One action, matching the live-write rhythm of add/remove category:

```ts
/** Replace a category's describe-only detail tags. Trims, drops blanks,
 * de-dupes, caps at 20. RLS gates the write to workspace members. */
export async function setCategoryDetails(
  categoryId: string,
  tripSlug: string,
  details: string[],
): Promise<{ error?: string }>
```

It writes the whole array (`.update({ details: clean })`) and
`revalidatePath('/trips/<slug>')`. The client computes the new array (add =
append, remove = filter) and calls this, then `router.refresh()` — last-write-
wins, which is fine for a two-person app. No `array_append` RPC, no read-modify-
write.

## UX (wizard category step)

Inside `CategoryStep` (in `profile-wizard.tsx`), each category becomes a small
expandable unit:

- The header row is two sibling buttons (no nested buttons): the **name button**
  (flex-1, toggles expand) and the **`×` button** (removes the whole category,
  unchanged confirm behavior). A collapsed category with details shows a quiet
  count after the name (e.g. `Food · 2`).
- **One category open at a time** (`expandedId` state). Collapsed rows look
  exactly like today, so the step stays calm and detail is opt-in.
- Expanded, the row reveals its `details` as small removable chips
  (`burgers ×  sushi ×`) plus an **"add specific…"** input (Enter to add; trims
  + de-dupes; ignores blanks). Add and remove each call `setCategoryDetails`
  with the recomputed array and refresh.
- The add-detail input holds its own local text state (per expanded row), so it
  is a small `CategoryRow` component owning `{ detailInput }`.

The add-category input at the bottom of the step is unchanged.

## Consumers / files

- `supabase/migrations/20260712000001_expense_category_details.sql` — new.
- `src/lib/trips/expense-types.ts` — `ExpenseCategoryRow` gains `details`.
- `src/lib/trips/expense-queries.ts` — select + map `details`.
- `src/lib/trips/actions.ts` — new `setCategoryDetails`; `addExpenseCategory`
  select/return `details`.
- `src/app/trips/[slug]/profile-wizard.tsx` — `CategoryStep` rewrite +
  `CategoryRow` component.
- Budget category UI is untouched — it ignores `details`.

## Deferred: profile-aware suggestions (separate slice)

The suggestion helper (`suggestForSurface` / `buildPrompt` in
`suggestion-actions.ts`) currently reads trip name/dates, budget, packing,
itinerary, notes — but **not** the trip profile (idea/vibe/transport) and **not**
the couple's `dining_preferences`. Wiring these category details into the helper
only makes sense as part of a coherent slice that makes the helper
**profile-aware** across surfaces: trip profile (idea + vibe + transport +
category details) + couple taste. That is its own spec. The details captured
here simply light up when it lands.

## Non-goals / YAGNI

- No AI-prompt wiring in this slice.
- No budget/expense linkage; details never affect money or sorting.
- No editing of details in the Budget tab (profile wizard only).
- No per-detail metadata (just strings); no reordering of details.

## Success criteria

- Migration applied; `expense_categories.details` exists, defaulting to `{}`.
- Tapping a category in the wizard expands it; adding "burgers" shows a chip and
  persists across refresh; removing it persists; the collapsed row shows a count.
- Deleting a category still works (and takes its details with it).
- Budget tab unaffected.
- `pnpm lint` and `pnpm build` pass.
