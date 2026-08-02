# Avatar travellers, part 1: money (Slice B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workspace hold travellers who have no account, so a partner can record expenses paid by her mom and savings put aside by her mom without mom ever signing in.

**Architecture:** A `workspace_people` table where each row is a traveller and `user_id` is nullable. The two money columns that name a *subject* — `expenses.paid_by` and `trip_savings_contributions.user_id` — stop referencing `auth.users` and reference `workspace_people` instead, with a one-time data migration converting existing user ids to person ids. The UI barely changes: every picker already consumes an opaque `Record<string, MemberToneEntry>` keyed by whatever `paid_by` holds, and that record is built in exactly one function.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Supabase (`@supabase/ssr`), Tailwind v4.

## Global Constraints

- No test framework exists in this repo. **Do not invent one.** Each task validates with `pnpm build`, `pnpm lint`, and reasoning about the data path.
- **Never run `pnpm build` while `pnpm dev` is running** — they share `.next/`.
- Migrations are applied **by hand** in the Supabase SQL editor and must be **re-runnable**.
- Local dev and Vercel prod share **one** Supabase project.
- No emojis. Sparse comments — WHY, not WHAT. Short functions.
- Do not claim anything behind the UI is verified.

## Correction to the spec, and why

The spec's backfill said to give each person row `id = user_id` so no data migration is needed. **That was written before Slice A shipped and is now unsound:** a user belonging to two workspaces needs a person row in each, and only one of them can carry `id = user_id` before colliding on the primary key. This plan uses fresh uuids and migrates the two columns instead. The migration is self-limiting — it joins on `wp.user_id = <column>`, and after one pass the column holds person ids, which match no `user_id` — so it stays re-runnable.

## Sequencing constraint, important

B1 does **not** include invite-targeting. Until B2 lands, a plain invite accepted by someone who already exists as an avatar creates a *second* person row and leaves her avatar history on the old one. This is safe only because the premise of the feature is that mom has no account and is not signing up yet. **Do not invite an avatar to become a member until B2 ships.**

---

### Task 1: Migration — `workspace_people`, data migration, FK repoint

**Files:**
- Create: `supabase/migrations/20260802000002_workspace_people.sql`

**Interfaces:**
- Produces: table `public.workspace_people (id, workspace_id, display_name, user_id, created_at)`; `expenses.paid_by` and `trip_savings_contributions.user_id` referencing it; a trigger keeping member rows and person rows in step.

**Order matters, and the obvious order is wrong.** Create and backfill the table, **drop the old foreign keys**, migrate the data, *then* add the new ones. Leaving the old FKs in place during the update fails with `violates foreign key constraint "expenses_paid_by_fkey" … not present in table "users"` — the column still points at `auth.users`, so every person id written is checked against `users` and rejected. Adding the new FKs before the data migration fails symmetrically. The drop must bracket the update on one side and the add on the other.

- [ ] **Step 1: Write the migration**

