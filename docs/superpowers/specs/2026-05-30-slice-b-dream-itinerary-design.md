# Slice B — Itinerary for dreams (numbered days)

Date: 2026-05-30
Status: approved, pending implementation plan

## Goal

Replace the read-only `DreamItineraryStub` on `/trips/[slug]?tab=itinerary` (dateless
dream trips) with a real, editable, reorderable **numbered-day** itinerary —
feature-parity with dated trips minus the calendar.

A dream is a "someday" trip with `start_date`/`end_date` NULL. The existing
itinerary is keyed entirely on `day_date` (NOT NULL, the unique key, the sort key,
and the display source — ordinal / weekday / short-date all derive from it; the
Slice C reschedule RPC permutes dates). Dreams have no dates, so they get a
parallel position-keyed model.

## Decisions (from brainstorm)

- **Frame: numbered days** (Day 1, 2, 3…), not a loose idea list. Closest to the
  existing card UI.
- **Schema: separate table** `dream_itinerary_days`, keyed by `(trip_id, day_index)`.
  The dated `itinerary_days` table and all its code stay untouched — zero
  regression risk, no nullable-`day_date` forking of shared paths.
- **Reorder: included in this slice** — drag-to-rearrange, mirroring Slice C's
  index-permutation pattern (but on `day_index`, not dates).
- **Fields: tag, tone, title, sub** — the dated card minus the date.

## 1. Data model

New migration file (idempotent — `create table if not exists`, `drop ... if exists`
before re-adding the constraint, `create or replace function`).

```sql
create table if not exists public.dream_itinerary_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_index int not null,
  title text not null check (length(trim(title)) > 0),
  sub text,
  tag text not null check (length(trim(tag)) > 0),
  tone text not null check (tone in ('sea', 'clay', 'moss', 'sand')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists dream_itinerary_days_trip_idx
  on public.dream_itinerary_days (trip_id, day_index);

alter table public.dream_itinerary_days
  drop constraint if exists dream_itinerary_days_trip_id_day_index_key;
alter table public.dream_itinerary_days
  add constraint dream_itinerary_days_trip_id_day_index_key
  unique (trip_id, day_index) deferrable initially immediate;
```

- RLS: enable + four policies (select / insert / update / delete) reusing
  `public.is_trip_workspace_member(trip_id)`, with `created_by = auth.uid()` on
  insert — byte-for-byte the shape of the `itinerary_days` policies.
- Add the table to the `supabase_realtime` publication (partner sync).
- **RPC `reschedule_dream_itinerary_days(p_trip_id uuid, p_day_ids uuid[])`** —
  exact mirror of `reschedule_itinerary_days`, but the slots are the existing
  indices sorted (`1..N`) and `p_day_ids[i]` takes slot `i`. `set constraints all
  deferred` so the single permuting `UPDATE` doesn't trip the unique check. Count
  guard raises if id count != row count.

User action required after merge: paste the migration into the Supabase SQL Editor.

## 2. Types + query layer

Mirrors the `itinerary-types.ts` / `itinerary-queries.ts` split so the client
bundle never pulls `next/headers`.

`src/lib/trips/dream-itinerary-types.ts`
- `DreamDay { id: string; dayIndex: number; d: string; title: string; sub: string;
  tag: string; tone: ItineraryTone }` — `d` is the padded ordinal (`"01"`),
  derived from sort position. **No `dow` / `date` / `dayDate`.**
- `DreamRow` (raw select shape), `rowToDreamDay(row)`, `withDreamOrdinals(days)`
  (sort by `dayIndex`, re-pad `d`). Reuses `ITINERARY_TONES` / `ItineraryTone`
  from `itinerary-types.ts`.

`src/lib/trips/dream-itinerary-queries.ts`
- `getDreamItineraryDays(tripId)` — select ordered by `day_index`, map through
  `rowToDreamDay` + `withDreamOrdinals`.

## 3. Server actions (append to `src/lib/trips/actions.ts`)

Four, mirroring the dated twins:
- `addDreamItineraryDay({ tripId, tripSlug, title, sub, tag, tone })` — inserts at
  `day_index = max(day_index) + 1` (1 if empty). Returns the inserted row as
  `DreamDay`; `{ error }` on validation failure.
- `updateDreamItineraryDay({ dayId, tripSlug, title, sub, tag, tone })` — no date,
  no `23505` concern (index isn't user-edited).
- `deleteDreamItineraryDay(dayId, tripSlug)` — throws-on-error form-action shape.
- `rescheduleDreamItineraryDays(tripId, tripSlug, dayIds[])` — calls the RPC;
  returns `{ error }` on failure (caller reverts optimistic state).

Realtime broadcasts handle add/update/delete cross-device sync; reschedule relies
on the channel too. No `revalidatePath` needed on the realtime'd actions (matches
the dated path).

