# Itinerary Locations — Implementation Plan (Slice 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `itinerary_locations` layer to dated trips so the itinerary renders as editable location tabs grouping the day cards, without yet changing how dates are assigned.

**Architecture:** A new lightweight `itinerary_locations` table (name + sort_order, RLS + Realtime like `itinerary_days`) plus a nullable `location_id` FK on `itinerary_days` (`null` = travel day). The dated `ItineraryTab` gains a location tab strip with create/rename/delete; the active tab filters the existing day cards by `location_id`. The trek `group_id` "added together" box keeps rendering inside a tab. Date handling, the add-day date picker, and cascade are **unchanged in this slice** — that is Slice 2.

**Tech Stack:** Next.js 16 App Router + Server Actions, Supabase (`@supabase/ssr`, Postgres + RLS + Realtime), React 19 client components, dnd-kit (existing), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-06-03-itinerary-locations-design.md` (this plan implements Slice 1 only).

---

## Conventions for this repo (read first)

- **No test framework exists.** Do not invent `pnpm test`. "Verify" steps mean: run `pnpm lint` (must be clean) and `pnpm build` (must compile + pass TypeScript), then look at the result in the browser at `http://localhost:3001` (dev server may already be running; `pnpm dev` otherwise — it falls back to 3001 when 3000 is busy).
- **Migrations are paste-and-run** in the Supabase SQL Editor and must be **idempotent** (`if not exists` / `drop ... if exists` then create / `do $$ ... exception` blocks). Keep the `.sql` file in `supabase/migrations/` as source of truth.
- **Client/types split:** `"use client"` files import types/helpers from `*-types.ts`, never from `*-queries.ts` (which pull `next/headers`).
- **Branch first:** you are on `main` with uncommitted work. Before Task 1, create a branch (or worktree): `git switch -c feat/itinerary-locations`. Commit after each task.
- **No emojis** in code/logs. Sparse comments. Short functions.

## File structure (Slice 1)

- Create `supabase/migrations/20260603000002_itinerary_locations.sql` — table, RLS, Realtime, `location_id` column.
- Create `src/lib/trips/location-types.ts` — `ItineraryLocation` type + `rowToLocation`.
- Create `src/lib/trips/location-queries.ts` — `getItineraryLocations(tripId)`.
- Modify `src/lib/trips/itinerary-types.ts` — add `locationId` to `ItineraryDay` + `ItineraryRow`.
- Modify `src/lib/trips/itinerary-queries.ts` — select `location_id`.
- Modify `src/lib/trips/actions.ts` — location CRUD actions; `location_id` on add/update day.
- Modify `src/app/trips/[slug]/page.tsx` — fetch locations, pass to `ItineraryTab`.
- Modify `src/app/trips/[slug]/itinerary-tab.tsx` — location tab strip, grouping, CRUD UI, assign.

---

## Task 1: Migration — locations table + `location_id`

**Files:**
- Create: `supabase/migrations/20260603000002_itinerary_locations.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Itinerary locations: an editable, ordered grouping layer over itinerary_days.
-- A day's location_id is nullable (null = a travel/transit day). Locations and
-- the trek group_id are different axes; this migration only adds the location
-- layer and does not touch dates.

create table if not exists public.itinerary_locations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sort_order int not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists itinerary_locations_trip_order_idx
  on public.itinerary_locations (trip_id, sort_order);

alter table public.itinerary_locations enable row level security;

drop policy if exists itinerary_locations_select on public.itinerary_locations;
create policy itinerary_locations_select on public.itinerary_locations
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists itinerary_locations_insert on public.itinerary_locations;
create policy itinerary_locations_insert on public.itinerary_locations
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );

drop policy if exists itinerary_locations_update on public.itinerary_locations;
create policy itinerary_locations_update on public.itinerary_locations
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));

drop policy if exists itinerary_locations_delete on public.itinerary_locations;
create policy itinerary_locations_delete on public.itinerary_locations
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- Days point at a location; deleting a location detaches its days (set null),
-- turning them into travel days rather than destroying content.
alter table public.itinerary_days
  add column if not exists location_id uuid
  references public.itinerary_locations(id) on delete set null;

-- Live tab updates for both partners.
do $$
begin
  alter publication supabase_realtime add table public.itinerary_locations;
exception
  when duplicate_object then null;
end $$;
```

- [ ] **Step 2: Apply it**

