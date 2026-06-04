# Itinerary location date spans — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a location an optional date span (e.g. Kuta = Jun 12–16) so its whole range shows as fillable empty-day slots, editable via the location's ✎ editor, with locations ordered by start date.

**Architecture:** Build-3 of the "dated anchors" spec (`docs/superpowers/specs/2026-06-04-itinerary-gap-days-design.md`), scoped to **setting dates + rendering the span** for the non-overlapping case. Adds nullable `start_date`/`end_date` to `itinerary_locations`; threads them through types/queries; the existing ✎ rename control expands to a name + From/To editor; the per-group empty-slot renderer is rewritten to draw every unoccupied date across the location's effective range (declared span unioned with its days). The overlap **confirm-and-push** (a shift-only RPC that also moves later locations) is deliberately a **separate follow-up plan** — here, setting a span that overlaps existing dates is simply allowed and renders as-is.

**Tech Stack:** Supabase Postgres, Next.js 16 Server Actions, React 19 client component.

**Note on testing:** This repo has no test suite (per `CLAUDE.md` — do not invent a test command). Each code task is verified with `pnpm build` and `pnpm lint`; the feature is verified manually at the end. Commit after each task. The migration (Task 1) must be pasted into the Supabase SQL Editor before the manual verification (Task 6).

**Key decisions (locked with the user):**
1. Location dates are set by **expanding the existing ✎ editor** to name + From/To, not a new control or the create form.
2. This plan covers **setting dates + span empties + ordering only**; the overlap confirm-and-push is a later plan.
3. `start_date`/`end_date` are **nullable** — a date-less location keeps today's "span implied by its days" behavior.

---

### Task 1: Migration — location date columns

**Files:**
- Create: `supabase/migrations/20260604000002_itinerary_location_dates.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Optional date span for an itinerary location (e.g. Kuta = Jun 12-16).
-- Both null = "span implied by its days" (current behavior). When set, the
-- whole range renders as fillable empty-day slots. The check keeps them
-- consistent. Inherits the table's existing RLS; no index. Idempotent.

alter table public.itinerary_locations
  add column if not exists start_date date,
  add column if not exists end_date   date;

alter table public.itinerary_locations
  drop constraint if exists itinerary_locations_span_chk;
alter table public.itinerary_locations
  add constraint itinerary_locations_span_chk
  check (
    (start_date is null and end_date is null)
    or (start_date is not null and end_date is not null and end_date >= start_date)
  );
```

- [ ] **Step 2: Apply it to the Supabase project**

Paste the SQL into the Supabase dashboard SQL Editor and run it (project `zctbypyfvebhildcdkto`). Idempotent — safe to run more than once. PostgREST reloads its schema cache automatically on DDL.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260604000002_itinerary_location_dates.sql
git commit -m "feat(itinerary): location date span columns"
```

---

### Task 2: Thread the span through location types + query

**Files:**
- Modify: `src/lib/trips/location-types.ts`
- Modify: `src/lib/trips/location-queries.ts:14`

- [ ] **Step 1: Add the span to the types + mapper**

Replace the whole contents of `src/lib/trips/location-types.ts` with:

```ts
export interface ItineraryLocation {
  id: string
  name: string
  sortOrder: number
  /** Declared start of the location's span; null = implied by its days. */
  startDate: string | null
  /** Declared end of the location's span; null = implied by its days. */
  endDate: string | null
}

export interface ItineraryLocationRow {
  id: string
  name: string
  sort_order: number
  start_date?: string | null
  end_date?: string | null
}

export function rowToLocation(row: ItineraryLocationRow): ItineraryLocation {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
  }
}
```

- [ ] **Step 2: Select the new columns**

In `src/lib/trips/location-queries.ts`, change the `.select(...)` (line 14) from:

```ts
    .select("id, name, sort_order")
```

to:

```ts
    .select("id, name, sort_order, start_date, end_date")
```

- [ ] **Step 3: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds.

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/location-types.ts src/lib/trips/location-queries.ts
git commit -m "feat(itinerary): thread location span through types + query"
```

---

### Task 3: Carry the span into groups + order by start date

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (`DayGroup` interface ~107-113; `orderTabs` ~84-103; `buildGroups` ~124-167)

No visible change yet (all spans are null until Task 4), but it compiles and wires the span into the group model and ordering.

