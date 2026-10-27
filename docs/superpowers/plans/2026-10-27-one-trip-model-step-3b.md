# One Trip Model, Step 3b: Dreams Move Onto the Trip Itinerary

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dream's days live in `itinerary_days` and render on the trip itinerary screen as "Day N". The "Plan your itinerary" walk and the AI planner work in day numbers for both kinds of trip. No date shows anywhere on a dream.

**Architecture:** One migration lets `itinerary_days.day_date` be null, copies each dream's `dream_itinerary_days` into `itinerary_days`, and changes the start-date trigger so that giving a dream dates moves no rows. In the app, `ItineraryDay.dayDate` becomes `string | null`, and the TypeScript errors that change causes are the date-leak audit. The page renders `ItineraryTab` for every trip. The tab takes a nullable start and labels positions through one helper. The walk keeps one Day 1..N picker. Its entries, skeletons and the planner agent carry day numbers. Dates are only labels and model context.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase (hand-pasted SQL), `@anthropic-ai/sdk` via `runAgent`.

**Spec:** `docs/superpowers/specs/2026-10-27-one-trip-model-design.md`. The step 3 split note is in the spec. Step 3a plan: `docs/superpowers/plans/2026-10-27-one-trip-model-step-3a.md`.

**Branch:** `one-trip-model-step-3b`, cut from `one-trip-model-step-3a`. If 3a is merged to `main` first, cut from `main` instead.

## Global Constraints

- **Anti-goal:** any date shown on a dream, anywhere. No placeholder or fake dates are stored for dreams.
- No visible change on a dated trip: the same dates, order, pushes, spans, drags and walk.
- `day_index` is 1-based: `date = start_date + day_index - 1` (`dateOfIndex` / `dayIndexOf`).
- The migration is hand-pasted and re-runnable, against one shared database for dev and prod. The deployed `main` code must keep working the moment it is pasted.
- Step 4 owns the deletions. This step stops *using* `dream_itinerary_days`, `DreamItineraryTab`, `dream-itinerary-actions.ts`, `dream-plan.ts`, the `dream-itinerary-planner` agent and `promote_dream_to_dated` in the code path, but does not delete them.
- No test runner. Checks are `pnpm exec tsc --noEmit`, `pnpm lint`, and Node 24 type stripping for pure helpers (scripts in the scratchpad, imported by absolute `file:///` path). Ask before `pnpm build` if the dev server runs.
- European date order in labels (`en-GB`). Every `DndContext` keeps its `id`.

## Decisions made here

