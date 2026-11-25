-- Every home trip idea as its own row. The pills are the rows `on_pills`; the
-- "Earlier ideas" list is the rest. `trip_id` is set when a trip is created
-- from the idea. `home_ideas` now only keeps the fingerprint; its `ideas`
-- column is dropped by a later cleanup migration once this code is live.
-- Re-runnable.

create table if not exists public.trip_ideas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pill text not null,
  label text not null,
  body text not null,
  plan jsonb not null,
  on_pills boolean not null default false,
  trip_id uuid references public.trips(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists trip_ideas_workspace_created
  on public.trip_ideas (workspace_id, created_at desc);

alter table public.trip_ideas enable row level security;

do $$
begin
  create policy trip_ideas_select on public.trip_ideas
    for select to authenticated using (public.is_workspace_member(workspace_id));
  create policy trip_ideas_insert on public.trip_ideas
    for insert to authenticated with check (public.is_workspace_member(workspace_id));
  create policy trip_ideas_update on public.trip_ideas
    for update to authenticated
    using (public.is_workspace_member(workspace_id))
    with check (public.is_workspace_member(workspace_id));
  create policy trip_ideas_delete on public.trip_ideas
    for delete to authenticated using (public.is_workspace_member(workspace_id));
exception
  when duplicate_object then null;
end $$;