- [ ] **Step 1: Add `start`/`end` to `DayGroup`**

The interface currently reads:

```ts
interface DayGroup {
  key: string
  name: string
  /** null for the transit group. */
  tone: ItineraryTone | null
  /** 1-based location number, or null for transit. */
  ord: number | null
  days: ItineraryDay[]
}
```

Add the declared span (null for transit / undated locations):

```ts
interface DayGroup {
  key: string
  name: string
  /** null for the transit group. */
  tone: ItineraryTone | null
  /** 1-based location number, or null for transit. */
  ord: number | null
  /** Declared span start; null = implied by days. */
  start: string | null
  /** Declared span end; null = implied by days. */
  end: string | null
  days: ItineraryDay[]
}
```

- [ ] **Step 2: Order tabs by start date when set**

`orderTabs` currently keys off the earliest day only:

```ts
  return [...locations].sort((a, b) => {
    const da = earliest.get(a.id)
    const db = earliest.get(b.id)
    if (da && db) return da < db ? -1 : da > db ? 1 : a.sortOrder - b.sortOrder
    if (da) return -1
    if (db) return 1
    return a.sortOrder - b.sortOrder
  })
```

Prefer the declared `startDate` when present, falling back to the earliest day:

```ts
  return [...locations].sort((a, b) => {
    const da = a.startDate ?? earliest.get(a.id)
    const db = b.startDate ?? earliest.get(b.id)
    if (da && db) return da < db ? -1 : da > db ? 1 : a.sortOrder - b.sortOrder
    if (da) return -1
    if (db) return 1
    return a.sortOrder - b.sortOrder
  })
```

- [ ] **Step 3: Populate `start`/`end` in `buildGroups`**

The location-group map currently reads:

```ts
  const groups: DayGroup[] = orderTabs(locations, days).map((loc, i) => ({
    key: loc.id,
    name: loc.name,
    tone: slugToTone(loc.id),
    ord: i + 1,
    days: (byLoc.get(loc.id) ?? []).slice().sort(byDate),
  }))
```

Add the span:

```ts
  const groups: DayGroup[] = orderTabs(locations, days).map((loc, i) => ({
    key: loc.id,
    name: loc.name,
    tone: slugToTone(loc.id),
    ord: i + 1,
    start: loc.startDate,
    end: loc.endDate,
    days: (byLoc.get(loc.id) ?? []).slice().sort(byDate),
  }))
```

The transit-group push currently reads:

```ts
    groups.push({
      key: TRANSIT_KEY,
      name: "In transit",
      tone: null,
      ord: null,
      days: travel.slice().sort(byDate),
    })
```

Add null span fields:

```ts
    groups.push({
      key: TRANSIT_KEY,
      name: "In transit",
      tone: null,
      ord: null,
      start: null,
      end: null,
      days: travel.slice().sort(byDate),
    })
```

- [ ] **Step 4: Sort empty-but-dated groups by their span**

The final chronological sort currently keys off the first day only:

```ts
  return groups
    .map((g, idx) => ({ g, e: g.days[0]?.dayDate ?? null, idx }))
```

Prefer the declared start so a dated location with no days yet still sorts into place:

```ts
  return groups
    .map((g, idx) => ({ g, e: g.start ?? g.days[0]?.dayDate ?? null, idx }))
```

