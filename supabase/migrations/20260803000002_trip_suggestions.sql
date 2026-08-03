-- One AI suggestion per trip per day: the proactive card in the dispatch box.
-- Written by the same daily pass as trip_dispatch, but unlike that row this one
-- is answered by the couple, and the answers are what the assistant learns from.
-- The unique index is what makes generation once-per-day (upsert on conflict).
--
-- Idempotent: safe to paste-and-run multiple times.

create table if not exists public.trip_suggestions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_date date not null,
  title text not null default '',
  body text not null default '',
  target text not null default 'event',
  category text,
  suggested_time text,
  source_url text,
  outcome text not null default 'pending',
  answered_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists trip_suggestions_trip_day_idx
  on public.trip_suggestions (trip_id, day_date);

alter table public.trip_suggestions
  drop constraint if exists trip_suggestions_outcome_check;
alter table public.trip_suggestions
  add constraint trip_suggestions_outcome_check
  check (outcome in ('pending', 'added', 'dismissed'));

alter table public.trip_suggestions enable row level security;

drop policy if exists trip_suggestions_select on public.trip_suggestions;
create policy trip_suggestions_select on public.trip_suggestions
  for select using (is_trip_workspace_member(trip_id));

drop policy if exists trip_suggestions_insert on public.trip_suggestions;
create policy trip_suggestions_insert on public.trip_suggestions
  for insert with check (is_trip_workspace_member(trip_id));

drop policy if exists trip_suggestions_update on public.trip_suggestions;
create policy trip_suggestions_update on public.trip_suggestions
  for update using (is_trip_workspace_member(trip_id));

drop policy if exists trip_suggestions_delete on public.trip_suggestions;
create policy trip_suggestions_delete on public.trip_suggestions
  for delete using (is_trip_workspace_member(trip_id));
