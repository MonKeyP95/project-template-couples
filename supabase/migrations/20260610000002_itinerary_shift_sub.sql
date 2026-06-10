-- Re-add p_sub to the overflow-push RPC so days created via the push-forward
-- path carry a summary line alongside their events. Mirrors
-- 20260610000001_itinerary_day_events.sql but with both sub + events. Idempotent.

drop function if exists public.shift_and_insert_itinerary(
  uuid, date, int, text, jsonb, text, text, uuid, text
);

create or replace function public.shift_and_insert_itinerary(
  p_trip_id     uuid,
  p_from_date   date,
  p_count       int,
  p_title       text,
  p_sub         text,
  p_events      jsonb,
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
    (trip_id, day_date, title, sub, events, tag, tone,
     group_id, group_name, location_id, created_by)
  select
    p_trip_id, p_from_date + g, p_title, p_sub, coalesce(p_events, '[]'::jsonb), p_tag, p_tone,
    v_group, v_name, p_location_id, v_uid
  from generate_series(0, p_count - 1) as g;

  update public.itinerary_locations
  set start_date = start_date + v_shift,
      end_date   = end_date + v_shift
  where trip_id = p_trip_id
    and id is distinct from p_location_id
    and start_date >= p_from_date;

  update public.itinerary_locations
  set start_date = least(start_date, p_from_date),
      end_date   = end_date + v_shift
  where trip_id = p_trip_id
    and (id = p_location_id or start_date < p_from_date)
    and end_date >= p_from_date;

  update public.trips
  set end_date = greatest(
    end_date,
    coalesce((select max(day_date) from public.itinerary_days where trip_id = p_trip_id), end_date),
    coalesce((select max(end_date) from public.itinerary_locations where trip_id = p_trip_id), end_date)
  )
  where id = p_trip_id;
end;
$$;
