-- Savings contribution log: per-person, dated rows. Replaces the single
-- trips.saved_cents pot — the saved total is now SUM(amount_cents) per trip.
-- RLS mirrors expenses (access gated by trip -> workspace membership).
-- Idempotent: safe to paste-and-run multiple times.

create table if not exists public.trip_savings_contributions (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  created_at   timestamptz not null default now()
);

create index if not exists trip_savings_contributions_trip_idx
  on public.trip_savings_contributions (trip_id, created_at desc);

alter table public.trip_savings_contributions enable row level security;

drop policy if exists savings_select on public.trip_savings_contributions;
create policy savings_select on public.trip_savings_contributions
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

-- Inserter must be a workspace member of the trip, and user_id must be the
-- caller (contributions are always self-credited).
drop policy if exists savings_insert on public.trip_savings_contributions;
create policy savings_insert on public.trip_savings_contributions
  for insert to authenticated
  with check (
    public.is_trip_workspace_member(trip_id)
    and user_id = auth.uid()
  );

drop policy if exists savings_delete on public.trip_savings_contributions;
create policy savings_delete on public.trip_savings_contributions
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- Drop the old single-pot column; the log is now the source of truth.
alter table public.trips drop column if exists saved_cents;
