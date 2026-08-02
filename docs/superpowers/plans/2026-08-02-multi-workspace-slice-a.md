# Multi-workspace (Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one user belong to several workspaces and move between them from the identity block, so a partner can plan mom-trips in a room of their own.

**Architecture:** An `active_workspace` cookie decides which workspace the app is looking at. It is resolved in exactly one place — `resolveActiveMembership()` — which `getCurrentWorkspace()` and every workspace-scoped Server Action call. Cookie writes happen in a route handler and in Server Actions, because Server Components cannot set cookies. Workspace creation is a `SECURITY DEFINER` RPC, since `workspaces` and `workspace_members` have no INSERT policy.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Supabase (`@supabase/ssr`), Tailwind v4.

## Global Constraints

- No test framework exists in this repo. **Do not invent one.** Each task validates with `pnpm build`, `pnpm lint`, and reasoning about the data path.
- **Never run `pnpm build` while `pnpm dev` is running** — they share `.next/` and the dev server ends up serving unstyled pages.
- Migrations are applied **by hand** in the Supabase SQL editor. Committing SQL changes nothing in the database.
- Every SQL file must be **re-runnable**: `create or replace`, `if not exists`, `drop ... if exists` first.
- Local dev and Vercel prod share **one** Supabase project. There is no separate prod migration step.
- No emojis in code, logs, or commit messages.
- Sparse comments — explain WHY, not WHAT.
- Dates display day-before-month (`en-GB`). Not touched by this plan, but do not regress it.
- Do not claim anything behind the UI is "verified". Report "implemented; build and lint clean; unverified in app".

---

### Task 1: Migration — `create_workspace` RPC and a multi-workspace `accept_invite`

**Files:**
- Create: `supabase/migrations/20260802000001_multi_workspace.sql`

**Interfaces:**
- Produces: `create_workspace(p_name text) returns uuid` and a replaced `accept_invite(p_token text) returns uuid`, both callable via `supabase.rpc(...)` by `authenticated`.

- [ ] **Step 1: Write the migration**

```sql
-- Multi-workspace: a user may belong to more than one workspace.
-- Adds create_workspace, and drops accept_invite's single-workspace guard.
-- Safe to run repeatedly.

create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'Name required';
  end if;

  insert into public.workspaces (name, created_by)
  values (trim(p_name), v_user_id)
  returning id into v_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'owner');

  return v_workspace_id;
end;
$$;

grant execute on function public.create_workspace(text) to authenticated;

-- Belonging to a second workspace is now normal, so the 'You are already in a
-- workspace' guard and the empty-workspace cleanup both go. A standalone signup
-- that later accepts an invite keeps its original (empty) workspace; it is one
-- extra entry in the switcher, not an error state.
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select workspace_id into v_workspace_id
  from public.invites
  where token = p_token
    and used_at is null
    and expires_at > now()
  for update;

  if v_workspace_id is null then
    raise exception 'Invalid or expired invite';
  end if;

  -- Already a member: idempotent success, so a double-click or a re-opened
  -- link is harmless.
  if exists (
    select 1 from public.workspace_members
    where workspace_id = v_workspace_id and user_id = v_user_id
  ) then
    return v_workspace_id;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'member');

  update public.invites set used_at = now() where token = p_token;

  return v_workspace_id;
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;
```

- [ ] **Step 2: Verify it is re-runnable by inspection**

