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
    for update to authenticated
    using (public.is_workspace_member(workspace_id))
    with check (public.is_workspace_member(workspace_id));
  create policy checklists_delete on public.checklists
    for delete to authenticated using (public.is_workspace_member(workspace_id));

  create policy checklist_categories_select on public.checklist_categories
    for select to authenticated using (public.is_checklist_workspace_member(checklist_id));
  create policy checklist_categories_insert on public.checklist_categories
    for insert to authenticated with check (public.is_checklist_workspace_member(checklist_id));
  create policy checklist_categories_update on public.checklist_categories
    for update to authenticated
    using (public.is_checklist_workspace_member(checklist_id))
    with check (public.is_checklist_workspace_member(checklist_id));
  create policy checklist_categories_delete on public.checklist_categories
    for delete to authenticated using (public.is_checklist_workspace_member(checklist_id));

  create policy checklist_items_select on public.checklist_items
    for select to authenticated using (public.is_checklist_workspace_member(checklist_id));
  create policy checklist_items_insert on public.checklist_items
    for insert to authenticated with check (
      public.is_checklist_workspace_member(checklist_id) and added_by = auth.uid()
    );
  create policy checklist_items_update on public.checklist_items
    for update to authenticated
    using (public.is_checklist_workspace_member(checklist_id))
    with check (public.is_checklist_workspace_member(checklist_id));
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
