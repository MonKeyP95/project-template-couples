# One Trip Model, Step 1: Day Numbers Alongside Dates

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every dated itinerary day and location span also carries its day number, every dated trip carries `day_count`, and the database keeps those in sync. Nothing changes on screen.

**Architecture:** One hand-pasted, re-runnable migration. It adds the columns, backfills them, and adds three triggers that derive the numbers from the dates on every write. Because the triggers run in the database, every write path stays in sync with no app code changes: server actions, the five RPCs, promotion, and the edit form. That includes the RPCs' `set constraints all deferred` shuffles and the edit form writing `day_count: null` for dated trips. Step 2 reverses the direction (number becomes the source, date is derived), and step 4 drops the date columns and these triggers.

**Tech Stack:** Supabase Postgres (plpgsql triggers), SQL editor by hand.

**Spec:** `docs/superpowers/specs/2026-10-27-one-trip-model-design.md` (this plan is its step 1 only)

## Global Constraints

- Migration is pasted by hand into the Supabase SQL editor. It must be re-runnable (`if not exists`, `create or replace`, `drop trigger if exists`).
- One shared database for dev and prod: current app code must keep working the moment the migration is pasted.
- No placeholder dates. No visible change to any screen.
- `day_index` is 1-based: `day_date - trips.start_date + 1`.

## Decisions made here (spec left them to the builder)

- **Sync by trigger, not by app writes.** One place keeps both in sync, and the RPCs stay untouched until step 2 rewrites them.
- **`day_index` stays nullable and unchecked in step 1.** Today, moving a trip's start later keeps day dates, so a day can end up before the start (`day_index <= 0`), and dated trips turned dreams keep orphan rows with no start. Rejecting those writes now would break current behaviour. `not null` / `>= 1` arrive in step 2.
- **Unique `(trip_id, day_index)` is added now**, `deferrable initially immediate` like the date one. While the start date is fixed, it is equivalent to the date constraint. The RPCs already run `set constraints all deferred`, so it is deferred with the date constraint.
- **Start date set to null leaves the numbers as they were.** When a dated trip turns dream, its days keep their last position. Step 3 needs that, and it costs nothing.
- **`day_count` for a dated trip mirrors its dates:** `end_date - start_date + 1`. The spec's backfill rule takes `max(...)` with the highest `day_index`. A trigger that recomputes on every trip write can only mirror the dates, so the pre-flight below checks that no day sits outside its trip's dates. If any does, stop and ask.
- **Known visible side effect (edit form only):** the edit form pre-fills its "days" field from `day_count`. On a dated trip it was blank and now shows the trip's length, which matters only when toggling that trip to a dream. Accepted; it is what the spec wants.

## Review Focus

1. Pre-flight finds days before the trip start or after its end. Do not backfill; report the rows and ask.
2. Changing a trip's start date in the edit form (days keep their dates today) must renumber every day and span of that trip.
3. Confirm-and-push, span-with-shift and drag (`set constraints all deferred` + multi-row date updates) must not hit the new unique constraint.
4. Turning a dated trip into a dream must not null its days' `day_index`.
5. Dream trips (`start_date` null) must keep their user-set `day_count` untouched.

---

### Task 1: Pre-flight query (user runs it)

**Files:** none.

- [ ] **Step 1: Hand the user this query to paste into the SQL editor**

```sql
select t.slug, t.start_date, t.end_date, d.day_date
from public.itinerary_days d
join public.trips t on t.id = d.trip_id
where t.start_date is not null
  and (d.day_date < t.start_date or (t.end_date is not null and d.day_date > t.end_date))
union all
select t.slug, t.start_date, t.end_date, l.start_date
from public.itinerary_locations l
join public.trips t on t.id = l.trip_id
where t.start_date is not null and l.start_date is not null
  and (l.start_date < t.start_date or (t.end_date is not null and l.end_date > t.end_date));
```

Expected: zero rows. If any rows come back, stop. Report them and ask the user what to do before Task 2.

---

### Task 2: The migration

**Files:**
- Create: `supabase/migrations/20261027000001_itinerary_day_index.sql`

**Interfaces:**
- Produces (for step 2): columns `itinerary_days.day_index int`, `itinerary_locations.start_index int` / `end_index int`, constraint `itinerary_days_trip_id_day_index_key`, trigger functions `itinerary_days_sync_index()`, `itinerary_locations_sync_index()`, `trips_sync_day_count()`, `trips_renumber_itinerary()`.

- [ ] **Step 1: Write the migration** in this order. The header comment says what and why, matching the repo's other migrations:

