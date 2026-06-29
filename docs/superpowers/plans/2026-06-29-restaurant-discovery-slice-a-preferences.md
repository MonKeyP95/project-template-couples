# Restaurant Discovery — Slice A: Dining Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-workspace "what we like" dining-preferences profile (budget band, vibe tags, dietary, cuisines) stored in Supabase and editable on `/profile`, so a later slice can seed restaurant searches from it.

**Architecture:** One `dining_preferences` table (one row per workspace, RLS via the existing `is_workspace_member` helper). A small data module under `src/lib/preferences/` (pure types + a server query + a server upsert action). A server-action `<form>` card on the existing `/profile` page edits it — no client component, mirroring the page's existing `updateProfile` form.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), TypeScript 5, `@supabase/ssr` server client, Supabase Postgres + RLS, pnpm.

## Global Constraints

- **No test framework exists.** Per `CLAUDE.md`, do not invent one. Verification for every task is `pnpm build` (TypeScript typecheck + ESLint via `next build`) and `pnpm lint` passing, plus the manual check named in the task. Do not add a test runner or test files.
- **Migrations are applied by hand.** Committing a `.sql` file does nothing to the database — it must be pasted into the Supabase SQL editor. There is one shared Supabase project for local dev and Vercel prod, so a single paste is live everywhere.
- **Idempotent migrations.** Every SQL file must be safe to paste-and-run multiple times: `create table if not exists`, and wrap `create policy` in a `do $$ … exception when duplicate_object then null; end $$;` block (matches `supabase/migrations/20260610000005_checklists.sql`).
- **RLS from day one.** The new table has Row-Level Security enabled with policies before any code reads it.
- **Suggest-only `lib/ai`.** `src/lib/ai/*` returns data only and never mutates (see the header of `src/lib/ai/ai-mode.ts`). That is why preferences live under `src/lib/preferences/`, not `src/lib/ai/` — this module owns a write.
- **No emojis** in code or copy. **Sparse comments** — prefer clear names. **Short modules.**
- **European dates** (`en-GB`) — not relevant to this slice (no dates rendered), noted for consistency.
- **Use `pnpm`** (never npm/yarn).

---

### Task 1: Migration — `dining_preferences` table + RLS

**Files:**
- Create: `supabase/migrations/20260629000001_dining_preferences.sql`

**Interfaces:**
- Produces: a `public.dining_preferences` table with columns `workspace_id uuid` (PK, FK → `workspaces`), `budget_band text`, `vibe_tags text[]`, `dietary text[]`, `cuisines text[]`, `updated_at timestamptz`. Read/written by Task 2 via the Supabase client.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260629000001_dining_preferences.sql` with exactly:

```sql
-- Dining preferences: a couple's "what we like" profile, one row per workspace.
-- Seeds the restaurant discovery agent's search (Phase 5, slice A). RLS via the
-- existing is_workspace_member helper. Idempotent: safe to paste-and-run again.

