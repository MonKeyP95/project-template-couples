# Home ideas: one table, accept without a call, earlier ideas list

Steps 2 and 3 of the home ideas slice (`docs/TODO.md`), folded together
because both need the link from an idea to the trip made from it. Builds on
step 1 (`2026-11-25-three-home-ideas-design.md`, PR #159).

## Intent

Ideas are worth keeping: one you liked last week should still be there, one
you dismissed should not keep coming back, and one you turned into a trip
should show that it did. Today an idea lives only while it is on a pill.

## Goals

- Every generated idea (each pill set, each typed ask) is saved as its own row.
- Accepting an idea (a trip actually created from it) takes it off the pills
  and marks it, with no AI call.
- A quiet "Earlier ideas · N ›" at the end of the pills opens a list of past
  ideas inside the assistant box; × deletes one for good.
- A new set is told which places were already suggested.

## Non-goals and anti-goals

- No editing ideas, no sharing, no search or filters in the list.
- Opening /home still makes no call unless the pills ran out or the profile
  changed.
- Anti-goal: a list that grows the prompt without limit.

## What the user sees

- Pills and "↻ new ideas" as in step 1, then a quiet "Earlier ideas · N ›"
  (shown when N > 0). N counts ideas not on the pills.
- Tap it: a list opens inside the assistant box, below the pills, newest
  first. One line each: destination, date made (`25 Nov`, en-GB), the first
  line of the description (clamped), and ×. Tap it again to close.
- Tap a line: it expands to the full description with "let's do it".
- An idea made into a trip: faded, "became a trip ›" linking to it, no
  "let's do it".
- × removes the line at once; it is gone after reload.
- "dismiss" on a pill's idea: the pill goes, the idea moves to the list.
- "let's do it", then creating the trip: back on /home that pill is gone and
  the idea sits in the list, marked. Backing out of the form keeps the pill.
- When the last pill goes (dismissed or accepted), a new set of three is made.

## Approaches

- **One `trip_ideas` table, a row per idea (picked).** The pills are the rows
  flagged `on_pills`; the list is the rest. Dismiss, delete and accept are each
  one row change; one copy of every idea.
- Pills on `home_ideas` plus a history copy: two copies to keep in step.
- One growing list on `home_ideas`: no row to link a trip to, whole-list
  rewrites to delete one.

## Design

**Table `trip_ideas`** (new migration, re-runnable, RLS by
`is_workspace_member` for select/insert/update/delete):
`id uuid pk default gen_random_uuid()`, `workspace_id` (cascade), `pill`,
`label`, `body` (text, not null), `plan jsonb not null`,
`on_pills boolean not null default false`,
`trip_id uuid null references trips(id) on delete set null`,
`created_at timestamptz not null default now()`.
`home_ideas` keeps only `fingerprint`. Its `ideas` column is left in place by
this migration so the live site (step 1 code) keeps working between paste and
merge; a one-line cleanup migration after merge drops it. The step 1 set is not
copied over; the first visit makes a new set.

**Fingerprint** = hash of the profile block plus what was learned from trips
(`buildLearnedFromTrips`). The trip list leaves it, so creating or editing a
trip no longer remakes the set. The trip list stays in the prompt so ideas do
not repeat a trip.

**Making a set** (`refreshHomeIdeas(fresh)`): remake when `fresh`, when the
fingerprint changed, or when no row is on the pills. Remaking clears
`on_pills` on the current pills (they move to the list) and inserts three new
rows with `on_pills = true`. The prompt adds "Already suggested: ..." with the
labels of the 30 newest rows. A typed ask inserts one row with
`on_pills = false`, so it shows in the list after it is closed.

**Actions** (all revalidate `/home`, so the page re-renders from the server):
`dismissHomeIdea(id)` clears `on_pills`; `deleteHomeIdea(id)` deletes the row.

**Accept:** "let's do it" adds `ideaId` to the `/trips/new` URL next to `note`
and `idea`. The form passes it to `createTrip` (new optional
`CreateTripInput.ideaId`), which after the trip insert sets that row's
`trip_id` and clears `on_pills` (scoped to the workspace).

**Types:** `TripIdea` gains `id`. Queries return
`{ pills: TripIdea[], earlier: EarlierIdea[] }` where `EarlierIdea` adds
`createdAt` and `tripSlug: string | null`. The list loads the 50 newest.

**UI** (`ideas-line.tsx`): pills and the list come from props (server data);
local state is only which idea is open, the one-off card, the list open/closed,
which list line is expanded, busy and error. No props-to-state copying.

## Constraints

- Shared database: the migration must not break step 1 code on the live site.
- Migrations pasted by hand, re-runnable.
- `"use client"` files import types from `*-types.ts` only.

## Left to the builder

- Exact Tailwind classes for the list, matching the pill row's quiet style.
- Where `EarlierIdea` lives (`suggestion-types.ts` is fine).

## Success criteria

Verified by Claude:
1. `pnpm lint`, `tsc`, `pnpm build` pass.
2. The migration runs twice without error; `trip_ideas` has RLS on with four
   policies.
3. `refreshHomeIdeas(false)` makes no call when the fingerprint matches and a
   row is on the pills; it makes one when none is.
4. `createTrip` with an `ideaId` sets `trip_id` and clears `on_pills` on that
   row; without one it touches no idea.
5. The fingerprint does not include the trip list.

Verified by the user in-app:
1. Paste the migration. Open /home: three pills; no "Earlier ideas" yet.
2. "↻ new ideas": three new pills and "Earlier ideas · 3 ›"; the list shows
   the old three, newest first, with dates.
3. Tap a list line: full text and "let's do it"; tap again closes.
4. × on a line: gone, N drops; reload: still gone.
5. "dismiss" on a pill: pill gone, idea now in the list.
6. "let's do it" on a pill, back out of the form: the pill is still there.
7. "let's do it" on a pill and create the trip: on /home the pill is gone,
   the idea is faded in the list with "became a trip ›" linking to the trip.
8. Creating that trip did not remake the other pills.
9. Dismiss all pills: a new set of three appears.
10. A typed ask's idea appears in the list after dismiss.
11. Phone width: the list fits, no sideways scroll.
