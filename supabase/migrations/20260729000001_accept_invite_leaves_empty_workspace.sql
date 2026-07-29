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
