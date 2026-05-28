-- Phase 4.6: add itinerary_days to the Realtime publication so the
-- new ItineraryTab can subscribe to live INSERT / UPDATE / DELETE events.
-- Mirrors the pattern in 20260526000003_phase_3_packing.sql which added
-- packing_items the same way.
--
-- Idempotent: the do-block swallows the duplicate_object error if the
-- table is already in the publication.

do $$
begin
  alter publication supabase_realtime add table public.itinerary_days;
exception
  when duplicate_object then null;
end $$;
