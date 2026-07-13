-- Per-trip learned taste summary (profile-growth slice 2). Mirrors
-- couple_summaries but keyed by trip, so /profile can show a per-trip history.
-- The stamp holds a signal count (not a rating count). RLS via the trip's
-- workspace. Idempotent: safe to paste-and-run again.

create table if not exists public.trip_summaries (
  trip_id uuid not null references public.trips(id) on delete cascade,
  category text not null,
  summary_md text not null default '',
  signal_count_at_generation int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (trip_id, category)
);

alter table public.trip_summaries enable row level security;

do $$
begin
  create policy trip_summaries_select on public.trip_summaries
    for select to authenticated using (public.is_trip_workspace_member(trip_id));
  create policy trip_summaries_insert on public.trip_summaries
    for insert to authenticated with check (public.is_trip_workspace_member(trip_id));
  create policy trip_summaries_update on public.trip_summaries
    for update to authenticated
    using (public.is_trip_workspace_member(trip_id))
    with check (public.is_trip_workspace_member(trip_id));
exception
  when duplicate_object then null;
end $$;