- **`day_date` drops NOT NULL and stays until step 4.** Dream rows have it null. A dated trip turned dream keeps stale dates on its rows, and no reader uses them, because reads derive from `day_index`.
- **The start-date trigger branches on `old.start_date`.** If it was null (a dream gets dates), rows keep `day_index` and only `day_date` / the location dates are derived. If it was set, today's "keep the dates" renumber stays (step 6 adds the question).
- **Copy rules.** Copy only into trips that have no `itinerary_days` rows yet, which makes a re-run a no-op once the app has written. A dream with `day_count` keeps its `day_index`. An older dream without one is compacted to 1..k in `day_index` order and gets `day_count = k`. `title`, `sub`, `tag`, `tone` and `created_by` carry over, `events = '[]'`, no location.
- **`promote_dream_to_dated` is rewritten only so the deployed code stays safe.** It sets the dates from `day_count` and deletes that trip's dream rows (the copies already sit in `itinerary_days`). The 3b code stops calling it and does the same with one `trips` update.
- **A dream day's label fields read as a position.** With a null start, `rowToItineraryDay` sets `dayDate: null`, `date: "Day N"`, `dom: "N"`, `mon: "Day"`, `dow: ""`. `DayCard` and group labels need no branch.
- **`positionLabel(dayIndex, startDate)`** is the one label helper for any position that is not an `ItineraryDay` (span labels, the walk picker, the AI's place ranges): `formatShortDate(dateOfIndex(...))` on a dated trip, `Day N` on a dream.
- **`todayIndex` is 0 on a dream.** No index is below it, so nothing is past. `active` is false.
- **The leak audit is the type checker.** Every `tsc` error from the nullable `dayDate` is fixed by one rule. A reader that only makes sense on a dated trip returns early on a dateless trip, or filters with `isDated`. A reader that passes a date on as a real calendar date (expense day, discovery default) passes `null` / `undefined` for a dream. No `!` assertions.
- **The planner tool returns `day` (integer, 0 = unplaced) instead of `date`.** The dated prompt adds "Day 1 is {start_date}" as context. The dream planner's `prefs` line (sleeping / getting around / doing / eating) joins the one planner. A returned clarifying question becomes the action's error on both kinds of trip, as the dream path does today.
- **Not in 3b:** empty day positions on a location-less dream (step 5 renders every `day_count` position), and reducing a dream's day count below its last planned day (step 6).

## Review Focus

1. **Dated → dream → dated.** Clearing a trip's dates and then setting them again must show the same days on the new dates, with nothing lost. This exercises the trigger's old-null branch. Pinned by the Task 1 throwaway-trip SQL check.
2. **Realtime on a dream.** A partner's added day arrives with `day_date = null`. The tab must build it as "Day N" without calling `dateOfIndex` on null, and a dated trip's rows must still read their start from the row. Pinned by `liveRowToItineraryDay` in the Task 2 script.
3. **The AI returns `day: 0` or a day past the end.** The item must land on its place's first day, not be dropped or written beyond the trip. Pinned in the Task 4 script (`itemsToSkeleton`).
4. **The walk on a live dated trip.** Past days must stay untouched, because the floor is now an index. Pinned by `firstDayAtOrAfter` on indexes in the Task 4 script, and by in-app item 6.
5. **A dream with no `day_count` and no days.** The walk asks "How many days?", Apply writes `trips.day_count`, and the days land within it. Pinned by in-app item 4.

---

### Task 1: Migration: dreams copied in, dates attach without moving rows

**Files:**
- Create: `supabase/migrations/20261027000003_dreams_into_itinerary.sql`

**Interfaces:**
- Produces: `itinerary_days.day_date` nullable. Every dream's days are in `itinerary_days`. Every dream with days has `day_count >= max(day_index)`. `trips_renumber_itinerary` has the old-null branch. `promote_dream_to_dated` is safe for the deployed code.

- [ ] **Step 1: Pre-flight (read-only).** Hand the user this to run first:
  ```sql
  -- itinerary rows already on dateless trips (dated trips turned dream)
  select t.name, count(*) as rows, count(d.day_index) as with_index
  from public.itinerary_days d join public.trips t on t.id = d.trip_id
  where t.start_date is null group by t.name;
  -- dreams that have both kinds of row
  select t.name from public.trips t
  where t.start_date is null
    and exists (select 1 from public.itinerary_days d where d.trip_id = t.id)
    and exists (select 1 from public.dream_itinerary_days r where r.trip_id = t.id);
  ```
  Expected: both empty. If not, **stop and ask the user** whether those rows are kept (they become the dream's days) or deleted. Do not guess.
- [ ] **Step 2: Write the migration**, in this order, each part re-runnable:
  1. `alter table public.itinerary_days alter column day_date drop not null;`
  2. `create or replace function public.trips_renumber_itinerary()`. When `old.start_date is null`: `update itinerary_days set day_date = new.start_date + day_index - 1 where trip_id = new.id and day_index is not null`, and the same for location `start_date` / `end_date` from `start_index` / `end_index` where `start_index is not null`. Otherwise the existing body. The trigger itself is unchanged.
  3. Backfill older dreams: for trips with `start_date is null and day_count is null` that have dream rows, renumber those rows to `row_number() over (order by day_index)`, then set `day_count` to their count. Renumber in ascending order so the unique index never collides, as `closeGaps` does.
  4. Copy:
     ```sql
     insert into public.itinerary_days
       (trip_id, day_index, title, sub, events, tag, tone, created_by)
     select r.trip_id, r.day_index, r.title, coalesce(r.sub, ''), '[]'::jsonb, r.tag, r.tone, r.created_by
     from public.dream_itinerary_days r
     join public.trips t on t.id = r.trip_id and t.start_date is null
     where not exists (select 1 from public.itinerary_days d where d.trip_id = r.trip_id);
     ```
     Then `update trips set day_count = greatest(day_count, max index)` for dreams whose rows reach past it.
  5. `create or replace function public.promote_dream_to_dated(p_trip_id uuid, p_start_date date)`: set `start_date = p_start_date`, `end_date = p_start_date + day_count - 1` and `fuzzy_when = null`, then delete that trip's `dream_itinerary_days`. The trigger derives the day dates.
- [ ] **Step 3: Hand over for pasting, then these checks** (the spec's step 3 criterion):
  ```sql
  -- per dream: same count, same order of titles. Expected 0 rows.
  select t.name from public.trips t
  where t.start_date is null and
    (select string_agg(title, '|' order by day_index) from public.dream_itinerary_days where trip_id = t.id)
    is distinct from
    (select string_agg(title, '|' order by day_index) from public.itinerary_days where trip_id = t.id)
    and exists (select 1 from public.dream_itinerary_days where trip_id = t.id);
  -- dreams whose days run past day_count. Expected 0 rows.
  select t.name from public.trips t
  where t.start_date is null
    and (select max(day_index) from public.itinerary_days where trip_id = t.id) > coalesce(t.day_count, 0);
  ```
  Then a throwaway check (Review Focus 1): on a scratch dated trip with 3 days, `update trips set start_date = null, end_date = null` and then `start_date = '2027-01-10', end_date = '2027-01-12'`. Expected: the same `day_index` 1..3 and `day_date` 10-12 Jan. Delete the scratch trip.
- [ ] **Step 4: Commit** the migration file.

---

### Task 2: Types and labels allow a dateless day

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts`

**Interfaces:**
- Produces:
  - `ItineraryDay.dayDate: string | null`. `DayDateAndLocation` follows.
  - `rowToItineraryDay(row: ItineraryRow, startDate: string | null): ItineraryDay`, with the dream label fields per Decisions.
  - `reassignDayIndex(day, dayIndex, startDate: string | null)`, the same rule.
  - `positionLabel(dayIndex: number, startDate: string | null): string`
  - `isDated(day: ItineraryDay): day is ItineraryDay & { dayDate: string }`
  - `liveRowToItineraryDay(row: ItineraryRow & { day_date: string | null }, tripStartDate: string | null): ItineraryDay`. A dated trip reads its start off the row when `day_date` is set (the 3a comment's reason). Otherwise it uses `tripStartDate`. A dream gives a Day N day. It moves here from the tab's `rowToDay`.

- [ ] **Step 1: Write** `<scratchpad>/dateless-check.mts`:
  ```ts
  const row = { id: "a", day_index: 3, title: "x", tag: "t", tone: "sea" }
  const dream = rowToItineraryDay(row, null)
  assert.equal(dream.dayDate, null); assert.equal(dream.date, "Day 3"); assert.equal(dream.dom, "3"); assert.equal(dream.dow, "")
  assert.equal(isDated(dream), false)
  assert.equal(rowToItineraryDay(row, "2026-02-27").dayDate, "2026-03-01")
  assert.equal(positionLabel(3, null), "Day 3"); assert.equal(positionLabel(3, "2026-02-27"), "1 Mar")
  assert.equal(liveRowToItineraryDay({ ...row, day_date: null }, null).date, "Day 3")
  assert.equal(liveRowToItineraryDay({ ...row, day_date: "2026-03-05" }, "2026-02-27").dayDate, "2026-03-05")
  assert.equal(reassignDayIndex(dream, 5, null).date, "Day 5")
  ```
- [ ] **Step 2: Run** `node <scratchpad>/dateless-check.mts`. Expected: FAIL (`positionLabel` is not exported).
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Re-run.** Expected: exit 0.
- [ ] **Step 5: Commit.** `tsc` is red until Task 3; note that in the ledger.

---

### Task 3: Every reader accepts a dream (the date-leak audit), and the screen renders one

**Files:**
- Modify: `src/lib/trips/itinerary-queries.ts`, `src/lib/trips/actions.ts`, `src/app/trips/[slug]/page.tsx`, `src/app/trips/[slug]/itinerary-tab.tsx`, `src/app/trips/[slug]/day-input.tsx`, `src/app/trips/[slug]/edit/page.tsx`, `src/app/trips/[slug]/edit/edit-trip-form.tsx`, and each file `tsc` names. The probe on 2026-10-27 found: `on-the-road/page.tsx`, `find-a-place-planning.tsx`, `journal-types.ts`, `looking-ahead.ts`, `suggestion-actions.ts` (plus `itinerary-actions.ts` / `itinerary-planner.ts`, which Task 4 rewrites; give them a minimal fix here)

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `getItineraryDays(tripId): Promise<ItineraryDay[]>` returns a dream's days too (Day N). `getTodayForTrip` still returns null for a dream.
  - `ItineraryTab` props: `tripStartDate: string | null`, `tripEndDate: string | null`.
  - `DayInput` takes `startDate: string | null`. With null it renders `<input type="number" min={min ?? 1}>` holding the day number, with the same `className`.
  - `addItineraryDay` / `updateItineraryDay` / `insertItineraryDayWithShift` accept a dateless trip (the two "This trip has no dates." guards go).

- [ ] **Step 1: Queries and actions.** `getItineraryDays` maps with the trip's start, null or not. Remove the dateless guards in `actions.ts` (around lines 1530 and 1708). In `updateTrip`, the `wasDream` branch counts `itinerary_days` instead of `dream_itinerary_days`. When there are days, it does one `trips` update (the non-date fields, `start_date`, `end_date = dateOfIndex(day_count, start_date)`, `fuzzy_when: null`) instead of the RPC. The edit page reads `day_index` from `itinerary_days`, and `promoteDays = trip.dayCount ?? count`.
- [ ] **Step 2: Page.** `page.tsx` drops the `DreamItineraryTab` branch and the `getDreamItineraryDays` fetch. It loads `getItineraryDays` when `showItinerary || wants("budget")` and renders `ItineraryTab` with `header.startDate` / `header.endDate`. The dream day count at line ~410 reads `header.dayCount ?? days.length`.
- [ ] **Step 3: Tab.** `active = tripStartDate !== null && tripActive(today, tripStartDate, tripEndDate ?? tripStartDate)`. `todayIndex` is 0 when the trip has no start. `planFloor` runs only when dated. `defaultCollapsed` returns empty for a dream. The span label (line ~822) uses `positionLabel`. Realtime uses `liveRowToItineraryDay(row, tripStartDate)`, and the location twin passes `null` when there is no start. `reassignDayIndex` gets the nullable start.
- [ ] **Step 4: Audit to green.** Run `pnpm exec tsc --noEmit` and fix each error by the rule in Decisions. List every site in the ledger with its ruling: early-return, `isDated` filter, or "passes null as no calendar date".
- [ ] **Step 5: Grep for leaks the types can't see:**
  `grep -rn "dateOfIndex\|formatShortDate\|toLocaleDateString" src/app/trips/\[slug\] src/lib/ai/itinerary-actions.ts src/lib/ai/itinerary-planner.ts`
  Expected: every hit is behind a non-null start (or is a non-itinerary date such as expenses or notes). List each one in the ledger.
- [ ] **Step 6: `pnpm exec tsc --noEmit` and `pnpm lint`.** Expected: clean.
- [ ] **Step 7: Commit.**

---

### Task 4: The walk and the AI planner in day numbers

**Files:**
- Modify: `src/lib/ai/itinerary-planner.ts`, `src/lib/ai/itinerary-actions.ts`, `src/lib/ai/agents/itinerary-planner.ts`, `src/lib/ai/registry.ts`, `src/app/trips/[slug]/plan-itinerary.tsx`, `src/lib/trips/itinerary-types.ts` (`firstDayAtOrAfter`), `src/app/trips/[slug]/itinerary-tab.tsx` (`PlanItinerary` props)

**Interfaces:**
- Consumes: Tasks 2-3.
- Produces:
  - `SkeletonDay.dayIndex: number` replaces `date`. `ItineraryPlanInput` drops `startDate`.
  - `PlanEntry.day?: number; endDay?: number` replace `date` / `endDate`. `SavedPlanRow.day: number` replaces `whenStart`.
  - `DraftItem.day: number` (0 = unplaced) replaces `date`.
  - `itemsToSkeleton(items, placeNames, destination, dayCount)` and `entriesToSkeleton(entries, placeNames, destination, dayCount)`. The `startDate` parameter goes.
  - `firstDayAtOrAfter(days: { dayIndex: number; locationId: string | null }[], floor: number | null, locationId?): number | undefined`
  - `placesFromTags(days: ItineraryDay[]): string[]`, moved from `dream-plan.ts`'s `placesFromCards`. This is the walk's place seed when a trip has days but no locations (copied dreams).
  - `ItineraryDraftContext`: `startDate: string | null`, `locations: { name: string; first: number; last: number }[]`, plus `prefs: string`. `DraftedItineraryEvent.day: number` replaces `date`.
  - `applyPlanEntries` / `draftAndApplyItinerary` input gains `dayCount?: number`. It is required only when `trips.day_count` is null, is validated 1..365 (error "How many days: 1 to 365."), and is written to `trips.day_count` before planning.
  - `PlanItineraryProps`: `startDate: string | null; dayCount: number | null` replace `dream`.

- [ ] **Step 1: Write** `<scratchpad>/walk-check.mts`:
  ```ts
  // 5 days, two places -> Lisbon 1-3, Porto 4-5
  const sk = entriesToSkeleton([{ category: "Accommodation", place: "Lisbon", subject: "Hotel", when: "", day: 1, endDay: 3 }], ["Lisbon", "Porto"], "PT", 5)
  assert.deepEqual(sk.places.map((p) => p.days.map((d) => d.dayIndex)), [[1, 2, 3], [4, 5]])
  assert.deepEqual(sk.places[0].days[0].events.map((e) => e.text), ["Hotel (check in)"])
  assert.deepEqual(sk.places[0].days[2].events.map((e) => e.text), ["Hotel (check out)"])
  // unplaced (0) and out-of-range (9) items land on their place's first day
  const it = itemsToSkeleton([{ category: "Food", place: "Porto", text: "Tascas", day: 0, time: "" }, { category: "Food", place: "Porto", text: "Late", day: 9, time: "" }], ["Lisbon", "Porto"], "PT", 5)
  assert.deepEqual(it.places[1].days.map((d) => [d.dayIndex, d.events.length]), [[4, 2]])
  // floor on indexes: day 2 is before the floor of 3
  assert.equal(firstDayAtOrAfter([{ dayIndex: 2, locationId: null }, { dayIndex: 4, locationId: null }], 3), 4)
  ```
- [ ] **Step 2: Run** it. Expected: FAIL (the signatures still take `startDate`).
- [ ] **Step 3: Pure helpers** in `itinerary-planner.ts` and `itinerary-types.ts` per the Interfaces. `addDays` / `enumerateDates` become plain integer loops. `savedPlanFromItinerary` reads `day.dayIndex`.
- [ ] **Step 4: Re-run.** Expected: exit 0.
- [ ] **Step 5: Actions** (`itinerary-actions.ts`). Drop every `!trip.startDate` guard and `inclusiveDays`. The length is `trip.dayCount`, after writing the input `dayCount` when the trip has none. `applyItinerarySkeleton` passes `day.dayIndex`. `applyPlanEdits` keys `byIndex` on numbers. Its floor is `planFloor(...)` converted with `dayIndexOf` when the trip is dated, and null on a dream. `locationForDate` becomes `locationForIndex`, testing `startIndex <= i <= endIndex`. `draftAndApplyItinerary` builds `locations` from the scaffold's first and last `dayIndex` and passes `startDate: trip.startDate` and the `prefs` line (the same four fields `dream-itinerary-actions.ts` `prefsLine` reads). It returns `{ error: question }` when the model gives no events and a question.
- [ ] **Step 6: Agent and tool.** In `registry.ts`, `propose_itinerary`'s `date` becomes `day: { type: "integer", description: "Day number 1..N within the trip. 0 if you can't place it." }`, and `required` follows. The prompt opens `Draft a ${dayCount}-day itinerary for ${destination}; days are numbered 1..${dayCount}` and adds `Day 1 is ${startDate}.` only when dated. Places read `Name (Day 2)` or `Name (Days 2-4)`, labelled through `positionLabel` when dated, for example "(1 Mar - 3 Mar)". The system prompt's date sentence becomes "Set day to a whole day number within 1..N inside that place's days, or 0 if you cannot place it." `prefs` is added as `Their answers: ...`.
- [ ] **Step 7: Walk UI** (`plan-itinerary.tsx`). Drop the `dream` prop and both `dream-*` imports. Each row stores `whenStart` / `whenEnd` as day-number strings, picked through the existing `DaySelect`, whose option text becomes `positionLabel(d, startDate)`. Both date inputs go. `rangeLabel` uses `positionLabel`. `asksDays = dayCount === null`, and the Places-step "How many days?" input stays, sending `dayCount` to both actions. `hasDays = days.length > 0`. The place seed is locations, else `placesFromTags(days)`, else `[tripName]`. `collectEntries` sends `day` / `endDay` as numbers. In `itinerary-tab.tsx`, pass `startDate={tripStartDate}` and `dayCount` (a new tab prop from `header.dayCount`).
- [ ] **Step 8: Prove the walk is off dates:**
  `grep -n "type=\"date\"\|dream-\|\.dayDate" src/app/trips/\[slug\]/plan-itinerary.tsx src/lib/ai/itinerary-actions.ts src/lib/ai/itinerary-planner.ts`
  Expected: no hits.
- [ ] **Step 9: `pnpm exec tsc --noEmit` and `pnpm lint`.** Expected: clean.
- [ ] **Step 10: Commit.**

---

### Task 5: In-app check, then docs

**Files:**
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`

- [ ] **Step 1: Hand the user the in-app checklist** below, then wait.
- [ ] **Step 2: Docs.** TODO: 3b *implemented*, then *verified in-app* once confirmed, with the next step being step 4 (delete the dream path). DECISIONS rows: (a) dreams live in `itinerary_days`, superseding rows 110 and 106; (b) `day_date` is nullable until step 4, and giving a dream dates moves no rows (the trigger's old-null branch); (c) the planner tool returns day numbers, with dates as context only.
- [ ] **Step 3: Commit docs.**

## Success Criteria

Verified by Claude:
- `pnpm exec tsc --noEmit` and `pnpm lint` clean.
- The Task 2 and Task 4 scripts exit 0 after failing first.
- The Task 1 SQL checks return 0 rows, and the throwaway trip round-trips (run by the user, read back by Claude).
- The Task 3 Step 5 and Task 4 Step 8 greps are clean or ledgered.

Verified by the user in-app:
1. A dated trip's itinerary looks and behaves as before: days, dates, add, push, spans, drag.
2. An existing dream shows its days as Day 1..N in the same order as before, with no date anywhere: day cards, span labels, the add-day form, the walk picker.
3. On a dream: add a day, add events to it, add a location with a span ("Day 2 - 4"), make a multi-day block, and drag a day. Each sticks after a reload.
4. "Plan your itinerary" on a dream with no length asks "How many days?". Apply writes days under the places entered, on the Day numbers picked. Generate drafts events onto Day numbers.
5. Giving a dream dates (Edit trip) shows the same plan on real dates. Removing them shows Day 1..N again with nothing lost.
6. On a dated trip: the walk picker lists dates, Apply and Generate land on the right dates, and on a live trip past days are left alone.
7. Home still files dateless trips under Dreams. On-the-road, weather and dispatch ignore dreams.
8. A partner adding a day to a dream in a second browser appears live as "Day N".
