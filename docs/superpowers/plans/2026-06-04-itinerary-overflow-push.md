# Itinerary overflow confirm-and-push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When adding a day or multi-day block whose date(s) are already taken, offer to push the following days forward by N to make room, instead of failing with "already planned".

**Architecture:** One Postgres RPC (`shift_and_insert_itinerary`) opens an N-day window at the target date and inserts the new day(s) atomically under the existing `DEFERRABLE` unique constraint — same pattern as `reschedule_itinerary_days`. `addItineraryDay` is unchanged except it flags its `23505` collision as `dateTaken`; the client turns that flag into a native confirm that calls a thin `insertItineraryDayWithShift` action. This is build-slice 2's overflow half from the spec (`docs/superpowers/specs/2026-06-04-itinerary-gap-days-design.md`); empty slots + click-to-fill already shipped (PR #9). Location date spans (build-3) are a separate plan.

**Tech Stack:** Supabase Postgres (plpgsql RPC), Next.js 16 Server Actions, React 19 client component.

**Note on testing:** This repo has no test suite (per `CLAUDE.md` — do not invent a test command). Each code task is verified with `pnpm build` and `pnpm lint`; the RPC + flow is verified manually at the end. Commit after each task. The migration (Task 1) must be pasted into the Supabase SQL Editor before the manual verification will work (Task 5) — same workflow as prior migrations.

**Scope note:** `shift_and_insert_itinerary` shifts `itinerary_days` and extends `trips.end_date` only. It deliberately does NOT touch `itinerary_locations` dates — those columns don't exist yet (build-3). When build-3 lands, the RPC gains a location-shift step.

---

### Task 1: Migration — `shift_and_insert_itinerary` RPC

**Files:**
- Create: `supabase/migrations/20260604000001_itinerary_shift_insert.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Overflow push for itinerary adds.
-- Opens a p_count-day window at p_from_date by shifting every day on/after it
-- forward, then inserts the new day(s) into the freed window -- atomically,
-- under the DEFERRABLE (trip_id, day_date) unique from
-- 20260529000002_itinerary_reschedule.sql. SECURITY INVOKER (default): the
-- caller's RLS gates the update/insert, and auth.uid() stamps created_by.
-- Multi-day adds (p_count > 1) share one group_id and an optional group_name,
-- so a pushed trek still renders in the "added together" box. Idempotent
-- (create or replace).

create or replace function public.shift_and_insert_itinerary(
  p_trip_id     uuid,
  p_from_date   date,
  p_count       int,
  p_title       text,
  p_sub         text,
  p_tag         text,
  p_tone        text,
  p_location_id uuid,
  p_group_name  text
) returns void
language plpgsql
as $$
declare
  v_group uuid := case when p_count > 1 then gen_random_uuid() else null end;
  v_name  text := case when p_count > 1 then nullif(btrim(p_group_name), '') else null end;
  v_uid   uuid := auth.uid();
begin
  set constraints all deferred;

  update public.itinerary_days
  set day_date = day_date + p_count
  where trip_id = p_trip_id and day_date >= p_from_date;

  insert into public.itinerary_days
    (trip_id, day_date, title, sub, tag, tone,
     group_id, group_name, location_id, created_by)
  select
    p_trip_id, p_from_date + g, p_title, p_sub, p_tag, p_tone,
    v_group, v_name, p_location_id, v_uid
  from generate_series(0, p_count - 1) as g;

  update public.trips
  set end_date = greatest(
    end_date,
    (select max(day_date) from public.itinerary_days where trip_id = p_trip_id)
  )
  where id = p_trip_id;
end;
$$;
```

- [ ] **Step 2: Apply it to the Supabase project**

