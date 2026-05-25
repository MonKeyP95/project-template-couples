# Phase 2 — Auth + Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 2 of the Together app per `docs/superpowers/specs/2026-05-25-phase-2-auth-pairing-design.md` — sign-up, sign-in, sign-out, profile, shared workspace with RLS, partner pairing via single-use shareable invite link.

**Architecture:** Supabase Postgres handles identity (`auth.users`) plus four app tables (`profiles`, `workspaces`, `workspace_members`, `invites`) with RLS on every shared table. Multi-table writes go through `SECURITY DEFINER` Postgres functions (`handle_new_user` trigger, `accept_invite` RPC, `get_invite_preview` RPC) so the app never needs the service-role key. Next.js handles UI + Server Actions; `src/proxy.ts` gates protected routes by checking the Supabase session cookie.

**Tech Stack:** Next.js 16 (App Router, Server Actions, Route Handlers, `proxy.ts`), TypeScript, Tailwind v4, Shadcn (`base-nova` on `@base-ui/react`), Supabase (`@supabase/ssr` 0.10 + `@supabase/supabase-js` 2.106), pnpm 11.

**Verification approach:** This project has no test framework, deliberately (per the user's "don't overengineer" rule). Each task's verification step is **manual** — visit page in browser, run SQL query in Supabase SQL Editor, inspect dev-server log. Manual verification keeps the increment-verify discipline of TDD without adding a test framework that the project hasn't justified yet. Add Vitest/Playwright when there is a concrete reason to.

---

## File Structure

**New files (created across these tasks):**

```
supabase/
  migrations/
    20260525000001_phase_2_schema.sql       # all DDL: tables, functions, triggers, RLS

src/
  app/
    signin/page.tsx                          # public sign-in form
    signup/page.tsx                          # public sign-up form
    join/[token]/page.tsx                    # invite-acceptance dispatcher
    home/page.tsx                            # protected dashboard placeholder
    profile/page.tsx                         # protected edit-display-name
    api/signout/route.ts                     # POST handler, calls supabase.auth.signOut
  components/
    initials-avatar.tsx                      # name → initials + warm color
    invite-card.tsx                          # "Invite your partner" UI on /home
  lib/
    auth/actions.ts                          # Server Actions: signIn, signUp, signOut
    workspace/actions.ts                     # Server Actions: generateInvite, acceptInviteSignedIn
    workspace/queries.ts                     # Server-side reads: getCurrentWorkspace, getMembers
    invites/preview.ts                       # Server-side wrapper around get_invite_preview RPC
    initials.ts                              # pure helpers: makeInitials(name), colorFromName(name)
```

**Modified files:**

```
src/proxy.ts                                 # add public/protected route gating
```

Each `lib/<area>/` folder co-locates Server Actions and queries for one feature area. Pages stay thin — they import from `lib/`.

---

## Task 1: Write the Phase 2 SQL migration

**Files:**
- Create: `supabase/migrations/20260525000001_phase_2_schema.sql`

- [ ] **Step 1: Make the migrations directory and write the SQL file**

Create `supabase/migrations/20260525000001_phase_2_schema.sql` with this exact content:

```sql
-- Phase 2: auth + pairing schema
-- See docs/superpowers/specs/2026-05-25-phase-2-auth-pairing-design.md

-- ============================================================================
-- TABLES
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Our trips',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index invites_token_idx on public.invites(token);

-- ============================================================================
-- HELPER FUNCTIONS (used by RLS policies; SECURITY DEFINER avoids recursion)
-- ============================================================================

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_owner(p_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.invites enable row level security;

-- profiles: any authenticated user can read any profile (so workspace members
-- can see each other's display names). Only update your own row.
create policy profiles_select_authenticated on public.profiles
  for select to authenticated using (true);
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- workspaces: only members can read; only owners can update.
create policy workspaces_select_members on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));
create policy workspaces_update_owner on public.workspaces
  for update to authenticated using (public.is_workspace_owner(id)) with check (public.is_workspace_owner(id));

-- workspace_members: read if you're in the same workspace; delete self or by owner.
create policy members_select_same_workspace on public.workspace_members
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy members_delete_self_or_owner on public.workspace_members
  for delete to authenticated using (
    user_id = auth.uid() or public.is_workspace_owner(workspace_id)
  );

-- invites: members can read; only owners can insert.
create policy invites_select_members on public.invites
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy invites_insert_owner on public.invites
  for insert to authenticated with check (public.is_workspace_owner(workspace_id));

-- ============================================================================
-- TRIGGER: create profile (+ workspace or join via invite) on signup
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text := coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    split_part(new.email, '@', 1)
  );
  v_invite_token text := new.raw_user_meta_data->>'invite_token';
  v_workspace_id uuid;
begin
  insert into public.profiles (id, display_name)
  values (new.id, v_display_name);

  if v_invite_token is not null and v_invite_token <> '' then
    select workspace_id into v_workspace_id
    from public.invites
    where token = v_invite_token
      and used_at is null
      and expires_at > now()
    for update;

    if v_workspace_id is not null then
      insert into public.workspace_members (workspace_id, user_id, role)
      values (v_workspace_id, new.id, 'member');

      update public.invites
      set used_at = now()
      where token = v_invite_token;

      return new;
    end if;
  end if;

  -- No invite, or invite was invalid: create a personal workspace.
  insert into public.workspaces (created_by)
  values (new.id)
  returning id into v_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- RPC: accept_invite for already-signed-in users
-- ============================================================================

create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_existing uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select workspace_id into v_existing
  from public.workspace_members
  where user_id = v_user_id
  limit 1;

  if v_existing is not null then
    raise exception 'You are already in a workspace';
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

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'member');

  update public.invites set used_at = now() where token = p_token;

  return v_workspace_id;
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;

-- ============================================================================
-- RPC: get_invite_preview for unauthenticated visitors at /join/[token]
-- ============================================================================

create or replace function public.get_invite_preview(p_token text)
returns table (workspace_name text, valid boolean)
language sql
security definer
set search_path = public
stable
as $$
  select
    w.name as workspace_name,
    (i.used_at is null and i.expires_at > now()) as valid
  from public.invites i
  join public.workspaces w on w.id = i.workspace_id
  where i.token = p_token;
$$;

grant execute on function public.get_invite_preview(text) to anon, authenticated;
```

- [ ] **Step 2: Verify the file**

Run: `git status` — file should show as untracked.

Open the file in your editor and skim for typos. Don't apply yet — that's the next task.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525000001_phase_2_schema.sql
git commit -m "feat(schema): Phase 2 migration — profiles, workspaces, invites, RLS, signup trigger"
```

---

## Task 2: Apply the migration to Supabase and verify

**Files:**
- (No code changes — this is a manual ops step against Supabase.)

- [ ] **Step 1: Open the Supabase SQL Editor**

In a browser, go to https://supabase.com/dashboard. Open the `together` project. Click **SQL Editor** in the sidebar, then **New query**.

- [ ] **Step 2: Paste and run the migration**

Copy the entire contents of `supabase/migrations/20260525000001_phase_2_schema.sql` into the editor. Click **Run** (or `Ctrl/Cmd+Enter`).

Expected: green "Success. No rows returned" toast. No error.

If you see an error like `relation "public.profiles" already exists`, the migration was partially applied earlier. Inspect with `select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('profiles', 'workspaces', 'workspace_members', 'invites');` — if it returns 4, you're already migrated; skip the re-run.

- [ ] **Step 3: Verify schema with three small queries**

Paste each into the SQL Editor and run:

```sql
-- Should return 4 rows: profiles, workspaces, workspace_members, invites
select table_name from information_schema.tables
where table_schema = 'public' and table_name in
  ('profiles', 'workspaces', 'workspace_members', 'invites');

-- Should return 4 rows, all with rowsecurity = true
select relname, relrowsecurity from pg_class
where relnamespace = (select oid from pg_namespace where nspname = 'public')
  and relname in ('profiles', 'workspaces', 'workspace_members', 'invites');

-- Should return 5 rows: handle_new_user, accept_invite, get_invite_preview,
--                      is_workspace_member, is_workspace_owner
select proname from pg_proc
where pronamespace = (select oid from pg_namespace where nspname = 'public')
  and proname in (
    'handle_new_user', 'accept_invite', 'get_invite_preview',
    'is_workspace_member', 'is_workspace_owner'
  );
```

- [ ] **Step 4: Update the project docs**

Add a row to `docs/DECISIONS.md` table:

```markdown
| Apply migrations via **Supabase SQL Editor paste**, keeping SQL files in `supabase/migrations/` for source-of-truth | Avoids installing the Supabase CLI for one migration. Files are still versioned + reviewable. Switch to `supabase db push` (CLI) once we have 3+ migrations and the setup cost amortizes. | 2026-05-25 |
```

```bash
git add docs/DECISIONS.md
git commit -m "docs: log migration-application choice (SQL Editor paste for now)"
```

---

## Task 3: Build /signup page with Server Action

**Files:**
- Create: `src/lib/auth/actions.ts`
- Create: `src/app/signup/page.tsx`

- [ ] **Step 1: Create the Server Action**

Create `src/lib/auth/actions.ts`:

```ts
"use server"

import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

export async function signUp(formData: FormData) {
  const displayName = String(formData.get("display_name") ?? "").trim()
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const inviteToken = String(formData.get("invite_token") ?? "") || null

  if (!displayName || !email || !password) {
    return { error: "All fields are required." }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
        ...(inviteToken ? { invite_token: inviteToken } : {}),
      },
    },
  })

  if (error) return { error: error.message }

  redirect("/home")
}
```

- [ ] **Step 2: Create the page**

Create `src/app/signup/page.tsx`:

```tsx
import Link from "next/link"

