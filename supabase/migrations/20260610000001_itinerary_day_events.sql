-- Itinerary day mini-events.
-- Replaces the single free-text `sub` line with an ordered jsonb array of
-- { time, text } events. The `sub` column is left in place (vestigial) so this
-- migration is non-destructive; code stops reading/writing it. Idempotent.

alter table public.itinerary_days
  add column if not exists events jsonb not null default '[]'::jsonb;

-- Backfill: fold any existing non-empty sub into a single timeless event.
update public.itinerary_days
set events = jsonb_build_array(jsonb_build_object('time', '', 'text', btrim(sub)))
where coalesce(btrim(sub), '') <> ''
  and events = '[]'::jsonb;

-- Repoint the overflow-push RPC at `events`. The arg-type change (text -> jsonb)
-- would otherwise create an overload, so drop the old signature first.
drop function if exists public.shift_and_insert_itinerary(
  uuid, date, int, text, text, text, text, uuid, text
);

create or replace function public.shift_and_insert_itinerary(
  p_trip_id     uuid,
  p_from_date   date,
  p_count       int,
  p_title       text,
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
    (trip_id, day_date, title, events, tag, tone,
     group_id, group_name, location_id, created_by)
  select
    p_trip_id, p_from_date + g, p_title, coalesce(p_events, '[]'::jsonb), p_tag, p_tone,
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