create table if not exists public.dining_preferences (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  budget_band text not null default 'any',
  vibe_tags text[] not null default '{}',
  dietary text[] not null default '{}',
  cuisines text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.dining_preferences enable row level security;

do $$
begin
  create policy dining_preferences_select on public.dining_preferences
    for select to authenticated using (public.is_workspace_member(workspace_id));
  create policy dining_preferences_insert on public.dining_preferences
    for insert to authenticated with check (public.is_workspace_member(workspace_id));
  create policy dining_preferences_update on public.dining_preferences
    for update to authenticated
    using (public.is_workspace_member(workspace_id))
    with check (public.is_workspace_member(workspace_id));
exception
  when duplicate_object then null;
end $$;
```

- [ ] **Step 2: Apply it (manual)**

Paste the whole file into the Supabase SQL editor and run it. Then run it a **second** time to confirm idempotency — it must succeed with no error both times.

- [ ] **Step 3: Verify the table exists**

In the Supabase SQL editor run:

```sql
select column_name, data_type
from information_schema.columns
where table_name = 'dining_preferences'
order by ordinal_position;
```

Expected: rows for `workspace_id` (uuid), `budget_band` (text), `vibe_tags` (ARRAY), `dietary` (ARRAY), `cuisines` (ARRAY), `updated_at` (timestamp with time zone).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260629000001_dining_preferences.sql
git commit -m "feat(ai): dining_preferences table + RLS (discovery slice A)"
```

---

### Task 2: Preferences data module — `src/lib/preferences/`

**Files:**
- Create: `src/lib/preferences/dining-types.ts`
- Create: `src/lib/preferences/dining-queries.ts`
- Create: `src/lib/preferences/dining-actions.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`; `getCurrentWorkspace` from `@/lib/workspace/queries` (returns `{ id: string, ... } | null`).
- Produces:
  - `BUDGET_BANDS: readonly ["any","budget","mid","splurge"]`, `type BudgetBand`.
  - `interface DiningPreferences { budgetBand: BudgetBand; vibeTags: string[]; dietary: string[]; cuisines: string[] }`.
  - `EMPTY_DINING_PREFERENCES: DiningPreferences`.
  - `parsePreferenceList(raw: string): string[]` and `normalizeBudgetBand(raw: string): BudgetBand`.
  - `getDiningPreferences(workspaceId: string): Promise<DiningPreferences>`.
  - `saveDiningPreferences(formData: FormData): Promise<void>` (Server Action).

- [ ] **Step 1: Create the types + pure helpers**

Create `src/lib/preferences/dining-types.ts` with exactly:

```ts
export const BUDGET_BANDS = ["any", "budget", "mid", "splurge"] as const
export type BudgetBand = (typeof BUDGET_BANDS)[number]

export interface DiningPreferences {
  budgetBand: BudgetBand
  vibeTags: string[]
  dietary: string[]
  cuisines: string[]
}

export const EMPTY_DINING_PREFERENCES: DiningPreferences = {
  budgetBand: "any",
  vibeTags: [],
  dietary: [],
  cuisines: [],
}

/** Comma-separated free text -> trimmed, de-duped, length-capped list. */
export function parsePreferenceList(raw: string): string[] {
  const seen = new Set<string>()
  for (const part of raw.split(",")) {
    const v = part.trim().slice(0, 40)
    if (v) seen.add(v)
  }
  return Array.from(seen).slice(0, 12)
}

/** Coerces an arbitrary string to a known band, defaulting to "any". */
export function normalizeBudgetBand(raw: string): BudgetBand {
  return (BUDGET_BANDS as readonly string[]).includes(raw)
    ? (raw as BudgetBand)
    : "any"
}
```

- [ ] **Step 2: Create the query**

Create `src/lib/preferences/dining-queries.ts` with exactly:

```ts
import { createClient } from "@/lib/supabase/server"
import {
  EMPTY_DINING_PREFERENCES,
  normalizeBudgetBand,
  type DiningPreferences,
} from "./dining-types"

/** The workspace's dining preferences, or empty defaults when unset. */
export async function getDiningPreferences(
  workspaceId: string,
): Promise<DiningPreferences> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("dining_preferences")
    .select("budget_band, vibe_tags, dietary, cuisines")
    .eq("workspace_id", workspaceId)
    .maybeSingle()

  if (!data) return EMPTY_DINING_PREFERENCES

  return {
    budgetBand: normalizeBudgetBand(data.budget_band),
    vibeTags: data.vibe_tags ?? [],
    dietary: data.dietary ?? [],
    cuisines: data.cuisines ?? [],
  }
}
```

- [ ] **Step 3: Create the save action**

Create `src/lib/preferences/dining-actions.ts` with exactly:

```ts
"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { normalizeBudgetBand, parsePreferenceList } from "./dining-types"

/** Upserts the current workspace's dining preferences from the profile form. */
export async function saveDiningPreferences(formData: FormData): Promise<void> {
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
```

- [ ] **Step 4: Verify it builds and lints**

Run: `pnpm build` then `pnpm lint`
Expected: both succeed. The new module typechecks; it's imported nowhere yet (fine — Task 3 wires it in).

- [ ] **Step 5: Commit**

```bash
git add src/lib/preferences/dining-types.ts src/lib/preferences/dining-queries.ts src/lib/preferences/dining-actions.ts
git commit -m "feat(ai): dining preferences data module (discovery slice A)"
```

---

### Task 3: Profile editor card — `src/app/profile/page.tsx`

**Files:**
- Modify: `src/app/profile/page.tsx`

**Interfaces:**
- Consumes: `getCurrentWorkspace` (`@/lib/workspace/queries`), `getDiningPreferences` + `BUDGET_BANDS` (`@/lib/preferences/dining-*`), `saveDiningPreferences` (`@/lib/preferences/dining-actions`). The existing `Input` (`@/components/ui/input`) and `Button` (`@/components/ui/button`).

- [ ] **Step 1: Add the imports**

In `src/app/profile/page.tsx`, after the existing `import { isDarkTheme } from "@/lib/theme"` line, add:

```ts
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { getDiningPreferences } from "@/lib/preferences/dining-queries"
import { BUDGET_BANDS } from "@/lib/preferences/dining-types"
import { saveDiningPreferences } from "@/lib/preferences/dining-actions"
```

- [ ] **Step 2: Fetch the workspace + preferences**

In the same file, immediately after the line `const dark = await isDarkTheme()`, add:

```ts
  const workspace = await getCurrentWorkspace()
  const dining = workspace ? await getDiningPreferences(workspace.id) : null
```

- [ ] **Step 3: Render the preferences card**

In the same file, insert this block immediately **before** the `<Link href="/home" …>` element (the "Back to home" link), inside the `<div className="w-full max-w-sm">` wrapper:

```tsx
        {dining && (
          <form
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
            <Button type="submit" variant="outline" size="sm" className="mt-4">
              Save preferences
            </Button>
          </form>
        )}
```

- [ ] **Step 4: Verify it builds and lints**

Run: `pnpm build` then `pnpm lint`
Expected: both succeed.

- [ ] **Step 5: Manual check**

Run `pnpm dev`, sign in, open `/profile` on a 390px phone viewport. Expected: a "What we like" card with a Budget dropdown (any / budget / mid / splurge) and three text inputs. Type `quiet, walkable` into Vibe and a cuisine, click **Save preferences**. Reload `/profile` — the values persist (proves the upsert + read round-trip). In the Supabase SQL editor, `select * from dining_preferences;` shows one row for your workspace with the arrays populated.

- [ ] **Step 6: Commit**

```bash
git add src/app/profile/page.tsx
git commit -m "feat(ai): what-we-like dining preferences card on /profile (discovery slice A)"
```

---

## What this slice deliberately does NOT do

Per the spec's slicing, these are later slices — do not build them here:

- **The discovery call** (`claude.ts` web search, `restaurant-discovery.ts`, `/api/ai/discover`, the Assistant affordance) — Slice B.
- **Accept → itinerary event** — Slice C.
- **Feedback capture** — Slice D.

Slice A ships standalone: the preferences exist and are editable; nothing reads them yet.

## Self-review notes

- **Spec coverage:** implements Design §1 (preferences table + `/profile` editor + queries) in full. §2–§5 are explicitly out of scope (Slices B–D).
- **Type consistency:** `DiningPreferences` / `BudgetBand` / `getDiningPreferences` / `saveDiningPreferences` names are used identically across Tasks 2 and 3.
- **File-path deviation from spec:** spec named `src/lib/ai/dining-preferences.ts`; this plan uses `src/lib/preferences/` to respect the `lib/ai` no-mutation invariant. The discovery seam (Slice B) will import `getDiningPreferences` / `DiningPreferences` from here as a read-only input.
