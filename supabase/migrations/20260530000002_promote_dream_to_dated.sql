-- Slice B.2: promote a dream (with planned days) to a dated trip.
--
-- Atomically: set the trip's dates (start = given, end = start + count - 1) and
-- clear fuzzy_when; move each dream_itinerary_days row onto a consecutive date
-- in day_index order; delete the dream rows. SECURITY INVOKER so the caller's
-- RLS still gates every write; converted rows are stamped created_by = auth.uid()
-- to satisfy the itinerary_days insert policy. Idempotent (create or replace).

create or replace function public.promote_dream_to_dated(
  p_trip_id uuid,
  p_start_date date
) returns void
language plpgsql
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.dream_itinerary_days
  where trip_id = p_trip_id;

  if v_count = 0 then
    raise exception 'no dream days to promote for trip %', p_trip_id;
  end if;

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
    d.title,
    d.sub,
    d.tag,
    d.tone,
    auth.uid()
  from public.dream_itinerary_days d
  where d.trip_id = p_trip_id;

  delete from public.dream_itinerary_days where trip_id = p_trip_id;
end;
$$;
