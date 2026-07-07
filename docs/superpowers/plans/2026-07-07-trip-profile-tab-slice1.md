# Trip Profile Tab (Two-level profile, Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the trip's Notes tab into a "Profile" tab — a structured trip profile (headline + chips + free brief) above the existing notes — with the headline shown under the trip header, and new trips landing on it.

**Architecture:** One `jsonb` column `trip_profile` on `trips` (manual migration), a tolerant `parseTripProfile`, a `saveTripProfile` action, and a new `ProfileTab` that renders the profile form and reuses the existing `<NotesTab>` unchanged below. Manual only — no AI reads it yet.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Supabase (jsonb, no ORM, manual migrations), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-07-trip-profile-tab-slice1-design.md`
**Vision:** `docs/superpowers/specs/2026-07-07-two-level-profile-vision.md`

> **Amended during build (2026-07-07):** on user feedback the separate
> **Activities** field was dropped. The Profile instead shows the trip's shared
> **`expense_categories`** (same list as Budget; add/remove via the existing
> `addExpenseCategory` / `deleteExpenseCategory`), and **"About this trip" moved
> to the top**. Net effect on the tasks below: `TripProfile` carries no
> `activities` (Tasks 1–3 omit it), and `ProfileTab` (Task 4) renders a
> `TripCategories` editor — fed by `getTripExpenseCategories`, which Task 5 also
> loads for the profile tab — in place of the Activities chips/`AddChip`. The
> reconciled spec §4a is the source of truth for the final design.

## Global Constraints

- **Manual migration.** The `trip_profile` column is added by pasting SQL into the shared Supabase SQL editor (single shared DB — local dev and prod are the same). The code compiles without it, but runtime reads/writes of `trip_profile` fail until it's pasted. Paste before the manual browser check.
- **Vibe/Who fixed; Activities extensible (per-trip).** `TRIP_ACTIVITIES` are default suggestions — users can add custom activity tags, kept per-trip (like the packing/expense category bars). `parseTripProfile`/`saveTripProfile` filter vibe/who to the allowed sets but keep `activities` as free strings (trim, dedupe, cap ≤ 20 × ≤ 40 chars).
- **Manual only.** No AI reads the trip profile in this slice (that's Slice 3). No realtime on profile fields; notes keep their own actions + realtime.
- **Tab id rename `notes` → `profile`.** Update the `TabId` union, `TABS`, `isTab`, and both `activeTab === "notes"` branches. Old `?tab=notes` URLs fall back to the default tab — acceptable (personal app, no external links).
- **No test framework.** Verify with `npx tsc --noEmit` + `pnpm lint`, plus a 390px manual check for UI tasks (after pasting the migration).
- **Commits:** the user commits only when they ask. Treat "Commit" steps as optional checkpoints; never push.
- **No emojis in code/logs.**

---

### Task 1: Migration + `trip-profile-types.ts`

**Files:**
- Create: `supabase/migrations/20260707000001_trip_profile.sql`
- Create: `src/lib/trips/trip-profile-types.ts`

**Interfaces:**
- Produces: `TripProfile`, `EMPTY_TRIP_PROFILE`, `TRIP_ACTIVITIES`, `TRIP_VIBES`, `TRIP_WHO`, `parseTripProfile(raw): TripProfile`.

- [ ] **Step 1: Write the migration**

```sql
-- Trip profile (two-level profile, slice 1): per-trip structured profile
-- (headline + chips + free brief) stored as one jsonb column. Idempotent.
alter table trips add column if not exists trip_profile jsonb;
```

- [ ] **Step 2: Write the types module**

```ts
export const TRIP_ACTIVITIES = [
  "Surf",
  "Hike",
  "Dive/snorkel",
  "Beach",
  "Food & drink",
  "Museums/culture",
  "Nightlife",
  "Wildlife/nature",
  "Road trip",
  "Ski/snow",
  "Wellness/spa",
] as const

