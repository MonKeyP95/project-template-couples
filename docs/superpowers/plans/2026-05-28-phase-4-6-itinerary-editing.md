# Phase 4.6 — Itinerary Editing (dated trips) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per project memory, when each step has fully concrete code, default to inline execution rather than per-task subagent dispatch.

**Goal:** Replace the read-only itinerary timeline with a fully editable `ItineraryTab` — inline add, click-to-edit, native-confirm delete — backed by three new Server Actions on the existing `itinerary_days` table and a Supabase Realtime channel for cross-client sync.

**Architecture:** No new application table; the Phase 3 `itinerary_days` schema covers everything. One tiny migration adds the table to the Realtime publication so `INSERT`/`UPDATE`/`DELETE` events broadcast. `itinerary-queries.ts` extends `ItineraryDay` with `id` and `dayDate` (so edit/delete have keys) and exports a `withOrdinals` helper that re-pads `d` after sort. Three actions in `actions.ts` mirror the `addNote`/`updateNote`/`deleteNote` shape, including `23505` collision translation for the unique `(trip_id, day_date)` constraint. The new `ItineraryTab` client component replaces the inline `ItineraryView` in `page.tsx`, hosts the Realtime channel + optimistic state (`PackingTab` shape), and follows the `NoteView`/`NoteEditor` split-component pattern to sidestep React 19's `set-state-in-effect` lint.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Tailwind v4, `@supabase/ssr` 0.10 (server) + `@supabase/supabase-js` 2.106 (client Realtime), Postgres. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-28-phase-4-6-itinerary-editing-design.md`

**Note on commits:** One commit per task, matching the project pattern. Task 4 is docs-only.

**Note on tests:** Project has no test suite (per `CLAUDE.md`). Validation per task is `pnpm lint && pnpm build`. Manual UI verification depends on the user pasting Task 1's migration into the Supabase SQL Editor; flagged at the end of Task 1.

**Note on the `ItineraryDay` shape change:** The current `ItineraryDay` is the "view shape" (`d`/`dow`/`date`/`title`/`sub`/`tag`/`tone`). This plan extends it with `id: string` and `dayDate: string` (raw row data) so edit/delete have stable keys and the editor can pre-fill the date input. Existing consumers (`ItineraryRow` in `page.tsx`) never read `id`/`dayDate`, so the extension is forward-compatible — Task 2 ships it without breaking anything; the consumer change happens in Task 3.

---

### Task 1: Realtime publication migration

**Files:**
- Create: `supabase/migrations/20260528000004_phase_4_6_itinerary_realtime.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260528000004_phase_4_6_itinerary_realtime.sql` with this exact content:

```sql
-- Phase 4.6: add itinerary_days to the Realtime publication so the
-- new ItineraryTab can subscribe to live INSERT / UPDATE / DELETE events.
-- Mirrors the pattern in 20260526000003_phase_3_packing.sql which added
-- packing_items the same way.
--
-- Idempotent: the do-block swallows the duplicate_object error if the
-- table is already in the publication.

do $$
begin
  alter publication supabase_realtime add table public.itinerary_days;
exception
  when duplicate_object then null;
end $$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260528000004_phase_4_6_itinerary_realtime.sql
git commit -m "feat(trips): add itinerary_days to Realtime publication"
```

No lint/build step — SQL files aren't part of the JS/TS pipeline. The migration takes effect only when the user pastes it into the Supabase SQL Editor.

**User action required (flag at end of execution):** paste this file into the Supabase SQL Editor. Until then, Task 3's Realtime channel will silently subscribe with no events flowing. The rest of the UI (add/edit/delete via Server Actions + `revalidatePath`) still works.

---

### Task 2: Query layer refactor + Server Actions

**Files:**
- Modify: `src/lib/trips/itinerary-queries.ts` (extend `ItineraryDay`, add `ITINERARY_TONES`, add `rowToItineraryDay`, add `withOrdinals`, refactor `getItineraryDays`)
- Modify: `src/lib/trips/actions.ts` (one new import block + three appended exports)

- [ ] **Step 1: Replace `itinerary-queries.ts` wholesale**

Open `src/lib/trips/itinerary-queries.ts`. Replace its entire contents with:

