# Itinerary During-Trip Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the itinerary a summary/detail two-layer day card (tap to expand events) plus a during-trip emphasis that tucks completed locations into a collapsible Past bar, expands today, and recedes the planning affordances — locations stay the backbone throughout.

**Architecture:** Two phases. **Phase A** re-introduces the day `sub` summary and makes each day card collapse to that summary / expand to its `events` (works in any trip state). **Phase B** layers date-driven emphasis on top: zone each day/location as past/today/future from a server-supplied `today`, collapse fully-completed locations into a Past bar, default today to expanded, dim the past, recede `+ add day` / `+ add location`. Expand/collapse is client-only state re-derived from the date on load — no persistence.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (Postgres + RLS + Realtime), TypeScript 5. No test framework — each increment is validated with `pnpm build` / `pnpm lint` and manual UI checks (project convention).

**Spec:** `docs/superpowers/specs/2026-06-10-itinerary-trip-mode-design.md`

**Commit cadence:** Phase A is one coordinated `sub`-reintroduction across server + client; it type-checks only once both land, so A's code commits together at Task A6. Phase B commits at Task B5. The migration (A1) and docs (B5) are their own commits.

---

## Phase A — Summary layer

### Task A1: Migration — re-add `p_sub` to the shift RPC

**Files:**
- Create: `supabase/migrations/20260610000002_itinerary_shift_sub.sql`

Applied manually (paste into Supabase SQL editor). Must be idempotent.

- [ ] **Step 1: Write the migration**

```sql
-- Re-add p_sub to the overflow-push RPC so days created via the push-forward
-- path carry a summary line alongside their events. Mirrors
-- 20260610000001_itinerary_day_events.sql but with both sub + events. Idempotent.

drop function if exists public.shift_and_insert_itinerary(
  uuid, date, int, text, jsonb, text, text, uuid, text
);

create or replace function public.shift_and_insert_itinerary(
  p_trip_id     uuid,
  p_from_date   date,
  p_count       int,
  p_title       text,
  p_sub         text,
  p_events      jsonb,
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
  v_first date;
  v_shift int;
begin
  set constraints all deferred;

  select min(day_date) into v_first
  from public.itinerary_days
  where trip_id = p_trip_id and day_date >= p_from_date;

  v_shift := case
    when v_first is null then 0
    else greatest(0, p_count - (v_first - p_from_date))
  end;

  update public.itinerary_days
  set day_date = day_date + v_shift
  where trip_id = p_trip_id and day_date >= p_from_date;

  insert into public.itinerary_days
    (trip_id, day_date, title, sub, events, tag, tone,
     group_id, group_name, location_id, created_by)
  select
    p_trip_id, p_from_date + g, p_title, p_sub, coalesce(p_events, '[]'::jsonb), p_tag, p_tone,
    v_group, v_name, p_location_id, v_uid
  from generate_series(0, p_count - 1) as g;

  update public.itinerary_locations
  set start_date = start_date + v_shift,
      end_date   = end_date + v_shift
  where trip_id = p_trip_id
    and id is distinct from p_location_id
    and start_date >= p_from_date;

  update public.itinerary_locations
  set start_date = least(start_date, p_from_date),
      end_date   = end_date + v_shift
  where trip_id = p_trip_id
    and (id = p_location_id or start_date < p_from_date)
    and end_date >= p_from_date;

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

- [ ] **Step 2: Apply + verify**

Paste into the Supabase SQL editor, run twice (idempotent). Then `select proname, pg_get_function_arguments(oid) from pg_proc where proname = 'shift_and_insert_itinerary';` — args should list `p_sub text, p_events jsonb` and there should be exactly one row (the old `p_sub`-only and `p_events`-only signatures are gone).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260610000002_itinerary_shift_sub.sql
git commit -m "feat(itinerary): re-add p_sub to shift RPC for day summaries"
```

---

### Task A2: Types — re-introduce `sub` alongside `events`

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts`
- Modify: `src/lib/trips/itinerary-queries.ts:15`
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (`RealtimeRow`)

- [ ] **Step 1: `itinerary-types.ts` — add `sub` back to the day + row + parse**

In `ItineraryDay`, add a `sub` field next to `events`:

```ts
  title: string
  sub: string
  events: ItineraryEvent[]
```

In `ItineraryRow`, add `sub` back alongside the raw `events`:

```ts
  title: string
  sub?: string | null
  /** Raw jsonb from the DB; parsed by rowToItineraryDay. */
  events?: unknown
```

In `rowToItineraryDay`, set `sub` next to events:

```ts
    title: row.title,
    sub: row.sub ?? "",
    events: parseEvents(row.events),