```sql
-- Travellers who are not users. A person row is a subject that can hold money;
-- workspace_members stays the auth/permission backbone. Safe to run repeatedly.

create table if not exists public.workspace_people (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  user_id      uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists workspace_people_workspace_idx
  on public.workspace_people (workspace_id);

-- One person row per member per workspace. Partial, because avatars share the
-- null user_id and must not collide with each other.
create unique index if not exists workspace_people_user_idx
  on public.workspace_people (workspace_id, user_id)
  where user_id is not null;

-- Backfill: every existing member becomes a person. Fresh uuids, so a user in
-- two workspaces gets one row per workspace.
insert into public.workspace_people (workspace_id, display_name, user_id)
select wm.workspace_id, coalesce(p.display_name, 'Member'), wm.user_id
from public.workspace_members wm
left join public.profiles p on p.id = wm.user_id
on conflict do nothing;

-- Data migration: rewrite the two subject columns from user ids to person ids.
-- Self-limiting — after one pass these hold person ids, which match no user_id.
update public.expenses e
set paid_by = wp.id
from public.trips t
join public.workspace_people wp on wp.workspace_id = t.workspace_id
where e.trip_id = t.id and wp.user_id = e.paid_by;

update public.trip_savings_contributions s
set user_id = wp.id
from public.trips t
join public.workspace_people wp on wp.workspace_id = t.workspace_id
where s.trip_id = t.id and wp.user_id = s.user_id;

-- Repoint the foreign keys, now that no row references auth.users.
alter table public.expenses drop constraint if exists expenses_paid_by_fkey;
alter table public.expenses
  add constraint expenses_paid_by_fkey
  foreign key (paid_by) references public.workspace_people(id) on delete restrict;

alter table public.trip_savings_contributions
  drop constraint if exists trip_savings_contributions_user_id_fkey;
alter table public.trip_savings_contributions
  add constraint trip_savings_contributions_user_id_fkey
  foreign key (user_id) references public.workspace_people(id) on delete restrict;

-- RLS: people are readable and writable by workspace members.
alter table public.workspace_people enable row level security;

drop policy if exists workspace_people_select on public.workspace_people;
create policy workspace_people_select on public.workspace_people
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_people_insert on public.workspace_people;
create policy workspace_people_insert on public.workspace_people
  for insert to authenticated with check (public.is_workspace_member(workspace_id));

drop policy if exists workspace_people_update on public.workspace_people;
create policy workspace_people_update on public.workspace_people
  for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists workspace_people_delete on public.workspace_people;
create policy workspace_people_delete on public.workspace_people
  for delete to authenticated using (public.is_workspace_member(workspace_id));

-- The two subject policies were identical in shape: a join to workspace_members
-- proving the subject belongs to the trip's workspace. Both now join people, so
-- an avatar counts as a subject.
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    public.is_trip_workspace_member(trip_id)
    and exists (
      select 1
      from public.trips t
      join public.workspace_people wp on wp.workspace_id = t.workspace_id
      where t.id = trip_id and wp.id = paid_by
    )
  );

drop policy if exists savings_insert on public.trip_savings_contributions;
create policy savings_insert on public.trip_savings_contributions
  for insert to authenticated
  with check (
    public.is_trip_workspace_member(trip_id)
    and exists (
      select 1
      from public.trips t
      join public.workspace_people wp on wp.workspace_id = t.workspace_id
      where t.id = trip_id and wp.id = user_id
    )
  );

-- A new member gets a person row automatically, so signup and invite-accept
-- need no application changes.
create or replace function public.handle_new_workspace_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_people (workspace_id, display_name, user_id)
  values (
    new.workspace_id,
    coalesce(
      (select display_name from public.profiles where id = new.user_id),
      'Member'
    ),
    new.user_id
  )
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_workspace_member_created on public.workspace_members;
create trigger on_workspace_member_created
  after insert on public.workspace_members
  for each row execute function public.handle_new_workspace_member();
```

- [ ] **Step 2: Verify re-runnability by inspection**

`create table if not exists`, `create index if not exists`, `insert ... on conflict do nothing`, self-limiting updates, `drop constraint if exists` before each add, `drop policy if exists` before each create, `create or replace function`, `drop trigger if exists` before create. Nothing here fails on a second paste.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260802000002_workspace_people.sql
git commit -m "feat(people): workspace_people and repointed money columns"
```

- [ ] **Step 4: Hand the SQL to the user**

Tell the user to paste it into the Supabase SQL editor. **The app breaks until this is applied** — `paid_by` values will not match any person row, so payer names render as unknown. Because dev and prod share one Supabase project, this single paste affects the deployed app immediately, before the matching code is pushed. Tell them to apply it and then reload locally.

---

### Task 2: People in the query layer

**Files:**
- Modify: `src/lib/workspace/queries.ts`

**Interfaces:**
- Consumes: `resolveActiveMembership()` from Slice A.
- Produces: on `CurrentWorkspace`, two new fields —
  `people: WorkspacePerson[]` where `WorkspacePerson = { id: string; display_name: string; user_id: string | null }`, and
  `myPersonId: string | null`.
- `members` is unchanged and still means "accounts that can sign in".

**Why `myPersonId`:** the trap named in the spec. Code comparing an id to the signed-in user's id must now compare to their *person* id, or it silently misidentifies avatars.

- [ ] **Step 1: Add the type and fields**

In `src/lib/workspace/queries.ts`, add to the interfaces:

```ts
export interface WorkspacePerson {
  id: string
  display_name: string
  /** null for an avatar: a traveller with no account. */
  user_id: string | null
}
```

and add these two fields to `CurrentWorkspace`:

```ts
  /** Everyone who can hold money on a trip: members plus avatars. */
  people: WorkspacePerson[]
  /** The signed-in user's person id. Compare ids against this, never auth uid. */
  myPersonId: string | null