export const TRIP_VIBES = [
  "Romantic",
  "Adventurous",
  "Relaxed",
  "Social/lively",
  "Cultural",
  "Off-the-beaten-path",
  "Luxe",
] as const

export const TRIP_WHO = ["Just us", "+ kids", "+ friends", "+ family"] as const

export interface TripProfile {
  headline: string
  activities: string[]
  vibe: string[]
  who: string
  brief: string
}

export const EMPTY_TRIP_PROFILE: TripProfile = {
  headline: "",
  activities: [],
  vibe: [],
  who: "",
  brief: "",
}

/** Tolerant parse of the jsonb `trip_profile` column. Keeps only allowed
 * chip values; coerces text; never throws on legacy/malformed data. */
export function parseTripProfile(raw: unknown): TripProfile {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_TRIP_PROFILE }
  const r = raw as Record<string, unknown>
  const pick = (v: unknown, allowed: readonly string[]): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && allowed.includes(x))
      : []
  const freeTags = (v: unknown): string[] =>
    Array.isArray(v)
      ? Array.from(
          new Set(
            v
              .filter((x): x is string => typeof x === "string")
              .map((x) => x.trim())
              .filter((x) => x.length > 0),
          ),
        ).slice(0, 20)
      : []
  return {
    headline: typeof r.headline === "string" ? r.headline : "",
    activities: freeTags(r.activities),
    vibe: pick(r.vibe, TRIP_VIBES),
    who:
      typeof r.who === "string" && (TRIP_WHO as readonly string[]).includes(r.who)
        ? r.who
        : "",
    brief: typeof r.brief === "string" ? r.brief : "",
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit** (only if the user has asked)

```bash
git add supabase/migrations/20260707000001_trip_profile.sql src/lib/trips/trip-profile-types.ts
git commit -m "feat(trips): trip_profile column + types (profile slice 1)"
```

---

### Task 2: Load `trip_profile` in the trip query

**Files:**
- Modify: `src/lib/trips/queries.ts` (`TripHeader`, `TripRow`, `getTripBySlug`)

**Interfaces:**
- Consumes: `parseTripProfile`, `TripProfile` (Task 1).
- Produces: `TripHeader.tripProfile: TripProfile`.

- [ ] **Step 1: Import the types**

Add at the top of `queries.ts`:
```ts
import { parseTripProfile, type TripProfile } from "./trip-profile-types"
```

- [ ] **Step 2: Add `tripProfile` to `TripHeader`**

After `plannedBudgetCents: number` in the `TripHeader` interface, add:
```ts
  /** Per-trip structured profile (slice 1). */
  tripProfile: TripProfile
```

- [ ] **Step 3: Add the raw column to `TripRow`**

After `planned_budget_cents: number` in `TripRow`, add:
```ts
  trip_profile: unknown
```

- [ ] **Step 4: Select it**

In `getTripBySlug`, change the select string:
```ts
      "id, workspace_id, slug, name, country, start_date, end_date, fuzzy_when, lat, lng, planned_budget_cents",
```
to:
```ts
      "id, workspace_id, slug, name, country, start_date, end_date, fuzzy_when, lat, lng, planned_budget_cents, trip_profile",
```

- [ ] **Step 5: Map it in the return**

After `plannedBudgetCents: trip.planned_budget_cents,` in the returned object, add:
```ts
    tripProfile: parseTripProfile(trip.trip_profile),
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit** (only if the user has asked)

```bash
git add src/lib/trips/queries.ts
git commit -m "feat(trips): load trip_profile in getTripBySlug (profile slice 1)"
```

---

### Task 3: `saveTripProfile` action

**Files:**
- Modify: `src/lib/trips/actions.ts` (import; `SaveTripProfileInput` + `saveTripProfile`)

**Interfaces:**
- Consumes: `TripProfile`, `TRIP_ACTIVITIES`, `TRIP_VIBES`, `TRIP_WHO` (Task 1).
- Produces: `saveTripProfile(input: SaveTripProfileInput)`.

- [ ] **Step 1: Import the profile types/constants**

Add near the other `@/lib/trips` imports at the top of `actions.ts`:
```ts
import {
  TRIP_VIBES,
  TRIP_WHO,
  type TripProfile,
} from "./trip-profile-types"
```
(Activities are no longer allowlisted, so `TRIP_ACTIVITIES` is not imported here — importing it unused would fail lint.)

- [ ] **Step 2: Add the action (near the other trip actions)**

```ts
export interface SaveTripProfileInput {
  tripId: string
  tripSlug: string
  profile: TripProfile
}

/** Writes the per-trip profile (headline + chips + brief) to trips.trip_profile.
 * Drops chip values outside the allowed sets and caps text. RLS gates the
 * write to workspace members. Manual — no AI involved. */
export async function saveTripProfile(
  input: SaveTripProfileInput,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const p = input.profile
  const activities = Array.from(
    new Set(p.activities.map((a) => a.trim()).filter((a) => a.length > 0)),
  )
    .slice(0, 20)
    .map((a) => a.slice(0, 40))
  const clean = {
    headline: p.headline.trim().slice(0, 80),
    activities,
    vibe: p.vibe.filter((v) => (TRIP_VIBES as readonly string[]).includes(v)),
    who: (TRIP_WHO as readonly string[]).includes(p.who) ? p.who : "",
    brief: p.brief.trim().slice(0, 2000),
  }

  const { error } = await supabase
    .from("trips")
    .update({ trip_profile: clean })
    .eq("id", input.tripId)
  if (error) return { error: error.message }

  revalidatePath(`/trips/${input.tripSlug}`)
  return {}
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit** (only if the user has asked)

```bash
git add src/lib/trips/actions.ts
git commit -m "feat(trips): saveTripProfile action (profile slice 1)"
```

---

### Task 4: `ProfileTab` component

**Files:**
- Create: `src/app/trips/[slug]/profile-tab.tsx`

**Interfaces:**
- Consumes: `saveTripProfile` (Task 3); `TRIP_ACTIVITIES`/`TRIP_VIBES`/`TRIP_WHO`/`TripProfile` (Task 1); the existing `NotesTab`.
- Produces: `ProfileTab(props: React.ComponentProps<typeof NotesTab> & { profile: TripProfile })` — the profile form above a reused `<NotesTab>`.

- [ ] **Step 1: Create the component**

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { NotesTab } from "./notes-tab"
import { saveTripProfile } from "@/lib/trips/actions"
import {
  TRIP_ACTIVITIES,
  TRIP_VIBES,
  TRIP_WHO,
  type TripProfile,
} from "@/lib/trips/trip-profile-types"

/** The trip "Profile" tab: a structured trip profile (headline + chips + brief)
 * above the existing notes feature, reused unchanged. Manual — no AI. */
export function ProfileTab({
  profile,
  ...notesProps
}: React.ComponentProps<typeof NotesTab> & { profile: TripProfile }) {
  const router = useRouter()
  const { tripId, tripSlug } = notesProps
  const [headline, setHeadline] = React.useState(profile.headline)
  const [activities, setActivities] = React.useState<string[]>(profile.activities)
  const [vibe, setVibe] = React.useState<string[]>(profile.vibe)
  const [who, setWho] = React.useState(profile.who)
  const [brief, setBrief] = React.useState(profile.brief)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)

  function toggle(list: string[], setList: (v: string[]) => void, tag: string) {
    setSaved(false)
    setList(list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag])
  }

  function save() {
    setSaving(true)
    saveTripProfile({
      tripId,
      tripSlug,
      profile: { headline, activities, vibe, who, brief },
    }).then((r) => {
      setSaving(false)
      if (r.error) return
      setSaved(true)
      router.refresh()
    })
  }

  return (
    <>
      <section className="px-5 pt-5 lg:px-10 lg:pt-6">
        <input
          type="text"
          value={headline}
          onChange={(e) => {
            setHeadline(e.target.value)
            setSaved(false)
          }}
          placeholder="Trip headline — e.g. Surfing trip · 2 weeks"
          className="t-display w-full border-0 bg-transparent text-[22px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />

        <ChipGroup label="Activities">
          {TRIP_ACTIVITIES.map((a) => (
            <Chip
              key={a}
              on={activities.includes(a)}
              onClick={() => toggle(activities, setActivities, a)}
            >
              {a}
            </Chip>
          ))}
          {activities
            .filter((a) => !(TRIP_ACTIVITIES as readonly string[]).includes(a))
            .map((a) => (
              <Chip key={a} on onClick={() => toggle(activities, setActivities, a)}>
                {a}
              </Chip>
            ))}
          <AddChip
            onAdd={(v) => {
              setSaved(false)
              if (!activities.includes(v)) setActivities([...activities, v])
            }}
          />
        </ChipGroup>

        <ChipGroup label="Vibe">
          {TRIP_VIBES.map((v) => (
            <Chip key={v} on={vibe.includes(v)} onClick={() => toggle(vibe, setVibe, v)}>
              {v}
            </Chip>
          ))}
        </ChipGroup>

        <ChipGroup label="Who's coming">
          {TRIP_WHO.map((w) => (
            <Chip
              key={w}
              on={who === w}
              onClick={() => {
                setSaved(false)
                setWho(who === w ? "" : w)
              }}
            >
              {w}
            </Chip>
          ))}
        </ChipGroup>

        <div className="mt-4">
          <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            About this trip
          </span>
          <textarea
            value={brief}
            onChange={(e) => {
              setBrief(e.target.value)
              setSaved(false)
            }}
            placeholder="Anything the chips don't capture…"
            rows={3}
            className="mt-1.5 w-full resize-y rounded-lg border border-rule bg-transparent p-2.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-clay focus:outline-none"
          />
        </div>

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="mt-4 rounded-full border-0 bg-foreground px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-background disabled:opacity-40"
        >
          {saving ? "saving…" : saved ? "saved" : "save profile"}
        </button>
      </section>

      <NotesTab {...notesProps} />
    </>
  )
}

function ChipGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mt-4">
      <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1 font-mono text-[11px] tracking-[0.06em] ${
        on
          ? "border-foreground bg-foreground text-background"
          : "border-rule text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  )
}

function AddChip({ onAdd }: { onAdd: (v: string) => void }) {
  const [v, setV] = React.useState("")
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          const t = v.trim()
          if (t) {
            onAdd(t)
            setV("")
          }
        }
      }}
      placeholder="+ add"
      className="w-20 rounded-full border border-dashed border-rule bg-transparent px-3 py-1 font-mono text-[11px] tracking-[0.06em] text-foreground placeholder:text-muted-foreground focus:w-28 focus:border-clay focus:outline-none"
    />
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: both exit 0. (Mounted in Task 5.)

- [ ] **Step 3: Commit** (only if the user has asked)

```bash
git add "src/app/trips/[slug]/profile-tab.tsx"
git commit -m "feat(trips): ProfileTab (form + reused NotesTab) (profile slice 1)"
```

---

### Task 5: Wire it up — tab rename, render, header subtitle, new-trip nav

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx` (tab id/label/guard; load branches; render `ProfileTab`; header subtitle)
- Modify: `src/app/trips/new/new-trip-form.tsx` (post-create nav)

**Interfaces:**
- Consumes: `ProfileTab` (Task 4); `TripHeader.tripProfile` (Task 2).

- [ ] **Step 1: Rename the tab id + label + guard (page.tsx)**

Change the `TabId` union:
```ts
type TabId = "itinerary" | "packing" | "budget" | "notes"
```
to:
```ts
type TabId = "itinerary" | "packing" | "budget" | "profile"
```
Change the `TABS` entry:
```ts
  { id: "notes", label: "Notes" },
