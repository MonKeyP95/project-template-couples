-- Learning layer (slice 6): a durable append-only rating corpus + a per-category
-- editable markdown summary the discovery agent reads. RLS via the existing
-- is_workspace_member helper. Idempotent: safe to paste-and-run again.

create table if not exists public.event_ratings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete set null,
  day_date date,
  event_text text not null,
  note text,
  rating smallint not null check (rating between 1 and 5),
  category text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists event_ratings_ws_cat_idx
  on public.event_ratings (workspace_id, category);

alter table public.event_ratings enable row level security;

do $$
begin
  create policy event_ratings_select on public.event_ratings
    for select to authenticated using (public.is_workspace_member(workspace_id));
  create policy event_ratings_insert on public.event_ratings
    for insert to authenticated with check (public.is_workspace_member(workspace_id));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.couple_summaries (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  category text not null,
  summary_md text not null default '',
  rating_count_at_generation int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, category)
);

alter table public.couple_summaries enable row level security;

do $$
begin
  create policy couple_summaries_select on public.couple_summaries
    for select to authenticated using (public.is_workspace_member(workspace_id));
  create policy couple_summaries_insert on public.couple_summaries
    for insert to authenticated with check (public.is_workspace_member(workspace_id));
  create policy couple_summaries_update on public.couple_summaries
    for update to authenticated
    using (public.is_workspace_member(workspace_id))
    with check (public.is_workspace_member(workspace_id));
exception
  when duplicate_object then null;
end $$;
