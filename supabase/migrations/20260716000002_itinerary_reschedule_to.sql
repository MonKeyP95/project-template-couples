-- Drag empty days: explicit-date reschedule.
--
-- Generalizes reschedule_itinerary_days (which could only permute the set of
-- already-occupied dates) to assign each day to an explicit date. This lets a
-- day move onto a date that was previously empty, which is what moving a gap
-- within a location requires. Relies on the DEFERRABLE (trip_id, day_date)
-- unique constraint from 20260529000002 so the permutation commits atomically.
-- SECURITY INVOKER (default) so the caller's RLS still gates the update.
-- Idempotent: create or replace.

create or replace function public.reschedule_itinerary_days_to(
  p_trip_id uuid,
  p_day_ids uuid[],
  p_dates   date[]
) returns void
language plpgsql
as $$
begin
  set constraints all deferred;

  if array_length(p_day_ids, 1) is distinct from array_length(p_dates, 1) then
    raise exception 'reschedule id count % does not match date count %',
      array_length(p_day_ids, 1), array_length(p_dates, 1);
  end if;

  update public.itinerary_days d
  set day_date = m.new_date
  from (
    select i.id, dt.new_date
    from unnest(p_day_ids) with ordinality as i(id, ord)
    join unnest(p_dates)   with ordinality as dt(new_date, ord) using (ord)
  ) m
  where d.id = m.id and d.trip_id = p_trip_id;
end;
$$;
