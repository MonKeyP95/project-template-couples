-- Let a workspace member log a savings contribution on behalf of any member of
-- the same trip (a couple shares the pot, so either partner can credit either
-- box). Previously user_id had to equal auth.uid() (self-credit only).
-- Idempotent: safe to paste-and-run multiple times.

drop policy if exists savings_insert on public.trip_savings_contributions;
create policy savings_insert on public.trip_savings_contributions
  for insert to authenticated
  with check (
    public.is_trip_workspace_member(trip_id)
    and exists (
      select 1
      from public.trips t
      join public.workspace_members wm on wm.workspace_id = t.workspace_id
      where t.id = trip_id and wm.user_id = user_id
    )
  );
