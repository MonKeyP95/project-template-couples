# Semi-private packing lists — design

**Date:** 2026-06-15
**Status:** Approved, ready for implementation plan

## Problem

Today every trip has one shared packing list (`packing_items` + `packing_categories`),
readable and writable by both partners. There is no way to keep a *personal* list —
items only you care about (e.g. your meds, your gadgets) — without cluttering the
shared list.

We want **three lists per trip**, selected by a switcher that replaces the current
progress bar:

1. **My list** — your own semi-private items and categories.
2. **Shared list** — today's shared list, unchanged.
3. **Partner's list** — your partner's semi-private items; opening it asks for
   confirmation once per page session.

"Semi-private" means the partner *can* view the list if they choose, but it is not
their default view. Privacy is a UI concern only — the database lets either partner
read both personal lists.

## Data model

Add a single nullable `owner_id` column to **both** existing tables. `null` = shared
(today's behaviour); a user id = personal, belonging to that user.

```sql
alter table public.packing_items
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

alter table public.packing_categories
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;
```

The three views are just the two tables filtered by `owner_id`:

| View            | Filter                          |
| --------------- | ------------------------------- |
| Shared list     | `owner_id is null`              |
| My list         | `owner_id = <me>`               |
| Partner's list  | `owner_id = <partner>`          |

Existing rows get `owner_id = null`, which correctly classifies them as shared — no
backfill needed.

### Category uniqueness gotcha

`packing_categories` currently has `unique (trip_id, name)`. With an added `owner_id`,
we want uniqueness per owner *and* still prevent duplicate shared categories. Postgres
treats two `NULL`s as distinct in a normal unique constraint, so we switch to
`NULLS NOT DISTINCT` (Postgres 15+, which Supabase runs):

```sql
alter table public.packing_categories drop constraint if exists packing_categories_trip_id_name_key;
alter table public.packing_categories
  add constraint packing_categories_trip_owner_name_key
  unique nulls not distinct (trip_id, owner_id, name);
```

This lets each owner (and the shared scope) have its own "Clothes" without collision,
while still blocking two shared "Clothes".

### Item ↔ category linkage

Items link to categories by the existing `category` text column (name match), not an
FK. This stays. Because each view is filtered to a single owner scope, name-matching
within a view only sees that scope's categories and items, so the existing
`groupPackingItems` logic keeps working once it is given the filtered slices.

## RLS

Privacy is enforced in the UI, not the database (matches "both can see it if they
want"). Policies:

- **select** — unchanged, member-gated (`is_trip_workspace_member`). Both partners can
  read all items and categories.
- **insert** — member-gated *and* `owner_id is null or owner_id = auth.uid()`. You may
  create shared rows or rows you own, never rows owned by your partner. Applies to both
  tables.
- **update / delete** — unchanged, member-gated. Consistent with today's collaborative
  model; semi-private is not write-protected.

Migration is idempotent: `add column if not exists`, `drop constraint if exists` before
re-adding, policy creates wrapped in `duplicate_object` guards (matching the repo's
existing migration style).

## UI

### Switcher replaces the progress bar

The clay-tinted header that currently shows `done/total` and the `%` bar is replaced by
a three-segment switcher: **My list · Shared · Partner's list**. No done/total counts in
any view (explicitly dropped). The partner's display name comes from the existing
`members` map.

State: `view: "mine" | "shared" | "partner"`, default `"shared"` (today's list is the
familiar landing view).

### Partner confirmation (once per session)

Tapping the **Partner's list** segment, when not yet confirmed this session, shows a
confirm dialog: "This is {partner}'s list — open it?". On confirm, set a
`partnerUnlocked` boolean in component state and switch to the partner view. The flag
lives in React state only (resets on full page reload = new session). Subsequent taps
switch straight in.

If the trip has no partner / no second member, the Partner segment is hidden.

### Per-view content

Each view renders the existing category-group UI (drag-reorder, add item, add category,
edit, delete) against the owner-filtered slices:

- **Shared** — `owner_id is null` items and categories. Identical to today.
- **My list** — `owner_id = me`. Creating a category or item here sets `owner_id = me`.
- **Partner's list** — `owner_id = partner`. Rendered **read-only in the UI**: no add
  item / add category / edit / delete / drag controls, just the items and their checked
  state. (RLS stays permissive — this is a UI choice so the partner view stays a calm
  "peek", and it sidesteps the fact that an add here would set `owner_id = partner`,
  which RLS rejects anyway.) The done checkboxes are also non-interactive in this view.

## Queries and actions

### Queries (`packing-queries.ts`)

`getPackingItems` / `getPackingCategories` already fetch all rows for a trip; extend the
`select` to include `owner_id` and surface it on the mapped types. The page passes the
full lists to the client tab, which partitions by owner for the three views. (Keeping a
single fetch avoids three round-trips and keeps Realtime simple.)

### Types (`packing-types.ts`)

- Add `ownerId: string | null` to `PackingItem` and `PackingCategory`.
- `groupPackingItems` is unchanged in logic but is called per view with pre-filtered
  `categories` and `items`. Add a small `partitionByOwner(items, categories, me,
  partner)` helper (pure, in `packing-types.ts`) returning the three `{categories,
  items}` slices so the helper stays testable and the client component stays thin.

### Actions (`actions.ts`)

- `addPackingItem(tripId, category, label, owner)` — new `owner: string | null` param;
  insert sets `owner_id`.
- `addPackingCategory(tripId, tripSlug, name, owner)` — new `owner` param.
- `deletePackingCategory`, `reorderPackingCategories` — operate by id; reorder must
  reorder within one owner scope only (the client passes one scope's ids at a time, so
  no signature change beyond what's already there).
- `copyPackingFromTrip` — copies only the **shared** list (`owner_id is null`) on both
  source and target. Personal lists are not copied between trips (out of scope; keeps
  the import unsurprising).
- No new owner flip action — items/categories are created in the view they belong to.
  Moving an item between shared and personal is **out of scope** for v1.

## Realtime

The existing `packing-${tripId}` channel subscribes to all `packing_items` changes for
the trip and already carries the full row. Add `owner_id` to the `RealtimeRow` type and
`fromRow` mapping so live inserts land in the correct view's partition. No channel or
filter changes needed (still filtered by `trip_id`). Categories are not realtime today;
that stays.

## Out of scope (v1)

- Fully-private items (partner cannot read) — semi-private only.
- Moving an item/category between shared and personal after creation.
- Copying personal lists between trips.
- Per-view progress counts.
- DB-level write protection on personal items (RLS stays member-gated; the partner
  view is read-only in the UI only, not enforced server-side).

## Files touched

- `supabase/migrations/20260615000001_packing_owner.sql` — new, idempotent.
- `src/lib/trips/packing-types.ts` — `ownerId` on both types, `partitionByOwner` helper.
- `src/lib/trips/packing-queries.ts` — select `owner_id`.
- `src/lib/trips/actions.ts` — `owner` params; shared-only copy.
- `src/app/trips/[slug]/packing-tab.tsx` — switcher, confirm gate, per-view rendering,
  realtime `owner_id`.
- `src/app/trips/[slug]/page.tsx` — pass partner id / members through if not already.
- `docs/TODO.md`, `docs/DECISIONS.md` — log on completion.
```