```ts
import { createClient } from "@/lib/supabase/server"

export const ITINERARY_TONES = ["sea", "clay", "moss", "sand"] as const
export type ItineraryTone = (typeof ITINERARY_TONES)[number]

export interface ItineraryDay {
  /** Row id — needed by edit/delete UI. */
  id: string
  /** Raw yyyy-mm-dd — needed by the date input. */
  dayDate: string
  /** 1-based ordinal padded to 2 digits ("01", "02"). Derived from sort position. */
  d: string
  /** 3-char weekday in UTC ("FRI"). */
  dow: string
  /** "Jun 12"-style short date in UTC. */
  date: string
  title: string
  sub: string
  tag: string
  tone: ItineraryTone
}

interface ItineraryRow {
  id: string
  day_date: string
  title: string
  sub: string | null
  tag: string
  tone: string
}

const DOW_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: "UTC",
})

const SHORT_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

function toUtc(dayDate: string): Date {
  return new Date(`${dayDate}T00:00:00Z`)
}

/** Single row → ItineraryDay. `d` is a placeholder; pass through `withOrdinals` to set correctly. */
export function rowToItineraryDay(row: ItineraryRow): ItineraryDay {
  const utc = toUtc(row.day_date)
  return {
    id: row.id,
    dayDate: row.day_date,
    d: "",
    dow: DOW_FMT.format(utc),
    date: SHORT_DATE_FMT.format(utc),
    title: row.title,
    sub: row.sub ?? "",
    tag: row.tag,
    tone: row.tone as ItineraryTone,
  }
}

/** Sort by dayDate ascending and re-pad `d` ordinals. Pure; safe for client-side use after Realtime deltas. */
export function withOrdinals(days: ItineraryDay[]): ItineraryDay[] {
  const sorted = [...days].sort((a, b) =>
    a.dayDate < b.dayDate ? -1 : a.dayDate > b.dayDate ? 1 : 0,
  )
  return sorted.map((day, i) => ({
    ...day,
    d: String(i + 1).padStart(2, "0"),
  }))
}

export async function getItineraryDays(
  tripId: string,
): Promise<ItineraryDay[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("itinerary_days")
    .select("id, day_date, title, sub, tag, tone")
    .eq("trip_id", tripId)
    .order("day_date", { ascending: true })

  return withOrdinals((data ?? []).map(rowToItineraryDay))
}
```

Three additions vs the current file: `ITINERARY_TONES` constant, `rowToItineraryDay`/`withOrdinals` exported helpers, and `ItineraryDay` gains `id` + `dayDate`. The query now selects `id` as well as the previous columns.

- [ ] **Step 2: Add imports to `actions.ts`**

In `src/lib/trips/actions.ts`, find:

```ts
import { rowToNote, type TripNote } from "@/lib/trips/note-queries"
```

Add immediately below it:

```ts
import {
  ITINERARY_TONES,
  rowToItineraryDay,
  type ItineraryDay,
  type ItineraryTone,
} from "@/lib/trips/itinerary-queries"
```

- [ ] **Step 3: Append `addItineraryDay` to `actions.ts`**

Append at the very bottom of `src/lib/trips/actions.ts`:

```ts
export interface AddItineraryDayInput {
  tripId: string
  tripSlug: string
  dayDate: string
  title: string
  sub: string
  tag: string
  tone: ItineraryTone
}

export interface AddItineraryDayResult {
  error?: string
  /** Populated on success — full ItineraryDay (d ordinal is placeholder; client re-runs withOrdinals). */
  day?: ItineraryDay
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Inserts a new itinerary day. RLS gates membership. On unique-violation
 * (another day already uses this date), returns a friendly error. Returns
 * the inserted row as an ItineraryDay so the client can apply it via
 * withOrdinals optimistically.
 */
export async function addItineraryDay(
  input: AddItineraryDayInput,
): Promise<AddItineraryDayResult> {
  const title = input.title.trim()
  if (!title) return { error: "Title required." }
  const tag = input.tag.trim()
  if (!tag) return { error: "Tag required." }
  if (!DATE_RE.test(input.dayDate)) return { error: "Invalid date." }
  if (!ITINERARY_TONES.includes(input.tone)) return { error: "Invalid tone." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const sub = input.sub.trim()

  const { data, error } = await supabase
    .from("itinerary_days")
    .insert({
      trip_id: input.tripId,
      day_date: input.dayDate,
      title,
      sub,
      tag,
      tone: input.tone,
      created_by: userData.user.id,
    })
    .select("id, day_date, title, sub, tag, tone")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { error: "Another day already uses that date." }
    }
    return { error: error.message }
  }

  revalidatePath(`/trips/${input.tripSlug}`)
  return { day: rowToItineraryDay(data) }
}
```

- [ ] **Step 4: Append `updateItineraryDay` to `actions.ts`**

Append after `addItineraryDay`:

```ts
export interface UpdateItineraryDayInput {
  dayId: string
  tripSlug: string
  dayDate: string
  title: string
  sub: string
  tag: string
  tone: ItineraryTone
}

export interface UpdateItineraryDayResult {
  error?: string
}

/**
 * Edits an existing itinerary day. Same validation + collision-translation
 * shape as addItineraryDay. created_by and created_at never touched.
 */
export async function updateItineraryDay(
  input: UpdateItineraryDayInput,
): Promise<UpdateItineraryDayResult> {
  const title = input.title.trim()
  if (!title) return { error: "Title required." }
  const tag = input.tag.trim()
  if (!tag) return { error: "Tag required." }
  if (!DATE_RE.test(input.dayDate)) return { error: "Invalid date." }
  if (!ITINERARY_TONES.includes(input.tone)) return { error: "Invalid tone." }

  const supabase = await createClient()
  const sub = input.sub.trim()

  const { error } = await supabase
    .from("itinerary_days")
    .update({
      day_date: input.dayDate,
      title,
      sub,
      tag,
      tone: input.tone,
    })
    .eq("id", input.dayId)

  if (error) {
    if (error.code === "23505") {
      return { error: "Another day already uses that date." }
    }
    return { error: error.message }
  }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}
```

- [ ] **Step 5: Append `deleteItineraryDay` to `actions.ts`**

Append after `updateItineraryDay`:

