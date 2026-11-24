-- The saved home page trip idea, one per workspace. `fingerprint` is a hash of
-- everything the idea was built from (profile + trip learnings, no date), so a
-- new idea is made only when that changes or on "another". Re-runnable.

create table if not exists public.home_ideas (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  fingerprint text not null,
  label text not null,
  body text not null,
  updated_at timestamptz not null default now()
);

alter table public.home_ideas enable row level security;

do $$
begin
  create policy home_ideas_select on public.home_ideas
    for select to authenticated using (public.is_workspace_member(workspace_id));
  create policy home_ideas_insert on public.home_ideas
    for insert to authenticated with check (public.is_workspace_member(workspace_id));
  create policy home_ideas_update on public.home_ideas
    for update to authenticated
    using (public.is_workspace_member(workspace_id))
    with check (public.is_workspace_member(workspace_id));
exception
  when duplicate_object then null;
end $$;
