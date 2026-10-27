# One Trip Model, Step 4: Delete the Dream Path and the Itinerary Date Columns

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nothing in the app or the database stores an itinerary day or location by date any more. The dream-only table, code, agent and functions are gone. Adding dates to a dream is only setting `start_date`.

**Architecture:** Step 3b already moved every read and write onto day numbers, so this step is mostly deletion. In code: the dream modules and the four dead dream actions go, and Realtime rows map straight through `rowToItineraryDay` / `rowToLocation` with the trip's start, so no row's date column is read. In the database, one migration drops the date columns, the two date-sync triggers, the date-keyed RPC overloads, `dream_itinerary_days`, `reschedule_dream_itinerary_days` and `promote_dream_to_dated`. It rewrites the start-date trigger to shift day numbers by the change in start ("keep the dates", today's behaviour) instead of reading `day_date`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase (hand-pasted SQL).

**Spec:** `docs/superpowers/specs/2026-10-27-one-trip-model-design.md`, step 4. Step 3b plan: `docs/superpowers/plans/2026-10-27-one-trip-model-step-3b.md`.

## Global Constraints

- No visible change on a dated trip or a dream. Same days, dates, labels, pushes, spans, drags, walk and Generate.
- `day_index` is 1-based: `date = start_date + day_index - 1`.
- Migrations are hand-pasted and re-runnable against one shared database (dev and prod). Order for this step: **merge and deploy the code, then paste the migration.** The current `main` is already compatible with the migration (verified below), so the order is a safety margin, not a requirement.
- Kept as calendar facts, untouched: `expenses.day_date`, `trip_notes.day_date`, `event_ratings.day_date`, `trip_dispatch`, `trip_suggestions`, receipt/document entry dates, `trips.start_date` / `end_date` / `day_count`.
- No test runner. Checks are `pnpm exec tsc --noEmit`, `pnpm lint`, greps, and SQL checks the user runs. Ask before `pnpm build` if the dev server runs.

## Decisions made here

- **A start-date change on a dated trip keeps days on their dates** by shifting every `day_index` (and location `start_index` / `end_index`) by `old.start_date - new.start_date`. This is the same result as today's renumber-from-`day_date`. Step 6 adds the "move the plan or keep the dates" question. The trigger fires only when both the old and the new start are set. From null (giving a dream dates) or to null (removing them), no row moves.
- **Date-keyed RPC overloads are dropped by lookup**, not by spelling each old signature. A `DO` block drops every overload of `shift_and_insert_itinerary`, `set_location_span_with_shift` and `reschedule_itinerary_days_to` whose identity arguments contain `date`. Several historical signatures exist (`20260604000001`, `20260610000001/2`, `20260604000003`, `20260716000002`), and this catches all of them and is re-runnable.
- **`day_index` stays nullable.** The spec's model says NOT NULL, but step 6 makes it nullable again for unplaced days. The pre-flight proves there are no nulls today. Adding and then removing the constraint is churn.
- **Realtime reads the trip start from props only.** Before, a row's `day_date` let a partner's open tab follow a start-date change live. Now that tab shows the shifted numbers on the old start until it reloads, at which point it is correct. Start changes are rare and both partners reload often; subscribing to `trips` is not worth a new publication member here.
- **`ItineraryLocation.startDate` / `endDate` stay** as derived fields (from index + trip start). Readers such as find-a-place and the budget drafter keep using them.

## Review Focus

1. **Moving a dated trip's start earlier or later.** Every day and location span keeps its calendar date, and nothing collides on the unique `(trip_id, day_index)`. Pinned by the Task 3 throwaway-trip SQL check.
2. **Push, span and drag after the date overloads are gone.** PostgREST must still resolve each call to the index overload by argument name. Pinned by the Task 3 overload query (only index signatures remain) and in-app item 2.
3. **Dream → dated → dream** with the sync triggers gone: no row moves and no date is written anywhere. Pinned by the Task 3 round-trip check and in-app item 4.
4. **A partner's live edit** on a dream and on a dated trip still renders correctly, without the row's `day_date`. Pinned by in-app item 5.
5. **A stale tab or old bundle** still asking for a dropped column or RPC. Expected: none, because the code is deployed first and already reads no date column. Pinned by the Task 2 Step 5 greps and by the hard reload before the in-app checks.

---

### Task 1: Delete the dream code path

**Files:**
- Delete: `src/lib/ai/dream-itinerary-actions.ts`, `src/lib/ai/dream-plan.ts`, `src/lib/ai/agents/dream-itinerary-planner.ts`, `src/lib/trips/dream-itinerary-queries.ts`, `src/lib/trips/dream-itinerary-types.ts`
- Modify: `src/lib/ai/claude.ts` (drop the `draftDreamItinerary` re-export), `src/lib/ai/registry.ts` (drop `propose_dream_itinerary`), `src/lib/trips/actions.ts` (drop `addDreamItineraryDay`, `updateDreamItineraryDay`, `deleteDreamItineraryDay`, `rescheduleDreamItineraryDays`, their input types, and the `dream-itinerary-types` import at line ~39)

**Interfaces:**
- Produces: no new names. After this task, nothing imports the five deleted modules.

- [ ] **Step 1: Prove they are dead before deleting.**
  Run: `grep -rn "dream-itinerary-actions\|dream-plan\|dream-itinerary-planner\|dream-itinerary-queries\|dream-itinerary-types\|DreamItineraryDay\|draftDreamItinerary" src`
  Expected: hits only inside the five files themselves, `claude.ts`, `registry.ts`, and the dream block in `actions.ts`. Any other hit is a live caller: stop and look at it.
- [ ] **Step 2: Delete and trim** per Files.
- [ ] **Step 3: Grep again (the spec's step 4 criterion, code half):**
  `grep -rn "dream_itinerary_days\|reschedule_dream_itinerary_days\|promote_dream_to_dated\|propose_dream_itinerary\|dream-itinerary\|dream-plan" src`
  Expected: no hits.
- [ ] **Step 4: `pnpm exec tsc --noEmit` and `pnpm lint`.** Expected: clean.
- [ ] **Step 5: Commit.**

---

### Task 2: Realtime maps rows without their date columns

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts` (delete `liveRowToItineraryDay`), `src/lib/trips/location-types.ts` (delete `liveRowToLocation`), `src/app/trips/[slug]/itinerary-tab.tsx` (`RealtimeRow` loses `day_date`; `RealtimeLocationRow` becomes `ItineraryLocationRow`; both handlers call `rowToItineraryDay(row, tripStartDate)` / `rowToLocation(row, tripStartDate)`)

**Interfaces:**
- Consumes: `rowToItineraryDay(row: ItineraryRow, startDate: string | null)`, `rowToLocation(row: ItineraryLocationRow, startDate: string | null)`.

- [ ] **Step 1: Write** `<scratchpad>/live-row-check.mts`:
  ```ts
  const row = { id: "a", day_index: 3, title: "x", tag: "t", tone: "sea" }
  assert.equal(rowToItineraryDay(row, null).date, "Day 3")
  assert.equal(rowToItineraryDay(row, "2026-02-27").dayDate, "2026-03-01")
  const loc = { id: "l", name: "Ubud", sort_order: 0, start_index: 2, end_index: 4 }
  assert.equal(rowToLocation(loc, null).startDate, null)
  assert.equal(rowToLocation(loc, "2025-01-01").startDate, "2025-01-02")
  // the live helpers are gone
  assert.equal("liveRowToItineraryDay" in itineraryTypes, false)
  assert.equal("liveRowToLocation" in locationTypes, false)
  ```
  Import both modules as namespaces (`import * as itineraryTypes`) through the scratchpad alias hook (`alias.mjs`, mapping `@/` to `src/`).
- [ ] **Step 2: Run.** Expected: FAIL on the "gone" assertions.
- [ ] **Step 3: Implement** per Files.
- [ ] **Step 4: Re-run.** Expected: `ok`.
- [ ] **Step 5: Grep (the spec's step 4 criterion, date half):**
  `grep -rn "day_date" src/app/trips/\[slug\]/itinerary-tab.tsx src/lib/trips/itinerary-types.ts src/lib/trips/location-types.ts src/lib/trips/itinerary-queries.ts src/lib/trips/location-queries.ts src/lib/ai/itinerary-actions.ts`
  Expected: no hits. Then `grep -rn "\.from(\"itinerary_days\")\|\.from(\"itinerary_locations\")" -A3 src | grep -n "day_date\|start_date\|end_date"`. Expected: no hits.
- [ ] **Step 6: `pnpm exec tsc --noEmit` and `pnpm lint`.** Expected: clean.
- [ ] **Step 7: Commit.**

---

### Task 3: Migration: drop the date columns and the dream database objects

**Files:**
- Create: `supabase/migrations/20261027000004_drop_dream_path_and_itinerary_dates.sql`

**Interfaces:**
- Produces: `itinerary_days` without `day_date`. `itinerary_locations` without `start_date` / `end_date`. No `dream_itinerary_days`. Only the index overloads of the three moving RPCs. `trips_renumber_itinerary` shifts by the start delta.

- [ ] **Step 1: Write the migration**, in this order, each part re-runnable:
  1. `create or replace function public.trips_renumber_itinerary()`:
     ```sql
     declare v_shift int := old.start_date - new.start_date;
     begin
       update public.itinerary_days set day_index = day_index + v_shift
       where trip_id = new.id and day_index is not null;
       update public.itinerary_locations
       set start_index = start_index + v_shift, end_index = end_index + v_shift
       where trip_id = new.id and start_index is not null;
       return null;
     end;
     ```
     Recreate the trigger with `when (old.start_date is not null and new.start_date is not null and new.start_date is distinct from old.start_date)`. One UPDATE per table shifts every row by the same amount; the deferrable unique constraint is checked at the end of the statement, so the shift never collides with itself.
  2. `drop trigger if exists itinerary_days_sync_index on public.itinerary_days;` and the same for `itinerary_locations_sync_index`, then `drop function if exists` for both functions.
  3. A `DO` block over `pg_proc` (namespace `public`, `proname in ('shift_and_insert_itinerary', 'set_location_span_with_shift', 'reschedule_itinerary_days_to')`, `pg_get_function_identity_arguments(oid) like '%date%'`) that runs `execute format('drop function public.%I(%s)', proname, identity_args)` for each.
  4. `drop function if exists public.reschedule_dream_itinerary_days(uuid, uuid[]);` and `drop function if exists public.promote_dream_to_dated(uuid, date);`
  5. `alter table public.itinerary_days drop column if exists day_date;` and `alter table public.itinerary_locations drop column if exists start_date, drop column if exists end_date;` The dependent unique and check constraints go with the columns.
  6. `drop table if exists public.dream_itinerary_days;`
- [ ] **Step 2: Commit** the migration file (it is pasted after the merge, Task 4).

---

### Task 4: Merge, paste, check

**Files:**
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`

- [ ] **Step 1: Merge the branch to `main` and push** (ask the user first). Wait for the deploy, then hard-reload any open trip tab.
- [ ] **Step 2: Hand the user the pre-flight** (read-only). Expected: every count is 0. If not, stop and ask.
  ```sql
  -- itinerary days with no number, or a number below Day 1
  select count(*) from public.itinerary_days where day_index is null or day_index < 1;
  -- dreams whose old rows never reached itinerary_days (would be lost with the table)
  select count(*) from public.trips t
  where t.start_date is null
    and exists (select 1 from public.dream_itinerary_days r where r.trip_id = t.id)
    and not exists (select 1 from public.itinerary_days d where d.trip_id = t.id);
  ```
- [ ] **Step 3: User pastes the migration once**, then runs the checks. Expected results in the comments:
  ```sql
  -- no itinerary date columns left (expect 0 rows)
  select table_name, column_name from information_schema.columns
  where table_schema = 'public'
    and ((table_name = 'itinerary_days' and column_name = 'day_date')
      or (table_name = 'itinerary_locations' and column_name in ('start_date', 'end_date')));
  -- only index overloads remain (expect 3 rows, none with "date")
  select proname, pg_get_function_identity_arguments(oid) from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('shift_and_insert_itinerary', 'set_location_span_with_shift', 'reschedule_itinerary_days_to');
  -- no function body still reads an itinerary date (expect 0 rows)
  select proname from pg_proc
  where pronamespace = 'public'::regnamespace and prosrc ilike '%itinerary%' and prosrc ilike '%day_date%';
  -- dream objects gone (expect 0 rows)
  select proname from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('promote_dream_to_dated', 'reschedule_dream_itinerary_days')
  union all select tablename from pg_tables where schemaname = 'public' and tablename = 'dream_itinerary_days';
  ```
  Then the throwaway checks (Review Focus 1 and 3). On a scratch dated trip with 3 days starting 2027-01-10, record `day_index` and the derived dates. Then:
  (a) set `start_date = '2027-01-09'`. Expected: indexes 2, 3, 4, so the same calendar dates.
  (b) set `start_date = null, end_date = null`, then `start_date = '2027-03-01', end_date = <start + day_count - 1>`. Expected: indexes unchanged by both updates.
  Delete the scratch trip.
- [ ] **Step 4: Hand the user the in-app checklist** below, then wait.
- [ ] **Step 5: Docs.** TODO: step 4 *implemented* (and the migration applied with its check results), then *verified in-app* once confirmed. Next: step 5 (drag to any day). DECISIONS rows: (a) itinerary positions are numbers only, and the date columns and dream path are gone (the spec's step 4); (b) a start-date change keeps days on their dates by shifting numbers until step 6 asks; (c) `day_index` stays nullable for step 6.
- [ ] **Step 6: Commit docs.**

## Success Criteria

Verified by Claude:
- `pnpm exec tsc --noEmit` and `pnpm lint` clean.
- The Task 2 script exits 0 after failing first.
- The Task 1 Step 3 and Task 2 Step 5 greps return no hits (the spec's step 4 criterion).
- The Task 4 SQL checks return the expected rows (run by the user, read back by Claude).

Verified by the user in-app, after a hard reload:
1. A dated trip's itinerary shows the same days, dates and order as before.
2. On a dated trip and on a dream: add a day, add one on a taken day (push), set a location span that pushes, and drag a day. Each lands where picked and sticks after a reload.
3. Edit trip: move a dated trip's start one day earlier. Every day keeps its calendar date.
4. Give a dream dates: the same plan shows on real dates. Remove them: Day 1..N again, with nothing lost.
5. A partner's added or edited day appears live as the right date on a dated trip and as "Day N" on a dream.
6. The planning walk (Apply and Generate) works on a dream and on a dated trip. The share view of a trip still lists its days.
