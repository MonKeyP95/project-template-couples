# Phase 4 — Dream-Trip Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify dreams and trips into one `trips` table distinguished by whether dates are set. Replace the hardcoded Lombok card and dream board on `/home` with a real query, add a dream-creation path, and make `/trips/[slug]` render a dream variant when dates are NULL.

**Architecture:** Five vertical slices, each independently shippable.
1. **Schema** — make dates nullable (already), tighten the date CHECK to "both or neither," add `fuzzy_when text`, seed four dream rows.
2. **Query layer** — new `listTripsForWorkspace` returning bucketed `now / upcoming / past / dreams`, pure `deriveState`, extended `TripHeader`.
3. **`/home` rebuild** — four bands (Hero / Trips / Dreams / Past) consuming the new query.
4. **`+ new trip` form gains a dream toggle** — branches `createTrip` validation on `isDream`.
5. **`/trips/[slug]` dream variant** — hero swaps date range for `fuzzy_when`, weather hidden, itinerary empty-state.

**Tech Stack:** Next.js 16 App Router, React 19 (`useState` + `useTransition`), Server Actions, `@supabase/ssr`, Tailwind v4. Spec: `docs/superpowers/specs/2026-05-28-phase-4-dream-trip-pipeline-design.md`.

**Validation approach (this codebase):** there is no test runner. Each task is validated with `pnpm lint` + `pnpm build` and finishes with a manual phone-viewport check. Database tasks finish with a Supabase SQL Editor query that confirms the expected rows. Matches `+ new trip` form (2026-05-27) and earlier Phase 3.5 shipping cadence.

**Slice independence:** Slices 1–3 deliver the original `/home`-stuck-on-Lombok pain fix. After Slice 3 you can pause indefinitely; slices 4 and 5 polish the surrounding flows. Each slice ends with a commit on `main` and a working app.

---

## Slice 1 — Schema migration + dream seeds

### Task 1.1: Schema migration

**Files:**
- Create: `supabase/migrations/20260528000001_phase_4_dreams.sql`

- [ ] **Step 1: Create the migration file**

Write the full contents of `supabase/migrations/20260528000001_phase_4_dreams.sql`:

```sql
-- Phase 4: dream rows in the trips table.
-- Dates were already nullable from Phase 3. The Phase 3 migration added an
-- anonymous table-level CHECK auto-named `trips_check`:
--   check (end_date is null or start_date is null or end_date >= start_date)
-- which permitted half-states (start set, end null). We tighten it to
-- "both null or both set", which collapses the dream/trip distinction to one
-- clean invariant.
--
-- We also add fuzzy_when text for free-form dream timing ("summer 2030").

alter table public.trips
  add column fuzzy_when text;

alter table public.trips drop constraint if exists trips_check;
alter table public.trips add constraint trips_dates_check
  check (
    (start_date is null and end_date is null)
    or (start_date is not null and end_date is not null and end_date >= start_date)
  );
```

- [ ] **Step 2: Lint + build**

Run: `pnpm lint`
Expected: no errors (SQL files aren't linted but a pure-SQL addition won't break anything).

Run: `pnpm build`
Expected: build succeeds (the schema change has no app-code consumers yet).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260528000001_phase_4_dreams.sql
git commit -m "feat(trips): + fuzzy_when column, tighten dates CHECK for dreams"
```

---

### Task 1.2: Dream seed migration

**Files:**
- Create: `supabase/migrations/20260528000002_seed_dreams.sql`

- [ ] **Step 1: Create the seed file**

Write the full contents of `supabase/migrations/20260528000002_seed_dreams.sql`:

```sql
-- Phase 4: seed four dream rows for every workspace that has Lombok seeded.
-- Idempotent via unique (workspace_id, slug). Pattern mirrors
-- 20260526000002_seed_lombok.sql.

do $$
declare
  ws_id uuid;
  owner_id uuid;
  dream record;
begin
  for ws_id in
    select distinct workspace_id
    from public.trips
    where slug = 'lombok'
  loop
    -- Pick any workspace member as created_by (we don't have auth.uid() in the
    -- SQL Editor). Prefer the workspace owner if present.
    select user_id into owner_id
    from public.workspace_members
    where workspace_id = ws_id
    order by case when role = 'owner' then 0 else 1 end, added_at asc
    limit 1;

    if owner_id is null then
      continue;
    end if;

    for dream in
      select * from (values
        ('faroe-islands',  'Faroe Islands', 'Faroe Islands',  62.0, -6.8),
        ('patagonia',      'Patagonia',     'Argentina',     -50.0, -73.0),
        ('hokkaido',       'Hokkaido',      'Japan',           43.0, 142.0),
        ('aeolian-isles',  'Aeolian Isles', 'Italy',           38.5, 14.9)
      ) as t(slug, name, country, lat, lng)
    loop
      insert into public.trips (
        workspace_id, slug, name, country, lat, lng,
        start_date, end_date, fuzzy_when, created_by
      )
      values (
        ws_id, dream.slug, dream.name, dream.country,
        dream.lat::numeric(7,4), dream.lng::numeric(7,4),
        null, null, 'someday', owner_id
      )
      on conflict (workspace_id, slug) do nothing;

      -- Add every workspace member as a trip_member so RLS sees them.
      insert into public.trip_members (trip_id, user_id, role)
      select t.id, wm.user_id, 'member'
      from public.trips t
      join public.workspace_members wm on wm.workspace_id = t.workspace_id
      where t.workspace_id = ws_id
        and t.slug = dream.slug
      on conflict (trip_id, user_id) do nothing;
    end loop;
  end loop;
