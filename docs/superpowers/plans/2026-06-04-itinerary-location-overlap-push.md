# Itinerary location overlap confirm-and-push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setting a location's date span onto already-occupied dates offers to push the conflicting later days and later location spans forward (gap-aware), instead of silently overlapping.

**Architecture:** The final piece of the "dated anchors" spec (`docs/superpowers/specs/2026-06-04-itinerary-gap-days-design.md`). A shift-only RPC `set_location_span_with_shift` opens room for the span by moving everything at/after the span start forward by the gap-aware overflow — both `itinerary_days` (excluding this location's own) and other locations' spans (as whole units) — then writes this location's name + span, and extends `trips.end_date`. The ✎ editor's save first calls the existing `renameItineraryLocation`, which now detects an overlap and returns `needsPush`; the client then shows a confirm and calls the new push action. Mirrors the day-add flow (`addItineraryDay` → `dateTaken` → `insertItineraryDayWithShift`).

**Tech Stack:** Supabase Postgres (plpgsql RPC), Next.js 16 Server Actions, React 19 client component.

**Note on testing:** No test suite (per `CLAUDE.md`). Each code task is verified with `pnpm build` + `pnpm lint`; the RPC/flow is verified manually. Commit after each task. The migration (Task 1) must be applied in the Supabase SQL Editor before the manual verification (Task 3).

**Decisions (locked with the user):**
1. **Locations never overlap:** an overlap is triggered by another location's **day** in the window OR another location whose **span starts** in the window.
2. **What moves (gap-aware overflow):** later days (any location / transit, but **not** this location's own days) + later locations' spans (start+end together) + `trips.end_date`. Empty buffer days at the span start are consumed; only the overflow is pushed.

**Scope limitation (documented, not handled):** a *straddling* earlier location whose span starts **before** the new span but extends into it is not detected or shifted (its start is `< p_start`). The realistic front-to-back workflow bumps into *later* locations/days, which is handled. Straddles remain a rare manual cleanup.

---

### Task 1: Migration — `set_location_span_with_shift` RPC

**Files:**
- Create: `supabase/migrations/20260604000003_location_span_shift.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Confirm-and-push for setting a location's date span onto occupied dates.
-- Opens a span-length window at p_start by shifting everything at/after it
-- forward by the gap-aware overflow (span length minus the free runway before
-- the first occupied date) -- both itinerary_days (excluding this location's
-- own days) and OTHER locations' spans (moved as whole units) -- then writes
-- this location's name + span and extends trips.end_date. Atomic under the
-- DEFERRABLE (trip_id, day_date) unique. SECURITY INVOKER (default): caller RLS
-- gates every write. Idempotent (create or replace).

create or replace function public.set_location_span_with_shift(
  p_location_id uuid,
  p_trip_id     uuid,
  p_name        text,
  p_start       date,
  p_end         date
) returns void
language plpgsql
as $$
declare
  v_count int := (p_end - p_start) + 1;
  v_first date;
  v_shift int;
begin
  set constraints all deferred;

  -- First date at/after p_start occupied by something other than this location
  -- (another location's day/transit day, or another location's span start).
  select min(d) into v_first from (
    select min(day_date) as d
    from public.itinerary_days
    where trip_id = p_trip_id and day_date >= p_start
      and location_id is distinct from p_location_id
    union all
    select min(start_date) as d
    from public.itinerary_locations
    where trip_id = p_trip_id and id <> p_location_id and start_date >= p_start
  ) x;

  v_shift := case
    when v_first is null then 0
    else greatest(0, v_count - (v_first - p_start))
  end;

  update public.itinerary_days
  set day_date = day_date + v_shift
  where trip_id = p_trip_id and day_date >= p_start
    and location_id is distinct from p_location_id;

  update public.itinerary_locations
  set start_date = start_date + v_shift,
      end_date   = end_date + v_shift
  where trip_id = p_trip_id and id <> p_location_id and start_date >= p_start;

  update public.itinerary_locations
  set name = p_name, start_date = p_start, end_date = p_end
  where id = p_location_id;

  update public.trips
  set end_date = greatest(
    end_date,
    coalesce((select max(day_date) from public.itinerary_days where trip_id = p_trip_id), end_date),
    coalesce((select max(end_date) from public.itinerary_locations where trip_id = p_trip_id), end_date)
  )
  where id = p_trip_id;
end;
$$;
```

- [ ] **Step 2: Apply it to the Supabase project**

Paste into the Supabase SQL Editor and run (project `zctbypyfvebhildcdkto`). Idempotent. PostgREST reloads its schema cache on DDL.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260604000003_location_span_shift.sql
git commit -m "feat(itinerary): set_location_span_with_shift RPC for overlap push"
```

---

### Task 2: Overlap detection + push action + client confirm

**Files:**
- Modify: `src/lib/trips/actions.ts` (`RenameLocationResult` ~1491-1493; `renameItineraryLocation` ~1495-1524; add `setLocationSpanWithShift` after it)
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (`submitRename` ~345-363)

The action signature, the new push action, and the client all change together so the build stays green (the client supplies the new `tripId` arg, and reads the new `needsPush` flag).

- [ ] **Step 1: Add `needsPush` to `RenameLocationResult`**

In `src/lib/trips/actions.ts`, the type currently reads:

```ts
export interface RenameLocationResult {
  error?: string
}
```

Add the flag:

```ts
export interface RenameLocationResult {
  error?: string
  /** True when the span overlaps other days/locations — the client may offer to push. */
  needsPush?: boolean
}
```

- [ ] **Step 2: Detect overlap in `renameItineraryLocation`**

Replace the whole function (it currently takes `locationId, tripSlug, name, startDate, endDate`) with one that takes `tripId` too and, when a span is set, checks for an overlap and returns `needsPush` instead of writing:

```ts
/** Updates a location's name + optional span. When the span overlaps other
 * days or another location's start, returns { needsPush } without writing so
 * the caller can confirm the push. */
export async function renameItineraryLocation(
  locationId: string,
  tripId: string,
  tripSlug: string,
  name: string,
  startDate: string | null,
  endDate: string | null,
): Promise<RenameLocationResult> {
  const trimmed = name.trim()
  if (!trimmed) return { error: "Name required." }
  const span = startDate && endDate ? { startDate, endDate } : null
  if (span && span.endDate < span.startDate) {
    return { error: "End date must be on or after start date." }
  }

  const supabase = await createClient()

  if (span) {
    const dayHit = await supabase
      .from("itinerary_days")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", tripId)
      .or(`location_id.is.null,location_id.neq.${locationId}`)
      .gte("day_date", span.startDate)
      .lte("day_date", span.endDate)
    const spanHit = await supabase
      .from("itinerary_locations")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", tripId)
      .neq("id", locationId)
      .gte("start_date", span.startDate)
      .lte("start_date", span.endDate)
    if ((dayHit.count ?? 0) > 0 || (spanHit.count ?? 0) > 0) {
      return { needsPush: true }
    }
  }

  const { error } = await supabase
    .from("itinerary_locations")
    .update({
      name: trimmed,
      start_date: span ? span.startDate : null,
      end_date: span ? span.endDate : null,
    })
    .eq("id", locationId)

  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}
```

- [ ] **Step 3: Add the `setLocationSpanWithShift` action**

Immediately after `renameItineraryLocation`, add:

```ts
/** Sets a location's span by pushing conflicting later days + location spans
 * forward (gap-aware) via the RPC. Called after renameItineraryLocation
 * reported needsPush and the user confirmed. */
export async function setLocationSpanWithShift(
  locationId: string,
  tripId: string,
  tripSlug: string,
  name: string,
  startDate: string,
  endDate: string,
): Promise<RenameLocationResult> {
  const trimmed = name.trim()
  if (!trimmed) return { error: "Name required." }
  if (endDate < startDate) {
    return { error: "End date must be on or after start date." }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_location_span_with_shift", {
    p_location_id: locationId,
    p_trip_id: tripId,
    p_name: trimmed,
    p_start: startDate,
    p_end: endDate,
  })
  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}
```

- [ ] **Step 4: Import the push action in the client**

In `src/app/trips/[slug]/itinerary-tab.tsx`, the actions import currently includes `renameItineraryLocation`:

```ts
  deleteItineraryLocation,
  insertItineraryDayWithShift,
  renameItineraryLocation,
  updateItineraryDay,
} from "@/lib/trips/actions"
```

Add `setLocationSpanWithShift`:

```ts
  deleteItineraryLocation,
  insertItineraryDayWithShift,
  renameItineraryLocation,
  setLocationSpanWithShift,
  updateItineraryDay,
} from "@/lib/trips/actions"
```

- [ ] **Step 5: Confirm-and-push in `submitRename`**

`submitRename` currently reads:

```ts
  function submitRename(e: React.FormEvent, locationId: string) {
    e.preventDefault()
    const name = renameVal.trim()
    if (!name) return
    const start = renameStart.trim()
    const end = renameEnd.trim()
    const useSpan = Boolean(start && end)
    if (useSpan && end < start) return
    startLoc(async () => {
      await renameItineraryLocation(
        locationId,
        tripSlug,
        name,
        useSpan ? start : null,
        useSpan ? end : null,
      )
      setRenamingId(null)
    })
  }