import { signUp } from "@/lib/auth/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>
}) {
  const { invite } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-5xl leading-[1] tracking-tight">
          Make space <span className="italic text-primary">for two</span>.
        </h1>

        {invite ? (
          <p className="mt-4 text-sm text-muted-foreground">
            You're joining a workspace you were invited to.
          </p>
        ) : null}

        <form action={signUp} className="mt-8 flex flex-col gap-3">
          {invite ? (
            <input type="hidden" name="invite_token" value={invite} />
          ) : null}
          <Input name="display_name" placeholder="Your name" required />
          <Input name="email" type="email" placeholder="Email" required />
          <Input
            name="password"
            type="password"
            placeholder="Password (min 8)"
            minLength={8}
            required
          />
          <Button type="submit" size="lg" className="mt-2">
            Sign up
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={invite ? `/signin?invite=${invite}` : "/signin"}
            className="text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: silent (no errors).

- [ ] **Step 4: Manually verify sign-up flow**

Start dev: `pnpm dev`. Visit http://localhost:3000/signup.

Submit the form with a test email + password. After submit you should be redirected to `/home` (which 404s right now — that's fine, it lands in Task 7).

Verify the trigger ran by running this in the Supabase SQL Editor:

```sql
select
  u.email,
  p.display_name,
  w.id as workspace_id,
  w.name as workspace_name,
  m.role
from auth.users u
join public.profiles p on p.id = u.id
join public.workspace_members m on m.user_id = u.id
join public.workspaces w on w.id = m.workspace_id
order by u.created_at desc
limit 5;
```

Expected: one row with the email you used, the display name, a workspace id, name `"Our trips"`, role `"owner"`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/actions.ts src/app/signup/page.tsx
git commit -m "feat(auth): /signup page + signUp Server Action"
```

---

## Task 4: Build /signin page with Server Action

**Files:**
- Modify: `src/lib/auth/actions.ts`
- Create: `src/app/signin/page.tsx`

- [ ] **Step 1: Add signIn to the actions file**

Append to `src/lib/auth/actions.ts`:

```ts
export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const next = String(formData.get("next") ?? "/home")

  if (!email || !password) {
    return { error: "Email and password are required." }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) return { error: error.message }

  redirect(next)
}
```

- [ ] **Step 2: Create the page**

Create `src/app/signin/page.tsx`:

```tsx
import Link from "next/link"

import { signIn } from "@/lib/auth/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; invite?: string }>
}) {
  const { next, invite } = await searchParams
  const nextPath = next ?? (invite ? `/join/${invite}` : "/home")

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-5xl leading-[1] tracking-tight">
          Welcome <span className="italic text-primary">back</span>.
        </h1>

        <form action={signIn} className="mt-8 flex flex-col gap-3">
          <input type="hidden" name="next" value={nextPath} />
          <Input name="email" type="email" placeholder="Email" required />
          <Input name="password" type="password" placeholder="Password" required />
          <Button type="submit" size="lg" className="mt-2">
            Sign in
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link
            href={invite ? `/signup?invite=${invite}` : "/signup"}
            className="text-foreground underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Type-check and manually verify**

Run: `pnpm exec tsc --noEmit` — silent.

In browser, visit http://localhost:3000/signin. Sign in with the credentials from Task 3. Expected: redirected to `/home` (still 404 for now).

In a new private window, visit `/signin` again with intentionally wrong password. Expected: form submits without crashing. (Error display lands in Task 11 — for now we just confirm no crash.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/actions.ts src/app/signin/page.tsx
git commit -m "feat(auth): /signin page + signIn Server Action"
```

---

## Task 5: Sign-out Route Handler

**Files:**
- Create: `src/app/api/signout/route.ts`

- [ ] **Step 1: Create the handler**

Create `src/app/api/signout/route.ts`:

```ts
import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"))
}
```

- [ ] **Step 2: Add NEXT_PUBLIC_SITE_URL to env files**

Modify `.env.example`. Replace the Supabase section with:

```
# Supabase ------------------------------------------------------------
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=

# Server-only. Don't set unless we need admin operations.
# SUPABASE_SECRET_KEY=

# Site URL ------------------------------------------------------------
# Used by /api/signout to build absolute redirect URLs. In production,
# set this to your Vercel deployment URL.
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Modify `.env.local` (your local copy): append `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.

In Vercel dashboard → Project → Settings → Environment Variables, add `NEXT_PUBLIC_SITE_URL` = `https://project-template-couples.vercel.app` for the **Production** environment.

- [ ] **Step 3: Manually verify**

Restart `pnpm dev` so the new env var is loaded. Visit `/signin` and sign in. Then in the browser DevTools console run:

```js
fetch('/api/signout', { method: 'POST', redirect: 'manual' }).then(r => console.log(r.status))
```

Expected: status 0 or 302 (redirect). Visit `/` — you should be signed out (cookie cleared). Confirm by inspecting cookies in DevTools → Application → Cookies — the `sb-*` auth cookie should be gone.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/signout/route.ts .env.example
git commit -m "feat(auth): POST /api/signout route handler + NEXT_PUBLIC_SITE_URL"
```

---

## Task 6: Proxy gating — public/protected route lists

**Files:**
- Modify: `src/proxy.ts`

- [ ] **Step 1: Replace `src/proxy.ts` entirely**

Replace the contents of `src/proxy.ts` with:

```ts
import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

const PUBLIC_ROUTES: ReadonlyArray<string> = ["/", "/signin", "/signup"]
const PUBLIC_ROUTE_PREFIXES: ReadonlyArray<string> = ["/join/", "/api/"]

function isPublic(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) return true
  return PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Authed user visiting auth pages → bounce to /home.
  if (user && (pathname === "/signin" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/home", request.url))
  }

  // Unauthed user visiting a protected page → bounce to /signin with ?next=.
  if (!user && !isPublic(pathname)) {
    const url = new URL("/signin", request.url)
    url.searchParams.set("next", pathname)
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
```

- [ ] **Step 2: Manually verify**

Restart `pnpm dev`. In a fresh private window (no cookies):

- Visit http://localhost:3000/home → expect redirect to `/signin?next=/home`.
- Visit http://localhost:3000/profile → expect redirect to `/signin?next=/profile`.
- Visit http://localhost:3000/signin → expect the sign-in page renders (not a loop).
- Visit http://localhost:3000/ → expect the landing page renders.

In a normal browser where you're signed in:

- Visit http://localhost:3000/signin → expect redirect to `/home` (which is still 404 until Task 7).

- [ ] **Step 3: Commit**

```bash
git add src/proxy.ts
git commit -m "feat(proxy): gate protected routes, bounce authed users from auth pages"
```

---

## Task 7: /home placeholder + initials avatar

**Files:**
- Create: `src/lib/initials.ts`
- Create: `src/components/initials-avatar.tsx`
- Create: `src/lib/workspace/queries.ts`
- Create: `src/app/home/page.tsx`

- [ ] **Step 1: Pure helpers for initials and color**

Create `src/lib/initials.ts`:

```ts
const AVATAR_COLORS = [
  "oklch(0.84 0.08 11)",   // pink (matches --primary)
  "oklch(0.83 0.09 80)",   // peach
  "oklch(0.85 0.07 200)",  // teal
  "oklch(0.83 0.08 280)",  // soft indigo
  "oklch(0.84 0.07 130)",  // sage
]

export function makeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase()
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase()
}

export function colorFromName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length
  return AVATAR_COLORS[index]!
}
```

- [ ] **Step 2: Avatar component**

Create `src/components/initials-avatar.tsx`:

```tsx
import { cn } from "@/lib/utils"
import { colorFromName, makeInitials } from "@/lib/initials"

interface InitialsAvatarProps {
  name: string
  size?: "sm" | "md" | "lg"
  className?: string
}

const SIZES: Record<NonNullable<InitialsAvatarProps["size"]>, string> = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-base",
}

