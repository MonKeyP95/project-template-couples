-- trip_suggestions: the planner's ideas, waiting for the couple to pick them.
-- A row sits on a blank day (day_index) or in the box (day_index null); it
-- becomes real only through the day's event form, then the row is deleted.
--
-- Replaces the orphaned, empty road-suggestion table of 2026-08-03 (keyed by
-- day_date). The old shape is dropped only while its day_date column still
-- exists, so a second run keeps live rows.
--
-- Idempotent: safe to paste-and-run multiple times.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'trip_suggestions'
      and column_name = 'day_date'
  ) then
    drop table public.trip_suggestions;
  end if;
end $$;

create table if not exists public.trip_suggestions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  kind text not null,
  category text not null,
  title text not null,
  location_id uuid references public.itinerary_locations(id) on delete set null,
  day_index integer,
  why text not null default '',
  options jsonb
);

alter table public.trip_suggestions
  drop constraint if exists trip_suggestions_kind_check;
alter table public.trip_suggestions
  add constraint trip_suggestions_kind_check check (kind in ('big', 'small'));

create index if not exists trip_suggestions_trip_idx
  on public.trip_suggestions (trip_id);

alter table public.trip_suggestions enable row level security;

drop policy if exists trip_suggestions_select on public.trip_suggestions;
create policy trip_suggestions_select on public.trip_suggestions
  for select to authenticated
  using (public.is_trip_workspace_member(trip_id));

drop policy if exists trip_suggestions_insert on public.trip_suggestions;
create policy trip_suggestions_insert on public.trip_suggestions
  for insert to authenticated
  with check (public.is_trip_workspace_member(trip_id));

drop policy if exists trip_suggestions_update on public.trip_suggestions;
create policy trip_suggestions_update on public.trip_suggestions
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));

drop policy if exists trip_suggestions_delete on public.trip_suggestions;
create policy trip_suggestions_delete on public.trip_suggestions
  for delete to authenticated
  using (public.is_trip_workspace_member(trip_id));