- [ ] **Step 5: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds.

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): carry location span into groups + ordering"
```

---

### Task 4: Action + ✎ editor for the span

**Files:**
- Modify: `src/lib/trips/actions.ts` (`renameItineraryLocation` ~1463-1481)
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (rename state ~321-322; `submitRename` ~345-353; rename button ~445-455; inline editor ~412-422)

The action and the editor change together so the build stays green (the editor supplies the dates the action now needs).

- [ ] **Step 1: Extend `renameItineraryLocation` to set the span**

In `src/lib/trips/actions.ts`, the action currently reads:

```ts
export async function renameItineraryLocation(
  locationId: string,
  tripSlug: string,
  name: string,
): Promise<RenameLocationResult> {
  const trimmed = name.trim()
  if (!trimmed) return { error: "Name required." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("itinerary_locations")
    .update({ name: trimmed })
    .eq("id", locationId)

  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}
```

Replace it with a version that also writes the span (both-or-neither; `start`/`end` are `string | null`):

```ts
export async function renameItineraryLocation(
  locationId: string,
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

- [ ] **Step 2: Add date state for the editor**

In `src/app/trips/[slug]/itinerary-tab.tsx`, the rename state currently reads:

```ts
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [renameVal, setRenameVal] = React.useState("")
```

Add From/To state:

```ts
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [renameVal, setRenameVal] = React.useState("")
  const [renameStart, setRenameStart] = React.useState("")
  const [renameEnd, setRenameEnd] = React.useState("")
```

- [ ] **Step 3: Send the span from `submitRename`**

The handler currently reads:

```ts
  function submitRename(e: React.FormEvent, locationId: string) {
    e.preventDefault()
    const name = renameVal.trim()
    if (!name) return
    startLoc(async () => {
      await renameItineraryLocation(locationId, tripSlug, name)
      setRenamingId(null)
    })
  }
```

Replace it with one that passes the span (both-or-neither; ignores an out-of-order range so the editor stays open):

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

- [ ] **Step 4: Seed the date state when opening the editor**

The rename button currently reads:

```tsx
                      <button
                        type="button"
                        aria-label="Rename location"
                        onClick={() => {
                          setRenameVal(group.name)
                          setRenamingId(group.key)
                        }}
                        className="border-0 bg-transparent px-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        ✎
                      </button>
```

Seed the From/To state from the group's span:

```tsx
                      <button
                        type="button"
                        aria-label="Edit location"
                        onClick={() => {
                          setRenameVal(group.name)
                          setRenameStart(group.start ?? "")
                          setRenameEnd(group.end ?? "")
                          setRenamingId(group.key)
                        }}
                        className="border-0 bg-transparent px-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        ✎
                      </button>
```

- [ ] **Step 5: Expand the inline editor to name + From/To**

The inline rename form currently reads:

```tsx
                    {isLoc && renamingId === group.key ? (
                      <form onSubmit={(e) => submitRename(e, group.key)}>
                        <input
                          type="text"
                          autoFocus
                          value={renameVal}
                          onChange={(e) => setRenameVal(e.target.value)}
                          onBlur={() => setRenamingId(null)}
                          className="t-display w-full border-0 border-b border-rule bg-transparent text-[20px] leading-none text-foreground focus:border-clay focus:outline-none"
                        />
                      </form>
                    ) : (
```

Replace the `<form>...</form>` (keep the surrounding `{isLoc && renamingId === group.key ? (` and `) : (`) with a stacked name + From/To editor. The `onBlur`-to-close is removed (multiple fields), replaced by explicit save/cancel:

```tsx
                    {isLoc && renamingId === group.key ? (
                      <form
                        onSubmit={(e) => submitRename(e, group.key)}
                        className="space-y-2"
                      >
                        <input
                          type="text"
                          autoFocus
                          value={renameVal}
                          onChange={(e) => setRenameVal(e.target.value)}
                          className="t-display w-full border-0 border-b border-rule bg-transparent text-[20px] leading-none text-foreground focus:border-clay focus:outline-none"
                        />
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            aria-label="Location start date"
                            value={renameStart}
                            onChange={(e) => setRenameStart(e.target.value)}
                            className="t-num border-0 border-b border-rule bg-transparent py-1 text-[12px] text-foreground focus:border-clay focus:outline-none"
                          />
                          <span className="font-mono text-[10px] text-muted-foreground">
                            –
                          </span>
                          <input
                            type="date"
                            aria-label="Location end date"
                            value={renameEnd}
                            min={renameStart || undefined}
                            onChange={(e) => setRenameEnd(e.target.value)}
                            className="t-num border-0 border-b border-rule bg-transparent py-1 text-[12px] text-foreground focus:border-clay focus:outline-none"
                          />
                          <button
                            type="submit"
                            className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-clay hover:text-foreground"
                          >
                            save
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingId(null)}
                            className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
                          >
                            cancel
                          </button>
                        </div>
                      </form>
                    ) : (
```

- [ ] **Step 6: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds.

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/trips/actions.ts "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): edit a location's date span via the inline editor"
```

---

### Task 5: Render the span as fillable empty slots

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts` (add `dateRange` helper after `gapDates`)
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (import ~15-22; header range subline ~392-441; segment IIFE ~476-567)

This rewrites the per-group renderer so empties are drawn for **every** unoccupied date across the group's effective range (declared span unioned with its days), interleaved with the day-segments in date order. The old "gap between segments" logic is subsumed: an undated location's effective range is just its first..last day, so it behaves exactly as today; a dated location additionally shows leading/trailing empties across its declared span.

- [ ] **Step 1: Add the `dateRange` helper**

In `src/lib/trips/itinerary-types.ts`, add after `formatShortDate`:

```ts
/** All yyyy-mm-dd dates in [start, end] inclusive, ascending. Empty if start > end. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
```

- [ ] **Step 2: Swap the `gapDates` import for `dateRange`**

In `src/app/trips/[slug]/itinerary-tab.tsx`, the import currently reads:

```ts
import {
  ITINERARY_TONES,
  formatShortDate,
  gapDates,
  rowToItineraryDay,
  withOrdinals,
  type ItineraryDay,
  type ItineraryTone,
} from "@/lib/trips/itinerary-types"
```

Change it to:

```ts
import {
  ITINERARY_TONES,
  dateRange,
  formatShortDate,
  rowToItineraryDay,
  withOrdinals,
  type ItineraryDay,
  type ItineraryTone,
} from "@/lib/trips/itinerary-types"
```

- [ ] **Step 3: Show the declared span in the header subline**

The group header currently computes `range` and renders the subline:

```tsx
            const range =
              count === 0
                ? ""
                : count === 1
                  ? group.days[0].date
                  : `${group.days[0].date} – ${last.date}`
```

Add a span-derived range just after it:

```tsx
            const range =
              count === 0
                ? ""
                : count === 1
                  ? group.days[0].date
                  : `${group.days[0].date} – ${last.date}`
            const spanRange =
              group.start && group.end
                ? `${formatShortDate(group.start)} – ${formatShortDate(group.end)}`
                : ""
```

The subline currently reads:

```tsx
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {count === 0
                        ? "no days"
                        : `${count} ${count === 1 ? "day" : "days"}${
                            range ? ` · ${range}` : ""
                          }`}
                    </div>
```

Prefer the declared span when set (so a dated location with no days shows its range, not "no days"):

```tsx
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {count === 0
                        ? spanRange || "no days"
                        : `${count} ${count === 1 ? "day" : "days"} · ${
                            spanRange || range
                          }`}
                    </div>
```

- [ ] **Step 4: Rewrite the segment IIFE to draw span empties**

The IIFE currently reads (the build-2 version that prefixes `emptySlots` to each segment):

```tsx
                    {(() => {
                      const segs = toSegments(group.days)
                      return segs.map((seg, si) => {
                        const prev = si > 0 ? segs[si - 1] : null
                        const gap = prev
                          ? gapDates(
                              prev.days[prev.days.length - 1].dayDate,
                              seg.days[0].dayDate,
                            )
                          : []
                        const emptySlots = gap.map((gd) => (
                          <button
                            type="button"
                            key={`empty-${gd}`}
                            onClick={() => {
                              setAddDayDate(gd)
                              setAddDayFor(group.key)
                            }}
                            className="my-1 flex w-full items-center gap-3 rounded-lg border border-dashed border-rule/70 px-3 py-2 text-left transition-colors hover:border-foreground"
                          >
                            <span className="t-num w-12 flex-shrink-0 font-mono text-[11px] text-muted-foreground">
                              {formatShortDate(gd)}
                            </span>
                            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                              empty
                            </span>
                            <span className="ml-auto font-mono text-[13px] leading-none text-muted-foreground/70">
                              +
                            </span>
                          </button>
                        ))
                        const cards = seg.days.map((day) => (
                          <DayCard
                            key={day.id}
                            day={day}
                            tripSlug={tripSlug}
                            isLast={day.id === last.id}
                            isEditing={editingId === day.id}
                            onStartEdit={() => setEditingId(day.id)}
                            onStopEdit={() => setEditingId(null)}
                            locations={locations}
                          />
                        ))
                        if (seg.groupId && seg.days.length > 1) {
                          return (
                            <React.Fragment key={seg.groupId}>
                              {emptySlots}
                              <div className="relative my-1.5 rounded-xl border border-rule px-2.5 pt-5 pb-1">
                                <span
                                  className={`absolute left-3 top-1.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
                                    seg.days[0].groupName
                                      ? "text-foreground"
                                      : "text-muted-foreground"
                                  }`}
                                >
                                  {seg.days[0].groupName ?? "added together"}
                                </span>
                                <form
                                  action={deleteItineraryGroup.bind(
                                    null,
                                    tripId,
                                    tripSlug,
                                    seg.groupId,
                                  )}
                                  onSubmit={(e) => {
                                    if (
                                      !window.confirm(
                                        `Delete all ${seg.days.length} days in this block? This can't be undone.`,
                                      )
                                    ) {
                                      e.preventDefault()
                                    }
                                  }}
                                  className="absolute right-1 top-0.5 inline-flex"
                                >
                                  <button
                                    type="submit"
                                    aria-label="Delete block"
                                    className="border-0 bg-transparent px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-clay"
                                  >
                                    ×
                                  </button>
                                </form>
                                {cards}
                              </div>
                            </React.Fragment>
                          )
                        }
                        return (
                          <React.Fragment key={seg.days[0].id}>
                            {emptySlots}
                            {cards}
                          </React.Fragment>
                        )
                      })
                    })()}
