-- Overflow push for itinerary adds.
-- Inserts p_count day(s) starting at p_from_date and pushes only the OVERFLOW
-- of the occupied tail forward, so any empty buffer days between p_from_date and
-- the first occupied day are consumed instead of being shoved past the new block.
-- The shift is count minus that free runway (>= 1 when there is a collision);
-- run under the DEFERRABLE (trip_id, day_date) unique from
-- 20260529000002_itinerary_reschedule.sql, so it is atomic. SECURITY INVOKER
-- (default): the caller's RLS gates the update/insert, and auth.uid() stamps
-- created_by. Multi-day adds (p_count > 1) share one group_id and an optional
-- group_name, so a pushed trek still renders in the "added together" box.
-- Idempotent (create or replace).

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
  v_first date;
  v_shift int;
begin
  set constraints all deferred;

  -- First occupied date at/after the insertion point. Empty dates between
  -- p_from_date and it are free runway the new block uses, so we only push the
  -- occupied tail by the days that do not fit in that runway.
  select min(day_date) into v_first
  from public.itinerary_days
  where trip_id = p_trip_id and day_date >= p_from_date;

  v_shift := case
    when v_first is null then 0
    else greatest(0, p_count - (v_first - p_from_date))
  end;

  update public.itinerary_days
  set day_date = day_date + v_shift
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
