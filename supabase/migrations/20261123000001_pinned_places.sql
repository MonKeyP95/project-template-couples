-- Pinned places: a trip and each itinerary location can store the exact place
-- the couple picked from geocoder matches. Re-runnable.

alter table public.itinerary_locations
  add column if not exists lat numeric(7, 4),
  add column if not exists lng numeric(7, 4),
  add column if not exists place_label text;

alter table public.itinerary_locations
  drop constraint if exists itinerary_locations_pin_complete;
alter table public.itinerary_locations
  add constraint itinerary_locations_pin_complete check (
    (lat is null and lng is null and place_label is null)
    or (lat is not null and lng is not null and place_label is not null)
  );

alter table public.trips
  add column if not exists place_label text;

alter table public.trips
  drop constraint if exists trips_pin_label_needs_coords;
alter table public.trips
  add constraint trips_pin_label_needs_coords check (
    place_label is null or (lat is not null and lng is not null)
  );