```

- [ ] **Step 2: `itinerary-queries.ts` — select `sub`**

```ts
    .select("id, day_date, title, sub, events, tag, tone, group_id, group_name, location_id")
```

- [ ] **Step 3: `itinerary-tab.tsx` — `RealtimeRow` carries `sub`**

In `interface RealtimeRow`, add above `events: unknown`:

```ts
  sub: string | null
```

---

### Task A3: Server actions — write `sub` again

**Files:**
- Modify: `src/lib/trips/actions.ts`

- [ ] **Step 1: Input types regain `sub`**

In `AddItineraryDayInput`, add next to `events`:

```ts
  title: string
  sub: string
  events: ItineraryEvent[]
```

In `UpdateItineraryDayInput`, add next to `events`:

```ts
  title: string
  sub: string
  events: ItineraryEvent[]
```

- [ ] **Step 2: `addItineraryDay` — trim + write `sub`**

Just before `const events = input.events` (the `.map/.filter` block), add:

```ts
  const sub = input.sub.trim()
```

In the `rows` map, add `sub,` next to `events,`:

```ts
    title,
    sub,
    events,
```

The `.select(...)` after `.insert(rows)` becomes:

```ts
    .select("id, day_date, title, sub, events, tag, tone, group_id, group_name, location_id")
```

- [ ] **Step 3: `insertItineraryDayWithShift` — pass `p_sub`**

In the `.rpc("shift_and_insert_itinerary", { ... })` object, add above `p_events`:

```ts
    p_sub: input.sub.trim(),
```

- [ ] **Step 4: `updateItineraryDay` — patch `sub`**

Just before the `const events = input.events` block, add:

```ts
  const sub = input.sub.trim()
```

In the `patch` inline type, add `sub: string` next to `events`; in the object literal add `sub,` next to `events,`:

```ts
    title,
    sub,
    events,
```

---

### Task A4: Form — Summary field

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (`DayForm`, `DayEditor`, `AddDayRow`)

- [ ] **Step 1: `DayForm` — add `sub` / `setSub` props**

In the destructured params, add after `setTitle,`:

```ts
  sub,
  setSub,
```

In the props type, add after `setTitle: (s: string) => void`:

```ts
  sub: string
  setSub: (s: string) => void
```

- [ ] **Step 2: Render the Summary input between Title and the Events section**

Immediately after the Title `<label>...</label>` block (the one whose span reads `Title`), insert:

```tsx
      <label className="mt-3 block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Summary
        </span>
        <input
          type="text"
          value={sub}
          onChange={(e) => setSub(e.target.value)}
          placeholder="One-line overview of the day"
          disabled={isPending}
          className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
      </label>
```

- [ ] **Step 3: `DayEditor` — seed + send `sub`**

Add state next to the others:

```ts
  const [sub, setSub] = React.useState(day.sub)
```

In the `updateItineraryDay({ ... })` call, add `sub,` next to `events:`:

```ts
        title,
        sub,
        events: events.map((e) => ({ time: e.time, text: e.text })),
```

In the `<DayForm .../>` props, add after `setTitle={setTitle}`:

```tsx
      sub={sub}
      setSub={setSub}
```

- [ ] **Step 4: `AddDayRow` — state, reset, payload, props**

Add state:

```ts
  const [sub, setSub] = React.useState("")
```

In `reset()`, add `setSub("")` next to the other resets.

In the `payload` object inside `submit`, add `sub,` next to `events:`:

```ts
        title,
        sub,
        events: events.map((e) => ({ time: e.time, text: e.text })),
```

In the `<DayForm .../>` props, add after `setTitle={setTitle}`:

```tsx
      sub={sub}
      setSub={setSub}
