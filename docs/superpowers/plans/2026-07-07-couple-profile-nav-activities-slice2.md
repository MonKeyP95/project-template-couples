# Couple Profile in Nav + Activities (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `/profile` into the app nav as a first-class "Couple profile" destination and add a free-text **activities** field to the couple's durable taste.

**Architecture:** One new `activities text[]` column on the existing `dining_preferences` row (migration already applied), plumbed through the types/query/action. `/profile` is added to the nav key set and reshaped to use the standard `LeftRail` + `MobileHeaderNav` shell (mirroring the Manual page), with the activities input appended to the existing dining-preferences form. Manual only — no AI wiring.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), TypeScript 5, Supabase (`@supabase/ssr`), Tailwind v4.

## Global Constraints

- **No test framework exists.** Verify every task with `pnpm lint` then `pnpm build`; there is no test command — do not invent one.
- **Migration already applied.** `supabase/migrations/20260707000002_dining_activities.sql` (adds `activities text[] not null default '{}'`) was pasted into Supabase and run on 2026-07-07. Do not re-run or add DB tasks.
- **No emojis** in code, prints, or logs. **Sparse comments** — clear names over comments.
- **European date order:** any displayed date uses `en-GB` (the existing member-since line already does; keep it).
- **Reuse, don't duplicate:** activities is one more column + input on the existing `dining_preferences` row/form. No new table, no new component.
- **Suggest-only:** nothing under `lib/ai` changes in this slice.
- Spec: `docs/superpowers/specs/2026-07-07-couple-profile-nav-activities-slice2-design.md`.

---

### Task 1: Plumb the `activities` field through types, query, and action

**Files:**
- Modify: `src/lib/preferences/dining-types.ts`
- Modify: `src/lib/preferences/dining-queries.ts`
- Modify: `src/lib/preferences/dining-actions.ts`

**Interfaces:**
- Consumes: existing `parsePreferenceList(raw: string): string[]`, `normalizeBudgetBand`, `EMPTY_DINING_PREFERENCES`.
- Produces: `DiningPreferences` now carries `activities: string[]`; `getDiningPreferences` returns it; `saveDiningPreferences` reads form field `activities`. Task 3 relies on `dining.activities` being a `string[]`.

- [ ] **Step 1: Add `activities` to the type and empty default**

In `src/lib/preferences/dining-types.ts`, add the field to the interface and the empty constant:

```ts
export interface DiningPreferences {
  budgetBand: BudgetBand
  vibeTags: string[]
  dietary: string[]
  cuisines: string[]
  activities: string[]
}

export const EMPTY_DINING_PREFERENCES: DiningPreferences = {
  budgetBand: "any",
  vibeTags: [],
  dietary: [],
  cuisines: [],
  activities: [],
}
```

- [ ] **Step 2: Select and map `activities` in the query**

In `src/lib/preferences/dining-queries.ts`, add `activities` to the select string and to the returned object:

```ts
  const { data } = await supabase
    .from("dining_preferences")
    .select("budget_band, vibe_tags, dietary, cuisines, activities")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (!data) return EMPTY_DINING_PREFERENCES

  return {
    budgetBand: normalizeBudgetBand(data.budget_band),
    vibeTags: data.vibe_tags ?? [],
    dietary: data.dietary ?? [],
    cuisines: data.cuisines ?? [],
    activities: data.activities ?? [],
  }
```

- [ ] **Step 3: Parse and upsert `activities` in the action**

In `src/lib/preferences/dining-actions.ts`, add the parsed field to the upsert object (after `cuisines`):

```ts
      cuisines: parsePreferenceList(String(formData.get("cuisines") ?? "")),
      activities: parsePreferenceList(String(formData.get("activities") ?? "")),
      updated_at: new Date().toISOString(),
```

- [ ] **Step 4: Lint and build**

Run: `pnpm lint`
Expected: no new errors.
Run: `pnpm build`
Expected: compiles clean (the page still ignores `activities`, so this is purely the data layer).

- [ ] **Step 5: Commit**

```bash
git add src/lib/preferences/dining-types.ts src/lib/preferences/dining-queries.ts src/lib/preferences/dining-actions.ts
git commit -m "feat(profile): add couple activities to dining preferences (slice 2)"
```

---

### Task 2: Add `profile` to the nav

**Files:**
- Modify: `src/components/app-nav.tsx`

**Interfaces:**
- Consumes: existing `NavKey` union, `buildNavDestinations`, `MOBILE_NAV_ORDER`.
- Produces: `NavKey` includes `"profile"`; `buildNavDestinations` returns a `{ key: "profile", label: "Profile", href: "/profile" }` destination; `MOBILE_NAV_ORDER` ends with `"profile"`. Task 3 passes `current="profile"` into `LeftRail` / `MobileHeaderNav`.

