# Restaurant Discovery Slice D — Feedback Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a 1–5 rating + optional note on any past event (store-only), on the itinerary's past days and the on-the-road page's already-passed events.

**Architecture:** Extend the `jsonb`-backed itinerary event with optional `rating`/`note` (no migration). A `rateEvent` server action writes them onto one event, addressing it by index in the day's time-sorted array (the action sorts the same way every surface renders). A shared `EventRating` client editor mounts on itinerary past-day events and a new on-the-road "Looking back" list. Every existing site that rewrites the event array must preserve `rating`/`note`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Supabase (jsonb, no ORM), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-07-restaurant-discovery-slice-d-feedback-design.md`

## Global Constraints

- **No migration.** `rating`/`note` are code-only optional fields on the `jsonb` events array. No SQL.
- **Store-only.** Do not touch `searchRestaurants` or discovery ranking — ratings are captured, not used yet.
- **Preserve rating/note through every array rewrite** — `addTodayEvent`'s merge, and the `DayForm` editor (`EventDraft` + submit maps). A rewrite that drops them silently wipes a rating.
- **Index by the full day's time-sorted array.** `rateEvent` sorts with `sortDayEvents`; both surfaces derive `eventIndex` from the full sorted day (on-the-road keeps the full-array index for the passed subset).
- **Rating shows only on already-happened events** — itinerary: `day.dayDate < today`; on-the-road: `e.time < now`. Never on future/today-upcoming events.
- **No test framework.** Verify with `npx tsc --noEmit` + `pnpm lint`, plus a 390px manual check for UI tasks.
- **`★`/`☆`/`↗`/`×` are UI glyphs, not emojis** — consistent with existing usage; the no-emoji rule still applies to code/logs.
- **Commits:** the user commits only when they ask. Treat "Commit" steps as optional checkpoints; never push.

---

### Task 1: Event model — optional `rating` + `note`

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts` (`ItineraryEvent`, `parseEvents`)

**Interfaces:**
- Produces: `ItineraryEvent` = `{ time; text; url?; rating?: number; note?: string }`. `parseEvents` reads `rating` only when a number in 1..5, `note` only when a non-empty string.

- [ ] **Step 1: Add the fields**

Change:
```ts
export interface ItineraryEvent {
  /** Free "HH:MM"-style label; "" when untimed. Cosmetic, no parsing. */
  time: string
  text: string
  /** Optional source/booking link. Omitted when absent. */
  url?: string
}
```
to:
```ts
export interface ItineraryEvent {
  /** Free "HH:MM"-style label; "" when untimed. Cosmetic, no parsing. */
  time: string
  text: string
  /** Optional source/booking link. Omitted when absent. */
  url?: string
  /** Optional 1-5 rating. Omitted when unrated. */
  rating?: number
  /** Optional free note captured with a rating. Omitted when empty. */
  note?: string
}
```

- [ ] **Step 2: Read them in `parseEvents`**

Change the `.map(...)`:
```ts
    .map((e) => ({
      time: typeof e.time === "string" ? e.time : "",
      text: typeof e.text === "string" ? e.text : "",
      ...(typeof e.url === "string" && e.url.length > 0 ? { url: e.url } : {}),
    }))
```
to:
```ts
    .map((e) => ({
      time: typeof e.time === "string" ? e.time : "",
      text: typeof e.text === "string" ? e.text : "",
      ...(typeof e.url === "string" && e.url.length > 0 ? { url: e.url } : {}),
      ...(typeof e.rating === "number" && e.rating >= 1 && e.rating <= 5
        ? { rating: Math.round(e.rating) }
        : {}),
      ...(typeof e.note === "string" && e.note.length > 0 ? { note: e.note } : {}),
    }))
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit** (only if the user has asked)

```bash
git add src/lib/trips/itinerary-types.ts
git commit -m "feat(itinerary): optional rating + note on events (slice D)"
```

---

### Task 2: `rateEvent` action + preserve rating/note in `addTodayEvent`

