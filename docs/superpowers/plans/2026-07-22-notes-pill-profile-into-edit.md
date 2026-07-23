# Notes-pill + profile-into-/edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote Notes to its own trip pill and fold the trip profile (idea, vibe, categories, getting-around) into the existing `/trips/[slug]/edit` page, deleting the now-dead Profile tab.

**Architecture:** Two increments on one branch. Increment 1 is additive — `updateTrip` grows `profile` + `categories`, and the edit form renders a flat profile section (reusing the create form's shared `profile-fields.tsx` components), so profile editing gains a second home. Increment 2 flips the 4th pill from `profile` to `notes` (rendering `NotesTab` directly) and deletes `profile-tab.tsx`, `profile-overview.tsx`, `profile-wizard.tsx`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Supabase (`@supabase/ssr`), Tailwind v4. No test framework in this repo — the per-task gate is `pnpm lint` + `pnpm build` clean, plus in-app verification at increment ends.

## Global Constraints

- No new dependencies, no migration, no AI/prompt change (`trips.trip_profile` jsonb and `expense_categories.details` already exist).
- No emojis in code/comments. Sparse comments; clear names. Short functions.
- Client components (`"use client"`) import query-layer *types* from `*-types.ts`, never from `*-queries.ts`.
- Profile shape is exactly `{ idea: string; transport: string[]; vibe: string[] }` (jsonb `trips.trip_profile`).
- Allowed transport values: `TRIP_TRANSPORT`; allowed vibe values: `TRIP_VIBES` (both in `src/lib/trips/trip-profile-types.ts`).
- `expenses.category` is plain text (no FK to `expense_categories.id`), so deleting a category row never affects an expense row. `expense_categories` has `unique(trip_id, name)` and a nullable `created_by`.
- Pills after this work: `Budget · Itinerary · Packing · Notes`; default tab stays `budget`.

---

### Task 1: `updateTrip` persists profile + reconciles categories

**Files:**
- Modify: `src/lib/trips/actions.ts` (`UpdateTripInput` ~817-830; `updateTrip` body ~845-977)

**Interfaces:**
- Consumes: `TRIP_TRANSPORT`, `TRIP_VIBES`, `TripProfile` (already imported at top of `actions.ts`).
- Produces: `UpdateTripInput` gains `profile?: TripProfile` and `categories?: { name: string; details: string[] }[]`. `updateTrip` writes `trip_profile` on every success path (only when `profile` provided) and reconciles `expense_categories` (only when `categories` provided): delete removed-by-name, update details+sort_order on kept, insert new.

- [ ] **Step 1: Extend `UpdateTripInput`**

Add two optional fields to the interface (~817), after `lng`:

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
  profile?: TripProfile
  categories?: { name: string; details: string[] }[]
}
```

- [ ] **Step 2: Build the profile patch + reconcile categories near the top of `updateTrip`**

Immediately after `const country = input.country?.trim() || null` (~871), insert:

```ts
  // Profile patch: only overwrite trip_profile when the caller sent a profile.
  const profilePatch =
    input.profile === undefined
      ? {}
      : {
          trip_profile: {
            idea: input.profile.idea.trim().slice(0, 2000),
            transport: input.profile.transport.filter((t) =>
              (TRIP_TRANSPORT as readonly string[]).includes(t),
            ),
            vibe: input.profile.vibe.filter((v) =>
              (TRIP_VIBES as readonly string[]).includes(v),
            ),
          },
        }

  // Category reconcile: run only when categories are supplied. Categories are
  // independent of the date/slug branches, so this runs once up front; on the
  // rare slug-collision failure below the category edit persists harmlessly
  // (expenses reference category by name text, not by row id).
  if (input.categories) {
    const seen = new Set<string>()
    const clean: { name: string; details: string[] }[] = []
    for (const c of input.categories) {
      const nm = c.name.trim()
      if (!nm || seen.has(nm)) continue
      seen.add(nm)
      const details = Array.from(
        new Set(c.details.map((d) => d.trim()).filter(Boolean)),
      ).slice(0, 20)
      clean.push({ name: nm, details })
    }

    const { data: existing } = await supabase
      .from("expense_categories")
      .select("id, name")
      .eq("trip_id", input.tripId)
    const existingByName = new Map((existing ?? []).map((r) => [r.name, r.id]))

    const keepNames = new Set(clean.map((c) => c.name))
    const removeIds = (existing ?? [])
      .filter((r) => !keepNames.has(r.name))
      .map((r) => r.id)
    if (removeIds.length) {
      const { error } = await supabase
        .from("expense_categories")
        .delete()
        .in("id", removeIds)
      if (error) return { error: error.message }
    }

    const inserts: { trip_id: string; name: string; sort_order: number; details: string[] }[] = []
    for (let i = 0; i < clean.length; i++) {
      const c = clean[i]
      const id = existingByName.get(c.name)
      if (id) {
        const { error } = await supabase
          .from("expense_categories")
          .update({ details: c.details, sort_order: i })
          .eq("id", id)
        if (error) return { error: error.message }
      } else {
        inserts.push({
          trip_id: input.tripId,
          name: c.name,
          sort_order: i,
          details: c.details,
        })
      }
    }
    if (inserts.length) {
      const { error } = await supabase
        .from("expense_categories")
        .insert(inserts)
      if (error) return { error: error.message }
    }
  }
