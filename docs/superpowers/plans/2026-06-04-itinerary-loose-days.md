# Itinerary loose days + date-led cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lead the dated day card with the calendar date (ordinal moves to the corner), and let location-less days float on the timeline (interleaved by date), removing the forced "In transit" group and adding a top-level "+ day".

**Architecture:** Per `docs/superpowers/specs/2026-06-04-itinerary-loose-days-design.md`. Slice 1 (date card) adds derived `dom`/`mon` to `ItineraryDay` and swaps the `DayView` rail/corner. Slice 2 (loose days) extracts a shared `DaySegmentView`, replaces `buildGroups` with `buildTimeline` returning a date-sorted `TimelineItem[]` (location blocks + loose segments), rewrites the render loop to interleave them, drops the transit group, and adds a loose "+ day". No schema, no migration — loose adds reuse the existing add + overflow-push actions with `location_id = null`. Dreams (`DreamItineraryTab`) are untouched.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5. Client component `itinerary-tab.tsx` + pure helpers/types in `itinerary-types.ts`.

**Note on testing:** No test suite (per `CLAUDE.md`). Each task is verified with `pnpm build` and `pnpm lint`, plus a manual viewing step at the end. Commit after each task.

---

### Task 1: Derive `dom` + `mon` on `ItineraryDay`

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts`

- [ ] **Step 1: Add the formatters**

In `src/lib/trips/itinerary-types.ts`, alongside the existing `DOW_FMT` / `SHORT_DATE_FMT` formatters, add:

```ts
const DOM_FMT = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  timeZone: "UTC",
})

const MON_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
})
```

- [ ] **Step 2: Add the fields to `ItineraryDay`**

In the `ItineraryDay` interface, add after `date`:

```ts
  /** "Jun 12"-style short date in UTC. */
  date: string
  /** Day-of-month, no padding ("10"). */
  dom: string
  /** Short month ("Jun"); uppercase at the view. */
  mon: string
```

- [ ] **Step 3: Populate them in `rowToItineraryDay`**

In `rowToItineraryDay`, add to the returned object after `date`:

```ts
    date: SHORT_DATE_FMT.format(utc),
    dom: DOM_FMT.format(utc),
    mon: MON_FMT.format(utc),
```

- [ ] **Step 4: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds (note: `withOrdinals` spreads `...day`, so `dom`/`mon` are preserved).

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/itinerary-types.ts
git commit -m "feat(itinerary): derive dom + mon on ItineraryDay"
```

---

### Task 2: Date-led `DayView` (rail = date, corner = `day N`)

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (`DayView` rail ~820-834; corner ~843-845)

- [ ] **Step 1: Swap the left rail to the calendar date**

In `DayView`, the rail currently reads:

```tsx
        <div className="font-mono text-[9px] uppercase leading-none tracking-[0.14em] text-muted-foreground">
          DAY
        </div>
        <div className="mt-0.5 font-mono text-[22px] leading-none tracking-[-0.02em] text-foreground">
          {day.d}
        </div>
        <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {day.dow.toUpperCase()}
        </div>
```

Replace it with day-of-month (big) / month / weekday:

```tsx
        <div className="font-mono text-[22px] leading-none tracking-[-0.02em] text-foreground">
          {day.dom}
        </div>
        <div className="mt-0.5 font-mono text-[9px] uppercase leading-none tracking-[0.14em] text-muted-foreground">
          {day.mon.toUpperCase()}
        </div>
        <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {day.dow.toUpperCase()}
        </div>
```

- [ ] **Step 2: Move the trip ordinal to the corner**

The card header corner currently shows the date:

```tsx
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            {day.date}
          </span>
```

Change it to the trip ordinal (unpadded):

```tsx
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            day {Number(day.d)}
          </span>
```

