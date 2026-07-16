# Fill All Days: Empty Days Become Real Rows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete "empty day" as a separate concept — a location with a date span holds a real `itinerary_days` row for every date in the span, and a row with no events is just a day.

**Architecture:** Relax the `title`/`tag` NOT-NULL checks so a day can be genuinely empty. A reconcile helper materializes an empty row for each date in a location's span; it is called from both span-write paths (`renameItineraryLocation`, `setLocationSpanWithShift`). A one-time backfill migration fills existing spans. Once every span date has a row, the derived-gap computation yields `[]`, so the empty-rendering UI stops firing on its own — that dead path is then removed and `reorderRangeSlots` simplified.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase Postgres (plpgsql + SQL migrations applied by hand), `@dnd-kit/sortable`, TypeScript 5.

## Global Constraints

- No test runner exists in this repo; do NOT add one. Verify with `pnpm lint`, `pnpm build`, a throwaway Node script for pure-logic sanity, and manual in-app checks. (CLAUDE.md: "do not invent a test command until one exists".)
- Migrations are applied by hand in the Supabase SQL editor and must be idempotent (paste-and-run repeatedly): use `if [not] exists`, `drop … if exists`, `on conflict … do nothing`.
- Single shared Supabase project — local dev and prod are the same DB.
- Dates display European order via `en-GB` (`{day} {mon}`); no `en-US`. (Not touched here, but keep it if editing date output.)
- No emojis in code, logs, or commit bodies. Sparse comments; clear names; short functions.
- `itinerary_days` unique constraint is `(trip_id, day_date)` — one day per date per trip. Reconcile/backfill rely on it via `on conflict do nothing`.
- Empty materialized rows use `tone = 'sand'`, `events` default `'[]'`, `title`/`tag` null. `location_id` = the location; `created_by` = a real user id (FK to `auth.users`).
- Do NOT design how an empty (0-event) day looks — that is a separate later task. A contentless row falls through to the normal day card.

---

### Task 1: Migration — allow genuinely empty days

Relax the `title` and `tag` constraints so a materialized empty day can carry no title/tag. `tone` stays required.

**Files:**
- Create: `supabase/migrations/20260716000003_itinerary_days_allow_empty.sql`

