-- New trip flow: a dateless trip knows its length, and promotion keeps positions.
--
-- day_count is set only on dateless trips (a dated trip's length is its dates).
-- With day_count set, dream_itinerary_days.day_index is a real position (Day 3
-- stays Day 3), so promotion puts row k on start + k - 1 and keeps the length.
-- Dreams without day_count keep the old compacting behaviour. Idempotent.

alter table public.trips add column if not exists day_count int;

alter table public.trips drop constraint if exists trips_day_count_check;
alter table public.trips
  add constraint trips_day_count_check check (day_count is null or day_count >= 1);

create or replace function public.promote_dream_to_dated(
  p_trip_id uuid,
  p_start_date date
) returns void
language plpgsql
as $$
declare
  v_count int;
  v_max int;
  v_days int;
begin
  select count(*), max(day_index) into v_count, v_max
  from public.dream_itinerary_days
  where trip_id = p_trip_id;

  if v_count = 0 then
    raise exception 'no dream days to promote for trip %', p_trip_id;
  end if;

  select day_count into v_days from public.trips where id = p_trip_id;

  if v_days is null then
    update public.trips
    set start_date = p_start_date,
        end_date = p_start_date + (v_count - 1),
        fuzzy_when = null
    where id = p_trip_id;

    insert into public.itinerary_days
      (trip_id, day_date, title, sub, tag, tone, created_by)
    select
      d.trip_id,
      p_start_date + (row_number() over (order by d.day_index) - 1)::int,
      d.title, d.sub, d.tag, d.tone, auth.uid()
    from public.dream_itinerary_days d
    where d.trip_id = p_trip_id;
  else
    update public.trips
    set start_date = p_start_date,
        end_date = p_start_date + (greatest(v_days, v_max) - 1),
        fuzzy_when = null,
        day_count = null
    where id = p_trip_id;

    insert into public.itinerary_days
      (trip_id, day_date, title, sub, tag, tone, created_by)
    select
      d.trip_id,
      p_start_date + (d.day_index - 1),
      d.title, d.sub, d.tag, d.tone, auth.uid()
    from public.dream_itinerary_days d
    where d.trip_id = p_trip_id;
  end if;

  delete from public.dream_itinerary_days where trip_id = p_trip_id;
end;
$$;
