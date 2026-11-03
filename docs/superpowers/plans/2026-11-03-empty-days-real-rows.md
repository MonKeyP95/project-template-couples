# Every Day Is a Real Row Implementation Plan

> **For agentic workers:** executed inline (`superpowers:executing-plans`). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every day of a trip (1..length) is a real `itinerary_days` row. An empty day is a row with no title, sub or events. It looks quieter, but you can edit, select, drag and delete it like any other day. The derived "free" rows and their parallel code are deleted.

**Architecture:** One database function, `sync_trip_days(trip)`, owns the invariant: it fills missing numbers 1..length with blank rows, deletes blanks that are unplaced, past the end or sharing a number with another day, and files each blank under its owning location. Statement-level triggers on `itinerary_days`, `itinerary_locations` and `trips` call it, so the many existing writers (add, AI apply, share import, today event, delete, move) need no changes. The `(trip_id, day_index)` unique constraint becomes `initially deferred`, so a planned day can be written onto a blank's number and the trigger removes the blank before commit. The push/span/keep-dates functions treat blanks as gaps (shift planned days only), exactly as they treated missing rows before.

**Tech Stack:** Postgres (Supabase, pasted by hand), Next.js 16 server actions, React 19, dnd-kit.

**Spec:** this conversation, 2026-11-03: "a day is a day; empty days are created as real days and only look different; one set of code"; scope "all of them" (trip create, lengthen, dream How long, basic itinerary).

## Global Constraints

- "Blank" = `not itinerary_day_is_planned(title, sub, events)` (SQL, exists) / `!isPlannedRow` (TS, `src/lib/trips/outside-days.ts`). One definition, no new one.
- Trip length = `greatest(day_count, last planned day_index)` (planned only, so blanks never stretch a trip).
- Blank owner = location whose declared span covers the number, else the unspanned location whose planned days run around it, else none. Same rule as today's `positionOwner`, which moves to SQL.
- Migration is re-runnable; ends with a backfill `sync_trip_days` over every trip.
- No tests framework: verify with `pnpm exec tsc --noEmit`, `pnpm lint`, and pasted SQL checks.

## Review Focus

1. Adding a day onto a **planned** day must still return 23505, so the "push the following days?" prompt still appears. With a deferred constraint, the error arrives at commit; the app reads `error.code` from the same response. Checked in-app (step 2.3).
2. Start later + "keep the dates" (6b) must not push any row below Day 1: `shift_trip_days` shifts planned days only, and blanks are recomputed. SQL check in Task 1.
3. Shortening a trip must not ask about blank days (6a counts planned only, already true), and it must remove the blanks past the end. SQL check in Task 1.
4. A blank must not show up as a real day in readers that assume content: on-the-road today, home today signal, taste summary, share view, AI planner context. Audit in Task 3.
5. Drag: a day dropped on a blank in another location moves there and takes that location. Dropped on a blank in its own location, it reorders.

---

### Task 1: Database invariant (migration `20261103000001_days_are_rows.sql`)

**Files:** Create `supabase/migrations/20261103000001_days_are_rows.sql`

- [ ] Constraint: drop and re-add `itinerary_days_trip_id_day_index_key` as `unique (trip_id, day_index) deferrable initially deferred` (name checked in the step-1 migration).
- [ ] `itinerary_position_owner(p_trip_id uuid, p_index int) returns uuid` (sql, stable): the owner rule above, ties broken by `sort_order`.
- [ ] `sync_trip_days(p_trip_id uuid) returns void` (plpgsql): length as above; delete blanks where `day_index is null or day_index > length or` another row has the same number and is planned or has a smaller id; insert blanks for missing 1..length (`tone 'sand'`, `created_by coalesce(auth.uid(), trips.created_by)`); set each blank's `location_id` to its owner (groups untouched: "Edit together" groups blanks before writing their titles).
- [ ] Triggers: `after insert/update/delete ... for each statement` on `itinerary_days` (three triggers, transition tables), `itinerary_locations` (same), and `after insert or update of start_date, end_date, day_count on trips for each row`. Each calls `sync_trip_days` per affected trip and returns early when `pg_trigger_depth() > 1`.
- [ ] Re-create `shift_and_insert_itinerary`, `set_location_span_with_shift` and `shift_trip_days` so their `v_first`/shift/`max(day_index)` only see planned days. Everything else is unchanged.
- [ ] Backfill: `select sync_trip_days(id) from trips;`
- [ ] Commit. The user pastes the migration, then runs the check queries (in the migration's footer): every trip with a length has exactly `length` placed rows; no duplicate numbers; no blank outside 1..length; no blank unplaced.

### Task 2: Server actions use the invariant

**Files:** Modify `src/lib/trips/actions.ts`, `src/lib/ai/itinerary-actions.ts`

- [ ] Delete `fillLocationSpanDays` and its two calls (sync does it).
- [ ] `addItineraryDay`: keep the 23505 -> `dateTaken` path (it now fires only for planned collisions).
- [ ] `deleteItineraryDay` on a blank: no special case (sync refills it). The UI hides delete on blanks (Task 3).
- [ ] tsc + lint; commit.

### Task 3: One kind of day in the UI

**Files:** Modify `src/app/trips/[slug]/itinerary-tab.tsx`, `src/lib/trips/itinerary-slots.ts`, `src/app/trips/[slug]/unplaced-days.tsx`; delete `src/app/trips/[slug]/empty-day-slot.tsx`

- [ ] Remove `EMPTY_PREFIX`, `tripLength`, `emptyPositions`, `positionOwner`, the timeline `"empty"` kind, the in-group empty rows and `EmptyDaySlot`.
- [ ] Day card: a blank day renders as the quiet row (`{label} · free`, dashed, muted). Pressing it opens the existing day editor. No delete on a blank. A blank takes part in selection and drag like any day.
- [ ] `planDrop`: if `over` is a blank in another location, return `move` to `over.dayIndex` with `over.locationId`. Otherwise reorder within the same location, as today (blanks included).
- [ ] Unplaced day dragged back: target is a blank day's id instead of `empty:<n>`.
- [ ] Reader audit: grep every reader of itinerary days (on-the-road, home today, taste summary, share, AI planner context) and skip blanks wherever a day is shown as content.
- [ ] tsc + lint; commit; update `docs/TODO.md` and add a `docs/DECISIONS.md` row reversing row 257.

## Success criteria

**Verified by Claude:** migration is re-runnable (every statement guarded); tsc and lint clean; no reference to `EmptyDaySlot`/`EMPTY_PREFIX`/`emptyPositions` remains; push/span/shift functions read planned days only.

**Verified by the user (SQL, after paste):**
1. The check queries in the migration footer return 0 rows.
2. Lanzarote has one row per day 1..length.

**Verified by the user in-app:**
1. Lanzarote: every day shows. Empty ones look quiet; pressing one opens the editor; saving makes it a normal day.
2. Select 2+ empty days (sweep), "Edit together", save: they become one block.
3. Add a day onto a planned day: still asks to push; pushing shifts later planned days and the trip grows only if needed.
4. Drag a planned day onto an empty day in another location: it moves and joins that location; its old spot becomes an empty day.
5. Lengthen a trip by 2 days: two empty days appear at the end. Shorten it: they go, and nothing is asked about them.
6. Create a new trip with dates: all its days show as empty days.
7. A dream's "How long" 3 -> 5: Days 4-5 appear as empty days.
8. Start 2 days later + keep the dates (6b): no error; days stay on their dates.
9. On-the-road / home today on an empty day: nothing pretends there is a plan.
