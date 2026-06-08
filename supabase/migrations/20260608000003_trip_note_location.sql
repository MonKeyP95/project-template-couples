-- Location-filed notes: trip_notes can reference an itinerary_locations row.
-- Mirrors itinerary_days.location_id -- nullable, on delete set null, so
-- deleting a location turns its notes into General (location-less) notes
-- rather than destroying them. No RLS change: existing trip_notes policies
-- already gate by trip via is_trip_workspace_member().
--
-- Idempotent: safe to paste-and-run multiple times.

alter table public.trip_notes
  add column if not exists location_id uuid
  references public.itinerary_locations(id) on delete set null;

create index if not exists trip_notes_location_idx
  on public.trip_notes (location_id);
