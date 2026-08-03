-- One AI "dispatch" per trip per day: what is happening where the couple is.
-- Child-table shape of trip_notes, RLS via is_trip_workspace_member().
-- The unique index is what makes generation once-per-day (upsert on conflict).
--
-- Idempotent: safe to paste-and-run multiple times.

create table if not exists public.trip_dispatch (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_date date not null,
  items jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now()
);

create unique index if not exists trip_dispatch_trip_day_idx
  on public.trip_dispatch (trip_id, day_date);

alter table public.trip_dispatch enable row level security;

drop policy if exists trip_dispatch_select on public.trip_dispatch;
create policy trip_dispatch_select on public.trip_dispatch
  for select using (is_trip_workspace_member(trip_id));

drop policy if exists trip_dispatch_insert on public.trip_dispatch;
create policy trip_dispatch_insert on public.trip_dispatch
  for insert with check (is_trip_workspace_member(trip_id));

drop policy if exists trip_dispatch_update on public.trip_dispatch;
create policy trip_dispatch_update on public.trip_dispatch
  for update using (is_trip_workspace_member(trip_id));

drop policy if exists trip_dispatch_delete on public.trip_dispatch;
create policy trip_dispatch_delete on public.trip_dispatch
  for delete using (is_trip_workspace_member(trip_id));
