-- Slice C: drag-to-reschedule itinerary days.
--
-- 1) Make (trip_id, day_date) uniqueness DEFERRABLE so an insertion-shift can
--    permute dates within one transaction without tripping the per-statement
--    unique check. INITIALLY IMMEDIATE keeps add/edit behavior (fail-fast
--    23505) unchanged; only reschedule_itinerary_days opts into deferral.
alter table public.itinerary_days
  drop constraint if exists itinerary_days_trip_id_day_date_key;
alter table public.itinerary_days
  add constraint itinerary_days_trip_id_day_date_key
  unique (trip_id, day_date) deferrable initially immediate;

-- 2) Atomic insertion-shift. SECURITY INVOKER (default) so the caller's RLS
--    still gates the update. The trip's existing dates sorted ascending are the
--    slots; day_ids[i] takes slot[i].
create or replace function public.reschedule_itinerary_days(
  p_trip_id uuid,
  p_day_ids uuid[]
) returns void
language plpgsql
as $$
declare
  v_dates date[];
begin
  set constraints all deferred;

  select array_agg(day_date order by day_date)
    into v_dates
  from public.itinerary_days
  where trip_id = p_trip_id;

  if array_length(v_dates, 1) is distinct from array_length(p_day_ids, 1) then
    raise exception 'reschedule id count % does not match day count %',
      array_length(p_day_ids, 1), array_length(v_dates, 1);
  end if;

  update public.itinerary_days d
  set day_date = m.new_date
  from (
    select i.id, dt.new_date
    from unnest(p_day_ids) with ordinality as i(id, ord)
    join unnest(v_dates)  with ordinality as dt(new_date, ord) using (ord)
  ) m
  where d.id = m.id and d.trip_id = p_trip_id;
end;
$$;