```

Replace it with one that passes `tripId`, and on `needsPush` confirms then calls the push:

```ts
  function submitRename(e: React.FormEvent, locationId: string) {
    e.preventDefault()
    const name = renameVal.trim()
    if (!name) return
    const start = renameStart.trim()
    const end = renameEnd.trim()
    const useSpan = Boolean(start && end)
    if (useSpan && end < start) return
    startLoc(async () => {
      const result = await renameItineraryLocation(
        locationId,
        tripId,
        tripSlug,
        name,
        useSpan ? start : null,
        useSpan ? end : null,
      )
      if (result.needsPush) {
        if (
          window.confirm(
            "Those dates overlap other plans — push the following days and locations forward to make room?",
          )
        ) {
          await setLocationSpanWithShift(
            locationId,
            tripId,
            tripSlug,
            name,
            start,
            end,
          )
          setRenamingId(null)
        }
        return
      }
      setRenamingId(null)
    })
  }
```

- [ ] **Step 6: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds.

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/trips/actions.ts "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): confirm-and-push when a location span overlaps"
```

---

### Task 3: Manual verification + docs

**Files:** none (manual), then `docs/TODO.md`.

- [ ] **Step 1: Confirm the migration is applied**

If not done in Task 1, paste `supabase/migrations/20260604000003_location_span_shift.sql` into the Supabase SQL Editor and run it.

