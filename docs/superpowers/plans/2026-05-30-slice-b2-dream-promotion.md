# Slice B.2 — Promotion Converts Dream Days to Dated Days

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a dream that has planned days is promoted to a dated trip (start date entered in the edit form), move its `dream_itinerary_days` rows onto consecutive dated `itinerary_days` (day 1 → start, day 2 → start+1, …), auto-derive the end date as `start + (dayCount − 1)`, and delete the dream rows — all atomically.

**Architecture:** A `promote_dream_to_dated(p_trip_id, p_start_date)` Postgres function does the atomic move (set trip dates + `fuzzy_when=null`, insert dated days from dream days in `day_index` order with consecutive dates, delete the dream rows). `updateTrip` detects the promotion-with-days case (`wasDream && !isDream && dreamDayCount > 0`), updates non-date fields first (so a slug collision fails before any conversion), then calls the RPC. The edit page passes `dreamDayCount`; the edit form, when promoting a dream-with-days, hides the End field and shows a read-only derived preview ("N planned days → Jun 12–Jun 16").

**Tech Stack:** Next.js 16 (Server Actions), React 19, Supabase (Postgres function + RLS), TypeScript, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-05-30-slice-b-dream-itinerary-design.md` (the "Slice B.2" section).

**Verification:** No test framework (CLAUDE.md). Each task verifies with `pnpm build` (+ `pnpm lint` for TS/TSX) and, for DB, idempotency by inspection. Manual end-to-end at the end (needs the migration pasted into Supabase). Commit after each task.

**Key design facts (confirmed against the code):**
- `trips_dates_check` = `(both null) or (both set and end >= start)`. `start + (count−1) >= start` always holds (count ≥ 1). `fuzzy_when` has no date-linked CHECK, so the dream's intermediate state stays valid until the RPC sets both dates.
- `itinerary_days` insert RLS = `is_trip_workspace_member(trip_id) and created_by = auth.uid()`. The RPC is `SECURITY INVOKER` and stamps converted rows with `auth.uid()` (the promoting member), which satisfies the policy. Per-day dream authorship is not surfaced in the UI, so this loss is acceptable.
- `itinerary_days` has `unique (trip_id, day_date) deferrable initially immediate` (Slice C). The conversion inserts strictly consecutive (distinct) dates, so no collision among the new rows. A current dream has no existing `itinerary_days` rows, so no collision with pre-existing rows in the normal flow.

---

### Task 1: Migration — `promote_dream_to_dated` RPC

**Files:**
- Create: `supabase/migrations/20260530000002_promote_dream_to_dated.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Slice B.2: promote a dream (with planned days) to a dated trip.
--
-- Atomically: set the trip's dates (start = given, end = start + count - 1) and
-- clear fuzzy_when; move each dream_itinerary_days row onto a consecutive date
-- in day_index order; delete the dream rows. SECURITY INVOKER so the caller's
-- RLS still gates every write; converted rows are stamped created_by = auth.uid()
-- to satisfy the itinerary_days insert policy. Idempotent (create or replace).

create or replace function public.promote_dream_to_dated(
  p_trip_id uuid,
  p_start_date date
) returns void
language plpgsql
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.dream_itinerary_days
  where trip_id = p_trip_id;

  if v_count = 0 then
    raise exception 'no dream days to promote for trip %', p_trip_id;
  end if;

  update public.trips
  set start_date = p_start_date,
      end_date = p_start_date + (v_count - 1),
      fuzzy_when = null
  where id = p_trip_id;

  insert into public.itinerary_days
    (trip_id, day_date, title, sub, tag, tone, created_by)
  select
    d.trip_id,
    p_start_date + (row_number() over (order by d.day_index) - 1)::int,
    d.title,
    d.sub,
    d.tag,
    d.tone,
    auth.uid()
  from public.dream_itinerary_days d
  where d.trip_id = p_trip_id;

  delete from public.dream_itinerary_days where trip_id = p_trip_id;
end;
$$;
```

- [ ] **Step 2: Verify idempotency by inspection**

Confirm it is `create or replace function` (re-run-safe) and references only existing objects (`trips`, `dream_itinerary_days`, `itinerary_days`, `auth.uid()`). Do NOT run it against any database.

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\Noam West\projects\project-template-couples" && git add supabase/migrations/20260530000002_promote_dream_to_dated.sql && git commit -m "feat(itinerary): promote_dream_to_dated RPC"
```

---

### Task 2: `updateTrip` — detect promotion-with-days, call the RPC