```

Replace the entire block with the unified ordered-items renderer:

```tsx
                    {(() => {
                      const segs = toSegments(group.days)
                      const dayDates = group.days.map((d) => d.dayDate)
                      // Effective range = declared span unioned with any days.
                      const lows = [group.start, ...dayDates].filter(
                        (v): v is string => Boolean(v),
                      )
                      const highs = [group.end, ...dayDates].filter(
                        (v): v is string => Boolean(v),
                      )
                      const rangeStart = lows.length
                        ? lows.reduce((a, b) => (a < b ? a : b))
                        : null
                      const rangeEnd = highs.length
                        ? highs.reduce((a, b) => (a > b ? a : b))
                        : null
                      const occupied = new Set(dayDates)
                      const empties =
                        rangeStart && rangeEnd
                          ? dateRange(rangeStart, rangeEnd).filter(
                              (d) => !occupied.has(d),
                            )
                          : []
                      type Item =
                        | { kind: "seg"; key: string; seg: (typeof segs)[number] }
                        | { kind: "empty"; key: string; date: string }
                      const items: Item[] = [
                        ...segs.map((seg) => ({
                          kind: "seg" as const,
                          key: seg.days[0].dayDate,
                          seg,
                        })),
                        ...empties.map((date) => ({
                          kind: "empty" as const,
                          key: date,
                          date,
                        })),
                      ].sort((a, b) =>
                        a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
                      )

                      return items.map((item) => {
                        if (item.kind === "empty") {
                          const gd = item.date
                          return (
                            <button
                              type="button"
                              key={`empty-${gd}`}
                              onClick={() => {
                                setAddDayDate(gd)
                                setAddDayFor(group.key)
                              }}
                              className="my-1 flex w-full items-center gap-3 rounded-lg border border-dashed border-rule/70 px-3 py-2 text-left transition-colors hover:border-foreground"
                            >
                              <span className="t-num w-12 flex-shrink-0 font-mono text-[11px] text-muted-foreground">
                                {formatShortDate(gd)}
                              </span>
                              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                                empty
                              </span>
                              <span className="ml-auto font-mono text-[13px] leading-none text-muted-foreground/70">
                                +
                              </span>
                            </button>
                          )
                        }
                        const seg = item.seg
                        const cards = seg.days.map((day) => (
                          <DayCard
                            key={day.id}
                            day={day}
                            tripSlug={tripSlug}
                            isLast={day.id === last.id}
                            isEditing={editingId === day.id}
                            onStartEdit={() => setEditingId(day.id)}
                            onStopEdit={() => setEditingId(null)}
                            locations={locations}
                          />
                        ))
                        if (seg.groupId && seg.days.length > 1) {
                          return (
                            <div
                              key={seg.groupId}
                              className="relative my-1.5 rounded-xl border border-rule px-2.5 pt-5 pb-1"
                            >
                              <span
                                className={`absolute left-3 top-1.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
                                  seg.days[0].groupName
                                    ? "text-foreground"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {seg.days[0].groupName ?? "added together"}
                              </span>
                              <form
                                action={deleteItineraryGroup.bind(
                                  null,
                                  tripId,
                                  tripSlug,
                                  seg.groupId,
                                )}
                                onSubmit={(e) => {
                                  if (
                                    !window.confirm(
                                      `Delete all ${seg.days.length} days in this block? This can't be undone.`,
                                    )
                                  ) {
                                    e.preventDefault()
                                  }
                                }}
                                className="absolute right-1 top-0.5 inline-flex"
                              >
                                <button
                                  type="submit"
                                  aria-label="Delete block"
                                  className="border-0 bg-transparent px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-clay"
                                >
                                  ×
                                </button>
                              </form>
                              {cards}
                            </div>
                          )
                        }
                        return (
                          <React.Fragment key={seg.days[0].id}>
                            {cards}
                          </React.Fragment>
                        )
                      })
                    })()}