Every statement is `create or replace` or `grant`. There is no bare `create table`, no bare `create policy`, and no `alter table ... add constraint` without a preceding drop. Pasting it twice is a no-op the second time.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260802000001_multi_workspace.sql
git commit -m "feat(workspace): create_workspace RPC and multi-workspace accept_invite"
```

- [ ] **Step 4: Hand the SQL to the user**

Tell the user: paste `supabase/migrations/20260802000001_multi_workspace.sql` into the Supabase SQL editor and run it. **Nothing from Task 4 onward works until this is applied** — `create_workspace` will 404 from PostgREST. Do not attempt to apply it any other way.

---

### Task 2: Single-source active-workspace resolution

**Files:**
- Create: `src/lib/workspace/active.ts`
- Modify: `src/lib/workspace/queries.ts`

**Interfaces:**
- Produces:
  - `ACTIVE_WORKSPACE_COOKIE: string`
  - `resolveActiveMembership(): Promise<ActiveMembership | null>` where
    `ActiveMembership = { workspaceId: string; role: "owner" | "member"; workspace: { name: string; created_at: string; currency: string } }`
  - `listUserWorkspaces(): Promise<WorkspaceSummary[]>` where
    `WorkspaceSummary = { id: string; name: string; role: "owner" | "member"; active: boolean }`
- Consumes: nothing from earlier tasks.

**Why one resolver:** `getCurrentWorkspace()` and three Server Actions each independently look up "the user's workspace" today. If they resolve the active workspace differently, a page renders workspace A while a form writes to workspace B. All of them go through `resolveActiveMembership()`.

- [ ] **Step 1: Create the cookie module and resolver**

`src/lib/workspace/active.ts`:

```ts
import { cookies } from "next/headers"

import { createClient } from "@/lib/supabase/server"

export const ACTIVE_WORKSPACE_COOKIE = "active_workspace"

/** A year, matching the timezone and theme cookies. */
export const ACTIVE_WORKSPACE_COOKIE_MAX_AGE = 31536000

export interface ActiveMembership {
  workspaceId: string
  role: "owner" | "member"
  workspace: { name: string; created_at: string; currency: string }
}

/**
 * The workspace the app is currently looking at: the one named by the cookie
 * when the caller is a member of it, otherwise their first membership. Every
 * workspace-scoped read and write resolves through here, so a page and the
 * form on it can never disagree about which workspace they mean.
 */
export async function resolveActiveMembership(): Promise<ActiveMembership | null> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return null

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name, created_at, currency)")
    .eq("user_id", userData.user.id)
    .order("joined_at", { ascending: true })

  if (!memberships || memberships.length === 0) return null

  const activeId = (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value
  const row =
    memberships.find((m) => m.workspace_id === activeId) ?? memberships[0]

  return {
    workspaceId: row.workspace_id,
    role: row.role as "owner" | "member",
    workspace: row.workspaces as unknown as ActiveMembership["workspace"],
  }
}
```

- [ ] **Step 2: Rewrite `getCurrentWorkspace` to use the resolver**

In `src/lib/workspace/queries.ts`, add the import and replace the membership lookup. The `members`/`profiles` half of the function is unchanged.

```ts
import { createClient } from "@/lib/supabase/server"
import { resolveActiveMembership } from "@/lib/workspace/active"
```

Replace the body from `const { data: membership } = await supabase` through the `if (!membership) return null` line with:

```ts
  const membership = await resolveActiveMembership()
  if (!membership) return null
```

Then replace the two later references so they read from the resolver's shape:

```ts
  const { data: rawMembers } = await supabase
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", membership.workspaceId)
```

and the return block:

```ts
  return {
    id: membership.workspaceId,
    name: membership.workspace.name,
    createdAt: membership.workspace.created_at,
    role: membership.role,
    currency: membership.workspace.currency,
    members: rawMembers.map((m) => ({
      user_id: m.user_id,
      role: m.role as "owner" | "member",
      display_name: nameById.get(m.user_id) ?? "Unknown",
    })),
  }
```

Delete the now-unused `workspaceRow` const and the `userData` lookup if the compiler flags them as unused — `resolveActiveMembership` does its own auth check. Keep the `supabase` client, it is still used for the members and profiles queries.

- [ ] **Step 3: Add the switcher's list query**

Append to `src/lib/workspace/queries.ts`:

```ts
export interface WorkspaceSummary {
  id: string
  name: string
  role: "owner" | "member"
  active: boolean
}

/** Every workspace the caller belongs to, oldest first, flagged with which one
 * is currently active. Drives the switcher. */
