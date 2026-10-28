# One Trip Model, Step 6a: Unplaced Days

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A planned day never silently disappears when a trip gets shorter or starts later. The app asks "delete them or keep as unplaced"; unplaced days sit in an Unplaced list and drag back onto any free day.

**Architecture:** An unplaced day is an `itinerary_days` row with `day_index = null`. Every read of placed days filters `day_index is not null`; unplaced ones are read separately into their own small type, so `ItineraryDay.dayIndex` stays `number` and no screen code changes meaning. `updateTrip` computes which current day numbers survive the change (`keptRange`), asks via its result when planned days fall outside, and otherwise settles them through one RPC (`unplace_days_outside`) that runs *before* the trip update, so the renumber trigger never produces a number below 1. A check constraint makes `day_index < 1` impossible from now on.

**Tech Stack:** Next.js 16 server actions, Supabase Postgres (hand-pasted migration), React 19, `@dnd-kit/core` (already used).

**Spec:** `docs/superpowers/specs/2026-10-27-one-trip-model-design.md`, "Changing a trip's dates" and step 6. Step 5 plan: `docs/superpowers/plans/2026-10-27-one-trip-model-step-5.md`. Split agreed with the user 2026-10-28: 6a = unplaced days (this plan), 6b = the "move the plan / keep dates" question.

## Global Constraints

- The start-date behaviour stays "keep days on their dates" (the existing `trips_renumber_itinerary` trigger). 6b changes it, not this plan.
- An unplaced day keeps title, sub, events, tag, tone and `location_id`. It **leaves its block** (`group_id`, `group_name` set null). Claude's call, changed from the chat note: block queries (`deleteItineraryGroup`, `editItineraryBlock`, `regroupDays`) select by `group_id`, so a block member outside the trip would be edited or deleted with the block.
- A day is *planned* when it has a non-blank title, a non-blank sub, or a non-empty events array. Outside days that are not planned are deleted without asking.
- A location span that ends up partly outside is trimmed to the kept range; fully outside, both span ends are cleared (the location stays).
- Dates display day-before-month (`en-GB`). No date ever shows on a dream or on an unplaced day.
- Migration is re-runnable and pasted by hand into the shared database; it is pasted before the code merges.
- No test runner. Checks: `pnpm exec tsc --noEmit`, `pnpm lint`, Node 24 scripts for pure helpers (`node --import ./alias.mjs <file>.mts` from the scratchpad; the hook maps `@/` to `src/`). No `pnpm build` while the dev server runs.

## Review Focus

1. **Start moved later on a dated trip (keep dates).** Planned days before the new start are asked about; after "keep" they are in Unplaced and the remaining days keep their calendar dates. Pinned by `keptRange` (Task 2 script) and in-app item 1.
2. **Shortening by the end date or a dream's "How long".** Same question, same result; days inside the trip don't move. Pinned by `keptRange` cases and in-app items 2-3.
3. **A push, span change or reorder on a trip with unplaced days** leaves every unplaced day's `day_index` null. The RPCs only touch `day_index >= x` (false for null) and explicit ids; pinned by the post-paste SQL check in Task 1 and in-app item 5.
4. **The trip update fails after days were settled** (slug taken). Days are unplaced, not deleted, so nothing is lost; deletion runs only after the trip update succeeds. Pinned by the order in Task 4.
5. **A partner's open tab** sees a day leave the itinerary and appear in Unplaced live (Realtime UPDATE with `day_index: null`). Pinned by the routing in Task 6 and in-app item 6.

---

### Task 1: Migration

**Files:**
- Create: `supabase/migrations/20261028000001_unplaced_days.sql`

**Interfaces:**
- Produces: `public.unplace_days_outside(p_trip_id uuid, p_first int, p_last int) returns uuid[]`. In the trip's *current* numbering, every day with `day_index < p_first` or (`p_last` not null and `day_index > p_last`): deletes it if not planned; otherwise sets `day_index`, `group_id`, `group_name` to null. Trims location spans to `[p_first, p_last]`, clearing both ends when the span lies fully outside. Returns the ids it unplaced.

- [ ] **Step 1: Write the migration**, idempotent, in this order:
  1. Header comment with a pre-flight query: count of `itinerary_days` with `day_index < 1`, split into planned / empty, and count of `itinerary_locations` with `start_index < 1`.
  2. Backfill: delete empty days with `day_index < 1`; unplace (null index + block) planned ones. Locations with `end_index < 1` lose their span; with `start_index < 1 <= end_index` start at 1.
  3. Constraints (drop if exists, then add): `itinerary_days_day_index_positive check (day_index is null or day_index >= 1)`; `itinerary_locations_start_index_positive check (start_index is null or start_index >= 1)`.
  4. `unplace_days_outside` (plpgsql, `set constraints all deferred` not needed). Planned test in SQL: `coalesce(btrim(title), '') <> '' or coalesce(btrim(sub), '') <> '' or jsonb_array_length(coalesce(events, '[]'::jsonb)) > 0`.
  5. `shared_trip`: recreate unchanged except both `itinerary_days` reads add `and d.day_index is not null`; re-grant to anon, authenticated.
