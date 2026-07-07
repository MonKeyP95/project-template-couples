# Couple Profile on the Category Spine (Slice 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the couple-taste zone of `/profile` into four collapsible category sections (Food / Activities / Accommodation / Transport), with per-section saves.

**Architecture:** Presentation-only slice. A new client accordion component (`profile-category.tsx`) wraps each category. The single `saveDiningPreferences` action splits into `saveFoodPreferences` (budget/vibe/dietary/cuisines) and `saveActivities` (activities), both partial-upserting the same `dining_preferences` row. `page.tsx` restructures its couple-taste zone to use them; the account zone is untouched. No schema, no dependencies, no AI changes.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), React 19 client component, TypeScript, Tailwind v4, Supabase upsert.

## Global Constraints

- No test framework in this repo. Verification is `pnpm lint` + `pnpm build` only. Do not invent a test command.
- No emojis in code, copy, or logs.
- No new columns, migrations, dependencies, or AI/`lib/ai` changes. Accommodation/Transport are label-only (no fields).
- Reuse existing helpers unchanged: `getDiningPreferences`, `parsePreferenceList`, `normalizeBudgetBand`, `DiningPreferences`, `EMPTY_DINING_PREFERENCES`, `BUDGET_BANDS`.
- Dates display via `toLocaleDateString("en-GB")` (already in the account zone — leave as-is).
- Verbatim copy — section titles: `Food`, `Activities`, `Accommodation`, `Transport`. Button labels: `Save food`, `Save activities`. Empty-home lines (exact): Accommodation = `Nothing here yet — this will hold what you look for in a place to stay.`; Transport = `Nothing here yet — this will hold how you like to get around.`
- Default open state: Food expanded (`defaultOpen`); Activities, Accommodation, Transport collapsed. Accommodation and Transport show `empty` as their collapsed header hint.
- `dining_preferences` row is keyed by `workspace_id`; every upsert uses `{ onConflict: "workspace_id" }` and sets `updated_at`.

---

### Task 1: Profile category accordion component

**Files:**
- Create: `src/app/profile/profile-category.tsx`

**Interfaces:**
- Produces: `ProfileCategory({ title: string, hint?: string, defaultOpen?: boolean, children: React.ReactNode })` — a `"use client"` collapsible section. Header row is a full-width toggle button (title + optional muted `hint` + a `▾`/`▸` affordance); the `children` body renders only when open. Independent local `useState`.

- [ ] **Step 1: Create the component**

Create `src/app/profile/profile-category.tsx`:

```tsx
"use client"

import * as React from "react"

/** One couple-profile category: an always-visible header (title + optional
 * muted hint) that toggles a collapsible body. Each panel keeps its own state. */
export function ProfileCategory({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string
  hint?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <section className="border-t border-border pt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="font-serif text-xl tracking-tight">{title}</span>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          {hint ? <span>{hint}</span> : null}
          <span aria-hidden>{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open ? <div className="mt-4">{children}</div> : null}
    </section>
  )
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors (the component is not yet imported anywhere; that is fine).

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build succeeds. (On Windows, if it panics with exit `0xc0000142`, delete `.next/` and retry — that is a known Turbopack subprocess flake, not a code error.)

- [ ] **Step 4: Commit**

```bash
git add src/app/profile/profile-category.tsx
git commit -m "feat(profile): collapsible category section component (slice 4)"
```

---

### Task 2: Split the save action

**Files:**
- Modify: `src/lib/preferences/dining-actions.ts`

**Interfaces:**
- Consumes (unchanged): `getCurrentWorkspace` (`@/lib/workspace/queries`), `createClient` (`@/lib/supabase/server`), `normalizeBudgetBand` + `parsePreferenceList` (`./dining-types`), `revalidatePath` (`next/cache`).
- Produces: `saveFoodPreferences(formData: FormData): Promise<void>` — upserts `budget_band`, `vibe_tags`, `dietary`, `cuisines`. `saveActivities(formData: FormData): Promise<void>` — upserts `activities`. Both keep `saveDiningPreferences` in place for now (removed in Task 3) so the current `page.tsx` import still resolves and the build stays green.

- [ ] **Step 1: Add the two narrowed actions**

In `src/lib/preferences/dining-actions.ts`, append after the existing `saveDiningPreferences` function (keep `saveDiningPreferences` for now):

```ts
/** Upserts only the Food columns of the current workspace's dining preferences. */
export async function saveFoodPreferences(formData: FormData): Promise<void> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return

  const supabase = await createClient()
  await supabase.from("dining_preferences").upsert(
    {
      workspace_id: workspace.id,
      budget_band: normalizeBudgetBand(String(formData.get("budget_band") ?? "")),
      vibe_tags: parsePreferenceList(String(formData.get("vibe_tags") ?? "")),
      dietary: parsePreferenceList(String(formData.get("dietary") ?? "")),
      cuisines: parsePreferenceList(String(formData.get("cuisines") ?? "")),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  )

  revalidatePath("/profile")
}