export async function listUserWorkspaces(): Promise<WorkspaceSummary[]> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return []

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name)")
    .eq("user_id", userData.user.id)
    .order("joined_at", { ascending: true })

  if (!memberships || memberships.length === 0) return []

  const active = await resolveActiveMembership()

  return memberships.map((m) => ({
    id: m.workspace_id,
    name: (m.workspaces as unknown as { name: string }).name,
    role: m.role as "owner" | "member",
    active: m.workspace_id === active?.workspaceId,
  }))
}
```

- [ ] **Step 4: Build and lint**

Run: `pnpm lint && pnpm build`
Expected: both clean. Confirm `pnpm dev` is not running first.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace/active.ts src/lib/workspace/queries.ts
git commit -m "feat(workspace): resolve the active workspace from a cookie"
```

---

### Task 3: The switch route handler

**Files:**
- Create: `src/app/api/workspace/switch/route.ts`

**Interfaces:**
- Consumes: `ACTIVE_WORKSPACE_COOKIE`, `ACTIVE_WORKSPACE_COOKIE_MAX_AGE` from Task 2.
- Produces: `GET /api/workspace/switch?to=<id>&next=<path>` and the same as `POST` with form fields `to` and `next`. Both 303-redirect.

**Why a route handler:** Server Components cannot set cookies. This is the one mechanism used by both the switcher UI (POST from a form) and cross-workspace trip links (GET redirect, Task 7).

- [ ] **Step 1: Write the handler**

```ts
import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import {
  ACTIVE_WORKSPACE_COOKIE,
  ACTIVE_WORKSPACE_COOKIE_MAX_AGE,
} from "@/lib/workspace/active"

/** Relative paths only: `next` reaches us from a query string, so an absolute
 * URL here would make this an open redirect. */
function safeNext(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/home"
}

async function switchWorkspace(request: Request, to: string, next: string) {
  const response = NextResponse.redirect(
    new URL(safeNext(next), request.url),
    303,
  )
  if (!to) return response

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return response

  // Membership is checked here rather than trusted from the form: the cookie
  // decides what every page reads, so an id the caller cannot access must not
  // reach it.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userData.user.id)
    .eq("workspace_id", to)
    .maybeSingle()

  if (!membership) {
    return NextResponse.redirect(new URL("/home", request.url), 303)
  }

  response.cookies.set(ACTIVE_WORKSPACE_COOKIE, to, {
    path: "/",
    maxAge: ACTIVE_WORKSPACE_COOKIE_MAX_AGE,
    sameSite: "lax",
  })
  return response
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  return switchWorkspace(
    request,
    params.get("to") ?? "",
    params.get("next") ?? "/home",
  )
}

export async function POST(request: Request) {
  const form = await request.formData()
  return switchWorkspace(
    request,
    String(form.get("to") ?? ""),
    String(form.get("next") ?? "/home"),
  )
}
```

- [ ] **Step 2: Reason through the failure paths**

Confirm by reading the code: a `to` the caller is not a member of leaves the cookie untouched and lands on `/home`; a malformed uuid makes `maybeSingle()` return no row, same outcome; `next=https://evil.example` fails `startsWith("/")` and falls back to `/home`; `next=//evil.example` is caught by the second check.

- [ ] **Step 3: Build and lint**

Run: `pnpm lint && pnpm build`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/workspace/switch/route.ts
git commit -m "feat(workspace): route handler to switch the active workspace"
```

---

### Task 4: Workspace Server Actions

**Files:**
- Modify: `src/lib/workspace/actions.ts`

**Interfaces:**
- Consumes: `resolveActiveMembership`, `ACTIVE_WORKSPACE_COOKIE`, `ACTIVE_WORKSPACE_COOKIE_MAX_AGE` (Task 2); `create_workspace` RPC (Task 1).
- Produces: `createWorkspace(formData: FormData): Promise<void>`, `renameWorkspace(formData: FormData): Promise<void>`. `generateInvite`, `setWorkspaceCurrency` and `acceptInvite` keep their existing signatures.

**Three existing bugs this fixes.** `generateInvite` (line 25) and `setWorkspaceCurrency` (line 79) both hard-code `.limit(1)` over memberships — with two workspaces they would invite into, and re-currency, whichever one came back first. And `acceptInvite` does not set the cookie, so after joining mom's workspace you would still be looking at the couple's.

- [ ] **Step 1: Add the imports**

At the top of `src/lib/workspace/actions.ts`:

```ts
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import {
  ACTIVE_WORKSPACE_COOKIE,
  ACTIVE_WORKSPACE_COOKIE_MAX_AGE,
  resolveActiveMembership,
} from "@/lib/workspace/active"
```

`revalidatePath` is already imported — do not duplicate it.

- [ ] **Step 2: Add a local cookie setter**

Server Actions *can* set cookies, unlike Server Components, so creating or joining a workspace can drop you straight into it.

```ts
async function setActiveWorkspace(workspaceId: string): Promise<void> {
  const store = await cookies()
  store.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    path: "/",
    maxAge: ACTIVE_WORKSPACE_COOKIE_MAX_AGE,
    sameSite: "lax",
  })
}
```

- [ ] **Step 3: Add `createWorkspace` and `renameWorkspace`**

```ts
/** Creates a workspace, makes the caller its owner, and switches to it.
 * Wired straight to `<form action={...}>`, so it throws rather than returning
 * an error shape. */