**Files:**
- Modify: `src/lib/trips/actions.ts` (new `RateEventInput` + `rateEvent`; `addTodayEvent` merge map)

**Interfaces:**
- Consumes: `ItineraryEvent.rating?/note?` (Task 1); existing `sortDayEvents`.
- Produces: `rateEvent(input: RateEventInput)` — writes rating/note onto the event at `input.eventIndex` in the day's sorted array. `RateEventInput` = `{ tripSlug; dayId; eventIndex; rating: number | null; note: string }`.

- [ ] **Step 1: Add the action (place it next to `addTodayEvent`)**

```ts
export interface RateEventInput {
  tripSlug: string
  dayId: string
  /** Index of the event within the day's time-sorted events (sortDayEvents order). */
  eventIndex: number
  /** 1-5, or null to clear back to unrated. */
  rating: number | null
  /** "" clears the note. */
  note: string
}

/**
 * Writes a 1-5 rating and/or note onto one event of a day. Addresses the event
 * by its index in the day's sorted events (sortDayEvents) so it aligns with what
 * every surface renders; the rating rides on the event object. Store-only.
 */
export async function rateEvent(
  input: RateEventInput,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { data: row, error: loadError } = await supabase
    .from("itinerary_days")
    .select("events")
    .eq("id", input.dayId)
    .maybeSingle()
  if (loadError) return { error: loadError.message }
  if (!row) return { error: "Day not found." }

  const existing = Array.isArray(row.events)
    ? (row.events as ItineraryEvent[])
    : []
  const sorted = [...existing].sort(sortDayEvents)
  if (input.eventIndex < 0 || input.eventIndex >= sorted.length) {
    return { error: "Event not found." }
  }

  const note = input.note.trim()
  const rating =
    input.rating && input.rating >= 1 && input.rating <= 5
      ? Math.round(input.rating)
      : null
  const target: ItineraryEvent = { ...sorted[input.eventIndex] }
  if (rating) target.rating = rating
  else delete target.rating
  if (note) target.note = note
  else delete target.note
  sorted[input.eventIndex] = target

  const { error } = await supabase
    .from("itinerary_days")
    .update({ events: sorted })
    .eq("id", input.dayId)
  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}
```

- [ ] **Step 2: Preserve rating/note in `addTodayEvent`'s merge map**

Change:
```ts
      .map((e) => ({
        time: (e.time ?? "").trim(),
        text: (e.text ?? "").trim(),
        ...(typeof e.url === "string" && e.url.trim() ? { url: e.url.trim() } : {}),
      }))
```
to:
```ts
      .map((e) => ({
        time: (e.time ?? "").trim(),
        text: (e.text ?? "").trim(),
        ...(typeof e.url === "string" && e.url.trim() ? { url: e.url.trim() } : {}),
        ...(typeof e.rating === "number" && e.rating >= 1 && e.rating <= 5
          ? { rating: Math.round(e.rating) }
          : {}),
        ...(typeof e.note === "string" && e.note.trim() ? { note: e.note.trim() } : {}),
      }))
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit** (only if the user has asked)

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(itinerary): rateEvent action; preserve rating/note on merge (slice D)"
```

---

### Task 3: Shared `EventRating` editor

**Files:**
- Create: `src/components/event-rating.tsx`

**Interfaces:**
- Consumes: `rateEvent` (Task 2).
- Produces: `EventRating({ tripSlug, dayId, eventIndex, rating?, note? })` — collapsed shows stars or "☆ rate"; expanded is a 5-star picker + note input + save/cancel.

- [ ] **Step 1: Create the component**

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { rateEvent } from "@/lib/trips/actions"

/** Post-experience 1-5 + note editor for one itinerary event. Store-only.
 * Addresses the event by its index in the day's time-sorted events. */
