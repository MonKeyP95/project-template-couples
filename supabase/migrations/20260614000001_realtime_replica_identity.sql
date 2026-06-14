-- Realtime + RLS needs the full row to evaluate policies against changes
-- (notably DELETE, where the default replica identity only carries the PK).
-- The publication membership lives in each table's own migration; this sets
-- replica identity full for every Realtime-enabled table. Naturally idempotent.

alter table public.packing_items        replica identity full;
alter table public.itinerary_days       replica identity full;
alter table public.dream_itinerary_days replica identity full;
alter table public.itinerary_locations  replica identity full;
alter table public.checklist_items      replica identity full;
