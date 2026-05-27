-- Phase 3: trips + trip_members
-- See docs/PLAN.md (Phase 3) and design_handoff_together_app/README.md ("State management" section).

-- ============================================================================
-- TABLES
-- ============================================================================

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  slug text not null,
  name text not null check (length(trim(name)) > 0),
  country text,
  start_date date,
  end_date date,
  lat numeric(7, 4),
  lng numeric(7, 4),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workspace_id, slug),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create index trips_workspace_start_idx on public.trips (workspace_id, start_date);

create table public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  added_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

-- ============================================================================
-- HELPER FUNCTIONS (SECURITY DEFINER avoids RLS recursion)
-- ============================================================================

create or replace function public.is_trip_workspace_member(p_trip_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.trips t
    join public.workspace_members wm on wm.workspace_id = t.workspace_id
    where t.id = p_trip_id and wm.user_id = auth.uid()
  );
$$;

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;

-- trips: workspace members read/write trips in their workspaces.
create policy trips_select_members on public.trips
  for select to authenticated using (public.is_workspace_member(workspace_id));

create policy trips_insert_members on public.trips
  for insert to authenticated with check (
    public.is_workspace_member(workspace_id)
    and created_by = auth.uid()
  );

create policy trips_update_members on public.trips
  for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy trips_delete_members on public.trips
  for delete to authenticated using (public.is_workspace_member(workspace_id));

-- trip_members: workspace members read/write trip_members in their workspaces.
create policy trip_members_select on public.trip_members
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

create policy trip_members_insert on public.trip_members
  for insert to authenticated with check (public.is_trip_workspace_member(trip_id));

create policy trip_members_delete on public.trip_members
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));
