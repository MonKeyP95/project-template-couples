-- One trip model, step 4: itinerary positions are day numbers only.
--
-- Drops itinerary_days.day_date and itinerary_locations.start_date/end_date,
-- the triggers that kept them in sync, every date-keyed overload of the three
-- moving RPCs, and the dream-only objects (dream_itinerary_days,
-- reschedule_dream_itinerary_days, promote_dream_to_dated). A dated trip's
-- start-date change still keeps days on their calendar dates: the trigger now
-- shifts day numbers by how far the start moved (step 6 adds the question).
-- Giving a dream dates, or removing them, moves no row. Idempotent.

create or replace function public.trips_renumber_itinerary()
returns trigger
language plpgsql
as $$
declare
  v_shift int := old.start_date - new.start_date;
begin
  update public.itinerary_days
  set day_index = day_index + v_shift
  where trip_id = new.id and day_index is not null;

  update public.itinerary_locations
  set start_index = start_index + v_shift,
      end_index = end_index + v_shift
  where trip_id = new.id and start_index is not null;
  return null;
end;
$$;

drop trigger if exists trips_renumber_itinerary on public.trips;
create trigger trips_renumber_itinerary
  after update of start_date on public.trips
  for each row
  when (
    old.start_date is not null
    and new.start_date is not null
    and new.start_date is distinct from old.start_date
  )
  execute function public.trips_renumber_itinerary();

drop trigger if exists itinerary_days_sync_index on public.itinerary_days;
drop function if exists public.itinerary_days_sync_index();
drop trigger if exists itinerary_locations_sync_index on public.itinerary_locations;
drop function if exists public.itinerary_locations_sync_index();

-- Every historical date-keyed overload, whatever its exact signature.
do $$
declare
  f record;
begin
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'shift_and_insert_itinerary',
        'set_location_span_with_shift',
        'reschedule_itinerary_days_to'
      )
      and pg_get_function_identity_arguments(p.oid) like '%date%'
  loop
    execute format('drop function public.%I(%s)', f.proname, f.args);
  end loop;
end;
$$;

drop function if exists public.reschedule_dream_itinerary_days(uuid, uuid[]);
drop function if exists public.promote_dream_to_dated(uuid, date);

alter table public.itinerary_days drop column if exists day_date;
alter table public.itinerary_locations
  drop column if exists start_date,
  drop column if exists end_date;

drop table if exists public.dream_itinerary_days;