## 4. Client component — `src/app/trips/[slug]/dream-itinerary-tab.tsx`

`"use client"`, mirrors `itinerary-tab.tsx`:
- Optimistic `days` state seeded from `initialItems`, `lastInitial` prop-sync
  guard, Supabase realtime channel on `dream_itinerary_days` filtered by `trip_id`.
- `@dnd-kit` sortable list with grip handle (view-mode only); `onDragEnd` does
  optimistic `arrayMove` + `withDreamOrdinals` (reassign `day_index` by position),
  then `rescheduleDreamItineraryDays`, revert on error.
- Add row (dashed `+ add day` → form), click-to-edit (`✎`), native-confirm delete
  (`×`). `editingId` lifted; `DayView` / `DayEditor` split to sidestep the
  React 19 set-state-in-effect lint.

Card/form are the dated ones **minus the date**:
- `DayView` left column shows `DAY / {d}` only (no weekday line); the card drops
  the top-right short-date. Keeps tag badge, title, sub, tone left-border.
- `DayForm` drops the date `<input>`; keeps tag, tone, title, sub.

**Component-sharing decision:** keep `dream-itinerary-tab.tsx` self-contained (its
own card/form helpers) rather than extracting shared `DayForm` / `DayView` out of
the working dated file. Slightly more markup; zero regression risk to the dated
path; each file stays readable alone. Extracting a shared presentational form is a
clean follow-up if the duplication bites.

## 5. Wiring `src/app/trips/[slug]/page.tsx`

- The itinerary data fetch branches on `header.startDate === null`:
  fetch `getDreamItineraryDays(header.id)` for dreams, `getItineraryDays` for
  dated trips (as today).
- The `activeTab === "itinerary"` render: when `header.startDate === null`, render
  `<DreamItineraryTab tripId tripSlug initialItems={...} />` instead of
  `<DreamItineraryStub />`. Delete `DreamItineraryStub`.
- The `"N days"` tab count works unchanged (`.length` on either shape).
- Dated-trip branch (`<ItineraryTab>`, weather strip) untouched.

## Non-goals for Slice B (this slice)

- **Dream→dated conversion on promotion is Slice B.2, not this slice** — see below.
  Until B.2 ships, promoting a dream that has dream days leaves those rows on the
  `dream_itinerary_days` table (harmless; B.2 will move them). You can't convert
  days that don't exist, so dream-day CRUD has to land first.
- No date-range validation (N/A for dreams).
- No AI suggestion wiring (Phase 5).

## Slice B.2 — Promotion converts dream days to dated days (designed, built next)

The vision: when a user adds a **start date** to a dream (promoting it to a real
trip), the numbered dream days convert into consecutive dated days, so the planning
isn't lost.

- **Trigger:** the existing promotion path — `updateTrip` in `actions.ts` — when a
  trip transitions from dream (null dates) to dated AND it has
  `dream_itinerary_days` rows.
- **Date assignment:** day_index 1 → `start_date`, 2 → `start_date + 1`, … i.e.
  `day_date = start_date + (day_index - 1)`. Consecutive dates are always unique, so
  no `(trip_id, day_date)` collisions.
- **End date is auto-derived**, not user-entered: `end_date = start_date +
  (dreamDayCount - 1)`. The trip is exactly as long as the planned dream days —
  "until the end of the dream plan." The promotion UX collects only a start date
  for dreams that have planned days; the edit-trip form hides/auto-fills the end
  date in that case.
- **Move, don't copy:** insert the converted rows into `itinerary_days`, delete the
  `dream_itinerary_days` rows, in one transaction (RPC) so a dream is never both.
- **Edge case — zero dream days:** a dream with no planned days promotes via the
  normal both-dates flow (nothing to derive an end date from).
- **No schema change** — B.2 is purely a server-action/RPC over the two tables this
  slice creates. That's why the data model here already accounts for it.

## Files touched

New:
- `supabase/migrations/20260530000001_slice_b_dream_itinerary.sql`
- `src/lib/trips/dream-itinerary-types.ts`
- `src/lib/trips/dream-itinerary-queries.ts`
- `src/app/trips/[slug]/dream-itinerary-tab.tsx`

Edited:
- `src/lib/trips/actions.ts` (four actions appended)
- `src/app/trips/[slug]/page.tsx` (fetch branch + render swap, delete stub)
