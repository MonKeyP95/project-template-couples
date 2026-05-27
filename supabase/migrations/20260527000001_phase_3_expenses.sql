-- Phase 3: expenses
-- Shared per-trip expense ledger. Each row tagged with paid_by and an
-- is_settlement flag — the settle-up Server Action inserts a settlement
-- row paid_by the debtor when one workspace member clicks "settle".

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'EUR' check (length(currency) = 3),
  paid_by uuid not null references auth.users(id) on delete restrict,
  category text not null check (length(trim(category)) > 0),
  day_date date,
  is_settlement boolean not null default false,
  created_at timestamptz not null default now()
);

create index expenses_trip_idx on public.expenses (trip_id, created_at desc);

alter table public.expenses enable row level security;

create policy expenses_select on public.expenses
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

-- Inserter must be a workspace member of the trip, and paid_by must also be
-- a workspace member (so the settle action can record a row on behalf of
-- the debtor regardless of which member clicked the button).
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    public.is_trip_workspace_member(trip_id)
    and exists (
      select 1
      from public.trips t
      join public.workspace_members wm on wm.workspace_id = t.workspace_id
      where t.id = trip_id and wm.user_id = paid_by
    )
  );

create policy expenses_update on public.expenses
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));

create policy expenses_delete on public.expenses
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));
