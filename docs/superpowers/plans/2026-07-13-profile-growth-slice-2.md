# Profile-growth slice 2 — per-trip summaries — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the couple `/profile` a "By trip" history — a per-trip learned Food/Activity summary for each started or finished trip — built by the existing summariser, scoped to one trip.

**Architecture:** New `trip_summaries` table keyed `(trip_id, category)`, mirroring `couple_summaries`. Trip-scoped gather/count/get in the existing preferences query layer, trip-scoped refresh/save actions, the existing `LearnedSummary` component generalized with an optional `tripId`, and a "By trip" section on `/profile` that lazy-regenerates on view. The general summary is untouched.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), Supabase (Postgres + RLS), TypeScript. Anthropic call reused via `summarizeTaste`.

## Global Constraints

- No tests in this repo — the per-task gate is `pnpm lint` (fast) and, for UI/page changes, `pnpm build`. Never invent a test command.
- Migrations are **applied manually**: the SQL file must be pasted into the Supabase SQL editor by hand (single shared DB for local + prod). Committing/restarting does nothing to the DB.
- Every migration is **idempotent** (`create ... if not exists`, policy creation guarded by `duplicate_object`).
- No emojis in code/logs. Sparse comments; clear names. No defensive/ speculative code.
- Categories this slice: `food | activity` only (accommodation/transport are slice 3).
- Display dates day-before-month with `en-GB` if any date is shown.
- `"use client"` files import types/pure helpers from `*-types.ts`, never from `*-queries.ts`.

---

### Task 1: `trip_summaries` table + RLS (migration)

**Files:**
- Create: `supabase/migrations/20260713000001_trip_summaries.sql`

**Interfaces:**
- Produces: table `public.trip_summaries (trip_id uuid, category text, summary_md text, signal_count_at_generation int, updated_at timestamptz, pk (trip_id, category))` with member-gated RLS via `public.is_trip_workspace_member(trip_id)`.

- [ ] **Step 1: Write the migration**

```sql
-- Per-trip learned taste summary (profile-growth slice 2). Mirrors
-- couple_summaries but keyed by trip, so /profile can show a per-trip history.
-- The stamp holds a signal count (not a rating count). RLS via the trip's
-- workspace. Idempotent: safe to paste-and-run again.

create table if not exists public.trip_summaries (
  trip_id uuid not null references public.trips(id) on delete cascade,
  category text not null,
  summary_md text not null default '',
  signal_count_at_generation int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (trip_id, category)
);

alter table public.trip_summaries enable row level security;

do $$
begin
  create policy trip_summaries_select on public.trip_summaries
    for select to authenticated using (public.is_trip_workspace_member(trip_id));
  create policy trip_summaries_insert on public.trip_summaries
    for insert to authenticated with check (public.is_trip_workspace_member(trip_id));
  create policy trip_summaries_update on public.trip_summaries
    for update to authenticated
    using (public.is_trip_workspace_member(trip_id))
    with check (public.is_trip_workspace_member(trip_id));
exception
  when duplicate_object then null;
end $$;
```

- [ ] **Step 2: Apply it manually**

Paste the file's contents into the Supabase SQL editor and run. Re-running must not error (idempotent). This must happen before Task 2's queries return anything at runtime.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260713000001_trip_summaries.sql
git commit -m "feat(profile): trip_summaries table + RLS for per-trip taste summaries"
```

---

### Task 2: Trip-scoped queries

**Files:**
- Modify: `src/lib/preferences/couple-summary-queries.ts`

**Interfaces:**
- Consumes: `TasteSignal`, `LearnedCategory`, `inferRatingCategory`, `RATING_FLOOR` from `./couple-summary-types`; `expenseCategoryToLearned` from `@/lib/ai/discovery-types`; `parseEvents` from `@/lib/trips/itinerary-types`.
- Produces: `gatherTripTasteSignals(tripId, category): Promise<TasteSignal[]>`, `countTripSignals(tripId, category): Promise<number>`, `getTripSummary(tripId, category): Promise<TripSummary>` where `TripSummary = { summaryMd: string; signalCountAtGeneration: number }`, and `getTripLearnedBlocks(tripId): Promise<TripLearnedBlock[]>` where `TripLearnedBlock = { category: LearnedCategory; summaryMd: string; signalCount: number; countAtGeneration: number }`.

- [ ] **Step 1: Add `RATING_FLOOR` to the types import**

Change the existing import line:

```ts
import {
  inferRatingCategory,
  RATING_FLOOR,
  type LearnedCategory,
  type TasteSignal,
} from "./couple-summary-types"
```

(Replaces the current separate `LearnedCategory` / `inferRatingCategory` / `TasteSignal` imports at the top of the file. Keep the other imports — `createClient`, `expenseCategoryToLearned`, `parseEvents` — as they are.)

- [ ] **Step 2: Append the trip-scoped gathers, count, get, and blocks**

Append to the end of `couple-summary-queries.ts`:

```ts
/** Rated places on one trip (strong signal). */
async function gatherTripRatingSignals(
  tripId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("event_ratings")
    .select("event_text, rating, note")
    .eq("trip_id", tripId)
    .eq("category", category)
    .order("created_at", { ascending: true })
  return (data ?? []).map((r) => ({
    text: r.event_text as string,
    kind: "rated" as const,
    rating: r.rating as number,
    note: (r.note as string | null) ?? undefined,
  }))
}

