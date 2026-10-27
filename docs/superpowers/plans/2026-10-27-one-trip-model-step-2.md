# One Trip Model, Step 2: Dated Trips Run on Day Numbers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `day_index` / `start_index` / `end_index` become the source of truth for dated trips. Reads derive dates from them, writes and the moving RPCs work on them, and `day_date` / location dates become derived copies. Dated trips look and behave exactly as before.

**Architecture:** One migration flips the step 1 triggers into two-way triggers: a changed index wins and derives the date, and a date-only write derives the index. It also adds index-based overloads of the three moving RPCs next to the date-based ones. App code that is already deployed keeps working the moment it is pasted. The app then reads indexes and converts to dates once in the query layer. Server actions keep their date inputs for now and convert to an index once at the top, so the 2,000-line itinerary tab and the AI planner do not change. Step 3 moves the inputs to numbers when the tab learns "Day N".

**Tech Stack:** Supabase Postgres (plpgsql), Next.js 16 server actions, TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-27-one-trip-model-design.md` (this plan is its step 2 only). Step 1 plan: `docs/superpowers/plans/2026-10-27-one-trip-model-step-1.md`.

## Global Constraints

- Migration is pasted by hand. It must be re-runnable (`create or replace`, `drop ... if exists`).
- One shared database for dev and prod. Paste the migration **before** pushing the code. The deployed code must keep working between paste and deploy.
- `day_index` is 1-based: `date = start_date + day_index - 1`.
- No visible change on a dated trip. Dreams are untouched: they still live in `dream_itinerary_days` until step 3.
- No test runner exists. Checks are `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`, SQL queries, and Node 24 type stripping for pure helpers. Do not add a test framework.
- Do not run `pnpm build` while the user's dev server is running. Ask first.

## Decisions made here (spec left them to the builder)

- **Two-way triggers during the transition.** On insert, a non-null index derives the date, otherwise the date derives the index. On update, a changed index derives the date, otherwise a changed date derives the index. Old date writes, the old RPCs, `promote_dream_to_dated` and `trips_renumber_itinerary` all keep working unchanged. Step 4 drops the date columns and these triggers.
- **Index RPCs are overloads, not renames.** Same function names, and the date parameter becomes `p_from_index` / `p_start_index`+`p_end_index` / `p_indexes`. PostgREST picks the overload by argument names. Step 4 drops the date overloads.
- **`reschedule_itinerary_days(uuid, uuid[])` is dropped, not rewritten.** Nothing in `src/` calls it (`grep '"reschedule_itinerary_days"'` returns nothing); the drag uses `_to`.
- **Start-date change keeps "days stay on their dates".** `trips_renumber_itinerary` is unchanged. Step 6 adds the question.
- **Length grows through `day_count`.** The RPCs and `growTripLength` set `day_count = greatest(...)` and `end_date = start_date + day_count - 1` in one update. `trips_sync_day_count` then agrees with them, and `end_date` readers are unaffected.
- **Actions keep date inputs this step.** Each converts once with `dayIndexOf(date, start)`. Floors become `index >= 1`.
- **No `not null` / `>= 1` constraints yet.** A start moved later still leaves days at index `<= 0`, and dated-turned-dream orphans have null indexes. Those rules arrive with steps 4 and 6.
- **`getItineraryDays` returns `[]` for a trip without `start_date`.** A dream's real days are in `dream_itinerary_days`. The only rows this hides are orphans of a dated trip turned dream, which no screen shows today. Before this change they leaked old dates into AI context on dreams.

## Review Focus

1. **The gap between paste and deploy.** The live code inserts `day_date` only and calls the date RPCs. Every one of those writes must still succeed and keep the index in sync. Checked by the Task 1 mismatch query, run after a write from the deployed app.
2. **A start-date change in the edit form.** Days must stay on their calendar dates, with indexes shifted. Checked in Task 4.
3. **A partner's Realtime update.** A day dragged by the other browser must land on the right date. The payload now gets mapped from `day_index`. Checked in-app (Task 4).
4. **A push past the last day.** It must grow `day_count` and `end_date` together, so the header end date moves exactly as before. Checked by the Task 4 fingerprint.
5. **AI on a dream.** Chat, suggestions and journal must not throw on a trip with null `start_date`. Covered by the `[]` rule and checked in-app.

---

### Task 1: Migration: indexes become the source

**Files:**
- Create: `supabase/migrations/20261027000002_itinerary_index_source.sql`

**Interfaces:**
- Consumes: step 1 columns, constraints and trigger names (`20261027000001_itinerary_day_index.sql`).
- Produces (RPC signatures Task 3 calls):
  - `shift_and_insert_itinerary(p_trip_id uuid, p_from_index int, p_count int, p_title text, p_sub text, p_events jsonb, p_tag text, p_tone text, p_location_id uuid, p_group_name text) returns void`
  - `set_location_span_with_shift(p_location_id uuid, p_trip_id uuid, p_name text, p_start_index int, p_end_index int) returns void`
  - `reschedule_itinerary_days_to(p_trip_id uuid, p_day_ids uuid[], p_indexes int[]) returns void`

- [ ] **Step 1: Write the migration.** Header comment states what and why, in the repo style. Contents in order:
  1. `create or replace function itinerary_days_sync_index()`, made two-way per the Decisions rule. It reads `trips.start_date`; with a null start it changes nothing. Recreate the trigger as `before insert or update of day_index, day_date, trip_id`.
  2. The same for `itinerary_locations_sync_index()`, on the pair (`start_index`, `end_index`) ↔ (`start_date`, `end_date`). Null indexes give null dates. Trigger is `before insert or update of start_index, end_index, start_date, end_date, trip_id`.
  3. The three index overloads. Each is a line-for-line port of the current body (`20260610000002`, `20260604000003`, `20260716000002`), with `day_date` → `day_index`, `start_date`/`end_date` → `start_index`/`end_index`, and date params → int params. The gap arithmetic is unchanged (`v_first - p_from_index` is already an int). The final `update trips` in push and span becomes:
     ```sql
     update public.trips
     set day_count = v_len, end_date = start_date + v_len - 1
     from (select greatest(
       (select day_count from public.trips where id = p_trip_id),
       (select max(day_index) from public.itinerary_days where trip_id = p_trip_id),
       (select max(end_index) from public.itinerary_locations where trip_id = p_trip_id)
     ) as v_len) x
     where id = p_trip_id;
     ```
     (`greatest` ignores nulls. A null `start_date` gives a null `end_date`, which is right for step 3.)
  4. `drop function if exists public.reschedule_itinerary_days(uuid, uuid[]);`
  5. `shared_trip`: the same body, with `row_number() over (order by d.day_index)`. Keep the `grant execute`.

- [ ] **Step 2: Self-check for re-runnability.** Every statement must be `create or replace`, `drop ... if exists`, or `drop trigger if exists` + `create trigger`. Without the parameter names, the two overloads of each RPC differ by type (date vs int), so `create or replace` never replaces the old one.

- [ ] **Step 3: User pastes it twice.** Expected: both runs succeed.

- [ ] **Step 4: User checks the overloads exist.**
  ```sql
  select proname, pg_get_function_identity_arguments(oid)
  from pg_proc where proname in
    ('shift_and_insert_itinerary','set_location_span_with_shift',
     'reschedule_itinerary_days_to','reschedule_itinerary_days')
  order by 1, 2;
  ```
  Expected: 2 rows each for the three (date + int), 0 for `reschedule_itinerary_days`.

- [ ] **Step 5: User adds one day on a throwaway dated trip in the deployed app** (old code, date write), then re-runs the step 1 mismatch query (step 1 plan, Task 2 Step 5). Expected: `0 / 0 / 0`.

- [ ] **Step 6: Commit** the migration and this plan.

---

### Task 2: Read path derives dates from indexes

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts`, `src/lib/trips/location-types.ts`, `src/lib/trips/itinerary-queries.ts`, `src/lib/trips/location-queries.ts`, `src/lib/journal/journal-queries.ts`, `src/app/trips/[slug]/itinerary-tab.tsx` (only `RealtimeRow` and the four Realtime mappers, lines ~105 and ~412-463)