export function EventRating({
  tripSlug,
  dayId,
  eventIndex,
  rating,
  note,
}: {
  tripSlug: string
  dayId: string
  eventIndex: number
  rating?: number
  note?: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [stars, setStars] = React.useState(rating ?? 0)
  const [text, setText] = React.useState(note ?? "")
  const [saving, setSaving] = React.useState(false)

  function save() {
    setSaving(true)
    rateEvent({
      tripSlug,
      dayId,
      eventIndex,
      rating: stars >= 1 ? stars : null,
      note: text.trim(),
    }).then((r) => {
      setSaving(false)
      if (r.error) return
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setStars(rating ?? 0)
          setText(note ?? "")
          setOpen(true)
        }}
        className="shrink-0 self-start font-mono text-[11px] tracking-[0.1em] text-muted-foreground hover:text-foreground"
      >
        {rating
          ? "★".repeat(rating) + "☆".repeat(5 - rating)
          : "☆ rate"}
      </button>
    )
  }

  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setStars(n)}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            className="px-0.5 text-[15px] leading-none text-clay"
          >
            {n <= stars ? "★" : "☆"}
          </button>
        ))}
        {stars > 0 ? (
          <button
            type="button"
            onClick={() => setStars(0)}
            className="ml-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-clay"
          >
            clear
          </button>
        ) : null}
      </div>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="note (optional)"
        disabled={saving}
        className="w-full border-0 border-b border-rule bg-transparent py-1 text-[12px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-full border-0 bg-foreground px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {saving ? "…" : "save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={saving}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          cancel
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: both exit 0. (Component compiles standalone; mounted in Tasks 5–6.)

- [ ] **Step 3: Commit** (only if the user has asked)

```bash
git add src/components/event-rating.tsx
git commit -m "feat(itinerary): shared EventRating star+note editor (slice D)"
```

---

### Task 4: Preserve rating/note through the day editor

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (`EventDraft`, `toEventDrafts`, both submit maps)

**Interfaces:**
- Consumes: `ItineraryEvent.rating?/note?` (Task 1).
- Produces: editing a day no longer drops ratings — `EventDraft` carries pass-through `rating?`/`note?`; both submit maps re-emit them.

- [ ] **Step 1: Add pass-through fields to `EventDraft`**

Change:
```ts
interface EventDraft {
  key: string
  time: string
  text: string
  url: string
}
```
to:
```ts
interface EventDraft {
  key: string
  time: string
  text: string
  url: string
  /** Pass-through only — the planning form never edits these, but must not drop
   * them when saving other fields (they carry the post-experience rating). */
  rating?: number
  note?: string
}
```

(`newEventDraft` is unchanged — a brand-new draft is unrated, so `rating`/`note` stay undefined.)

- [ ] **Step 2: Carry rating/note into drafts**

Change:
```ts
function toEventDrafts(events: ItineraryEvent[]): EventDraft[] {
  return events.map((e) => newEventDraft(e.time, e.text, e.url ?? ""))
}
```
to:
```ts
function toEventDrafts(events: ItineraryEvent[]): EventDraft[] {
  return events.map((e) => ({
    ...newEventDraft(e.time, e.text, e.url ?? ""),
    rating: e.rating,
    note: e.note,
  }))
}
```

- [ ] **Step 3: Re-emit rating/note in both submit maps**

There are two identical submit maps (in `DayEditor` and `DayCreator`). Change both occurrences of:
```ts
        events: events.map((e) => ({
          time: e.time,
          text: e.text,
          ...(e.url.trim() ? { url: e.url.trim() } : {}),
        })),
```
to:
```ts
        events: events.map((e) => ({
          time: e.time,
          text: e.text,
          ...(e.url.trim() ? { url: e.url.trim() } : {}),
          ...(typeof e.rating === "number" ? { rating: e.rating } : {}),
          ...(e.note && e.note.trim() ? { note: e.note.trim() } : {}),
        })),
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: both exit 0.

- [ ] **Step 5: Commit** (only if the user has asked)

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "fix(itinerary): keep rating/note through the day editor (slice D)"
```

---