```ts
/**
 * Permanently deletes an itinerary day. Throws on error (form-action shape).
 * No cascade concerns — itinerary days have no children.
 */
export async function deleteItineraryDay(
  dayId: string,
  tripSlug: string,
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("itinerary_days")
    .delete()
    .eq("id", dayId)
  if (error) throw new Error(error.message)

  revalidatePath(`/trips/${tripSlug}`)
}
```

- [ ] **Step 6: Verify lint + build**

Run: `pnpm lint && pnpm build`

Expected: both pass. The existing `ItineraryRow` in `page.tsx` reads `day.d`, `day.dow`, `day.date`, `day.tag`, `day.title`, `day.sub`, `day.tone` — all still present. The new `id` and `dayDate` fields are unused by the existing consumer; that's fine until Task 3.

- [ ] **Step 7: Commit**

```bash
git add src/lib/trips/itinerary-queries.ts src/lib/trips/actions.ts
git commit -m "feat(trips): itinerary queries refactor + add/update/delete actions"
```

---

### Task 3: ItineraryTab component + page.tsx integration

**Files:**
- Create: `src/app/trips/[slug]/itinerary-tab.tsx`
- Modify: `src/app/trips/[slug]/page.tsx` (drop inline `ItineraryView`/`ItineraryRow`/`TabStub`-itinerary branch + `itineraryBorder` map; add `ItineraryTab` import; rewire conditional render)

- [ ] **Step 1: Create `itinerary-tab.tsx`**

Create `src/app/trips/[slug]/itinerary-tab.tsx` with this exact content:

```tsx
"use client"

import * as React from "react"

import { Label, MonoBadge, SuggestionCard } from "@/components/together"
import { createClient } from "@/lib/supabase/client"
import {
  addItineraryDay,
  deleteItineraryDay,
  updateItineraryDay,
} from "@/lib/trips/actions"
import {
  ITINERARY_TONES,
  rowToItineraryDay,
  withOrdinals,
  type ItineraryDay,
  type ItineraryTone,
} from "@/lib/trips/itinerary-queries"

const itineraryBorder: Record<ItineraryTone, string> = {
  sea: "border-l-sea",
  clay: "border-l-clay",
  moss: "border-l-moss",
  sand: "border-l-sand",
}

interface RealtimeRow {
  id: string
  trip_id: string
  day_date: string
  title: string
  sub: string | null
  tag: string
  tone: string
  created_by: string
  created_at: string
}

function nextDayAfter(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function ItineraryTab({
  tripId,
  tripSlug,
  tripStartDate,
  initialItems,
}: {
  tripId: string
  tripSlug: string
  tripStartDate: string
  initialItems: ItineraryDay[]
}) {
  const [days, setDays] = React.useState<ItineraryDay[]>(initialItems)
  const [lastInitial, setLastInitial] = React.useState(initialItems)
  const [editingId, setEditingId] = React.useState<string | null>(null)

  if (initialItems !== lastInitial) {
    setLastInitial(initialItems)
    setDays(initialItems)
  }

  React.useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`itinerary-${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "itinerary_days",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const incoming = rowToItineraryDay(payload.new as RealtimeRow)
            setDays((prev) =>
              prev.some((d) => d.id === incoming.id)
                ? prev
                : withOrdinals([...prev, incoming]),
            )
          } else if (payload.eventType === "UPDATE") {
            const incoming = rowToItineraryDay(payload.new as RealtimeRow)
            setDays((prev) =>
              withOrdinals(
                prev.map((d) => (d.id === incoming.id ? incoming : d)),
              ),
            )
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string }
            if (old.id) {
              setDays((prev) =>
                withOrdinals(prev.filter((d) => d.id !== old.id)),
              )
            }
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tripId])

  const defaultDate =
    days.length > 0
      ? nextDayAfter(days[days.length - 1].dayDate)
      : tripStartDate

  return (
    <section>
      <div className="flex items-baseline justify-between px-5 pt-5 lg:px-10 lg:pt-6">
        <Label>Itinerary</Label>
        <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
          drafted by <span className="text-sea">● M+G</span>
        </span>
      </div>

      <div className="px-5 pt-2.5 lg:px-10">
        {days.length === 0 ? (
          <p className="font-serif text-[15px] italic text-muted-foreground">
            No days planned yet — add the first one.
          </p>
        ) : (
          days.map((day, i) => (
            <DayCard
              key={day.id}
              day={day}
              tripSlug={tripSlug}
              isLast={i === days.length - 1}
              isEditing={editingId === day.id}
              onStartEdit={() => setEditingId(day.id)}
              onStopEdit={() => setEditingId(null)}
            />
          ))
        )}
      </div>

      <div className="px-5 pt-4 lg:px-10">
        <AddDayRow
          tripId={tripId}
          tripSlug={tripSlug}
          defaultDate={defaultDate}
        />
      </div>

      <div className="px-5 pt-4 pb-6 lg:px-10">
        <SuggestionCard
          label="/ assistant"
          applyLabel="apply"
          dismissLabel="dismiss"
        >
          Day 05 has a 4-hour drive after the ferry. Want me to{" "}
          <span className="font-serif italic text-foreground">
            split it across two days
          </span>{" "}
          so you&apos;re not arriving in Senaru tired?
        </SuggestionCard>
      </div>
    </section>
  )
}

