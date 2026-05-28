# Phase 4 — Dream-Trip Pipeline (one table, two states)

**Status:** spec, awaiting plan.
**Phase:** 4 — Trip Depth + Polish (first task; sliced into 5 sub-slices).
**Predecessors:** Phase 3 (`trips`, `trip_members`, `packing_items`, `expenses`, `itinerary_days` schemas + RLS), Phase 3.5 (`+ new trip` form, `+ log expense`, `+ add packing item`).

## Problem

Two pains, one root cause.

1. **`/home` is hardcoded to Lombok.** `src/app/home/page.tsx:166–194` literally renders one `<Link href="/trips/lombok">` card. After Phase 3.5 the user can create new trips via `/trips/new`, but those rows never appear on `/home` — the only way to reach a new trip is to type or bookmark the URL. Carried forward as the first Phase 4 task in `TODO.md`.

2. **Dreams and trips are the same thing in different states.** The current `/home` has a separate "Dream board" section with four hardcoded cards (Faroe / Patagonia / Hokkaido / Aeolian) that aren't linked anywhere and carry no data. In reality, a dream is a destination you'd like to visit — it's *a trip without firm dates yet*. The conceptual gap means every dream is dead-end decoration; you can't build packing lists for it, can't draft a budget for it, can't promote it forward when dates firm up. A real planning app should treat the dream→trip transition as a date edit on an existing row, not as two separate worlds.

## Goals

- `/home` lists every trip in the workspace, sorted into clear bands.
- A "dream" is a row in `trips` with NULL dates and an optional `fuzzy_when` text label (e.g. "summer 2030", "someday").
- Dreams share the full planning surface with real trips: packing list, budget, members. Itinerary is deferred for dreams (see Non-goals).
- "Promoting a dream" is just editing dates on the existing row — no copy, no delete, all child rows (packing/budget) carry over for free.
- Past trips remain reachable from `/home` in a dedicated bottom box.
- The change is shippable in five small slices, each independently verifiable.

## Non-goals

- **Edit-a-trip / promote-a-dream UI.** Adding dates to a dream row will require a new "// edit trip" action; that's a follow-up slice after these five land. Until then, dreams stay as dreams; promotion is manual via Supabase Table Editor or a later slice.
- **Itinerary support for dreams.** `itinerary_days.day_date` is NOT NULL. Dreams render an empty-state on the itinerary tab ("Add dates to plan day-by-day"). Relaxing that schema or adding a parallel `dream_itinerary_items` table is out of scope.
- **Per-trip vibe + tone color.** The current Lombok hero card has a hardcoded `Surf · Dive · Trek` `MonoBadge` and a `tone="sea"` topography background. We are *not* adding `trips.vibe` / `trips.tone` columns. Lombok will lose its badge on `/home`; the seeded dream cards get one consistent default tone. Per-trip styling becomes a felt pain in a later phase.
- **Map / geocoding helper.** Still not.
- **Pagination on `/home`.** A workspace has order-of-10 trips lifetime — premature.
- **Soft-delete / archive.** Past trips are already "archived" by virtue of being below the dreams band; explicit delete is out of scope.
- **Multi-workspace.** Schema supports it; UI keeps assuming one workspace at a time.

## Slicing — five increments

Each slice is one session's worth of work, independently shippable and verifiable. The original `/home`-hardcoded pain dies at end of slice 3 — slices 4 and 5 polish the surrounding flows.

1. **Schema migration + dream seeds** — make `start_date`/`end_date` nullable, add `fuzzy_when`, swap the date-order CHECK, seed four dream rows for each workspace that has Lombok.
2. **`listTripsForWorkspace` query + state derivation** — new module returning trips bucketed into `now / upcoming / past / dreams`. Pure-functional state derivation (testable). No UI yet.
3. **Rebuild `/home`** — drop hardcoded Lombok card + `DREAM_BOARD` array; render four bands (Hero / Trips / Dreams / Past) from the query. This kills the original pain.
4. **`+ new trip` form gains a dream toggle** — checkbox at top hides date fields and reveals a `fuzzy_when` input. `createTrip` branches on `isDream`.
5. **`/trips/[slug]` dream variant** — when dates are NULL, hero swaps the date range for `fuzzy_when`, the weather strip hides, the itinerary tab shows an empty-state. Packing + budget tabs unchanged.

