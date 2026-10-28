-- One trip model, step 6b: changing a trip's start asks "move the plan or
-- keep the dates".
--
-- The renumber trigger kept days on their dates on every start change. Now
-- "move the plan" changes no itinerary row (Day 1 is simply the new start),
-- and "keep the dates" calls shift_trip_days explicitly. Unplaced days
-- (day_index null) never move. Idempotent.
--
-- Deploy order: paste, then merge and deploy straight away. Don't change a
-- trip's start date in between: deployed 6a code expects the trigger.

drop trigger if exists trips_renumber_itinerary on public.trips;
drop function if exists public.trips_renumber_itinerary();

-- Adds p_shift (old start - new start, in days) to every placed day number
-- and every location span of the trip. The (trip_id, day_index) unique
-- constraint is deferrable, so the one-statement shift cannot collide.
create or replace function public.shift_trip_days(
  p_trip_id uuid,
  p_shift   int
) returns void
language plpgsql
as $$
begin
  update public.itinerary_days
  set day_index = day_index + p_shift
  where trip_id = p_trip_id and day_index is not null;

  update public.itinerary_locations
  set start_index = start_index + p_shift,
      end_index = end_index + p_shift
  where trip_id = p_trip_id and start_index is not null;
end;
$$;