Paste the SQL into the Supabase dashboard SQL Editor and run it. Idempotent — safe to paste and run more than once (`create or replace`). PostgREST reloads its schema cache automatically on DDL, so the RPC is callable immediately.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260604000001_itinerary_shift_insert.sql
git commit -m "feat(itinerary): shift_and_insert_itinerary RPC for overflow push"
```

---

### Task 2: Flag the date collision as `dateTaken`

**Files:**
- Modify: `src/lib/trips/actions.ts` (`AddItineraryDayResult` interface ~846-850; `addItineraryDay` `23505` branch ~928-937)

`addItineraryDay` already returns a friendly string on the `23505` unique violation. We add a boolean the client can branch on, so it doesn't have to string-match the message.

- [ ] **Step 1: Add `dateTaken` to `AddItineraryDayResult`**

In `src/lib/trips/actions.ts`, the interface currently reads:

```ts
export interface AddItineraryDayResult {
  error?: string
  /** Populated on success — full ItineraryDay (d ordinal is placeholder; client re-runs withOrdinals). */
  day?: ItineraryDay
}
```

Change it to:

```ts
export interface AddItineraryDayResult {
  error?: string
  /** Populated on success — full ItineraryDay (d ordinal is placeholder; client re-runs withOrdinals). */
  day?: ItineraryDay
  /** True when the insert failed only because the date(s) are already taken — the client may offer to push. */
  dateTaken?: boolean
}
```

- [ ] **Step 2: Set `dateTaken` in the `23505` branch**

In `addItineraryDay`, the collision branch currently reads:

```ts
  if (error) {
    if (error.code === "23505") {
      return {
        error:
          dates.length > 1
            ? "Some days in that range are already planned."
            : "Another day already uses that date.",
      }
    }
    return { error: error.message }
  }
```

Add `dateTaken: true` to the `23505` return:

```ts
  if (error) {
    if (error.code === "23505") {
      return {
        error:
          dates.length > 1
            ? "Some days in that range are already planned."
            : "Another day already uses that date.",
        dateTaken: true,
      }
    }
    return { error: error.message }
  }
```

- [ ] **Step 3: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds.

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(itinerary): flag date-collision adds as dateTaken"
```

---

### Task 3: `insertItineraryDayWithShift` action

**Files:**
- Modify: `src/lib/trips/actions.ts` (add a new exported action directly after `addItineraryDay`, before the `UpdateItineraryDayInput` interface ~944)

A thin wrapper over the RPC. It is only ever called by the client right after `addItineraryDay` returned `dateTaken` (so the input is already validated) — per the repo's no-defensive-code rule, it does not re-validate; it just computes the day count and calls the RPC. It reuses the existing module-level `enumerateDates` helper and the `AddItineraryDayInput` / `AddItineraryDayResult` types.

- [ ] **Step 1: Add the action**

In `src/lib/trips/actions.ts`, immediately after the closing `}` of `addItineraryDay` (the line right before `export interface UpdateItineraryDayInput {`), insert:

```ts
/**
 * Insert a day or multi-day block at an already-taken date by pushing every
 * later day forward to open the window. Only called after addItineraryDay
 * reported `dateTaken`, so the input is already validated. Atomic via the
 * shift_and_insert_itinerary RPC; Realtime + revalidate refresh the view.
 */
export async function insertItineraryDayWithShift(
  input: AddItineraryDayInput,
): Promise<AddItineraryDayResult> {
  const endDate = input.endDate?.trim() || input.dayDate
  const count = enumerateDates(input.dayDate, endDate).length

  const supabase = await createClient()
  const { error } = await supabase.rpc("shift_and_insert_itinerary", {
    p_trip_id: input.tripId,
    p_from_date: input.dayDate,
    p_count: count,
    p_title: input.title.trim(),
    p_sub: input.sub.trim(),
    p_tag: input.tag.trim(),
    p_tone: input.tone,
    p_location_id: input.locationId ?? null,
    p_group_name: input.groupName ?? null,
  })
  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}
```