## Slice 1 — Schema migration + dream seeds

### `supabase/migrations/20260528000001_phase_4_dreams.sql`

```sql
-- Phase 3 already created start_date/end_date as nullable (no NOT NULL).
-- Phase 3 also added an anonymous table-level CHECK auto-named `trips_check`:
--   check (end_date is null or start_date is null or end_date >= start_date)
-- That allowed half-states (start set, end null). We tighten it to "both or neither."

alter table trips add column fuzzy_when text;

alter table trips drop constraint if exists trips_check;
alter table trips add constraint trips_dates_check
  check (
    (start_date is null and end_date is null)
    or (start_date is not null and end_date is not null and end_date >= start_date)
  );
```

Invariant: dates are either both set (a trip) or both NULL (a dream). No half-states. The Lombok seed row (both dates set) satisfies the new constraint, so the ALTER won't fail on existing data.

### `supabase/migrations/20260528000002_seed_dreams.sql`

Idempotent `do $$` block in the same shape as `20260526000002_seed_lombok.sql`. For each workspace that has Lombok seeded (proxy for "real seed-bearing workspace"), insert four dream rows with `ON CONFLICT (workspace_id, slug) DO NOTHING`, then insert `trip_members` rows for every workspace member (so RLS sees them).

Seed rows (slug, name, country, lat, lng, fuzzy_when):

| slug | name | country | lat | lng | fuzzy_when |
|---|---|---|---|---|---|
| `faroe-islands` | Faroe Islands | Faroe Islands | 62.0 | -6.8 | someday |
| `patagonia` | Patagonia | Argentina | -50.0 | -73.0 | someday |
| `hokkaido` | Hokkaido | Japan | 43.0 | 142.0 | someday |
| `aeolian-isles` | Aeolian Isles | Italy | 38.5 | 14.9 | someday |

`start_date`, `end_date` NULL on all four.

### Verification

After paste-into-SQL-Editor, query in Supabase:

```sql
select slug, name, start_date, fuzzy_when
from trips
where workspace_id = '<my-workspace-id>'
order by start_date nulls last, created_at;
```

Expect: Lombok with dates, four dreams with NULL dates and `fuzzy_when='someday'`.

## Slice 2 — `listTripsForWorkspace` + state derivation

### New module: `src/lib/trips/list-queries.ts`

```ts
export type TripState = "now" | "upcoming" | "past" | "dream"

export interface TripListItem {
  id: string
  slug: string
  name: string
  country: string | null
  startDate: string | null  // ISO yyyy-mm-dd, null for dreams
  endDate: string | null
  fuzzyWhen: string | null  // only meaningful when dates are null
  lat: number | null
  lng: number | null
  memberCount: number
  state: TripState
}

export interface TripBuckets {
  now: TripListItem[]       // sorted by start_date asc
  upcoming: TripListItem[]  // sorted by start_date asc
  past: TripListItem[]      // sorted by end_date desc (most recent first)
  dreams: TripListItem[]    // sorted by created_at asc
}

export async function listTripsForWorkspace(
  workspaceId: string,
): Promise<TripBuckets>

export function deriveState(
  today: string,
  startDate: string | null,
  endDate: string | null,
): TripState
```

### State derivation (pure function)

```ts
export function deriveState(today, startDate, endDate): TripState {
  if (!startDate || !endDate) return "dream"
  if (today < startDate) return "upcoming"
  if (today > endDate) return "past"
  return "now"
}
```

`today` is computed once at the call site (`new Date().toISOString().slice(0, 10)`) and threaded in — deterministic per render, trivially testable with fixed inputs. ISO yyyy-mm-dd string comparison is lexicographic-equivalent to date comparison, so no `Date` round-trip needed.

### Query strategy

