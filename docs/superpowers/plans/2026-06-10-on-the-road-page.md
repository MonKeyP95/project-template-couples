# On the Road Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third top-level page, `/on-the-road`, that wakes up only during an active trip and concentrates today's itinerary, a quick add-expense, today's spend, a quick note jot, and a one-glance look-ahead into a single "living it" surface.

**Architecture:** A server component at `src/app/on-the-road/page.tsx` detects the active ("now") trip via the existing `listTripsForWorkspace` buckets and redirects to `/home` when none is active. It loads today's itinerary day, all days, locations, expenses, categories, and today's notes, then composes small section components. Two client components (quick-expense, quick-note) call existing Server Actions and `router.refresh()`. One additive migration adds `day_date` to `trip_notes`. Pure look-ahead logic lives in `src/lib/trips/looking-ahead.ts`.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), React 19, Tailwind v4, Supabase (Postgres + RLS). No test runner exists in this repo (see CLAUDE.md), so each task is verified with `pnpm lint`, `pnpm build`, and — where visual — looking at the page in the browser.

---

## Notes for the implementer

- **No test command.** Do not invent one. Verification per task = `pnpm lint` (clean) + `pnpm build` (succeeds), plus a browser look for visual tasks.
- **Migrations are applied by hand.** SQL files are pasted into the Supabase SQL editor; committing/restarting does nothing to the DB. The migration task includes that manual step explicitly.
- **"Today" is the UTC date** `new Date().toISOString().slice(0, 10)`, matching `list-queries.ts` / `home/page.tsx`. Stay consistent so trip-state detection and this page agree.
- **Dates display day-before-month** (`en-GB`). Reuse `formatShortDate` (produces "12 Jun"); never `en-US`.
- **Design decision to flag at review:** the spec says the user should "auto-land" on this page during a trip. The app currently has **no persistent nav bar**, and force-redirecting `/home` → `/on-the-road` would make Home unreachable. This plan instead adds a prominent entry **banner on Home** (Task 10) plus a back link on the page, and the route self-guards. A forced redirect can come later once a real nav exists.

---

## File map