- [ ] **Step 3: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds.

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): lead day card with the date, ordinal to corner"
```

---

### Task 3: Extract `DaySegmentView` (pure refactor)

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (add the component near `DayCard`; use it in the location-block body IIFE, replacing the inline trek-box/cards branches)

This is behavior-preserving: it lifts the "render one day-segment" logic (single-day cards or the `group_id` trek box with its caption + delete-block `×`) out of the body IIFE into a reusable component, so Slice 2's loose items can render the same way. Empty-slot rendering stays in the body IIFE.

- [ ] **Step 1: Add the `DaySegmentView` component**

In `src/app/trips/[slug]/itinerary-tab.tsx`, add this component just above `function DayCard(` (it references `DayCard`, `deleteItineraryGroup`, `DaySegment`, `ItineraryLocation` — all already in scope/imported):

```tsx
function DaySegmentView({
  seg,
  tripId,
  tripSlug,
  lastDayId,
  editingId,
  setEditingId,
  locations,
}: {
  seg: DaySegment
  tripId: string
  tripSlug: string
  lastDayId: string
  editingId: string | null
  setEditingId: (id: string | null) => void
  locations: ItineraryLocation[]
}) {
  const cards = seg.days.map((day) => (
    <DayCard
      key={day.id}
      day={day}
      tripSlug={tripSlug}
      isLast={day.id === lastDayId}
      isEditing={editingId === day.id}
      onStartEdit={() => setEditingId(day.id)}
      onStopEdit={() => setEditingId(null)}
      locations={locations}
    />
  ))
  if (seg.groupId && seg.days.length > 1) {
    return (
      <div className="relative my-1.5 rounded-xl border border-rule px-2.5 pt-5 pb-1">
        <span
          className={`absolute left-3 top-1.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
            seg.days[0].groupName ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {seg.days[0].groupName ?? "added together"}
        </span>
        <form
          action={deleteItineraryGroup.bind(null, tripId, tripSlug, seg.groupId)}
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
  return <>{cards}</>
}
```

- [ ] **Step 2: Use it in the body IIFE**

In the location-block body, the IIFE currently returns, for a segment item, either an inline trek-box `<div>…</div>` (the `seg.groupId && seg.days.length > 1` branch) or `<React.Fragment key={seg.days[0].id}>{cards}</React.Fragment>`, and builds `cards` inline. Replace the **segment** half of the `items.map(...)` (everything from `const seg = item.seg` through the two `return`s for seg) with a single keyed `DaySegmentView`:

```tsx
                        const seg = item.seg
                        return (
                          <DaySegmentView
                            key={seg.groupId ?? seg.days[0].id}
                            seg={seg}
                            tripId={tripId}
                            tripSlug={tripSlug}
                            lastDayId={last.id}
                            editingId={editingId}
                            setEditingId={setEditingId}
                            locations={locations}
                          />
                        )
```

Leave the `item.kind === "empty"` branch (the empty-slot `<button>`) exactly as-is. `last` is the group's last day (already in scope in the location block), so the connector line behaves as before.

- [ ] **Step 3: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds, itinerary renders identically (pure refactor).

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "refactor(itinerary): extract DaySegmentView"
```

---

### Task 4: `buildTimeline` — interleave loose days, drop "In transit"

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (`DayGroup`/`buildGroups`/`TRANSIT_KEY` region ~84-168; the `const groups = buildGroups(...)` call; the render loop `groups.map(...)`)

- [ ] **Step 1: Add `TimelineItem` + `buildTimeline`, retire `buildGroups`**

Replace the `buildGroups` function with `buildTimeline` (keep `DayGroup`, `orderTabs`, `byDate`, `slugToTone`). `TRANSIT_KEY` is no longer needed — delete its declaration too.

```tsx
type TimelineItem =
  | { kind: "location"; group: DayGroup }
  | { kind: "loose"; seg: DaySegment }

/**
 * One date-sorted sequence of timeline items: each location is a collapsible
 * block; each run of location-less days is a bare "loose" segment (single day
 * or a group_id trek). No "In transit" bucket — loose days float at their date.
 */
function buildTimeline(
  locations: ItineraryLocation[],
  days: ItineraryDay[],
): TimelineItem[] {
  const byLoc = new Map<string, ItineraryDay[]>()
  const loose: ItineraryDay[] = []
  for (const d of days) {
    if (d.locationId) {
      const arr = byLoc.get(d.locationId)
      if (arr) arr.push(d)
      else byLoc.set(d.locationId, [d])
    } else {
      loose.push(d)
    }
  }

  const items: { item: TimelineItem; sort: string | null }[] = []

  orderTabs(locations, days).forEach((loc, i) => {
    const gdays = (byLoc.get(loc.id) ?? []).slice().sort(byDate)
    const group: DayGroup = {
      key: loc.id,
      name: loc.name,
      tone: slugToTone(loc.id),
      ord: i + 1,
      start: loc.startDate,
      end: loc.endDate,
      days: gdays,
    }
    items.push({
      item: { kind: "location", group },
      sort: loc.startDate ?? gdays[0]?.dayDate ?? null,
    })
  })

  for (const seg of toSegments(loose.slice().sort(byDate))) {
    items.push({ item: { kind: "loose", seg }, sort: seg.days[0].dayDate })
  }

  return items
    .map((x, idx) => ({ ...x, idx }))
    .sort((a, b) => {
      if (a.sort && b.sort)
        return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : a.idx - b.idx
      if (a.sort) return -1
      if (b.sort) return 1
      return a.idx - b.idx
    })
    .map((x) => x.item)
}
```

(The `DayGroup` interface keeps its `start`/`end` fields. `ord` still numbers locations in `orderTabs` order; loose items have no number.)

- [ ] **Step 2: Build the timeline instead of groups**

Find `const groups = buildGroups(locations, days)` and change it to:

```tsx
  const timeline = buildTimeline(locations, days)
```

- [ ] **Step 3: Rewrite the render to map timeline items**

The render currently reads `{groups.length === 0 ? (<p>…</p>) : (groups.map((group) => { … }))}`. Change the guard to `timeline.length === 0` and the map to `timeline.map((item, i) => { … })`, branching on `item.kind`:

- For `item.kind === "location"`: keep the **entire existing per-group block verbatim** (the `<div key={group.key} className="border-t border-rule first:border-t-0">…</div>` with its header, ✎ editor, collapsible body IIFE, and per-location "+ day"), but source the group from the item and treat it as always a location. At the top of this branch add:

  ```tsx
                const group = item.group
                const open = !collapsed.has(group.key)
                const isLoc = true
                const count = group.days.length
                const last = group.days[count - 1]
                // …existing range / spanRange consts and the existing
                // `return ( <div key={group.key} …> … </div> )` unchanged…
  ```

  (`isLoc` is now always `true`, so the existing `isLoc &&` guards and the rename/delete buttons all keep working. Nothing else in the block changes.)

- For `item.kind === "loose"`: render the segment bare, aligned with the located day cards:

  ```tsx
                return (
                  <div
                    key={item.seg.groupId ?? item.seg.days[0].id}
                    className="border-t border-rule first:border-t-0 py-1 pl-10"
                  >
                    <DaySegmentView
                      seg={item.seg}
                      tripId={tripId}
                      tripSlug={tripSlug}
                      lastDayId={item.seg.days[item.seg.days.length - 1].id}
                      editingId={editingId}
                      setEditingId={setEditingId}
                      locations={locations}
                    />
                  </div>
                )
  ```

So the map body is: `if (item.kind === "loose") { return <loose…/> } const group = item.group; … return <location block…/>`.

- [ ] **Step 4: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds. If it fails, check: `TRANSIT_KEY` fully removed, `buildGroups` fully replaced, and the location branch reads `item.group` (no stray `group` param from the old `.map((group) =>`).

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): interleave loose days on the timeline, drop In transit"
```

---

### Task 5: Top-level "+ day" for loose days + empty-state copy

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (a `LOOSE_KEY` constant; the bottom controls ~734-758; the empty-state `<p>` ~426-428)

The existing `AddDayRow` + `addDayFor`/`addDayDate` machinery already drives per-location adds; we add a sentinel key for a location-less add.

- [ ] **Step 1: Add a `LOOSE_KEY` constant**

Near the top of the file (where `TRANSIT_KEY` used to live), add:

```tsx
const LOOSE_KEY = "__loose__"
```

- [ ] **Step 2: Add the loose add row + "+ day" button to the bottom controls**

The bottom controls currently read:

```tsx
        <div className="pt-4">
          {addingLocation ? (
            <form onSubmit={submitNewLocation}>
              <input
                type="text"
                autoFocus
                value={newLocName}
                onChange={(e) => setNewLocName(e.target.value)}
                onBlur={() => {
                  if (!newLocName.trim()) setAddingLocation(false)
                }}
                placeholder="Location name"
                className="block w-full rounded-lg border border-clay bg-transparent px-3 py-2.5 font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAddingLocation(true)}
              className="block w-full rounded-lg border border-dashed border-rule py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"
            >
              + location
            </button>
          )}
        </div>
```

Add the loose add-row + "+ day" above the location control, wrapping both in a `space-y-2` stack:

```tsx
        <div className="space-y-2 pt-4">
          <AddDayRow
            key={`add-loose-${addDayFor === LOOSE_KEY ? addDayDate : ""}`}
            tripId={tripId}
            tripSlug={tripSlug}
            defaultDate={
              addDayFor === LOOSE_KEY && addDayDate ? addDayDate : defaultDate
            }
            locationId={null}
            open={addDayFor === LOOSE_KEY}
            onClose={() => setAddDayFor(null)}
          />
          {addDayFor === LOOSE_KEY ? null : (
            <button
              type="button"
              onClick={() => {
                setAddDayDate("")
                setAddDayFor(LOOSE_KEY)
              }}
              className="block w-full rounded-lg border border-dashed border-rule py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"
            >
              + day
            </button>
          )}
          {addingLocation ? (
            <form onSubmit={submitNewLocation}>
              <input
                type="text"
                autoFocus
                value={newLocName}
                onChange={(e) => setNewLocName(e.target.value)}
                onBlur={() => {
                  if (!newLocName.trim()) setAddingLocation(false)
                }}
                placeholder="Location name"
                className="block w-full rounded-lg border border-clay bg-transparent px-3 py-2.5 font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAddingLocation(true)}
              className="block w-full rounded-lg border border-dashed border-rule py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"
            >
              + location
            </button>
          )}
        </div>
```

- [ ] **Step 3: Reword the empty state**

The empty-state paragraph currently reads:

```tsx
          <p className="font-serif text-[15px] italic text-muted-foreground">
            No days planned yet — add a location to start.
          </p>
```

Change it to reflect that a day can be added directly:

```tsx
          <p className="font-serif text-[15px] italic text-muted-foreground">
            Nothing planned yet — add a day, or a location to group them.
          </p>
```

- [ ] **Step 4: Verify build and lint**

Run: `pnpm build`
Expected: build succeeds.

Run: `pnpm lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): top-level + day for location-less days"
```

---

### Task 6: Manual verification + docs

**Files:** none (manual), then `docs/TODO.md`.

- [ ] **Step 1: Run the dev server**

Run: `pnpm dev`
Open a dated trip's itinerary tab at http://localhost:3000.

- [ ] **Step 2: Date-led card**

Confirm each dated day card's left rail shows the **calendar date** (day-of-month big, month, weekday — e.g. `12 / JUN / FRI`) and the top-right corner shows **`day N`** (the trip ordinal). Verify a trip that doesn't start on the 1st (so day-of-month ≠ ordinal) reads correctly.

- [ ] **Step 3: Add a loose day**

With no location selected, click the top-level **"+ day"**, add a day → it appears on the timeline at its date, as a bare card with **no group header** (no "In transit").

- [ ] **Step 4: Interleaving**

On a trip with a location block and a loose day whose date sits before/after it, confirm the loose day renders in **date order** relative to the block (e.g. a travel day between Kuta and Senaru shows between their blocks).

- [ ] **Step 5: Locations still work**

Confirm location blocks still collapse, show their span empties (clickable to fill into that location), rename/✎ edit + date span, the trek "added together" box (+ its delete `×`), and the per-location "+ day" — all unchanged. Confirm there's **no empty slot between loose days**.

- [ ] **Step 6: Overflow push for loose**

Add a loose day on an already-taken date → the confirm-and-push still fires and shifts the rest.

- [ ] **Step 7: Update docs**

Add a row to `docs/TODO.md` recording loose days + date-led cards done, referencing the spec/plan, and noting the "In transit" group was removed.

```bash
git add docs/TODO.md
git commit -m "docs: record itinerary loose days + date-led cards done"
```

---

## Self-Review

- **Spec coverage:** #2 date card (Tasks 1–2: `dom`/`mon` + rail/corner swap, dreams untouched); #1 loose days Scope B (Task 3 extract `DaySegmentView`; Task 4 `buildTimeline` + interleave + drop transit; Task 5 top-level "+ day" + empty state). Empties stay location-only (untouched in Task 4's location branch; loose branch renders no empties). No schema/migration — loose adds reuse `addItineraryDay`/`insertItineraryDayWithShift` with `locationId = null`. ✓
- **No placeholders:** full code for every new unit (`dom`/`mon`, `DayView` swap, `DaySegmentView`, `TimelineItem`, `buildTimeline`, loose branch, "+ day"); the one large unchanged block (the location header/body) is moved verbatim with explicit sourcing (`const group = item.group`, `isLoc = true`). ✓
- **Type consistency:** `dom`/`mon: string` on `ItineraryDay` (Task 1) read in `DayView` (Task 2); `DaySegmentView(seg, tripId, tripSlug, lastDayId, editingId, setEditingId, locations)` defined in Task 3 and called identically in Task 3 Step 2 (location body) and Task 4 Step 3 (loose branch); `TimelineItem` / `buildTimeline` (Task 4) consumed by the render map; `LOOSE_KEY` (Task 5) drives the existing `addDayFor`/`AddDayRow`. ✓
- **Build stays green per task:** Task 3 is a pure refactor; Task 4 swaps `buildGroups`→`buildTimeline` and the render in one task (no dangling `TRANSIT_KEY`/`buildGroups`); Task 5 adds the loose add path. ✓
- **Edge:** a loose day whose date falls inside a location block's range sorts by the block's start (documented in the spec); rare, not specially handled.
- **Risk:** Task 4's render restructure is the fragile part — Step 4 lists the exact things to recheck (transit removed, `buildGroups` gone, location branch reads `item.group`).