One SQL fetch returning all `trips` for the workspace with a `trip_members` count via subquery or `count()`-over-foreign-table. Bucketing happens in JS — bucket sizes are tiny (<20 trips lifetime), no need for SQL-level grouping or pagination. `getTripBySlug` is updated to add `fuzzyWhen` to `TripHeader`; existing consumers stay backward-compatible because dates remain in the type, just possibly null.

## Slice 3 — `/home` rebuild

### Layout — mobile (≤md, 440px column)

```
[header:   Together · Workspace               PairAvatar]
[greeting: <date label>
           Hello, <name>.]
─── rule ───
[members sub-row: Monkey & Giraf · est. 2026 · 2 members]

▸ Hero band                        ← exactly one card, or empty
   the soonest active trip (now > upcoming).
   132px-tall card, TopoBg, big serif name, Coord,
   "// now · day 3 / 8" or "Upcoming · 17 days" mono row above.

▸ Trips band                       ← optional; non-hero now+upcoming
   "Trips · N" section header.
   Compact full-width rows (~64px), no TopoBg, name + date range +
   member avatars + chevron.

▸ Dreams band                      ← optional; all dreams
   "Dreams · N    someday, together" section header.
   2-col grid, square tiles, TopoBg, name + fuzzy_when in mono.
   (Visually identical to the current DreamCard.)

▸ Past trips band                  ← optional; bottom box
   "Past · N    most recent first" section header.
   Dimmed (60% opacity) compact rows. Tap-through to /trips/<slug> still works.

[+ new trip or dream]              ← dashed CTA, links to /trips/new
[Sign out footer]
```

**Hero claim rule:** at most one card claims hero across now+upcoming. If any `now` row exists, the earliest claims hero. Otherwise the soonest `upcoming` claims hero. If both lists are empty, the Hero band doesn't render at all. Dreams never claim hero.

### Layout — desktop md (768+) and lg (1024+)