1. `add column if not exists`: `itinerary_days.day_index int`, `itinerary_locations.start_index int`, `itinerary_locations.end_index int`.
2. Location check: drop if exists, then add `itinerary_locations_index_span_check`. Both indexes are null or both are set, and `end_index >= start_index`, the same shape as the date check in `20260604000002`.
3. Trigger `itinerary_days_sync_index`: `before insert or update of day_date, trip_id`. It reads `trips.start_date` and, when that is not null, sets `new.day_index := new.day_date - start_date + 1`. Otherwise it leaves `new.day_index` alone.
4. Trigger `itinerary_locations_sync_index`: `before insert or update of start_date, end_date, trip_id`. With a trip start, both indexes follow the dates, or both are null when the span dates are null. Without a trip start, leave them alone.
5. Trigger `trips_sync_day_count`: `before insert or update` on `trips`. When `start_date` and `end_date` are both not null, set `new.day_count := new.end_date - new.start_date + 1`. Otherwise leave it.
6. Trigger `trips_renumber_itinerary`: `after update of start_date` on `trips`, `when (new.start_date is not null and new.start_date is distinct from old.start_date)`. It runs `update itinerary_days set day_index = day_date - new.start_date + 1 where trip_id = new.id`, and the matching update on `itinerary_locations` for spans with dates.
7. Backfill, guarded so a re-run is a no-op:
   - days: `update ... set day_index = d.day_date - t.start_date + 1 from trips t where ... and t.start_date is not null and d.day_index is distinct from (that value)`.
   - locations: same for both indexes, where `l.start_date is not null`.
   - trips: `update trips set day_count = end_date - start_date + 1 where start_date is not null and end_date is not null and day_count is distinct from (that value)`.
8. Unique constraint: drop if exists `itinerary_days_trip_id_day_index_key`, then add `unique (trip_id, day_index) deferrable initially immediate`. It comes after the backfill so it validates real data.

Write every trigger as `drop trigger if exists` + `create trigger`, and every function as `create or replace`. All of them use SECURITY INVOKER (the default); RLS already lets a member update their trip's days and locations.

- [ ] **Step 2: Self-check the file.** Paste every statement twice mentally. A second run must not error (constraints are dropped then re-added, triggers too) and must change zero rows.

- [ ] **Step 3: `pnpm lint` and `pnpm build`.** Expected: clean. No TS changed, so this only proves the tree is still green.

- [ ] **Step 4: User pastes the migration** into the SQL editor and runs it twice. Expected: both runs succeed.

- [ ] **Step 5: Hand the user the success-criterion query.** Expected: every count is `0`.

```sql
select
  (select count(*) from itinerary_days d join trips t on t.id = d.trip_id
    where t.start_date is not null
      and d.day_index is distinct from d.day_date - t.start_date + 1) as day_mismatch,
  (select count(*) from itinerary_locations l join trips t on t.id = l.trip_id
    where t.start_date is not null and l.start_date is not null
      and (l.start_index is distinct from l.start_date - t.start_date + 1
        or l.end_index is distinct from l.end_date - t.start_date + 1)) as span_mismatch,
  (select count(*) from trips
    where start_date is not null and end_date is not null
      and day_count is distinct from end_date - start_date + 1) as count_mismatch;
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261027000001_itinerary_day_index.sql docs/superpowers/plans/2026-10-27-one-trip-model-step-1.md
git commit -m "feat(itinerary): store day numbers alongside dates (one trip model step 1)"
```

---

### Task 3: Sync check on a throwaway trip, then docs

**Files:**
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`

- [ ] **Step 1: User checks in the app on a throwaway dated trip.** Add a day, confirm-and-push onto a taken day, set a location span that pushes, drag a day, then change the start date one day later in the edit form.
- [ ] **Step 2: User re-runs the Task 2 Step 5 query.** Expected: all `0`. This proves the triggers keep sync through every write path, the RPCs included.
- [ ] **Step 3: Docs.** In `docs/TODO.md`, mark step 1 *implemented*, or *verified in-app* once the user confirms. Add a `docs/DECISIONS.md` row: "Step 1 of the one trip model syncs day_index from day_date by trigger, so no app write or RPC changes; step 2 flips the direction."
- [ ] **Step 4: Commit docs.**

## Success Criteria

Verified by Claude:
- `pnpm lint` and `pnpm build` clean.
- The migration file uses only re-runnable statements.

Verified by the user (SQL editor and app):
1. The pre-flight query returns zero rows.
2. The migration runs twice without error.
3. The mismatch query returns `0 / 0 / 0` right after the migration.
4. After add, push, span-push, drag and a start-date change on a throwaway dated trip, the mismatch query still returns `0 / 0 / 0`.
5. Every trip's itinerary looks exactly as before, dated trips and dreams alike.