**Interfaces:**
- Produces (client-safe, in `itinerary-types.ts`):
  - `dayIndexOf(dayDate: string, startDate: string): number`, the UTC day difference + 1
  - `dateOfIndex(dayIndex: number, startDate: string): string`, yyyy-mm-dd
  - `ItineraryRow.day_index: number` (replaces `day_date`)
  - `ItineraryDay.dayIndex: number` (new; `dayDate` stays, now derived)
  - `rowToItineraryDay(row: ItineraryRow, startDate: string): ItineraryDay`
  - `withOrdinals` sorts by `dayIndex`
- Produces (`location-types.ts`): `ItineraryLocation.startIndex/endIndex: number | null`; `ItineraryLocationRow.start_index/end_index`; `rowToLocation(row, startDate: string | null)`, where dates are derived when `startDate` and the index are both set, else null.
- Produces (`itinerary-queries.ts`, server): `getTripStartDate(tripId: string): Promise<string | null>`. `getItineraryDays(tripId)` and `getTodayForTrip(tripId, today)` keep their signatures and look the start up themselves. Callers do not change.

- [ ] **Step 1: Check the pure helpers with Node 24 type stripping.** Write `<scratchpad>/index-check.mts` importing from the absolute path of `itinerary-types.ts`, asserting:
  ```ts
  assert.equal(dayIndexOf("2026-03-01", "2026-02-27"), 3)   // across Feb end
  assert.equal(dateOfIndex(3, "2026-02-27"), "2026-03-01")
  assert.equal(dayIndexOf("2026-10-25", "2026-10-25"), 1)
  assert.equal(dateOfIndex(dayIndexOf("2027-01-02", "2026-12-30"), "2026-12-30"), "2027-01-02")
  ```
  Run: `node <scratchpad>/index-check.mts`. Expected: no output, exit 0. (Fails before Step 2: the exports don't exist.)

- [ ] **Step 2: Implement** the types and helpers above. Queries select `day_index` / `start_index, end_index` instead of the dates. `getItineraryDays` orders by `day_index`, returns `[]` when the start is null, and runs the start lookup in parallel with the rows query. `getTodayForTrip` queries `.eq("day_index", dayIndexOf(today, start))` and returns null when there is no start. `getItineraryLocations` maps with the trip's start. `journal-queries.ts` drops its inline days query and calls `getItineraryDays(tripId)`. In `itinerary-tab.tsx`, `RealtimeRow` gets `day_index: number` in place of `day_date`, and the mappers pass `tripStartDate`.

- [ ] **Step 3: Re-run Step 1.** Expected: exit 0.

- [ ] **Step 4: `pnpm exec tsc --noEmit` and `pnpm lint`.** Expected: clean. Any remaining reference to `row.day_date` on an itinerary row is a type error; fix each one.

- [ ] **Step 5: Commit.**

---

### Task 3: Write path writes indexes and calls the index RPCs

**Files:**
- Modify: `src/lib/trips/actions.ts`, `src/lib/trips/share-actions.ts`

**Interfaces:**
- Consumes: Task 1 RPC signatures; Task 2 `dayIndexOf`, `dateOfIndex`, `getTripStartDate`, `rowToItineraryDay(row, start)`.
- Produces: no exported signature changes. Every action's input type stays as it is today.

- [ ] **Step 1: Shared helpers in `actions.ts`.**
  - Delete the private `tripStartDate` and import `getTripStartDate`.
  - Replace `growTripEndDate(tripId, date)` with `growTripLength(tripId: string, lastIndex: number): Promise<void>`. When `lastIndex > (day_count ?? 0)`, it sets `day_count = lastIndex` and `end_date = start ? dateOfIndex(lastIndex, start) : null` in one update.
  - `fillLocationSpanDays(supabase, tripId, locationId, startIndex: number, endIndex: number)` selects and inserts `day_index`. `enumerateDates` goes if nothing else uses it.

- [ ] **Step 2: Convert each writer.** Each action resolves `start` once, converts date inputs with `dayIndexOf`, and writes or filters on index columns only:
  - `addItineraryDay`: the floor is `index >= 1`, with the same error text. The span lookup uses `start_index`/`end_index`, rows carry `day_index`, the select returns `day_index`, then `growTripLength`.
  - `addTodayEvent`: find and insert by `day_index`.
  - `rateEvent`: select `day_index, trip_id, trips(workspace_id, start_date)`. `event_ratings.day_date` gets `dateOfIndex(...)`; that column is a real calendar fact and stays.
  - `insertItineraryDayWithShift`: `p_from_index`.
  - `updateItineraryDay`: writes `day_index`, with the floor as above.
  - `editItineraryBlock`: selects `day_index`. A date `floor` converts once and compares on index.
  - `regroupDays`: order by `day_index`.
  - `rescheduleItineraryDaysTo`: `p_indexes` built from the client's dates.
  - `renameItineraryLocation`: the overlap queries move to `start_index`/`end_index`/`day_index`, and the write sets `start_index`/`end_index`.
  - `setLocationSpanWithShift`: `p_start_index`/`p_end_index`. Fill and grow use indexes.
  - `share-actions.ts` import: locations write `start_index: span.min`, `end_index: span.max`, and days write `day_index: d.ordinal`. Delete its local `addDays` if it becomes unused.

  Leave `createTrip`, `updateTrip` and the dream actions as they are: they write trip dates or dream rows, which the triggers handle.

- [ ] **Step 3: Prove no itinerary write still uses dates.**
  Run: `grep -n "day_date\|start_date\|end_date\|growTripEndDate\|p_from_date\|p_dates\b" src/lib/trips/actions.ts src/lib/trips/share-actions.ts`
  Expected: hits only on `expenses`, `trip_notes`, `event_ratings`, `trips`, and in `createTrip`/`updateTrip`/dream code. None on `itinerary_days` or `itinerary_locations`.

- [ ] **Step 4: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`** (ask first if dev is running). Expected: clean.

- [ ] **Step 5: Commit.**

---

### Task 4: Same behaviour, by query and in-app; then docs

**Files:**
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`

- [ ] **Step 1: Equivalence by query** (spec: "the five functions produce the same day order and end_date as before"). For each of push, span and drag, Claude writes two blocks for one throwaway dated trip that has a few days and a location span. Each block is `begin; select set_config('request.jwt.claims', '{"sub":"<user uuid>","role":"authenticated"}', true);`, then one RPC call (the date overload in A, the index overload with the same position in B), then this fingerprint, then `rollback;`:
  ```sql
  select (select string_agg(coalesce(title,'·') || '@' || day_date || '#' || day_index, ', ' order by day_index)
            from itinerary_days where trip_id = '<trip>') as days,
         (select string_agg(name || ':' || start_index || '-' || end_index, ', ' order by sort_order)
            from itinerary_locations where trip_id = '<trip>') as spans,
         (select end_date || ' / ' || day_count from trips where id = '<trip>') as length;
  ```
  The user runs A and B. Expected: identical output for each pair. Also run `select shared_trip('<token>')` on a shared trip before and after the paste. Expected: the same `days` order.

- [ ] **Step 2: Hand the user the in-app checklist** (success criteria list 2 below), then wait.

- [ ] **Step 3: Docs.** In `docs/TODO.md`, mark step 2 *implemented* (*verified in-app* only after the user confirms). In `docs/DECISIONS.md`, add a row: "Step 2 of the one trip model: indexes are the source and dates are derived by two-way trigger until step 4. Index RPCs are overloads beside the date ones. Actions keep date inputs and convert once until step 3."

- [ ] **Step 4: Commit docs.** After that, push (deploys prod), but only once the migration is pasted (Task 1 Step 3).

## Success Criteria

Verified by Claude:
- `pnpm exec tsc --noEmit`, `pnpm lint` and `pnpm build` clean.
- The Task 2 helper script exits 0.
- The Task 3 Step 3 grep shows no itinerary write on a date column.
- The migration uses only re-runnable statements.

Verified by the user (SQL editor):
1. The migration runs twice without error, and the overload query shows 2/2/2/0.
2. After a write from the old deployed code, the step 1 mismatch query returns `0 / 0 / 0`.
3. The push, span and drag fingerprints match between the date and index overloads, and `shared_trip` day order is unchanged.

Verified by the user in-app (after deploy, on a dated trip):
1. The itinerary shows the same days on the same dates as before.
2. Adding a day, a multi-day block, and a day on a taken date (confirm-and-push) all work as before, including pushing past the last day, which moves the header end date.
3. Setting a location span that overlaps later days pushes them as before.
4. Dragging a day, including into a gap inside a location, lands on the right date; the partner's browser shows the same date via Realtime.
5. Changing the trip's start date one day later in the edit form leaves every day on its calendar date; the mismatch query still returns `0 / 0 / 0`.
6. "Plan your itinerary" walk, Generate, on-the-road "today" and adding a today event behave as before.
7. A dream's page, chat and suggestions still load with no error and no dates.
