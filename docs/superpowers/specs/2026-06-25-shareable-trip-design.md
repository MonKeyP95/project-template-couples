# Shareable Trip — Design Spec

Date: 2026-06-25
Status: Approved for planning

## Summary

Let a couple turn a trip they already planned into a public, read-only,
link-shareable itinerary, and let anyone who opens that link copy it into their
own workspace as a new dated trip. Sharing is one toggle on work the author has
already done; viewing needs no account; the privacy boundary lives in a single
SQL function so sensitive data cannot leak by construction.

This is the acquisition mechanic (person-to-person and social sharing pull in
named, trusting humans) and, as a byproduct, the seed of a future recommendation
pool. A searchable discovery UI is explicitly out of scope for v1.

## Why this, not a recommendation database first

- A public recommendation pool cannot drive acquisition: it depends on content,
  content depends on users, users are what we lack. Circular.
- The shareable trip is useful from user #2, *is* the acquisition mechanic, and
  fills any future pool automatically.
- Contribution must cost ~0 extra effort or nobody does it. The author already
  built the itinerary to plan their own vacation; sharing is one tap on top.
  No separate "write a recommendation" step.

## Non-goals (v1)

- No discovery / browse / search UI. Sharing is link-based only.
- No payment or reward incentive for sharing.
- No trip notes in the public projection (free-text, often private).
- No per-field curation screen (that is new effort; rejected).
- No exact dates, budget, expenses, savings, or member identities in any public
  surface.

## Architecture

The privacy boundary is one `security definer` SQL function. The `anon` role can
execute exactly that function and nothing else; base tables stay fully closed to
anonymous users. If a field is not in the function's SELECT, it physically cannot
reach the public.

- Public read path: route `/t/[token]` (no auth) renders the JSON returned by
  `public.shared_trip(p_token)`.
- Copy path: authenticated RPC `public.copy_shared_trip(p_token, p_workspace_id,
  p_start_date)` clones the projection into a new dated trip in the caller's
  workspace.

Sensitive data already lives in separate tables (`expenses`, `budget_items`,
`savings`, `trip_members`). The projection simply never touches them.

## Data model

No new content tables. One migration adds a sharing handle to `trips` and two
RPCs.

### `trips` columns (add, idempotent)

- `share_token text unique` — null until first shared; random 16+ char base62,
  unguessable, treated as the capability.
- `is_public boolean not null default false`.
- `shared_at timestamptz` — set on first share (for a future "recently shared"
  sort).

Share = set `is_public = true`, mint `share_token` if absent, set `shared_at` if
null. Un-share = set `is_public = false` (token retained, so re-sharing reuses
the same link).

### `public.shared_trip(p_token text)` — projection RPC

`security definer`, `stable`. Returns a single JSON object, or null if no trip
has that token with `is_public = true`.

```
{
  name, country, day_count,
  locations: [ { name, sort_order } ],
  days: [ { ordinal, title, tag, tone, location_name, events: [ { time, text } ] } ]
}
```

- Selected only from `trips`, `itinerary_locations`, `itinerary_days`.
- Structurally absent: `day_date` (only a derived `ordinal`), `created_by`, any
  member join, and every budget/expense/savings table.
- Each day carries its `location_name` so the view groups days under their
  location header; `day_span` is omitted (derivable, unused) to stay minimal.
- `grant execute on function public.shared_trip(text) to anon, authenticated;`
  — and only this grant. No other anon access to any table.

### Copy: no privileged write RPC needed

The copier already has full write rights in their own workspace under existing
RLS — `trips`, `trip_members`, `itinerary_locations`, `itinerary_days` all allow
inserts where the caller is a workspace member and `created_by = auth.uid()`.
The only privileged operation is *reading* the source trip, which `shared_trip()`
already exposes as a safe projection.

So the copy is plain TypeScript in a Server Action: call `shared_trip(token)` to
get the projection JSON, then clone it with ordinary inserts under the caller's
own RLS:

- New `trips` row in the chosen workspace: `name`, `country` from the projection;
  `start_date = p_start_date`; `end_date = start + (day_count - 1)`; fresh unique
  `slug`; `created_by = auth.uid()`; `is_public = false`, `share_token = null`.
  Then a `trip_members` row per workspace member and the default expense
  categories — exactly as `createTrip` does.