export async function createWorkspace(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim()
  if (!name) throw new Error("Name required")

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_workspace", {
    p_name: name,
  })
  if (error) throw new Error(error.message)

  await setActiveWorkspace(data as string)
  redirect("/home")
}

/** Renames the active workspace. Owner-gated by the workspaces_update_owner
 * policy, so a member's update simply matches no rows. */
export async function renameWorkspace(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim()
  if (!name) throw new Error("Name required")

  const membership = await resolveActiveMembership()
  if (!membership) throw new Error("No workspace")

  const supabase = await createClient()
  const { error } = await supabase
    .from("workspaces")
    .update({ name })
    .eq("id", membership.workspaceId)
  if (error) throw new Error(error.message)

  revalidatePath("/home")
  revalidatePath("/profile")
}
```

`redirect()` throws `NEXT_REDIRECT` by design — do not wrap it in a `try`.

- [ ] **Step 4: Point `generateInvite` at the active workspace**

Replace lines 25-34 (the `// Find the user's workspace (MVP: one per user).` block through the `role !== "owner"` check) with:

```ts
  const membership = await resolveActiveMembership()
  if (!membership) return { error: "No workspace" }
  if (membership.role !== "owner") {
    return { error: "Only the workspace owner can invite" }
  }
```

Then change the two later uses of `membership.workspace_id` to `membership.workspaceId` — in the `existing` lookup's `.eq("workspace_id", ...)` and in the `insert({ workspace_id: ... })`.

- [ ] **Step 5: Point `setWorkspaceCurrency` at the active workspace**

Replace its membership lookup (the `.from("workspace_members")` block through `if (!membership) throw new Error("No workspace")`) with:

```ts
  const membership = await resolveActiveMembership()
  if (!membership) throw new Error("No workspace")
```

and change `.eq("id", membership.workspace_id)` to `.eq("id", membership.workspaceId)`.

- [ ] **Step 6: Make `acceptInvite` switch you into the workspace you joined**

```ts
export async function acceptInvite(token: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("accept_invite", {
    p_token: token,
  })
  if (error) return { error: error.message }
  // The RPC returns the joined workspace's id. Without this the invitee lands
  // back in whichever workspace they already had.
  if (data) await setActiveWorkspace(data as string)
  return {}
}
```

- [ ] **Step 7: Build and lint**

Run: `pnpm lint && pnpm build`
Expected: both clean. A `membership.workspace_id` left anywhere is a type error, which is the point — the rename forces every call site to be revisited.

- [ ] **Step 8: Commit**

```bash
git add src/lib/workspace/actions.ts
git commit -m "feat(workspace): create, rename, and scope actions to the active workspace"
```

---

### Task 5: The switcher UI

**Files:**
- Create: `src/components/workspace-switcher.tsx`
- Modify: `src/components/app-nav.tsx` (the `LeftRail` identity block)
- Modify: `src/app/home/page.tsx` (both `Together · Workspace` labels)

**Interfaces:**
- Consumes: `listUserWorkspaces` (Task 2), `createWorkspace` (Task 4), `POST /api/workspace/switch` (Task 3).
- Produces: `<WorkspaceSwitcher next?: string />` — an async Server Component whose only prop is optional (`next`, defaulting to `/home`), so it can be rendered bare.