```

- [ ] **Step 3: Add `profilePatch` to all three trip-update calls**

There are three `.update({...})` calls that write trip fields. Spread `...profilePatch` into each object.

(a) Dream branch (~884), add `...profilePatch` as the last field:

```ts
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
        ...profilePatch,
      })
```

(b) Dream-promotion non-date update (~925):

```ts
        .from("trips")
        .update({ name, slug, country, lat: input.lat, lng: input.lng, ...profilePatch })
```

(c) Normal dated update (~955):

```ts
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
      ...profilePatch,
    })
```

- [ ] **Step 4: Validate**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: clean. No caller passes the new fields yet (they are optional), so existing `updateTrip` call sites still type-check.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(edit): updateTrip persists profile + reconciles categories"
```

---

### Task 2: Flat profile section in the /edit page

**Files:**
- Modify: `src/app/trips/[slug]/edit/page.tsx` (fetch profile + categories, pass to form)
- Modify: `src/app/trips/[slug]/edit/edit-trip-form.tsx` (state, render section, pass to `updateTrip`)

**Interfaces:**
- Consumes: `updateTrip` (Task 1, now accepts `profile` + `categories`); `LocalCategoryEditor`, `OptionRow`, `type LocalCategory` (`src/app/trips/profile-fields.tsx`); `TRIP_TRANSPORT`, `TRIP_VIBES` (`trip-profile-types`); `getTripExpenseCategories` (`src/lib/trips/queries` — same helper `page.tsx` uses).
- Produces: `EditTripForm` gains `initialProfile: TripProfile` and `initialCategories: LocalCategory[]` props.

- [ ] **Step 1: Load profile + categories in the edit page**

In `src/app/trips/[slug]/edit/page.tsx`, add the categories fetch after `dreamDayCount` is computed (~32), and pass both profile and categories to the form. Add the import for `getTripExpenseCategories` alongside the existing `getTripBySlug` import.

Add to imports (top of file):

```ts
import { getTripBySlug, getTripExpenseCategories } from "@/lib/trips/queries"
```

(Replace the existing `import { getTripBySlug } from "@/lib/trips/queries"` line.)

After `const dreamDayCount = count ?? 0`:

```ts
  const categories = await getTripExpenseCategories(trip.id)
```

Then extend the `<EditTripForm ... />` usage with two props:

```tsx
      <EditTripForm
        tripId={trip.id}
        dreamDayCount={dreamDayCount}
        initial={{
          name: trip.name,
          slug: trip.slug,
          isDream: trip.startDate === null,
          startDate: trip.startDate,
          endDate: trip.endDate,
          fuzzyWhen: trip.fuzzyWhen,
          country: trip.country,
          lat: trip.lat,
          lng: trip.lng,
        }}
        initialProfile={trip.tripProfile}
        initialCategories={categories.map((c) => ({
          name: c.name,
          details: c.details,
        }))}
      />
```

- [ ] **Step 2: Verify the queries helper name**

Run: `grep -n "getTripExpenseCategories" src/lib/trips/queries.ts`
Expected: a matching `export` line (the same helper `page.tsx` imports). If the export lives elsewhere, import it from the file `page.tsx` imports it from. Do not create a new query.

- [ ] **Step 3: Add profile state + imports to `EditTripForm`**

In `src/app/trips/[slug]/edit/edit-trip-form.tsx`, add imports at the top:

```ts
import {
  LocalCategoryEditor,
  OptionRow,
  type LocalCategory,
} from "../../profile-fields"
import { TRIP_TRANSPORT, TRIP_VIBES, type TripProfile } from "@/lib/trips/trip-profile-types"
```

