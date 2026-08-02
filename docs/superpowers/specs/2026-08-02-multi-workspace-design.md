# Multi-workspace and avatar travellers

**Date:** 2026-08-02
**Status:** designed, not implemented

## Problem

One partner wants to plan a trip with someone outside the couple — her mom —
without that trip landing in the couple's shared workspace, and usually without
the mom using the app at all. Today a user belongs to exactly one workspace, and
anyone who holds money must be a real account.

Two independent needs fall out:

1. **A second room.** Mom-trips must not mix with couple-trips: separate trip
   list, separate budget, separate checklists, separate taste profile.
2. **A person who isn't a user.** Mom should be a payer, a saver and a packing
   owner without ever signing in. If she later wants in, inviting her must carry
   her history over rather than starting her from nothing.

Both are wanted. They are separable, and they ship as two slices.

## Current constraints

- `workspace_members` is already a join table with PK `(workspace_id, user_id)`.
  **The database has never forbidden multi-workspace.** Two things do:
  - `accept_invite` raises `'You are already in a workspace'`
    (`20260729000001_accept_invite_leaves_empty_workspace.sql:42`).
  - `getCurrentWorkspace()` does `.limit(1).maybeSingle()`
    (`src/lib/workspace/queries.ts:28`) — the app says *the* workspace, not
    *the active* one.
- 21 files call `getCurrentWorkspace()`, but **all of them funnel through that
  one function**, so the active-workspace notion has a single insertion point.
- `workspaces` and `workspace_members` have **no INSERT policy** — only
  select/update/delete (`20260525000001_phase_2_schema.sql:90-101`). Every
  workspace alive today came from the signup trigger or `accept_invite`, both
  `SECURITY DEFINER`. Workspace creation must therefore be an RPC.
- Trip slugs are unique **per workspace** (`unique (workspace_id, slug)`) and
  every lookup passes a workspace id (`src/lib/trips/queries.ts:62`).
- The settle-up math is already generic over opaque string ids:
  `settlementsByUser` and `expensePaidByUser` are `Record<string, number>` keyed
  by `paidBy`, and the two-member balance takes ids `a` and `b` without touching
  auth (`src/lib/trips/expense-types.ts:71-111`). Redefining `paid_by` from
  "user" to "person" leaves this untouched.
- RLS is membership-based throughout, via `is_workspace_member()`. A second
  workspace is invisible to non-members with **no new policy work**.

## Decisions

**Members and people are different things.** A *member* can sign in and see the
workspace. A *person* is a traveller who can hold money. Every member is a
person; not every person is a member. This split is what makes "plan with mom
but don't include her in the planning" a first-class state rather than a
workaround, and it is what keeps Slice B small.

**Cookie, not URL, for the active workspace.** A `/w/[workspace]/…` route
segment would make links unambiguous and allow two workspaces in two tabs, but
it means moving every route directory and rewriting every internal `Link`,
`redirect` and share URL. That is a large refactor to serve two workspaces.
Rejected.

**Not per-trip ACLs.** Keeping one workspace and hiding trips from mom with
trip-level permissions was considered and rejected: it is a whole permissions
layer, and budget, checklists and the taste profile would still be merged.

**Not a restricted-access account for mom.** Letting mom sign in and see some
surfaces but not others is a per-surface permissions layer. Rejected as the
largest option on the table serving one person. The two supported paths are
*full member* or *avatar*, nothing between.

**Subject columns move; author columns do not.** Of 17 columns referencing
`auth.users`, only 4 describe *who a row is about*. The other 13 describe *who
typed it in*, and an avatar never types anything.

## Slice A — multi-workspace and the switcher

Useful on its own the day it lands. Slice B depends on it.

### Database (one idempotent migration)

- `create_workspace(p_name text) returns uuid` — `SECURITY DEFINER`, mirroring
  `accept_invite`: insert the workspace, insert the caller as `owner`, return
  the id. Grant execute to `authenticated`.