- Hero: still one card, scaled to span full content width.
- Trips band: `md:grid-cols-2 lg:grid-cols-3`, cards taller than mobile compact rows (similar to current `md:` grid card shape).
- Dreams band: `md:grid-cols-4` (matches today's dream board).
- Past band: `md:grid-cols-3 lg:grid-cols-4` of small dimmed cards.
- Desktop `StatItem` row updates: `Upcoming · N` becomes `Upcoming · (now+upcoming count)`. New stat: `Dreams · N`. `Members` stat unchanged.

### Card variants

**Hero card** (mobile reference shape):

```
┌──────────────────────────────────────┐
│ [TopoBg, tone="sea"]                 │
│ ┌──────────────┐         ┌─────────┐ │
│ │ // now       │         │ 8.7° S  │ │
│ └──────────────┘         │ 116° E  │ │
│                          └─────────┘ │
│                                      │
│   Lombok                             │
│   INDONESIA                          │
├──────────────────────────────────────┤
│ JUN 12 — JUN 20    [PairAvatar] ›    │
│ 8 days · 2 travellers                │
└──────────────────────────────────────┘
```

The mono badge top-left renders only for the in-progress (`now`) trip — it says `// now`. For an `upcoming` hero, the badge is omitted (matches current Lombok-pre-trip look). The countdown row above the section header reads `day 3 / 8` for `now`, `17 days` for `upcoming`. Hero never renders for dreams (they're in their own band) or past trips.

**Compact row** (Trips and Past bands):

```
┌──────────────────────────────────────┐
│ Lombok               JUN 12 — JUN 20 │
│ INDONESIA            8 days     [Av] │
└──────────────────────────────────────┘
```

No TopoBg. Tappable. For Past, opacity 60% and tone bg dropped.

**Dream tile** (Dreams band, 2-col mobile / 4-col desktop):

```
┌─────────────────┐
│ // dream        │
│                 │
│ Faroe Islands   │
│ SOMEDAY         │   ← fuzzy_when, mono, uppercase
└─────────────────┘
```

Tappable to `/trips/<slug>`. Tone background — see "Tone strategy" below.

### Tone strategy (without adding a column)

Lombok keeps its `sea` tone in code (special-case on `slug === 'lombok'`) because the seed predates this work. New trips and seeded dreams use a deterministic tone derived from the slug: `tone = TONES[hash(slug) % TONES.length]`, where `TONES = ['sea', 'clay', 'moss', 'sand']`. Same slug → same tone forever; visual variety for free; zero schema change. If per-trip tone becomes a felt need later, swap the derivation for a column read.

### Section ordering rationale

Hero → Trips → Dreams → Past matches the user's attention budget: what's next (hero), then the rest of what's planned (trips), then the wishlist (dreams), then memory (past). Past sits at the bottom because it's the least urgent — but stays visible so it's not lost.

### Empty cases

| State | Render |
|---|---|
| Workspace solo (`youOnly`) | InviteCard replaces the entire trip area, like today. |
| Paired, zero trips ever (would require deleting all seeds) | Only the `+ new trip or dream` CTA renders. |
| Paired, no `now` and no `upcoming` | Hero band is omitted. Trips band may also be empty and is also omitted. Dreams + Past render normally. |
| Paired, no dreams (would require deleting all seeded dreams) | Dreams band omitted. |
| Paired, no past trips | Past band omitted. |

### CTA placement

The existing dashed `+ new trip` button currently sits below the dream board. With Past trips below the dreams band, the CTA moves to below Past — making it the last interactive thing in the trip area before the sign-out footer. Label changes from `+ new trip` to `+ new trip or dream` to telegraph that the form supports both modes.

## Slice 4 — `+ new trip` form: dream toggle

### Form addition

A single toggle at the top of the form (above the `Name` field):

```
[ ] This is a dream (no dates yet)
```

OFF by default → trip mode (current behavior). ON → dream mode.

### Field rendering by mode

| Field | Trip mode | Dream mode |
|---|---|---|
| Name | required | required |
| Slug (auto-derived) | required | required |
| Country | optional | optional |
| Start / End date | required, end ≥ start | **hidden**; submitted as NULL |
| When? (`fuzzy_when`) | **hidden**; submitted as NULL | optional, free text, placeholder `"summer 2030, someday, …"`, max 64 chars |
| Advanced (lat/lng) | optional | optional |

Toggling between modes keeps typed values in form state (React state survives the conditional unmount via field-level state held at the parent). On submit, the action ignores fields not relevant to the current mode.

### `createTrip` Server Action signature

```ts
interface CreateTripInput {
  name: string
  slug: string
  country: string | null
  isDream: boolean
  startDate: string | null   // ISO yyyy-mm-dd or null
  endDate: string | null
  fuzzyWhen: string | null   // free text or null
  lat: number | null
  lng: number | null
}
```

Validation branches on `isDream`:

- **`isDream === false`** — `startDate` and `endDate` required, `endDate >= startDate`. `fuzzyWhen` rejected (must be null) — refuse mixed state to keep the invariant clean.
- **`isDream === true`** — `startDate` and `endDate` must both be null. `fuzzyWhen` optional, trimmed, max 64 chars.
- Slug regex + 23505 collision handling: unchanged from Phase 3.5.

Insert: dates and `fuzzy_when` written per the mode. `trip_members` insert loop unchanged. Return `{ slug }` on success; `{ error }` on validation or collision.

### Submit redirect

Unchanged — `router.push(/trips/<slug>)` regardless of mode. Slice 5 handles what that page looks like for dreams.

## Slice 5 — `/trips/[slug]` dream variant

Same route, same component tree. Branches at three seams when the row has NULL dates.

| Element | Trip (dates) | Dream (no dates) |
|---|---|---|
| Hero `name` (serif) | unchanged | unchanged |
| Hero `Coord` | unchanged | unchanged |
| Hero date range (`JUN 12 — JUN 20`) | unchanged | replaced with `fuzzy_when` in mono uppercase; falls back to `"SOMEDAY"` if null |
| Hero ribbon `MonoBadge` | unchanged | shows `// dream` |
| `WaveGlyph` decoration | unchanged | unchanged |
| Weather strip (7-cell mobile) | shown | **hidden** |
| Tab nav | unchanged | unchanged |
| Itinerary tab | timeline of `itinerary_days` rows | empty-state stub: `// no days planned yet — add dates to plan day-by-day`. No `+ add day` CTA (deferred). |
| Packing tab | unchanged | unchanged — works fully |
| Budget tab | unchanged | unchanged — works fully (settle-up, ledger, log expense all valid for dreams) |
| Desktop right rail "// weather" grid (lg+) | shown | **hidden** |
| Desktop right rail packing + budget bars | shown | shown |

The branch points are isolated to ~3 places in `src/app/trips/[slug]/page.tsx` (hero, weather, itinerary tab) — no separate page or route.

### Page-level `TripHeader` shape

`getTripBySlug` already returns the row; this slice extends `TripHeader` with `fuzzyWhen: string | null`. Existing consumers continue to compile because `startDate`/`endDate` were already typed `string | null` in the return shape.

## Decisions worth recording in `docs/DECISIONS.md`

- **One-table model for dreams + trips.** Same row, distinguished by whether dates are set. Alternative (two tables `dreams` + `trips`) was rejected because dreams need the full child-table planning surface (packing, budget) which would double-up every FK and every RLS policy.
- **Dreams seeded as real rows, not hardcoded.** The current decorative `DREAM_BOARD` array goes away. Seeded dreams become editable, planable, eventually promotable.
- **`fuzzy_when` is free text, not structured.** Maximum flexibility, zero parsing. Renders as-is. If sortable timing becomes a felt need, add a separate optional `fuzzy_when_hint date` later.
- **Dream toggle in the existing form, not a separate `/trips/new-dream` route.** The bodies are 90% the same. A toggle is one extra control; a duplicate route would be a duplicate component, duplicate Server Action call site, duplicate validation tree.
- **`/trips/[slug]` branches internally, not a separate `/dreams/[slug]` route.** Same reasoning as the form — same arg, three seams.
- **No "Now" section header on `/home`.** The `now` trip claims the hero slot, and the hero's countdown row (`// now · day 3 / 8`) is sufficient signal. Adding a "Now" band header would compete with the hero for emphasis.
- **Tone derived from slug hash, not stored.** Avoids a `trips.tone` column. Lombok keeps `sea` via slug-special-case to preserve the existing visual.
- **Itinerary tab stays empty for dreams.** Relaxing `itinerary_days.day_date NOT NULL` is a larger schema decision; the empty-state is honest and points the user to the right next step (add dates).

## Open / deferred (later Phase 4 slices or beyond)

- **Promote-a-dream / edit-a-trip flow.** A `// edit trip` action on `/trips/[slug]` that lets users set dates on a dream (promoting it) or change dates/country/etc. on a trip. Mechanically simple given the schema; UX-shaped enough to deserve its own slice.
- **Itinerary support for dreams.** Either relax `itinerary_days.day_date NOT NULL`, or add a separate "ideas" sub-table for dream-stage planning. Decide when the empty-state actually annoys someone.
- **Per-trip styling.** Vibe badge + tone color as real columns, exposed in the form. Deferred until the slug-hash tone derivation feels insufficient.
- **Trip delete.** No use case has surfaced yet; defer.

## Verification per slice

| Slice | Verify by |
|---|---|
| 1 | Paste both SQL files into Supabase SQL Editor; query `trips` and confirm 1 Lombok row + 4 dream rows with NULL dates and `fuzzy_when='someday'`. |
| 2 | Read `listTripsForWorkspace` output via a temporary debug log on `/home` (or unit test on `deriveState`). Buckets contain the expected counts. |
| 3 | Visual: load `/home` — Hero (Lombok), no Trips band (only one upcoming, claims hero), Dreams band (4 cards), no Past band. Create a new trip via `/trips/new` → it appears on `/home` in Trips band (or hero if soonest). |
| 4 | Toggle the dream switch in `/trips/new`, submit with `fuzzy_when='test'` — row appears in Dreams band. Toggle off, submit with dates — appears in Hero or Trips. Validation errors surface inline. |
| 5 | Visit `/trips/<dream-slug>` — hero shows `fuzzy_when`, no weather strip, itinerary tab shows empty-state, packing + budget tabs work. |