```
to:
```ts
  { id: "profile", label: "Profile" },
```
Change the `isTab` guard:
```ts
    value === "budget" ||
    value === "notes"
  )
```
to:
```ts
    value === "budget" ||
    value === "profile"
  )
```

- [ ] **Step 2: Update the two load branches (page.tsx)**

Change:
```ts
      (showItinerary && !isDream) ||
      activeTab === "budget" ||
      activeTab === "notes"
        ? getItineraryLocations(header.id)
```
to:
```ts
      (showItinerary && !isDream) ||
      activeTab === "budget" ||
      activeTab === "profile"
        ? getItineraryLocations(header.id)
```
and:
```ts
      activeTab === "notes" ? getTripNotes(header.id) : Promise.resolve(null),
```
to:
```ts
      activeTab === "profile" ? getTripNotes(header.id) : Promise.resolve(null),
```

- [ ] **Step 3: Render `ProfileTab` instead of `NotesTab` (page.tsx)**

Swap the import:
```ts
import { NotesTab } from "./notes-tab"
```
to:
```ts
import { ProfileTab } from "./profile-tab"
```
Change the final render branch:
```tsx
        ) : (
          <NotesTab
            tripId={header.id}
            tripSlug={header.slug}
            initialNotes={notes ?? []}
            locations={locations ?? []}
            members={memberTones}
          />
        )}