- Replace `accept_invite`: drop the `'You are already in a workspace'` raise and
  the empty-workspace-deletion block. Joining a second workspace is now normal.
  Keep the idempotent early return when the caller is already a member of the
  invited workspace.

### Active workspace

- `src/lib/workspace/active.ts` exporting `ACTIVE_WORKSPACE_COOKIE`, same shape
  as `AI_COOKIE` (`src/lib/ai/ai-mode.ts`) and `TZ_COOKIE`.
- `getCurrentWorkspace()` reads the cookie, **verifies the caller is a member of
  that id**, and falls back to the first membership when the cookie is absent,
  stale, or names a workspace they have left. The other 20 call sites are
  unchanged.
- `GET/POST /api/workspace/switch?to=<id>&next=<path>` — a route handler,
  following `/api/signout`. Validates membership, sets the cookie, redirects to
  `next`. `next` must be a relative path; anything else falls back to `/home`.
  Route handlers are used because server components cannot set cookies.

### Switching UI

- The `Together · Workspace` block (`src/app/home/page.tsx:116`) and the
  identity block in `LeftRail` (`src/components/app-nav.tsx:88-100`) become a
  switcher: current workspace name, the user's other workspaces, and
  "New workspace".
- Each entry posts to the switch route with `next=/home`, because the trip
  currently being viewed does not exist in the workspace being switched to.
- **A workspace of one must look finished, not half-set-up.** Creating a
  workspace does not prompt to invite anyone; the invite is an option, not a
  step. The identity block already degrades to a single member
  (`src/app/home/page.tsx:124`), so no new UI is needed for the solo case.

### Cross-workspace trip links

When `/trips/[slug]` finds nothing in the active workspace, look the slug up
across the caller's memberships. If exactly one workspace has it, redirect to
the switch route with `next=/trips/[slug]`. One mechanism serves both manual
switching and bookmark following. If zero or more than one match, `notFound()`.

### Also in scope

These are stuck-states otherwise:

- `generateInvite` uses the active workspace instead of the hard-coded
  `// MVP: one per user` lookup (`src/lib/workspace/actions.ts:25-31`).
- `renameWorkspace` — `create_workspace` takes a name, but a typo should not be
  permanent. Uses the existing `workspaces_update_owner` policy.

### Out of scope for Slice A

Leaving or deleting a workspace; per-workspace notification settings; anything
about avatars.

### Automatically separate, with no work

Trips, checklists, budget, savings, home currency and the taste/learning profile
are all workspace-scoped already. A new workspace starts blank and teaches
nothing to the couple's profile. Once mom joins, RLS means she sees nothing of
the couple workspace.

### Success criteria — Slice A

Verified by Claude:

- `pnpm build` and `pnpm lint` clean; types check.
- The migration runs twice in the SQL editor with no error.
- `create_workspace('X')` returns a uuid and leaves exactly one
  `workspace_members` row for the caller with `role = 'owner'`.
- `accept_invite` succeeds for a user who already belongs to a workspace that
  contains trips.
- `getCurrentWorkspace()` returns the cookie's workspace when the caller is a
  member of it, and the first membership when the cookie names a workspace they
  are not a member of.
- `/api/workspace/switch` does not set the cookie for a `to` the caller is not a
  member of, and ignores a `next` that is not a relative path.

Verified by the user in-app:

1. The switcher appears in the identity block on both mobile and desktop.
2. Creating a workspace lands you in it, and it is empty.
3. Switching back shows the couple's trips untouched.
4. An invite generated inside workspace #2 joins the invitee to #2, not to the
   couple workspace.
5. A bookmarked trip URL from the other workspace opens the trip instead of
   404ing.
6. A workspace with one member reads as finished, not half-set-up.

## Slice B — avatar travellers

Depends on Slice A.

### The column audit

Of the 17 columns referencing `auth.users`, 4 are *subjects* — who the row is
about — and move to person ids:

