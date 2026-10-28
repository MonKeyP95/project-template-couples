# One Trip Model, Step 6b: Move the Plan or Keep the Dates

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Changing a dated trip's start date asks "move the plan with the new dates, or keep days on their dates?" and each choice does what it says. Today only "keep the dates" exists, silently, through a trigger.

**Architecture:** Drop the `trips_renumber_itinerary` trigger. The shift becomes an explicit RPC (`shift_trip_days`) that `updateTrip` calls only for "keep the dates", after the trip update succeeds. `updateTrip` asks via its result (same round-trip pattern as 6a's `outsidePlanned`); `keptRange` learns which choice was made, so 6a's outside question still sees the right days. "Move the plan" changes no itinerary row: Day 1 simply becomes the new start.

**Tech Stack:** Next.js 16 server actions, Supabase Postgres (hand-pasted migration), React 19.

**Spec:** `docs/superpowers/specs/2026-10-27-one-trip-model-design.md`, "Changing a trip's dates" and step 6. Step 6a plan: `docs/superpowers/plans/2026-10-28-one-trip-model-step-6a.md`.

## Global Constraints

- **Move the plan:** `day_index` and location spans unchanged. **Keep the dates:** every placed `day_index` and every location span shifts by `old start - new start` (exactly what the trigger did); unplaced days (`day_index` null) never move.
- When to ask (Claude's call): a dated trip (old start set), new start set and different, and the trip has at least one placed day or one location with a span. Otherwise no question; nothing is shifted.
- Order of questions: start question first, then 6a's outside question if planned days still fall outside under the chosen option. The start choice is carried into the second resend.
- Order of writes for "keep": settle outside (6a, current numbering) → trip update → `shift_trip_days`. If the shift fails, the trip is saved with the plan moved (a valid state) and the error says so: `Dates saved, but the days could not be kept on their dates (the plan moved with the start): <msg>`. Claude's call: the failure lands in a state the user could have chosen.
- Giving a dream dates, removing a trip's dates, and changing only the end ask nothing new (unchanged behaviour).
- Copy in the form; dates `en-GB`, day before month, via the form's existing `fmtPreview`.
- Migration re-runnable, pasted by hand into the shared database. **Deploy order:** paste, then merge and deploy straight away; nobody changes a trip's start date in between (deployed 6a code with the trigger gone would unplace days the trip no longer shifts).
- No test runner. Checks: `pnpm exec tsc --noEmit`, `pnpm lint`, Node 24 script for the pure helper (`node --import ./alias.mjs <file>.mts` from the scratchpad, with an `alias.mjs` hook mapping `@/` to `src/`; recreate it from the 6a pattern if this session's scratchpad lacks it). No `pnpm build` while the dev server runs.

## Review Focus

1. **Start later + keep the dates, with planned days before the new start.** Start question, then outside question; after "keep as unplaced" the remaining days keep their calendar dates and the unplaced ones are not shifted (the RPC filters `day_index is not null`). Pinned by the Task 2 `keptRange` case and in-app item 3.
2. **Move the plan + end earlier than the plan's length.** Only end-side days are outside (`keptRange` with no shift); Day 1 keeps its content on the new start. Pinned by a Task 2 case and in-app item 4.
3. **Start earlier + keep the dates.** Days shift up, new free days appear at the start, location spans shift with them. Pinned by the Task 1 throwaway SQL check and in-app item 2.
4. **Start changed on a trip with no placed days and no spans.** No question; saves directly. Pinned by the ask condition in Task 3 and in-app item 5.
5. **The user changes dates after a question appeared.** The panel disappears (keyed by `datesKey`, as 6a does) and the next save asks again. Pinned in Task 4 and in-app item 6.

---

### Task 1: Migration

**Files:**
- Create: `supabase/migrations/20261028000002_start_date_question.sql`

**Interfaces:**
- Produces: `public.shift_trip_days(p_trip_id uuid, p_shift int) returns void`. Adds `p_shift` to every `itinerary_days.day_index` that is not null and to both span ends of every `itinerary_locations` row with `start_index` not null, for that trip. Body = the old trigger's two updates with `v_shift` replaced by `p_shift`. The `(trip_id, day_index)` unique constraint is `deferrable initially immediate`, so the one-statement shift does not collide.

- [ ] **Step 1: Write the migration**, idempotent: header comment (what and why, deploy order); `drop trigger if exists trips_renumber_itinerary on public.trips;` `drop function if exists public.trips_renumber_itinerary();` then `create or replace function public.shift_trip_days(...)` (plpgsql, invoker rights so RLS applies like every other itinerary RPC).
- [ ] **Step 2: Hand to the user to paste**, with post-paste checks: `select count(*) from pg_trigger where tgname = 'trips_renumber_itinerary'` → 0; `shift_trip_days` exists in `pg_proc`. Throwaway check: on a throwaway trip with Days 1-3, one span 1-2 and one unplaced day, `select public.shift_trip_days('<id>', 2)` → days are 3-5, span 3-4, unplaced day still null; then `select public.shift_trip_days('<id>', -2)` to restore.

### Task 2: `keptRange` knows the choice

**Files:**
- Modify: `src/lib/trips/outside-days.ts`

**Interfaces:**
- Produces: `keptRange(change: { oldStart: string | null; newStart: string | null; newLength: number | null; keepDates: boolean }): KeptRange`. Shift is `dayIndexOf(oldStart, newStart) - 1` only when `keepDates` and both starts are set; else 0. Docstring updated (no trigger any more).
- Produces: `startShift(oldStart: string, newStart: string): number` = `old start - new start` in days (what `shift_trip_days` adds), used by Task 3. Note the sign: start 2 days later → `-2`.

- [ ] **Step 1: Write** `<scratchpad>/outside6b-check.mts` asserting:
  - keep, start 2 days later, 8 long: `keptRange({ oldStart: "2026-03-01", newStart: "2026-03-03", newLength: 8, keepDates: true })` → `{ first: 3, last: 10 }`.
  - move, same dates: `keepDates: false` → `{ first: 1, last: 8 }`.
  - move, start 1 day earlier, end same (11 long): `("2026-03-01", "2026-02-28", 11, false)` → `{ first: 1, last: 11 }`.
  - keep, start 1 day earlier, 11 long: → `{ first: 0, last: 10 }`.
  - dream cut to 5: `(null, null, 5, false)` → `{ first: 1, last: 5 }`.
  - `startShift("2026-03-01", "2026-03-03")` → `-2`; `startShift("2026-03-01", "2026-02-28")` → `1`.
- [ ] **Step 2: Run** `node --import ./alias.mjs outside6b-check.mts`. Expected: FAIL (`startShift` missing / wrong ranges).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again. Expected: no output, exit 0.

### Task 3: `updateTrip` asks and shifts

**Files:**
- Modify: `src/lib/trips/actions.ts` (`UpdateTripInput`, `UpdateTripResult`, `updateTrip` dated branch, dream-branch `keptRange` call)

**Interfaces:**
- Consumes: `keptRange`, `startShift` (Task 2); RPC `shift_trip_days` (Task 1).
- Produces: `UpdateTripInput.start?: "move" | "keep"`; `UpdateTripResult.askStart?: true` (set, with no `slug` and no `error`, when the ask condition holds and `start` is undefined).

- [ ] **Step 1:** Add helper `hasPlacement(supabase, tripId): Promise<boolean | { error: string }>` (or inline two `head: true` counts): any `itinerary_days` with `day_index` not null, or any `itinerary_locations` with `start_index` not null.
- [ ] **Step 2:** In the normal dated branch, before `settleOutside`: `const startMoved = oldStart !== null && oldStart !== input.startDate`. If `startMoved && !input.start && await hasPlacement(...)` → `return { askStart: true }`. `keepDates = startMoved && input.start === "keep"`; pass it to `keptRange`. Dream branch passes `keepDates: false`.
- [ ] **Step 3:** After the trip update succeeds and before `dropUnplaced`: if `keepDates`, call `shift_trip_days` with `startShift(oldStart, input.startDate)`; on error return the message from Global Constraints (after still running `dropUnplaced` and `relabelHomeExpenses`, so the rest of the save completes).
- [ ] **Step 4:** `pnpm exec tsc --noEmit`, `pnpm lint` clean.

### Task 4: The question in the edit form

**Files:**
- Modify: `src/app/trips/[slug]/edit/edit-trip-form.tsx`

**Interfaces:**
- Consumes: `updateTrip` input `start`, result `askStart`.

- [ ] **Step 1:** `save` takes `{ start?: "move" | "keep"; outside?: "delete" | "unplace" }`. New state `startAsk: { key: string } | null`, shown only while `startAsk.key === datesKey` (as `outsideAsk`). Remember the chosen start alongside `outsideAsk` (`{ count, key, start }`) so the outside buttons resend `{ start, outside }`.
- [ ] **Step 2:** Panel in the same place and style as the outside panel. Copy: "The start moved to {fmtPreview(startDate)}. Move the whole plan with it, or keep every day on its date?" Buttons: **move the plan** (primary style), **keep the dates** (outline), **cancel** (text). Move/Keep call `save({ start })`; cancel clears.
- [ ] **Step 3:** `pnpm exec tsc --noEmit`, `pnpm lint` clean.

### Task 5: Docs

- [ ] `docs/TODO.md`: step 6b entry, *implemented, unverified in app*, migration and deploy order; mark the one trip model complete pending in-app checks. `docs/DECISIONS.md`: one row (trigger replaced by explicit `shift_trip_days` called only for "keep"; asked only when something is placed; shift runs after the trip update so a failure leaves "moved"). Supersede the "step 6 adds the question" notes in the 2026-10-27 rows by reference, not by editing them.

## Success Criteria

Verified by Claude:
- `pnpm exec tsc --noEmit` and `pnpm lint` clean; Task 2 script passes.
- No reference to `trips_renumber_itinerary` left in `src/`; the only shift of day numbers on a start change is the `shift_trip_days` call guarded by `keepDates` (grep).
- `shift_trip_days` runs only after a successful trip update (code order).

Verified by the user (after pasting the migration and deploying):
1. Dated trip, Days 1-4 planned: move start and end 3 days later, choose **move the plan**. Day 1's content is on the new start date; all four days moved; locations moved with them.
2. Same trip: start 2 days earlier, end unchanged, choose **keep the dates**. Every day stays on its calendar date; two free days appear at the start; location spans stay on their dates.
3. Start 2 days later, end unchanged, with Day 1 planned: **keep the dates** then asked about 1 planned day; **keep as unplaced** puts it in Unplaced; other days keep their dates.
4. 6-day trip, Days 1-6 planned: start 2 days later and end so the trip is 4 days, choose **move the plan**. Asked about 2 planned days (old Days 5-6), not Days 1-2; Day 1 is on the new start.
5. A trip with no itinerary at all: changing the start asks nothing.
6. Question showing, then edit a date: the panel disappears; saving asks again.
7. Changing only the end date, or giving a dream dates, asks no start question.