```

- [ ] **Step 5: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds. If it fails on the `(typeof segs)[number]` type or the IIFE braces, re-check that the IIFE opened with `{(() => {` is closed with `})()}` and the `.map` callback returns one element per item.

Run: `pnpm lint`
Expected: no new errors. (`gapDates` is no longer imported; if lint flags it as unused, the Step 2 import swap was missed.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/trips/itinerary-types.ts "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): render a location's date span as empty slots"
```

---

### Task 6: Manual verification + docs

**Files:** none (manual), then `docs/TODO.md`.

- [ ] **Step 1: Confirm the migration is applied**

If not already done in Task 1, paste `supabase/migrations/20260604000002_itinerary_location_dates.sql` into the Supabase SQL Editor and run it.

- [ ] **Step 2: Run the dev server**

Run: `pnpm dev`
Open a dated trip's itinerary tab at http://localhost:3000.

- [ ] **Step 3: Set a span on an empty location**

Create a location (`+ location`), then click its ✎. Confirm the editor now shows a name field plus From/To date inputs and save/cancel. Set From/To a few days apart (e.g. 5 days), save. Confirm: the group's subline shows the range, and the whole span renders as faint dashed "empty" cards — one per date.

- [ ] **Step 4: Fill span days**

Click an empty slot in that span → the add form opens pre-filled with that date and the location. Submit. Confirm the empty card is replaced by the day card and the remaining span dates stay empty.

