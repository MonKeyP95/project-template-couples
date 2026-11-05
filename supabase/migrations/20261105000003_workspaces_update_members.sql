-- Any workspace member may update the workspace row (today: home currency).
-- The owner-only policy made a partner's save match zero rows with no error.
-- Ownership lives in workspace_members.role, so this grants no owner powers.
-- Re-runnable.

drop policy if exists workspaces_update_owner on public.workspaces;
drop policy if exists workspaces_update_members on public.workspaces;

create policy workspaces_update_members on public.workspaces
  for update to authenticated
  using (public.is_workspace_member(id))
  with check (public.is_workspace_member(id));