export function InitialsAvatar({ name, size = "md", className }: InitialsAvatarProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-medium text-foreground/80",
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: colorFromName(name) }}
      aria-label={name}
    >
      {makeInitials(name)}
    </span>
  )
}
```

- [ ] **Step 3: Workspace queries**

Create `src/lib/workspace/queries.ts`:

```ts
import { createClient } from "@/lib/supabase/server"

export interface WorkspaceMember {
  user_id: string
  role: "owner" | "member"
  display_name: string
}

export interface CurrentWorkspace {
  id: string
  name: string
  role: "owner" | "member"
  members: WorkspaceMember[]
}

export async function getCurrentWorkspace(): Promise<CurrentWorkspace | null> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return null

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name)")
    .eq("user_id", userData.user.id)
    .limit(1)
    .single()

  if (!membership) return null

  const { data: members } = await supabase
    .from("workspace_members")
    .select("user_id, role, profiles(display_name)")
    .eq("workspace_id", membership.workspace_id)

  return {
    id: membership.workspace_id,
    // Supabase typed result for nested table is unknown without codegen; cast carefully.
    name: (membership.workspaces as unknown as { name: string }).name,
    role: membership.role as "owner" | "member",
    members:
      members?.map((m) => ({
        user_id: m.user_id,
        role: m.role as "owner" | "member",
        display_name: (m.profiles as unknown as { display_name: string }).display_name,
      })) ?? [],
  }
}
```

- [ ] **Step 4: /home page**

Create `src/app/home/page.tsx`:

```tsx
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/workspace/queries"
import { InitialsAvatar } from "@/components/initials-avatar"

