# Checklists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workspace-level **Checklists** feature — saved, reusable, resettable templates (categories + items + checkboxes), with an overview page and a per-checklist detail page, reachable from the shared nav.

**Architecture:** Three new tables (`checklists`, `checklist_categories`, `checklist_items`) mirroring the packing shape but scoped to a workspace via a new `is_checklist_workspace_member` RLS helper. A new `src/lib/checklists/` module (types, queries, server actions). Two routes: `/checklists` (overview) and `/checklists/[slug]` (detail). The detail UI mirrors `PackingTab` (minus drag-reorder, member tones, import, suggestion card) and adds a Reset. Checklists joins the shared nav.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), React 19, Tailwind v4, Supabase (Postgres + RLS + Realtime). No test runner exists in this repo (see CLAUDE.md) — each task is verified with `pnpm lint`, `pnpm build`, and a browser look.

---

## Notes for the implementer

- **No test command.** Verification per task = `pnpm lint` (clean) + `pnpm build` (succeeds), plus a browser look for UI tasks.
- **Migrations are applied by hand** in the Supabase SQL editor. Task 1 includes that manual step; the rest of the code compiles without it (TypeScript doesn't hit the DB), but the feature won't work at runtime until it's pasted.
- **Mirror packing.** This feature is deliberately a workspace-scoped twin of trip packing. When in doubt, match `src/lib/trips/packing-*.ts`, the packing actions in `src/lib/trips/actions.ts`, and `src/app/trips/[slug]/packing-tab.tsx`.
- **Windows dev flake:** if `pnpm build`/`pnpm dev` panics with `0xc0000142`, delete `.next/` and retry once — known environment flake, not a code bug.

## File map

- **Create** `supabase/migrations/20260610000005_checklists.sql` — 3 tables + `is_checklist_workspace_member` + RLS + Realtime.
- **Create** `src/lib/checklists/types.ts` — `Checklist`, `ChecklistSummary`, `ChecklistItem`, `ChecklistCategory`, `ChecklistGroup`, `groupChecklistItems`.
- **Create** `src/lib/checklists/queries.ts` — `listChecklists`, `getChecklistBySlug`, `getChecklistItems`, `getChecklistCategories`.
- **Create** `src/lib/checklists/actions.ts` — `"use server"`: checklist CRUD + reset, item + category actions, slug helper.
- **Modify** `src/components/app-nav.tsx` — add `"checklists"` to `NavKey` and a permanent Checklists destination.
- **Create** `src/app/checklists/page.tsx` — overview route.
- **Create** `src/app/checklists/checklists-overview.tsx` — client list (add/delete, links to detail).
- **Create** `src/app/checklists/[slug]/page.tsx` — detail route.
- **Create** `src/app/checklists/[slug]/checklist-detail.tsx` — client detail (mirrors PackingTab + header/reset).
- **Modify** `docs/TODO.md`, `docs/DECISIONS.md`.

---

## Task 1: Migration — checklists tables, RLS, Realtime

**Files:**
- Create: `supabase/migrations/20260610000005_checklists.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Checklists: reusable, resettable templates at the workspace level.
-- Mirrors the packing_categories + packing_items shape but scoped to a
-- workspace (not a trip). RLS via is_checklist_workspace_member.
-- Idempotent: safe to paste-and-run multiple times.

create table if not exists public.checklists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  slug text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create index if not exists checklists_workspace_idx
  on public.checklists (workspace_id, created_at);

create table if not exists public.checklist_categories (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sort_order int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (checklist_id, name)
);

create index if not exists checklist_categories_checklist_idx
  on public.checklist_categories (checklist_id, sort_order);

create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  category text not null check (length(trim(category)) > 0),
  label text not null check (length(trim(label)) > 0),
  done boolean not null default false,
  added_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists checklist_items_checklist_idx
  on public.checklist_items (checklist_id, created_at);

-- Membership helper (SECURITY DEFINER avoids RLS recursion); mirrors
-- is_trip_workspace_member.
create or replace function public.is_checklist_workspace_member(p_checklist_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.checklists c
    join public.workspace_members wm on wm.workspace_id = c.workspace_id
    where c.id = p_checklist_id and wm.user_id = auth.uid()
  );
$$;

alter table public.checklists enable row level security;
alter table public.checklist_categories enable row level security;
alter table public.checklist_items enable row level security;

do $$
begin
  create policy checklists_select on public.checklists
    for select to authenticated using (public.is_workspace_member(workspace_id));
  create policy checklists_insert on public.checklists
    for insert to authenticated with check (
      public.is_workspace_member(workspace_id) and created_by = auth.uid()
    );
  create policy checklists_update on public.checklists
    for update to authenticated using (public.is_workspace_member(workspace_id));
  create policy checklists_delete on public.checklists
    for delete to authenticated using (public.is_workspace_member(workspace_id));

  create policy checklist_categories_select on public.checklist_categories
    for select to authenticated using (public.is_checklist_workspace_member(checklist_id));
  create policy checklist_categories_insert on public.checklist_categories
    for insert to authenticated with check (public.is_checklist_workspace_member(checklist_id));
  create policy checklist_categories_update on public.checklist_categories
    for update to authenticated using (public.is_checklist_workspace_member(checklist_id));
  create policy checklist_categories_delete on public.checklist_categories
    for delete to authenticated using (public.is_checklist_workspace_member(checklist_id));

  create policy checklist_items_select on public.checklist_items
    for select to authenticated using (public.is_checklist_workspace_member(checklist_id));
  create policy checklist_items_insert on public.checklist_items
    for insert to authenticated with check (
      public.is_checklist_workspace_member(checklist_id) and added_by = auth.uid()
    );
  create policy checklist_items_update on public.checklist_items
    for update to authenticated using (public.is_checklist_workspace_member(checklist_id));
  create policy checklist_items_delete on public.checklist_items
    for delete to authenticated using (public.is_checklist_workspace_member(checklist_id));
exception
  when duplicate_object then null;
end $$;

-- Realtime for live check sync (mirrors packing_items). Guarded so re-running
-- the file doesn't error on an already-published table.
do $$
begin
  alter publication supabase_realtime add table public.checklist_items;
exception
  when duplicate_object then null;
end $$;
```

- [ ] **Step 2: Apply it manually**

Paste the file's contents into the Supabase SQL editor and run. Re-run once to confirm it succeeds idempotently (no error).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260610000005_checklists.sql
git commit -m "feat(db): checklists tables, RLS helper, and Realtime"
```

---

## Task 2: Types + grouping helper

**Files:**
- Create: `src/lib/checklists/types.ts`

Mirrors `src/lib/trips/packing-types.ts`.

- [ ] **Step 1: Write the file**

```ts
export interface Checklist {
  id: string
  workspaceId: string
  name: string
  slug: string
}

/** A checklist plus its progress counts, for the overview list. */
export interface ChecklistSummary extends Checklist {
  total: number
  done: number
}

export interface ChecklistItem {
  id: string
  checklistId: string
  category: string
  label: string
  done: boolean
  addedBy: string
  createdAt: string
}

export interface ChecklistCategory {
  id: string
  checklistId: string
  name: string
  sortOrder: number
}

export interface ChecklistGroup {
  /** Null for an "orphan" group — items whose category has no row yet. */
  categoryId: string | null
  category: string
  items: ChecklistItem[]
}

/**
 * Group items under their categories, preserving the given `categories` order.
 * Empty categories are kept; any item category missing a row is appended as an
 * orphan group (keeps a Realtime INSERT under a not-yet-loaded category visible
 * until the next refresh). Mirrors groupPackingItems.
 */
export function groupChecklistItems(
  categories: ChecklistCategory[],
  items: ChecklistItem[],
): ChecklistGroup[] {
  const byName = new Map<string, ChecklistItem[]>()
  for (const item of items) {
    const arr = byName.get(item.category) ?? []
    arr.push(item)
    byName.set(item.category, arr)
  }
  const groups: ChecklistGroup[] = categories.map((c) => ({
    categoryId: c.id,
    category: c.name,
    items: byName.get(c.name) ?? [],
  }))
  const known = new Set(categories.map((c) => c.name))
  for (const [name, list] of byName) {
    if (!known.has(name)) {
      groups.push({ categoryId: null, category: name, items: list })
    }
  }
  return groups
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint` then `pnpm build`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/checklists/types.ts
git commit -m "feat(checklists): types + grouping helper"
```

---

## Task 3: Queries

**Files:**
- Create: `src/lib/checklists/queries.ts`

- [ ] **Step 1: Write the file**

```ts
import { createClient } from "@/lib/supabase/server"
import type {
  Checklist,
  ChecklistCategory,
  ChecklistItem,
  ChecklistSummary,
} from "./types"

/** All checklists in the workspace with their progress counts, newest last. */
export async function listChecklists(
  workspaceId: string,
): Promise<ChecklistSummary[]> {
  const supabase = await createClient()
  const { data: rows } = await supabase
    .from("checklists")
    .select("id, workspace_id, name, slug")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })

  const lists = rows ?? []
  const ids = lists.map((r) => r.id)
  const totals: Record<string, { total: number; done: number }> = {}
  if (ids.length > 0) {
    const { data: items } = await supabase
      .from("checklist_items")
      .select("checklist_id, done")
      .in("checklist_id", ids)
    for (const it of items ?? []) {
      const t = (totals[it.checklist_id] ??= { total: 0, done: 0 })
      t.total += 1
      if (it.done) t.done += 1
    }
  }

  return lists.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    slug: r.slug,
    total: totals[r.id]?.total ?? 0,
    done: totals[r.id]?.done ?? 0,
  }))
}

/** A single checklist by slug within the workspace, or null. */
export async function getChecklistBySlug(
  workspaceId: string,
  slug: string,
): Promise<Checklist | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("checklists")
    .select("id, workspace_id, name, slug")
    .eq("workspace_id", workspaceId)
    .eq("slug", slug)
    .maybeSingle()
  if (!data) return null
  return {
    id: data.id,
    workspaceId: data.workspace_id,
    name: data.name,
    slug: data.slug,
  }
}

export async function getChecklistItems(
  checklistId: string,
): Promise<ChecklistItem[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("checklist_items")
    .select("id, checklist_id, category, label, done, added_by, created_at")
    .eq("checklist_id", checklistId)
    .order("created_at", { ascending: true })

  return (data ?? []).map((row) => ({
    id: row.id,
    checklistId: row.checklist_id,
    category: row.category,
    label: row.label,
    done: row.done,
    addedBy: row.added_by,
    createdAt: row.created_at,
  }))
}

export async function getChecklistCategories(
  checklistId: string,
): Promise<ChecklistCategory[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("checklist_categories")
    .select("id, checklist_id, name, sort_order")
    .eq("checklist_id", checklistId)
    .order("sort_order", { ascending: true })

  return (data ?? []).map((row) => ({
    id: row.id,
    checklistId: row.checklist_id,
    name: row.name,
    sortOrder: row.sort_order,
  }))
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint` then `pnpm build`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/checklists/queries.ts
git commit -m "feat(checklists): query layer"
```

---

## Task 4: Server actions — checklist CRUD + reset

**Files:**
- Create: `src/lib/checklists/actions.ts`

- [ ] **Step 1: Write the file (checklist-level actions + slug helper)**

```ts
"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import type { ChecklistCategory } from "./types"

export interface ChecklistResult {
  error?: string
}

export interface CreateChecklistResult {
  error?: string
  /** On success; the client navigates to /checklists/<slug>. */
  slug?: string
}

/** Lowercase, dash-joined ascii slug; falls back to "list". */
function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return s || "list"
}

/** Creates an empty checklist in the current workspace with a unique slug. */
export async function createChecklist(
  name: string,
): Promise<CreateChecklistResult> {
  const trimmed = name.trim()
  if (!trimmed) return { error: "Name required." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const workspace = await getCurrentWorkspace()
  if (!workspace) return { error: "No workspace." }

  const base = slugify(trimmed)
  const { data: existing } = await supabase
    .from("checklists")
    .select("slug")
    .eq("workspace_id", workspace.id)
    .like("slug", `${base}%`)
  const taken = new Set((existing ?? []).map((r) => r.slug))
  let slug = base
  let n = 2
  while (taken.has(slug)) slug = `${base}-${n++}`

  const { error } = await supabase.from("checklists").insert({
    workspace_id: workspace.id,
    name: trimmed,
    slug,
    created_by: userData.user.id,
  })
  if (error) {
    if (error.code === "23505") {
      return { error: "A checklist with that name already exists." }
    }
    return { error: error.message }
  }

  revalidatePath("/checklists")
  return { slug }
}

/** Renames a checklist; the slug (and URL) stays put. */
export async function renameChecklist(
  checklistId: string,
  slug: string,
  name: string,
): Promise<ChecklistResult> {
  const trimmed = name.trim()
  if (!trimmed) return { error: "Name required." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("checklists")
    .update({ name: trimmed })
    .eq("id", checklistId)
  if (error) return { error: error.message }

  revalidatePath("/checklists")
  revalidatePath(`/checklists/${slug}`)
  return {}
}

/** Deletes a checklist (cascades to its categories + items via FKs). The client
 * navigates to /checklists on success. */
export async function deleteChecklist(
  checklistId: string,
): Promise<ChecklistResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("checklists")
    .delete()
    .eq("id", checklistId)
  if (error) return { error: error.message }

  revalidatePath("/checklists")
  return {}
}

/** Unchecks every item so the template is fresh to reuse. */
export async function resetChecklist(
  checklistId: string,
  slug: string,
): Promise<ChecklistResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("checklist_items")
    .update({ done: false })
    .eq("checklist_id", checklistId)
    .eq("done", true)
  if (error) return { error: error.message }

  revalidatePath(`/checklists/${slug}`)
  return {}
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint` then `pnpm build`
Expected: both clean. (`ChecklistCategory` is imported now and used by the actions added in Task 5; if lint flags it as unused before Task 5, that is expected — proceed to Task 5 in the same change set, or temporarily suppress. The recommended order is to do Task 4 + Task 5 back-to-back before linting.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/checklists/actions.ts
git commit -m "feat(checklists): checklist CRUD + reset actions"
```

---

## Task 5: Server actions — items + categories

**Files:**
- Modify: `src/lib/checklists/actions.ts`

Append these to the file from Task 4. They mirror the packing item/category actions.

- [ ] **Step 1: Append the item + category actions**

```ts
export async function addChecklistItem(
  checklistId: string,
  category: string,
  label: string,
): Promise<ChecklistResult> {
  const trimmed = label.trim()
  if (!trimmed) return { error: "Label required." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { error } = await supabase.from("checklist_items").insert({
    checklist_id: checklistId,
    category,
    label: trimmed,
    added_by: userData.user.id,
  })
  if (error) return { error: error.message }
  return {}
}

export async function toggleChecklistItem(
  itemId: string,
  done: boolean,
): Promise<ChecklistResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("checklist_items")
    .update({ done })
    .eq("id", itemId)
  if (error) return { error: error.message }
  return {}
}

export async function updateChecklistItem(
  itemId: string,
  label: string,
): Promise<ChecklistResult> {
  const trimmed = label.trim()
  if (!trimmed) return { error: "Label required." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("checklist_items")
    .update({ label: trimmed })
    .eq("id", itemId)
  if (error) return { error: error.message }
  return {}
}

export async function deleteChecklistItem(
  itemId: string,
): Promise<ChecklistResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("checklist_items")
    .delete()
    .eq("id", itemId)
  if (error) return { error: error.message }
  return {}
}

export interface AddChecklistCategoryResult {
  error?: string
  /** Populated on success so the client can append it with a stable id. */
  category?: ChecklistCategory
}

export async function addChecklistCategory(
  checklistId: string,
  slug: string,
  name: string,
): Promise<AddChecklistCategoryResult> {
  const trimmed = name.trim()
  if (!trimmed) return { error: "Name required." }

  const supabase = await createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return { error: "Not signed in." }

  const { data: maxRow } = await supabase
    .from("checklist_categories")
    .select("sort_order")
    .eq("checklist_id", checklistId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (maxRow?.sort_order ?? -1) + 1

  const { data, error } = await supabase
    .from("checklist_categories")
    .insert({
      checklist_id: checklistId,
      name: trimmed,
      sort_order: nextOrder,
      created_by: userData.user.id,
    })
    .select("id, checklist_id, name, sort_order")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { error: "A category with that name already exists." }
    }
    return { error: error.message }
  }

  revalidatePath(`/checklists/${slug}`)
  return {
    category: {
      id: data.id,
      checklistId: data.checklist_id,
      name: data.name,
      sortOrder: data.sort_order,
    },
  }
}

export async function deleteChecklistCategory(
  categoryId: string,
  slug: string,
): Promise<ChecklistResult> {
  const supabase = await createClient()

  const { data: cat, error: catError } = await supabase
    .from("checklist_categories")
    .select("checklist_id, name")
    .eq("id", categoryId)
    .maybeSingle()
  if (catError) return { error: catError.message }
  if (!cat) return {}

  const { error: itemsError } = await supabase
    .from("checklist_items")
    .delete()
    .eq("checklist_id", cat.checklist_id)
    .eq("category", cat.name)
  if (itemsError) return { error: itemsError.message }

  const { error } = await supabase
    .from("checklist_categories")
    .delete()
    .eq("id", categoryId)
  if (error) return { error: error.message }

  revalidatePath(`/checklists/${slug}`)
  return {}
}
```

- [ ] **Step 2: Verify lint + build**

Run: `pnpm lint` then `pnpm build`
Expected: both clean (`ChecklistCategory` is now used).

- [ ] **Step 3: Commit**

```bash
git add src/lib/checklists/actions.ts
git commit -m "feat(checklists): item + category actions"
```

---

## Task 6: Add Checklists to the shared nav

**Files:**
- Modify: `src/components/app-nav.tsx`

- [ ] **Step 1: Add `"checklists"` to `NavKey`**

Change:
```tsx
export type NavKey = "home" | "on-the-road" | "trip"
```
to:
```tsx
export type NavKey = "home" | "on-the-road" | "checklists" | "trip"
```

- [ ] **Step 2: Add the permanent Checklists destination in `buildNavDestinations`**

In `buildNavDestinations`, after the line that pushes Home, add the Checklists push. The block becomes:

```tsx
  items.push({ key: "home", label: "Home", href: "/home" })
  items.push({ key: "checklists", label: "Checklists", href: "/checklists" })
  if (opts.tripSlug) {
```

(Checklists is always present, so it needs no flag. Order ends up: On the road → Home → Checklists → Trip.)

- [ ] **Step 3: Verify lint + build, then look**

Run: `pnpm lint` then `pnpm build` (clean). On any page, the nav now shows **Checklists** (desktop rail + mobile top bar). It links to `/checklists` (404 until Task 7 — that's expected).

- [ ] **Step 4: Commit**

```bash
git add src/components/app-nav.tsx
git commit -m "feat(nav): add Checklists destination"
```

---

## Task 7: Overview page

**Files:**
- Create: `src/app/checklists/page.tsx`
- Create: `src/app/checklists/checklists-overview.tsx`

- [ ] **Step 1: Write the client list component**

`src/app/checklists/checklists-overview.tsx`:

```tsx
"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Chevron } from "@/components/together"
import { createChecklist, deleteChecklist } from "@/lib/checklists/actions"
import type { ChecklistSummary } from "@/lib/checklists/types"

export function ChecklistsOverview({
  initial,
}: {
  initial: ChecklistSummary[]
}) {
  const router = useRouter()
  const [lists, setLists] = React.useState(initial)
  const [lastInitial, setLastInitial] = React.useState(initial)
  if (initial !== lastInitial) {
    setLastInitial(initial)
    setLists(initial)
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete '${name}' and everything in it?`)) return
    const snapshot = lists
    setLists((prev) => prev.filter((l) => l.id !== id))
    const result = await deleteChecklist(id)
    if (result.error) setLists(snapshot)
  }

  return (
    <div className="flex flex-col gap-2.5">
      {lists.map((l) => (
        <div key={l.id} className="flex items-center gap-2">
          <Link
            href={`/checklists/${l.slug}`}
            className="flex flex-1 items-center justify-between rounded-[12px] border border-border bg-card px-4 py-3.5 shadow-sm transition-shadow md:hover:shadow-md"
          >
            <span className="t-display text-[20px] text-foreground">
              <em>{l.name}</em>
            </span>
            <span className="flex items-center gap-3">
              <span className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground">
                {l.done} / {l.total}
              </span>
              <Chevron />
            </span>
          </Link>
          <button
            type="button"
            onClick={() => remove(l.id, l.name)}
            aria-label="Delete checklist"
            className="border-0 bg-transparent px-1.5 font-mono text-[14px] text-muted-foreground hover:text-clay"
          >
            ×
          </button>
        </div>
      ))}
      {lists.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-rule px-4 py-6 text-center text-[13px] text-muted-foreground">
          No checklists yet — add your first one.
        </div>
      ) : null}
      <AddChecklistRow
        onCreate={async (name) => {
          const result = await createChecklist(name)
          if (result.slug) router.push(`/checklists/${result.slug}`)
          return result
        }}
      />
    </div>
  )
}