Paste the file into the Supabase SQL Editor and run. Re-run once to confirm idempotency (no errors the second time).

- [ ] **Step 3: Verify schema**

In the SQL Editor run: `select id, name, sort_order from public.itinerary_locations limit 1;` (expect 0 rows, no error) and `select location_id from public.itinerary_days limit 1;` (expect a column, null values).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260603000002_itinerary_locations.sql
git commit -m "feat(itinerary): locations table + day location_id (migration)"
```

---

## Task 2: Location types + query

**Files:**
- Create: `src/lib/trips/location-types.ts`
- Create: `src/lib/trips/location-queries.ts`

- [ ] **Step 1: Write the types**

`src/lib/trips/location-types.ts`:

```ts
export interface ItineraryLocation {
  id: string
  name: string
  sortOrder: number
}

export interface ItineraryLocationRow {
  id: string
  name: string
  sort_order: number
}

export function rowToLocation(row: ItineraryLocationRow): ItineraryLocation {
  return { id: row.id, name: row.name, sortOrder: row.sort_order }
}
```

- [ ] **Step 2: Write the query**

`src/lib/trips/location-queries.ts`:

```ts
import { createClient } from "@/lib/supabase/server"

import {
  rowToLocation,
  type ItineraryLocation,
} from "@/lib/trips/location-types"

export async function getItineraryLocations(
  tripId: string,
): Promise<ItineraryLocation[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("itinerary_locations")
    .select("id, name, sort_order")
    .eq("trip_id", tripId)
    .order("sort_order", { ascending: true })

  return (data ?? []).map(rowToLocation)
}
```

- [ ] **Step 3: Verify**

Run: `pnpm lint` then `pnpm build`. Expected: clean lint, successful build (the new files are imported nowhere yet, so this only checks they typecheck).

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/location-types.ts src/lib/trips/location-queries.ts
git commit -m "feat(itinerary): location types + query"
```

---

## Task 3: Thread `location_id` through itinerary day types + query

**Files:**
- Modify: `src/lib/trips/itinerary-types.ts`
- Modify: `src/lib/trips/itinerary-queries.ts`

- [ ] **Step 1: Add `locationId` to the day types**

In `src/lib/trips/itinerary-types.ts`, the `ItineraryDay` interface already ends with `groupId: string | null`. Add a line after it:

```ts
  /** Location this day is filed under; null = a travel/transit day. */
  locationId: string | null
```

And in `ItineraryRow` (which ends with `group_id?: string | null`) add:

```ts
  location_id?: string | null
```

- [ ] **Step 2: Map it in `rowToItineraryDay`**

In the same file, `rowToItineraryDay` returns an object ending with `groupId: row.group_id ?? null,`. Add after it:

```ts
    locationId: row.location_id ?? null,
```

(`withOrdinals` spreads `...day`, so it preserves `locationId` automatically — no change there.)

- [ ] **Step 3: Select the column**

In `src/lib/trips/itinerary-queries.ts`, change the select line from:

```ts
    .select("id, day_date, title, sub, tag, tone, group_id")
```

to:

```ts
    .select("id, day_date, title, sub, tag, tone, group_id, location_id")
```

- [ ] **Step 4: Verify**

Run: `pnpm lint` then `pnpm build`. Expected: clean (existing call sites still compile; new field is optional on the row and defaulted in the mapper).

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/itinerary-types.ts src/lib/trips/itinerary-queries.ts
git commit -m "feat(itinerary): thread location_id through day type + query"
```

---

## Task 4: Location CRUD server actions

**Files:**
- Modify: `src/lib/trips/actions.ts`

- [ ] **Step 1: Import the location helpers**

Near the other `@/lib/trips/...` imports at the top of `actions.ts`, add:

```ts
import {
  rowToLocation,
  type ItineraryLocation,
} from "@/lib/trips/location-types"
```

- [ ] **Step 2: Append the four actions**

Add at the end of `actions.ts`. Mirrors the packing-category actions (sort_order = max+1 on create; sort_order = index on reorder).

```ts
export interface CreateLocationResult {
  error?: string
  /** Populated on success so the client can append optimistically. */
  location?: ItineraryLocation
}