| Column | Source |
| --- | --- |
| `expenses.paid_by` | `20260527000001_phase_3_expenses.sql:12` |
| `trip_savings_contributions.user_id` | `20260606000001_savings_contributions.sql:9` |
| `packing_items.owner_id` | `20260615000001_packing_owner.sql:8` |
| `packing_categories.owner_id` | `20260615000001_packing_owner.sql:11` |

The other 13 are *authors* — `created_by` / `added_by` on trips, notes,
itinerary, locations, checklists, categories, budget moves, invites and
workspaces. They stay pointed at `auth.users` and are not touched. An avatar
never authors a row because she never signs in.

### Schema

```sql
create table if not exists public.workspace_people (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  user_id      uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
```

**Backfill one person row per existing `workspace_members` row with
`id = user_id`.** This is the load-bearing trick: every existing value in all
four subject columns stays valid, so the FK can be repointed with no data
migration.

**Linking is explicit, never inferred.** Add a nullable `invites.person_id`, so
an invite can target an existing avatar ("invite Mom") rather than being a bare
link to the workspace. `accept_invite` and `handle_new_user` set `user_id` on
that person row instead of creating a new one. Matching an avatar to an incoming
account by name was considered and rejected — it guesses, and it guesses about
money.

A trigger on `workspace_members` insert creates a person row when the join did
not come through a person-targeted invite, so a plain invite and the signup path
still work unchanged.

### RLS

`expenses_insert` (`20260527000001_phase_3_expenses.sql:33-38`) and
`savings_insert` (`20260616000002_savings_insert_any_member.sql:11-16`) are
already the same shape: a join to `workspace_members` proving the subject
belongs to the trip's workspace. Both get the identical edit — join
`workspace_people` instead. The app already decided a member may log money on
another member's behalf; avatars only widen who counts as a subject.

`workspace_people` needs select/insert/update policies gated on
`is_workspace_member(workspace_id)`.

### Application

- `getCurrentWorkspace()` returns `people` alongside `members`, plus
  `myPersonId`.
- Every payer, saver and packing-owner picker lists people, not members.
- "Add a person" lives in the workspace identity block.
- Promoting an avatar to a member is the existing invite flow with a person
  targeted, so her new account lands on her existing person row and her whole
  history is hers.

### Known risk

For the couple, `person.id == user_id`, so any code still comparing
`paidBy === user.id` keeps working **for them** and breaks **only for avatars**.
These comparisons must be found deliberately by grepping `paid_by` / `owner_id`
/ `user_id` against the signed-in user — testing on the couple's own workspace
will not surface them.

### Accepted limitation

Inviting an avatar later grants **retroactive visibility**: she sees the trips,
notes and budget planned before she joined. Time-boxing access would mean
per-row visibility rules, which is out of scope.

### Success criteria — Slice B

Verified by Claude:

- `pnpm build` and `pnpm lint` clean; types check.
- The migration runs twice with no error, and after backfill every
  `workspace_members` row has a `workspace_people` row with `id = user_id`.
- No existing `expenses`, `trip_savings_contributions`, `packing_items` or
  `packing_categories` row is orphaned by the FK repoint.
- An expense inserted with `paid_by` = an avatar's person id passes
  `expenses_insert`; one with a person id from a different workspace is
  rejected.
- `computeBalance` in `expense-types.ts` returns the same numbers for the same
  data before and after the id change.
- Inserting a `workspace_members` row leaves exactly one person row for that
  user: a new one for an untargeted invite, the targeted one when the invite
  named a person.

Verified by the user in-app:

1. An avatar can be added to a workspace and appears in the payer picker.
2. An expense recorded as paid by the avatar shows her name in the ledger.
3. A savings contribution can be credited to the avatar.
4. A packing item can be assigned to the avatar.
5. Settle-up between two real members still shows the same balance as before.
6. Inviting the avatar and accepting keeps every past expense attributed to her.
