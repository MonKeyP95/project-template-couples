# Itinerary Day Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace an itinerary day's single free-text `sub` line with an ordered list of mini-events (optional time + text), editable via a `+ add event` button in the Edit/Add-day form footer.

**Architecture:** A new `events jsonb` column on `itinerary_days` holds an ordered array of `{ time, text }`. The existing `sub` text column is left vestigial (non-destructive). Types, the read query, the realtime delta, three server actions, the `shift_and_insert_itinerary` RPC, the shared `DayForm`, and the day card all switch from `sub` to `events`. Dated itinerary only — the dream itinerary keeps its `sub`.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (Postgres + RLS + Realtime), TypeScript 5. No test framework in this repo — each increment is validated with `pnpm build` / `pnpm lint` and manual UI checks (project convention: do not invent a test command).

**Note on commit cadence:** switching the `sub` → `events` type is a coordinated rename across server and client files; the tree only type-checks once both sides land. Tasks 2–6 are therefore staged but committed together in Task 7 after a green build. The DB migration (Task 1) and docs (Task 7) commit on their own.

---

### Task 1: Database migration — `events` column, backfill, RPC

**Files:**
- Create: `supabase/migrations/20260610000001_itinerary_day_events.sql`

This is applied **manually** by pasting into the Supabase SQL editor (this repo has no migration runner). It must be safe to run more than once.

- [ ] **Step 1: Write the migration file**

```sql
-- Itinerary day mini-events.
-- Replaces the single free-text `sub` line with an ordered jsonb array of
-- { time, text } events. The `sub` column is left in place (vestigial) so this
-- migration is non-destructive; code stops reading/writing it. Idempotent.

alter table public.itinerary_days
  add column if not exists events jsonb not null default '[]'::jsonb;

-- Backfill: fold any existing non-empty sub into a single timeless event.
update public.itinerary_days
set events = jsonb_build_array(jsonb_build_object('time', '', 'text', btrim(sub)))
where coalesce(btrim(sub), '') <> ''
  and events = '[]'::jsonb;

-- Repoint the overflow-push RPC at `events`. The arg-type change (text -> jsonb)
-- would otherwise create an overload, so drop the old signature first.
drop function if exists public.shift_and_insert_itinerary(
  uuid, date, int, text, text, text, text, uuid, text
);

create or replace function public.shift_and_insert_itinerary(
  p_trip_id     uuid,
  p_from_date   date,
  p_count       int,
  p_title       text,
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
    (trip_id, day_date, title, events, tag, tone,
     group_id, group_name, location_id, created_by)
  select
    p_trip_id, p_from_date + g, p_title, coalesce(p_events, '[]'::jsonb), p_tag, p_tone,
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

- [ ] **Step 2: Apply it in Supabase**

Paste the whole file into the Supabase SQL editor and run it. Run it a **second time** to confirm idempotency (no errors, no duplicate backfill — the `events = '[]'` guard prevents re-folding).

- [ ] **Step 3: Verify**

In the SQL editor: `select id, sub, events from public.itinerary_days limit 5;` — existing rows with a sub should now show `events` like `[{"time": "", "text": "..."}]`; rows that had no sub show `[]`.

- [ ] **Step 4: Commit the migration file**

```bash
git add supabase/migrations/20260610000001_itinerary_day_events.sql
git commit -m "feat(itinerary): migration for day mini-events column + RPC"
```

---

### Task 2: Types — `ItineraryEvent`, parse jsonb

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts`

- [ ] **Step 1: Add the event type and parser, switch `ItineraryDay`/`ItineraryRow`**

Add the new interface after `ItineraryTone` (top of file):

```ts
export interface ItineraryEvent {
  /** Free "HH:MM"-style label; "" when untimed. Cosmetic, no parsing. */
  time: string
  text: string
}
```

In `ItineraryDay`, replace the `sub: string` line with:

```ts
  events: ItineraryEvent[]
```

In `ItineraryRow`, replace the `sub: string | null` line with:

```ts
  /** Raw jsonb from the DB; parsed by rowToItineraryDay. */
  events?: unknown
```

- [ ] **Step 2: Add the parser and use it in `rowToItineraryDay`**

Add this helper above `rowToItineraryDay`:

```ts
/** Parse the raw jsonb `events` array into clean ItineraryEvent[]. Tolerates
 * null/malformed values and drops events with empty text. */
function parseEvents(raw: unknown): ItineraryEvent[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => ({
      time: typeof e.time === "string" ? e.time : "",
      text: typeof e.text === "string" ? e.text : "",
    }))
    .filter((e) => e.text.length > 0)
}
```

In `rowToItineraryDay`, replace the `sub: row.sub ?? "",` line with:

```ts
    events: parseEvents(row.events),
```

---

### Task 3: Read query + realtime row + server actions

