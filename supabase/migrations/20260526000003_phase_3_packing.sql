-- Phase 3: packing_items
-- Shared packing list per trip. Partner's checks sync via Supabase Realtime.

create table public.packing_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  category text not null check (length(trim(category)) > 0),
  label text not null check (length(trim(label)) > 0),
  done boolean not null default false,
  added_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index packing_items_trip_idx on public.packing_items (trip_id, created_at);

alter table public.packing_items enable row level security;

create policy packing_items_select on public.packing_items
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

create policy packing_items_insert on public.packing_items
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id) and added_by = auth.uid()
  );

create policy packing_items_update on public.packing_items
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));

create policy packing_items_delete on public.packing_items
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- Stream postgres_changes to subscribed clients (RLS still applies per row).
alter publication supabase_realtime add table public.packing_items;