export default async function HomePage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/home")

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userData.user.id)
    .single()

  const workspace = await getCurrentWorkspace()
  const youOnly = workspace?.members.length === 1

  return (
    <main className="min-h-screen px-6 py-8 sm:px-10 sm:py-10">
      <header className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground/80">
          Together
        </span>
        <form action="/api/signout" method="post">
          <button
            type="submit"
            className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="mt-16 sm:mt-20">
        <h1 className="font-serif text-5xl leading-[1.05] tracking-tight sm:text-6xl">
          Hello,{" "}
          <span className="italic text-primary">
            {profile?.display_name ?? "friend"}
          </span>
          .
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">{workspace?.name}</p>

        {workspace ? (
          <div className="mt-8 flex items-center gap-3">
            {workspace.members.map((m) => (
              <InitialsAvatar key={m.user_id} name={m.display_name} size="md" />
            ))}
            <span className="text-sm text-muted-foreground">
              {workspace.members.map((m) => m.display_name).join(" · ")}
            </span>
          </div>
        ) : null}

        {/* Invite card lands in Task 8. */}
        {youOnly ? (
          <div className="mt-10 rounded-lg border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">
              You're alone in this workspace. Invite-link UI lands in the next task.
            </p>
          </div>
        ) : null}

        <div className="mt-16 max-w-md">
          <p className="text-sm text-muted-foreground">
            Your trips will live here. Phase 3 brings the trip-creation flow.
          </p>
        </div>
      </section>
    </main>
  )
}
```

- [ ] **Step 5: Type-check and verify**

Run: `pnpm exec tsc --noEmit` — silent.

Restart dev. Sign in. Visit `/home`. Expected: page renders with your name in the italic pink, workspace name "Our trips" below, one circular initials avatar with your initials, the "alone" placeholder card, and the "trips will live here" line. Sign-out link in top-right works.

- [ ] **Step 6: Commit**

```bash
git add src/lib/initials.ts src/components/initials-avatar.tsx src/lib/workspace/queries.ts src/app/home/page.tsx
git commit -m "feat(home): /home placeholder dashboard + initials avatar"
```

---

## Task 8: Invite generation card on /home

**Files:**
- Create: `src/lib/workspace/actions.ts`
- Create: `src/components/invite-card.tsx`
- Modify: `src/app/home/page.tsx`

- [ ] **Step 1: generateInvite Server Action**

Create `src/lib/workspace/actions.ts`:

```ts
"use server"