**Files:**
- Modify: `src/lib/trips/itinerary-queries.ts:15`
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx:61` (the `RealtimeRow` interface only)
- Modify: `src/lib/trips/actions.ts` (input types, `addItineraryDay`, `insertItineraryDayWithShift`, `updateItineraryDay`)

- [ ] **Step 1: Update the read query select**

In `itinerary-queries.ts`, change the select string:

```ts
    .select("id, day_date, title, events, tag, tone, group_id, group_name, location_id")
```

- [ ] **Step 2: Update the realtime row interface**

In `itinerary-tab.tsx`, in `interface RealtimeRow`, replace `sub: string | null` with:

```ts
  events: unknown
```

(`payload.new` carries the jsonb array; `rowToItineraryDay` parses it. No other realtime change needed.)

- [ ] **Step 3: Import `ItineraryEvent` and switch the input types in `actions.ts`**

Find the existing import of itinerary types in `actions.ts` and add `ItineraryEvent` to it (it already imports `ItineraryTone`, `ITINERARY_TONES`, `rowToItineraryDay`, `ItineraryDay` from `@/lib/trips/itinerary-types`). Add:

```ts
  type ItineraryEvent,
```

In `AddItineraryDayInput`, replace `sub: string` with:

```ts
  events: ItineraryEvent[]
```

In `UpdateItineraryDayInput`, replace `sub: string` with:

```ts
  events: ItineraryEvent[]
```

- [ ] **Step 4: `addItineraryDay` — build events, write + select them**

Replace `const sub = input.sub.trim()` with:

```ts
  const events = input.events
    .map((e) => ({ time: e.time.trim(), text: e.text.trim() }))
    .filter((e) => e.text.length > 0)
```

In the `rows` map, replace the `sub,` field with `events,`. Then change the `.select(...)` after `.insert(rows)` to:

```ts
    .select("id, day_date, title, events, tag, tone, group_id, group_name, location_id")
```

- [ ] **Step 5: `insertItineraryDayWithShift` — pass `p_events`**

Inside the function, before the `supabase.rpc(...)` call, add:

```ts
  const events = input.events
    .map((e) => ({ time: e.time.trim(), text: e.text.trim() }))
    .filter((e) => e.text.length > 0)
```

In the `.rpc("shift_and_insert_itinerary", { ... })` argument object, replace the `p_sub: input.sub.trim(),` line with:

```ts
    p_events: events,
```

- [ ] **Step 6: `updateItineraryDay` — build events, patch them**

Replace `const sub = input.sub.trim()` with:

```ts
  const events = input.events
    .map((e) => ({ time: e.time.trim(), text: e.text.trim() }))
    .filter((e) => e.text.length > 0)
```

In the `patch` object's inline type, replace `sub: string` with `events: ItineraryEvent[]`, and in the object literal replace the `sub,` field with `events,`.

---

### Task 4: Form — events drafts, Events section, footer button

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (`DayForm`, `DayEditor`, `AddDayRow`, plus a small draft helper)

- [ ] **Step 1: Add an `EventDraft` type + helpers near the top of the file**

Place after the `RealtimeRow` interface (these are client-only; `key` is never persisted):

```ts
interface EventDraft {
  key: string
  time: string
  text: string
}

function newEventDraft(time = "", text = ""): EventDraft {
  return { key: crypto.randomUUID(), time, text }
}

function toEventDrafts(events: ItineraryEvent[]): EventDraft[] {
  return events.map((e) => newEventDraft(e.time, e.text))
}
```

Ensure `ItineraryEvent` is imported in this file's existing `@/lib/trips/itinerary-types` import block (add `type ItineraryEvent,`).

- [ ] **Step 2: Swap the `sub` props on `DayForm` for `events`**

In `DayForm`'s destructured params, replace `sub,` and `setSub,` with `events,` and `setEvents,`. In its props type, replace:

```ts
  sub: string
  setSub: (s: string) => void
```

with:

```ts
  events: EventDraft[]
  setEvents: (e: EventDraft[]) => void