/** Un-rated itinerary events on one trip (weak "we did this" signal). */
async function gatherTripPlannedSignals(
  tripId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("itinerary_days")
    .select("events")
    .eq("trip_id", tripId)
  const signals: TasteSignal[] = []
  for (const row of data ?? []) {
    for (const e of parseEvents((row as { events: unknown }).events)) {
      if (e.rating !== undefined) continue
      if (inferRatingCategory(e.text) !== category) continue
      signals.push({ text: e.text, kind: "planned" })
    }
  }
  return signals
}

/** Category detail tags on one trip (weak intent signal). */
async function gatherTripWantedSignals(
  tripId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("expense_categories")
    .select("name, details")
    .eq("trip_id", tripId)
  const signals: TasteSignal[] = []
  for (const row of data ?? []) {
    const r = row as { name: string; details: string[] | null }
    if (expenseCategoryToLearned(r.name) !== category) continue
    for (const tag of r.details ?? []) signals.push({ text: tag, kind: "wanted" })
  }
  return signals
}

/** The full corpus for one trip + category: rated + planned + wanted. */
export async function gatherTripTasteSignals(
  tripId: string,
  category: LearnedCategory,
): Promise<TasteSignal[]> {
  const [rated, planned, wanted] = await Promise.all([
    gatherTripRatingSignals(tripId, category),
    gatherTripPlannedSignals(tripId, category),
    gatherTripWantedSignals(tripId, category),
  ])
  return [...rated, ...planned, ...wanted]
}

/** How many signals of any kind this trip holds for a category. */
export async function countTripSignals(
  tripId: string,
  category: LearnedCategory,
): Promise<number> {
  return (await gatherTripTasteSignals(tripId, category)).length
}

export interface TripSummary {
  summaryMd: string
  signalCountAtGeneration: number
}

/** The stored per-trip summary for a category, or empty defaults when none. */
export async function getTripSummary(
  tripId: string,
  category: LearnedCategory,
): Promise<TripSummary> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trip_summaries")
    .select("summary_md, signal_count_at_generation")
    .eq("trip_id", tripId)
    .eq("category", category)
    .maybeSingle()
  if (!data) return { summaryMd: "", signalCountAtGeneration: 0 }
  return {
    summaryMd: data.summary_md ?? "",
    signalCountAtGeneration: data.signal_count_at_generation ?? 0,
  }
}

export interface TripLearnedBlock {
  category: LearnedCategory
  summaryMd: string
  signalCount: number
  countAtGeneration: number
}

/** The renderable per-trip blocks: food and/or activity, only where the trip
 * clears the signal floor. Empty array when the trip has too little signal. */
export async function getTripLearnedBlocks(
  tripId: string,
): Promise<TripLearnedBlock[]> {
  const categories: LearnedCategory[] = ["food", "activity"]
  const blocks = await Promise.all(
    categories.map(async (category) => {
      const signalCount = await countTripSignals(tripId, category)
      if (signalCount < RATING_FLOOR) return null
      const summary = await getTripSummary(tripId, category)
      return {
        category,
        summaryMd: summary.summaryMd,
        signalCount,
        countAtGeneration: summary.signalCountAtGeneration,
      }
    }),
  )
  return blocks.filter((b): b is TripLearnedBlock => b !== null)
}
```

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no errors in `couple-summary-queries.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/preferences/couple-summary-queries.ts
git commit -m "feat(profile): trip-scoped taste gather/count/get + renderable blocks"
```

---

### Task 3: Trip-scoped actions

**Files:**
- Modify: `src/lib/preferences/couple-summary-actions.ts`

**Interfaces:**
- Consumes: `gatherTripTasteSignals`, `getTripSummary` from `./couple-summary-queries`; `summarizeTaste`, `isAiEnabled`, `getCurrentWorkspace`, `createClient` (already imported).
- Produces: `refreshTripSummary(tripId, category): Promise<{ summaryMd?: string; error?: string }>`, `saveTripSummary(tripId, category, md): Promise<{ error?: string }>`.

- [ ] **Step 1: Extend the queries import**

Change the existing import:

```ts
import {
  getCoupleSummary,
  gatherTasteSignals,
  gatherTripTasteSignals,
  getTripSummary,
} from "./couple-summary-queries"
```

- [ ] **Step 2: Append the trip actions**

Append to the end of `couple-summary-actions.ts`:

```ts
/** Regenerates one trip's learned summary from that trip's signals (AI-gated).
 * Evolves the current summary, stamps the signal count so staleness resets.
 * Membership is enforced by trip_summaries RLS. */