/** Creates an empty location at the end of the trip's order. */
export async function createItineraryLocation(
  tripId: string,
  tripSlug: string,
  name: string,
): Promise<CreateLocationResult> {
  const trimmed = name.trim()
  if (!trimmed) return { error: "Name required." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { data: maxRow } = await supabase
    .from("itinerary_locations")
    .select("sort_order")
    .eq("trip_id", tripId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (maxRow?.sort_order ?? -1) + 1

  const { data, error } = await supabase
    .from("itinerary_locations")
    .insert({
      trip_id: tripId,
      name: trimmed,
      sort_order: nextOrder,
      created_by: userData.user.id,
    })
    .select("id, name, sort_order")
    .single()

  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return { location: rowToLocation(data) }
}

export interface RenameLocationResult {
  error?: string
}

/** Renames a location in place. */
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

export interface ReorderLocationsResult {
  error?: string
}

/** Rewrites sort_order to match the given id order (sort_order = index). */
export async function reorderItineraryLocations(
  tripSlug: string,
  orderedIds: string[],
): Promise<ReorderLocationsResult> {
  const supabase = await createClient()

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("itinerary_locations")
      .update({ sort_order: i })
      .eq("id", orderedIds[i])
    if (error) return { error: error.message }
  }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}

export interface DeleteLocationResult {
  error?: string
}

/**
 * Deletes a location. The FK `on delete set null` detaches its days, which
 * become travel days (location_id null) rather than being deleted.
 */
export async function deleteItineraryLocation(
  locationId: string,
  tripSlug: string,
): Promise<DeleteLocationResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("itinerary_locations")
    .delete()
    .eq("id", locationId)

  if (error) return { error: error.message }

  revalidatePath(`/trips/${tripSlug}`)
  return {}
}
```

- [ ] **Step 3: Verify**

Run: `pnpm lint` then `pnpm build`. Expected: clean (actions are unused so far; this checks they typecheck and the import resolves).

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(itinerary): location CRUD server actions"
```

---

## Task 5: Day add/update accept a `location_id`

**Files:**
- Modify: `src/lib/trips/actions.ts`

- [ ] **Step 1: Add `locationId` to the add input + insert**

In `AddItineraryDayInput`, add a field (after `tone`):

```ts
  /** Location to file the day(s) under; null/undefined = travel day. */
  locationId?: string | null
```

In `addItineraryDay`, the inserted `rows` currently include `group_id: groupId,`. Add alongside it:

```ts
    location_id: input.locationId ?? null,
```

And extend the returning select so the new field round-trips. Change:

```ts
    .select("id, day_date, title, sub, tag, tone, group_id")
```

to:

```ts
    .select("id, day_date, title, sub, tag, tone, group_id, location_id")
```

- [ ] **Step 2: Add `locationId` to the update input + patch**

In `UpdateItineraryDayInput`, add (after `tone`):

```ts
  /** When provided, moves the day to this location (null = travel day). */
  locationId?: string | null
```

In `updateItineraryDay`, the `.update({...})` currently sets `day_date`, `title`, `sub`, `tag`, `tone`. Add `location_id` only when the caller provided it, so existing callers are unaffected. Replace the update call with:

```ts
  const patch: {
    day_date: string
    title: string
    sub: string
    tag: string
    tone: ItineraryTone
    location_id?: string | null
  } = {
    day_date: input.dayDate,
    title,
    sub,
    tag,
    tone: input.tone,
  }
  if (input.locationId !== undefined) patch.location_id = input.locationId

  const { error } = await supabase
    .from("itinerary_days")
    .update(patch)
    .eq("id", input.dayId)
```

- [ ] **Step 3: Verify**

Run: `pnpm lint` then `pnpm build`. Expected: clean. Existing `addItineraryDay` / `updateItineraryDay` callers omit `locationId`, which is optional, so they still compile.

- [ ] **Step 4: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(itinerary): add/update day accept location_id"
```

---

## Task 6: Render location tabs + filter days by active tab

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx`
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`

This task makes tabs visible and switchable (read-only — CRUD is Task 7). After it, existing Lombok days (all `location_id` null) show under an **In transit** tab.

- [ ] **Step 1: Fetch locations in the page**

In `src/app/trips/[slug]/page.tsx`, add an import near the other trip queries:

```ts
import { getItineraryLocations } from "@/lib/trips/location-queries"
```

In the `Promise.all([...])` (currently destructured as `const [datedItinerary, dreamItinerary, notes, packingItems, packingCategories, expenses] = await Promise.all([...])`), add `locations` as a new first-class entry. Change the destructure to:

```ts
  const [datedItinerary, dreamItinerary, locations, notes, packingItems, packingCategories, expenses] =
    await Promise.all([
      showItinerary && !isDream ? getItineraryDays(header.id) : Promise.resolve(null),
      showItinerary && isDream ? getDreamItineraryDays(header.id) : Promise.resolve(null),
      showItinerary && !isDream ? getItineraryLocations(header.id) : Promise.resolve(null),
      activeTab === "notes" ? getTripNotes(header.id) : Promise.resolve(null),
      getPackingItems(header.id),
      getPackingCategories(header.id),
      getTripExpenses(header.id),
    ])
