# Shareable Trip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a couple flip one toggle to publish a trip as a public, read-only, link-shareable itinerary, and let anyone who opens that link copy it into their own workspace as a new dated trip.

**Architecture:** Add a share handle (`share_token`, `is_public`, `shared_at`) to `trips` plus one read-only `security definer` projection function `shared_trip(token)` that returns a safe JSON view (no dates/budget/members). A public route `/t/[token]` renders that JSON for anyone, logged in or not. Copying is plain TypeScript in a Server Action — it reads the projection then inserts a new trip under the caller's own RLS, so there is no privileged write path.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), `@supabase/ssr`, Postgres + RLS, Tailwind v4, the project's `@/components/together` + `@/components/ui` primitives.

## Global Constraints

- **No test harness exists.** Do not invent `pnpm test`. Each task is verified by `pnpm lint`, `pnpm build`, pasting SQL into the Supabase SQL editor by hand, and looking at the result in the browser. (Project rule: `docs/TODO.md` / CLAUDE.md.)
- **Migrations are applied manually.** SQL files under `supabase/migrations/` are pasted into the Supabase SQL editor by hand; committing/restarting dev does nothing to the DB.
- **Migrations must be idempotent** — safe to paste-and-run repeatedly: `add column if not exists`, `create or replace function`, `drop policy if exists` then create, repeatable `grant`.
- **No emojis** in code, comments, or copy.
- **Sparse comments**; prefer clear names. Comment only non-obvious WHY.
- **European date order** for any displayed date: `en-GB`, never `en-US`. (The public view shows "Day 1" labels, not calendar dates, so this mostly bites in the copy start-date input.)
- **Client/server split:** any `"use client"` file imports types/helpers from `*-types.ts`, never from `*-queries.ts` (which pulls `next/headers`).
- **Button has no `asChild`;** style a `Link` as a button via `buttonVariants(...)` from `@/components/ui/button`.
- **Short modules, short functions.** Don't over-engineer; no defensive code for impossible cases.

---

## File Structure

