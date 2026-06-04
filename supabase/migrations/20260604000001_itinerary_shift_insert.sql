-- Overflow push for itinerary adds.
-- Opens a p_count-day window at p_from_date by shifting every day on/after it
-- forward, then inserts the new day(s) into the freed window -- atomically,
-- under the DEFERRABLE (trip_id, day_date) unique from
-- 20260529000002_itinerary_reschedule.sql. SECURITY INVOKER (default): the
-- caller's RLS gates the update/insert, and auth.uid() stamps created_by.
-- Multi-day adds (p_count > 1) share one group_id and an optional group_name,
-- so a pushed trek still renders in the "added together" box. Idempotent
-- (create or replace).

create or replace function public.shift_and_insert_itinerary(
  p_trip_id     uuid,
  p_from_date   date,
  p_count       int,
  p_title       text,
  p_sub         text,
  p_tag         text,
  p_tone        text,
  p_location_id uuid,
  p_group_name  text
) returns void
language plpgsql
as $$
declare
  v_group uuid := case when p_count > 1 then gen_random_uuid() else null end;
  v_name  text := case when p_count > 1 then nullif(btrim(p_group_name), '') else null end;
  v_uid   uuid := auth.uid();
begin
  set constraints all deferred;

  update public.itinerary_days
  set day_date = day_date + p_count
  where trip_id = p_trip_id and day_date >= p_from_date;

  insert into public.itinerary_days
    (trip_id, day_date, title, sub, tag, tone,
     group_id, group_name, location_id, created_by)
  select
    p_trip_id, p_from_date + g, p_title, p_sub, p_tag, p_tone,
    v_group, v_name, p_location_id, v_uid
  from generate_series(0, p_count - 1) as g;

  update public.trips
  set end_date = greatest(
    end_date,
    (select max(day_date) from public.itinerary_days where trip_id = p_trip_id)
  )
  where id = p_trip_id;
end;
$$;