function DayCard({
  day,
  tripSlug,
  isLast,
  isEditing,
  onStartEdit,
  onStopEdit,
}: {
  day: ItineraryDay
  tripSlug: string
  isLast: boolean
  isEditing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
}) {
  if (isEditing) {
    return <DayEditor day={day} tripSlug={tripSlug} onDone={onStopEdit} />
  }
  return (
    <DayView
      day={day}
      tripSlug={tripSlug}
      isLast={isLast}
      onStartEdit={onStartEdit}
    />
  )
}

function DayView({
  day,
  tripSlug,
  isLast,
  onStartEdit,
}: {
  day: ItineraryDay
  tripSlug: string
  isLast: boolean
  onStartEdit: () => void
}) {
  return (
    <div className="relative flex gap-3.5 py-3.5">
      <div className="relative w-9 flex-shrink-0">
        <div className="font-mono text-[9px] uppercase leading-none tracking-[0.14em] text-muted-foreground">
          DAY
        </div>
        <div className="mt-0.5 font-mono text-[22px] leading-none tracking-[-0.02em] text-foreground">
          {day.d}
        </div>
        <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {day.dow.toUpperCase()}
        </div>
        {!isLast ? (
          <div className="absolute -bottom-3.5 left-[11px] top-14 w-px bg-border" />
        ) : null}
      </div>
      <div
        className={`flex-1 rounded-lg border border-border bg-card px-3.5 py-3 border-l-[3px] ${itineraryBorder[day.tone]}`}
      >
        <div className="mb-1.5 flex items-center justify-between">
          <MonoBadge tone={day.tone}>{day.tag}</MonoBadge>
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            {day.date}
          </span>
        </div>
        <div className="t-display mb-1 text-[22px] leading-tight text-foreground">
          {day.title}
        </div>
        {day.sub ? (
          <div className="text-[12.5px] leading-snug text-muted-foreground">
            {day.sub}
          </div>
        ) : null}
        <div className="mt-2 flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onStartEdit}
            aria-label="Edit day"
            className="border-0 bg-transparent px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
          >
            ✎
          </button>
          <form
            action={deleteItineraryDay.bind(null, day.id, tripSlug)}
            onSubmit={(e) => {
              if (
                !window.confirm("Delete this day? This can't be undone.")
              ) {
                e.preventDefault()
              }
            }}
            className="inline-flex"
          >
            <button
              type="submit"
              aria-label="Delete day"
              className="border-0 bg-transparent px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-clay"
            >
              ×
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function DayEditor({
  day,
  tripSlug,
  onDone,
}: {
  day: ItineraryDay
  tripSlug: string
  onDone: () => void
}) {
  const [dayDate, setDayDate] = React.useState(day.dayDate)
  const [tag, setTag] = React.useState(day.tag)
  const [title, setTitle] = React.useState(day.title)
  const [sub, setSub] = React.useState(day.sub)
  const [tone, setTone] = React.useState<ItineraryTone>(day.tone)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !title.trim() || !tag.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await updateItineraryDay({
        dayId: day.id,
        tripSlug,
        dayDate,
        title,
        sub,
        tag,
        tone,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      onDone()
    })
  }

  return (
    <DayForm
      heading="Edit day"
      dayDate={dayDate}
      setDayDate={setDayDate}
      tag={tag}
      setTag={setTag}
      title={title}
      setTitle={setTitle}
      sub={sub}
      setSub={setSub}
      tone={tone}
      setTone={setTone}
      error={error}
      isPending={isPending}
      submitLabel="save"
      onSubmit={save}
      onCancel={onDone}
    />
  )
}

function AddDayRow({
  tripId,
  tripSlug,
  defaultDate,
}: {
  tripId: string
  tripSlug: string
  defaultDate: string
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [dayDate, setDayDate] = React.useState(defaultDate)
  const [tag, setTag] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [sub, setSub] = React.useState("")
  const [tone, setTone] = React.useState<ItineraryTone>("sea")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!expanded) setDayDate(defaultDate)
  }, [expanded, defaultDate])

  function reset() {
    setExpanded(false)
    setDayDate(defaultDate)
    setTag("")
    setTitle("")
    setSub("")
    setTone("sea")
    setError(null)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !title.trim() || !tag.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await addItineraryDay({
        tripId,
        tripSlug,
        dayDate,
        title,
        sub,
        tag,
        tone,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      reset()
    })
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="block w-full rounded-lg border border-dashed border-rule py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"
      >
        + add day
      </button>
    )
  }

  return (
    <DayForm
      heading="Add day"
      dayDate={dayDate}
      setDayDate={setDayDate}
      tag={tag}
      setTag={setTag}
      title={title}
      setTitle={setTitle}
      sub={sub}
      setSub={setSub}
      tone={tone}
      setTone={setTone}
      error={error}
      isPending={isPending}
      submitLabel="add"
      onSubmit={submit}
      onCancel={reset}
    />
  )
}