- `supabase/migrations/2026MMDD000001_shareable_trip.sql` — **Create.** Columns on `trips` + `shared_trip(text)` RPC + grant. (Pick the date prefix at execution time, after today's latest migration.)
- `src/lib/trips/shared-trip-types.ts` — **Create.** Pure types + row→view mappers for the projection. No `next/headers`.
- `src/lib/trips/shared-trip-queries.ts` — **Create.** `getSharedTrip(token)` — calls the RPC via the server client.
- `src/lib/trips/share-actions.ts` — **Create.** `shareTrip`, `unshareTrip`, `copySharedTrip` Server Actions.
- `src/app/t/[token]/page.tsx` — **Create.** Public read-only view (Server Component, no auth gate).
- `src/app/t/[token]/copy-cta.tsx` — **Create.** `"use client"` sticky CTA + start-date prompt that calls `copySharedTrip`.
- `src/components/share-trip-dialog.tsx` — **Create.** `"use client"` dialog with the publish toggle + link.
- `src/app/trips/[slug]/page.tsx` — **Modify.** Load `share` fields; render a "Share" entry + the dialog in `TripHeaderView`.

Each task below ends with an independently verifiable deliverable.

---

## Task 1: Migration — share columns + projection RPC

**Files:**
- Create: `supabase/migrations/2026MMDD000001_shareable_trip.sql`

**Interfaces:**
- Produces (DB): `trips.share_token text unique`, `trips.is_public boolean not null default false`, `trips.shared_at timestamptz`; and `public.shared_trip(p_token text) returns json`, granted to `anon, authenticated`.
- Consumes: existing `public.trips`, `public.itinerary_locations`, `public.itinerary_days`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/2026MMDD000001_shareable_trip.sql` (replace `2026MMDD` with a date prefix later than the newest existing migration, e.g. `20260625`):

```sql
-- Shareable trip: publish a trip as a public, read-only itinerary.
-- One read-only security-definer projection function is the ONLY thing anon
-- can touch; base tables stay closed. Copying needs no privileged write (the
-- copier inserts under their own RLS). Idempotent: safe to paste-and-run.

-- 1. Share handle on trips.
alter table public.trips
  add column if not exists share_token text,
  add column if not exists is_public boolean not null default false,
  add column if not exists shared_at timestamptz;

-- Unguessable token is the capability; unique so a lookup is unambiguous.
create unique index if not exists trips_share_token_key
  on public.trips (share_token)
  where share_token is not null;

-- 2. Safe projection. SECURITY DEFINER so it can read across RLS, but it only
-- ever selects itinerary skeleton fields: no day_date, no created_by, no member
-- join, and it never touches expenses/budget/savings tables. Returns null when
-- the token is unknown or the trip is not currently public.
create or replace function public.shared_trip(p_token text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'name', t.name,
    'country', t.country,
    'day_count', (
      select count(*) from public.itinerary_days d where d.trip_id = t.id
    ),
    'locations', coalesce((
      select json_agg(
        json_build_object('name', l.name, 'sort_order', l.sort_order)
        order by l.sort_order
      )
      from public.itinerary_locations l
      where l.trip_id = t.id
    ), '[]'::json),
    'days', coalesce((
      select json_agg(
        json_build_object(
          'ordinal', x.ordinal,
          'title', x.title,
          'tag', x.tag,
          'tone', x.tone,
          'location_name', x.location_name,
          'events', x.events
        )
        order by x.ordinal
      )
      from (
        select
          row_number() over (order by d.day_date) as ordinal,
          d.title,
          d.tag,
          d.tone,
          d.events,
          (select l.name from public.itinerary_locations l where l.id = d.location_id) as location_name
        from public.itinerary_days d
        where d.trip_id = t.id
      ) x
    ), '[]'::json)
  )
  from public.trips t
  where t.share_token = p_token
    and t.is_public = true;
$$;

-- Anyone (signed in or not) may read a shared projection; nothing else opens up.
grant execute on function public.shared_trip(text) to anon, authenticated;
```

- [ ] **Step 2: Apply it in Supabase**

Paste the whole file into the Supabase SQL editor and run it. Run it a second time to confirm idempotency — it must succeed with no error both times.

- [ ] **Step 3: Verify the projection by hand**

In the SQL editor, mark one existing trip public and call the function:

```sql
update public.trips set is_public = true, share_token = 'testtoken123', shared_at = now()
where slug = 'lombok';

select public.shared_trip('testtoken123');      -- expect a JSON object
select public.shared_trip('does-not-exist');    -- expect null
```

Expected: the first returns `{ "name": ..., "locations": [...], "days": [...] }` with **no** `day_date`/budget fields; the second returns `null`. Then revert the test row:

```sql
update public.trips set is_public = false, share_token = null, shared_at = null
where slug = 'lombok';
```

- [ ] **Step 4: Confirm anon cannot reach base tables**

Sanity-check that the only new public surface is the function (the projection), not the tables. In the SQL editor:

```sql
select has_function_privilege('anon', 'public.shared_trip(text)', 'execute'); -- true
select has_table_privilege('anon', 'public.trips', 'select');                 -- false
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/2026MMDD000001_shareable_trip.sql
git commit -m "feat(share): add trips share columns + shared_trip projection RPC"
```

---

## Task 2: Projection types + query

**Files:**
- Create: `src/lib/trips/shared-trip-types.ts`
- Create: `src/lib/trips/shared-trip-queries.ts`

**Interfaces:**
- Produces: `interface SharedTrip { name; country: string | null; dayCount: number; locations: SharedLocation[]; days: SharedDay[] }`, `interface SharedDay { ordinal: number; title: string; tag: string; tone: ItineraryTone; locationName: string | null; events: ItineraryEvent[] }`, `interface SharedLocation { name: string; sortOrder: number }`, mapper `jsonToSharedTrip(raw: unknown): SharedTrip | null`, and `async getSharedTrip(token: string): Promise<SharedTrip | null>`.
- Consumes: `ItineraryTone`, `ItineraryEvent` from `@/lib/trips/itinerary-types`; `createClient` from `@/lib/supabase/server`.

- [ ] **Step 1: Write the types + mapper**

Create `src/lib/trips/shared-trip-types.ts`:

```ts
import type { ItineraryEvent, ItineraryTone } from "@/lib/trips/itinerary-types"

export interface SharedLocation {
  name: string
  sortOrder: number
}

export interface SharedDay {
  /** 1-based position; the public view renders this as "Day 1". */
  ordinal: number
  title: string
  tag: string
  tone: ItineraryTone
  /** Location this day sits under; null = a travel/unfiled day. */
  locationName: string | null
  events: ItineraryEvent[]
}

export interface SharedTrip {
  name: string
  country: string | null
  dayCount: number
  locations: SharedLocation[]
  days: SharedDay[]
}

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

/** Shape the raw json from `shared_trip()` into a SharedTrip. Returns null when
 * the RPC returned null (unknown token / not public). Tolerates missing arrays. */
export function jsonToSharedTrip(raw: unknown): SharedTrip | null {
  if (raw === null || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  if (typeof o.name !== "string") return null

  const locations: SharedLocation[] = Array.isArray(o.locations)
    ? o.locations
        .filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null)
        .map((l) => ({
          name: typeof l.name === "string" ? l.name : "",
          sortOrder: typeof l.sort_order === "number" ? l.sort_order : 0,
        }))
    : []

  const days: SharedDay[] = Array.isArray(o.days)
    ? o.days
        .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
        .map((d) => ({
          ordinal: typeof d.ordinal === "number" ? d.ordinal : 0,
          title: typeof d.title === "string" ? d.title : "",
          tag: typeof d.tag === "string" ? d.tag : "",
          tone: (typeof d.tone === "string" ? d.tone : "sand") as ItineraryTone,
          locationName: typeof d.location_name === "string" ? d.location_name : null,
          events: parseEvents(d.events),
        }))
    : []

  return {
    name: o.name,
    country: typeof o.country === "string" ? o.country : null,
    dayCount: typeof o.day_count === "number" ? o.day_count : days.length,
    locations,
    days,
  }
}
```

- [ ] **Step 2: Write the query**

Create `src/lib/trips/shared-trip-queries.ts`:

```ts
import { createClient } from "@/lib/supabase/server"

import { jsonToSharedTrip, type SharedTrip } from "@/lib/trips/shared-trip-types"

/** Public projection of a shared trip, or null when the token is unknown or the
 * trip is not currently public. Works for anonymous visitors: the underlying
 * `shared_trip` RPC is granted to anon and runs security-definer. */
export async function getSharedTrip(token: string): Promise<SharedTrip | null> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("shared_trip", { p_token: token })
  return jsonToSharedTrip(data)
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `pnpm lint`
Expected: no errors in the two new files.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/shared-trip-types.ts src/lib/trips/shared-trip-queries.ts
git commit -m "feat(share): shared-trip projection types + query"
```

---

## Task 3: Public read-only view at `/t/[token]`

**Files:**
- Create: `src/app/t/[token]/page.tsx`

**Interfaces:**
- Consumes: `getSharedTrip` (Task 2), `SharedTrip`/`SharedDay`/`SharedLocation` types (Task 2), `@/components/together` primitives (`Label`, `TopoBg`, `WaveGlyph`).
- Produces: the route `/t/<token>`. The copy CTA is added in Task 5; this task renders the read-only plan only.

- [ ] **Step 1: Write the page**

Create `src/app/t/[token]/page.tsx`:

```tsx
import { Label, TopoBg, WaveGlyph } from "@/components/together"
import { getSharedTrip } from "@/lib/trips/shared-trip-queries"
import type { SharedDay, SharedTrip } from "@/lib/trips/shared-trip-types"

export default async function SharedTripPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const trip = await getSharedTrip(token)

  if (!trip) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="font-serif text-4xl tracking-tight">This trip isn&apos;t shared.</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The link may be turned off or incorrect.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="relative mx-auto min-h-screen w-full max-w-[440px] pb-24 lg:max-w-[760px]">
      <SharedHeader trip={trip} />
      <SharedBody trip={trip} />
    </main>
  )
}