```
to:
```tsx
        ) : (
          <ProfileTab
            profile={header.tripProfile}
            tripId={header.id}
            tripSlug={header.slug}
            initialNotes={notes ?? []}
            locations={locations ?? []}
            members={memberTones}
          />
        )}
```

- [ ] **Step 4: Headline subtitle under the trip header (page.tsx, `TripHeaderView`)**

After the country block:
```tsx
          {header.country ? (
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              {header.country}
            </div>
          ) : null}
```
add:
```tsx
          {header.tripProfile.headline ? (
            <div className="mt-1.5 font-mono text-[11px] tracking-[0.06em] text-muted-foreground">
              {header.tripProfile.headline}
            </div>
          ) : null}
```

- [ ] **Step 5: New trip/dream lands on the Profile tab (new-trip-form.tsx)**

Change:
```tsx
      router.push(`/trips/${result.slug}`)
```
to:
```tsx
      router.push(`/trips/${result.slug}?tab=profile`)
```

- [ ] **Step 6: Typecheck + lint + build**

Run: `npx tsc --noEmit && pnpm lint && pnpm build`
Expected: all exit 0.

- [ ] **Step 7: Paste the migration, then manual check (390px)**

Paste `supabase/migrations/20260707000001_trip_profile.sql` into the Supabase SQL editor (shared DB) and run it. Then: open a trip → the tab reads **Profile**; the form (headline, Activities/Vibe chips, Who's-coming, brief) sits above the existing Notes section. Set a headline + some chips + brief → **save profile** → reload shows them; the headline appears as a subtitle under the trip header. Create a new trip or dream → it opens on the Profile tab. An old trip (no profile) shows an empty form and unchanged notes.

- [ ] **Step 8: Commit** (only if the user has asked)

```bash
git add "src/app/trips/[slug]/page.tsx" src/app/trips/new/new-trip-form.tsx
git commit -m "feat(trips): Notes tab -> Profile tab; headline subtitle; new trips land there (profile slice 1)"
```

---

## Notes for the implementer

- **Paste the migration** before any runtime/manual check — the code compiles without the column, but reads/writes 500 until it exists (single shared Supabase; there is no separate prod paste).
- **Manual only** — nothing here reads the trip profile into the AI. That is Slice 3.
- **Notes are untouched** — `NotesTab` is reused as-is; do not modify it.
- **Old `?tab=notes` links** now fall back to the default tab — expected.
- After the tasks: update `docs/TODO.md` (Slice 1 shipped; link the vision doc) and retire the old "Idea — per-trip profile (paused)" entry (superseded by the vision doc).