```

---

### Task A5: Day card — collapse to summary / expand to events, tap to toggle

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (`ItineraryTab` state, `DaySegmentView`, `DayCardProps`, `DayCard`, `DayView`)

- [ ] **Step 1: Add per-day expand state + helper in `ItineraryTab`**

Next to `const [expandedRuns, setExpandedRuns] = React.useState<Set<string>>(new Set())`, add:

```ts
  const [expandedDays, setExpandedDays] = React.useState<Set<string>>(new Set())

  function toggleDay(id: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
```

Add a collapsed-summary helper near the top-level helpers (after `sortEvents`):

```ts
/** One-line summary for a collapsed day: the typed sub, else a cheap derived
 * hint from the events (first event text, or "N events"), else "". */
function daySummary(day: ItineraryDay): string {
  if (day.sub.trim()) return day.sub
  const evs = sortEvents(day.events)
  if (evs.length === 0) return ""
  if (evs.length === 1) return evs[0].text
  return `${evs.length} events`
}
```

- [ ] **Step 2: Thread `expandedDays` + `toggleDay` into both `DaySegmentView` call sites**

At the loose call site (the `timeline.map` `item.kind === "loose"` branch) and the in-group call site, add these two props to `<DaySegmentView ... />`:

```tsx
                    expandedDays={expandedDays}
                    toggleDay={toggleDay}
```

- [ ] **Step 3: `DaySegmentView` — accept + forward them per day**

Add to its props type:

```ts
  expandedDays: Set<string>
  toggleDay: (id: string) => void
```

Destructure `expandedDays, toggleDay` in the params. In the `seg.days.map((day) => (<DayCard ... />))`, add:

```tsx
      expanded={expandedDays.has(day.id)}
      onToggle={() => toggleDay(day.id)}
```

- [ ] **Step 4: `DayCardProps` + `DayCard` — pass through**

Add to `DayCardProps`:

```ts
  expanded: boolean
  onToggle: () => void
```

In `DayCard`, destructure `expanded, onToggle` and forward to `<DayView ... />`:

```tsx
      expanded={expanded}
      onToggle={onToggle}
```

- [ ] **Step 5: `DayView` — render summary vs events, tap title to toggle**

Add `expanded` + `onToggle` to `DayView`'s params and props type (alongside `onStartEdit`).

Make the title a toggle button and swap the body by `expanded`. Replace the title `<div>` and the existing events block:

```tsx
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="t-display mb-1 block w-full text-left text-[22px] leading-tight text-foreground"
        >
          {day.title}
        </button>
        {expanded ? (
          day.events.length > 0 ? (
            <div className="space-y-0.5">
              {sortEvents(day.events).map((ev, i) => (
                <div
                  key={i}
                  className="flex gap-1.5 text-[12.5px] leading-snug text-muted-foreground"
                >
                  {ev.time ? (
                    <span className="t-num shrink-0 text-foreground/70">
                      {ev.time}
                    </span>
                  ) : null}
                  <span>{ev.text}</span>
                </div>
              ))}
            </div>
          ) : null
        ) : daySummary(day) ? (
          <button
            type="button"
            onClick={onToggle}
            className="block w-full text-left text-[12.5px] leading-snug text-muted-foreground"
          >
            {daySummary(day)}
          </button>
        ) : null}
```

(Phase A leaves every day collapsed by default; Phase B adds date-driven defaults.)

---

### Task A6: Build, lint, verify, commit Phase A

- [ ] **Step 1: Build** — `pnpm build`. Expected: PASS (no `sub` type errors).
- [ ] **Step 2: Lint** — `pnpm lint`. Expected: clean.
- [ ] **Step 3: Manual** — `pnpm dev`, open an itinerary: every day shows its summary line collapsed; tapping the title (or summary) expands the full events and collapses again; the Edit form has a **Summary** field above Events; saving persists both; empty-summary days fall back to the first event / "N events".
- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/itinerary-types.ts src/lib/trips/itinerary-queries.ts src/lib/trips/actions.ts "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): summary/detail day cards (tap to expand events)"
```

---

## Phase B — During-trip emphasis

### Task B1: Wire `today` + `tripEndDate`, add zone helpers

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx` (`ItineraryTab` render, ~line 211)
- Modify: `src/lib/trips/itinerary-types.ts` (pure zone helper)
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (props + local helpers)

- [ ] **Step 1: `itinerary-types.ts` — a pure day-zone helper**

Add at the end of the file:

```ts
export type DayZone = "past" | "today" | "future"

/** Zone a day by its date vs today (ISO yyyy-mm-dd string compare). */
export function dayZone(dayDate: string, today: string): DayZone {
  return dayDate < today ? "past" : dayDate > today ? "future" : "today"
}

/** True when today falls within [start, end] (inclusive). */
export function tripActive(today: string, start: string, end: string): boolean {
  return today >= start && today <= end
}
```

- [ ] **Step 2: `page.tsx` — compute `today`, pass `today` + `tripEndDate`**

Just before the `<ItineraryTab ... />` JSX (inside the `header.startDate === null ? ... : (` else branch), add:

```tsx
            // server-derived today, matching /home's UTC derivation
```

and pass two new props on `<ItineraryTab>`:

```tsx
              tripStartDate={header.startDate}
              tripEndDate={header.endDate}
              today={new Date().toISOString().slice(0, 10)}
```

(`header.endDate` is non-null here because `startDate !== null` means a dated trip.)

- [ ] **Step 3: `itinerary-tab.tsx` — accept the new props + local group-zone helper**

Add to the `ItineraryTab` destructured props and their type:

```ts
  tripEndDate: string
  today: string
```
```ts
  tripStartDate: string
  tripEndDate: string
  today: string
```

Import the helpers — add `dayZone`, `tripActive`, and `type DayZone` to the existing `@/lib/trips/itinerary-types` import block.

Add a local helper after `buildTimeline` (it uses the local `DayGroup` type):

```ts
/** Zone a location group: past if its whole span is before today, future if
 * wholly after, else current (contains/straddles today, or undated). */
function groupZone(group: DayGroup, today: string): DayZone {
  const dates = group.days.map((d) => d.dayDate)
  const lows = [group.start, ...dates].filter((v): v is string => Boolean(v))
  const highs = [group.end, ...dates].filter((v): v is string => Boolean(v))
  if (highs.length && highs.reduce((a, b) => (a > b ? a : b)) < today) return "past"
  if (lows.length && lows.reduce((a, b) => (a < b ? a : b)) > today) return "future"
  return "today"
}
```

---

### Task B2: Date-driven default collapse / expand

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`

- [ ] **Step 1: Add default-deriving pure helpers (after `groupZone`)**

```ts
/** During an active trip, today's day(s) start expanded; otherwise none do. */
function defaultExpandedDays(
  days: ItineraryDay[],
  today: string,
  start: string,
  end: string,
): Set<string> {
  const s = new Set<string>()
  if (!tripActive(today, start, end)) return s
  for (const d of days) if (d.dayDate === today) s.add(d.id)
  return s
}

/** During an active trip, future location groups start collapsed (past ones go
 * into the Past bar, current stays open). Outside a trip, nothing is collapsed. */
function defaultCollapsed(
  locations: ItineraryLocation[],
  days: ItineraryDay[],
  today: string,
  start: string,
  end: string,
): Set<string> {
  const s = new Set<string>()
  if (!tripActive(today, start, end)) return s
  for (const item of buildTimeline(locations, days)) {
    if (item.kind !== "location") continue
    if (groupZone(item.group, today) === "future") s.add(item.group.key)
  }
  return s
}
```

- [ ] **Step 2: Seed the state from those defaults**

Change the `collapsed` and `expandedDays` initializers to lazy initializers (defaults are computed once at mount, then user toggles win; data refreshes don't reset them — matching how `collapsed` already survives `initialItems` syncs):

```ts
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() =>
    defaultCollapsed(initialLocations, initialItems, today, tripStartDate, tripEndDate),
  )
```
```ts
  const [expandedDays, setExpandedDays] = React.useState<Set<string>>(() =>
    defaultExpandedDays(initialItems, today, tripStartDate, tripEndDate),
  )
```

Add the Past bar's own open state next to them:

```ts
  const [pastBarOpen, setPastBarOpen] = React.useState(false)
```

---

### Task B3: Past bar + dimmed past days

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`

- [ ] **Step 1: Extract the timeline item renderer**

The `timeline.map((item) => { ... })` callback closes over all needed state. Lift it to a named const just above the `return (` of `ItineraryTab` (cut the exact arrow body from the existing `.map`):

```ts
  const renderTimelineItem = (item: TimelineItem) => {
    // ...the entire existing map-callback body, unchanged...
  }
```

- [ ] **Step 2: Compute active + the past/rest partition (next to `timeline`)**

```ts
  const active = tripActive(today, tripStartDate, tripEndDate)
  const pastItems = active
    ? timeline.filter(
        (it) => it.kind === "location" && groupZone(it.group, today) === "past",
      )
    : []
  const restItems = active
    ? timeline.filter((it) => !pastItems.includes(it))
    : timeline
```

- [ ] **Step 3: Replace the render of the timeline with Past bar + rest**

Replace the `timeline.length === 0 ? (<empty/>) : (timeline.map(...))` block with:

```tsx
        {timeline.length === 0 ? (
          <p className="font-serif text-[15px] italic text-muted-foreground">
            Nothing planned yet — add a day, or a location to group them.
          </p>
        ) : (
          <>
            {pastItems.length > 0 ? (
              <div className="border-t border-rule first:border-t-0">
                <button
                  type="button"
                  onClick={() => setPastBarOpen((v) => !v)}
                  aria-expanded={pastBarOpen}
                  className="flex w-full items-center gap-3 py-3 text-left opacity-60"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Past · {pastItems.length}{" "}
                    {pastItems.length === 1 ? "place" : "places"}
                  </span>
                  <span className="ml-auto font-mono text-[13px] leading-none text-muted-foreground">
                    {pastBarOpen ? "⌄" : "›"}
                  </span>
                </button>
                {pastBarOpen ? (
                  <div className="opacity-60">
                    {pastItems.map(renderTimelineItem)}
                  </div>
                ) : null}
              </div>
            ) : null}
            {restItems.map(renderTimelineItem)}
          </>
        )}
```

- [ ] **Step 4: Dim past days inside the current location**

Thread `today` (only when active) down so a past day card dims. At both `<DaySegmentView ... />` call sites add:

```tsx
                    dimBefore={active ? today : null}
```

In `DaySegmentView` props add `dimBefore: string | null`, destructure it, and pass to each `<DayCard ... />`:

```tsx
      dimBefore={dimBefore}
```

In `DayCardProps` add `dimBefore: string | null`; in `DayCard` forward it to `<DayView ... />`. In `DayView` props add `dimBefore: string | null`, and on the card's outer container (the `<div className="flex-1 rounded-lg border ...">`) append a dim class when the day is before `dimBefore`:

```tsx
        className={`flex-1 rounded-lg border border-border bg-card px-3.5 py-3 border-l-[3px] ${itineraryBorder[day.tone]} ${
          dimBefore && day.dayDate < dimBefore ? "opacity-60" : ""
        }`}
```

---

### Task B4: Recede the planning affordances during a trip

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`

- [ ] **Step 1: Move the top add block below the timeline + mute it when active**

The top planning block is the `<div className="space-y-2 pb-4"> ... add-loose ... + location ... </div>` rendered above the timeline. Lift it into a variable just before `return (`:

```tsx
    const planningBlock = (
      <div className={`space-y-2 ${active ? "pt-4 opacity-70" : "pb-4"}`}>
        {/* ...the exact existing contents of that div... */}
      </div>
    )
```

Render it conditionally around the timeline: when not active it stays **above**; when active it renders **below** (receded):

```tsx
        {active ? null : planningBlock}
        {/* timeline block (empty check + Past bar + restItems) */}
        {active ? planningBlock : null}
```

(The per-group `+ day` buttons stay where they are — they're already secondary; only the top-level block moves.)

---

### Task B5: Build, lint, verify, commit Phase B + docs

**Files:**
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`

- [ ] **Step 1: Build** — `pnpm build`. Expected: PASS.
- [ ] **Step 2: Lint** — `pnpm lint`. Expected: clean.
- [ ] **Step 3: Manual verification** — `pnpm dev`:
  - On a trip whose dates include today: a **Past · N places** bar sits on top (collapsed), today's location is open with today's day expanded, future locations are collapsed, past days dim, and the `+ add` planning block is receded below.
  - Opening the Past bar reveals the completed locations (still drillable).
  - On an **upcoming**/**past**/normal trip: no Past bar, nothing auto-expands, planning block on top — i.e. unchanged planning view.
  - A location that straddles today stays intact (its past days dim inline, today expanded, later days summarized).
  - Reload mid-trip re-lands on today (state re-derived).
- [ ] **Step 4: Update `docs/TODO.md`** — add a done entry under the itinerary section describing the summary/detail card + during-trip Past bar / today emphasis (itinerary-only pilot; other tabs deferred).
- [ ] **Step 5: Add a `docs/DECISIONS.md` row** — `sub` revived as the day summary layer alongside `events`; during-trip emphasis is state-aware *emphasis* (zones + Past bar) not a separate UI; expand/collapse is client-only, re-derived from `today` each load; Past bar collects whole completed locations only (locations are the backbone); itinerary-only pilot.
- [ ] **Step 6: Commit**

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx" "src/app/trips/[slug]/page.tsx" src/lib/trips/itinerary-types.ts docs/TODO.md docs/DECISIONS.md
git commit -m "feat(itinerary): during-trip mode — past bar, today emphasis, receded planning"
```

---

## Self-review notes (for the implementer)

- **Phase A is independently shippable** — summary/detail cards work in every trip state; you can stop, use it, and do Phase B later.
- **No `useEffect` for default state** — defaults are lazy `useState` initializers (per the repo's React-19 set-state-in-effect rule). They compute once at mount; user toggles and data refreshes don't clobber them, and a reload re-derives them.
- **`renderTimelineItem` must be cut verbatim** from the existing `.map` callback — it closes over `collapsed`, `expandedRuns`, `addDayFor`, `editingId`, etc., so moving it to a const in the same scope keeps every closure intact.
- **Dimming uses `day.dayDate < dimBefore`**, where `dimBefore` is `today` only when `active` — so non-active trips never dim.