### Task 5: Itinerary — render `EventRating` on past-day events

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx` (import; thread `today` mount → `DaySegmentView` → `DayCard` → `DayView`; render in `DayView`)

**Interfaces:**
- Consumes: `EventRating` (Task 3); server `today` (already a prop on the tab).
- Produces: past-day (`day.dayDate < today`) event rows show the rating editor.

- [ ] **Step 1: Import `EventRating`**

Add near the other imports at the top of the file:
```ts
import { EventRating } from "@/components/event-rating"
```

- [ ] **Step 2: Pass `today` to both `DaySegmentView` mount sites**

There are two `<DaySegmentView>` mounts (≈ line 694 and ≈ line 967), each ending with `dimBefore={active ? today : null}`. Add a `today` prop right after `dimBefore` at both:
```tsx
                    toggleDay={toggleDay}
                    dimBefore={active ? today : null}
                    today={today}
                  />
```
(`today` is already in scope at both mount sites — it's the tab's server prop.)

- [ ] **Step 3: Thread `today` through `DaySegmentView`**

In `DaySegmentView`, add `today` to the destructure and its type, then pass it to `<DayCard>`. Change the destructure/type head:
```ts
  expandedDays,
  toggleDay,
  dimBefore,
}: {
```
to:
```ts
  expandedDays,
  toggleDay,
  dimBefore,
  today,
}: {
```
and add to the type body (after `dimBefore: string | null`):
```ts
  dimBefore: string | null
  today: string
}) {
```
and in the `<DayCard ... />` it renders, add the prop after `dimBefore={dimBefore}`:
```tsx
      dimBefore={dimBefore}
      today={today}
```

- [ ] **Step 4: Thread `today` through `DayCard`**

Add `today: string` to `DayCardProps` (after `dimBefore: string | null`):
```ts
  dimBefore: string | null
  today: string
  onStartEdit: () => void
```
Add `today` to the destructure (after `dimBefore,`):
```ts
  dimBefore,
  today,
  onStartEdit,
```
And pass it to `<DayView>` (after `dimBefore={dimBefore}`):
```tsx
      dimBefore={dimBefore}
      today={today}
```

- [ ] **Step 5: Accept `today` in `DayView` and render `EventRating`**

Add `today` to `DayView`'s destructure (after `dimBefore,`) and type (after `dimBefore: string | null`):
```ts
  dimBefore,
  today,
  onStartEdit,
```
```ts
  dimBefore: string | null
  today: string
  onStartEdit: () => void
```

Then wrap each event so the rating sits below its text row. Change the event map:
```tsx
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
                  {ev.url ? (
                    <a
                      href={ev.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-sea hover:underline"
                    >
                      ↗ source
                    </a>
                  ) : null}
                </div>
              ))}
```
to:
```tsx
              {sortEvents(day.events).map((ev, i) => (
                <div key={i}>
                  <div className="flex gap-1.5 text-[12.5px] leading-snug text-muted-foreground">
                    {ev.time ? (
                      <span className="t-num shrink-0 text-foreground/70">
                        {ev.time}
                      </span>
                    ) : null}
                    <span>{ev.text}</span>
                    {ev.url ? (
                      <a
                        href={ev.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-sea hover:underline"
                      >
                        ↗ source
                      </a>
                    ) : null}
                  </div>
                  {day.dayDate < today ? (
                    <EventRating
                      tripSlug={tripSlug}
                      dayId={day.id}
                      eventIndex={i}
                      rating={ev.rating}
                      note={ev.note}
                    />
                  ) : null}
                </div>
              ))}
```

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: both exit 0.

- [ ] **Step 7: Manual check (390px viewport)**

On a trip with at least one past day (a past/finished trip, or an active trip with earlier days), open the Itinerary tab and expand a past day. Each event shows `☆ rate`; tap → 5-star picker + note + save. Save → the collapsed row shows the star count. Editing that day in the normal editor and saving does NOT wipe the rating. Today/future days show no rating affordance.

- [ ] **Step 8: Commit** (only if the user has asked)

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx"
git commit -m "feat(itinerary): rate past-day events on the itinerary (slice D)"
```

---

### Task 6: On-the-road — "Looking back" passed-events list

**Files:**
- Create: `src/app/on-the-road/today-past.tsx`
- Modify: `src/app/on-the-road/page.tsx` (import + mount)

**Interfaces:**
- Consumes: `EventRating` (Task 3); `ItineraryEvent` (Task 1); today's `events` + `dayId` + `tripSlug` from the page.
- Produces: today's already-passed timed events show the rating editor.

- [ ] **Step 1: Create the component**

```tsx
"use client"

import React from "react"

import type { ItineraryEvent } from "@/lib/trips/itinerary-types"
import { EventRating } from "@/components/event-rating"

/** Current local time as zero-padded "HH:MM" (matches event time strings). */
function computeNow(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`
}