function AddChecklistRow({
  onCreate,
}: {
  onCreate: (name: string) => Promise<{ error?: string; slug?: string }>
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [value, setValue] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  function reset() {
    setExpanded(false)
    setValue("")
    setError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const name = value.trim()
    if (!name || pending) return
    setPending(true)
    setError(null)
    const result = await onCreate(name)
    setPending(false)
    if (result.error) setError(result.error)
    // On success, onCreate navigates away.
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="block w-full rounded-[12px] border border-dashed border-rule py-3.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"
      >
        + add checklist
      </button>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-[12px] border border-border bg-card px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") reset()
          }}
          placeholder="New checklist, e.g. Camping"
          disabled={pending}
          className="flex-1 border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-sea focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="rounded-md border-0 bg-foreground px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-background disabled:opacity-40"
        >
          add
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="border-0 bg-transparent px-1 font-mono text-[12px] text-muted-foreground hover:text-foreground"
          aria-label="Cancel"
        >
          ×
        </button>
      </div>
      {error ? (
        <div className="mt-1 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </form>
  )
}
```

- [ ] **Step 2: Write the overview page**

`src/app/checklists/page.tsx`:

```tsx
import { redirect } from "next/navigation"

import { Label } from "@/components/together"
import { isDarkTheme } from "@/lib/theme"
import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import { listChecklists } from "@/lib/checklists/queries"
import {
  LeftRail,
  MobileTopNav,
  buildNavDestinations,
} from "@/components/app-nav"

import { ChecklistsOverview } from "./checklists-overview"

export default async function ChecklistsPage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/checklists")

  const workspace = await getCurrentWorkspace()
  if (!workspace) redirect("/home")

  const dark = await isDarkTheme()
  const [checklists, buckets] = await Promise.all([
    listChecklists(workspace.id),
    listTripsForWorkspace(workspace.id),
  ])
  const hero = buckets.now[0] ?? buckets.upcoming[0] ?? null
  const navDestinations = buildNavDestinations({
    onTheRoad: buckets.now.length > 0,
    tripSlug: hero?.slug ?? null,
  })

  return (
    <div className="relative mx-auto min-h-screen w-full max-w-[440px] lg:flex lg:max-w-none lg:items-stretch">
      <MobileTopNav destinations={navDestinations} current="checklists" />
      <LeftRail
        workspace={workspace}
        initialDark={dark}
        destinations={navDestinations}
        current="checklists"
      />
      <main className="w-full px-5 pt-14 pb-16 lg:min-w-0 lg:flex-1 lg:px-12 lg:pt-12">
        <Label className="mb-4 block">Checklists</Label>
        <ChecklistsOverview initial={checklists} />
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Verify lint + build, then look**

Run: `pnpm lint` then `pnpm build` (clean). Visit `/checklists`: the rail/top bar show with **Checklists** highlighted, an empty state, and **+ add checklist**. Adding a checklist navigates to its (still-404) detail page — Task 8 fills that in.

- [ ] **Step 4: Commit**

```bash
git add src/app/checklists/page.tsx src/app/checklists/checklists-overview.tsx
git commit -m "feat(checklists): overview page with add/delete"
```

---

## Task 8: Detail page + ChecklistDetail component

**Files:**
- Create: `src/app/checklists/[slug]/checklist-detail.tsx`
- Create: `src/app/checklists/[slug]/page.tsx`

The component mirrors `src/app/trips/[slug]/packing-tab.tsx` minus drag-reorder, member tones, import, and the suggestion card — and adds a header with rename, Reset, and delete.

- [ ] **Step 1: Write the client detail component**

`src/app/checklists/[slug]/checklist-detail.tsx`:

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Bar, CheckRow, Label, TopoBg } from "@/components/together"
import { createClient } from "@/lib/supabase/client"
import {
  addChecklistCategory,
  addChecklistItem,
  deleteChecklist,
  deleteChecklistCategory,
  deleteChecklistItem,
  renameChecklist,
  resetChecklist,
  toggleChecklistItem,
  updateChecklistItem,
} from "@/lib/checklists/actions"
import {
  groupChecklistItems,
  type ChecklistCategory,
  type ChecklistItem,
} from "@/lib/checklists/types"

interface RealtimeRow {
  id: string
  checklist_id: string
  category: string
  label: string
  done: boolean
  added_by: string
  created_at: string
}

function fromRow(row: RealtimeRow): ChecklistItem {
  return {
    id: row.id,
    checklistId: row.checklist_id,
    category: row.category,
    label: row.label,
    done: row.done,
    addedBy: row.added_by,
    createdAt: row.created_at,
  }
}

export function ChecklistDetail({
  checklistId,
  slug,
  name,
  initialItems,
  initialCategories,
}: {
  checklistId: string
  slug: string
  name: string
  initialItems: ChecklistItem[]
  initialCategories: ChecklistCategory[]
}) {
  const router = useRouter()
  const [items, setItems] = React.useState(initialItems)
  const [lastItems, setLastItems] = React.useState(initialItems)
  const [categories, setCategories] = React.useState(initialCategories)
  const [lastCategories, setLastCategories] = React.useState(initialCategories)
  const [editingId, setEditingId] = React.useState<string | null>(null)

  if (initialItems !== lastItems) {
    setLastItems(initialItems)
    setItems(initialItems)
  }
  if (initialCategories !== lastCategories) {
    setLastCategories(initialCategories)
    setCategories(initialCategories)
  }

  React.useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`checklist-${checklistId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "checklist_items",
          filter: `checklist_id=eq.${checklistId}`,
        },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            const next = fromRow(payload.new as RealtimeRow)
            setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)))
          } else if (payload.eventType === "INSERT") {
            const next = fromRow(payload.new as RealtimeRow)
            setItems((prev) =>
              prev.some((i) => i.id === next.id) ? prev : [...prev, next],
            )
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string }
            if (old.id) setItems((prev) => prev.filter((i) => i.id !== old.id))
          }
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [checklistId])

  async function toggle(id: string) {
    const current = items.find((i) => i.id === id)
    if (!current) return
    const next = !current.done
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: next } : i)))
    const result = await toggleChecklistItem(id, next)
    if (result.error) {
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, done: current.done } : i)),
      )
    }
  }

  async function update(
    id: string,
    label: string,
  ): Promise<{ error?: string }> {
    const current = items.find((i) => i.id === id)
    if (!current) return {}
    const trimmed = label.trim()
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, label: trimmed } : i)),
    )
    const result = await updateChecklistItem(id, trimmed)
    if (result.error) {
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, label: current.label } : i)),
      )
    }
    return result
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this item?")) return
    const snapshot = items
    setItems((prev) => prev.filter((i) => i.id !== id))
    const result = await deleteChecklistItem(id)
    if (result.error) setItems(snapshot)
  }

  async function addCategory(catName: string): Promise<{ error?: string }> {
    const result = await addChecklistCategory(checklistId, slug, catName)
    if (result.error) return { error: result.error }
    if (result.category) {
      const created = result.category
      setCategories((prev) => [...prev, created])
    }
    return {}
  }

  async function removeCategory(
    categoryId: string,
    catName: string,
    count: number,
  ) {
    const msg =
      count > 0
        ? `Delete '${catName}' and its ${count} item${count === 1 ? "" : "s"}?`
        : `Delete '${catName}'?`
    if (!window.confirm(msg)) return
    const catSnapshot = categories
    const itemSnapshot = items
    setCategories((prev) => prev.filter((c) => c.id !== categoryId))
    setItems((prev) => prev.filter((i) => i.category !== catName))
    const result = await deleteChecklistCategory(categoryId, slug)
    if (result.error) {
      setCategories(catSnapshot)
      setItems(itemSnapshot)
    }
  }

  async function reset() {
    if (!window.confirm("Uncheck everything in this checklist?")) return
    const snapshot = items
    setItems((prev) => prev.map((i) => ({ ...i, done: false })))
    const result = await resetChecklist(checklistId, slug)
    if (result.error) setItems(snapshot)
  }

  async function destroy() {
    if (!window.confirm(`Delete '${name}' and everything in it?`)) return
    const result = await deleteChecklist(checklistId)
    if (!result.error) router.push("/checklists")
  }

  const groups = groupChecklistItems(categories, items)
  const total = items.length
  const done = items.filter((i) => i.done).length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)

  return (
    <section>
      <div className="relative overflow-hidden bg-sea-tint px-5 pt-6 pb-4">
        <TopoBg tone="sea" opacity={0.1} />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label>Checklist</Label>
            <ChecklistName
              name={name}
              slug={slug}
              checklistId={checklistId}
            />
            <div className="t-num mt-1 text-[14px] text-muted-foreground">
              {done} / {total} · {pct}%
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button
              type="button"
              onClick={reset}
              className="rounded-full border border-border bg-card px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
            >
              reset
            </button>
            <button
              type="button"
              onClick={destroy}
              className="border-0 bg-transparent px-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-clay"
            >
              delete
            </button>
          </div>
        </div>
        <div className="relative mt-3.5">
          <Bar pct={pct} tone="sea" />
        </div>
      </div>

      <div className="border-t border-border bg-background">
        {groups.map((g) => (
          <CategoryGroup
            key={g.categoryId ?? `orphan:${g.category}`}
            checklistId={checklistId}
            categoryId={g.categoryId}
            category={g.category}
            items={g.items}
            editingId={editingId}
            onToggle={toggle}
            onStartEdit={setEditingId}
            onStopEdit={() => setEditingId(null)}
            onUpdate={update}
            onDelete={remove}
            onDeleteCategory={removeCategory}
          />
        ))}

        <div className="px-5 pt-4 pb-6">
          <AddCategoryRow onAdd={addCategory} />
        </div>
      </div>
    </section>
  )
}

function ChecklistName({
  name,
  slug,
  checklistId,
}: {
  name: string
  slug: string
  checklistId: string
}) {
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(name)
  const [current, setCurrent] = React.useState(name)
  const [pending, setPending] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const next = value.trim()
    if (!next || pending) return
    if (next === current) {
      setEditing(false)
      return
    }
    setPending(true)
    const result = await renameChecklist(checklistId, slug, next)
    setPending(false)
    if (!result.error) {
      setCurrent(next)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="mt-1">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setValue(current)
              setEditing(false)
            }
          }}
          disabled={pending}
          className="t-display w-full border-0 border-b border-rule bg-transparent text-[30px] text-foreground focus:border-sea focus:outline-none"
        />
      </form>
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        setValue(current)
        setEditing(true)
      }}
      className="mt-1 block text-left"
      aria-label="Rename checklist"
    >
      <span className="t-display text-[30px] text-foreground">
        <em>{current}</em>
      </span>
    </button>
  )
}

interface CategoryGroupProps {
  checklistId: string
  categoryId: string | null
  category: string
  items: ChecklistItem[]
  editingId: string | null
  onToggle: (id: string) => void
  onStartEdit: (id: string) => void
  onStopEdit: () => void
  onUpdate: (id: string, label: string) => Promise<{ error?: string }>
  onDelete: (id: string) => void
  onDeleteCategory: (id: string, name: string, count: number) => void
}

function CategoryGroup({
  checklistId,
  categoryId,
  category,
  items,
  editingId,
  onToggle,
  onStartEdit,
  onStopEdit,
  onUpdate,
  onDelete,
  onDeleteCategory,
}: CategoryGroupProps) {
  const done = items.filter((i) => i.done).length
  return (
    <div className="border-b border-border px-5 pt-4 pb-1.5">
      <div className="mb-0.5 flex items-center justify-between">
        <Label>{category}</Label>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {done} / {items.length}
          </span>
          {categoryId ? (
            <button
              type="button"
              onClick={() => onDeleteCategory(categoryId, category, items.length)}
              aria-label="Delete category"
              className="border-0 bg-transparent px-1 font-mono text-[12px] text-muted-foreground hover:text-clay"
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          isEditing={editingId === item.id}
          onToggle={() => onToggle(item.id)}
          onStartEdit={() => onStartEdit(item.id)}
          onStopEdit={onStopEdit}
          onUpdate={onUpdate}
          onDelete={() => onDelete(item.id)}
        />
      ))}
      <AddItemRow checklistId={checklistId} category={category} />
    </div>
  )
}

function ItemRow({
  item,
  isEditing,
  onToggle,
  onStartEdit,
  onStopEdit,
  onUpdate,
  onDelete,
}: {
  item: ChecklistItem
  isEditing: boolean
  onToggle: () => void
  onStartEdit: () => void
  onStopEdit: () => void
  onUpdate: (id: string, label: string) => Promise<{ error?: string }>
  onDelete: () => void
}) {
  if (isEditing) {
    return <ItemEditor item={item} onUpdate={onUpdate} onDone={onStopEdit} />
  }
  return (
    <div className="flex items-center gap-1">
      <CheckRow
        className="flex-1"
        done={item.done}
        label={item.label}
        tone="sea"
        onToggle={onToggle}
      />
      <button
        type="button"
        onClick={onStartEdit}
        aria-label="Edit item"
        className="border-0 bg-transparent px-1.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
      >
        ✎
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete item"
        className="border-0 bg-transparent px-1.5 py-1 font-mono text-[12px] text-muted-foreground hover:text-clay"
      >
        ×
      </button>
    </div>
  )
}

function ItemEditor({
  item,
  onUpdate,
  onDone,
}: {
  item: ChecklistItem
  onUpdate: (id: string, label: string) => Promise<{ error?: string }>
  onDone: () => void
}) {
  const [value, setValue] = React.useState(item.label)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const label = value.trim()
    if (!label || pending) return
    setPending(true)
    setError(null)
    const result = await onUpdate(item.id, label)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    onDone()
  }

  return (
    <form onSubmit={submit} className="py-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onDone()
          }}
          disabled={pending}
          className="flex-1 border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-sea focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="rounded-md border-0 bg-foreground px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-background disabled:opacity-40"
        >
          save
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="border-0 bg-transparent px-1 font-mono text-[12px] text-muted-foreground hover:text-foreground"
          aria-label="Cancel"
        >
          ×
        </button>
      </div>
      {error ? (
        <div className="mt-1 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </form>
  )
}

function AddItemRow({
  checklistId,
  category,
}: {
  checklistId: string
  category: string
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [value, setValue] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  function reset() {
    setExpanded(false)
    setValue("")
    setError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const label = value.trim()
    if (!label || pending) return
    setPending(true)
    setError(null)
    const result = await addChecklistItem(checklistId, category, label)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setValue("")
    inputRef.current?.focus()
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="border-0 bg-transparent py-2 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground"
      >
        + add item
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="py-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") reset()
          }}
          placeholder={`Add to ${category.toLowerCase()}…`}
          disabled={pending}
          className="flex-1 border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-sea focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="rounded-md border-0 bg-foreground px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-background disabled:opacity-40"
        >
          add
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="border-0 bg-transparent px-1 font-mono text-[12px] text-muted-foreground hover:text-foreground"
          aria-label="Cancel"
        >
          ×
        </button>
      </div>
      {error ? (
        <div className="mt-1 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </form>
  )
}

function AddCategoryRow({
  onAdd,
}: {
  onAdd: (name: string) => Promise<{ error?: string }>
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [value, setValue] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  function reset() {
    setExpanded(false)
    setValue("")
    setError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const name = value.trim()
    if (!name || pending) return
    setPending(true)
    setError(null)
    const result = await onAdd(name)
    setPending(false)
    if (result.error) {
      setError(result.error)
      return
    }
    reset()
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="block w-full rounded-lg border border-dashed border-rule py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:border-foreground hover:text-foreground"
      >
        + add category
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="py-1">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") reset()
          }}
          placeholder="New category, e.g. Shelter"
          disabled={pending}
          className="flex-1 border-0 border-b border-rule bg-transparent py-1 text-[14px] text-foreground placeholder:text-muted-foreground focus:border-sea focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="rounded-md border-0 bg-foreground px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-background disabled:opacity-40"
        >
          add
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="border-0 bg-transparent px-1 font-mono text-[12px] text-muted-foreground hover:text-foreground"
          aria-label="Cancel"
        >
          ×
        </button>
      </div>
      {error ? (
        <div className="mt-1 font-mono text-[10px] text-clay">{error}</div>
      ) : null}
    </form>
  )
}
```

- [ ] **Step 2: Write the detail page**

`src/app/checklists/[slug]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation"

import { isDarkTheme } from "@/lib/theme"
import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { listTripsForWorkspace } from "@/lib/trips/list-queries"
import {
  getChecklistBySlug,
  getChecklistCategories,
  getChecklistItems,
} from "@/lib/checklists/queries"
import {
  LeftRail,
  MobileTopNav,
  buildNavDestinations,
} from "@/components/app-nav"

import { ChecklistDetail } from "./checklist-detail"

export default async function ChecklistDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect(`/signin?next=/checklists/${slug}`)

  const workspace = await getCurrentWorkspace()
  if (!workspace) redirect("/home")

  const checklist = await getChecklistBySlug(workspace.id, slug)
  if (!checklist) notFound()

  const [items, categories, buckets] = await Promise.all([
    getChecklistItems(checklist.id),
    getChecklistCategories(checklist.id),
    listTripsForWorkspace(workspace.id),
  ])
  const dark = await isDarkTheme()
  const hero = buckets.now[0] ?? buckets.upcoming[0] ?? null
  const navDestinations = buildNavDestinations({
    onTheRoad: buckets.now.length > 0,
    tripSlug: hero?.slug ?? null,
  })

  return (
    <div className="relative mx-auto min-h-screen w-full max-w-[440px] lg:flex lg:max-w-none lg:items-stretch">
      <MobileTopNav destinations={navDestinations} current="checklists" />
      <LeftRail
        workspace={workspace}
        initialDark={dark}
        destinations={navDestinations}
        current="checklists"
      />
      <main className="w-full lg:min-w-0 lg:flex-1">
        <ChecklistDetail
          checklistId={checklist.id}
          slug={checklist.slug}
          name={checklist.name}
          initialItems={items}
          initialCategories={categories}
        />
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Verify lint + build, then look**

Run: `pnpm lint` then `pnpm build` (clean). Create a checklist from `/checklists`, land on its page, add a category + items, check/uncheck (syncs live on a second device), rename it, Reset (confirm) clears the checks, delete returns you to `/checklists`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/checklists/[slug]/page.tsx" "src/app/checklists/[slug]/checklist-detail.tsx"
git commit -m "feat(checklists): detail page with categories, items, reset"
```

---

## Task 9: Docs

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Update `docs/TODO.md`**

Add a short entry recording that the Checklists feature shipped: a workspace-level `/checklists` overview + `/checklists/[slug]` detail, three tables (`checklists`, `checklist_categories`, `checklist_items`) mirroring packing with `is_checklist_workspace_member` RLS + Realtime, reusable templates with Reset, and a Checklists nav destination. Note the migration `20260610000005_checklists.sql` must be pasted into Supabase.

- [ ] **Step 2: Append a row to `docs/DECISIONS.md`**

Record: *Checklists are workspace-level reusable templates, deliberately a twin of trip packing (same category-by-name + item shape) so a future "copy a checklist into a trip's packing" is additive. Reset unchecks all items rather than deleting them. Slug auto-derived from the name and deduped within the workspace (vs. trips, where the user types the slug).*

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record Checklists feature + decisions"
```

---

## Self-review checklist (done while writing)

- **Spec coverage:** 3 tables + RLS helper + Realtime (Task 1); types + grouping (Task 2); queries (Task 3); checklist CRUD + reset (Task 4); item/category actions (Task 5); nav destination (Task 6); overview with add/delete (Task 7); detail with categories/items/checkboxes/rename/reset/delete + Realtime (Task 8); docs (Task 9). All spec sections covered.
- **Out-of-scope honored:** no trip link, no drag-reorder, no seeded templates, empty start — none implemented. Item shape kept identical to packing (`category` name + `label` + `done`) so the future "copy into trip" door stays open.
- **Type consistency:** `Checklist`, `ChecklistSummary`, `ChecklistItem`, `ChecklistCategory`, `ChecklistGroup`, `groupChecklistItems`, and the action signatures (`createChecklist`/`renameChecklist`/`deleteChecklist`/`resetChecklist`/`addChecklistItem`/`toggleChecklistItem`/`updateChecklistItem`/`deleteChecklistItem`/`addChecklistCategory`/`deleteChecklistCategory`) are defined where first used and consumed with the same names. `NavKey` gains `"checklists"` (Task 6) and is used as `current="checklists"` (Tasks 7–8).
- **No placeholders:** every code step is complete.
- **Realtime caveat:** like packing, the migration's `alter publication … add table checklist_items` must be applied before live sync works; until the migration is pasted, the page still renders and edits persist on reload.