**Interfaces:**
- Produces: `itinerary_days.title` and `.tag` are nullable with no non-empty check; empty rows become insertable.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260716000003_itinerary_days_allow_empty.sql`:

```sql
-- Empty days are real rows: allow a day to have no title/tag so a materialized
-- empty day (a date in a location's span with no events) is insertable. tone
-- stays required (styling, defaults to 'sand'). Idempotent.
alter table public.itinerary_days alter column title drop not null;
alter table public.itinerary_days alter column tag   drop not null;
alter table public.itinerary_days drop constraint if exists itinerary_days_title_check;
alter table public.itinerary_days drop constraint if exists itinerary_days_tag_check;
```

- [ ] **Step 2: Apply it manually**

Paste into the Supabase SQL editor and run. Run a second time to confirm it is idempotent (no error). Verify the checks are gone:

```sql
select conname from pg_constraint
where conrelid = 'public.itinerary_days'::regclass and contype = 'c';
```
Expected: no `itinerary_days_title_check` / `itinerary_days_tag_check` rows (the `tone in (...)` check may remain).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260716000003_itinerary_days_allow_empty.sql
git commit -m "feat(itinerary): allow empty title/tag so empty days are real rows"
```

---

### Task 2: Reconcile helper + hook into both span-write paths

A location whose span is set/edited gets an empty row for every date in the span (insert-only; existing days skipped via `on conflict do nothing`).

**Files:**
- Modify: `src/lib/trips/actions.ts` (add helper near `enumerateDates` ~line 1141; call it inside `renameItineraryLocation` ~line 2651 and `setLocationSpanWithShift` ~line 2685)

**Interfaces:**
- Consumes: existing `createClient`, `enumerateDates(start, end): string[]`, `SupabaseClient` from the authed client.
- Produces: `fillLocationSpanDays(supabase, tripId, locationId, startDate, endDate): Promise<void>` — inserts empty rows for `[startDate, endDate]`, ignoring dates already taken.

- [ ] **Step 1: Add the reconcile helper**

In `src/lib/trips/actions.ts`, directly after `enumerateDates` (ends ~line 1150), add:

```ts
/**
 * Materializes an empty itinerary_days row for every date in [startDate,
 * endDate] under `locationId`. Insert-only: dates already taken (this
 * location's real days, or a prior fill) are skipped via on-conflict, so it is
 * safe to call after any span write and safe to re-run. Empty rows carry no
 * title/tag and default tone 'sand'; their look is refined separately.
 */
async function fillLocationSpanDays(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tripId: string,
  locationId: string,
  startDate: string,
  endDate: string,
): Promise<void> {
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) return
  const rows = enumerateDates(startDate, endDate).map((day_date) => ({
    trip_id: tripId,
    day_date,
    tone: "sand",
    location_id: locationId,
    created_by: userId,
  }))
  await supabase
    .from("itinerary_days")
    .upsert(rows, { onConflict: "trip_id,day_date", ignoreDuplicates: true })
}
```

- [ ] **Step 2: Call it from `renameItineraryLocation`**

In `renameItineraryLocation`, the span is written by the `.update(...)` block (~line 2651-2660). Immediately after the `if (error) return { error: error.message }` that follows that update, and before `if (span) await growTripEndDate(...)`, add a fill when a span is present. Change:

```ts
  if (error) return { error: error.message }

  if (span) await growTripEndDate(tripId, span.endDate)
  revalidatePath(`/trips/${tripSlug}`)
  return {}
```

to:

```ts
  if (error) return { error: error.message }

  if (span) {
    await fillLocationSpanDays(
      supabase,
      tripId,
      locationId,
      span.startDate,
      span.endDate,
    )
    await growTripEndDate(tripId, span.endDate)
  }
  revalidatePath(`/trips/${tripSlug}`)
  return {}
```

- [ ] **Step 3: Call it from `setLocationSpanWithShift`**

In `setLocationSpanWithShift`, after the RPC succeeds (~line 2692, after `if (error) return { error: error.message }`) and before `revalidatePath`, add:

```ts
  if (error) return { error: error.message }

  await fillLocationSpanDays(supabase, tripId, locationId, startDate, endDate)
  revalidatePath(`/trips/${tripSlug}`)
  return {}
```

- [ ] **Step 4: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: success; no new errors referencing `actions.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(itinerary): fill a location span with empty days on span edit"
```

- [ ] **Step 6: Manual check (forward path)**

Run `pnpm dev`, open a trip's itinerary. Set a span on a location that has a gap (e.g. days only on the first and last date). After saving, every date in the span shows as a day (empty ones render as bare day cards — their look is intentionally unstyled for now). Drag still reorders days. A partner session sees the new rows via Realtime.

(If `pnpm dev` throws the Windows Turbopack `0xc0000142` panic, stop, delete `.next/`, restart — known subprocess flake, not this change.)

---

### Task 3: Backfill migration — fill existing spans

Materialize empty rows for every date in every already-declared location span.

**Files:**
- Create: `supabase/migrations/20260716000004_backfill_location_span_days.sql`

**Interfaces:**
- Consumes: the relaxed constraints from Task 1; `itinerary_locations.created_by`.
- Produces: existing spanned locations have no gaps.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260716000004_backfill_location_span_days.sql`:

```sql
-- One-time (idempotent) backfill: give every declared location span a real
-- itinerary_days row per date. Dates already taken are skipped. Mirrors the
-- app's fillLocationSpanDays. Empty rows: no title/tag, tone 'sand'.
insert into public.itinerary_days (trip_id, day_date, tone, location_id, created_by)
select l.trip_id, gs::date, 'sand', l.id, l.created_by
from public.itinerary_locations l
cross join lateral generate_series(l.start_date, l.end_date, interval '1 day') gs
where l.start_date is not null and l.end_date is not null
on conflict (trip_id, day_date) do nothing;
```

- [ ] **Step 2: Apply it manually**

Paste into the Supabase SQL editor and run. Re-run to confirm idempotency (second run inserts 0 rows). Spot-check a spanned location now has a row for every date:

```sql
select day_date, title, location_id
from public.itinerary_days
where location_id = '<some-location-id>'
order by day_date;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260716000004_backfill_location_span_days.sql
git commit -m "feat(itinerary): backfill existing location spans with empty days"
```

- [ ] **Step 4: Manual check**

Reload the itinerary in the app. Existing spanned locations now show a card for every date, with no dashed empty-gap placeholders remaining (all dates are real rows). Confirm nothing looks doubled or missing.

---

### Task 4: Remove the empty-rendering code path

With spans filled, `empties` is `[]` for spanned locations, so the gap UI is dead there. Remove it entirely so no empty placeholders render anywhere (a no-span location then simply shows its real days). Simplify `reorderRangeSlots` since it will only ever receive occupied dates.

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`
- Modify: `src/lib/trips/itinerary-types.ts`
- Scratch (not committed): `<scratchpad>/reorder-check.mjs`

**Interfaces:**
- Consumes: existing `toSegments`, `DaySegmentView`, `rescheduleItineraryDaysTo`.
- Produces: `reorderRangeSlots(days, slotDates, activeId, overId)` unchanged in signature but with the `empty:` branch removed.

- [ ] **Step 1: Simplify `reorderRangeSlots` — sanity script first**

Write `<scratchpad>/reorder-check.mjs` to de-risk the simplified index math (occupied-only, no empty slots):

```js
function moveItem(arr, from, to) {
  const next = arr.slice()
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}
function reorderRangeSlots(days, slotDates, activeId, overId) {
  if (activeId === overId) return []
  const idByDate = new Map(days.map((d) => [d.dayDate, d.id]))
  const dateById = new Map(days.map((d) => [d.id, d.dayDate]))
  const ids = slotDates.map((date) => idByDate.get(date)).filter(Boolean)
  const oldIndex = ids.indexOf(activeId)
  const newIndex = ids.indexOf(overId)
  if (oldIndex === -1 || newIndex === -1) return []
  const moved = moveItem(ids, oldIndex, newIndex)
  const changes = []
  moved.forEach((id, i) => {
    if (dateById.get(id) !== slotDates[i]) changes.push({ id, date: slotDates[i] })
  })
  return changes
}

const days = [
  { id: "A", dayDate: "2026-06-12" },
  { id: "B", dayDate: "2026-06-13" },
  { id: "C", dayDate: "2026-06-14" },
]
const dates = ["2026-06-12", "2026-06-13", "2026-06-14"]
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1) } }

// Move C to front: C->12, A->13, B->14.
let out = reorderRangeSlots(days, dates, "C", "A")
assert(out.find((c) => c.id === "C").date === "2026-06-12", "C to 12")
assert(out.find((c) => c.id === "A").date === "2026-06-13", "A to 13")
assert(out.find((c) => c.id === "B").date === "2026-06-14", "B to 14")

// No-op.
assert(JSON.stringify(reorderRangeSlots(days, dates, "A", "A")) === "[]", "no-op")

// Past-filtered slotDates (live trip): dropping 06-12 makes A inert.
out = reorderRangeSlots(days, ["2026-06-13", "2026-06-14"], "A", "B")
assert(JSON.stringify(out) === "[]", "past active inert")

console.log("all sanity checks passed")
```

Run: `node "<scratchpad>/reorder-check.mjs"`
Expected: `all sanity checks passed`.

- [ ] **Step 2: Apply the simplification to `itinerary-types.ts`**

In `src/lib/trips/itinerary-types.ts`, replace the body of `reorderRangeSlots` (the function starting ~line 248) with the sanity-checked version. Update its doc comment to drop the empty-slot language:

```ts
/** Reorder a location's days over the given ascending `slotDates` (its occupied
 * dates, past-filtered on a live trip), then re-lay onto those dates. Returns
 * only the days whose date changed. Pure; safe client-side for the optimistic
 * update. */
export function reorderRangeSlots(
  days: ItineraryDay[],
  slotDates: string[],
  activeId: string,
  overId: string,
): { id: string; date: string }[] {
  if (activeId === overId) return []
  const idByDate = new Map(days.map((d) => [d.dayDate, d.id]))
  const dateById = new Map(days.map((d) => [d.id, d.dayDate]))
  const ids = slotDates
    .map((date) => idByDate.get(date))
    .filter((id): id is string => Boolean(id))
  const oldIndex = ids.indexOf(activeId)
  const newIndex = ids.indexOf(overId)
  if (oldIndex === -1 || newIndex === -1) return []
  const moved = moveItem(ids, oldIndex, newIndex)
  const changes: { id: string; date: string }[] = []
  moved.forEach((id, i) => {
    if (dateById.get(id) !== slotDates[i]) changes.push({ id, date: slotDates[i] })
  })
  return changes
}
```

Then delete `effectiveRange` if `pnpm exec grep -rn "effectiveRange" src` shows no importers after Task 4's tab edits (check in Step 6). Leave `dateRange`, `gapDates`, `moveItem`, `formatShortDate` — verify their usage in Step 6 before removing anything else.

- [ ] **Step 3: Remove the empty computation and row model in `itinerary-tab.tsx`**

In `src/app/trips/[slug]/itinerary-tab.tsx`, inside the `dayRows` IIFE (~line 928 onward): the block currently builds `segs`, then `rangeStart`/`rangeEnd`/`occupied`/`empties`, then an `Item[]` list, then coalesces into `Row[]` (`seg` | `emptyRun`). Replace everything from `const segs = toSegments(group.days)` down to the end of the `for (const item of items)` loop that builds `rows` with:

```tsx
                      const segs = toSegments(group.days)
                      type Row = { kind: "seg"; seg: (typeof segs)[number] }
                      const rows: Row[] = segs.map((seg) => ({ kind: "seg", seg }))
```

This drops `rangeStart`, `rangeEnd`, `occupied`, `empties`, the `Item` type/list, `emptyRun`, and the coalescing loop.

- [ ] **Step 4: Simplify `renderRow`, `rowSortableIds`, and `fillEmpty`**

Still in the IIFE: `renderRow` now only handles the `seg` kind. Replace the `renderRow` definition (its `if (row.kind === "emptyRun") { … }` branch and the seg tail) with just the seg render:

```tsx
                      const renderRow = (row: Row, sortable: boolean) => (
                        <DaySegmentView
                          key={row.seg.groupId ?? row.seg.days[0].id}
                          seg={row.seg}
                          tripId={tripId}
                          tripSlug={tripSlug}
                          lastDayId={last.id}
                          editingId={editingId}
                          setEditingId={setEditingId}
                          locations={locations}
                          collapsedDays={collapsedDays}
                          toggleDay={toggleDay}
                          dimBefore={active ? today : null}
                          today={today}
                          categories={categories}
                          members={members}
                          currentUserId={currentUserId}
                          sortable={sortable}
                        />
                      )
```

Replace `rowSortableIds` with the seg-only form:

```tsx
                      const rowSortableIds = (row: Row): string[] =>
                        canSort ? row.seg.days.map((d) => d.id) : []
```

Delete the `fillEmpty` declaration (the `setAddDayDate(date); setAddDayFor(group.key)` closure) — it has no callers once empties are gone. `rowEnd` (used for past/live split) must also stop referencing `emptyRun`; replace its definition with:

```tsx
                      const rowEnd = (row: Row) =>
                        row.seg.days[row.seg.days.length - 1].dayDate
```

- [ ] **Step 5: Remove empty-only components and state**

- Delete the `EmptyDayButton` function and the `SortableEmptyDay` function (near the bottom of the file).
- Delete the `expandedRuns` state and its setter (`const [expandedRuns, setExpandedRuns] = …`) and the `toggleRun` function.
- In `itinerary-types.ts` imports at the top of the tab, remove `formatShortDate` ONLY if Step 6's grep shows it is now unused in the tab (the location header at ~line 802 still uses it — likely keep it).

- [ ] **Step 6: Reconcile leftovers, then verify**

Run these greps and act on each:

```bash
pnpm exec grep -rn "empty:\|EmptyDayButton\|SortableEmptyDay\|emptyRun\|expandedRuns\|toggleRun\|fillEmpty" src
pnpm exec grep -rn "effectiveRange\|formatShortDate" src
```
Expected: the first grep returns nothing. For the second, keep `effectiveRange`/`formatShortDate` only if still referenced; delete `effectiveRange` from `itinerary-types.ts` if it has no importers, and drop unused imports the linter flags.

Then:

Run: `pnpm lint && pnpm build`
Expected: success, no errors. Remove any unused-import/variable the linter reports (e.g. `addDayDate` pre-dating is now always `""` — if the linter flags it, simplify `AddDayRow`'s `defaultDate` to `defaultDate` and drop `addDayDate` state; otherwise leave it).

- [ ] **Step 7: Manual check (both modes)**

Run `pnpm dev`, open the itinerary.
- Planning (future trip): a spanned location shows a card per date; no dashed gap rows anywhere; drag reorders days; a no-span location shows only its real days (no gap placeholders).
- On the road (a live trip): the "earlier days" collapse still works; past dates are not valid drops; today-or-later reorder works.
- Locationless trip: days still reorder freely.
- Partner session sees changes via Realtime.

- [ ] **Step 8: Commit**

```bash
git add src/app/trips/[slug]/itinerary-tab.tsx src/lib/trips/itinerary-types.ts
git commit -m "refactor(itinerary): remove empty-day rendering; days are the one block"
```

---

### Task 5: Docs

**Files:**
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`

- [ ] **Step 1: Update TODO + DECISIONS**

- `docs/TODO.md`: under the itinerary section, note that empty days are now real rows materialized from a location's span; the derived-gap / drag-empties UI was removed.
- `docs/DECISIONS.md`: append a row dated 2026-07-16 — "Itinerary empty days are real `itinerary_days` rows materialized for every date in a location's span (via `fillLocationSpanDays` + backfill); `title`/`tag` made nullable; the derived-gap rendering and `empty:<date>` drag slots were removed. Reverses the 2026-07-16 drag-empty-days approach."

- [ ] **Step 2: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs(itinerary): record empty-days-as-real-rows decision"
```

---

## Self-Review

**Spec coverage:**
- Delete empty-day concept / one building block → Task 4 (removes the rendering path; days are the only block).
- Real row per span date → Task 2 (`fillLocationSpanDays`) + Task 3 (backfill).
- Empty row insertable (title/tag) → Task 1.
- Drag is a plain permutation → Task 4 Step 2 (simplified `reorderRangeSlots`); existing `rescheduleItineraryDaysTo` reused (Task 4 keeps it).
- Visual of an empty day deferred → no task styles it; Global Constraints call it out; contentless rows fall through to the normal card.
- Insert-only reconcile / no-span behavior / shrink deferral → matches spec "Deferred".

**Placeholder scan:** No TBD/TODO — every code step shows full code. Greps in Task 4 Step 6 gate the conditional deletions (`effectiveRange`, unused imports, `addDayDate`).

**Type consistency:** `fillLocationSpanDays(supabase, tripId, locationId, startDate, endDate)` matches its two call sites (Task 2 Steps 2-3). `reorderRangeSlots(days, slotDates, activeId, overId): {id,date}[]` signature unchanged between `itinerary-types.ts` and its tab call site. `Row` is narrowed to a single `{ kind: "seg"; seg }` shape and every consumer (`renderRow`, `rowSortableIds`, `rowEnd`, past/live split) is updated in Task 4 Steps 3-4.