- [ ] **Step 5: Ordering**

Confirm locations order by their start date: a location with an earlier span sits above one with a later span, and a dated-but-empty location sits in the right chronological slot (not dumped at the bottom).

- [ ] **Step 6: Undated location unchanged**

Confirm a location with **no** span still behaves as before — empties only show *between* its days, none before its first or after its last day. The "In transit" group is unchanged.

- [ ] **Step 7: Edit/clear a span**

Re-open ✎, clear the From/To dates (leave them blank), save. Confirm the location reverts to "implied by days" behavior (no leading/trailing empties). Re-open and confirm the previously-set dates were cleared.

- [ ] **Step 8: Update docs**

Add a row to `docs/TODO.md` recording location date spans done, referencing the spec + migration, and noting the overlap confirm-and-push (shift-only RPC moving later locations) remains as the final follow-up.

```bash
git add docs/TODO.md
git commit -m "docs: record itinerary location date spans done"
```

---

## Self-Review

- **Spec coverage:** Implements the build-3 data model (`start_date`/`end_date` + check, Task 1), threading (Task 2), effective-range = declared-span-unioned-with-days rendering (Task 5), the ✎ editor for dates (Task 4), and ordering by start date (Task 3). The overlap **confirm-and-push** + shift-only RPC are explicitly deferred to a follow-up plan per the user's scope decision. ✓
- **No placeholders:** every step shows the full SQL / TS / TSX, including both before and after for the IIFE rewrite. ✓
- **Type consistency:** `ItineraryLocation` gains `startDate`/`endDate` (Task 2), read as `group.start`/`group.end` after `DayGroup` gains them (Task 3) and `buildGroups` populates them; `renameItineraryLocation(locationId, tripSlug, name, startDate, endDate)` (Task 4) is called with exactly those args from `submitRename`. `dateRange(start, end)` (Task 5) replaces the `gapDates` import. ✓
- **Build stays green per task:** the action signature change (Task 4) ships together with its only caller (`submitRename`), so no task leaves a dangling reference. ✓
- **Scope guard:** setting an overlapping span is allowed (no overlap detection here); it just renders. The `end >= start` check (DB + action + client) is the only constraint. The push is the next plan.
- **Risk:** the IIFE rewrite (Task 5) is the fragile part; Step 5 calls out the brace/closure checks. The DB `check` constraint can reject a bad span — the action surfaces that as `{error}` (though the inline editor has no error display, the client guards `end < start` first).