- **Create:** `supabase/migrations/20260610000004_trip_note_day.sql` — adds `day_date` to `trip_notes`.
- **Modify:** `src/lib/trips/note-queries.ts` — add `day_date` to the row type/mapping; add `getNotesForDay`.
- **Modify:** `src/lib/trips/actions.ts` — extend `AddNoteInput` + `addNote` to accept/insert `dayDate`.
- **Create:** `src/lib/trips/looking-ahead.ts` — pure look-ahead computation (tomorrow's first event + next move).
- **Create:** `src/app/on-the-road/page.tsx` — the route (server component, data loading, redirect guard, composition).
- **Create:** `src/app/on-the-road/quick-expense.tsx` — client; amount + category + name; calls `logExpense` with `dayDate = today`.
- **Create:** `src/app/on-the-road/quick-note.tsx` — client; one-line jot; calls `addNote` with `dayDate = today`.
- **Create:** `src/app/on-the-road/looking-ahead-panel.tsx` — presentational; renders the look-ahead result.
- **Modify:** `src/app/home/page.tsx` — entry banner to `/on-the-road` when a trip is active.
- **Modify:** `docs/TODO.md`, `docs/DECISIONS.md` — record the work.

---

## Task 1: Migration — `day_date` on `trip_notes`

**Files:**
- Create: `supabase/migrations/20260610000004_trip_note_day.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Day-filed notes: a trip_note can be tagged to a specific day, mirroring
-- expenses.day_date. Nullable; null = a general (un-dated) note, unchanged
-- behaviour. The On the Road page jots notes tagged to today.
-- No RLS change: existing trip_notes policies gate by trip via
-- is_trip_workspace_member().
-- Idempotent: safe to paste-and-run multiple times.

alter table public.trip_notes
  add column if not exists day_date date;

create index if not exists trip_notes_trip_day_idx
  on public.trip_notes (trip_id, day_date);
```

- [ ] **Step 2: Apply it manually**

Paste the file's contents into the Supabase SQL editor and run. Confirm `trip_notes` now has a `day_date` column (Table editor, or re-run — it should succeed with no error).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260610000004_trip_note_day.sql
git commit -m "feat(db): add day_date to trip_notes for day-filed notes"
```

---

## Task 2: Note layer — carry and query `day_date`

**Files:**
- Modify: `src/lib/trips/note-queries.ts`
- Modify: `src/lib/trips/actions.ts:842` (`AddNoteInput`) and `:861` (`addNote`)

- [ ] **Step 1: Add `dayDate` to the note type and row mapping**

In `src/lib/trips/note-queries.ts`, add the field to `TripNote`, `TripNoteRow`, and `rowToNote`, and select it in `getTripNotes`. Then append a `getNotesForDay` query. Full file after edit:

```ts
import { createClient } from "@/lib/supabase/server"

export interface TripNote {
  id: string
  tripId: string
  body: string
  locationId: string | null
  dayDate: string | null
  createdBy: string
  /** ISO timestamptz from Postgres. */
  createdAt: string
  updatedAt: string
}

interface TripNoteRow {
  id: string
  trip_id: string
  body: string
  location_id: string | null
  day_date: string | null
  created_by: string
  created_at: string
  updated_at: string
}

function rowToNote(r: TripNoteRow): TripNote {
  return {
    id: r.id,
    tripId: r.trip_id,
    body: r.body,
    locationId: r.location_id,
    dayDate: r.day_date,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const NOTE_COLS =
  "id, trip_id, body, location_id, day_date, created_by, created_at, updated_at"

export async function getTripNotes(tripId: string): Promise<TripNote[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("trip_notes")
    .select(NOTE_COLS)
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .returns<TripNoteRow[]>()
  if (error) throw new Error(error.message)
  return (data ?? []).map(rowToNote)
}

/** Notes tagged to a specific day (yyyy-mm-dd), newest first. */
export async function getNotesForDay(
  tripId: string,
  dayDate: string,
): Promise<TripNote[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("trip_notes")
    .select(NOTE_COLS)
    .eq("trip_id", tripId)
    .eq("day_date", dayDate)
    .order("created_at", { ascending: false })
    .returns<TripNoteRow[]>()
  if (error) throw new Error(error.message)
  return (data ?? []).map(rowToNote)
}

export { rowToNote }
```

- [ ] **Step 2: Extend `AddNoteInput` and `addNote` to accept `dayDate`**

In `src/lib/trips/actions.ts`, change `AddNoteInput` (around line 842) to add an optional `dayDate`:

```ts
export interface AddNoteInput {
  tripId: string
  tripSlug: string
  body: string
  /** Location to file the note under; null/undefined = General (no location). */
  locationId?: string | null
  /** Day (yyyy-mm-dd) to tag the note to; null/undefined = un-dated. */
  dayDate?: string | null
}
```

Then in `addNote` (around line 871), include `day_date` in the insert:

```ts
  const { data, error } = await supabase
    .from("trip_notes")
    .insert({
      trip_id: input.tripId,
      body,
      location_id: input.locationId ?? null,
      day_date: input.dayDate ?? null,
      created_by: userData.user.id,
    })
    .select(
      "id, trip_id, body, location_id, day_date, created_by, created_at, updated_at",
    )
    .single()
```

- [ ] **Step 3: Verify lint + build**

Run: `pnpm lint`
Expected: no errors.
Run: `pnpm build`
Expected: build succeeds (the changed `.select(...)` column list and new field compile cleanly).

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/note-queries.ts src/lib/trips/actions.ts
git commit -m "feat(notes): carry day_date through note query + addNote action"
```

---

## Task 3: Pure look-ahead logic

**Files:**
- Create: `src/lib/trips/looking-ahead.ts`

Computes two things from the day list: tomorrow's first timed event (falling back to tomorrow's title) and the next location change ("next move"). Pure and self-contained so it is easy to reason about.

- [ ] **Step 1: Write the helper**

```ts
import type { ItineraryDay, ItineraryEvent } from "./itinerary-types"
import type { ItineraryLocation } from "./location-types"

/** yyyy-mm-dd for `today` + n days, UTC. */
function addDays(today: string, n: number): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Whole days from `a` to `b` (both yyyy-mm-dd), UTC. */
function daysBetween(a: string, b: string): number {
  const ms =
    new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()
  return Math.round(ms / 86_400_000)
}

/** Tomorrow's first timed event (sorted by time), or null when none. */
function firstTimedEvent(day: ItineraryDay | undefined): ItineraryEvent | null {
  if (!day) return null
  const timed = day.events
    .filter((e) => e.time)
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
  return timed[0] ?? null
}

export interface LookingAhead {
  /** Tomorrow's first event, or null. */
  tomorrowEvent: ItineraryEvent | null
  /** Tomorrow's day title when there's no timed event; null when no day. */
  tomorrowTitle: string | null
  /** Next location change after today, or null when the trip doesn't move again. */
  nextMove: { locationName: string; date: string; daysAway: number } | null
  /** True when tomorrow IS the next move day (collapse to one line). */
  collapse: boolean
}

/**
 * Tomorrow + next-move look-ahead for the On the Road page.
 * `today` is yyyy-mm-dd. `days` is the full ascending day list; `locations`
 * supplies move destination names. A "move" is the first future day whose
 * locationId differs from today's.
 */
export function computeLookingAhead(
  today: string,
  currentLocationId: string | null,
  days: ItineraryDay[],
  locations: ItineraryLocation[],
): LookingAhead {
  const tomorrowDate = addDays(today, 1)
  const tomorrowDay = days.find((d) => d.dayDate === tomorrowDate)
  const tomorrowEvent = firstTimedEvent(tomorrowDay)

  const moveDay = days
    .filter(
      (d) =>
        d.dayDate > today &&
        d.locationId != null &&
        d.locationId !== currentLocationId,
    )
    .sort((a, b) => (a.dayDate < b.dayDate ? -1 : 1))[0]

  const nextMove = moveDay
    ? {
        locationName:
          locations.find((l) => l.id === moveDay.locationId)?.name ?? "next stop",
        date: moveDay.dayDate,
        daysAway: daysBetween(today, moveDay.dayDate),
      }
    : null

  return {
    tomorrowEvent,
    tomorrowTitle: tomorrowEvent ? null : tomorrowDay?.title ?? null,
    nextMove,
    collapse: !!moveDay && moveDay.dayDate === tomorrowDate,
  }
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint`
Expected: no errors.
Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/looking-ahead.ts
git commit -m "feat(itinerary): pure look-ahead (tomorrow + next move) helper"
```

---

## Task 4: Route scaffold with active-trip guard

**Files:**
- Create: `src/app/on-the-road/page.tsx`

First a minimal version: auth, find the active trip, redirect when there is none, render a day header. Sections are added in later tasks.

- [ ] **Step 1: Write the page**

```tsx
import { redirect } from "next/navigation"

import { Coord, Label, TopoBg } from "@/components/together"
import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import { getTodayForTrip } from "@/lib/trips/itinerary-queries"
import { getItineraryLocations } from "@/lib/trips/location-queries"
import { slugToTone } from "@/lib/trips/slug-tone"
import { formatShortDate } from "@/lib/trips/itinerary-types"
import { dayWithinTrip } from "@/app/home/format-helpers"

export default async function OnTheRoadPage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/on-the-road")

  const workspace = await getCurrentWorkspace()
  if (!workspace) redirect("/home")

  const buckets = await listTripsForWorkspace(workspace.id)
  const trip = buckets.now[0]
  if (!trip) redirect("/home")

  const today = new Date().toISOString().slice(0, 10)
  const todayDay = await getTodayForTrip(trip.id, today)
  const locations = await getItineraryLocations(trip.id)
  const tone = slugToTone(trip.slug)

  const dayCount = dayWithinTrip(trip.startDate, trip.endDate)
  const locationName = todayDay?.locationId
    ? locations.find((l) => l.id === todayDay.locationId)?.name ?? null
    : null
  const place = locationName ?? trip.country ?? "On the road"

  return (
    <main className="mx-auto min-h-screen w-full max-w-[440px] px-5 pt-12 pb-16 md:max-w-[560px] md:px-8">
      <header className="mb-6 flex items-center justify-between">
        <Label>{`On the road · ${trip.name}`}</Label>
        <a
          href="/home"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          home
        </a>
      </header>

      <section className="relative overflow-hidden rounded-[14px] border border-border bg-card p-5">
        <TopoBg tone={tone} opacity={0.12} />
        <div className="relative">
          <div className="flex items-center justify-between">
            <Coord>{formatShortDate(today)}</Coord>
            {dayCount ? (
              <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
                day {dayCount.day} / {dayCount.total}
              </span>
            ) : null}
          </div>
          <div className="t-display mt-2 text-[36px] leading-none text-foreground">
            <em>{place}</em>
          </div>
        </div>
      </section>
    </main>
  )
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint` then `pnpm build`
Expected: both clean. (Confirms imports — `slugToTone`, `formatShortDate`, `dayWithinTrip`, `getItineraryLocations` — all resolve.)

- [ ] **Step 3: Look at it**

Run: `pnpm dev`, open `http://localhost:3000/on-the-road`.
Expected: during an active trip (Lombok seed if its dates contain today) you see the day header; with no active trip you are redirected to `/home`.
(If `pnpm dev` panics with `0xc0000142` on Windows, stop, delete `.next/`, restart — known flake, not a code bug.)

- [ ] **Step 4: Commit**

```bash
git add src/app/on-the-road/page.tsx
git commit -m "feat(on-the-road): route scaffold with active-trip guard + day header"
```

---

## Task 5: Today's plan + weather

**Files:**
- Modify: `src/app/on-the-road/page.tsx`

Add weather to the header and a "today's plan" block reusing `daySummary` and the home hero's `TodayNextEvent`.

- [ ] **Step 1: Add imports**

At the top of `src/app/on-the-road/page.tsx` add:

```tsx
import { daySummary } from "@/lib/trips/itinerary-types"
import { getWeather } from "@/lib/weather/get-weather"
import { TodayNextEvent } from "@/app/home/today-next-event"
```

- [ ] **Step 2: Load weather after `todayDay`**

```tsx
  const weather =
    trip.lat != null && trip.lng != null
      ? await getWeather(trip.lat, trip.lng)
      : null
```

- [ ] **Step 3: Show the temperature in the header**

Replace the `<Coord>{formatShortDate(today)}</Coord>` line with:

```tsx
            <div className="flex items-center gap-2">
              <Coord>{formatShortDate(today)}</Coord>
              {weather ? (
                <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
                  {Math.round(weather.tempC)}°
                </span>
              ) : null}
            </div>
```

- [ ] **Step 4: Add the today's-plan block after the header `</section>`**

```tsx
      <section className="mt-4 rounded-[14px] border border-border bg-card p-5">
        <Label>Today</Label>
        {todayDay ? (
          <>
            <div className="t-display mt-2 text-[24px] leading-tight text-foreground">
              {todayDay.title}
            </div>
            {daySummary(todayDay) ? (
              <div className="mt-1 text-[13px] leading-snug text-muted-foreground">
                {daySummary(todayDay)}
              </div>
            ) : null}
            <TodayNextEvent events={todayDay.events} />
          </>
        ) : (
          <div className="mt-2 text-[13px] text-muted-foreground">
            Nothing planned for today.
          </div>
        )}
      </section>
```

- [ ] **Step 5: Verify lint + build, then look**

Run: `pnpm lint` then `pnpm build` (clean). Reload `/on-the-road`: today's title, summary, and the next/last event line appear; temperature shows in the header.

- [ ] **Step 6: Commit**

```bash
git add src/app/on-the-road/page.tsx
git commit -m "feat(on-the-road): today's plan block + weather in header"
```

---

## Task 6: Quick add expense

**Files:**
- Create: `src/app/on-the-road/quick-expense.tsx`
- Modify: `src/app/on-the-road/page.tsx`

A compact client form — amount, category, name — that logs an expense tagged to today, paid by the current user, then refreshes.

- [ ] **Step 1: Write the client component**

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { logExpense } from "@/lib/trips/actions"
import { Label } from "@/components/together"
import type { ExpenseCategoryRow } from "@/lib/trips/expense-types"

export interface QuickExpenseProps {
  tripId: string
  tripSlug: string
  today: string
  currentUserId: string
  categories: ExpenseCategoryRow[]
}

export function QuickExpense({
  tripId,
  tripSlug,
  today,
  currentUserId,
  categories,
}: QuickExpenseProps) {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [amount, setAmount] = React.useState("")
  const [category, setCategory] = React.useState(categories[0]?.name ?? "")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const canSubmit =
    name.trim().length > 0 &&
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !canSubmit) return
    startTransition(async () => {
      const result = await logExpense({
        tripId,
        tripSlug,
        title: name.trim(),
        amount,
        category,
        paidBy: currentUserId,
        dayDate: today,
        locationId: null,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setName("")
      setAmount("")
      setError(null)
      router.refresh()
    })
  }

  return (
    <section className="mt-4 rounded-[14px] border border-border bg-card p-5">
      <Label>Quick expense</Label>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2.5">
        <div className="flex gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            disabled={isPending}
            className="w-24 rounded-lg border border-border bg-background px-3 py-2 font-mono text-[14px] text-foreground"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="what for?"
            disabled={isPending}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={isPending}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={isPending || !canSubmit}
            className="rounded-full border-0 bg-foreground px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
          >
            {isPending ? "…" : "add"}
          </button>
        </div>
        {error ? (
          <div className="font-mono text-[10px] text-clay">{error}</div>
        ) : null}
      </form>
    </section>
  )
}
```

- [ ] **Step 2: Load categories + user id in the page and render it**

In `src/app/on-the-road/page.tsx` add the import:

```tsx
import { getTripExpenseCategories } from "@/lib/trips/expense-queries"
import { QuickExpense } from "./quick-expense"
```

After the locations load, add:

```tsx
  const categories = await getTripExpenseCategories(trip.id)
```

Then render after the today's-plan section:

```tsx
      <QuickExpense
        tripId={trip.id}
        tripSlug={trip.slug}
        today={today}
        currentUserId={userData.user.id}
        categories={categories}
      />
```

- [ ] **Step 3: Verify lint + build, then look**

Run: `pnpm lint` then `pnpm build` (clean). On `/on-the-road`, enter an amount + name, pick a category, press add. The form clears; opening the trip's Budget tab shows the new expense dated today.

- [ ] **Step 4: Commit**

```bash
git add src/app/on-the-road/quick-expense.tsx src/app/on-the-road/page.tsx
git commit -m "feat(on-the-road): quick add-expense tagged to today"
```

---

## Task 7: Today's spend total

**Files:**
- Modify: `src/app/on-the-road/page.tsx`

- [ ] **Step 1: Load expenses and sum today's**

Add the import:

```tsx
import { getTripExpenses } from "@/lib/trips/expense-queries"
```

After `categories`:

```tsx
  const expenses = await getTripExpenses(trip.id)
  const spentTodayCents = expenses
    .filter((e) => !e.isSettlement && e.dayDate === today)
    .reduce((sum, e) => sum + e.amountCents, 0)
```

- [ ] **Step 2: Show it inside the Quick expense section header**

Pass the total into `QuickExpense` by adding a prop. In `quick-expense.tsx`, extend `QuickExpenseProps` with `spentTodayCents: number` and change the `<Label>` line to:

```tsx
      <div className="flex items-baseline justify-between">
        <Label>Quick expense</Label>
        <span className="t-num text-[13px] text-muted-foreground">
          €{(spentTodayCents / 100).toFixed(2)} today
        </span>
      </div>
```

Add `spentTodayCents` to the destructured props. In `page.tsx`, pass `spentTodayCents={spentTodayCents}`.

- [ ] **Step 3: Verify lint + build, then look**

Run: `pnpm lint` then `pnpm build` (clean). The "€X today" total reflects expenses added via the quick form and updates after `router.refresh()`.

- [ ] **Step 4: Commit**

```bash
git add src/app/on-the-road/page.tsx src/app/on-the-road/quick-expense.tsx
git commit -m "feat(on-the-road): show today's spend total"
```

---

## Task 8: Quick note jot

**Files:**
- Create: `src/app/on-the-road/quick-note.tsx`
- Modify: `src/app/on-the-road/page.tsx`

A one-line jot that files a note tagged to today and lists today's notes.

- [ ] **Step 1: Write the client component**

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { addNote } from "@/lib/trips/actions"
import { Label } from "@/components/together"
import type { TripNote } from "@/lib/trips/note-queries"

export interface QuickNoteProps {
  tripId: string
  tripSlug: string
  today: string
  notes: TripNote[]
}

export function QuickNote({ tripId, tripSlug, today, notes }: QuickNoteProps) {
  const router = useRouter()
  const [body, setBody] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isPending || !body.trim()) return
    startTransition(async () => {
      const result = await addNote({
        tripId,
        tripSlug,
        body: body.trim(),
        dayDate: today,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setBody("")
      setError(null)
      router.refresh()
    })
  }

  return (
    <section className="mt-4 rounded-[14px] border border-border bg-card p-5">
      <Label>Jot</Label>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="note to remember today…"
          disabled={isPending}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground"
        />
        <button
          type="submit"
          disabled={isPending || !body.trim()}
          className="rounded-full border-0 bg-foreground px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : "save"}
        </button>
      </form>
      {error ? (
        <div className="mt-2 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
      {notes.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {notes.map((n) => (
            <li key={n.id} className="text-[13px] leading-snug text-foreground">
              {n.body}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
```

- [ ] **Step 2: Load today's notes and render**

In `page.tsx` add the imports:

```tsx
import { getNotesForDay } from "@/lib/trips/note-queries"
import { QuickNote } from "./quick-note"
```

After `expenses`:

```tsx
  const notes = await getNotesForDay(trip.id, today)
```

Render after the `QuickExpense`:

```tsx
      <QuickNote
        tripId={trip.id}
        tripSlug={trip.slug}
        today={today}
        notes={notes}
      />
```

- [ ] **Step 3: Verify lint + build, then look**

Run: `pnpm lint` then `pnpm build` (clean). Jot a note on `/on-the-road`; it clears, appears in the list, and shows in the trip's Notes tab.

- [ ] **Step 4: Commit**

```bash
git add src/app/on-the-road/quick-note.tsx src/app/on-the-road/page.tsx
git commit -m "feat(on-the-road): quick note jot tagged to today"
```

---

## Task 9: Looking ahead panel

**Files:**
- Create: `src/app/on-the-road/looking-ahead-panel.tsx`
- Modify: `src/app/on-the-road/page.tsx`

- [ ] **Step 1: Write the panel**

```tsx
import { Label } from "@/components/together"
import { formatShortDate } from "@/lib/trips/itinerary-types"
import type { LookingAhead } from "@/lib/trips/looking-ahead"

/** Renders the tomorrow + next-move look-ahead. Nothing to show => null. */
export function LookingAheadPanel({ ahead }: { ahead: LookingAhead }) {
  const tomorrowText = ahead.tomorrowEvent
    ? `${ahead.tomorrowEvent.time} · ${ahead.tomorrowEvent.text}`
    : ahead.tomorrowTitle
  const hasTomorrow = !ahead.collapse && !!tomorrowText
  const hasMove = !!ahead.nextMove
  if (!hasTomorrow && !hasMove) return null

  return (
    <section className="mt-4 rounded-[14px] border border-border bg-card p-5">
      <Label>Looking ahead</Label>
      <div className="mt-3 flex flex-col gap-2">
        {hasTomorrow ? (
          <Line head="tomorrow" body={tomorrowText as string} />
        ) : null}
        {ahead.nextMove ? (
          <Line
            head={
              ahead.nextMove.daysAway === 1
                ? "next move · tomorrow"
                : `next move · in ${ahead.nextMove.daysAway} days`
            }
            body={`${ahead.nextMove.locationName} · ${formatShortDate(
              ahead.nextMove.date,
            )}`}
          />
        ) : null}
      </div>
    </section>
  )
}

function Line({ head, body }: { head: string; body: string }) {
  return (
    <div className="font-mono text-[12.5px] tracking-[0.04em] text-muted-foreground">
      <span className="uppercase tracking-[0.14em] text-foreground/70">
        {head}
      </span>{" "}
      <span className="text-foreground">{body}</span>
    </div>
  )
}
```

- [ ] **Step 2: Compute and render in the page**

In `page.tsx` add the imports:

```tsx
import { computeLookingAhead } from "@/lib/trips/looking-ahead"
import { getItineraryDays } from "@/lib/trips/itinerary-queries"
import { LookingAheadPanel } from "./looking-ahead-panel"
```

After `notes`:

```tsx
  const days = await getItineraryDays(trip.id)
  const ahead = computeLookingAhead(
    today,
    todayDay?.locationId ?? null,
    days,
    locations,
  )
```

Render last, before the closing `</main>`:

```tsx
      <LookingAheadPanel ahead={ahead} />
```

- [ ] **Step 3: Verify lint + build, then look**

Run: `pnpm lint` then `pnpm build` (clean). On `/on-the-road` the "Looking ahead" block shows tomorrow's first event (or title) and the next move with its countdown; when tomorrow IS the move day it collapses to the single move line.

- [ ] **Step 4: Commit**

```bash
git add src/app/on-the-road/looking-ahead-panel.tsx src/app/on-the-road/page.tsx
git commit -m "feat(on-the-road): looking-ahead panel (tomorrow + next move)"
```

---

## Task 10: Home entry banner

**Files:**
- Modify: `src/app/home/page.tsx`

Surface the page from Home when a trip is active (the "auto-land" stand-in until a persistent nav exists).

- [ ] **Step 1: Add the banner above the hero section**

In `src/app/home/page.tsx`, inside the `{youOnly ? (...) : ( <> ... )}` branch, immediately before the `{hero ? (` section, add:

```tsx
          {buckets.now[0] ? (
            <Link
              href="/on-the-road"
              className="mb-3 flex items-center justify-between rounded-[12px] border border-border bg-card px-4 py-3.5 shadow-sm transition-shadow md:hover:shadow-md"
            >
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground">
                {`On the road · ${buckets.now[0].name}`}
              </span>
              <Chevron />
            </Link>
          ) : null}
```

(`Link` and `Chevron` are already imported in this file.)

- [ ] **Step 2: Verify lint + build, then look**

Run: `pnpm lint` then `pnpm build` (clean). On `/home` during an active trip, the banner appears at the top of the trips area and links to `/on-the-road`; with no active trip it is absent.

- [ ] **Step 3: Commit**

```bash
git add src/app/home/page.tsx
git commit -m "feat(home): on-the-road entry banner during an active trip"
```

---

## Task 11: Docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Update `docs/TODO.md`**

Add a short entry under the current phase recording that the On the Road page shipped (route `/on-the-road`, active-trip only, today's plan + quick expense + today's spend + quick note + look-ahead, `trip_notes.day_date` migration).

- [ ] **Step 2: Append a row to `docs/DECISIONS.md`**

Record the non-obvious choice: *On the Road is gated to the active ("now") trip and reached via a Home banner + self-guarding route rather than a forced redirect, because the app has no persistent nav and redirecting Home would make it unreachable.*

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record On the Road page + day_date decision"
```

---

## Self-review checklist (done while writing)

- **Spec coverage:** activation rule (Task 4 guard + Task 10 banner), day header + weather (Tasks 4–5), today's plan (Task 5), quick add expense (Task 6), today's spend (Task 7), quick note jot (Tasks 1–2, 8), look-ahead with tomorrow's first-event-with-time + next move + collapse (Tasks 3, 9), single additive migration (Task 1), route `/on-the-road` (Task 4). All covered.
- **Auto-advance:** handled by `TodayNextEvent` (falls back to "last" once events pass) and the date being the real UTC day; no extra task needed.
- **Type consistency:** `LookingAhead`, `computeLookingAhead`, `getNotesForDay`, `AddNoteInput.dayDate`, `QuickExpenseProps.spentTodayCents` are defined where first used and consumed with the same names.
- **No placeholders:** every code step is complete.