Extend the props (both the destructure and the type):

```tsx
export function EditTripForm({
  tripId,
  dreamDayCount,
  initial,
  initialProfile,
  initialCategories,
}: {
  tripId: string
  dreamDayCount: number
  initial: EditTripInitial
  initialProfile: TripProfile
  initialCategories: LocalCategory[]
}) {
```

Add state alongside the existing `useState` calls (after `lng`):

```ts
  const [idea, setIdea] = React.useState(initialProfile.idea)
  const [vibe, setVibe] = React.useState<string[]>(initialProfile.vibe)
  const [transport, setTransport] = React.useState<string[]>(
    initialProfile.transport,
  )
  const [categories, setCategories] =
    React.useState<LocalCategory[]>(initialCategories)

  const toggle = (list: string[], set: (v: string[]) => void, tag: string) =>
    set(list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag])
```

- [ ] **Step 4: Pass profile + categories in the submit call**

In `submit`, extend the `updateTrip({...})` call (after `lng: parseFloatOrNull(lng),`):

```ts
        lat: parseFloatOrNull(lat),
        lng: parseFloatOrNull(lng),
        profile: { idea, transport, vibe },
        categories,
```

- [ ] **Step 5: Render the flat profile section**

Insert this block immediately after the `advancedOpen` lat/lng block's closing `) : null}` and before the `{error ? (...)}` block (i.e. between the advanced section and the error line, inside the `<form>`):

```tsx
        <div className="mt-8 border-t border-rule pt-6">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Profile
          </span>

          <label className="mt-5 block">
            <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Describe this trip
            </span>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="e.g. 2 weeks surfing in Portugal"
              rows={3}
              disabled={isPending}
              className="mt-1 w-full resize-y rounded-lg border border-rule bg-transparent p-3 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none disabled:opacity-50"
            />
          </label>

          <div className="mt-5">
            <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Vibe
            </span>
            <div className="mt-2 flex flex-col gap-2">
              {TRIP_VIBES.map((v) => (
                <OptionRow
                  key={v}
                  label={v}
                  selected={vibe.includes(v)}
                  onClick={() => toggle(vibe, setVibe, v)}
                />
              ))}
            </div>
          </div>

          <div className="mt-5">
            <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Categories
            </span>
            <div className="mt-2">
              <LocalCategoryEditor
                categories={categories}
                onChange={setCategories}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="mt-5">
            <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Getting around
            </span>
            <div className="mt-2 flex flex-col gap-2">
              {TRIP_TRANSPORT.map((t) => (
                <OptionRow
                  key={t}
                  label={t}
                  selected={transport.includes(t)}
                  onClick={() => toggle(transport, setTransport, t)}
                />
              ))}
            </div>
          </div>
        </div>
```

- [ ] **Step 6: Validate**

Run: `pnpm lint && pnpm build`
Expected: clean. Then in-app (logged-in): open `/trips/<slug>/edit`, change the idea, toggle a vibe, remove one category and add a detail tag to another, toggle a transport, save. Confirm: the change persists on reopening `/edit`; the removed category is gone from the Budget tab's category list; a re-added detail tag shows.

- [ ] **Step 7: Commit**

```bash
git add src/app/trips/[slug]/edit/page.tsx src/app/trips/[slug]/edit/edit-trip-form.tsx
git commit -m "feat(edit): flat profile section (idea, vibe, categories, transport)"
```

---

### Task 3: Rename the 4th pill to Notes and render NotesTab

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx` (`TabId` ~65; `TABS` ~67-72; `isTab` ~74-80; fetch gates ~185, ~189-193; render branch ~331-341)

**Interfaces:**
- Consumes: `NotesTab` (`./notes-tab`) — already imported transitively; add a direct import. `NotesTab` props: `tripId`, `tripSlug`, `destination`, `initialNotes`, `locations`, `members`.
- Produces: tab id `"notes"` replaces `"profile"` everywhere in `page.tsx`.

- [ ] **Step 1: Import `NotesTab` directly**

Near the other tab imports (~55-63) add:

```ts
import { NotesTab } from "./notes-tab"
```

- [ ] **Step 2: Rename the tab id, label, and guard**

`TabId` (~65):

```ts
type TabId = "itinerary" | "packing" | "budget" | "notes"
```

`TABS` (~67-72) — change the last entry:

```ts
const TABS: { id: TabId; label: string }[] = [
  { id: "budget", label: "Budget" },
  { id: "itinerary", label: "Itinerary" },
  { id: "packing", label: "Packing" },
  { id: "notes", label: "Notes" },
]
```

`isTab` (~74-80) — swap the `"profile"` disjunct for `"notes"` (keep the others exactly):

```ts
function isTab(value: string | undefined): value is TabId {
  return (
    value === "itinerary" ||
    value === "packing" ||
    value === "budget" ||
    value === "notes"
  )
}
```

- [ ] **Step 3: Rewire the fetch gates**

Notes fetch (~185): `activeTab === "profile"` -> `activeTab === "notes"`:

```ts
      activeTab === "notes" ? getTripNotes(header.id) : Promise.resolve(null),