**Why no required props and no client component:** rendering bare means no call site of `LeftRail` has to change. All seven files importing `app-nav.tsx` are Server Components, so pulling `next/headers` in through this import is safe. Using a native `<details>` for the dropdown means no `"use client"`, no hydration risk, and no `useId` concerns. Every action inside is a plain form post.

- [ ] **Step 1: Write the component**

`src/components/workspace-switcher.tsx`:

```tsx
import { Label } from "@/components/together"
import { createWorkspace } from "@/lib/workspace/actions"
import { listUserWorkspaces } from "@/lib/workspace/queries"

/**
 * Workspace identity and switcher. A native <details> so it stays a Server
 * Component: every entry is a form post, nothing hydrates.
 */
export async function WorkspaceSwitcher({ next = "/home" }: { next?: string }) {
  const workspaces = await listUserWorkspaces()
  if (workspaces.length === 0) return <Label>Together · Workspace</Label>

  const active = workspaces.find((w) => w.active) ?? workspaces[0]
  const others = workspaces.filter((w) => w.id !== active.id)

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5">
        <Label>Together · {active.name}</Label>
        <span className="text-[10px] text-muted-foreground transition-transform group-open:rotate-180">
          v
        </span>
      </summary>

      <div className="absolute left-0 top-full z-20 mt-2 w-[240px] rounded-lg border border-border bg-card p-2 shadow-lg">
        {others.map((w) => (
          <form key={w.id} action="/api/workspace/switch" method="post">
            <input type="hidden" name="to" value={w.id} />
            <input type="hidden" name="next" value={next} />
            <button
              type="submit"
              className="w-full rounded-md px-2.5 py-2 text-left text-[13.5px] text-muted-foreground transition-colors hover:bg-sea-tint hover:text-foreground"
            >
              {w.name}
            </button>
          </form>
        ))}

        {others.length > 0 ? <div className="my-1.5 h-px bg-border" /> : null}

        <form action={createWorkspace} className="flex gap-1.5 p-1">
          <input
            name="name"
            required
            maxLength={40}
            placeholder="New workspace"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            className="rounded-md bg-sea-tint px-2.5 py-1.5 text-[13px] text-foreground"
          >
            Add
          </button>
        </form>
      </div>
    </details>
  )
}
```

- [ ] **Step 2: Put it in the left rail**

In `src/components/app-nav.tsx`, add the import:

```ts
import { WorkspaceSwitcher } from "@/components/workspace-switcher"
```

Change `export function LeftRail({` to `export async function LeftRail({` — it now awaits a child Server Component's data. Callers using `<LeftRail ... />` need no change.

Then replace the bare `<Label>Together</Label>` on line 88 with:

```tsx
        <WorkspaceSwitcher />
```

- [ ] **Step 3: Put it in the home header**

In `src/app/home/page.tsx`, add the import:

```ts
import { WorkspaceSwitcher } from "@/components/workspace-switcher"
```

Replace the mobile header's `<Label>Together · Workspace</Label>` (line 116) with `<WorkspaceSwitcher />`, and the desktop `<Label className="hidden md:block">Together · Workspace</Label>` (line 131) with:

```tsx
          <div className="hidden md:block">
            <WorkspaceSwitcher />
          </div>
```

Leave the `Label` import in place — it is still used elsewhere on the page.

- [ ] **Step 4: Build and lint**

Run: `pnpm lint && pnpm build`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace-switcher.tsx src/components/app-nav.tsx src/app/home/page.tsx
git commit -m "feat(workspace): switcher in the identity block"
```

---

### Task 6: A workspace of one must look finished

**Files:**
- Modify: `src/app/home/page.tsx:173`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

**The bug:** home currently renders `youOnly ? <InviteCard /> : <the whole trip layout>`. A solo mom-workspace would therefore show "invite your partner" and **hide every trip in it**. The invite prompt belongs to a genuinely empty new workspace, not to every solo one.

- [ ] **Step 1: Add the emptiness check**

After the `buckets` assignment (around line 67), add:

```ts
  const noTripsYet =
    buckets.now.length === 0 &&
    buckets.upcoming.length === 0 &&
    buckets.past.length === 0 &&
    buckets.dreams.length === 0
