-- One trip model, step 1: day numbers alongside dates.
--
-- Itinerary days and location spans get a 1-based day number
-- (day_date - trips.start_date + 1), and every dated trip gets day_count
-- (end_date - start_date + 1). Triggers derive both from the dates on every
-- write, so app actions and the itinerary RPCs stay untouched; step 2 flips the
-- direction. Numbers are nullable and unchecked here: moving a start later
-- still keeps day dates, and dated trips turned dreams keep orphan rows.
-- Clearing a start date leaves the numbers as they were. Idempotent.

alter table public.itinerary_days
  add column if not exists day_index int;

alter table public.itinerary_locations
  add column if not exists start_index int,
  add column if not exists end_index   int;

alter table public.itinerary_locations
  drop constraint if exists itinerary_locations_index_span_chk;
alter table public.itinerary_locations
  add constraint itinerary_locations_index_span_chk
  check (
    (start_index is null and end_index is null)
    or (start_index is not null and end_index is not null and end_index >= start_index)
  );

create or replace function public.itinerary_days_sync_index()
returns trigger
language plpgsql
as $$
declare
  v_start date;
begin
  select start_date into v_start from public.trips where id = new.trip_id;
  if v_start is not null then
    new.day_index := new.day_date - v_start + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists itinerary_days_sync_index on public.itinerary_days;
create trigger itinerary_days_sync_index
  before insert or update of day_date, trip_id on public.itinerary_days
  for each row execute function public.itinerary_days_sync_index();

create or replace function public.itinerary_locations_sync_index()
returns trigger
language plpgsql
as $$
declare
  v_start date;
begin
  select start_date into v_start from public.trips where id = new.trip_id;
  if v_start is not null then
    new.start_index := new.start_date - v_start + 1;
    new.end_index := new.end_date - v_start + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists itinerary_locations_sync_index on public.itinerary_locations;
create trigger itinerary_locations_sync_index
  before insert or update of start_date, end_date, trip_id on public.itinerary_locations
  for each row execute function public.itinerary_locations_sync_index();

create or replace function public.trips_sync_day_count()
returns trigger
language plpgsql
as $$
begin
  if new.start_date is not null and new.end_date is not null then
    new.day_count := new.end_date - new.start_date + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trips_sync_day_count on public.trips;
create trigger trips_sync_day_count
  before insert or update on public.trips
  for each row execute function public.trips_sync_day_count();

create or replace function public.trips_renumber_itinerary()
returns trigger
language plpgsql
as $$
begin
  update public.itinerary_days
  set day_index = day_date - new.start_date + 1
  where trip_id = new.id;

  update public.itinerary_locations
  set start_index = start_date - new.start_date + 1,
      end_index = end_date - new.start_date + 1
  where trip_id = new.id and start_date is not null;
  return null;
end;
$$;

drop trigger if exists trips_renumber_itinerary on public.trips;
create trigger trips_renumber_itinerary
  after update of start_date on public.trips
  for each row
  when (new.start_date is not null and new.start_date is distinct from old.start_date)
  execute function public.trips_renumber_itinerary();

update public.itinerary_days d
set day_index = d.day_date - t.start_date + 1
from public.trips t
where t.id = d.trip_id and t.start_date is not null
  and d.day_index is distinct from d.day_date - t.start_date + 1;

update public.itinerary_locations l
set start_index = l.start_date - t.start_date + 1,
    end_index = l.end_date - t.start_date + 1
from public.trips t
where t.id = l.trip_id and t.start_date is not null and l.start_date is not null
  and (l.start_index is distinct from l.start_date - t.start_date + 1
    or l.end_index is distinct from l.end_date - t.start_date + 1);

update public.trips
set day_count = end_date - start_date + 1
where start_date is not null and end_date is not null
  and day_count is distinct from end_date - start_date + 1;

alter table public.itinerary_days
  drop constraint if exists itinerary_days_trip_id_day_index_key;
alter table public.itinerary_days
  add constraint itinerary_days_trip_id_day_index_key
  unique (trip_id, day_index) deferrable initially immediate;