export async function refreshTripSummary(
  tripId: string,
  category: LearnedCategory,
): Promise<{ summaryMd?: string; error?: string }> {
  if (!(await isAiEnabled())) return { error: "AI mode is off." }

  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }

  const signals = await gatherTripTasteSignals(tripId, category)
  if (signals.length === 0) return { error: "Nothing to learn from yet." }

  const current = await getTripSummary(tripId, category)
  const summaryMd = await summarizeTaste(category, current.summaryMd, signals)

  const supabase = await createClient()
  await supabase.from("trip_summaries").upsert(
    {
      trip_id: tripId,
      category,
      summary_md: summaryMd,
      signal_count_at_generation: signals.length,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "trip_id,category" },
  )

  revalidatePath("/profile")
  return { summaryMd }
}

/** Saves a hand-edited per-trip summary (no AI). Leaves the stamp untouched so a
 * manual edit does not clear staleness. */
export async function saveTripSummary(
  tripId: string,
  category: LearnedCategory,
  md: string,
): Promise<{ error?: string }> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "Not signed in." }

  const supabase = await createClient()
  await supabase.from("trip_summaries").upsert(
    {
      trip_id: tripId,
      category,
      summary_md: md,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "trip_id,category" },
  )

  revalidatePath("/profile")
  return {}
}
```

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/preferences/couple-summary-actions.ts
git commit -m "feat(profile): refreshTripSummary + saveTripSummary actions"
```

---

### Task 4: Generalize `LearnedSummary` with an optional `tripId`

**Files:**
- Modify: `src/app/profile/learned-summary.tsx`

**Interfaces:**
- Consumes: `refreshTripSummary`, `saveTripSummary` (Task 3) plus the existing `refreshCoupleSummary`, `saveCoupleSummary`.
- Produces: `LearnedSummary` accepting an optional `tripId?: string`; when present it targets the trip actions, otherwise the workspace actions. No other prop changes.

- [ ] **Step 1: Extend the actions import**

```ts
import {
  refreshCoupleSummary,
  saveCoupleSummary,
  refreshTripSummary,
  saveTripSummary,
} from "@/lib/preferences/couple-summary-actions"
```

- [ ] **Step 2: Add the `tripId` prop**

Add `tripId,` to the destructured params and `tripId?: string` to the props type:

```ts
export function LearnedSummary({
  category,
  summaryMd,
  ratingCount,
  countAtGeneration,
  aiOn,
  tripId,
}: {
  category: LearnedCategory
  summaryMd: string
  ratingCount: number
  countAtGeneration: number
  aiOn: boolean
  tripId?: string
}) {
```

- [ ] **Step 3: Route refresh + save by `tripId`**

Replace the `refresh` callback and `save` function:

```ts
  const refresh = React.useCallback(async () => {
    setBusy(true)
    const res = tripId
      ? await refreshTripSummary(tripId, category)
      : await refreshCoupleSummary(category)
    if (res.summaryMd !== undefined) setText(res.summaryMd)
    setBusy(false)
  }, [category, tripId])
```

```ts
  async function save() {
    setBusy(true)
    if (tripId) await saveTripSummary(tripId, category, text)
    else await saveCoupleSummary(category, text)
    setBusy(false)
  }
```

(The `React.useEffect` auto-fire block already depends on `refresh`, so it picks up the trip path automatically once `refresh` is trip-aware.)

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: no errors; no missing-dependency warning on the `useCallback`.

- [ ] **Step 5: Commit**

```bash
git add src/app/profile/learned-summary.tsx
git commit -m "feat(profile): LearnedSummary targets a trip when given tripId"
```

---

### Task 5: "By trip" section on `/profile`

**Files:**
- Modify: `src/app/profile/page.tsx`

**Interfaces:**
- Consumes: `getTripLearnedBlocks` (Task 2), the existing `buckets` from `listTripsForWorkspace`, `LearnedSummary` (Task 4), `aiOn`.

- [ ] **Step 1: Import `getTripLearnedBlocks`**

Extend the existing import from the queries module:

```ts
import {
  getCoupleSummary,
  countSignals,
  getTripLearnedBlocks,
} from "@/lib/preferences/couple-summary-queries"
```

- [ ] **Step 2: Gather per-trip blocks for started + finished trips**

After `const buckets = await listTripsForWorkspace(workspace.id)` and the `hero`/`navDestinations` lines, add:

```ts
  const startedTrips = [...buckets.now, ...buckets.past]
  const tripBlocks = (
    await Promise.all(
      startedTrips.map(async (trip) => ({
        trip,
        blocks: await getTripLearnedBlocks(trip.id),
      })),
    )
  ).filter((tb) => tb.blocks.length > 0)
```

- [ ] **Step 3: Render the section**

Immediately after the closing `</div>` of the `mt-4 flex flex-col gap-5` block that holds the four `CategorySection`s (i.e. just before the `</div>` that closes `max-w-sm`), insert:

```tsx
          {tripBlocks.length > 0 ? (
            <div className="mt-10 border-t border-border pt-8">
              <p className="text-sm text-muted-foreground">
                By trip (what each trip taught us)
              </p>
              <div className="mt-4 flex flex-col gap-8">
                {tripBlocks.map(({ trip, blocks }) => (
                  <div key={trip.id}>
                    <h3 className="font-serif text-lg tracking-tight">
                      {trip.name}
                    </h3>
                    {blocks.map((b) => (
                      <div key={b.category}>
                        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          {b.category === "food" ? "Food" : "Activities"}
                        </p>
                        <LearnedSummary
                          category={b.category}
                          summaryMd={b.summaryMd}
                          ratingCount={b.signalCount}
                          countAtGeneration={b.countAtGeneration}
                          aiOn={aiOn}
                          tripId={trip.id}
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
```

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: compiles with no type errors; `/profile` in the route list.

- [ ] **Step 5: Manual check**

Run `pnpm dev`, open `/profile` on a workspace that has a started or finished trip with >= 3 food or activity signals. Expected: a "By trip" section lists that trip with a Food and/or Activities learned block; with AI on and the summary stale, it regenerates in place. A workspace with no started trip shows no section.

- [ ] **Step 6: Commit**

```bash
git add src/app/profile/page.tsx
git commit -m "feat(profile): By trip section of per-trip learned summaries"
```

---

### Task 6: Docs

**Files:**
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`

- [ ] **Step 1: Mark slice 2 in `docs/TODO.md`**

Under the profile-growth section, mark slice 2 shipped and note slice 3 remains: all four categories + trip-profile context header + the summary-of-summaries/retrieval harness as later work. (Match the surrounding checkbox/format style already in the file.)

- [ ] **Step 2: Add a row to `docs/DECISIONS.md`**

Add a row recording: per-trip taste summaries live on `/profile` (not the trip page) as an additive history layer; new `trip_summaries` table keyed `(trip_id, category)`; general summary unchanged; the retrieval-harness/summary-of-summaries is the named future direction the per-trip unit is built to enable. (Match the existing table columns.)

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: mark profile-growth slice 2 shipped"
```

---

## Self-Review

**Spec coverage:**
- `trip_summaries` storage + RLS -> Task 1.
- Trip-scoped gather (rated/planned/wanted, trip_id filter), count, get -> Task 2.
- Started/finished gate (`now` + `past`) + signal floor -> `getTripLearnedBlocks` (Task 2) + `startedTrips` (Task 5).
- Lazy-on-view regeneration -> reuses `LearnedSummary` auto-fire (Task 4) rendered on `/profile` (Task 5).
- Refresh/save actions stamping `signal_count_at_generation` -> Task 3.
- Editable per-trip blocks via reused component -> Task 4.
- General summary untouched -> no change to `getCoupleSummary`/`refreshCoupleSummary`; verified by omission.
- "Keep vibe/date queryable" obligation -> satisfied structurally: `trip_summaries.trip_id` joins to `trips`; blocks render under the trip (name/date available). No blob storage of style. Nothing to build here.

**Placeholder scan:** none — every code step carries full code; the only prose steps are the doc edits (Task 6), intentionally matched to existing file formats.

**Type consistency:** `TripSummary.signalCountAtGeneration` and `TripLearnedBlock.{signalCount,countAtGeneration}` are produced in Task 2 and consumed unchanged in Tasks 3 and 5. `refreshTripSummary`/`saveTripSummary` signatures match between Task 3 (definition) and Task 4 (call sites). `LearnedSummary`'s `ratingCount` prop receives `signalCount` (same meaning as slice 1, where the "rating count" is already a signal count).

**Out-of-scope honored:** no rollup, no sharing/export, no trip-page surface, no accommodation/transport, no dream/upcoming trips.
