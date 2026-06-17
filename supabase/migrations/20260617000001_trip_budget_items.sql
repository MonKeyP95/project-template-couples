-- trip_budget_items: per-trip budget line items (shared, server-backed).
-- The planned total = sum(amount_cents); the app keeps trips.planned_budget_cents in sync.
-- Idempotent: safe to paste-and-run multiple times.

create table if not exists public.trip_budget_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  category text not null,
  subject text not null default '',
  when_label text not null default '',
  amount_cents integer not null default 0 check (amount_cents >= 0),
  location_id uuid references public.itinerary_locations(id) on delete set null,
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists trip_budget_items_trip_idx
  on public.trip_budget_items (trip_id, category, sort_order);

alter table public.trip_budget_items enable row level security;

drop policy if exists trip_budget_items_select on public.trip_budget_items;
create policy trip_budget_items_select on public.trip_budget_items
  for select to authenticated
  using (public.is_trip_workspace_member(trip_id));

drop policy if exists trip_budget_items_insert on public.trip_budget_items;
create policy trip_budget_items_insert on public.trip_budget_items
  for insert to authenticated
  with check (public.is_trip_workspace_member(trip_id));

drop policy if exists trip_budget_items_update on public.trip_budget_items;
create policy trip_budget_items_update on public.trip_budget_items
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));

drop policy if exists trip_budget_items_delete on public.trip_budget_items;
create policy trip_budget_items_delete on public.trip_budget_items
  for delete to authenticated
  using (public.is_trip_workspace_member(trip_id));
