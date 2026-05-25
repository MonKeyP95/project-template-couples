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