- [ ] **Step 2: Hand to the user to paste**, with post-paste checks: zero rows with `day_index < 1`; both constraints present; `unplace_days_outside` exists. Throwaway check (Review Focus 3): on a trip with one unplaced day, run a push via the app, then `select count(*) from itinerary_days where trip_id = ... and day_index is null` is unchanged.

### Task 2: Pure helpers

**Files:**
- Create: `src/lib/trips/outside-days.ts`

**Interfaces:**
- Produces:
  - `keptRange(change: { oldStart: string | null; newStart: string | null; newLength: number | null }): { first: number; last: number | null }` — the current day numbers that stay inside the trip. `shift = oldStart && newStart ? dayIndexOf(oldStart, newStart) - 1 : 0` (what the renumber trigger adds); `first = 1 - shift`; `last = newLength === null ? null : newLength - shift`.
  - `isPlannedRow(row: { title: string | null; sub: string | null; events: unknown }): boolean` — same rule as the SQL.
  - `isOutside(dayIndex: number, range: { first: number; last: number | null }): boolean`.

- [ ] **Step 1: Write** `<scratchpad>/outside6a-check.mts` asserting:
  - start 2 days later, 10 days long: `keptRange({ oldStart: "2026-03-01", newStart: "2026-03-03", newLength: 8 })` → `{ first: 3, last: 10 }`.
  - start 1 day earlier, end same: `("2026-03-01", "2026-02-28", 11)` → `{ first: 0, last: 10 }`.
  - end 3 days earlier: `("2026-03-01", "2026-03-01", 7)` → `{ first: 1, last: 7 }`.
  - dream cut to 5: `(null, null, 5)` → `{ first: 1, last: 5 }`; dream with no length `(null, null, null)` → `{ first: 1, last: null }`.
  - `isPlannedRow({ title: null, sub: " ", events: [] })` false; title "Surf" true; `events: [{ text: "x" }]` true.
  - `isOutside(2, { first: 3, last: 10 })` true; `isOutside(11, { first: 1, last: null })` false.