end$$;
```

- [ ] **Step 2: Lint + build**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: User pastes both migrations into Supabase SQL Editor in order**

Open Supabase project → SQL Editor → paste contents of `20260528000001_phase_4_dreams.sql`, run. Then paste `20260528000002_seed_dreams.sql`, run.

- [ ] **Step 4: Verify in Supabase SQL Editor**

Run this query in the Supabase SQL Editor:

```sql
select slug, name, country, start_date, end_date, fuzzy_when
from public.trips
order by start_date nulls last, created_at;
```

Expected output: 5 rows for the seeded workspace —
- `lombok` (Indonesia, 2026-06-12 → 2026-06-20, fuzzy_when=null)
- `faroe-islands` (Faroe Islands, null dates, fuzzy_when='someday')
- `patagonia` (Argentina, null dates, fuzzy_when='someday')
- `hokkaido` (Japan, null dates, fuzzy_when='someday')
- `aeolian-isles` (Italy, null dates, fuzzy_when='someday')

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260528000002_seed_dreams.sql
git commit -m "feat(trips): seed 4 dream rows per workspace (Faroe, Patagonia, Hokkaido, Aeolian)"
```

---

## Slice 2 — Query layer + state derivation

### Task 2.1: Extend `TripHeader` with `fuzzyWhen`

**Files:**
- Modify: `src/lib/trips/queries.ts`

- [ ] **Step 1: Add `fuzzyWhen` to `TripHeader` and the `TripRow` shape**

Edit `src/lib/trips/queries.ts`. In the `TripHeader` interface, add `fuzzyWhen` after `endDate`:

```ts
export interface TripHeader {
  id: string
  workspaceId: string
  slug: string
  name: string
  country: string | null
  startDate: string | null
  endDate: string | null
  fuzzyWhen: string | null
  lat: number | null
  lng: number | null
  /** 1-based position within the workspace's trip list, ordered by start_date. */
  index: number
  /** Total number of trips in the workspace. */
  total: number
}
```

In the `TripRow` interface, add `fuzzy_when: string | null` after `end_date`:

```ts
interface TripRow {
  id: string
  workspace_id: string
  slug: string
  name: string
  country: string | null
  start_date: string | null
  end_date: string | null
  fuzzy_when: string | null
  lat: string | number | null
  lng: string | number | null
}
```

In `getTripBySlug`, update the `.select(...)` string and the return-object construction:

```ts
const tripQuery = supabase
  .from("trips")
  .select(
    "id, workspace_id, slug, name, country, start_date, end_date, fuzzy_when, lat, lng",
  )
  .eq("workspace_id", workspaceId)
  .eq("slug", slug)
  .maybeSingle<TripRow>()
```

```ts
return {
  id: trip.id,
  workspaceId: trip.workspace_id,
  slug: trip.slug,
  name: trip.name,
  country: trip.country,
  startDate: trip.start_date,
  endDate: trip.end_date,
  fuzzyWhen: trip.fuzzy_when,
  lat: asNumber(trip.lat),
  lng: asNumber(trip.lng),
  index,
  total,
}
```

- [ ] **Step 2: Lint + build**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds. Existing consumers (`src/app/trips/[slug]/page.tsx`) compile because `fuzzyWhen` is additive — they ignore the new field.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/queries.ts
git commit -m "feat(trips): + fuzzyWhen on TripHeader"
```

---

### Task 2.2: Slug-to-tone helper

**Files:**
- Create: `src/lib/trips/slug-tone.ts`

- [ ] **Step 1: Create the helper**

Write the full contents of `src/lib/trips/slug-tone.ts`:

```ts
/**
 * Map a slug to one of the four design tones deterministically.
 * Same slug always returns the same tone — no schema column needed.
 *
 *   "lombok" stays "sea" to match the existing visual.
 *   Any other slug hashes into sea | clay | moss | sand.
 */
export type CardTone = "sea" | "clay" | "moss" | "sand"

const TONES: CardTone[] = ["sea", "clay", "moss", "sand"]

export function slugToTone(slug: string): CardTone {
  if (slug === "lombok") return "sea"
  let hash = 0
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0
  }
  const idx = ((hash % TONES.length) + TONES.length) % TONES.length
  return TONES[idx]
}
```

- [ ] **Step 2: Lint + build**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/slug-tone.ts
git commit -m "feat(trips): + slugToTone helper for deterministic per-trip color"
```

---

### Task 2.3: `listTripsForWorkspace` query

**Files:**
- Create: `src/lib/trips/list-queries.ts`

- [ ] **Step 1: Create the query module**

Write the full contents of `src/lib/trips/list-queries.ts`:

```ts
import { createClient } from "@/lib/supabase/server"

export type TripState = "now" | "upcoming" | "past" | "dream"

export interface TripListItem {
  id: string
  slug: string
  name: string
  country: string | null
  startDate: string | null
  endDate: string | null
  fuzzyWhen: string | null
  lat: number | null
  lng: number | null
  state: TripState
}

export interface TripBuckets {
  /** start_date <= today <= end_date, sorted by start_date asc. */
  now: TripListItem[]
  /** today < start_date, sorted by start_date asc. */
  upcoming: TripListItem[]
  /** today > end_date, sorted by end_date desc (most recent first). */
  past: TripListItem[]
  /** start_date is null, sorted by created_at asc. */
  dreams: TripListItem[]
}

interface TripRow {
  id: string
  slug: string
  name: string
  country: string | null
  start_date: string | null
  end_date: string | null
  fuzzy_when: string | null
  lat: string | number | null
  lng: string | number | null
  created_at: string
}

function asNumber(v: string | number | null): number | null {
  return v == null ? null : Number(v)
}

/**
 * Pure: derive a trip's state from today + its dates.
 * `today` is an ISO yyyy-mm-dd string. Lexicographic string comparison
 * matches date order, so no Date round-trip needed.
 */
export function deriveState(
  today: string,
  startDate: string | null,
  endDate: string | null,
): TripState {
  if (!startDate || !endDate) return "dream"
  if (today < startDate) return "upcoming"
  if (today > endDate) return "past"
  return "now"
}

/**
 * Returns every trip the caller can see in this workspace, bucketed by state.
 * One round-trip; bucketing happens in JS (bucket sizes are tiny in practice).
 */
export async function listTripsForWorkspace(
  workspaceId: string,
): Promise<TripBuckets> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trips")
    .select(
      "id, slug, name, country, start_date, end_date, fuzzy_when, lat, lng, created_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .returns<TripRow[]>()

  const rows = data ?? []
  const today = new Date().toISOString().slice(0, 10)

  const items: TripListItem[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    country: row.country,
    startDate: row.start_date,
    endDate: row.end_date,
    fuzzyWhen: row.fuzzy_when,
    lat: asNumber(row.lat),
    lng: asNumber(row.lng),
    state: deriveState(today, row.start_date, row.end_date),
  }))

  const buckets: TripBuckets = { now: [], upcoming: [], past: [], dreams: [] }
  for (const item of items) {
    if (item.state === "now") buckets.now.push(item)
    else if (item.state === "upcoming") buckets.upcoming.push(item)
    else if (item.state === "past") buckets.past.push(item)
    else buckets.dreams.push(item)
  }

  buckets.now.sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""))
  buckets.upcoming.sort((a, b) =>
    (a.startDate ?? "").localeCompare(b.startDate ?? ""),
  )
  buckets.past.sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""))
  // dreams already in created_at asc from the query

  return buckets
}
```