```

In the `<ItineraryTab .../>` JSX, add the prop:

```tsx
            <ItineraryTab
              tripId={header.id}
              tripSlug={header.slug}
              tripStartDate={header.startDate}
              initialItems={datedItinerary ?? []}
              initialLocations={locations ?? []}
            />
```

- [ ] **Step 2: Import the location type in the tab**

In `src/app/trips/[slug]/itinerary-tab.tsx`, add to the imports:

```ts
import type { ItineraryLocation } from "@/lib/trips/location-types"
```

- [ ] **Step 3: Add an `orderTabs` helper**

Add near `toSegments` (module scope) in `itinerary-tab.tsx`:

```ts
/** Order locations by earliest day date, empties last by sortOrder. */
function orderTabs(
  locations: ItineraryLocation[],
  days: ItineraryDay[],
): ItineraryLocation[] {
  const earliest = new Map<string, string>()
  for (const d of days) {
    if (!d.locationId) continue
    const cur = earliest.get(d.locationId)
    if (cur === undefined || d.dayDate < cur) earliest.set(d.locationId, d.dayDate)
  }
  return [...locations].sort((a, b) => {
    const da = earliest.get(a.id)
    const db = earliest.get(b.id)
    if (da && db) return da < db ? -1 : da > db ? 1 : a.sortOrder - b.sortOrder
    if (da) return -1
    if (db) return 1
    return a.sortOrder - b.sortOrder
  })
}
```

- [ ] **Step 4: Accept the prop + add locations state**

Change the `ItineraryTab` signature to accept `initialLocations`:

```ts
export function ItineraryTab({
  tripId,
  tripSlug,
  tripStartDate,
  initialItems,
  initialLocations,
}: {
  tripId: string
  tripSlug: string
  tripStartDate: string
  initialItems: ItineraryDay[]
  initialLocations: ItineraryLocation[]
}) {
```

Just below the existing `days` / `lastInitial` / `editingId` state, add location state mirroring the same controlled-from-props pattern:

```ts
  const [locations, setLocations] = React.useState<ItineraryLocation[]>(
    initialLocations,
  )
  const [lastInitialLocations, setLastInitialLocations] =
    React.useState(initialLocations)
  const [activeLocationId, setActiveLocationId] = React.useState<string | null>(
    initialLocations[0]?.id ?? null,
  )

  if (initialLocations !== lastInitialLocations) {
    setLastInitialLocations(initialLocations)
    setLocations(initialLocations)
  }
```

- [ ] **Step 5: Subscribe to location changes (Realtime)**

Add a second `useEffect` after the existing `itinerary_days` channel effect:

```ts
  React.useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`itinerary-locations-${tripId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "itinerary_locations",
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const r = payload.new as {
              id: string
              name: string
              sort_order: number
            }
            const incoming: ItineraryLocation = {
              id: r.id,
              name: r.name,
              sortOrder: r.sort_order,
            }
            setLocations((prev) =>
              prev.some((l) => l.id === incoming.id)
                ? prev
                : [...prev, incoming].sort((a, b) => a.sortOrder - b.sortOrder),
            )
          } else if (payload.eventType === "UPDATE") {
            const r = payload.new as {
              id: string
              name: string
              sort_order: number
            }
            setLocations((prev) =>
              prev
                .map((l) =>
                  l.id === r.id
                    ? { id: r.id, name: r.name, sortOrder: r.sort_order }
                    : l,
                )
                .sort((a, b) => a.sortOrder - b.sortOrder),
            )
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string }
            if (old.id) {
              setLocations((prev) => prev.filter((l) => l.id !== old.id))
            }
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tripId])
```

- [ ] **Step 6: Compute the active tab + filtered days**

Just before the `return (`, after the existing `defaultDate` / `sensors` setup, add:

```ts
  const orderedTabs = orderTabs(locations, days)
  const hasTravel = days.some((d) => !d.locationId)
  const tabIds = orderedTabs.map((t) => t.id)
  const effectiveActive =
    activeLocationId !== null && tabIds.includes(activeLocationId)
      ? activeLocationId
      : activeLocationId === null && hasTravel
        ? null
        : (tabIds[0] ?? null)
  const tabDays = days.filter((d) => (d.locationId ?? null) === effectiveActive)
```

- [ ] **Step 7: Add the tab strip + filter the list in the JSX**

In the `return`, immediately after the header `<div className="flex items-baseline justify-between ...">...</div>`, insert the tab strip:

```tsx
      <div className="flex gap-1.5 overflow-x-auto px-5 pt-3 lg:px-10">
        {orderedTabs.map((loc) => (
          <button
            key={loc.id}
            type="button"
            onClick={() => setActiveLocationId(loc.id)}
            aria-pressed={effectiveActive === loc.id}
            className={`whitespace-nowrap rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
              effectiveActive === loc.id
                ? "border-foreground bg-foreground text-background"
                : "border-rule bg-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {loc.name}
          </button>
        ))}
        {hasTravel ? (
          <button
            type="button"
            onClick={() => setActiveLocationId(null)}
            aria-pressed={effectiveActive === null}
            className={`whitespace-nowrap rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
              effectiveActive === null
                ? "border-foreground bg-foreground text-background"
                : "border-rule bg-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            In transit
          </button>
        ) : null}
      </div>
```

Then, in the days-list block, change the source list from `days` to `tabDays` in both the empty check and the `toSegments(...)` map, and the `isLast` reference. Specifically: the `{days.length === 0 ? (` guard stays the same overall section, but the inner mapping uses `tabDays`. Replace the `toSegments(days).map(...)` call with `toSegments(tabDays).map(...)`, and inside it change `isLast={day.id === days[days.length - 1].id}` to `isLast={day.id === tabDays[tabDays.length - 1].id}`. Also change the empty-state guard wrapping the DndContext from `days.length === 0` to `tabDays.length === 0` so an empty tab shows the "No days planned yet" line.

- [ ] **Step 8: Verify**

Run: `pnpm lint` then `pnpm build`. Then in the browser open `http://localhost:3001/trips/lombok`. Expected: an **In transit** tab appears (all existing days are unfiled) and shows the full day list; the trek "added together" box still renders. No console hydration errors.

- [ ] **Step 9: Commit**

```bash
git add src/app/trips/[slug]/page.tsx src/app/trips/[slug]/itinerary-tab.tsx
git commit -m "feat(itinerary): location tab strip + filter days by active tab"
```

---

## Task 7: Create / rename / delete locations from the tab strip

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`

- [ ] **Step 1: Import the location actions**

Extend the existing `@/lib/trips/actions` import to include the three actions used here:

```ts
import {
  addItineraryDay,
  createItineraryLocation,
  deleteItineraryDay,
  deleteItineraryLocation,
  renameItineraryLocation,
  rescheduleItineraryDays,
  updateItineraryDay,
} from "@/lib/trips/actions"
```

- [ ] **Step 2: Add state + handlers**

Add these immediately after the `tabDays` computation from Task 6, Step 6 (so `effectiveActive` and `orderedTabs` are in scope):

```ts
  const [addMenuOpen, setAddMenuOpen] = React.useState(false)
  const [addDayOpen, setAddDayOpen] = React.useState(false)
  const [addingLocation, setAddingLocation] = React.useState(false)
  const [newLocName, setNewLocName] = React.useState("")
  const [renaming, setRenaming] = React.useState(false)
  const [renameVal, setRenameVal] = React.useState("")
  const [, startLoc] = React.useTransition()

  function submitNewLocation(e: React.FormEvent) {
    e.preventDefault()
    const name = newLocName.trim()
    if (!name) return
    startLoc(async () => {
      const result = await createItineraryLocation(tripId, tripSlug, name)
      if (!result.error && result.location) {
        setActiveLocationId(result.location.id)
      }
      setNewLocName("")
      setAddingLocation(false)
    })
  }

  function submitRename(e: React.FormEvent) {
    e.preventDefault()
    const name = renameVal.trim()
    if (!name || effectiveActive === null) return
    startLoc(async () => {
      await renameItineraryLocation(effectiveActive, tripSlug, name)
      setRenaming(false)
    })
  }

  function removeActiveLocation() {
    if (effectiveActive === null) return
    if (
      !window.confirm("Delete this location? Its days become travel days.")
    ) {
      return
    }
    const id = effectiveActive
    startLoc(async () => {
      await deleteItineraryLocation(id, tripSlug)
      setActiveLocationId(null)
    })
  }
```

- [ ] **Step 3: Add the unified expanding "+" control to the tab strip**

Inside the tab-strip `<div>` from Task 6 (after the `hasTravel` button block, still inside the div), append the trailing add control. It is **press-primary** (tap "+" toggles `addMenuOpen`) with a **hover bonus** on desktop (`hidden group-hover:flex` shows the menu while hovering when not pressed-open). The menu has two items: **+ day** (opens the add-day form into the active location) and **+ location** (reveals the inline name input).

```tsx
        {addingLocation ? (
          <form onSubmit={submitNewLocation} className="inline-flex">
            <input
              type="text"
              autoFocus
              value={newLocName}
              onChange={(e) => setNewLocName(e.target.value)}
              onBlur={() => {
                if (!newLocName.trim()) setAddingLocation(false)
              }}
              placeholder="Location name"
              className="rounded-full border border-clay bg-transparent px-3 py-1 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </form>
        ) : (
          <div className="relative shrink-0 group">
            <button
              type="button"
              onClick={() => setAddMenuOpen((v) => !v)}
              aria-expanded={addMenuOpen}
              aria-label="Add to itinerary"
              className="rounded-full border border-dashed border-rule px-3 py-1 font-mono text-[13px] leading-none text-muted-foreground hover:border-foreground hover:text-foreground"
            >
              +
            </button>
            <div
              className={`absolute right-0 z-10 mt-1 w-32 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm ${
                addMenuOpen ? "flex" : "hidden group-hover:flex"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setAddMenuOpen(false)
                  setAddDayOpen(true)
                }}
                className="px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:bg-foreground hover:text-background"
              >
                + day
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddMenuOpen(false)
                  setAddingLocation(true)
                }}
                className="px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:bg-foreground hover:text-background"
              >
                + location
              </button>
            </div>
          </div>
        )}
```

- [ ] **Step 4: Add a rename/delete row for the active location**

Immediately after the closing `</div>` of the tab strip, insert:

```tsx
      {effectiveActive !== null ? (
        <div className="flex items-center gap-3 px-5 pt-2 lg:px-10">
          {renaming ? (
            <form onSubmit={submitRename} className="inline-flex">
              <input
                type="text"
                autoFocus
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onBlur={() => setRenaming(false)}
                className="border-0 border-b border-rule bg-transparent py-0.5 text-[13px] text-foreground focus:border-clay focus:outline-none"
              />
            </form>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  const name =
                    orderedTabs.find((t) => t.id === effectiveActive)?.name ?? ""
                  setRenameVal(name)
                  setRenaming(true)
                }}
                className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
              >
                rename
              </button>
              <button
                type="button"
                onClick={removeActiveLocation}
                className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-clay"
              >
                delete
              </button>
            </>
          )}
        </div>
      ) : null}
```

- [ ] **Step 5: Verify**

Run: `pnpm lint` then `pnpm build`. In the browser: tap the **+** in the tab strip → the menu expands (and on desktop, hovering it also expands) → choose **+ location**, type "Kuta", submit → a new active (empty) "Kuta" tab appears showing "No days planned yet". Click **rename** → change to "Kuta Beach" → it updates. Click **delete** → confirm → tab disappears. Open a second browser/profile to confirm the tab changes arrive live (Realtime).

- [ ] **Step 6: Commit**

```bash
git add src/app/trips/[slug]/itinerary-tab.tsx
git commit -m "feat(itinerary): create/rename/delete locations from the tab strip"
```

---

## Task 8: Controlled add-day form, opened by the "+ day" menu item

The "+ day" item (Task 7) sets `addDayOpen`. `AddDayRow` becomes **controlled** by that flag (its own collapsed "+ add day" button is removed), files the new day under the active location, and closes on submit/cancel.

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`

- [ ] **Step 1: Pass `open` / `onClose` / `locationId` at the call site**

At the `<AddDayRow .../>` call site, replace it with:

```tsx
        <AddDayRow
          tripId={tripId}
          tripSlug={tripSlug}
          defaultDate={defaultDate}
          locationId={effectiveActive}
          open={addDayOpen}
          onClose={() => setAddDayOpen(false)}
        />
```

- [ ] **Step 2: Make `AddDayRow` controlled**

Replace the **entire** `AddDayRow` function with the version below. Changes from the original: drops the internal `expanded` state and the collapsed "+ add day" button (the "+" menu now opens it); gates rendering on `open`; routes `reset()` through `onClose()`; sends `locationId` to the action.

```tsx
function AddDayRow({
  tripId,
  tripSlug,
  defaultDate,
  locationId,
  open,
  onClose,
}: {
  tripId: string
  tripSlug: string
  defaultDate: string
  locationId: string | null
  open: boolean
  onClose: () => void
}) {
  const [dayDate, setDayDate] = React.useState(defaultDate)
  const [endDate, setEndDate] = React.useState("")
  const [tag, setTag] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [sub, setSub] = React.useState("")
  const [tone, setTone] = React.useState<ItineraryTone>("sea")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function reset() {
    onClose()
    setDayDate(defaultDate)
    setEndDate("")
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
        endDate,
        title,
        sub,
        tag,
        tone,
        locationId,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      reset()
    })
  }

  if (!open) return null

  return (
    <DayForm
      heading="Add day"
      dayDate={dayDate}
      setDayDate={setDayDate}
      endDate={endDate}
      setEndDate={setEndDate}
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
```

- [ ] **Step 3: Verify**

Run: `pnpm lint` then `pnpm build`. In the browser: select the "Kuta" tab, tap **+** → **+ day**, fill the form, add → the day appears under Kuta (not In transit). Cancel closes the form. Switch tabs to confirm filing. The trek "added together" box still works within a tab.

- [ ] **Step 4: Commit**

```bash
git add src/app/trips/[slug]/itinerary-tab.tsx
git commit -m "feat(itinerary): unified + menu opens add-day under active location"
```

---

## Task 9: Move an existing day between locations (edit form)

This lets you file the existing Lombok days (all currently "In transit") into the locations you create. It threads the `locations` list down to the edit form and adds a Location `<select>`.

**Files:**
- Modify: `src/app/trips/[slug]/itinerary-tab.tsx`

- [ ] **Step 1: Thread `locations` into the day cards**

Add `locations` to `DayCardProps`:

```ts
interface DayCardProps {
  day: ItineraryDay
  tripSlug: string
  isLast: boolean
  isEditing: boolean
  onStartEdit: () => void
  onStopEdit: () => void
  dragHandle?: React.ReactNode
  locations: ItineraryLocation[]
}
```

In `DayCard`, destructure `locations` and pass it to `DayEditor`:

```tsx
function DayCard({
  day,
  tripSlug,
  isLast,
  isEditing,
  onStartEdit,
  onStopEdit,
  dragHandle,
  locations,
}: DayCardProps) {
  if (isEditing) {
    return (
      <DayEditor
        day={day}
        tripSlug={tripSlug}
        locations={locations}
        onDone={onStopEdit}
      />
    )
  }
  return (
    <DayView
      day={day}
      tripSlug={tripSlug}
      isLast={isLast}
      onStartEdit={onStartEdit}
      dragHandle={dragHandle}
    />
  )
}
```

`SortableDayCard` already spreads `{...rest}` into `DayCard`, so it needs no change. At the `<SortableDayCard .../>` call site in the days map, add the prop:

```tsx
                  locations={locations}
```

- [ ] **Step 2: Give `DayEditor` a location state + send it on save**

In `DayEditor`, change the signature and add `locationId` state:

```ts
function DayEditor({
  day,
  tripSlug,
  locations,
  onDone,
}: {
  day: ItineraryDay
  tripSlug: string
  locations: ItineraryLocation[]
  onDone: () => void
}) {
  const [dayDate, setDayDate] = React.useState(day.dayDate)
  const [tag, setTag] = React.useState(day.tag)
  const [title, setTitle] = React.useState(day.title)
  const [sub, setSub] = React.useState(day.sub)
  const [tone, setTone] = React.useState<ItineraryTone>(day.tone)
  const [locationId, setLocationId] = React.useState<string | null>(
    day.locationId,
  )
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
```

In its `save`, add `locationId` to the `updateItineraryDay({...})` call:

```ts
      const result = await updateItineraryDay({
        dayId: day.id,
        tripSlug,
        dayDate,
        title,
        sub,
        tag,
        tone,
        locationId,
      })
```

And pass the location props to `DayForm` (add to the existing `<DayForm ... />` for the editor):

```tsx
      locations={locations}
      locationId={locationId}
      setLocationId={setLocationId}
```

- [ ] **Step 3: Render the select in `DayForm`**

Add three optional props to `DayForm`'s prop type (after `setTone`):

```ts
  /** When provided (Edit mode), a Location select moves the day. */
  locations?: ItineraryLocation[]
  locationId?: string | null
  setLocationId?: (v: string | null) => void
```

And render the select after the Tone block (before the `{error ? ... : null}` line):

```tsx
      {locations && setLocationId ? (
        <label className="mt-3 block">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Location
          </span>
          <select
            value={locationId ?? ""}
            onChange={(e) =>
              setLocationId(e.target.value === "" ? null : e.target.value)
            }
            disabled={isPending}
            className="mt-1 w-full border-0 border-b border-rule bg-transparent py-1.5 text-[14px] text-foreground focus:border-clay focus:outline-none disabled:opacity-50"
          >
            <option value="">In transit (no location)</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
```

- [ ] **Step 4: Verify**

Run: `pnpm lint` then `pnpm build`. In the browser: edit a day under **In transit**, pick "Kuta" in the Location select, save → the day moves to the Kuta tab and leaves In transit. Edit it again and pick "In transit (no location)" → it returns. Realtime UPDATE already carries `location_id` (selected in Task 3), so the partner sees the move live.

- [ ] **Step 5: Commit**

```bash
git add src/app/trips/[slug]/itinerary-tab.tsx
git commit -m "feat(itinerary): move a day between locations from the edit form"
```

---

## Slice 1 done — what you have

Editable location tabs over the dated itinerary: create / rename / delete locations, file new days into the active tab, and move existing days between tabs (or to "In transit"). The trek `group_id` box still renders inside a tab. Dates are unchanged (still picked in the add form) — that is Slice 2.

**Known Slice 1 limitations (resolved in Slice 2):** dates are still typed, so a day filed under a location is not forced to sit inside that location's date range; tab order follows each location's earliest day date, so filing days can reorder tabs. These go away once dates are computed from position.

## Next slices (separate plans, after Slice 1 is validated on the real trip)

- **Slice 2 — computed dates + cascade.** Replace the add-day date picker with "add day(s) into location" + a count field (shared `group_id` for N>1); add `insert_itinerary_day_shift` / `delete_itinerary_day_shift` RPCs (deferrable-unique pattern from `reschedule_itinerary_days`); auto-manage `trip.end_date`. Confirm decision #1 (trip length follows itinerary) before building.
- **Slice 3 — travel days + polish.** First-class "In transit" presentation, optional drag-reorder of tabs (`reorderItineraryLocations` already exists), visual pass.
- **Later — dreams.** Bring locations to the dateless dream itinerary (tabs + ordered days, no dates).

## Self-review

- **Spec coverage (Slice 1 scope):** locations table + RLS + Realtime (Task 1) ✓; `location_id` on days (Tasks 1, 3) ✓; location CRUD actions (Task 4) ✓; tabbed grouping UI with In-transit for unfiled days (Task 6) ✓; create/rename/delete from the strip (Task 7) ✓; file new days into the active location (Task 8) ✓; move existing days between locations (Task 9) ✓; trek box preserved inside tabs (Task 6, verified). Computed dates / cascade / `end_date` are intentionally **out of Slice 1** (Slice 2).
- **Placeholder scan:** no TBD/TODO; every code step shows complete code; verification uses `pnpm lint` + `pnpm build` + explicit browser checks (this repo has no test runner).
- **Type consistency:** `ItineraryLocation { id, name, sortOrder }` and `rowToLocation` used uniformly; action names `createItineraryLocation` / `renameItineraryLocation` / `reorderItineraryLocations` / `deleteItineraryLocation` consistent between Task 4 (definition) and Task 7 (use); `locationId` optional on `AddItineraryDayInput` / `UpdateItineraryDayInput` (Task 5) matches the `addItineraryDay` / `updateItineraryDay` call sites (Tasks 8, 9); `effectiveActive` / `orderedTabs` / `tabDays` names consistent across Tasks 6–8.
