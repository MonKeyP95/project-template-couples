# New-workspace flow Implementation Plan

**Goal:** Creating a workspace becomes the act of saying who is in it — name it, then name the travellers who have no account — instead of a bare name field in a popover.

**Architecture:** A stepped page at `/workspaces/new` mirroring `/trips/new` (server page for the auth guard and chrome, client form for the steps). One Server Action creates the workspace via the existing `create_workspace` RPC, switches the cookie to it, and inserts a `workspace_people` row per traveller. The partner-with-an-account path needs nothing new: a fresh workspace is `youOnly && noTripsYet`, so `/home` already renders `InviteCard`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Supabase, Tailwind v4.

## Global Constraints

- No test framework. Validate with `pnpm build`, `pnpm lint`, `pnpm exec tsc --noEmit`.
- Never `pnpm build` while `pnpm dev` runs.
- No migration needed — `create_workspace` and `workspace_people` both already exist and are applied.
- No emojis; sparse comments; short functions.
- Do not claim UI-side behaviour is verified.

## Scope

**In:** the create flow, and the switcher linking to it.
**Out, deliberately:** adding people to an *existing* workspace (the user's "later": invite a friend, add kids), and promoting an avatar to a member (B2, needs `invites.person_id`).

**Known limitation to carry:** an avatar and an invite are separate acts. Adding "Mom" as a traveller *and* later inviting her by link yields two entries with her expenses stranded on the first. Decide per person: avatar or invite, never both. B2 removes this.

---

### Task 1: The create action

**Files:**
- Modify: `src/lib/workspace/actions.ts`

**Interfaces:**
- Produces: `createWorkspaceWithPeople(input: { name: string; travellers: string[] }): Promise<{ error?: string }>`
- Removes: `createWorkspace(formData)` — its only caller is the switcher's inline field, which becomes a link in Task 3.

**Why an error shape rather than a throw:** the stepped form displays errors inline and navigates itself, matching `NewTripForm`, which calls its action and then `router.push`.

- [ ] **Step 1: Replace the action**

```ts
export interface CreateWorkspaceInput {
  name: string
  /** Travellers with no account. Blank entries are ignored. */
  travellers: string[]
}

/** Creates a workspace, makes the caller its owner, switches to it, and adds
 * any travellers who have no account. The invite path is separate: a new
 * workspace is solo and empty, so /home offers the invite link. */
export async function createWorkspaceWithPeople(
  input: CreateWorkspaceInput,
): Promise<{ error?: string }> {
  const name = input.name.trim()
  if (!name) return { error: "Name this workspace." }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_workspace", {
    p_name: name,
  })
  if (error) return { error: error.message }

  const workspaceId = data as string
  await setActiveWorkspace(workspaceId)

  const travellers = input.travellers
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  if (travellers.length > 0) {
    const { error: peopleError } = await supabase
      .from("workspace_people")
      .insert(
        travellers.map((display_name) => ({
          workspace_id: workspaceId,
          display_name,
        })),
      )
    if (peopleError) return { error: peopleError.message }
  }

  revalidatePath("/home")
  return {}
}
```

Delete the old `createWorkspace(formData)` export.

- [ ] **Step 2: Reason through RLS**

`workspace_people_insert` requires `is_workspace_member(workspace_id)`. `create_workspace` inserts the caller as `owner` before returning, so by the time the people insert runs the check passes. The cookie is set first only so a failed people-insert still leaves you in the workspace that was genuinely created.

- [ ] **Step 3: Build and lint, then commit**

```bash
git add src/lib/workspace/actions.ts
git commit -m "feat(workspace): create a workspace with its travellers"
```

---

### Task 2: The stepped page

**Files:**
- Create: `src/app/workspaces/new/page.tsx`
- Create: `src/app/workspaces/new/new-workspace-form.tsx`

**Interfaces:**
- Consumes: `createWorkspaceWithPeople` (Task 1), `StepShell` from `@/app/trips/profile-fields`.
- Produces: the route `/workspaces/new`.

**Why not reuse `ProfileWalkthrough`:** it has trip-profile steps built into it. A three-step local stepper over `StepShell` is smaller than bending it.

- [ ] **Step 1: The server page**, mirroring `/trips/new` chrome

```tsx
import Link from "next/link"
import { redirect } from "next/navigation"

import { Label } from "@/components/together"
import { createClient } from "@/lib/supabase/server"

import { NewWorkspaceForm } from "./new-workspace-form"

export default async function NewWorkspacePage() {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) redirect("/signin?next=/workspaces/new")

  return (
    <main className="mx-auto min-h-screen w-full max-w-[440px] px-5 pt-10 pb-20">
      <Link
        href="/home"
        className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden>‹</span>
        <span>home</span>
      </Link>
      <Label className="mt-6">Together · New workspace</Label>
      <hr className="mt-3 border-rule" />
      <NewWorkspaceForm />
    </main>
  )
}
```

- [ ] **Step 2: The client form** — three steps, local state, one submit. Full code in the implementation; shape is: `step` 0/1/2, `name`, `travellers: string[]`, `error`, `isPending`. Step 0 names it (next disabled while blank), step 1 collects traveller names with add/remove, step 2 reviews and creates, then `router.push("/home")`.

- [ ] **Step 3: Build and lint, then commit**

---

### Task 3: The switcher links to the flow

**Files:**
- Modify: `src/components/workspace-switcher.tsx`

- [ ] **Step 1:** Replace the inline `createWorkspace` form with a link to `/workspaces/new` styled like the switch rows. This also removes the text input from a 210px popover, which is what made the menu feel cluttered.

- [ ] **Step 2: Build and lint, then commit**

---

### Task 4: Documentation

- [ ] Update `docs/TODO.md` (implemented, unverified in app) and add a `docs/DECISIONS.md` row on why creation carries its people and why the invite path reuses `InviteCard`.

## Done means

**Verified by Claude:** build, lint, and typecheck clean; no `createWorkspace(` references remain; the action inserts one person row per non-blank traveller.

**Verified by the user in-app:**

1. The Workspaces menu offers "New workspace" as a link, with no text field in the popover.
2. `/workspaces/new` steps: name, travellers, review.
3. Creating with two travellers lands you in the new, empty workspace.
4. Those travellers appear in the rail's people list.
5. They appear in the payer picker on a trip created there.
6. Home in that new workspace offers the invite link for a partner who wants a login.
7. The couple workspace is untouched.