- Clone `itinerary_locations` (preserving `sort_order`), build a
  name -> new-id map, then insert `itinerary_days` on consecutive dates from
  `p_start_date` in ordinal order, carrying `title`, `tag`, `tone`, `events`,
  and `location_id` remapped via the name map. Each location's `start_date` /
  `end_date` is set from the min/max date of its days. Every row stamped
  `created_by = auth.uid()`.

This keeps the only `security definer` surface a single read-only function and
reuses the proven `createTrip` insert path.

### Why a full dated clone, not "land as a dream"

Dreams carry only title/sub/tag/tone (`promote_dream_to_dated`), dropping
locations and day events — the richest part of a plan. Asking for a start date
once and cloning directly into a dated trip preserves everything, and "pick your
dates" is the natural first move when adopting someone's itinerary. The public
view hides the author's dates; the copier supplies their own, so there is no
privacy leak.

## Copy flow

1. Viewer on `/t/[token]` taps "Plan my own trip from this."
2. If logged out, sign up / log in, then return to the same token.
3. Pick their own start date and confirm target workspace.
4. The `copySharedTrip` Server Action reads `shared_trip(token)` and clones it
   into a new dated trip in their workspace via normal-RLS inserts.
5. Redirect to their new `/trips/[slug]`, fully editable; one-time toast
   "Copied — make it yours."

## UI / UX

### Author: Share dialog

- A "Share" action in the trip header.
- Toggle "Share this trip publicly" — off by default.
- When on: show the read-only link `/t/<token>` with a copy button and one line:
  "Your budget, expenses, members, and exact dates are never shared — only the
  itinerary."
- Toggle off → link stops working immediately.

### Public view `/t/[token]`

- Stripped read-only itinerary in the existing sand-and-sea look: locations and
  days as a clean timeline.
- "Day 1 / Day 2" labels — never real dates.
- Header: trip name, country, "5 days." No edit controls, no member avatars, no
  budget tab.
- Sticky bottom CTA: "Plan my own trip from this." Logged-out visitors see the
  full plan, hitting sign-up only at the CTA.

### After copy

- Land on the fresh `/trips/[slug]` with a one-time "Copied — make it yours."
  toast.

## Security, RLS & edge cases

- `anon` gets `execute` on `shared_trip` only. No anon `select` on any base
  table. A leaked token exposes only the projection of that one trip.
- The copy path has no privileged write RPC: `copySharedTrip` runs as the
  authenticated caller, so every insert is gated by existing RLS (workspace
  member + `created_by = auth.uid()`). The only `security definer` function is
  the read-only `shared_trip`.
- Token is the capability: 16+ char random, unguessable. Un-sharing revokes by
  flipping `is_public`; the projection RPC returns null unless `is_public = true`.
- Migration idempotent: `add column if not exists`, `create or replace function`,
  `drop policy if exists` then re-create, repeatable `grant`.
- Edge cases:
  - Token for an un-shared or deleted trip → RPC returns null → public page shows
    a calm "This trip isn't shared."
  - Empty itinerary → page shows name + "no plan yet."
  - Copying your own shared trip → allowed; clones normally.

## Files (anticipated)

- `supabase/migrations/2026MMDD000001_shareable_trip.sql` — columns + the
  `shared_trip` read RPC + grant (idempotent, pasted into Supabase SQL editor by
  hand).
- `src/app/t/[token]/page.tsx` — public read-only view (Server Component, no
  auth).
- Share dialog component under `src/components/` + a "Share" entry in the trip
  header, plus a `shareTrip` / `unshareTrip` Server Action.
- `copySharedTrip` Server Action (reads `shared_trip`, clones via normal-RLS
  inserts), with a start-date prompt on the public page.
- `*-queries.ts` / `*-types.ts` pair for the shared-trip projection, following
  the existing client/server split rule.

## Open questions deferred to later phases

- Trip notes as an opt-in public field.
- Discovery / browse / search over shared trips (the "recommendation database"
  skin over this same data).
- Post-trip nudge to share once a trip's dates have passed.