- [ ] **Step 2: Lint + build**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/trips/list-queries.ts
git commit -m "feat(trips): + listTripsForWorkspace with bucketed Now/Upcoming/Past/Dream"
```

---

## Slice 3 — `/home` rebuild

### Task 3.1: Trip-card helper module

**Files:**
- Create: `src/app/home/trip-cards.tsx`

- [ ] **Step 1: Create the card components module**

Write the full contents of `src/app/home/trip-cards.tsx`:

```tsx
import Link from "next/link"

import {
  Chevron,
  Coord,
  Label,
  MonoBadge,
  TopoBg,
} from "@/components/together"
import type { TripListItem } from "@/lib/trips/list-queries"
import { slugToTone, type CardTone } from "@/lib/trips/slug-tone"

const surface: Record<CardTone, string> = {
  sea: "bg-sea-tint",
  clay: "bg-clay-tint",
  moss: "bg-moss-tint",
  sand: "bg-sand-tint",
}

const monoBadgeTone: Record<CardTone, "sea" | "clay" | "moss" | "sand"> = {
  sea: "sea",
  clay: "clay",
  moss: "moss",
  sand: "sand",
}

const SHORT_MONTH = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

function formatDayLabel(date: string): string {
  return SHORT_MONTH.format(new Date(date)).toUpperCase()
}

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start || !end) return null
  return `${formatDayLabel(start)} — ${formatDayLabel(end)}`
}

function tripLengthDays(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  const s = new Date(`${start}T00:00:00Z`)
  const e = new Date(`${end}T00:00:00Z`)
  const days = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1
  return days > 0 ? days : null
}

function formatCoord(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null
  const latStr = `${Math.abs(lat).toFixed(1)}° ${lat < 0 ? "S" : "N"}`
  const lngStr = `${Math.abs(lng).toFixed(1)}° ${lng < 0 ? "W" : "E"}`
  return `${latStr} · ${lngStr}`
}

