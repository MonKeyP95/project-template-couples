-- One trip model, step 3b: dreams move into itinerary_days.
--
-- A dream's days are copied from dream_itinerary_days into itinerary_days with
-- no date (day_date becomes nullable until step 4 drops it). Giving a dream
-- dates no longer moves rows: the start-date trigger derives each day's date
-- from its number when the old start was null. promote_dream_to_dated is
-- rewritten so the deployed code, which still calls it, rebuilds the copy from
-- the dream rows and sets the dates without inserting a second copy. The 3b
-- code never calls it. dream_itinerary_days is left in place for step 4.
-- Idempotent.

alter table public.itinerary_days alter column day_date drop not null;

create or replace function public.trips_renumber_itinerary()
returns trigger
language plpgsql
as $$
begin
  if old.start_date is null then
    update public.itinerary_days
    set day_date = new.start_date + day_index - 1
    where trip_id = new.id and day_index is not null;

    update public.itinerary_locations
    set start_date = new.start_date + start_index - 1,
        end_date = new.start_date + end_index - 1
    where trip_id = new.id and start_index is not null;
    return null;
  end if;

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

-- Copy only into dreams with no itinerary rows yet, so a re-run is a no-op once
-- the app has written. An older dream without day_count is compacted to 1..k.
insert into public.itinerary_days
  (trip_id, day_index, title, sub, events, tag, tone, created_by)
select
  r.trip_id,
  case
    when t.day_count is null
      then row_number() over (partition by r.trip_id order by r.day_index)::int
    else r.day_index
  end,
  r.title, coalesce(r.sub, ''), '[]'::jsonb, r.tag, r.tone, r.created_by
from public.dream_itinerary_days r
join public.trips t on t.id = r.trip_id and t.start_date is null
where not exists (
  select 1 from public.itinerary_days d where d.trip_id = r.trip_id
);

update public.trips t
set day_count = x.last
from (
  select trip_id, max(day_index) as last
  from public.itinerary_days
  group by trip_id
) x
where x.trip_id = t.id
  and t.start_date is null
  and x.last > coalesce(t.day_count, 0);

create or replace function public.promote_dream_to_dated(
  p_trip_id uuid,
  p_start_date date
) returns void
language plpgsql
as $$
declare
  v_len int;
begin
  -- Only the deployed (pre-3b) code calls this, and it still writes dream days
  -- to dream_itinerary_days, so those rows are the truth: rebuild the copy.
  delete from public.itinerary_days where trip_id = p_trip_id;
  insert into public.itinerary_days
    (trip_id, day_index, title, sub, events, tag, tone, created_by)
  select
    r.trip_id,
    case
      when t.day_count is null
        then row_number() over (order by r.day_index)::int
      else r.day_index
    end,
    r.title, coalesce(r.sub, ''), '[]'::jsonb, r.tag, r.tone, r.created_by
  from public.dream_itinerary_days r
  join public.trips t on t.id = r.trip_id
  where r.trip_id = p_trip_id;

  select greatest(
    coalesce(t.day_count, 0),
    coalesce((select max(day_index) from public.itinerary_days where trip_id = p_trip_id), 0),
    1
  ) into v_len
  from public.trips t
  where t.id = p_trip_id;

  update public.trips
  set start_date = p_start_date,
      end_date = p_start_date + v_len - 1,
      fuzzy_when = null
  where id = p_trip_id;

  delete from public.dream_itinerary_days where trip_id = p_trip_id;
end;
$$;