- [ ] **Step 2: Run the dev server**

Run: `pnpm dev`
Open a dated trip's itinerary tab at http://localhost:3000.

- [ ] **Step 3: Span overlapping a later location's days**

Have location A with days early, location B with days a bit later. Edit A (✎) and set its span so its end overlaps B's first day(s). Save → confirm prompt appears. Accept → B's days (and B's span, if set) shift forward by the overflow; A's span is set; no dates collide; trip end extends to cover the last day. Cancel on a retry → nothing changes.

- [ ] **Step 4: Gap-aware**

Set a span that overlaps but with one or more empty days at its start before the first occupied date. Confirm the push shifts by *less* than the full span length (the empty days are consumed) — everything stays contiguous, no extra trailing empties.

- [ ] **Step 5: No overlap stays silent**

Edit a location and set a span on entirely free dates (after everything, or in a big gap). Confirm NO prompt — it writes directly (the build-3 path).

- [ ] **Step 6: Own days not shifted**

Set a span around a location's OWN existing days (e.g. the location has a day on Jun 14; set its span Jun 12–16). Confirm that day stays on Jun 14 and is not pushed.

- [ ] **Step 7: Partner sync**

With the trip open on a second device, confirm a push reflects there (shifted days arrive via the itinerary Realtime channel; shifted location spans via the locations channel).

- [ ] **Step 8: Update docs**

Add a row to `docs/TODO.md` recording the location overlap confirm-and-push done (the final dated-anchors piece), referencing the spec + migration, and noting the straddle limitation.

```bash
git add docs/TODO.md
git commit -m "docs: record itinerary location overlap confirm-and-push done"
```

---

## Self-Review

- **Spec coverage:** Implements the spec's location-span overlap push as the final slice. Trigger = days + other-location starts (decision 1); shifts later days (excluding this location's own) + later location spans + `end_date` (decision 2); gap-aware overflow (`v_count - (v_first - p_start)`), consistent with the shipped day push. ✓
- **No placeholders:** full SQL / TS / TSX in every step. ✓
- **Type consistency:** `renameItineraryLocation(locationId, tripId, tripSlug, name, startDate, endDate)` (Task 2 Step 2) — `tripId` inserted as the 2nd arg — is called with that exact arity in `submitRename` (Step 5); `setLocationSpanWithShift(locationId, tripId, tripSlug, name, start, end)` matches between action (Step 3) and caller (Step 5); `needsPush?: boolean` on `RenameLocationResult` (Step 1) is read in Step 5. RPC name `set_location_span_with_shift` + its 5 params match between Task 1 and Task 2 Step 3. ✓
- **Build stays green per task:** Task 2 changes the action signature and its only caller together. ✓
- **Realtime:** shifted days broadcast on the `itinerary_days` channel (existing UPDATE handler); shifted location spans broadcast on the `itinerary_locations` channel (the `rowToLocation` UPDATE handler added in build-3). No new threading needed.
- **Known limitation:** a straddling earlier span (`start_date < p_start`, `end_date >= p_start`) is neither detected nor shifted; documented in the scope note and Task 3 covers the realistic later-bump cases.
- **Risk:** the RPC is the unverifiable-by-lint part; Task 3 exercises overlap, gap-aware, no-overlap, own-days, and partner-sync paths against the applied migration.