**Files:**
- Modify: `src/lib/trips/actions.ts` (add `wasDream` to `UpdateTripInput`; rewrite the `updateTrip` body)

The current `updateTrip` (lines ~426-507) validates then does a single `UPDATE`. The rewrite keeps every existing validation message but adds a promotion-with-days branch. It needs to know whether the trip *was* a dream, so add `wasDream` to the input (the form already knows `initial.isDream`).

- [ ] **Step 1: Add `wasDream` to `UpdateTripInput`**

In `UpdateTripInput` (currently lines 399-411), add the field after `isDream`:

```ts
export interface UpdateTripInput {
  tripId: string
  currentSlug: string
  name: string
  slug: string
  isDream: boolean
  wasDream: boolean
  startDate: string | null
  endDate: string | null
  fuzzyWhen: string | null
  country: string | null
  lat: number | null
  lng: number | null
}
```

- [ ] **Step 2: Replace the `updateTrip` function body**

Replace the entire `updateTrip` function (from `export async function updateTrip(` through its closing `}`, currently lines 426-507) with:

```ts
export async function updateTrip(
  input: UpdateTripInput,
): Promise<UpdateTripResult> {
  const name = input.name.trim()
  if (!name) return { error: "Name required." }

  const slug = input.slug.trim()
  if (!SLUG_RE.test(slug)) {
    return { error: "Slug must be lowercase letters, numbers, hyphens." }
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

  const supabase = await createClient()
  const country = input.country?.trim() || null

  // --- Dream branch: null dates, optional fuzzy_when. ---
  if (input.isDream) {
    if (input.startDate || input.endDate) {
      return { error: "Dreams have no dates." }
    }
    const fuzzyWhen = input.fuzzyWhen?.trim() || null
    if (fuzzyWhen && fuzzyWhen.length > 64) {
      return { error: "When? must be 64 characters or fewer." }
    }
    const { error } = await supabase
      .from("trips")
      .update({
        name,
        slug,
        country,
        start_date: null,
        end_date: null,
        fuzzy_when: fuzzyWhen,
        lat: input.lat,
        lng: input.lng,
      })
      .eq("id", input.tripId)
    if (error) {
      if (error.code === "23505") {
        return { error: "A trip with that slug already exists." }
      }
      return { error: error.message }
    }
    revalidatePath("/home")
    revalidatePath(`/trips/${input.currentSlug}`)
    return { slug }
  }

  // --- Dated branch (includes promotion of a dream). ---
  if (!input.startDate) return { error: "Start date required." }
  if (input.fuzzyWhen) {
    return { error: "Trips don't have a 'when?' label." }
  }

  // Promotion of a dream that already has planned days: derive the end date
  // from the day count and move the dream days onto consecutive dates.
  if (input.wasDream) {
    const { count } = await supabase
      .from("dream_itinerary_days")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", input.tripId)

    if ((count ?? 0) > 0) {
      // Update non-date fields first so a slug collision fails before we
      // convert anything.
      const { error: updateError } = await supabase
        .from("trips")
        .update({ name, slug, country, lat: input.lat, lng: input.lng })
        .eq("id", input.tripId)
      if (updateError) {
        if (updateError.code === "23505") {
          return { error: "A trip with that slug already exists." }
        }
        return { error: updateError.message }
      }

      // Atomic: set dates (start + count - 1), move dream days, delete originals.
      const { error: rpcError } = await supabase.rpc("promote_dream_to_dated", {
        p_trip_id: input.tripId,
        p_start_date: input.startDate,
      })
      if (rpcError) return { error: rpcError.message }

      revalidatePath("/home")
      revalidatePath(`/trips/${input.currentSlug}`)
      return { slug }
    }
  }

  // Normal dated edit (or promotion of a dream with no planned days).
  if (!input.endDate) return { error: "Start and end dates required." }
  if (input.endDate < input.startDate) {
    return { error: "End date must be on or after start date." }
  }

  const { error: updateError } = await supabase
    .from("trips")
    .update({
      name,
      slug,
      country,
      start_date: input.startDate,
      end_date: input.endDate,
      fuzzy_when: null,
      lat: input.lat,
      lng: input.lng,
    })
    .eq("id", input.tripId)

  if (updateError) {
    if (updateError.code === "23505") {
      return { error: "A trip with that slug already exists." }
    }
    return { error: updateError.message }
  }

  revalidatePath("/home")
  revalidatePath(`/trips/${input.currentSlug}`)
  return { slug }
}
```

- [ ] **Step 3: Pass `wasDream` from the form (one line, keeps the build green)**