```

- [ ] **Step 2: Fetch them in `getCurrentWorkspace`**

After the `profilesData` block and before the `return`, add:

```ts
  const { data: peopleRows } = await supabase
    .from("workspace_people")
    .select("id, display_name, user_id")
    .eq("workspace_id", membership.workspaceId)
    .order("created_at", { ascending: true })

  const people: WorkspacePerson[] = (peopleRows ?? []).map((p) => ({
    id: p.id,
    display_name: p.display_name,
    user_id: p.user_id,
  }))
```

The signed-in user is needed to resolve `myPersonId`:

```ts
  const { data: userData } = await supabase.auth.getUser()
  const myPersonId =
    people.find((p) => p.user_id === userData.user?.id)?.id ?? null
```

Then add both to the returned object:

```ts
    people,
    myPersonId,
```

- [ ] **Step 3: Build and lint**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: both clean. Confirm `pnpm dev` is not running before any `pnpm build`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workspace/queries.ts
git commit -m "feat(people): expose workspace people and myPersonId"
```

---

### Task 3: Point the trip UI at people

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx:138-152` (`memberToneMap`)

**Interfaces:**
- Consumes: `CurrentWorkspace.people` (Task 2).
- Produces: nothing new — the same `Record<string, MemberToneEntry>` shape, keyed by person id instead of user id.

**Why this one function is the whole UI change:** every consumer — the payer picker in `expense-fields.tsx`, `ledger-row.tsx:112`, `budget-tab.tsx`, `budget-figures.tsx`, `budget-ledger.tsx`, `event-expense.tsx` — receives this record and looks ids up in it. None of them cares what the ids mean. `memberToneMap` is constructed in exactly one place (`page.tsx:193`).

- [ ] **Step 1: Map over people**

Replace the function body:

```tsx
function memberToneMap(
  workspace: CurrentWorkspace,
): Record<string, MemberToneEntry> {
  const map: Record<string, MemberToneEntry> = {}
  for (const p of workspace.people) {
    const initial = (p.display_name ?? "?").trim().charAt(0).toUpperCase()
    map[p.id] = {
      initial,
      displayName: p.display_name,
      // The signed-in user reads as "sea"; everyone else, member or avatar,
      // as "clay". Previously keyed off the workspace owner, which said
      // nothing useful once a workspace can hold people who never sign in.
      tone: p.id === workspace.myPersonId ? "sea" : "clay",
    }
  }
  return map
}
```

- [ ] **Step 2: Reason through the read path**

An expense row's `paidBy` is now a person id; `memberTones[paidBy]` finds the person row and renders their name and initial. An expense paid by an avatar renders her name identically to a member's. Confirm by reading `ledger-row.tsx:112` that nothing else is consulted.

- [ ] **Step 3: Build and lint**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add "src/app/trips/[slug]/page.tsx"
git commit -m "feat(people): key the trip UI on person ids"
```

---

### Task 4: Settle-up and savings count people, not members

**Files:**
- Modify: `src/app/trips/[slug]/page.tsx:194`

**Interfaces:**
- Consumes: `CurrentWorkspace.people` (Task 2).
- Produces: nothing new.

**Why one line:** `memberIds` feeds both `getTripSavings(header.id, memberIds)` and `summarizeBudget(expenses, memberIds)`. `summarizeBudget` is already generic over opaque ids (`expense-types.ts:64-72` builds `Record<string, number>` from whatever it is handed), so widening the input to people is the entire change.

- [ ] **Step 1: Build the id list from people**

```ts
  const memberIds = workspace.people.map((p) => p.id)
```

- [ ] **Step 2: Reason through the balance**

A workspace with one member and one avatar has exactly two people, so the two-member branch runs and "mom owes you" computes as it would between two accounts. **Known limit, unchanged from before:** the balance is documented as `Always 0 for trips with !=2 members`, so adding an avatar to the two-person couple workspace makes three people and zeroes the settle-up figure there. Do not add an avatar to the couple workspace expecting settle-up to keep working; that is what the separate workspace is for.