- [ ] **Step 2: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds.

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(itinerary): insertItineraryDayWithShift action"
```

---

### Task 4: Client confirm-and-push in the add form

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (import ~8-14; `AddDayRow.submit` ~876-899)

- [ ] **Step 1: Import the new action**

In `src/app/trips/[slug]/itinerary-tab.tsx`, the actions import currently includes `addItineraryDay`:

```ts
import {
  addItineraryDay,
  createItineraryLocation,
  deleteItineraryDay,
  deleteItineraryGroup,
  deleteItineraryLocation,
  renameItineraryLocation,
  updateItineraryDay,
} from "@/lib/trips/actions"
```

Add `insertItineraryDayWithShift`:

```ts
import {
  addItineraryDay,
  createItineraryLocation,
  deleteItineraryDay,
  deleteItineraryGroup,
  deleteItineraryLocation,
  insertItineraryDayWithShift,
  renameItineraryLocation,
  updateItineraryDay,
} from "@/lib/trips/actions"
```

- [ ] **Step 2: Branch on `dateTaken` in `submit`**

In `AddDayRow`, the `submit` function's transition body currently reads:

```ts
    startTransition(async () => {
      const result = await addItineraryDay({
        tripId,
        tripSlug,
        dayDate,
        endDate,
        groupName,
        title,
        sub,
        tag,
        tone,
        locationId,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      reset()
    })
```

Replace it with a version that offers the push on `dateTaken`:

```ts
    startTransition(async () => {
      const payload = {
        tripId,
        tripSlug,
        dayDate,
        endDate,
        groupName,
        title,
        sub,
        tag,
        tone,
        locationId,
      }
      const result = await addItineraryDay(payload)
      if (result.dateTaken) {
        if (
          window.confirm(
            "No empty day there — push the following days forward to make room?",
          )
        ) {
          const pushed = await insertItineraryDayWithShift(payload)
          if (pushed.error) {
            setError(pushed.error)
            return
          }
          reset()
        }
        return
      }
      if (result.error) {
        setError(result.error)
        return
      }
      reset()
    })
```

- [ ] **Step 3: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds.

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): confirm-and-push when an add date is taken"
```

---

### Task 5: Manual verification + docs

**Files:** none (manual), then `docs/TODO.md`.

- [ ] **Step 1: Confirm the migration is applied**

If not already done in Task 1 Step 2, paste `supabase/migrations/20260604000001_itinerary_shift_insert.sql` into the Supabase SQL Editor and run it.

- [ ] **Step 2: Run the dev server**

Run: `pnpm dev`
Open a dated trip's itinerary tab at http://localhost:3000.

- [ ] **Step 3: Single-day push**

In a location group, pick two days with NO gap between them (consecutive dates). Click `+ day`, set the date to the earlier of the two (an already-used date), add a tag/title, submit. Confirm: a prompt appears — "No empty day there — push the following days forward to make room?". Confirm it. The new day lands on that date, and every later day shifts forward by one (no day is lost, no duplicate date). Cancel on a second attempt and confirm nothing changes.

- [ ] **Step 4: Multi-day (trek) push**

Add a From/To range (e.g. 3 days) starting on an already-used date with no room. Confirm the prompt, accept, and verify all 3 days insert as one "added together" block and the later days shift forward by 3. The trip's end date extends to still cover the last day.

- [ ] **Step 5: Free-date add still silent**

Add a day on a free/empty date (or via an empty slot). Confirm NO prompt appears — it inserts directly with no shift.

- [ ] **Step 6: Partner sync**

With the trip open on a second device/browser, confirm a push reflects there (the shifted dates + new day arrive via Realtime).

- [ ] **Step 7: Update docs**

Add a row to `docs/TODO.md` recording the overflow confirm-and-push done, referencing the spec and the migration file, and noting location date spans (build-3) remain.

```bash
git add docs/TODO.md
git commit -m "docs: record itinerary overflow confirm-and-push done"
```

---

## Self-Review

- **Spec coverage:** Implements the spec's "Overflow: push, with confirm" + the `shift_itinerary_from`-style RPC (here `shift_and_insert_itinerary`, doing shift+insert atomically) + `insertWithShift` action (here `insertItineraryDayWithShift`) + the `23505`-driven confirm. Covers both the single-day and multi-day-block anchors (Task 4 sends the same payload, RPC branches on `p_count`). Location date spans are explicitly out (build-3). ✓
- **Push by N, end_date extends:** RPC shifts by `p_count` and sets `end_date = greatest(end_date, max(day_date))` (extends only as needed, never shrinks). Matches spec decisions 4 and 5. ✓
- **No placeholders:** every code step shows the full SQL / TS. ✓
- **Type consistency:** `insertItineraryDayWithShift(input: AddItineraryDayInput): Promise<AddItineraryDayResult>` (Task 3) is imported and called with the `payload` object (Task 4); `dateTaken?: boolean` defined on `AddItineraryDayResult` (Task 2) is read in Task 4. RPC name `shift_and_insert_itinerary` and its 9 params match between Task 1 and Task 3. ✓
- **No defensive duplication:** `insertItineraryDayWithShift` skips re-validation (only reachable post-validation), per the repo's no-defensive-code rule. ✓
- **Risk:** the RPC is the one piece that can't be caught by build/lint — Task 5 exercises single, multi-day, free-date, and partner-sync paths against the applied migration.