/** Top-of-page hero card. Used for at most one trip per render. */
export function HeroCard({
  trip,
  memberCount,
}: {
  trip: TripListItem
  memberCount: number
}) {
  const tone = slugToTone(trip.slug)
  const coord = formatCoord(trip.lat, trip.lng)
  const dateRange = formatDateRange(trip.startDate, trip.endDate)
  const length = tripLengthDays(trip.startDate, trip.endDate)
  return (
    <Link
      href={`/trips/${trip.slug}`}
      className="block overflow-hidden rounded-[14px] border border-border bg-card shadow-md transition-shadow md:hover:shadow-lg"
    >
      <div
        className={`relative h-[132px] overflow-hidden ${surface[tone]} md:aspect-[16/10] md:h-auto`}
      >
        <TopoBg tone={tone} opacity={0.16} />
        <div className="relative flex h-full flex-col justify-between p-4 md:p-5">
          <div className="flex items-start justify-between">
            {trip.state === "now" ? (
              <MonoBadge tone={monoBadgeTone[tone]}>// now</MonoBadge>
            ) : (
              <span />
            )}
            {coord ? <Coord>{coord}</Coord> : <span />}
          </div>
          <div>
            <div className="t-display text-[38px] leading-none text-foreground md:text-[44px]">
              <em>{trip.name}</em>
            </div>
            {trip.country ? (
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {trip.country}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between px-4 py-3 md:px-5 md:py-3.5">
        <div>
          {dateRange ? (
            <div className="font-mono text-[11px] tracking-[0.04em] text-foreground">
              {dateRange}
            </div>
          ) : null}
          <div className="mt-0.5 font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            {length ? `${length} days · ` : ""}
            {memberCount} {memberCount === 1 ? "traveller" : "travellers"}
          </div>
        </div>
        <Chevron />
      </div>
    </Link>
  )
}

/** Compact row used in the "Trips" band (non-hero upcoming) and in Past. */
export function CompactRow({
  trip,
  dimmed = false,
}: {
  trip: TripListItem
  dimmed?: boolean
}) {
  const dateRange = formatDateRange(trip.startDate, trip.endDate)
  return (
    <Link
      href={`/trips/${trip.slug}`}
      className={`flex items-center justify-between rounded-[10px] border border-border bg-card px-4 py-3 transition-shadow md:hover:shadow-md ${dimmed ? "opacity-60" : ""}`}
    >
      <div>
        <div className="t-display text-[18px] leading-tight text-foreground">
          <em>{trip.name}</em>
        </div>
        {trip.country ? (
          <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            {trip.country}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2.5">
        {dateRange ? (
          <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            {dateRange}
          </span>
        ) : null}
        <Chevron />
      </div>
    </Link>
  )
}

/** Dream tile — square on mobile (2-col) and tall on desktop (4-col). */
export function DreamTile({ trip }: { trip: TripListItem }) {
  const tone = slugToTone(trip.slug)
  const labelText = (trip.fuzzyWhen ?? "someday").toUpperCase()
  return (
    <Link
      href={`/trips/${trip.slug}`}
      className={`relative flex aspect-square flex-col justify-between overflow-hidden rounded-[10px] border border-border p-3 transition-shadow md:aspect-[4/5] md:p-4 md:hover:shadow-md ${surface[tone]}`}
    >
      <TopoBg tone={tone} opacity={0.1} />
      <Label className="relative">{`// dream`}</Label>
      <div className="relative">
        <div className="t-display text-[20px] text-foreground md:text-[26px]">
          <em>{trip.name}</em>
        </div>
        <Coord>{labelText}</Coord>
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: Lint + build**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds (no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/app/home/trip-cards.tsx
git commit -m "feat(home): + HeroCard, CompactRow, DreamTile components"
```

---

### Task 3.2: Days-out helper (or reuse existing)

**Files:**
- Create: `src/app/home/format-helpers.ts`

- [ ] **Step 1: Create the helper**

Write the full contents of `src/app/home/format-helpers.ts`:

```ts
/**
 * Days from today until a future date (UTC).
 * Returns null if startDate is null. Returns 0 if today >= startDate.
 */
export function daysUntil(startDate: string | null): number | null {
  if (!startDate) return null
  const start = new Date(`${startDate}T00:00:00Z`)
  const today = new Date()
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  )
  return Math.max(0, Math.ceil((start.getTime() - todayUtc) / 86_400_000))
}

/**
 * Day number within a trip (1-based) for the now-state countdown
 * (e.g. "day 3 / 8"). Returns null if dates aren't set.
 */
export function dayWithinTrip(
  startDate: string | null,
  endDate: string | null,
): { day: number; total: number } | null {
  if (!startDate || !endDate) return null
  const s = new Date(`${startDate}T00:00:00Z`)
  const e = new Date(`${endDate}T00:00:00Z`)
  const today = new Date()
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  )
  const total = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1
  const day = Math.min(
    total,
    Math.max(1, Math.round((todayUtc - s.getTime()) / 86_400_000) + 1),
  )
  return { day, total }
}
```

- [ ] **Step 2: Lint + build**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/home/format-helpers.ts
git commit -m "feat(home): + daysUntil + dayWithinTrip helpers"
```

---

### Task 3.3: Rebuild `/home` to use live data

**Files:**
- Modify: `src/app/home/page.tsx` (full rewrite of trip area; header/greeting/sign-out unchanged)

- [ ] **Step 1: Replace `src/app/home/page.tsx`**

Write the full new contents of `src/app/home/page.tsx`. This rewrite drops the hardcoded `DreamCard` + `DREAM_BOARD` array and the literal Lombok hero, replacing the trip area with four bands sourced from `listTripsForWorkspace`. Header / greeting / sign-out preserved.

```tsx
import Link from "next/link"
import { redirect } from "next/navigation"

import { InviteCard } from "@/components/invite-card"
import {
  Avatar,
  Chevron,
  Coord,
  Label,
  PairAvatar,
} from "@/components/together"
import { createClient } from "@/lib/supabase/server"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import {
  getCurrentWorkspace,
  type CurrentWorkspace,
  type WorkspaceMember,
} from "@/lib/workspace/queries"

import { daysUntil, dayWithinTrip } from "./format-helpers"
import { CompactRow, DreamTile, HeroCard } from "./trip-cards"

function formatDateLabel(date: Date) {
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" })
  return `${mm} / ${dd} · ${weekday}`
}

function orderMembers(
  workspace: CurrentWorkspace,
  currentUserId: string,
): WorkspaceMember[] {
  const me = workspace.members.find((m) => m.user_id === currentUserId)
  const others = workspace.members.filter((m) => m.user_id !== currentUserId)
  return me ? [me, ...others] : workspace.members
}

export default async function HomePage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/home")

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userData.user.id)
    .single()

  const workspace = await getCurrentWorkspace()
  const youOnly = workspace?.members.length === 1
  const dateLabel = formatDateLabel(new Date())
  const members = workspace ? orderMembers(workspace, userData.user.id) : []
  const estYear = workspace ? new Date(workspace.createdAt).getFullYear() : null
  const memberCount = workspace?.members.length ?? 0
  const memberCountLabel = `${memberCount} member${memberCount === 1 ? "" : "s"}`

  const buckets = workspace
    ? await listTripsForWorkspace(workspace.id)
    : { now: [], upcoming: [], past: [], dreams: [] }

  // Hero claim: prefer the earliest "now" trip; otherwise the soonest "upcoming".
  const hero = buckets.now[0] ?? buckets.upcoming[0] ?? null
  const trips = [
    ...buckets.now.slice(buckets.now[0] ? 1 : 0),
    ...buckets.upcoming.slice(hero && !buckets.now[0] ? 1 : 0),
  ]
  const activeCount = buckets.now.length + buckets.upcoming.length

  const heroCountdown = hero
    ? hero.state === "now"
      ? (() => {
          const d = dayWithinTrip(hero.startDate, hero.endDate)
          return d ? `day ${d.day} / ${d.total}` : null
        })()
      : (() => {
          const d = daysUntil(hero.startDate)
          return d != null ? `${d} days` : null
        })()
    : null

  return (
    <main className="mx-auto min-h-screen w-full max-w-[440px] bg-background px-5 pt-14 pb-10 md:max-w-[1200px] md:px-12 md:pt-12 md:pb-16">
      <header className="mb-14 flex items-center justify-between md:hidden">
        <Label>Together · Workspace</Label>
        {members.length >= 2 ? (
          <PairAvatar
            a={members[0].display_name}
            b={members[1].display_name}
            size={20}
          />
        ) : members.length === 1 ? (
          <Avatar name={members[0].display_name} size={20} tone="sea" />
        ) : null}
      </header>

      <section className="md:flex md:items-start md:justify-between">
        <div>
          <Label className="mb-2.5 block md:hidden">{dateLabel}</Label>
          <Label className="hidden md:block">Together · Workspace</Label>
          <h1 className="t-display text-[58px] text-foreground md:mt-2.5 md:text-[80px] md:leading-[0.95]">
            Hello,
            <br className="md:hidden" />
            <em>{profile?.display_name ?? "friend"}</em>.
          </h1>
        </div>
        <div className="hidden text-right md:block">
          <Coord>{dateLabel}</Coord>
          <div className="mt-2.5 flex justify-end">
            {members.length >= 2 ? (
              <PairAvatar
                a={members[0].display_name}
                b={members[1].display_name}
                size={26}
              />
            ) : members.length === 1 ? (
              <Avatar name={members[0].display_name} size={26} tone="sea" />
            ) : null}
          </div>
        </div>
      </section>

      <div className="my-5 h-px bg-border md:my-7" />

      <section className="flex items-baseline justify-between md:hidden">
        <div className="text-[13px] text-muted-foreground">
          {members.map((m, i) => (
            <span key={m.user_id}>
              {i > 0 ? " & " : null}
              <span className="font-serif italic text-foreground">
                {m.display_name}
              </span>
            </span>
          ))}
        </div>
        <Coord>
          {estYear ? `est. ${estYear} · ` : ""}
          {memberCountLabel}
        </Coord>
      </section>

      <section className="mb-3 hidden flex-wrap items-baseline gap-7 md:flex">
        <StatItem n={activeCount} label="Upcoming" />
        <StatItem n={buckets.dreams.length} label="Dreams" />
        <StatItem
          n={memberCount}
          label={memberCount === 1 ? "Member" : "Members"}
        />
        {estYear ? (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            est. {estYear}
          </span>
        ) : null}
      </section>

      {youOnly ? (
        <section className="mt-10 md:mt-12 md:max-w-[540px]">
          <InviteCard />
        </section>
      ) : (
        <>
          {hero ? (
            <section className="mt-10 md:mt-12">
              <div className="mb-2.5 flex items-center justify-between md:mb-4">
                <Label>
                  {hero.state === "now"
                    ? `Now · ${buckets.now.length}`
                    : `Upcoming · ${activeCount}`}
                </Label>
                {heroCountdown ? (
                  <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
                    {heroCountdown}
                  </span>
                ) : null}
              </div>
              <div className="md:grid md:grid-cols-2 md:gap-5 lg:grid-cols-3">
                <HeroCard trip={hero} memberCount={memberCount} />
              </div>
            </section>
          ) : null}

          {trips.length > 0 ? (
            <section className="mt-9 md:mt-12">
              <div className="mb-2.5 flex items-center justify-between md:mb-4">
                <Label>Trips · {trips.length}</Label>
              </div>
              <div className="flex flex-col gap-2.5 md:grid md:grid-cols-2 md:gap-5 lg:grid-cols-3">
                {trips.map((t) => (
                  <CompactRow key={t.id} trip={t} />
                ))}
              </div>
            </section>
          ) : null}

          {buckets.dreams.length > 0 ? (
            <section className="mt-9 md:mt-14">
              <div className="mb-2.5 flex items-center justify-between md:mb-4">
                <Label>Dreams · {buckets.dreams.length}</Label>
                <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
                  someday, together
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-4">
                {buckets.dreams.map((d) => (
                  <DreamTile key={d.id} trip={d} />
                ))}
              </div>
            </section>
          ) : null}

          {buckets.past.length > 0 ? (
            <section className="mt-9 md:mt-12">
              <div className="mb-2.5 flex items-center justify-between md:mb-4">
                <Label>Past · {buckets.past.length}</Label>
                <span className="font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
                  most recent first
                </span>
              </div>
              <div className="flex flex-col gap-2.5 md:grid md:grid-cols-3 md:gap-4 lg:grid-cols-4">
                {buckets.past.map((p) => (
                  <CompactRow key={p.id} trip={p} dimmed />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      <Link
        href="/trips/new"
        className="mt-7 flex w-full items-center justify-between rounded-[10px] border border-dashed border-rule bg-transparent px-4 py-3.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground md:mt-9 md:max-w-[280px] md:px-5 md:py-5"
      >
        <span>+ new trip or dream</span>
        <Chevron />
      </Link>

      <footer className="mt-12 flex justify-center md:mt-16">
        <form action="/api/signout" method="post">
          <button
            type="submit"
            className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </footer>
    </main>
  )
}

function StatItem({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="t-num text-[18px] text-foreground">
        {String(n).padStart(2, "0")}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Lint + build**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Visual check (mobile + desktop)**

Run: `pnpm dev`

Open http://localhost:3000/home in a browser at 390px viewport:
- Expect: Hero card = Lombok (upcoming) with sea topo background, "Upcoming · 1" label + "(N) days" countdown above.
- Expect: No "Trips" band (only one upcoming, claims hero).
- Expect: Dreams band with 4 tiles (Faroe, Patagonia, Hokkaido, Aeolian), each labeled "// dream" and `SOMEDAY` in the corner.
- Expect: No Past band (Lombok hasn't happened yet).
- Expect: "+ new trip or dream" CTA below Dreams, dashed.

Resize to 1280px:
- Expect: Hero still spans the row; Dreams flow into a 4-column grid.

- [ ] **Step 4: Functional check — create a new trip; verify it appears**

In the browser, click "+ new trip or dream" → fill in name "Test Trip", dates (any range starting after Lombok), country "Test", submit. Land on `/trips/test-trip` (empty tabs).

Navigate back to `/home`:
- Expect: Lombok stays as Hero (earlier start_date wins); "Trips · 1" band appears below with the Test Trip compact row.

- [ ] **Step 5: Commit**

```bash
git add src/app/home/page.tsx
git commit -m "feat(home): list real trips with Hero/Trips/Dreams/Past bands"
```

---

### Task 3.4: Visual cleanup pass at md/lg

**Files:**
- (Spot-fix in `src/app/home/page.tsx` or `src/app/home/trip-cards.tsx` as needed.)

- [ ] **Step 1: Re-run dev server at 768px and 1280px**

Run: `pnpm dev`

Walk through `/home` at:
- **768px (md)** — Stat row should show "01 Upcoming · 04 Dreams · 02 Members". Hero is in a 2-col grid (alone in row 1). Dreams 4-col grid. Past 3-col if any.
- **1280px (lg)** — Hero in 3-col grid (alone in row 1). Trips 3-col. Dreams 4-col. Past 4-col if any.

- [ ] **Step 2: If any visual issue spotted, fix it inline**

Likely fixes:
- Hero card aspect ratio: if it collapses too narrow at lg in a 3-col, consider `lg:col-span-2` on the hero wrapper for emphasis (optional polish).
- Compact rows: if they look stretched in 3-col grid, check `aspect` / `min-h-` rules.

If no issue, skip to step 3.

- [ ] **Step 3: Lint + build**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit (only if a fix was made; otherwise skip)**

```bash
git add src/app/home/page.tsx src/app/home/trip-cards.tsx
git commit -m "fix(home): polish md/lg band layouts"
```

---

### Task 3.5: Slice-3 ship checkpoint

The original `/home` pain is gone. Stop here if you want — slices 4 and 5 are independent enhancements.

- [ ] **Step 1: Update `docs/TODO.md`**

In `docs/TODO.md`, under "Carried into Phase 4", strike or remove the **Wire `/home` to the trips table** bullet (now done). Add a brief Phase 4 progress note that Slice 3 (and prerequisites) shipped today.

- [ ] **Step 2: Update `docs/DECISIONS.md`**

Append rows for:
- "One-table model for dreams + trips" (dates nullable + fuzzy_when)
- "Tone derived from slug hash" (no schema column)
- "/home four-band layout, hero claim rule" (Now ∪ Upcoming → soonest)

Use the existing table shape; date column is 2026-05-28.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: phase 4 slice 3 progress + decisions"
```

---

## Slice 4 — `+ new trip` form gains a dream toggle

### Task 4.1: Extend `createTrip` action for dreams

**Files:**
- Modify: `src/lib/trips/actions.ts`

- [ ] **Step 1: Update `CreateTripInput`**

In `src/lib/trips/actions.ts`, change the `CreateTripInput` interface (around line 207):

```ts
export interface CreateTripInput {
  name: string
  slug: string
  isDream: boolean
  startDate: string | null
  endDate: string | null
  fuzzyWhen: string | null
  country: string | null
  lat: number | null
  lng: number | null
}
```

- [ ] **Step 2: Branch validation in `createTrip`**

Replace the body of `createTrip` (function declared around line 231). The diff focus: after slug validation, branch on `isDream`, and pass `fuzzy_when` into the insert.

Full replacement of the `createTrip` function:

```ts
export async function createTrip(
  input: CreateTripInput,
): Promise<CreateTripResult> {
  const name = input.name.trim()
  if (!name) return { error: "Name required." }

  const slug = input.slug.trim()
  if (!SLUG_RE.test(slug)) {
    return { error: "Slug must be lowercase letters, numbers, hyphens." }
  }

  let startDate: string | null
  let endDate: string | null
  let fuzzyWhen: string | null

  if (input.isDream) {
    if (input.startDate || input.endDate) {
      return { error: "Dreams have no dates." }
    }
    startDate = null
    endDate = null
    fuzzyWhen = input.fuzzyWhen?.trim() || null
    if (fuzzyWhen && fuzzyWhen.length > 64) {
      return { error: "When? must be 64 characters or fewer." }
    }
  } else {
    if (!input.startDate || !input.endDate) {
      return { error: "Start and end dates required." }
    }
    if (input.endDate < input.startDate) {
      return { error: "End date must be on or after start date." }
    }
    if (input.fuzzyWhen) {
      return { error: "Trips don't have a 'when?' label." }
    }
    startDate = input.startDate
    endDate = input.endDate
    fuzzyWhen = null
  }

  const hasLat = input.lat !== null
  const hasLng = input.lng !== null
  if (hasLat !== hasLng) {
    return { error: "Coordinates invalid." }
  }
  if (hasLat) {
    if (!Number.isFinite(input.lat) || input.lat! < -90 || input.lat! > 90) {
      return { error: "Coordinates invalid." }
    }
    if (!Number.isFinite(input.lng) || input.lng! < -180 || input.lng! > 180) {
      return { error: "Coordinates invalid." }
    }
  }

  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "No workspace." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const country = input.country?.trim() || null

  const { error: insertError } = await supabase.from("trips").insert({
    workspace_id: workspace.id,
    slug,
    name,
    country,
    start_date: startDate,
    end_date: endDate,
    fuzzy_when: fuzzyWhen,
    lat: input.lat,
    lng: input.lng,
    created_by: userData.user.id,
  })

  if (insertError) {
    if (insertError.code === "23505") {
      return { error: "A trip with that slug already exists." }
    }
    return { error: insertError.message }
  }

  const { data: tripRow, error: lookupError } = await supabase
    .from("trips")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("slug", slug)
    .maybeSingle()
  if (lookupError || !tripRow) {
    return { error: lookupError?.message ?? "Trip not found after insert." }
  }

  const memberRows = workspace.members.map((m) => ({
    trip_id: tripRow.id,
    user_id: m.user_id,
    role: "member" as const,
  }))
  const { error: membersError } = await supabase
    .from("trip_members")
    .insert(memberRows)
  if (membersError) return { error: membersError.message }

  return { slug }
}
```

- [ ] **Step 3: Lint + build**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: TypeScript will fail at this point because `NewTripForm` still calls `createTrip` without `isDream` / `fuzzyWhen`. **This is expected** — Task 4.2 fixes it. Move directly to 4.2; do not commit a broken build.

---

### Task 4.2: Add dream toggle to `NewTripForm`

**Files:**
- Modify: `src/app/trips/new/new-trip-form.tsx`

- [ ] **Step 1: Add state for `isDream` + `fuzzyWhen`; branch rendering**

Replace the full contents of `src/app/trips/new/new-trip-form.tsx`:

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { createTrip } from "@/lib/trips/actions"
import { slugify } from "@/lib/trips/slugify"

const SLUG_RE = /^[a-z0-9-]+$/

function parseFloatOrNull(s: string): number | null {
  const trimmed = s.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export function NewTripForm() {
  const router = useRouter()
  const [name, setName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [slugDirty, setSlugDirty] = React.useState(false)
  const [isDream, setIsDream] = React.useState(false)
  const [startDate, setStartDate] = React.useState("")
  const [endDate, setEndDate] = React.useState("")
  const [fuzzyWhen, setFuzzyWhen] = React.useState("")
  const [country, setCountry] = React.useState("")
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [lat, setLat] = React.useState("")
  const [lng, setLng] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const nameRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const derivedSlug = React.useMemo(() => slugify(name), [name])
  const displayedSlug = slugDirty ? slug : derivedSlug

  const canSubmit =
    name.trim().length > 0 &&
    SLUG_RE.test(displayedSlug) &&
    !isPending

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    startTransition(async () => {
      const result = await createTrip({
        name,
        slug: displayedSlug,
        isDream,
        startDate: isDream ? null : startDate || null,
        endDate: isDream ? null : endDate || null,
        fuzzyWhen: isDream ? (fuzzyWhen.trim() || null) : null,
        country: country.trim() || null,
        lat: parseFloatOrNull(lat),
        lng: parseFloatOrNull(lng),
      })
      if (result.error) {
        setError(result.error)
        return
      }
      router.push(`/trips/${result.slug}`)
    })
  }

  return (
    <form onSubmit={submit} className="mt-6">
      <label className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={isDream}
          onChange={(e) => setIsDream(e.target.checked)}
          disabled={isPending}
          className="h-4 w-4 accent-foreground disabled:opacity-50"
        />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          This is a dream (no dates yet)
        </span>
      </label>

      <label className="mt-5 block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Name
        </span>
        <input
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Where to?"
          disabled={isPending}
          className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[16px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
      </label>

      <label className="mt-5 block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Slug
        </span>
        <input
          type="text"
          value={displayedSlug}
          onChange={(e) => {
            setSlug(e.target.value)
            setSlugDirty(true)
          }}
          placeholder="iceland-ring-road"
          disabled={isPending}
          className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
        <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
          URL: /trips/{displayedSlug || "—"}
        </span>
      </label>

      {isDream ? (
        <label className="mt-5 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            When?
          </span>
          <input
            type="text"
            value={fuzzyWhen}
            onChange={(e) => setFuzzyWhen(e.target.value)}
            placeholder="summer 2030, someday, ..."
            maxLength={64}
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          />
        </label>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-4">
          <label className="block">
            <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Start
            </span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={isPending}
              className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            />
          </label>
          <label className="block">
            <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              End
            </span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={isPending}
              className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            />
          </label>
        </div>
      )}

      <label className="mt-5 block">
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Country
        </span>
        <input
          type="text"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          placeholder="Optional"
          disabled={isPending}
          className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
        />
      </label>

      <button
        type="button"
        onClick={() => setAdvancedOpen((v) => !v)}
        disabled={isPending}
        className="mt-5 inline-flex items-center gap-1 border-0 bg-transparent font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
        aria-expanded={advancedOpen}
      >
        <span>{advancedOpen ? "▾" : "›"}</span>
        <span>advanced (lat / lng)</span>
      </button>

      {advancedOpen ? (
        <div className="mt-3 grid grid-cols-2 gap-4">
          <label className="block">
            <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Latitude
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="-8.6500"
              disabled={isPending}
              className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            />
          </label>
          <label className="block">
            <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Longitude
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              placeholder="116.3200"
              disabled={isPending}
              className="t-num mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            />
          </label>
        </div>
      ) : null}

      {error ? (
        <div className="mt-5 font-mono text-[10px] text-clay">{error}</div>
      ) : null}

      <div className="mt-7 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={isPending}
          className="border-0 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-full border-0 bg-foreground px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {isPending ? "…" : isDream ? "save dream" : "create trip"}
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Lint + build**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds. (Both Task 4.1 and 4.2 now align.)

- [ ] **Step 3: Functional check — create one trip + one dream**

Run: `pnpm dev`

In a browser, navigate to `/trips/new`:
- Test trip mode (toggle OFF): name "Kyoto", dates 2027-04-10 / 2027-04-17, country "Japan". Submit → land on `/trips/kyoto` (empty tabs).
- Navigate to `/home`: Kyoto appears in Trips (or Hero, if it has the soonest start_date among non-Lombok rows).

- Test dream mode (toggle ON): name "Iceland Ring", `When?` = "winter 2031". Submit → land on `/trips/iceland-ring`.
- Navigate to `/home`: Iceland Ring appears in the Dreams band tile, labeled "WINTER 2031" instead of "SOMEDAY".

- Test validation: toggle OFF + empty dates → submit → expect inline "Start and end dates required." Toggle ON + end_date typed → submit → expect "Dreams have no dates." (The form filters this client-side, but if someone bypasses, the server enforces.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/actions.ts src/app/trips/new/new-trip-form.tsx
git commit -m "feat(trips): dream toggle in + new trip form"
```

---

## Slice 5 — `/trips/[slug]` dream variant

### Task 5.1: Hero swap + weather hide for dreams

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx`

- [ ] **Step 1: Add a `isDream` boolean and branch the hero rendering**

In `src/app/trips/[slug]/page.tsx`, find `TripHeaderView` (around line 213). Modify the rendering so that when `header.startDate === null`, the date-range row is replaced by the uppercase `fuzzyWhen` string (or `"SOMEDAY"`), and a `// dream` `MonoBadge` appears near the top.

Replace the full `TripHeaderView` function:

```tsx
function TripHeaderView({
  header,
  workspace,
}: {
  header: TripHeader
  workspace: NonNullable<Awaited<ReturnType<typeof getCurrentWorkspace>>>
}) {
  const coord = formatCoord(header.lat, header.lng)
  const dateRange = formatDateRange(header.startDate, header.endDate)
  const members = workspace.members
  const tripCount = `${String(header.index).padStart(2, "0")} of ${String(header.total).padStart(2, "0")}`
  const isDream = header.startDate === null
  const fuzzyLabel = (header.fuzzyWhen ?? "someday").toUpperCase()

  return (
    <header className="relative overflow-hidden bg-sea-tint px-5 pt-14 pb-5 lg:px-10 lg:pt-10 lg:pb-7">
      <TopoBg tone="sea" opacity={0.18} />
      <div className="relative mb-6 flex items-center justify-between lg:hidden">
        <Link
          href="/home"
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          <Chevron dir="left" /> back
        </Link>
        <Label>{isDream ? "Dream" : `Trip · ${tripCount}`}</Label>
      </div>
      <div className="relative hidden lg:block lg:mb-2">
        <Label>{isDream ? "Dream" : `Trip · ${tripCount}`}</Label>
      </div>
      <div className="relative flex items-end justify-between">
        <div>
          {coord ? <Coord>{coord}</Coord> : null}
          <div className="flex items-baseline gap-4">
            <h1 className="t-display mt-0.5 text-[64px] text-foreground lg:text-[88px] lg:leading-[0.9]">
              <em>{header.name}</em>
            </h1>
            <WaveGlyph color="var(--sea)" w={56} h={14} className="hidden lg:block" />
          </div>
          {header.country ? (
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              {header.country}
            </div>
          ) : null}
        </div>
        <WaveGlyph color="var(--sea)" w={56} h={14} className="lg:hidden" />
      </div>
      <div className="relative mt-4 flex items-center justify-between lg:mt-5">
        {isDream ? (
          <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-foreground">
            {fuzzyLabel}
          </div>
        ) : dateRange ? (
          <div className="font-mono text-[12px] text-foreground">{dateRange}</div>
        ) : (
          <span />
        )}
        {members.length >= 2 ? (
          <PairAvatar
            a={members[0].display_name}
            b={members[1].display_name}
            size={22}
          />
        ) : null}
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Hide the weather strip + desktop weather grid for dreams**

In the main render block of `TripPage`, find this section (around line 165):

```tsx
{activeTab === "itinerary" && detail ? (
  <div className="lg:hidden">
    <WeatherStrip detail={detail} />
  </div>
) : null}
```

Change it to:

```tsx
{activeTab === "itinerary" && detail && header.startDate ? (
  <div className="lg:hidden">
    <WeatherStrip detail={detail} />
  </div>
) : null}
```

Then locate the `DesktopRightRail` call (around line 199):

```tsx
<DesktopRightRail
  detail={detail}
  packing={{ done: packingDone, total: packingTotal }}
  budget={{
    spentCents: budgetSummary.expenseTotalCents,
    plannedCents: detail?.plannedBudgetCents ?? 0,
  }}
/>
```

Change to:

```tsx
<DesktopRightRail
  detail={header.startDate ? detail : null}
  packing={{ done: packingDone, total: packingTotal }}
  budget={{
    spentCents: budgetSummary.expenseTotalCents,
    plannedCents: detail?.plannedBudgetCents ?? 0,
  }}
/>
```

(Passing `null` for `detail` when there are no dates hides the right-rail weather block — `DesktopRightRail` already guards on `detail ?`.)

- [ ] **Step 3: Itinerary empty-state for dreams**

In the itinerary branch of `TripPage`'s render (around line 170):

```tsx
{activeTab === "itinerary" ? (
  itinerary && itinerary.length > 0 ? (
    <ItineraryView itinerary={itinerary} />
  ) : (
    <TabStub label="Itinerary" />
  )
) : ...}
```

Change it to:

```tsx
{activeTab === "itinerary" ? (
  itinerary && itinerary.length > 0 ? (
    <ItineraryView itinerary={itinerary} />
  ) : header.startDate === null ? (
    <DreamItineraryStub />
  ) : (
    <TabStub label="Itinerary" />
  )
) : ...}
```

Then add a new `DreamItineraryStub` function below `TabStub` (around line 382):

```tsx
function DreamItineraryStub() {
  return (
    <section className="px-5 pt-6">
      <Label>Itinerary</Label>
      <p className="mt-3 font-serif text-[15px] italic text-muted-foreground">
        No days planned yet — add dates to plan day-by-day.
      </p>
    </section>
  )
}
```

- [ ] **Step 4: Lint + build**

Run: `pnpm lint`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Visual check — Lombok unchanged, dreams render variant**

Run: `pnpm dev`

- `/trips/lombok` — should look identical to before (dates, weather, itinerary).
- `/trips/faroe-islands` — hero shows `SOMEDAY` instead of date range; "Dream" label at top; no weather strip; itinerary tab shows the dream stub; packing + budget tabs work (empty initially).
- `/trips/patagonia`, `/trips/hokkaido`, `/trips/aeolian-isles` — same dream variant.

- [ ] **Step 6: Commit**

```bash
git add src/app/trips/[slug]/page.tsx
git commit -m "feat(trips): dream variant of /trips/[slug] (hero, weather, itinerary)"
```

---

### Task 5.2: Phase 4 wrap

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Mark Phase 4 (this slice batch) complete in `docs/TODO.md`**

Add a "Phase 4 — Dream-Trip Pipeline: complete" section summarizing the 5 slices shipped today, mirroring the Phase 3.5 entry shape.

- [ ] **Step 2: Append remaining decisions to `docs/DECISIONS.md`**

Append rows for:
- "Dream toggle in the existing form" (vs separate route)
- "`/trips/[slug]` branches internally" (no separate `/dreams/[slug]`)
- "Itinerary tab stays empty for dreams" (don't relax `day_date NOT NULL`)
- "Lombok keeps its sea tone via slug special-case"

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: phase 4 dream-trip pipeline complete"
```

---

## Self-review checklist (for the executor — not the planner)

Before submitting any PR derived from this plan:

1. `pnpm lint` clean.
2. `pnpm build` clean.
3. `/home` at 390 / 768 / 1280: all four bands render correctly given the current dataset.
4. `/trips/lombok` unchanged visually from pre-Phase-4.
5. `/trips/<dream-slug>` renders the dream variant (no weather, dream stub on itinerary, fuzzy_when in hero).
6. Create a new trip + a new dream via `/trips/new`, both land on their pages, both appear on `/home` in the right band.