```

`expenseCategories` fetch (~189-193): drop the `activeTab === "profile"` disjunct (Notes doesn't need categories):

```ts
      activeTab === "budget" || (showItinerary && !isDream)
        ? getTripExpenseCategories(header.id)
        : Promise.resolve(null),
```

- [ ] **Step 4: Replace the render branch**

Replace the final `<ProfileTab ... />` branch (~331-341) with `NotesTab`:

```tsx
        ) : (
          <NotesTab
            tripId={header.id}
            tripSlug={header.slug}
            destination={header.country ?? header.name}
            initialNotes={notes ?? []}
            locations={locations ?? []}
            members={memberTones}
          />
        )}
```

- [ ] **Step 5: Validate**

Run: `pnpm lint && pnpm build`
Expected: clean. (`ProfileTab` import is now unused — Task 4 removes it and the file; if the build fails only on the unused import, that is expected and resolved in Task 4. If you prefer a green build here, remove the `import { ProfileTab } from "./profile-tab"` line now.) Remove the unused `ProfileTab` import in this step to keep the build clean:

```ts
```
(Delete the line `import { ProfileTab } from "./profile-tab"` from `page.tsx`.)

Re-run: `pnpm lint && pnpm build` -> clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/trips/[slug]/page.tsx
git commit -m "feat(trip): Notes becomes its own pill (replaces Profile)"
```

---

### Task 4: Delete the dead Profile-tab files

**Files:**
- Delete: `src/app/trips/[slug]/profile-tab.tsx`
- Delete: `src/app/trips/[slug]/profile-overview.tsx`
- Delete: `src/app/trips/[slug]/profile-wizard.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (removal only). `profile-fields.tsx` is kept — it is shared by create and the new edit section.

- [ ] **Step 1: Confirm nothing else references the three files or the old tab**

Run: `grep -rn "profile-tab\|profile-overview\|profile-wizard\|ProfileTab\|ProfileOverview\|ProfileWizard\|tab=profile" src/`
Expected: no matches (Task 3 removed the last `ProfileTab` import). If any stray link points at `?tab=profile`, repoint it to `?tab=notes`. If any live import of `ProfileWizard`/`ProfileOverview` remains, stop and resolve before deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm src/app/trips/[slug]/profile-tab.tsx src/app/trips/[slug]/profile-overview.tsx src/app/trips/[slug]/profile-wizard.tsx
```

- [ ] **Step 3: Validate**

Run: `pnpm lint && pnpm build`
Expected: clean. Then in-app: the 4th pill reads **Notes** and opens the notes hub (General + per-location groups) on both a dated trip and a dream; `/edit` still edits the profile; no route points at `tab=profile`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(trip): delete dead Profile tab (overview + wizard)"
```

---

## Docs wrap-up (after all tasks)

- [ ] `docs/TODO.md`: add a completed entry (Notes promoted to a pill; profile folded into `/edit` as a flat section reusing create's field components; `updateTrip` reconciles categories; Profile tab + wizard + overview deleted; no migration/deps).
- [ ] `docs/DECISIONS.md`: add a row — "Trip profile edited in `/edit` (flat section) not a Profile tab; Notes is its own pill. `updateTrip` reconciles categories by name (removed categories are deleted; expenses keep their category text). Capture-in-context notes deferred."
- [ ] Commit the docs.

## Self-review notes

- Spec coverage: Increment 1 = Tasks 1-2 (updateTrip + edit section); Increment 2 = Tasks 3-4 (Notes pill + deletions). Deferred capture-in-context notes is out of scope by design.
- Category reconcile uses row `id` for deletes/updates (safe against names with special characters); inserts omit `created_by` (nullable, matching the seed migration).
- `profilePatch` is spread into all three trip-update sites (dream, dream-promotion, dated) so the profile saves regardless of trip kind.
