-- An invite can target an existing traveller, so someone who has been an avatar
-- keeps her history when she finally signs in. Safe to run repeatedly.

alter table public.invites
  add column if not exists person_id uuid
  references public.workspace_people(id) on delete set null;

-- accept_invite links the caller to the targeted person row instead of letting
-- the workspace_members trigger mint a second one. The link happens BEFORE the
-- member insert: the trigger's `on conflict do nothing` then sees the row
-- already carries this user_id and leaves it alone.
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_person_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select workspace_id, person_id into v_workspace_id, v_person_id
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

  -- Only an unclaimed person row in this workspace can be adopted, so a stale
  -- invite cannot steal a traveller who already belongs to someone.
  if v_person_id is not null then
    update public.workspace_people
    set user_id = v_user_id
    where id = v_person_id
      and workspace_id = v_workspace_id
      and user_id is null;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'member');

  update public.invites set used_at = now() where token = p_token;

  return v_workspace_id;
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;