function SharedHeader({ trip }: { trip: SharedTrip }) {
  return (
    <header className="relative overflow-hidden bg-sea-tint px-5 pt-12 pb-6 lg:px-10 lg:pt-14">
      <TopoBg tone="sea" opacity={0.18} />
      <Label>Shared trip</Label>
      <div className="relative mt-1 flex items-baseline gap-4">
        <h1 className="t-display text-[56px] text-foreground lg:text-[80px] lg:leading-[0.9]">
          <em>{trip.name}</em>
        </h1>
        <WaveGlyph color="var(--sea)" w={56} h={14} className="hidden lg:block" />
      </div>
      <div className="relative mt-2 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {trip.country ? <span>{trip.country}</span> : null}
        <span>{trip.dayCount} days</span>
      </div>
    </header>
  )
}

function SharedBody({ trip }: { trip: SharedTrip }) {
  if (trip.days.length === 0) {
    return (
      <p className="px-5 pt-8 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground lg:px-10">
        No plan yet.
      </p>
    )
  }
  return (
    <div className="px-5 pt-6 lg:px-10">
      {trip.days.map((day) => (
        <SharedDayRow key={day.ordinal} day={day} />
      ))}
    </div>
  )
}

function SharedDayRow({ day }: { day: SharedDay }) {
  return (
    <article className="border-b border-border py-5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Day {String(day.ordinal).padStart(2, "0")}
          {day.locationName ? ` · ${day.locationName}` : ""}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {day.tag}
        </span>
      </div>
      <h2 className="mt-1 font-serif text-2xl italic text-foreground">{day.title}</h2>
      {day.events.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {day.events.map((e, i) => (
            <li key={i} className="flex gap-3 text-sm text-foreground">
              {e.time ? (
                <span className="t-num w-12 shrink-0 text-muted-foreground">{e.time}</span>
              ) : (
                <span className="w-12 shrink-0" />
              )}
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: clean. (`@/components/together` exports `Label`, `TopoBg`, `WaveGlyph`; if any import name differs, open `src/components/together.tsx` and match the real export.)

- [ ] **Step 3: Verify in the browser**

With a trip temporarily marked public (the Task 1 Step 3 SQL), open `http://localhost:3000/t/testtoken123` **in a logged-out/incognito window**. Expect the itinerary rendered with "Day 01/02..." labels, country + "N days", and **no** dates, budget, or member avatars. Open `http://localhost:3000/t/nope` and expect "This trip isn't shared." Revert the test row afterward.

- [ ] **Step 4: Commit**

```bash
git add src/app/t/[token]/page.tsx
git commit -m "feat(share): public read-only /t/[token] view"
```

---

## Task 4: Share action + dialog + trip-header entry

**Files:**
- Create: `src/lib/trips/share-actions.ts`
- Create: `src/components/share-trip-dialog.tsx`
- Modify: `src/lib/trips/shared-trip-queries.ts` (add `getTripShareState`)
- Modify: `src/app/trips/[slug]/page.tsx` (load share state; render dialog in `TripHeaderView`)

**Interfaces:**
- Produces: `async shareTrip(tripId: string, tripSlug: string): Promise<{ error?: string; token?: string }>`, `async unshareTrip(tripId: string, tripSlug: string): Promise<{ error?: string }>`, `async getTripShareState(tripId: string): Promise<{ isPublic: boolean; shareToken: string | null }>`, component `ShareTripDialog`.
- Consumes: `createClient` from `@/lib/supabase/server`; `Dialog*` from `@/components/ui/dialog`; `Button` / `buttonVariants` from `@/components/ui/button`.

- [ ] **Step 1: Write the share/unshare actions**

Create `src/lib/trips/share-actions.ts`:

```ts
"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

/** Mints (or reuses) a share token and marks the trip public. Returns the token
 * so the dialog can show the link immediately. `shared_at` is set only on the
 * first share. RLS gates that the caller is a workspace member of the trip. */
export async function shareTrip(
  tripId: string,
  tripSlug: string,
): Promise<{ error?: string; token?: string }> {
  const supabase = await createClient()

  const { data: existing, error: readError } = await supabase
    .from("trips")
    .select("share_token, shared_at")
    .eq("id", tripId)
    .maybeSingle()
  if (readError) return { error: readError.message }
  if (!existing) return { error: "Trip not found." }

  const token = existing.share_token ?? crypto.randomUUID().replace(/-/g, "")
  const sharedAt = existing.shared_at ?? new Date().toISOString()

  const { error } = await supabase
    .from("trips")
    .update({ is_public: true, share_token: token, shared_at: sharedAt })
    .eq("id", tripId)
  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return { token }
}

/** Turns a trip's public link off. The token is kept, so re-sharing reuses the
 * same link. */
export async function unshareTrip(
  tripId: string,
  tripSlug: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("trips")
    .update({ is_public: false })
    .eq("id", tripId)
  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}
```

- [ ] **Step 2: Add `getTripShareState` to the query module**

Append to `src/lib/trips/shared-trip-queries.ts`:

```ts
/** Current share state for the owner-side dialog. */
export async function getTripShareState(
  tripId: string,
): Promise<{ isPublic: boolean; shareToken: string | null }> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trips")
    .select("is_public, share_token")
    .eq("id", tripId)
    .maybeSingle()
  return {
    isPublic: data?.is_public ?? false,
    shareToken: data?.share_token ?? null,
  }
}
```

- [ ] **Step 3: Write the share dialog**

Create `src/components/share-trip-dialog.tsx`:

```tsx
"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { shareTrip, unshareTrip } from "@/lib/trips/share-actions"

export function ShareTripDialog({
  tripId,
  tripSlug,
  initialPublic,
  initialToken,
}: {
  tripId: string
  tripSlug: string
  initialPublic: boolean
  initialToken: string | null
}) {
  const [isPublic, setIsPublic] = useState(initialPublic)
  const [token, setToken] = useState(initialToken)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const link =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/t/${token}`
      : ""

  async function toggle() {
    setPending(true)
    setError(null)
    if (isPublic) {
      const res = await unshareTrip(tripId, tripSlug)
      if (res.error) setError(res.error)
      else setIsPublic(false)
    } else {
      const res = await shareTrip(tripId, tripSlug)
      if (res.error) setError(res.error)
      else {
        setToken(res.token ?? null)
        setIsPublic(true)
      }
    }
    setPending(false)
  }

  async function copyLink() {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          />
        }
      >
        {"// share"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share this trip</DialogTitle>
          <DialogDescription>
            Your budget, expenses, members, and exact dates are never shared —
            only the itinerary.
          </DialogDescription>
        </DialogHeader>

        <Button onClick={toggle} disabled={pending} variant={isPublic ? "outline" : "default"}>
          {isPublic ? "Stop sharing" : "Share publicly"}
        </Button>

        {isPublic && link ? (
          <div className="flex items-center gap-2 rounded-md border border-border p-2">
            <span className="truncate font-mono text-[11px] text-muted-foreground">{link}</span>
            <Button size="sm" variant="ghost" onClick={copyLink}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogClose render={<Button variant="ghost" />}>Done</DialogClose>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Wire the dialog into the trip header**

In `src/app/trips/[slug]/page.tsx`:

1. Add imports near the other `@/lib/trips` imports:

```tsx
import { getTripShareState } from "@/lib/trips/shared-trip-queries"
import { ShareTripDialog } from "@/components/share-trip-dialog"
```

2. In `TripPage`, after `const header = await getTripBySlug(...)` (and its `notFound()` guard), load the share state:

```tsx
  const shareState = await getTripShareState(header.id)
```

3. Pass it into the header view. Change the `<TripHeaderView header={header} workspace={workspace} destinations={navDestinations} />` call to also pass `shareState`:

```tsx
        <TripHeaderView
          header={header}
          workspace={workspace}
          destinations={navDestinations}
          shareState={shareState}
        />
```

4. Update `TripHeaderView`'s signature and the desktop control row so "share" sits beside "edit trip". Change the props type to add `shareState: { isPublic: boolean; shareToken: string | null }`, and replace the desktop `lg:flex` control row (the `<div className="relative hidden lg:mb-2 lg:flex ...">` block) with:

```tsx
      <div className="relative hidden lg:mb-2 lg:flex lg:items-center lg:justify-between">
        <Label>{isDream ? "Dream" : `Trip · ${tripCount}`}</Label>
        <div className="flex items-center gap-4">
          <ShareTripDialog
            tripId={header.id}
            tripSlug={header.slug}
            initialPublic={shareState.isPublic}
            initialToken={shareState.shareToken}
          />
          <Link
            href={`/trips/${header.slug}/edit`}
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            {"// edit trip"}
          </Link>
        </div>
      </div>
```

(The mobile `MobileHeaderNav center=` slot is left as-is; share lives on the desktop control row for v1.)

- [ ] **Step 5: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: clean. If `DialogTrigger`/`DialogClose` `render={...}` typing complains, match the exact pattern already used in `src/components/ui/dialog.tsx` (base-ui `render` prop).

- [ ] **Step 6: Verify in the browser**

Open a trip you own on desktop. Click `// share` → "Share publicly". Expect a `/t/<token>` link to appear; copy it and open in an incognito window — the public view from Task 3 renders. Back in the dialog, click "Stop sharing", reload the incognito tab, and expect "This trip isn't shared."

- [ ] **Step 7: Commit**

```bash
git add src/lib/trips/share-actions.ts src/components/share-trip-dialog.tsx src/lib/trips/shared-trip-queries.ts "src/app/trips/[slug]/page.tsx"
git commit -m "feat(share): share/unshare action + dialog in trip header"
```

---

## Task 5: Copy flow — `copySharedTrip` action + public-page CTA

**Files:**
- Modify: `src/lib/trips/share-actions.ts` (add `copySharedTrip`)
- Create: `src/app/t/[token]/copy-cta.tsx`
- Modify: `src/app/t/[token]/page.tsx` (render the CTA; pass auth state)

**Interfaces:**
- Produces: `async copySharedTrip(token: string, startDate: string): Promise<{ error?: string; slug?: string }>`, component `CopyCta`.
- Consumes: `getSharedTrip` (Task 2), `getCurrentWorkspace`, `EXPENSE_CATEGORIES` from `@/lib/trips/expense-types`.

- [ ] **Step 1: Add the copy action**

Append to `src/lib/trips/share-actions.ts` (add these imports at the top of the file: `import { getCurrentWorkspace } from "@/lib/workspace/queries"`, `import { EXPENSE_CATEGORIES } from "@/lib/trips/expense-types"`, `import { getSharedTrip } from "@/lib/trips/shared-trip-queries"`):

```ts
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return s || "trip"
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Clones a shared trip into the caller's workspace as a new dated trip starting
 * on `startDate`. Reads the safe projection (no dates/budget/members), then
 * inserts trip + members + default categories + locations + days under the
 * caller's own RLS — no privileged write path. Days land on consecutive dates;
 * each location's span is derived from its days. Returns the new slug.
 */
export async function copySharedTrip(
  token: string,
  startDate: string,
): Promise<{ error?: string; slug?: string }> {
  if (!DATE_RE.test(startDate)) return { error: "Pick a start date." }

  const trip = await getSharedTrip(token)
  if (!trip) return { error: "This trip isn't shared." }

  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "No workspace." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }
  const userId = userData.user.id

  const hasDays = trip.days.length > 0
  const endDate = hasDays ? addDays(startDate, trip.days.length - 1) : startDate

  // Insert the trip row, retrying the slug on collision (mirrors createTrip).
  const base = slugify(trip.name)
  let slug = base
  let tripId: string | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from("trips")
      .insert({
        workspace_id: workspace.id,
        slug,
        name: trip.name,
        country: trip.country,
        start_date: startDate,
        end_date: endDate,
        created_by: userId,
      })
      .select("id")
      .single()
    if (!error && data) {
      tripId = data.id
      break
    }
    if (error?.code === "23505") {
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
      continue
    }
    return { error: error?.message ?? "Could not create trip." }
  }
  if (!tripId) return { error: "Could not find a free name; try again." }

  // Members + default expense categories, exactly like createTrip.
  const { error: membersError } = await supabase.from("trip_members").insert(
    workspace.members.map((m) => ({
      trip_id: tripId,
      user_id: m.user_id,
      role: "member" as const,
    })),
  )
  if (membersError) return { error: membersError.message }

  const { error: catError } = await supabase.from("expense_categories").insert(
    EXPENSE_CATEGORIES.map((name, i) => ({
      trip_id: tripId,
      name,
      sort_order: i,
      created_by: userId,
    })),
  )
  if (catError) return { error: catError.message }

  // Locations: derive each span from the ordinals of its days. Names are the
  // only handle the projection carries, so days remap to locations by name.
  const spanByName = new Map<string, { min: number; max: number }>()
  for (const d of trip.days) {
    if (!d.locationName) continue
    const cur = spanByName.get(d.locationName)
    if (!cur) spanByName.set(d.locationName, { min: d.ordinal, max: d.ordinal })
    else {
      cur.min = Math.min(cur.min, d.ordinal)
      cur.max = Math.max(cur.max, d.ordinal)
    }
  }

  const nameToId = new Map<string, string>()
  if (trip.locations.length > 0) {
    const { data: inserted, error: locError } = await supabase
      .from("itinerary_locations")
      .insert(
        trip.locations.map((l) => {
          const span = spanByName.get(l.name)
          return {
            trip_id: tripId,
            name: l.name,
            sort_order: l.sortOrder,
            start_date: span ? addDays(startDate, span.min - 1) : null,
            end_date: span ? addDays(startDate, span.max - 1) : null,
            created_by: userId,
          }
        }),
      )
      .select("id, name")
    if (locError) return { error: locError.message }
    for (const row of inserted ?? []) nameToId.set(row.name, row.id)
  }

  if (hasDays) {
    const { error: daysError } = await supabase.from("itinerary_days").insert(
      trip.days.map((d) => ({
        trip_id: tripId,
        day_date: addDays(startDate, d.ordinal - 1),
        title: d.title,
        events: d.events,
        tag: d.tag,
        tone: d.tone,
        location_id: d.locationName ? nameToId.get(d.locationName) ?? null : null,
        created_by: userId,
      })),
    )
    if (daysError) return { error: daysError.message }
  }

  revalidatePath("/home")
  return { slug }
}
```

- [ ] **Step 2: Write the CTA component**

Create `src/app/t/[token]/copy-cta.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"

import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { copySharedTrip } from "@/lib/trips/share-actions"

export function CopyCta({
  token,
  isAuthed,
}: {
  token: string
  isAuthed: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [startDate, setStartDate] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function copy() {
    setPending(true)
    setError(null)
    const res = await copySharedTrip(token, startDate)
    if (res.error) {
      setError(res.error)
      setPending(false)
      return
    }
    setDone(true)
    router.push(`/trips/${res.slug}`)
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/90 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-[440px] px-5 py-4 lg:max-w-[760px]">
        {!isAuthed ? (
          <Link
            href={`/signin?next=/t/${token}`}
            className={cn(buttonVariants({ size: "lg" }), "w-full")}
          >
            Plan my own trip from this
          </Link>
        ) : !open ? (
          <Button size="lg" className="w-full" onClick={() => setOpen(true)}>
            Plan my own trip from this
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Your start date
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <Button onClick={copy} disabled={pending || done || !startDate}>
                {done ? "Opening..." : pending ? "Copying..." : "Copy"}
              </Button>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Render the CTA on the public page**

In `src/app/t/[token]/page.tsx`:

1. Add imports:

```tsx
import { createClient } from "@/lib/supabase/server"
import { CopyCta } from "./copy-cta"
```

2. In `SharedTripPage`, after `const trip = await getSharedTrip(token)` and the `if (!trip)` guard, read auth state:

```tsx
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const isAuthed = Boolean(userData.user)
```

3. Add `<CopyCta token={token} isAuthed={isAuthed} />` as the last child inside the `<main>`, after `<SharedBody />`.

- [ ] **Step 4: Verify lint + build**

Run: `pnpm lint && pnpm build`
Expected: clean.

- [ ] **Step 5: Verify the full flow in the browser**

Share a trip (Task 4). In an incognito window open `/t/<token>`:
- Logged out: the CTA links to `/signin?next=/t/<token>`.
- Sign in (or use a logged-in second account), reopen `/t/<token>`, click "Plan my own trip from this", pick a start date, click "Copy". Expect to land on a new `/trips/<slug>` whose itinerary matches the shared plan (locations + day titles + events), with **your** chosen dates, your own budget/packing empty. Confirm the original trip is unchanged.

- [ ] **Step 6: Update docs**

Add a line to `docs/TODO.md` under done, and a row to `docs/DECISIONS.md` noting: "Shareable trip uses a single read-only `shared_trip` projection RPC as the privacy boundary; copy runs under the caller's own RLS (no privileged write)." Update `docs/FEATURES.md` "Done" with shareable trips.

- [ ] **Step 7: Commit**

```bash
git add "src/lib/trips/share-actions.ts" "src/app/t/[token]/copy-cta.tsx" "src/app/t/[token]/page.tsx" docs/TODO.md docs/DECISIONS.md docs/FEATURES.md
git commit -m "feat(share): copy a shared trip into your workspace"
```

---

## Self-Review

**Spec coverage:**
- Share columns + `shared_trip` RPC + grant → Task 1. ✓
- Projection excludes dates/budget/members → Task 1 SQL (selects only itinerary skeleton; verified in Steps 3–4). ✓
- Anonymous view, no account to browse → Task 3 (no auth gate); auth only at CTA → Task 5. ✓
- One-tap publish toggle + reassurance copy + link → Task 4 dialog. ✓
- Un-share keeps token, link dies immediately → `unshareTrip` + Task 4 Step 6 check. ✓
- Copy = full dated clone with locations + events, caller's own RLS → Task 5 `copySharedTrip`. ✓
- "Day N" labels, no real dates on public view → Task 3 `SharedDayRow`. ✓
- Edge cases: unknown/un-shared token → "This trip isn't shared." (Task 3); empty itinerary → "No plan yet." (Task 3). ✓
- Notes excluded → not selected anywhere. ✓
- Idempotent migration, applied manually → Task 1 (Step 2 runs twice). ✓

**Placeholder scan:** `2026MMDD` in the migration filename is an intentional "pick the date at execution time" instruction, not a code placeholder — every code block is complete. No TODO/TBD in code.

**Type consistency:** `getSharedTrip` returns `SharedTrip | null` (Task 2) and is consumed by Task 3 and Task 5. `SharedDay.locationName` / `SharedLocation.sortOrder` / `SharedDay.ordinal` names are used identically in the mapper (Task 2) and the copy action (Task 5). `shareTrip`/`unshareTrip`/`copySharedTrip` signatures match their call sites in the dialog (Task 4) and CTA (Task 5). RPC name `shared_trip` and arg `p_token` match between Task 1 SQL and Task 2 query.

**Known v1 limitation (acceptable):** two locations in one trip sharing the exact same name collapse to one on copy (the projection's only location handle is the name). Real trips don't reuse location names; deferred.