- [ ] **Step 2: Run** `node --import ./alias.mjs outside6a-check.mts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the three functions.
- [ ] **Step 4: Run** again. Expected: no output, exit 0. `pnpm exec tsc --noEmit` clean.

### Task 3: Read path keeps unplaced days out

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts` (types), `src/lib/trips/itinerary-queries.ts`, `src/app/trips/[slug]/edit/page.tsx`, `src/lib/trips/actions.ts` (promotion's last-day query)

**Interfaces:**
- Produces:
  - `type UnplacedDay = Pick<ItineraryDay, "id" | "title" | "sub" | "events" | "tag" | "tone" | "locationId">`
  - `rowToUnplacedDay(row: Omit<ItineraryRow, "day_index">): UnplacedDay`
  - `ItineraryRow.day_index` stays `number`; realtime rows are typed `Omit<ItineraryRow, "day_index"> & { day_index: number | null }` at the tab.
  - `getUnplacedDays(tripId: string): Promise<UnplacedDay[]>` in `itinerary-queries.ts`, ordered by `created_at`.
- [ ] **Step 1:** `getItineraryDays` and the edit page's `day_index` read add `.not("day_index", "is", null)`; promotion's last-day query in `updateTrip` the same. Add the type, mapper and `getUnplacedDays`.
- [ ] **Step 2:** `pnpm exec tsc --noEmit` clean. (Other readers checked: `getTodayForTrip` uses `eq`; the AI planner, journal, suggestions and on-the-road read through `getItineraryDays`; taste signals keep unplaced events on purpose, they are still planned intent; block queries are safe because unplacing clears the block.)

### Task 4: `updateTrip` settles outside days

**Files:**
- Modify: `src/lib/trips/actions.ts` (`UpdateTripInput`, `UpdateTripResult`, `updateTrip`)

**Interfaces:**
- Consumes: `keptRange`, `isPlannedRow`, `isOutside` (Task 2); RPC `unplace_days_outside` (Task 1).
- Produces: `UpdateTripInput.outside?: "delete" | "unplace"`; `UpdateTripResult.outsidePlanned?: number` (set, with no `slug` and no `error`, when planned days fall outside and `outside` is undefined).

- [ ] **Step 1:** Extend the existing `home_currency` select to also read `start_date` (the old start). Add helper `settleOutside(supabase, tripId, range, choice)` returning `{ ask: number } | { ids: string[] } | { error: string }`: read placed rows (`id, day_index, title, sub, events`), count planned outside; if count > 0 and no choice → `{ ask }`; else call the RPC and return its ids.
- [ ] **Step 2:** Call it in the dream branch (`range = keptRange({ oldStart, newStart: null, newLength: dayCount })`) and the normal dated branch (`newLength = end - start + 1`), right before each trip update. The promotion branch is skipped (its length covers every day). On `{ ask }` return `{ outsidePlanned: ask }`.
- [ ] **Step 3:** After a successful trip update, when `outside === "delete"` and ids were returned, delete those rows by id. A failed trip update leaves them unplaced.
- [ ] **Step 4:** `pnpm exec tsc --noEmit`, `pnpm lint` clean.

### Task 5: The question in the edit form

**Files:**
- Modify: `src/app/trips/[slug]/edit/edit-trip-form.tsx`

**Interfaces:**
- Consumes: `updateTrip` result `outsidePlanned`; input `outside`.

- [ ] **Step 1:** `submit` takes an optional choice and passes it as `outside`. On `outsidePlanned`, store the count in state and show an inline panel where the form's error shows (no dialog component): "{n} planned day(s) fall outside the new dates." with buttons **Keep as unplaced**, **Delete them**, **Cancel**. Keep/Delete re-run the submit with that choice; Cancel clears the panel. Changing any date or "How long" also clears it.
- [ ] **Step 2:** `pnpm exec tsc --noEmit`, `pnpm lint` clean.

### Task 6: Unplaced list in the itinerary, with drag back

**Files:**
- Create: `src/app/trips/[slug]/unplaced-days.tsx`
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`, `src/app/trips/[slug]/page.tsx`

**Interfaces:**
- Consumes: `UnplacedDay`, `rowToUnplacedDay`, `getUnplacedDays` (Task 3); existing `moveItineraryDay`, `deleteItineraryDay`, `positionOwner`, `EMPTY_PREFIX`.
- Produces: `UnplacedDays({ days, onDelete }: { days: UnplacedDay[]; onDelete: (id: string) => void })` — renders nothing when empty; else a "Unplaced" label, a one-line hint ("Drag onto a free day to put it back."), and one `useDraggable` row per day (id = day id) showing title (or "Untitled day") and event count, with a small delete button.
- ItineraryTab prop `initialUnplaced: UnplacedDay[]`.

- [ ] **Step 1:** `page.tsx` loads `getUnplacedDays` alongside `getItineraryDays` when the itinerary shows; passes `initialUnplaced`.
- [ ] **Step 2:** Tab keeps `unplaced` state (same `lastInitial` resync pattern as `days`). Realtime `itinerary_days` handler routes by `day_index`: null → remove from `days`, upsert into `unplaced`; a number → remove from `unplaced`, upsert into `days`. DELETE removes from both.
- [ ] **Step 3:** In `onDragEnd`, before `planDrop`: if the active id is an unplaced day and the target is `EMPTY_PREFIX` + i (and not before the live floor), optimistically move it into `days` at i under `positionOwner(i, locations, days)` and call `moveItineraryDay({ ..., keepGroup: false })`; roll back on error. Any other target does nothing. The `DragOverlay` shows the unplaced day's title with "Unplaced" in place of the date.
- [ ] **Step 4:** Render `<UnplacedDays>` inside the existing `DndContext`, after the timeline. Delete calls `deleteItineraryDay` after `confirm()`, optimistic removal.
- [ ] **Step 5:** `pnpm exec tsc --noEmit`, `pnpm lint` clean.

### Task 7: Docs

- [ ] `docs/TODO.md`: step 6a entry marked *implemented, unverified in app*, with the migration and the deploy order (paste first). `docs/DECISIONS.md`: one row (unplaced = null index, leaves its block, settled before the trip update, check constraint).

## Success Criteria

Verified by Claude:
- `pnpm exec tsc --noEmit` and `pnpm lint` clean; Task 2 script passes.
- No `itinerary_days` read that feeds the itinerary, edit page or promotion lacks the `day_index is not null` filter (grep).
- Delete of outside days runs only after a successful trip update (code order).

Verified by the user (after pasting the migration):
1. Dated trip with Days 1-5 planned: move the start 2 days later, keep the end. The form asks about 2 planned days; "Keep as unplaced" puts them in Unplaced; Days 3-5 keep their dates.
2. Move the end date earlier past a planned day: asked; "Delete them" removes it; nothing else moves.
3. A dream with Day 1-6 planned, "How long" cut to 4: asked; Days 5-6 go to Unplaced, no date shown anywhere.
4. Drag an unplaced day onto a free day: it lands there with its title and events, under that day's location; the Unplaced list shrinks. Reload: still there.
5. With an unplaced day present, add a day with push, change a location span, reorder: the unplaced day stays in Unplaced.
6. Two browsers: unplacing (via the edit form in one) shows the day in the other tab's Unplaced list after the redirect/live update.
7. Shortening a trip where only empty days fall outside asks nothing.
