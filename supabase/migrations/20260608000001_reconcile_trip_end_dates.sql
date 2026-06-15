-- One-time reconcile: grow each dated trip's end_date to cover its furthest
-- planned itinerary day and its furthest location-span end. Forward-only --
-- never shrinks a trip. Fixes trips whose content drifted past end_date before
-- the add/edit/location-span actions started growing it.
-- GREATEST ignores NULLs in Postgres, so a trip with no days/spans is unaffected.
-- Idempotent: the WHERE guard makes a re-run a no-op once end_date covers content.

update public.trips t
set end_date = greatest(
  t.end_date,
  (select max(d.day_date) from public.itinerary_days d where d.trip_id = t.id),
  (select max(l.end_date) from public.itinerary_locations l where l.trip_id = t.id)
)
where t.end_date is not null
  and greatest(
    t.end_date,
    (select max(d.day_date) from public.itinerary_days d where d.trip_id = t.id),
    (select max(l.end_date) from public.itinerary_locations l where l.trip_id = t.id)
  ) > t.end_date;
