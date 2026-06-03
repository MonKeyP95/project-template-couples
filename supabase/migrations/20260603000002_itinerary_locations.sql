-- Itinerary locations: an editable, ordered grouping layer over itinerary_days.
-- A day's location_id is nullable (null = a travel/transit day). Locations and
-- the trek group_id are different axes; this migration only adds the location
-- layer and does not touch dates.

create table if not exists public.itinerary_locations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sort_order int not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists itinerary_locations_trip_order_idx
  on public.itinerary_locations (trip_id, sort_order);

alter table public.itinerary_locations enable row level security;

drop policy if exists itinerary_locations_select on public.itinerary_locations;
create policy itinerary_locations_select on public.itinerary_locations
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists itinerary_locations_insert on public.itinerary_locations;
create policy itinerary_locations_insert on public.itinerary_locations
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );

drop policy if exists itinerary_locations_update on public.itinerary_locations;
create policy itinerary_locations_update on public.itinerary_locations
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));

drop policy if exists itinerary_locations_delete on public.itinerary_locations;
create policy itinerary_locations_delete on public.itinerary_locations
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- Days point at a location; deleting a location detaches its days (set null),
-- turning them into travel days rather than destroying content.
alter table public.itinerary_days
  add column if not exists location_id uuid
  references public.itinerary_locations(id) on delete set null;

-- Live tab updates for both partners.
do $$
begin
  alter publication supabase_realtime add table public.itinerary_locations;
exception
  when duplicate_object then null;
end $$;