In `src/app/trips/[slug]/edit/edit-trip-form.tsx`, inside the `updateTrip({ ... })` call (currently lines 64-76), add the `wasDream` field right after `isDream,`:

```ts
        isDream,
        wasDream: initial.isDream,
```

(The rest of the End-field UI is Task 3; this one line is only so the new required input field is supplied and the build stays green.)

- [ ] **Step 4: Verify build + lint**

```bash
cd "C:\Users\Noam West\projects\project-template-couples" && pnpm build && pnpm lint
```
Expected: both pass clean. (Behaviorally nothing changes yet for the user — promotion still requires both dates via the form until Task 3 hides the End field — but the action now correctly handles the promotion-with-days path when `endDate` is null.)

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\Noam West\projects\project-template-couples" && git add src/lib/trips/actions.ts "src/app/trips/[slug]/edit/edit-trip-form.tsx" && git commit -m "feat(itinerary): updateTrip promotes dream days to dated days"
```

---

### Task 3: Edit form — hide End + derived preview when promoting a dream-with-days

**Files:**
- Modify: `src/app/trips/[slug]/edit/page.tsx` (fetch + pass `dreamDayCount`)
- Modify: `src/app/trips/[slug]/edit/edit-trip-form.tsx` (prop + helpers + conditional End)

- [ ] **Step 1: Edit page passes `dreamDayCount`**

In `src/app/trips/[slug]/edit/page.tsx`, after `if (!trip) notFound()` (line 26), add a count query (the `supabase` client already exists at line 18):

```ts
  const { count } = await supabase
    .from("dream_itinerary_days")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", trip.id)
  const dreamDayCount = count ?? 0
