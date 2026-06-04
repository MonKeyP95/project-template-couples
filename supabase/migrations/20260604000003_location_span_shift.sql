-- Confirm-and-push for setting a location's date span onto occupied dates.
-- Opens a span-length window at p_start by shifting everything at/after it
-- forward by the gap-aware overflow (span length minus the free runway before
-- the first occupied date) -- both itinerary_days (excluding this location's
-- own days) and OTHER locations' spans (moved as whole units) -- then writes
-- this location's name + span and extends trips.end_date. Atomic under the
-- DEFERRABLE (trip_id, day_date) unique. SECURITY INVOKER (default): caller RLS
-- gates every write. Idempotent (create or replace).

create or replace function public.set_location_span_with_shift(
  p_location_id uuid,
  p_trip_id     uuid,
  p_name        text,
  p_start       date,
  p_end         date
) returns void
language plpgsql
as $$
declare
  v_count int := (p_end - p_start) + 1;
  v_first date;
  v_shift int;
begin
  set constraints all deferred;

  -- First date at/after p_start occupied by something other than this location
  -- (another location's day/transit day, or another location's span start).
  select min(d) into v_first from (
    select min(day_date) as d
    from public.itinerary_days
    where trip_id = p_trip_id and day_date >= p_start
      and location_id is distinct from p_location_id
    union all
    select min(start_date) as d
    from public.itinerary_locations
    where trip_id = p_trip_id and id <> p_location_id and start_date >= p_start
  ) x;

  v_shift := case
    when v_first is null then 0
    else greatest(0, v_count - (v_first - p_start))
  end;

  update public.itinerary_days
  set day_date = day_date + v_shift
  where trip_id = p_trip_id and day_date >= p_start
    and location_id is distinct from p_location_id;

  update public.itinerary_locations
  set start_date = start_date + v_shift,
      end_date   = end_date + v_shift
  where trip_id = p_trip_id and id <> p_location_id and start_date >= p_start;

  update public.itinerary_locations
  set name = p_name, start_date = p_start, end_date = p_end
  where id = p_location_id;

  update public.trips
  set end_date = greatest(
    end_date,
    coalesce((select max(day_date) from public.itinerary_days where trip_id = p_trip_id), end_date),
    coalesce((select max(end_date) from public.itinerary_locations where trip_id = p_trip_id), end_date)
  )
  where id = p_trip_id;
end;
$$;