import { randomBytes } from "node:crypto"

import { createClient } from "@/lib/supabase/server"

export interface InviteResult {
  url?: string
  error?: string
}

export async function generateInvite(): Promise<InviteResult> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return { error: "Not signed in" }

  // Find the user's workspace (MVP: one per user).
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userData.user.id)
    .limit(1)
    .single()

  if (!membership) return { error: "No workspace" }
  if (membership.role !== "owner") return { error: "Only the workspace owner can invite" }

  // Reuse an existing unused, unexpired invite if one exists.
  const { data: existing } = await supabase
    .from("invites")
    .select("token")
    .eq("workspace_id", membership.workspace_id)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle()

  const token = existing?.token ?? randomBytes(24).toString("base64url")

  if (!existing) {
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    const { error: insertError } = await supabase.from("invites").insert({
      workspace_id: membership.workspace_id,
      token,
      expires_at: expiresAt,
      created_by: userData.user.id,
    })
    if (insertError) return { error: insertError.message }
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  return { url: `${origin}/join/${token}` }
}
```

- [ ] **Step 2: Invite card component**

Create `src/components/invite-card.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"

import { generateInvite } from "@/lib/workspace/actions"
import { Button } from "@/components/ui/button"

export function InviteCard() {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()

  function onGenerate() {
    startTransition(async () => {
      const result = await generateInvite()
      if (result.error) {
        setError(result.error)
        setUrl(null)
        return
      }
      setError(null)
      setUrl(result.url ?? null)
      setCopied(false)
    })
  }

  async function onCopy() {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="font-serif text-2xl tracking-tight">Invite your partner</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Generate a one-time link. Send it however you want — they'll land directly in your workspace.
      </p>

      {url ? (
        <div className="mt-5 flex flex-col gap-2">
          <code className="block break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
            {url}
          </code>
          <div className="flex items-center justify-between">
            <Button type="button" onClick={onCopy} variant="outline">
              {copied ? "Copied" : "Copy link"}
            </Button>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Expires in 14 days · single use
            </span>
          </div>
        </div>
      ) : (
        <Button type="button" onClick={onGenerate} disabled={isPending} className="mt-5">
          {isPending ? "Generating…" : "Generate invite link"}
        </Button>
      )}

      {error ? (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: Wire the card into /home**

Modify `src/app/home/page.tsx`. Replace the entire `youOnly` block:

```tsx
        {youOnly ? (
          <div className="mt-10 rounded-lg border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">
              You're alone in this workspace. Invite-link UI lands in the next task.
            </p>
          </div>
        ) : null}
```

with:

```tsx
        {youOnly ? (
          <div className="mt-10">
            <InviteCard />
          </div>
        ) : null}
```

And at the top of the file, add to the existing imports:

```tsx
import { InviteCard } from "@/components/invite-card"
```

- [ ] **Step 4: Verify**

Run `pnpm exec tsc --noEmit` — silent.

Restart dev. Sign in. Visit `/home`. Click "Generate invite link." Expected: a URL appears in monospace, with a "Copy link" button. Click "Copy link" — expect the button text change to "Copied" briefly.

Verify the invite exists in Supabase: run `select count(*) from public.invites;` in the SQL Editor — should be 1.

Click "Generate invite link" again (refresh the page first since UI doesn't have a regenerate button). The *same* URL should appear — `select count(*) from invites` should still be 1 (we reuse the existing valid one).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace/actions.ts src/components/invite-card.tsx src/app/home/page.tsx
git commit -m "feat(invite): generateInvite Server Action + InviteCard on /home"
```

---

## Task 9: /join/[token] dispatcher

**Files:**
- Create: `src/lib/invites/preview.ts`
- Modify: `src/lib/workspace/actions.ts`
- Create: `src/app/join/[token]/page.tsx`

- [ ] **Step 1: Invite preview helper**

Create `src/lib/invites/preview.ts`:

```ts
import { createClient } from "@/lib/supabase/server"

export interface InvitePreview {
  workspaceName: string
  valid: boolean
}

export async function getInvitePreview(token: string): Promise<InvitePreview | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("get_invite_preview", { p_token: token })
  if (error || !data || data.length === 0) return null
  const row = data[0]!
  return { workspaceName: row.workspace_name, valid: row.valid }
}
```

- [ ] **Step 2: acceptInvite Server Action**

Append to `src/lib/workspace/actions.ts`:

```ts
export async function acceptInvite(token: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("accept_invite", { p_token: token })
  if (error) return { error: error.message }
  return {}
}
```

- [ ] **Step 3: The dispatcher page**

Create `src/app/join/[token]/page.tsx`:

```tsx
import Link from "next/link"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { acceptInvite } from "@/lib/workspace/actions"
import { getInvitePreview } from "@/lib/invites/preview"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const preview = await getInvitePreview(token)

  if (!preview) {
    return (
      <Shell>
        <h1 className="font-serif text-4xl tracking-tight">This invite doesn't exist.</h1>
        <Home />
      </Shell>
    )
  }

  if (!preview.valid) {
    return (
      <Shell>
        <h1 className="font-serif text-4xl tracking-tight">This invite has expired.</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Ask {preview.workspaceName ? `the owner of ${preview.workspaceName}` : "the inviter"} for a fresh link.
        </p>
        <Home />
      </Shell>
    )
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()

  if (userData.user) {
    const result = await acceptInvite(token)
    if (result.error) {
      return (
        <Shell>
          <h1 className="font-serif text-4xl tracking-tight">Can't join this workspace.</h1>
          <p className="mt-3 text-sm text-muted-foreground">{result.error}</p>
          <Home />
        </Shell>
      )
    }
    redirect("/home")
  }

  // Unauthenticated + valid token → sign-up/sign-in card.
  return (
    <Shell>
      <h1 className="font-serif text-4xl tracking-tight">
        You've been invited to join{" "}
        <span className="italic text-primary">{preview.workspaceName}</span>.
      </h1>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link href={`/signup?invite=${token}`} className={cn(buttonVariants({ size: "lg" }), "flex-1")}>
          Sign up
        </Link>
        <Link
          href={`/signin?invite=${token}`}
          className={cn(buttonVariants({ size: "lg", variant: "outline" }), "flex-1")}
        >
          Sign in
        </Link>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md text-center">{children}</div>
    </main>
  )
}

function Home() {
  return (
    <Link
      href="/"
      className="mt-8 inline-block font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground"
    >
      Go home
    </Link>
  )
}
```

- [ ] **Step 4: Verify**

Run `pnpm exec tsc --noEmit` — silent.

Restart dev. Sign in (as user A). Generate an invite on `/home`. Copy the URL.

Open the URL in a **private window** (no cookies → unauthenticated). Expected: card shows "You've been invited to join Our trips" with **Sign up** / **Sign in** buttons.

Click **Sign up**. Expected: signup form, with the small "You're joining a workspace you were invited to" line above. Fill in *different* email + name + password. Submit. Expected: redirected to `/home`, page shows you AND user A in the avatar list. Workspace name is "Our trips."

Back in the original signed-in window (user A), refresh `/home`. Expected: two avatars, both display names.

Verify in SQL Editor: `select count(*) from public.workspace_members;` → 2. `select used_at from public.invites;` → the row has `used_at` set.

- [ ] **Step 5: Test the expired-invite path**

In the SQL Editor, manually expire the invite:

```sql
update public.invites set expires_at = now() - interval '1 day' where used_at is null;
```

Generate a new invite as user A (now needed since the old one is "used" anyway). Then manually expire that one too. Visit the URL in a private window. Expected: "This invite has expired." page.

(Clean up: `delete from public.invites where used_at is null;` to keep DB tidy.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/invites/preview.ts src/lib/workspace/actions.ts src/app/join/[token]/page.tsx
git commit -m "feat(invite): /join/[token] dispatcher (unauthenticated + authenticated branches)"
```

---

## Task 10: /profile edit page

**Files:**
- Modify: `src/lib/auth/actions.ts`
- Create: `src/app/profile/page.tsx`

- [ ] **Step 1: updateProfile Server Action**

Append to `src/lib/auth/actions.ts`:

```ts
export async function updateProfile(formData: FormData) {
  const displayName = String(formData.get("display_name") ?? "").trim()
  if (!displayName) return { error: "Display name is required." }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return { error: "Not signed in" }

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", userData.user.id)

  if (error) return { error: error.message }
  redirect("/home")
}
```

- [ ] **Step 2: /profile page**

Create `src/app/profile/page.tsx`:

```tsx
import Link from "next/link"
import { redirect } from "next/navigation"

import { updateProfile } from "@/lib/auth/actions"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/profile")

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, created_at")
    .eq("id", userData.user.id)
    .single()

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-4xl tracking-tight">Your profile</h1>

        <form action={updateProfile} className="mt-8 flex flex-col gap-3">
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
                ? new Date(profile.created_at).toLocaleDateString()
                : "—"}
            </dd>
          </div>
        </dl>

        <Link
          href="/home"
          className="mt-10 inline-block font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground hover:text-foreground"
        >
          Back to home
        </Link>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Verify**

Run `pnpm exec tsc --noEmit` — silent.

Restart dev. Signed in, visit `/profile`. Expected: form with your current display name, email and "member since" shown below. Edit the name. Submit. Expected: redirect to `/home`, greeting updates immediately.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/actions.ts src/app/profile/page.tsx
git commit -m "feat(profile): /profile edit page + updateProfile Server Action"
```

---

## Task 11: Inline error messages on auth forms

**Files:**
- Modify: `src/lib/auth/actions.ts`
- Modify: `src/app/signin/page.tsx`
- Modify: `src/app/signup/page.tsx`

The Server Actions in Tasks 3 and 4 return `{ error }` objects but the pages don't render them. This task wires the error display.

- [ ] **Step 1: Change actions to use `useActionState` pattern**

In `src/lib/auth/actions.ts`, modify the signatures of `signUp` and `signIn` (NOT `updateProfile`) to take `_prevState` as their first arg and return `{ error?: string }`. Replace the existing `signUp` and `signIn` functions with:

```ts
export async function signUp(
  _prevState: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const displayName = String(formData.get("display_name") ?? "").trim()
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const inviteToken = String(formData.get("invite_token") ?? "") || null

  if (!displayName || !email || !password) {
    return { error: "All fields are required." }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
        ...(inviteToken ? { invite_token: inviteToken } : {}),
      },
    },
  })

  if (error) return { error: error.message }
  redirect("/home")
}

export async function signIn(
  _prevState: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const next = String(formData.get("next") ?? "/home")

  if (!email || !password) {
    return { error: "Email and password are required." }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) return { error: error.message }
  redirect(next)
}
```

- [ ] **Step 2: Make /signup a client-island form**

Split `src/app/signup/page.tsx`: keep the page as a Server Component for layout, but extract the form into a Client Component that uses `useActionState`.

Replace `src/app/signup/page.tsx` with:

```tsx
import Link from "next/link"

import { SignUpForm } from "./signup-form"

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>
}) {
  const { invite } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-5xl leading-[1] tracking-tight">
          Make space <span className="italic text-primary">for two</span>.
        </h1>

        {invite ? (
          <p className="mt-4 text-sm text-muted-foreground">
            You're joining a workspace you were invited to.
          </p>
        ) : null}

        <SignUpForm invite={invite} />

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={invite ? `/signin?invite=${invite}` : "/signin"}
            className="text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
```

Create `src/app/signup/signup-form.tsx`:

```tsx
"use client"

import { useActionState } from "react"

import { signUp } from "@/lib/auth/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function SignUpForm({ invite }: { invite?: string }) {
  const [state, formAction, isPending] = useActionState(signUp, null)

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      {invite ? <input type="hidden" name="invite_token" value={invite} /> : null}
      <Input name="display_name" placeholder="Your name" required />
      <Input name="email" type="email" placeholder="Email" required />
      <Input
        name="password"
        type="password"
        placeholder="Password (min 8)"
        minLength={8}
        required
      />
      <Button type="submit" size="lg" className="mt-2" disabled={isPending}>
        {isPending ? "Creating account…" : "Sign up"}
      </Button>
      {state?.error ? (
        <p className="mt-1 text-sm text-destructive">{state.error}</p>
      ) : null}
    </form>
  )
}
```

- [ ] **Step 3: Make /signin a client-island form**

Replace `src/app/signin/page.tsx`:

```tsx
import Link from "next/link"

import { SignInForm } from "./signin-form"

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; invite?: string }>
}) {
  const { next, invite } = await searchParams
  const nextPath = next ?? (invite ? `/join/${invite}` : "/home")

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-5xl leading-[1] tracking-tight">
          Welcome <span className="italic text-primary">back</span>.
        </h1>

        <SignInForm nextPath={nextPath} />

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link
            href={invite ? `/signup?invite=${invite}` : "/signup"}
            className="text-foreground underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </div>
    </main>
  )
}
```

Create `src/app/signin/signin-form.tsx`:

```tsx
"use client"

import { useActionState } from "react"

import { signIn } from "@/lib/auth/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function SignInForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, isPending] = useActionState(signIn, null)

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="next" value={nextPath} />
      <Input name="email" type="email" placeholder="Email" required />
      <Input name="password" type="password" placeholder="Password" required />
      <Button type="submit" size="lg" className="mt-2" disabled={isPending}>
        {isPending ? "Signing in…" : "Sign in"}
      </Button>
      {state?.error ? (
        <p className="mt-1 text-sm text-destructive">{state.error}</p>
      ) : null}
    </form>
  )
}
```

- [ ] **Step 4: Verify**

Run `pnpm exec tsc --noEmit` — silent.

Restart dev. Visit `/signin` (signed out). Submit with empty fields → expect "Email and password are required." inline.

Submit with valid email but wrong password → expect Supabase's error message inline (something like "Invalid login credentials").

Submit valid credentials → expect redirect to `/home`.

Visit `/signup` and try an email that already has an account → expect Supabase's "User already registered" error inline.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/actions.ts src/app/signin/page.tsx src/app/signin/signin-form.tsx src/app/signup/page.tsx src/app/signup/signup-form.tsx
git commit -m "feat(auth): inline error messages on sign-in and sign-up via useActionState"
```

---

## Task 12: End-to-end manual test + deploy

**Files:**
- Modify: `docs/TODO.md`

- [ ] **Step 1: Disable Supabase email confirmation**

In the Supabase Dashboard → **Authentication** → **Providers** → **Email**:

- Turn **Confirm email** to **off**.

Click **Save**.

- [ ] **Step 2: Local end-to-end run**

In a private window, do the full first-user flow:
1. Visit `/signup`. Sign up as user A (`a@example.com`, name "Alex").
2. Land on `/home`. Confirm greeting + workspace name + single avatar + invite card.
3. Click "Generate invite link." Copy the URL.
4. Open the invite URL in a *second* private window. Confirm the invite card with workspace name.
5. Click **Sign up** in that second window. Sign up as user B (`b@example.com`, name "Bea").
6. Land on `/home`. Confirm two avatars (Alex + Bea), workspace name "Our trips."
7. Refresh user A's window. Confirm Alex now also sees both avatars.
8. Sign out as user A. Sign in again. Confirm redirected to `/home` and state is the same.
9. Visit `/profile`. Change display name to "Alex W." Save. Confirm `/home` greeting updates.
10. From user B's window, sign out. Try to visit `/home` directly. Confirm redirect to `/signin?next=/home`.

If anything fails: stop, root-cause, fix, re-run from step 1.

- [ ] **Step 3: Production end-to-end run**

```bash
git push origin main
```

Wait for Vercel to redeploy. Visit https://project-template-couples.vercel.app/signup. Repeat the same flow as Step 2 (you can re-use users by deleting them in Supabase Dashboard → Authentication → Users, then signing up again).

Confirm the production deploy renders the same warm palette, fonts, and full flow works end-to-end.

- [ ] **Step 4: Update project docs**

Replace the Phase 2 section in `docs/TODO.md`. Find:

```markdown
## Phase 2 — Auth + Pairing (next up)
- Email/password sign-up + log in (Supabase Auth)
- `workspaces` table with members + roles (RLS on)
- Invite flow: one member sends a link, the other joins the workspace
- Basic profile (name, avatar)
```

Replace with:

```markdown
## Phase 2 — Auth + Pairing: COMPLETE 2026-05-25
- ~~Email/password sign-up + log in (Supabase Auth)~~ Done.
- ~~`workspaces` table with members + roles (RLS on)~~ Done.
- ~~Invite flow: one member sends a link, the other joins the workspace~~ Done — single-use 14-day shareable link.
- ~~Basic profile (name, avatar)~~ Done — name editable; avatar is initials only (image upload deferred).

Implementation followed `docs/superpowers/specs/2026-05-25-phase-2-auth-pairing-design.md` and `docs/superpowers/plans/2026-05-25-phase-2-auth-pairing.md`.
```

Also add one row to `docs/DECISIONS.md`:

```markdown
| Disabled Supabase **Confirm email** | MVP for two trusted users. Re-enable + ship password-reset before any wider exposure. | 2026-05-25 |
```

Commit:

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: mark Phase 2 complete; log email-confirmation-off decision"
git push origin main
```

---

## Self-Review Notes

**Spec coverage:**
- Decisions 1–4 → captured in plan header context.
- Data Model (4 tables, 5 functions, RLS) → Task 1.
- Migration application → Task 2.
- Sign-up flow → Tasks 3, 11.
- Sign-in flow → Tasks 4, 11.
- Sign-out → Task 5.
- Proxy gating → Task 6.
- /home placeholder + initials avatar → Task 7.
- Invite creation → Task 8.
- /join/[token] dispatch (both branches) → Task 9.
- /profile edit → Task 10.
- Inline error messages (from page sketches) → Task 11.
- End-to-end manual test + Vercel deploy → Task 12.

**Out-of-scope items from the spec** are *not* implemented and are not present in any task (password reset, email change, account deletion, leave-workspace UI, member removal, workspace rename UI, image avatar upload, OAuth, app-sent emails, workspace switcher).
