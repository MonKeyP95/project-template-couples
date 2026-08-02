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