function DayForm({
  heading,
  dayDate,
  setDayDate,
  tag,
  setTag,
  title,
  setTitle,
  sub,
  setSub,
  tone,
  setTone,
  error,
  isPending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  heading: string
  dayDate: string
  setDayDate: (s: string) => void
  tag: string
  setTag: (s: string) => void
  title: string
  setTitle: (s: string) => void
  sub: string
  setSub: (s: string) => void
  tone: ItineraryTone
  setTone: (t: ItineraryTone) => void
  error: string | null
  isPending: boolean
  submitLabel: string
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-clay bg-card p-3.5"
    >
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        / {heading}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Date
          </span>
          <input
            type="date"
            value={dayDate}
            onChange={(e) => setDayDate(e.target.value)}
            disabled={isPending}
            required
            className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Tag
          </span>
          <input
            type="text"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="ARRIVE / SURF / …"
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] uppercase text-foreground placeholder:normal-case placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Title
        </span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Crossing to Gili Trawangan"
          disabled={isPending}
          className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[16px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
      </label>

      <label className="mt-3 block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Sub
        </span>
        <input
          type="text"
          value={sub}
          onChange={(e) => setSub(e.target.value)}
          placeholder="Optional"
          disabled={isPending}
          className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
      </label>

      <div className="mt-4">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Tone
        </span>
        <div className="mt-1.5 flex gap-1.5">
          {ITINERARY_TONES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTone(t)}
              disabled={isPending}
              aria-pressed={tone === t}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors disabled:opacity-50 ${
                tone === t
                  ? "border-foreground bg-foreground text-background"
                  : "border-rule bg-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className={`h-2 w-2 rounded-full bg-${t}`} aria-hidden />
              {t}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="mt-3 font-mono text-[10px] text-clay">{error}</div>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
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
    </form>
  )
}
```

Tailwind safelist note: the tone pills use dynamic class names `bg-${t}` where `t` is one of `sea`/`clay`/`moss`/`sand`. Tailwind v4's content scanner already finds these classes from their literal occurrences elsewhere in the codebase (e.g., `bg-sea` in `slug-tone.ts`, `bg-clay` in `MonoBadge`), so they are emitted. No safelist edit needed; just be aware that adding a new tone in the future requires its `bg-*` class to appear somewhere statically too.

- [ ] **Step 2: Add `ItineraryTab` import in `page.tsx`**

In `src/app/trips/[slug]/page.tsx`, find:

```tsx
import { BudgetTab } from "./budget-tab"
import { NotesTab } from "./notes-tab"
import {
  PackingTab,
  type MemberToneEntry,
} from "./packing-tab"
```

Replace with:

```tsx
import { BudgetTab } from "./budget-tab"
import { ItineraryTab } from "./itinerary-tab"
import { NotesTab } from "./notes-tab"
import {
  PackingTab,
  type MemberToneEntry,
} from "./packing-tab"
```

- [ ] **Step 3: Drop the `itineraryBorder` map**

In the same file, find the `itineraryBorder` constant block near the top (just above `isTab`):

```tsx
const itineraryBorder: Record<ItineraryDay["tone"], string> = {
  sea: "border-l-sea",
  clay: "border-l-clay",
  moss: "border-l-moss",
  sand: "border-l-sand",
}
```

Delete it. The map now lives inside `itinerary-tab.tsx`. The `ItineraryDay` type import a few lines above (`import { getItineraryDays, type ItineraryDay } from "@/lib/trips/itinerary-queries"`) still has consumers below (the page-level lazy fetch returns it), so leave that import alone.

- [ ] **Step 4: Rewire the active-tab render switch for itinerary**

Find the existing itinerary render branch:

```tsx
        {activeTab === "itinerary" ? (
          itinerary && itinerary.length > 0 ? (
            <ItineraryView itinerary={itinerary} />
          ) : header.startDate === null ? (
            <DreamItineraryStub />
          ) : (
            <TabStub label="Itinerary" />
          )
        ) : activeTab === "packing" ? (
```

Replace with:

```tsx
        {activeTab === "itinerary" ? (
          header.startDate === null ? (
            <DreamItineraryStub />
          ) : (
            <ItineraryTab
              tripId={header.id}
              tripSlug={header.slug}
              tripStartDate={header.startDate}
              initialItems={itinerary ?? []}
            />
          )
        ) : activeTab === "packing" ? (
```

- [ ] **Step 5: Delete the now-unused `ItineraryView`, `ItineraryRow`, and `TabStub` functions**

In `src/app/trips/[slug]/page.tsx`, find the three function declarations:

```tsx
function ItineraryView({
  itinerary,
}: {
  itinerary: ItineraryDay[]
}) {
  // … existing body
}

function ItineraryRow({
  day,
  isLast,
}: {
  day: ItineraryDay
  isLast: boolean
}) {
  // … existing body
}
```

Delete both function declarations entirely. Then find:

```tsx
function TabStub({ label }: { label: string }) {
  return (
    <section className="px-5 pt-6">
      <Label>{label}</Label>
      <p className="mt-3 font-serif text-[15px] italic text-muted-foreground">
        Arriving soon.
      </p>
    </section>
  )
}
```

Delete this too. After Step 4, `TabStub` has no callers — all four tabs render real content now.

`DreamItineraryStub` stays — it still renders for dreams.

The `SuggestionCard`, `MonoBadge`, and `getItineraryDays` imports in `page.tsx` may now look unused — but `getItineraryDays` is still called in the lazy `Promise.all`, and `SuggestionCard` / `MonoBadge` may still be used elsewhere in the file. Don't delete imports blindly; let `pnpm lint`'s `unused-imports` rule guide you in Step 6 if any actually became orphaned.

- [ ] **Step 6: Verify lint + build**

Run: `pnpm lint && pnpm build`

Expected: both pass. If lint complains about unused imports (`SuggestionCard`, `MonoBadge`, `Label` from the `together` barrel), remove just those names from the import statement. The route table should still list `ƒ /trips/[slug]` and `ƒ /trips/[slug]/edit` — no new route.

If the React 19 lint rule `react-hooks/set-state-in-effect` fires on the `AddDayRow`'s `useEffect(() => { if (!expanded) setDayDate(defaultDate) }, [expanded, defaultDate])` (per `memory/feedback-react19-lint-gotchas.md`), that's a legitimate hit. Fix: remove the `useEffect` and instead reset `dayDate` inside `reset()` (which already sets it). The effect was belt-and-suspenders for an externally changing `defaultDate` while the form is collapsed; collapsing always calls `reset()`, so the effect is redundant.

- [ ] **Step 7: Manual UI verification (if migration applied)**

If the user hasn't yet pasted Task 1's migration into the Supabase SQL Editor, skip this step — the channel just subscribes silently, but `revalidatePath` still refreshes everything in the same tab.

If the migration is applied:

1. Navigate to `http://localhost:3000/trips/lombok` (the itinerary is the default tab).
2. Verify the existing 8-day timeline renders with `✎` and `×` buttons in each card's bottom-right.
3. Click `✎` on Day 01. Confirm the card swaps to a form pre-filled with `ARRIVE` / `Crossing to Gili Trawangan` / sand tone / `2026-06-12`. Edit the title, click `save` — should return to read mode with the updated title.
4. Click the `+ add day` button below the timeline. Confirm the form opens with the date pre-filled to the day after the last existing day (`2026-06-20`). Fill in a new day, click `add` — should clear + collapse, new day appears at the bottom.
5. On the new day, click `✎`, change the date to one that already exists (e.g. `2026-06-15`). Click `save`. Confirm the friendly error "Another day already uses that date." surfaces inline.
6. Cancel out, click `×` on the new day, confirm the native confirm dialog. Click OK; the day disappears.
7. If a second device / browser tab is signed in to the same workspace, repeat Steps 4 and 6 there to confirm Realtime broadcasts (the partner sees the insert/delete without refresh).

If any step fails, fix before committing.

- [ ] **Step 8: Commit**

```bash
git add "src/app/trips/[slug]/itinerary-tab.tsx" "src/app/trips/[slug]/page.tsx"
git commit -m "feat(trips): editable Itinerary tab on /trips/[slug]"
```

---

### Task 4: Docs (TODO.md + DECISIONS.md)

**Files:**
- Modify: `docs/TODO.md` (update Current Phase header, add Phase 4.6 section, add Slice B + C carries, remove the shipped item from Backlog)
- Modify: `docs/DECISIONS.md` (append 5 table rows)

- [ ] **Step 1: Update Current Phase header in `TODO.md`**

Find:

```
**Phase 4.5 — Trip Notes: code shipped 2026-05-28 (pending Supabase migration paste for the trip_notes table).** New Notes tab on `/trips/[slug]` lets any workspace member jot, edit, and delete free-text notes for a trip. Backed by a new `trip_notes` table (FK to `trips` with cascade, RLS via `is_trip_workspace_member`). Three Server Actions (`addNote` / `updateNote` / `deleteNote`) mirror the existing patterns. Per-trip-only scope; workspace-level `/notes` deferred per the spec. **User action required**: paste `supabase/migrations/20260528000003_phase_4_5_trip_notes.sql` into the Supabase SQL Editor.
```

Replace with:

```
**Phase 4.6 — Itinerary Editing (dated trips): code shipped 2026-05-28 (pending Supabase migration paste to enable Realtime).** The itinerary timeline is now fully editable inline: `+ add day` opens a five-field form (date / tag / title / sub / tone pill picker) with the date pre-filled to the next available slot; `✎` on a day card swaps it for the same form pre-populated; `×` deletes with native confirm. Three Server Actions mirror the `addNote` / `updateNote` / `deleteNote` shape; `23505` collisions on `(trip_id, day_date)` translate to "Another day already uses that date." Realtime channel on `itinerary_days` keeps the two devices in sync. Dreams unchanged — Slice B (numbered days for dreams) and Slice C (drag-to-reschedule) carried below. **User action required**: paste `supabase/migrations/20260528000004_phase_4_6_itinerary_realtime.sql` into the Supabase SQL Editor to enable Realtime broadcasts.

**Phase 4.5 — Trip Notes: shipped 2026-05-28.** New Notes tab on `/trips/[slug]` lets any workspace member jot, edit, and delete free-text notes for a trip. Backed by a `trip_notes` table (FK cascade, RLS via `is_trip_workspace_member`). Three Server Actions (`addNote` / `updateNote` / `deleteNote`). Per-trip-only scope; workspace-level `/notes` deferred per the spec.
```

- [ ] **Step 2: Add the Phase 4.6 section between Phase 4.5 and Phase 3.5**

Find:

```
### Carried into the next Phase 4.5 slice (post-trip)
- **Workspace-level `/notes` route.** The design handoff has `Notes` in the top-level desktop nav. Revisit if "general restaurant ideas not tied to any trip" becomes a felt gap during the Lombok trip.
- **Categories / tags** (restaurant / lodging / tip / idea). Only if browsing notes by type becomes painful.
- **Day association** (`day_date` nullable column + day picker on form). Only if "morning of day 3" notes feel essential.
- **Realtime channel for notes.** Only if simultaneous co-typing becomes a real scenario.

## Phase 3.5 — Basic CRUD (do one at a time)
```

Replace with:

```
### Carried into the next Phase 4.5 slice (post-trip)
- **Workspace-level `/notes` route.** The design handoff has `Notes` in the top-level desktop nav. Revisit if "general restaurant ideas not tied to any trip" becomes a felt gap during the Lombok trip.
- **Categories / tags** (restaurant / lodging / tip / idea). Only if browsing notes by type becomes painful.
- **Day association** (`day_date` nullable column + day picker on form). Only if "morning of day 3" notes feel essential.
- **Realtime channel for notes.** Only if simultaneous co-typing becomes a real scenario.

## Phase 4.6 — Itinerary Editing (dated trips)
- [x] **1. Editable itinerary timeline** — Done 2026-05-28. New `ItineraryTab` (`"use client"`) replaces the previous read-only `ItineraryView` on `/trips/[slug]?tab=itinerary`. Inline add (dashed `+ add day` expands to a five-field form), click-to-edit per card (`✎`), native-confirm delete (`×`). Five editable fields: `day_date` (date picker, auto-defaulted to max+1 or trip start), `tag` (free-text, mono-uppercased visually), `title`, `sub`, `tone` (four-pill picker over `ITINERARY_TONES`). Three Server Actions in `actions.ts`: `addItineraryDay` (returns inserted row as `ItineraryDay`), `updateItineraryDay` (validation mirrors add; `23505` collision translated to "Another day already uses that date."), `deleteItineraryDay` (throws-on-error form-action shape). `itinerary-queries.ts` refactored: `ItineraryDay` gained `id` + `dayDate`; new `rowToItineraryDay` + `withOrdinals` helpers; `ITINERARY_TONES` constant exported. Realtime channel on `itinerary_days` for cross-device sync (matches packing pattern — itinerary is synchronous-collaborative). Optimistic state shape lifts from `PackingTab`. `DayCard` splits into `DayView` / `DayEditor` to sidestep React 19's `set-state-in-effect` lint (per `memory/feedback-react19-lint-gotchas.md`). Empty state ("No days planned yet — add the first one.") still renders the add row, so first-day-on-an-empty-trip is one click. Dreams unchanged (`DreamItineraryStub` still renders for dateless trips — Slice B's job). Date-range validation deliberately skipped. Spec: `docs/superpowers/specs/2026-05-28-phase-4-6-itinerary-editing-design.md`. Plan: `docs/superpowers/plans/2026-05-28-phase-4-6-itinerary-editing.md`.

### Carried into the next slices (post-trip)
- **Slice B — Itinerary for dreams** (numbered days 1, 2, 3…). Real schema decision: relax `itinerary_days.day_date NOT NULL` and add a `day_index int` column (single-table option), or add a parallel `dream_itinerary` sub-table (two-table option). Brainstorm separately; pick after the Lombok trip surfaces whether numbered days is even the right frame for dreams.
- **Slice C — Drag to reschedule.** Visual drag of a day from one date (or numbered position, post Slice B) to another. Needs a drag library (`@dnd-kit/sortable` is the standard in 2026 — no drag library in the project yet). Open semantic: when the target date is occupied, swap dates atomically or refuse with a friendly error. Brainstorm separately; depends on Slice B for the dream case.
- **Date-range validation for itinerary days** (must fall within trip `start_date`…`end_date`). One-line addition to `addItineraryDay` / `updateItineraryDay` validation when typos start hurting.

## Phase 3.5 — Basic CRUD (do one at a time)
```

- [ ] **Step 3: Remove "itinerary editing" from the Backlog section**

Find this bullet in the `## Backlog (post-Lombok-trip, not yet phased)` section:

```
### Itinerary editing (real trips)
- **Add / edit / delete itinerary days from the UI.** `PLAN.md:22` lists "richer itinerary editing" as a Phase 4 candidate. Currently `itinerary_days` rows exist only via the Phase 3 SQL seed — the timeline is read-only from the user's perspective. Shape: `+ add day` button at the bottom of the timeline, click-to-edit on each card (title/sub/tag/tone fields), `×` to delete with native confirm. Three new Server Actions following the trip-notes pattern. **Separate from** the carried "Itinerary support for dreams" item (which is about extending `itinerary_days` to dateless rows, not about adding an editing UI).
```

Delete the entire `### Itinerary editing (real trips)` subsection (heading + bullet). It shipped — Slice B and C are now tracked under Phase 4.6's carried list above.

- [ ] **Step 4: Append 5 rows to `DECISIONS.md`**

In `docs/DECISIONS.md`, find the last existing row (the "NoteView / NoteEditor split components" row dated 2026-05-28). Append these five rows after it:

```markdown
| **Realtime channel for `itinerary_days`** (opposite call from `trip_notes`) | Itinerary is synchronous-collaborative — the kitchen-table case of one partner drafting a day while the other watches, especially the night before a trip. Notes are async (jotting stuff over weeks). Worth the WebSocket here even though we skipped it for notes. Matches the packing pattern's rationale. | 2026-05-28 |
| **`day_date` editable with `23505` collision translation** | Symmetric add/edit form shape (no asymmetric "date is fixed once created" UX). When a renamed day collides with an existing date, return "Another day already uses that date." Mirrors the slug-rename pattern in `updateTrip`. | 2026-05-28 |
| **No date-range validation in v1** for itinerary days | Skipped per brainstorming — typo'd dates outside `trip.start_date … trip.end_date` go through silently. YAGNI applied; one-line addition to the action's validation block when it starts hurting. | 2026-05-28 |
| **Tone-as-pills, tag-as-free-text** on the day form | Pills for the bounded 4-value `ITINERARY_TONES` enum (radio-style with colored dot prefix); free-text input for the open-ended one-word `tag` label (`ARRIVE`, `SURF`, `ADVENTURE`, ...). Same shape as the `paid_by` toggle in `LogExpenseRow` for the bounded case. | 2026-05-28 |
| **`SuggestionCard` moves into `ItineraryTab`** instead of being deleted with the old `ItineraryView` | The Phase 3 step 10 moss-bordered card is Phase 5's AI surface anchor. Deleting it now would force a re-add when Phase 5 ships; keeping it inside the new tab preserves the location users will expect. | 2026-05-28 |
```

- [ ] **Step 5: Verify the docs edits**

Run: `git diff docs/TODO.md docs/DECISIONS.md`

Confirm:
- `TODO.md`: Current Phase header now leads with Phase 4.6 (Phase 4.5 line preserved, no longer has the user-action call). New `## Phase 4.6 — Itinerary Editing (dated trips)` section added between the Phase 4.5 carried subsection and Phase 3.5. New "Carried into the next slices (post-trip)" subsection lists Slice B, Slice C, and the date-range-validation follow-up. The `### Itinerary editing (real trips)` subsection in Backlog is gone.
- `DECISIONS.md`: 5 new rows appended, each ending with `| 2026-05-28 |`.

- [ ] **Step 6: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: phase 4.6 itinerary-editing slice complete"
```

---

## Self-review checklist (already done during plan-writing)

- **Spec coverage:** every section of the spec maps to a task.
  - Spec § "Schema" (Realtime publication migration) → Task 1
  - Spec § "Server Actions" (`addItineraryDay` / `updateItineraryDay` / `deleteItineraryDay`) → Task 2 steps 3-5
  - Spec § "Query layer" (extend `ItineraryDay`, add `ITINERARY_TONES`, `rowToItineraryDay`, `withOrdinals`) → Task 2 step 1
  - Spec § "UI / Tab integration" (TabId already includes itinerary; rewire render switch) → Task 3 steps 2-5
  - Spec § "UI / `ItineraryTab` component" → Task 3 step 1
  - Spec § "Optimistic state + Realtime" → Task 3 step 1 (channel subscription + `withOrdinals` reconciliation in the `ItineraryTab` `useEffect`)
  - Spec § "Integration with `page.tsx`" → Task 3 steps 2-5
  - Spec § "Decisions worth a row" → Task 4 step 4

- **Placeholder scan:** every step has concrete code or commands. The conditional in Task 3 step 7 ("if the migration is applied") matches the project's manual-migration pattern — unavoidable and consistent with prior plans.

- **Type consistency:**
  - `ItineraryDay` shape (Task 2 step 1: gains `id` + `dayDate`) matches the editor's pre-fill (`day.id`, `day.dayDate`) in Task 3 step 1.
  - `ItineraryTone` literal `("sea" | "clay" | "moss" | "sand")` derives from `ITINERARY_TONES` (`as const`) — same source-of-truth for the validation block in actions and the pill picker in the UI.
  - `AddItineraryDayInput.dayDate` / `tag` / `title` / `sub` / `tone` (Task 2 step 3) ≡ the form field names in `DayForm` (Task 3 step 1) ≡ the destructured props passed by `AddDayRow.submit` / `DayEditor.save` (Task 3 step 1).
  - `deleteItineraryDay(dayId, tripSlug)` signature (Task 2 step 5) ≡ `deleteItineraryDay.bind(null, day.id, tripSlug)` in `DayView` (Task 3 step 1).

- **Spec deviations / in-flight refinements:**
  - The spec described `rowToItineraryDay(row, index)` and `withOrdinals(days)` separately; the plan settles on `rowToItineraryDay(row)` (single-arg, placeholder `d`) + `withOrdinals(days)` doing the sort + pad. Same outcome, cleaner factoring for the action's single-row return path.
  - `AddDayRow` `useEffect` for resyncing `defaultDate` is called out as the likely React 19 lint trigger in Task 3 step 6; the fallback (delete the effect, rely on `reset()`) is given.