- [ ] **Step 3: Build and lint**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add "src/app/trips/[slug]/page.tsx"
git commit -m "feat(people): settle-up and savings include avatars"
```

---

### Task 5: Write paths stop defaulting to an auth uid

**Files:**
- Modify: `src/lib/trips/actions.ts:3300-3308` (savings insert)
- Modify: `src/app/trips/[slug]/page.tsx:328,336,368` and `src/app/on-the-road/page.tsx:228` (prop source)
- Modify: `src/app/trips/[slug]/budget-tab.tsx`, `src/app/trips/[slug]/budget-figures.tsx`, `src/app/on-the-road/quick-expense.tsx` (prop rename)

**Interfaces:**
- Consumes: `CurrentWorkspace.myPersonId` (Task 2).
- Produces: `personIdForTrip(supabase, tripId, userId): Promise<string | null>` in `actions.ts`.

**The bug this prevents:** `logSavingsContribution` writes `input.userId ?? userData.user.id` — an auth uid into a column that now holds person ids. It would violate the new foreign key at best, and mis-attribute at worst. The client-side default `paidBy: currentUserId` in `quick-expense.tsx:79` has the same defect.

**Rename rather than reassign:** the props are renamed `currentUserId` -> `currentPersonId` instead of quietly passing a person id into a prop named for a user. This is the trap the spec names — for the couple both ids used to be interchangeable, so a wrong value would work for them and break only for avatars. The rename makes it impossible to pass the wrong one without noticing.

- [ ] **Step 1: Add the resolver to `actions.ts`**

```ts
/** The caller's person row in the trip's workspace. Savings and expenses name
 * a person, not an account, so a bare auth uid is no longer a valid subject. */
async function personIdForTrip(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tripId: string,
  userId: string,
): Promise<string | null> {
  const { data: trip } = await supabase
    .from("trips")
    .select("workspace_id")
    .eq("id", tripId)
    .maybeSingle()
  if (!trip) return null

  const { data: person } = await supabase
    .from("workspace_people")
    .select("id")
    .eq("workspace_id", trip.workspace_id)
    .eq("user_id", userId)
    .maybeSingle()
  return person?.id ?? null
}
```

- [ ] **Step 2: Use it in the savings insert**

Replace the insert block at `actions.ts:3304-3308`:

```ts
  const subjectId =
    input.userId ?? (await personIdForTrip(supabase, input.tripId, userData.user.id))
  if (!subjectId) return { error: "No person to credit." }

  const { error } = await supabase.from("trip_savings_contributions").insert({
    trip_id: input.tripId,
    user_id: subjectId,
    amount_cents: input.amountCents,
  })
```

- [ ] **Step 3: Rename the prop in the two client components**

In `src/app/on-the-road/quick-expense.tsx`, rename the prop `currentUserId` to `currentPersonId` (its interface field at line 20, the destructure at line 32, and the use at line 79 where it becomes `paidBy: currentPersonId`).

In `src/app/trips/[slug]/budget-tab.tsx` and `src/app/trips/[slug]/budget-figures.tsx`, rename every `currentUserId` occurrence to `currentPersonId`. These are pure pass-throughs and one comparison — `isSelf={userId === currentPersonId}` at `budget-figures.tsx:352`, which is exactly the comparison that had to move off auth uids.

- [ ] **Step 4: Pass the person id from the two pages**

In `src/app/trips/[slug]/page.tsx`, change all three occurrences of `currentUserId={userData.user.id}` (lines 328, 336, 368) to:

```tsx
              currentPersonId={workspace.myPersonId ?? ""}
```

In `src/app/on-the-road/page.tsx:228`, make the same change. The `?? ""` is deliberate: an empty string matches no person, so a user with no person row gets "not me" everywhere rather than being mistaken for someone.

- [ ] **Step 5: Verify nothing still passes an auth uid to a subject**

Run: `grep -rn "currentUserId" src/`
Expected: no results.

- [ ] **Step 6: Build and lint**

Run: `pnpm lint && pnpm exec tsc --noEmit`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/trips/actions.ts "src/app/trips/[slug]/page.tsx" "src/app/trips/[slug]/budget-tab.tsx" "src/app/trips/[slug]/budget-figures.tsx" src/app/on-the-road/page.tsx src/app/on-the-road/quick-expense.tsx
git commit -m "feat(people): subjects are person ids, never auth uids"
```

