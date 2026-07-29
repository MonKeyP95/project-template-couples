# One-Screen Join Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the invite flow to a single screen, and make `accept_invite` resolve the already-in-a-workspace collision instead of refusing.

**Architecture:** `/join/[token]` embeds the existing `SignUpForm` with the token, removing the `/signup?invite=` hop. The `accept_invite` RPC gains three branches: idempotent success when already in the invited workspace, silent leave-and-join when the caller's own workspace is empty, and an explanatory error when it holds data.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase Postgres (plpgsql, SECURITY DEFINER).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-one-screen-join-design.md`.
- No test suite. Verification is `pnpm lint`, `pnpm exec tsc --noEmit`, and reasoning through the data path.
- Do not run `pnpm build` while `pnpm dev` is running.
- **Migrations are applied by hand** — committing the SQL file does nothing to the database. The user pastes it into the Supabase SQL editor.
- Every migration must be safe to run more than once.
- No emojis. Sparse comments.

---

### Task 1: `accept_invite` resolves the collision

**Files:**
- Create: `supabase/migrations/20260729000001_accept_invite_leaves_empty_workspace.sql`

**Interfaces:**
- Produces: `public.accept_invite(text) returns uuid`, same signature as before. Callers unchanged.

- [ ] **Step 1: Write the migration**

Idempotent by construction — `create or replace` plus `grant`, no `drop`.

```sql
-- Replaces accept_invite so an invitee who already has an empty workspace of
-- their own can still join. Safe to run repeatedly.

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
  v_empty boolean;
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

  select workspace_id into v_existing
  from public.workspace_members
  where user_id = v_user_id
  limit 1;

  -- Already a member of the invited workspace: idempotent success, so a
  -- double-click or a re-opened link is harmless.
  if v_existing = v_workspace_id then
    return v_workspace_id;
  end if;

  if v_existing is not null then
    select
      not exists (
        select 1 from public.workspace_members m
        where m.workspace_id = v_existing and m.user_id <> v_user_id
      )
      and not exists (
        select 1 from public.trips t where t.workspace_id = v_existing
      )
      and not exists (
        select 1 from public.checklists c where c.workspace_id = v_existing
      )
    into v_empty;

    if not v_empty then
      raise exception 'Your workspace has trips in it. Ask the person who invited you to join yours instead.';
    end if;

    delete from public.workspace_members
    where user_id = v_user_id and workspace_id = v_existing;

    -- Guarded again: cannot delete a workspace that holds anything.
    delete from public.workspaces w
    where w.id = v_existing
      and not exists (
        select 1 from public.workspace_members m where m.workspace_id = w.id
      )
      and not exists (
        select 1 from public.trips t where t.workspace_id = w.id
      )
      and not exists (
        select 1 from public.checklists c where c.workspace_id = w.id
      );
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'member');

  update public.invites set used_at = now() where token = p_token;

  return v_workspace_id;
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;
```

Note the invite lookup now runs *before* the membership check, so a dead token
reports "Invalid or expired invite" rather than a confusing workspace error.

- [ ] **Step 2: Hand it to the user**

This file changes nothing until it is pasted into the Supabase SQL editor and
run. Tell the user explicitly, with the path.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260729000001_accept_invite_leaves_empty_workspace.sql
git commit -m "feat(invites): accept_invite leaves an empty workspace instead of refusing"
```

---

### Task 2: One-screen join

**Files:**
- Modify: `src/app/signup/signup-form.tsx`
- Modify: `src/app/join/[token]/page.tsx`

**Interfaces:**
- Consumes: `SignUpForm({ invite?: string })` from Task 2 Step 1, extended.
- Produces: `SignUpForm({ invite?: string, submitLabel?: string })`.

- [ ] **Step 1: Give `SignUpForm` a label prop**

Default preserves `/signup` exactly as it is today.

```tsx
export function SignUpForm({
  invite,
  submitLabel = "create account",
}: {
  invite?: string
  submitLabel?: string
}) {
```

And in the button:

```tsx
        {isPending ? "joining…" : submitLabel}
```

Replace the whole ternary — the pending text was `"creating account…"`, which
reads wrong under a **join** button. `"joining…"` is right for both callers.

- [ ] **Step 2: Put the form on the join page**

In `src/app/join/[token]/page.tsx`, replace the two-button block in the
unauthenticated branch:

```tsx
  return (
    <Shell>
      <h1 className="font-serif text-4xl tracking-tight">
        You&apos;ve been invited to join{" "}
        <span className="italic text-primary">{preview.workspaceName}</span>.
      </h1>
      <div className="mt-8 text-left">
        <SignUpForm invite={token} submitLabel="join" />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={`/signin?invite=${token}`}
          className="text-foreground underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </Shell>
  )
```

`Shell` centres its text; the wrapper restores left alignment for the labelled
fields.

- [ ] **Step 3: Fix the imports**

Add `import { SignUpForm } from "@/app/signup/signup-form"`. Remove the now-unused
`buttonVariants` and `cn` imports — nothing else on the page uses them.

- [ ] **Step 4: Verify**

Run: `pnpm exec tsc --noEmit` then `pnpm lint`
Expected: both clean. An unused-import error here means Step 3 was missed.

Reason through the path: the join page renders `SignUpForm` with the token ->
hidden `invite_token` field -> `signUp` puts it in user metadata ->
`handle_new_user` reads it and joins the invited workspace. Identical to the
old `/signup?invite=` path; only the page it renders on changed.

- [ ] **Step 5: Commit**

```bash
git add src/app/signup/signup-form.tsx "src/app/join/[token]/page.tsx"
git commit -m "feat(invites): join in one screen"
```

---

### Task 3: Docs

- [ ] **Step 1: TODO + DECISIONS**

TODO entry marked *implemented, unverified in-app*, carrying the spec's in-app
checklist and flagging that the migration needs pasting. DECISIONS row: why the
collision is resolved inside `accept_invite` rather than by a leave-workspace
button, and why signup auto-creation was left alone (50 call sites).

- [ ] **Step 2: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record the one-screen join"
```

---

## Self-Review

**Spec coverage:** spec section 1 -> Task 2; section 2 -> Task 1; section 3 is
behaviour that falls out of Task 1 with no code change, since the join page
already prints `result.error`.

**Type consistency:** `submitLabel` is the prop name in both its definition and
its one caller. `accept_invite(text) returns uuid` is unchanged, so
`acceptInvite` in `src/lib/workspace/actions.ts` needs no edit.

**Ordering:** Task 2 works against the old function too — it just keeps the old
dead end until the migration is pasted. No hard dependency between tasks.