- [ ] **Step 1: Extend the `NavKey` union**

In `src/components/app-nav.tsx`, add `"profile"`:

```ts
export type NavKey = "home" | "on-the-road" | "checklists" | "trip" | "manual" | "profile"
```

- [ ] **Step 2: Add Profile to the mobile order**

Append `"profile"` to `MOBILE_NAV_ORDER`:

```ts
const MOBILE_NAV_ORDER: NavKey[] = ["home", "trip", "on-the-road", "manual", "profile"]
```

- [ ] **Step 3: Push the Profile destination**

In `buildNavDestinations`, add the push after the `manual` push (before `return items`):

```ts
  items.push({ key: "manual", label: "Manual", href: "/manual" })
  items.push({ key: "profile", label: "Profile", href: "/profile" })
  return items
```

- [ ] **Step 4: Lint and build**

Run: `pnpm lint`
Expected: no new errors.
Run: `pnpm build`
Expected: compiles clean. Existing pages pass a `current` that is still a valid `NavKey`, so no call site breaks.

- [ ] **Step 5: Commit**

```bash
git add src/components/app-nav.tsx
git commit -m "feat(nav): add Profile destination to rail and mobile order (slice 2)"
```

---

### Task 3: Reshape `/profile` into the app shell + activities input

**Files:**
- Modify: `src/app/profile/page.tsx` (full rewrite of the component)

**Interfaces:**
- Consumes: `LeftRail`, `MobileHeaderNav`, `buildNavDestinations` (Task 2); `getDiningPreferences` returning `dining.activities` (Task 1); existing `getCurrentWorkspace`, `listTripsForWorkspace`, `isDarkTheme`, `updateProfile`, `saveDiningPreferences`, `BUDGET_BANDS`, `AiToggle`, `Button`, `Input`.
- Produces: the final user-facing page. Nothing depends on it.

- [ ] **Step 1: Rewrite the page to use the shell and add the activities input**

Replace the entire contents of `src/app/profile/page.tsx` with:

```tsx
import { redirect } from "next/navigation"

import { updateProfile } from "@/lib/auth/actions"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AiToggle } from "@/components/ai-mode"
import {
  LeftRail,
  MobileHeaderNav,
  buildNavDestinations,
} from "@/components/app-nav"
import { isDarkTheme } from "@/lib/theme"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import { getDiningPreferences } from "@/lib/preferences/dining-queries"
import { BUDGET_BANDS } from "@/lib/preferences/dining-types"
import { saveDiningPreferences } from "@/lib/preferences/dining-actions"

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/profile")

  const workspace = await getCurrentWorkspace()
  if (!workspace) redirect("/home")

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, created_at")
    .eq("id", userData.user.id)
    .single()

  const dark = await isDarkTheme()
  const dining = await getDiningPreferences(workspace.id)
  const buckets = await listTripsForWorkspace(workspace.id)
  const hero = buckets.now[0] ?? buckets.upcoming[0] ?? null
  const navDestinations = buildNavDestinations({
    onTheRoad: buckets.now.length > 0,
    tripSlug: hero?.slug ?? null,
  })

  return (
    <div className="relative mx-auto min-h-screen w-full max-w-[440px] lg:flex lg:max-w-none lg:items-stretch">
      <LeftRail
        workspace={workspace}
        initialDark={dark}
        destinations={navDestinations}
        current="profile"
      />
      <main className="w-full px-5 pt-14 pb-16 lg:min-w-0 lg:flex-1 lg:px-12 lg:pt-12">
        <MobileHeaderNav
          destinations={navDestinations}
          current="profile"
          className="mb-4"
        />
        <div className="mx-auto w-full max-w-sm">
          <h1 className="font-serif text-4xl tracking-tight">Couple profile</h1>

          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <form action={updateProfile as any} className="mt-8 flex flex-col gap-3">
            <Input
              name="display_name"
              placeholder="Display name"
              defaultValue={profile?.display_name}
              required
            />
            <Button type="submit" size="lg" className="mt-2">
              Save
            </Button>
          </form>

          <dl className="mt-10 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Email</dt>
              <dd>{userData.user.email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Member since</dt>
              <dd>
                {profile?.created_at
                  ? new Date(profile.created_at).toLocaleDateString("en-GB")
                  : "—"}
              </dd>
            </div>
          </dl>

          <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
            <span className="text-sm text-muted-foreground">
              AI assistant (off by default)
            </span>
            <AiToggle />
          </div>

          <form
            key={[
              dining.budgetBand,
              dining.vibeTags.join(","),
              dining.dietary.join(","),
              dining.cuisines.join(","),
              dining.activities.join(","),
            ].join("|")}
            action={saveDiningPreferences}
            className="mt-4 border-t border-border pt-6"
          >
            <p className="text-sm text-muted-foreground">
              What we like (used by the AI to suggest places)
            </p>
            <label className="mt-4 block text-xs text-muted-foreground">
              Budget
              <select
                name="budget_band"
                defaultValue={dining.budgetBand}
                className="mt-1 block w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
              >
                {BUDGET_BANDS.map((band) => (
                  <option key={band} value={band}>
                    {band}
                  </option>
                ))}
              </select>
            </label>
            <Input
              name="vibe_tags"
              placeholder="Vibe (e.g. quiet, walkable, lively)"
              defaultValue={dining.vibeTags.join(", ")}
              className="mt-3"
            />
            <Input
              name="dietary"
              placeholder="Dietary (e.g. vegetarian, gluten-free)"
              defaultValue={dining.dietary.join(", ")}
              className="mt-3"
            />
            <Input
              name="cuisines"
              placeholder="Cuisines you love (e.g. seafood, Thai)"
              defaultValue={dining.cuisines.join(", ")}
              className="mt-3"
            />
            <Input
              name="activities"
              placeholder="Activities you love (e.g. surf, hike, museums)"
              defaultValue={dining.activities.join(", ")}
              className="mt-3"
            />
            <Button type="submit" variant="outline" size="sm" className="mt-4">
              Save preferences
            </Button>
          </form>
        </div>
      </main>
    </div>
  )
}
```