```

- [ ] **Step 3: Replace the Sub `<label>` block with an Events section**

Delete the entire `Sub` label block (the `<label className="mt-3 block">` whose span reads `Sub` and whose input binds `value={sub}`) and put this in its place:

```tsx
      <div className="mt-3">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Events
        </span>
        <div className="mt-1.5 space-y-2">
          {events.map((ev) => (
            <div key={ev.key} className="flex items-center gap-2">
              <input
                type="text"
                value={ev.time}
                onChange={(e) =>
                  setEvents(
                    events.map((x) =>
                      x.key === ev.key ? { ...x, time: e.target.value } : x,
                    ),
                  )
                }
                placeholder="09:00"
                disabled={isPending}
                className="t-num w-16 shrink-0 border-0 border-b border-rule bg-transparent py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
              <input
                type="text"
                value={ev.text}
                onChange={(e) =>
                  setEvents(
                    events.map((x) =>
                      x.key === ev.key ? { ...x, text: e.target.value } : x,
                    ),
                  )
                }
                placeholder="What happens"
                disabled={isPending}
                className="flex-1 border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setEvents(events.filter((x) => x.key !== ev.key))}
                disabled={isPending}
                aria-label="Remove event"
                className="border-0 bg-transparent px-1.5 py-1 font-mono text-[13px] text-muted-foreground hover:text-clay disabled:opacity-50"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
```

- [ ] **Step 4: Change the footer to `justify-between` with `+ add event` on the left**

Replace the footer `<div className="mt-4 flex justify-end gap-2"> ... </div>` (containing the cancel and submit buttons) with:

```tsx
      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setEvents([...events, newEventDraft()])}
          disabled={isPending}
          className="border-0 bg-transparent px-1 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          + add event
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            cancel
          </button>
          <button
            type="submit"
            disabled={isPending || !title.trim() || !tag.trim()}
            className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {isPending ? "…" : submitLabel}
          </button>
        </div>
      </div>
```

- [ ] **Step 5: Wire `DayEditor` to events**

In `DayEditor`, replace `const [sub, setSub] = React.useState(day.sub)` with:

```ts
  const [events, setEvents] = React.useState<EventDraft[]>(() =>
    toEventDrafts(day.events),
  )
```

In its `updateItineraryDay({ ... })` call, replace `sub,` with:

```ts
        events: events.map((e) => ({ time: e.time, text: e.text })),
```

In the `<DayForm .../>` props, replace `sub={sub}` / `setSub={setSub}` with `events={events}` / `setEvents={setEvents}`.

- [ ] **Step 6: Wire `AddDayRow` to events**

In `AddDayRow`, replace `const [sub, setSub] = React.useState("")` with:

```ts
  const [events, setEvents] = React.useState<EventDraft[]>([])
```

In `reset()`, replace `setSub("")` with `setEvents([])`. In the `payload` object inside `submit`, replace `sub,` with:

```ts
        events: events.map((e) => ({ time: e.time, text: e.text })),
```

In the `<DayForm .../>` props, replace `sub={sub}` / `setSub={setSub}` with `events={events}` / `setEvents={setEvents}`.

---

### Task 5: Day card — render the events list

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (the day card, around the current `day.sub` render)

- [ ] **Step 1: Replace the single sub line**

Replace the block:

```tsx
        {day.sub ? (
          <div className="text-[12.5px] leading-snug text-muted-foreground">
            {day.sub}
          </div>
        ) : null}
```

with:

```tsx
        {day.events.length > 0 ? (
          <div className="space-y-0.5">
            {day.events.map((ev, i) => (
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
        ) : null}
```

---

### Task 6: Build, lint, and manual verification

**Files:** none (verification only)

- [ ] **Step 1: Type-check / build**

Run: `pnpm build`
Expected: PASS — no TypeScript errors. (If `sub` errors remain, a reference was missed in Task 3–5.)

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS — no new errors. Watch for the React-19 JSX-text gotcha and unused-var warnings from the removed `sub` state.

- [ ] **Step 3: Manual UI verification**

Run: `pnpm dev`, open a trip's `/itinerary` and confirm:
1. **Edit day** shows an **Events** section (existing days show their old sub as one timeless event), and the footer has `+ add event` on the left with `cancel` / `save` on the right.
2. `+ add event` appends a blank time+text row; the `×` removes the right one (no input scrambling).
3. Save persists; reload shows the events on the day card — `time` in mono before the text, untimed events show text only; empty-text rows are dropped.
4. **Add day** with multiple events works; so does **filling an empty buffer slot**.
5. The **push / confirm** path (adding onto a taken date) carries events through the RPC.
6. With a second session open, edits appear via Realtime.

---

### Task 7: Commit code + update docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Update `docs/TODO.md`**

Mark the day mini-events work done (add a line under the itinerary section noting days now hold an ordered list of timed mini-events; dream itinerary still single-sub).

- [ ] **Step 2: Add a row to `docs/DECISIONS.md`**

Add a row: itinerary day detail stored as an ordered `events jsonb` array (`{time, text}`) instead of a single `sub` text line; manual order, optional time; old `sub` column kept vestigial (non-destructive); dream itinerary unchanged.

- [ ] **Step 3: Commit everything**

```bash
git add src/lib/trips/itinerary-types.ts src/lib/trips/itinerary-queries.ts src/lib/trips/actions.ts src/app/trips/[slug]/itinerary-tab.tsx docs/TODO.md docs/DECISIONS.md
git commit -m "feat(itinerary): day mini-events (time + text) replace single sub"
```