```

- [ ] **Step 2: Narrow the invite branch**

Change line 173 from `{youOnly ? (` to:

```tsx
      {youOnly && noTripsYet ? (
```

- [ ] **Step 3: Reason through both paths**

A brand-new user, alone with no trips, still gets the invite card — onboarding is unchanged. A partner alone in a workspace holding mom-trips now gets the normal trip layout. A two-member workspace was never affected.

- [ ] **Step 4: Build and lint**

Run: `pnpm lint && pnpm build`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/home/page.tsx
git commit -m "fix(home): show trips in a solo workspace instead of the invite card"
```

---

### Task 7: Cross-workspace trip links

**Files:**
- Modify: `src/lib/trips/queries.ts` (append a function)
- Modify: `src/app/trips/[slug]/page.tsx:167-168`

**Interfaces:**
- Consumes: `GET /api/workspace/switch` (Task 3).
- Produces: `findWorkspaceForTripSlug(slug: string, excludeWorkspaceId: string): Promise<string | null>`.

**The problem:** trip slugs are unique per workspace and `getTripBySlug` filters by workspace id, so a bookmarked `/trips/lombok` opened while the mom-workspace is active silently 404s.

- [ ] **Step 1: Add the lookup**

Append to `src/lib/trips/queries.ts`:

```ts
/** The one other workspace of the caller's holding this slug, or null when
 * none or more than one does. RLS restricts the scan to their own workspaces,
 * so this cannot see anyone else's trips. */
export async function findWorkspaceForTripSlug(
  slug: string,
  excludeWorkspaceId: string,
): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("trips")
    .select("workspace_id")
    .eq("slug", slug)
    .neq("workspace_id", excludeWorkspaceId)

  if (!data || data.length !== 1) return null
  return data[0].workspace_id as string
}
```

- [ ] **Step 2: Redirect through the switch route**

In `src/app/trips/[slug]/page.tsx`, extend the import on line 48:

```ts
import {
  findWorkspaceForTripSlug,
  getTripBySlug,
  type TripHeader,
} from "@/lib/trips/queries"
```

Replace line 168 (`if (!header) notFound()`) with:

```ts
  if (!header) {
    // The slug may belong to another of the caller's workspaces — follow it
    // rather than 404ing on a bookmark saved before the last switch.
    const elsewhere = await findWorkspaceForTripSlug(slug, workspace.id)
    if (elsewhere) {
      redirect(
        `/api/workspace/switch?to=${elsewhere}&next=${encodeURIComponent(`/trips/${slug}`)}`,
      )
    }
    notFound()
  }
```

`redirect` is already imported on line 2.

- [ ] **Step 3: Reason through the loop risk**

The redirect sets the cookie to the workspace that *does* hold the slug, so the second render finds the trip and never re-enters this branch. If the switch route rejects the id, it lands on `/home`, not back here. No cycle.

- [ ] **Step 4: Build and lint**

Run: `pnpm lint && pnpm build`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/trips/queries.ts "src/app/trips/[slug]/page.tsx"
git commit -m "feat(trips): follow a trip link into the workspace that holds it"
```

---

## Done means

**Verified by Claude:** `pnpm build` and `pnpm lint` clean after every task; no `membership.workspace_id` references remain; the migration is re-runnable by inspection; the switch route ignores non-member ids and non-relative `next` values.

**Verified by the user in-app** — the handover checklist:

1. The switcher appears in the identity block on mobile and on desktop.
2. Creating a workspace lands you in it, and it is empty.
3. Switching back shows the couple's trips untouched.
4. An invite generated inside workspace #2 joins the invitee to #2, not to the couple workspace.
5. Accepting an invite drops you into the workspace you just joined.
6. A bookmarked trip URL from the other workspace opens the trip instead of 404ing.
7. A solo workspace with trips shows the trips, not the invite card.

## Follow-ups, explicitly not in this plan

- Slice B (avatar travellers) — specced in `docs/superpowers/specs/2026-08-02-multi-workspace-design.md`.
- Leaving or deleting a workspace.
- `/checklists/[slug]` has the same cross-workspace slug behaviour as trips. Left alone until it bites.