```

Then add the prop to the `<EditTripForm>` element — change:

```tsx
      <EditTripForm
        tripId={trip.id}
        initial={{
```

to:

```tsx
      <EditTripForm
        tripId={trip.id}
        dreamDayCount={dreamDayCount}
        initial={{
```

- [ ] **Step 2: Add date helpers to the form file**

In `src/app/trips/[slug]/edit/edit-trip-form.tsx`, after the `const SLUG_RE = /^[a-z0-9-]+$/` line (line 8), add:

```ts
const PREVIEW_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

function fmtPreview(yyyyMmDd: string): string {
  return PREVIEW_FMT.format(new Date(`${yyyyMmDd}T00:00:00Z`))
}

function derivedEnd(start: string, days: number): string {
  const d = new Date(`${start}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days - 1)
  return d.toISOString().slice(0, 10)
}
```

- [ ] **Step 3: Add the `dreamDayCount` prop**

Change the component signature — replace:

```tsx
export function EditTripForm({
  tripId,
  initial,
}: {
  tripId: string
  initial: EditTripInitial
}) {
```

with:

```tsx
export function EditTripForm({
  tripId,
  dreamDayCount,
  initial,
}: {
  tripId: string
  dreamDayCount: number
  initial: EditTripInitial
}) {
```

- [ ] **Step 4: Compute the promotion flag**

After the `const canSubmit = ...` declaration (currently lines 56-57), add:

```ts
  const promotingDreamWithDays =
    initial.isDream && !isDream && dreamDayCount > 0
```

- [ ] **Step 5: Swap the date inputs to a three-way branch**

Replace the entire `isDream ? ( ... ) : ( ... )` date block (currently lines 132-174 — the `When?` label for dreams and the Start/End grid for trips) with:

```tsx
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
        ) : promotingDreamWithDays ? (
          <div className="mt-5">
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
            {startDate ? (
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {dreamDayCount} planned days → {fmtPreview(startDate)}–
                {fmtPreview(derivedEnd(startDate, dreamDayCount))}
                <br />
                (end date set by your itinerary)
              </p>
            ) : null}
          </div>
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
```

- [ ] **Step 6: Verify build + lint**

```bash
cd "C:\Users\Noam West\projects\project-template-couples" && pnpm build && pnpm lint
```
Expected: both pass clean.

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\Noam West\projects\project-template-couples" && git add "src/app/trips/[slug]/edit/page.tsx" "src/app/trips/[slug]/edit/edit-trip-form.tsx" && git commit -m "feat(itinerary): edit form hides end date, previews derived range on dream promotion"
```

---

### Task 4: Final verification + docs

**Files:**
- Modify: `docs/TODO.md` (check off Slice B.2)
- Modify: `docs/DECISIONS.md` (append a row)

- [ ] **Step 1: Full build + lint**

```bash
cd "C:\Users\Noam West\projects\project-template-couples" && pnpm build && pnpm lint
```
Expected: both clean.

- [ ] **Step 2: Manual end-to-end verification**

Paste `supabase/migrations/20260530000002_promote_dream_to_dated.sql` into the Supabase SQL Editor first. Then `pnpm dev` and:
  - On a **dream with planned days** (add 2-3 days first if needed via the dream itinerary tab), open `/trips/<slug>/edit`, uncheck **"This is a dream"**: the End field disappears, only Start shows. Pick a Start date → the preview reads "N planned days → <start>–<end>" and "(end date set by your itinerary)". Save.
  - Lands on the now-dated trip. The **Itinerary** tab shows the former dream days as DAY 01.. on consecutive dates starting at the chosen Start; their tags/titles/sub/tone are preserved. Trip hero shows the date range ending at start + (N−1).
  - Re-open `/trips/<slug>/edit`: it is now a normal dated trip (Start + End both shown). The dream itinerary tab is gone (it's dated now).
  - **Edge — dream with zero planned days:** promoting it still shows both Start and End and requires both (normal flow), no conversion.
  - **Sanity:** editing an already-dated trip (rename, change dates) still works unchanged; demoting a trip back to a dream still works.

- [ ] **Step 3: Update `docs/TODO.md`**

Replace the open Slice B.2 bullet:

```markdown
- **Slice B.2 — Promotion converts dream days to dated days** (open, designed in the Slice B spec). Adding a start date to a dream moves its `dream_itinerary_days` rows into `itinerary_days` with consecutive dates from the start; end date auto-derives to start + (count − 1). No schema change. Build next.
```

with:

```markdown
- [x] **Slice B.2 — Promotion converts dream days to dated days.** Done 2026-05-30. Promoting a dream that has planned days (uncheck "is a dream" + enter a Start in `/trips/[slug]/edit`) moves its `dream_itinerary_days` rows onto consecutive `itinerary_days` (day_index order → Start, Start+1, …), auto-derives `end_date = Start + (count − 1)`, clears `fuzzy_when`, and deletes the dream rows — atomically via the `promote_dream_to_dated(p_trip_id, p_start_date)` RPC (SECURITY INVOKER; converted rows stamped `created_by = auth.uid()` to satisfy itinerary insert RLS). `updateTrip` gained a `wasDream` input + a promotion-with-days branch (non-date fields updated first so slug collisions fail before conversion). The edit form hides the End field and shows a derived preview ("N planned days → Jun 12–Jun 16") when promoting a dream-with-days; zero-day dreams promote via the normal both-dates flow. Spec + plan under `docs/superpowers/`. **User action required**: paste `supabase/migrations/20260530000002_promote_dream_to_dated.sql` into the Supabase SQL Editor.
```

- [ ] **Step 4: Append a row to `docs/DECISIONS.md`**

Match the table format. Add a row (date `2026-05-30`) capturing: dream→dated promotion **moves** days via an atomic `promote_dream_to_dated` RPC (supabase-js can't span the trips-update + insert + delete transactionally); end date is **auto-derived** from the day count (not user-entered) so the trip length equals the plan; converted rows are stamped `created_by = auth.uid()` because the `itinerary_days` insert policy requires it and per-day dream authorship isn't surfaced.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\Noam West\projects\project-template-couples" && git add docs/TODO.md docs/DECISIONS.md && git commit -m "docs: record Slice B.2 dream promotion"
```

---

## Self-Review (completed during plan authoring)

- **Spec coverage (B.2 section):** trigger via `updateTrip` → Task 2; consecutive-date assignment + auto-derived end + move-not-copy (atomic RPC) → Task 1; promotion UX (start-only, hidden end) → Task 3; zero-day edge case (normal both-dates flow) → Tasks 2 + 3; no schema change beyond the function → confirmed. No gaps.
- **Placeholder scan:** none — every step has complete code.
- **Type/name consistency:** `wasDream` added to `UpdateTripInput` (Task 2 Step 1), supplied by the form (Task 2 Step 3). `dreamDayCount` prop defined (Task 3 Step 3), passed by the page (Task 3 Step 1), used in the flag (Step 4) and JSX (Step 5). RPC name `promote_dream_to_dated` + params `p_trip_id` / `p_start_date` match between Task 1 (definition) and Task 2 (caller). Helpers `fmtPreview` / `derivedEnd` defined in Task 3 Step 2 and used in Step 5.
- **Build-green-per-task:** Task 2 includes the form's `wasDream` one-liner so the build never goes red between tasks.
