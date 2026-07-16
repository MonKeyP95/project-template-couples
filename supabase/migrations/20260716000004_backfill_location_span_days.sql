-- One-time (idempotent) backfill: give every declared location span a real
-- itinerary_days row per date. Dates already taken are skipped. Mirrors the
-- app's fillLocationSpanDays. Empty rows: no title/tag, tone 'sand'.
-- Requires 20260716000003 (nullable title/tag) applied first.
insert into public.itinerary_days (trip_id, day_date, tone, location_id, created_by)
select l.trip_id, gs::date, 'sand', l.id, l.created_by
from public.itinerary_locations l
cross join lateral generate_series(l.start_date, l.end_date, interval '1 day') gs
where l.start_date is not null and l.end_date is not null
on conflict (trip_id, day_date) do nothing;