/** Upserts only the activities column of the current workspace's preferences. */
export async function saveActivities(formData: FormData): Promise<void> {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return

  const supabase = await createClient()
  await supabase.from("dining_preferences").upsert(
    {
      workspace_id: workspace.id,
      activities: parsePreferenceList(String(formData.get("activities") ?? "")),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  )

  revalidatePath("/profile")
}
```

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: build succeeds (both old and new actions coexist).

- [ ] **Step 4: Commit**

```bash
git add src/lib/preferences/dining-actions.ts
git commit -m "feat(profile): split dining save into food + activities actions (slice 4)"
```

---

### Task 3: Restructure the profile page onto the category spine

**Files:**
- Modify: `src/app/profile/page.tsx` (replace the whole file)
- Modify: `src/lib/preferences/dining-actions.ts` (remove the now-orphaned `saveDiningPreferences`)

**Interfaces:**
- Consumes: `ProfileCategory` (Task 1, `./profile-category`); `saveFoodPreferences` + `saveActivities` (Task 2, `@/lib/preferences/dining-actions`); existing `getDiningPreferences`, `BUDGET_BANDS`, `updateProfile`, `AiToggle`, `LeftRail`/`MobileHeaderNav`/`buildNavDestinations`, `Button`, `Input`, `isDarkTheme`, `getCurrentWorkspace`, `listTripsForWorkspace`.
- Produces: the restructured `/profile`. After this task `saveDiningPreferences` has no caller and is deleted.

- [ ] **Step 1: Replace `src/app/profile/page.tsx`**

Replace the entire file with:

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
import {
  saveActivities,
  saveFoodPreferences,
} from "@/lib/preferences/dining-actions"
import { ProfileCategory } from "./profile-category"

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

  const foodKey = [
    dining.budgetBand,
    dining.vibeTags.join(","),
    dining.dietary.join(","),
    dining.cuisines.join(","),
  ].join("|")

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

          <p className="mt-8 text-sm text-muted-foreground">
            What we like (used by the AI to suggest places)
          </p>
          <div className="mt-4 flex flex-col gap-5">
            <ProfileCategory title="Food" defaultOpen>
              <form key={foodKey} action={saveFoodPreferences}>
                <label className="block text-xs text-muted-foreground">
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
                <Button type="submit" variant="outline" size="sm" className="mt-4">
                  Save food
                </Button>
              </form>
            </ProfileCategory>

            <ProfileCategory title="Activities">
              <form key={dining.activities.join(",")} action={saveActivities}>
                <Input
                  name="activities"
                  placeholder="Activities you love (e.g. surf, hike, museums)"
                  defaultValue={dining.activities.join(", ")}
                />
                <Button type="submit" variant="outline" size="sm" className="mt-4">
                  Save activities
                </Button>
              </form>
            </ProfileCategory>

            <ProfileCategory title="Accommodation" hint="empty">
              <p className="text-sm text-muted-foreground">
                Nothing here yet — this will hold what you look for in a place to
                stay.
              </p>
            </ProfileCategory>

            <ProfileCategory title="Transport" hint="empty">
              <p className="text-sm text-muted-foreground">
                Nothing here yet — this will hold how you like to get around.
              </p>
            </ProfileCategory>
          </div>
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Remove the orphaned action**

In `src/lib/preferences/dining-actions.ts`, delete the entire `saveDiningPreferences` function (the one that upserts all five columns, including `activities`). Keep `saveFoodPreferences` and `saveActivities`. Leave the imports (`revalidatePath`, `createClient`, `getCurrentWorkspace`, `normalizeBudgetBand`, `parsePreferenceList`) — both remaining actions still use them.

- [ ] **Step 3: Verify no caller of the deleted action remains**

Run: `git grep -n "saveDiningPreferences" -- "src/"`
Expected: no output (only docs may still mention it; `src/` must be clean).

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: no errors, no unused-import warnings.

- [ ] **Step 5: Build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/profile/page.tsx src/lib/preferences/dining-actions.ts
git commit -m "feat(profile): couple profile on Food/Activities/Accommodation/Transport spine (slice 4)"
```

---

## Post-implementation (controller / human)

- **Live check** (needs a logged-in session): open `/profile`. Confirm Food is expanded and Activities/Accommodation/Transport are collapsed with an `empty` hint on the latter two. Expand each; edit Food and click **Save food**, confirm values persist and Activities is untouched; edit Activities and **Save activities**, confirm Food is untouched (the partial-upsert guarantee). Accommodation/Transport show only their copy.
- **Docs:** update `docs/TODO.md` (slice 4 status) after live verification. Add a `docs/DECISIONS.md` row only if a non-obvious choice was made (the split-action partial-upsert is arguably one).

## Self-Review notes

- Spec coverage: two zones (account unchanged + four accordion sections) → Task 3; accordion component → Task 1; per-section split action with partial upsert → Task 2 + Task 3; empty homes copy → Task 3; no schema/deps/AI → Global Constraints. All spec sections map to a task.
- Type consistency: `saveFoodPreferences` / `saveActivities` / `ProfileCategory` names and signatures are identical across Tasks 1-3. Property names (`dining.budgetBand`, `dining.vibeTags`, `dining.dietary`, `dining.cuisines`, `dining.activities`) match `DiningPreferences`.
- Build-green ordering: 1 (unused component) → 2 (add actions, old one kept) → 3 (rewire page, delete old action). No task leaves a dangling import.