---

### Task 6: Adding an avatar

**Files:**
- Modify: `src/lib/workspace/actions.ts` (new action)
- Modify: `src/components/app-nav.tsx` (the rail's people list)

**Interfaces:**
- Consumes: `resolveActiveMembership()` (Slice A), `CurrentWorkspace.people` (Task 2).
- Produces: `addPerson(formData: FormData): Promise<void>`.

**Where it lives:** the rail block that lists members — the same block the Workspaces switcher now heads. That block should list *people*, since an avatar is a traveller in the workspace even though she never signs in.

- [ ] **Step 1: Add the action**

In `src/lib/workspace/actions.ts`:

```ts
/** Adds a traveller with no account to the active workspace. Wired straight to
 * `<form action={...}>`, so it throws rather than returning an error shape. */
export async function addPerson(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim()
  if (!name) throw new Error("Name required")

  const membership = await resolveActiveMembership()
  if (!membership) throw new Error("No workspace")

  const supabase = await createClient()
  const { error } = await supabase.from("workspace_people").insert({
    workspace_id: membership.workspaceId,
    display_name: name,
  })
  if (error) throw new Error(error.message)

  revalidatePath("/home")
}
```

- [ ] **Step 2: List people and add the form in the rail**

In `src/components/app-nav.tsx`, change the list in the `mt-auto` block from `workspace.members.map` to `workspace.people.map`, keyed and toned off the person:

```tsx
        <div className="flex flex-col gap-2">
          {workspace.people.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2.5">
              <Avatar
                name={p.display_name}
                size={24}
                tone={i === 0 ? "sea" : "clay"}
              />
              <div className="font-serif text-[13px] italic text-foreground">
                {p.display_name}
              </div>
            </div>
          ))}
        </div>

        <form action={addPerson} className="mt-2.5 flex gap-1.5">
          <input
            name="name"
            required
            maxLength={40}
            placeholder="Add a traveller"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            className="rounded-md bg-sea-tint px-2.5 py-1.5 text-[13px] text-foreground"
          >
            Add
          </button>
        </form>
```

Add the import: `import { addPerson } from "@/lib/workspace/actions"`.

- [ ] **Step 3: Build and lint**

Run: `pnpm lint && pnpm exec tsc --noEmit`, then with the dev server stopped, `pnpm build`.
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workspace/actions.ts src/components/app-nav.tsx
git commit -m "feat(people): add a traveller who has no account"
```

---

### Task 7: Documentation

**Files:**
- Modify: `docs/TODO.md`, `docs/DECISIONS.md`

- [ ] **Step 1: Add the TODO entry**

Add an entry above the multi-workspace one, marked *implemented … unverified in app*, naming: the spec's unsound `id = user_id` backfill and why it was replaced; that the UI change was one function because pickers consume an opaque id map; the settle-up `!=2 people` limit; and the B2 sequencing constraint about not inviting an avatar yet.

- [ ] **Step 2: Add the DECISIONS row**

One row: **subject columns hold person ids, and the couple's ids are no longer interchangeable with their auth uids** — with the reasoning that a wrong id silently works for the couple and breaks only for avatars, which is why the props were renamed rather than reassigned.

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/DECISIONS.md
git commit -m "docs: record avatar travellers B1"
```

---

## Done means

**Verified by Claude:** `pnpm build`, `pnpm lint`, `tsc --noEmit` clean; `grep -rn "currentUserId" src/` returns nothing; the migration is re-runnable by inspection; every subject column write resolves a person id.

**Verified by the user in-app:**

1. The rail lists travellers, with an "Add a traveller" field under them.
2. Adding "Mom" makes her appear in the list without any invite or signup.
3. On a trip in that workspace, Mom appears in the payer picker.
4. An expense recorded as paid by Mom shows her name in the ledger.
5. A savings contribution can be credited to Mom.
6. Settle-up in a workspace of you + Mom shows a real balance.
7. Existing expenses in the couple workspace still show the right payer and the same settle-up figure as before the migration.

## Not in this plan — B2

- `packing_items.owner_id` and `packing_categories.owner_id` repointed to people.
- `invites.person_id`, so inviting an avatar links her account to her existing person row instead of creating a second one. **Until this ships, do not invite an avatar to become a member.**