let cachedNow = ""
function getSnapshot(): string {
  const v = computeNow()
  if (v !== cachedNow) cachedNow = v
  return cachedNow
}
function subscribe(): () => void {
  return () => {}
}
function getServerSnapshot(): null {
  return null
}
function useLocalHhMm(): string | null {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Today's already-passed timed events (time < now), each rateable. Indexes are
 * into the FULL day's time-sorted events so they align with rateEvent's sort.
 * Renders nothing on the server (local time unknown) — no hydration mismatch.
 */
export function TodayPast({
  tripSlug,
  dayId,
  events,
}: {
  tripSlug: string
  dayId: string
  events: ItineraryEvent[]
}) {
  const now = useLocalHhMm()
  if (now === null) return null

  const sorted = [...events].sort((a, b) => {
    if (!a.time && !b.time) return 0
    if (!a.time) return 1
    if (!b.time) return -1
    return a.time < b.time ? -1 : a.time > b.time ? 1 : 0
  })
  const passed = sorted
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.time && e.time < now)

  if (passed.length === 0) return null

  return (
    <div className="mt-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Looking back
      </span>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {passed.map(({ e, i }) => (
          <li key={i} className="flex flex-col gap-0.5">
            <div className="flex gap-2 text-[13px] text-foreground">
              <span className="t-num shrink-0 text-muted-foreground">
                {e.time}
              </span>
              <span>{e.text}</span>
            </div>
            <EventRating
              tripSlug={tripSlug}
              dayId={dayId}
              eventIndex={i}
              rating={e.rating}
              note={e.note}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Mount it on the on-the-road page**

Add the import near the other page imports:
```ts
import { TodayPast } from "./today-past"
```
Then, inside the `{todayDay ? ( ... ) : ...}` block, after `<TodayUpcoming events={todayDay.events} />`, add (still inside the truthy branch, where `todayDay` is defined):
```tsx
            <TodayUpcoming events={todayDay.events} />
            <TodayPast
              tripSlug={trip.slug}
              dayId={todayDay.id}
              events={todayDay.events}
            />
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: both exit 0.

- [ ] **Step 4: Manual check (390px viewport, active trip)**

On `/on-the-road` during a trip, once today has at least one timed event whose time has passed, a "Looking back" list shows those events, each with `☆ rate`. Rate one → save → stars persist. Events still upcoming don't appear there (they stay in the upcoming list). Rating a passed event here and later viewing that day (tomorrow, as a past day on the itinerary) shows the same rating.

- [ ] **Step 5: Commit** (only if the user has asked)

```bash
git add src/app/on-the-road/today-past.tsx src/app/on-the-road/page.tsx
git commit -m "feat(on-the-road): rate today's passed events (slice D)"
```

---

## Notes for the implementer

- **Do not touch** discovery ranking / `searchRestaurants` — Slice D is store-only.
- **Do not add** rating to `DayForm`'s visible fields — the planning editor only *preserves* rating/note (Task 4); it never shows or edits them.
- **Do not touch** `shared-trip-types.ts` — ratings stay out of the public `/t/` projection.
- **Index alignment is load-bearing:** every surface derives `eventIndex` from the full day's time-sorted events, and `rateEvent` sorts the same way. If you change one sort, change all.
- After all tasks: update `docs/TODO.md` (Slice D shipped) and mark the restaurant-discovery roadmap A–D complete.