Note what changed vs. the old page: added the workspace guard + shell wrapper (`LeftRail`/`MobileHeaderNav`), heading is now "Couple profile", the in-body `ThemeToggle` (Appearance) row and "Back to home" link are **removed** (the rail carries them), the `dining` form is no longer wrapped in `{dining && ...}` (the workspace guard makes `dining` always present), the `activities` input is added after cuisines, and `dining.activities.join(",")` is added to the form `key`. The `ThemeToggle` and `Link`/`Label` imports are dropped.

- [ ] **Step 2: Lint and build**

Run: `pnpm lint`
Expected: no new errors, no unused-import warnings (confirm `ThemeToggle`, `Link`, `Label` are not imported).
Run: `pnpm build`
Expected: compiles clean.

- [ ] **Step 3: Manual in-app verification**

Run: `pnpm dev`, open `http://localhost:3000/profile`.
Expected:
- The page renders inside the app shell: desktop shows the `LeftRail` with a highlighted **Profile** entry; mobile shows the header arrows + sign-out.
- Heading reads "Couple profile".
- The dining-preferences form shows an **Activities you love** input.
- Type e.g. `surf, hike, museums` into Activities, click **Save preferences**; the page reloads and the input re-shows the saved, de-duped values.
- No in-body Appearance toggle or "Back to home" link remains.

- [ ] **Step 4: Commit**

```bash
git add src/app/profile/page.tsx
git commit -m "feat(profile): reshape into nav shell as Couple profile + activities input (slice 2)"
```

---

### Task 4: Update the docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Add a TODO entry**

Prepend a status paragraph under the "Two-level profile" section of `docs/TODO.md` noting slice 2 shipped: couple activities column on `dining_preferences`, `/profile` promoted into the nav as "Couple profile", activities free-text input added; discovery picks up activities via the existing `dining_preferences` merge but ranking is untouched. Reference the spec and this plan. Match the wording/format of the existing slice entries.

- [ ] **Step 2: Add a DECISIONS row (only if a non-obvious choice stands out)**

If warranted, append a row to `docs/DECISIONS.md`: activities modelled as a free-text list on `dining_preferences` (not a fixed chip set) for consistency with the sibling taste fields. Skip if it feels redundant with the spec.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: mark couple profile nav + activities (slice 2) shipped"
```

---

## Self-Review

**Spec coverage:**
- Spec §1 (data model) → Task 1 (migration noted as already applied in Global Constraints). Covered.
- Spec §2 (nav wiring) → Task 2. Covered.
- Spec §3 (reshape into shell) → Task 3. Covered.
- Spec §4 (activities input) → Task 3 Step 1. Covered.
- Deferred items (slices 3/4) → correctly excluded.

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. Task 4 Step 2 is conditional by design (a documented judgment call, not a placeholder).

**Type consistency:** `activities: string[]` is defined in Task 1 and consumed as `dining.activities` in Task 3; `NavKey` gains `"profile"` in Task 2 and is used as `current="profile"` in Task 3; `buildNavDestinations`/`LeftRail`/`MobileHeaderNav` signatures are unchanged (only a new destination is pushed). Consistent.
