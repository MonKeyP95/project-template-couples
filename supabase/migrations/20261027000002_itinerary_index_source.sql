-- One trip model, step 2: day numbers become the source.
--
-- The step 1 triggers become two-way: a changed index derives the date, and a
-- date-only write (old app code, the date RPCs, promotion, the start-date
-- renumber) derives the index. Either way both stay in sync, so the deployed
-- app keeps working the moment this is pasted. The three moving RPCs gain
-- index overloads beside the date ones (PostgREST picks by argument names);
-- length now grows through trips.day_count with end_date following. The date
-- overloads, date columns and these triggers go in step 4. The unused
-- reschedule_itinerary_days(uuid, uuid[]) is dropped. Idempotent.

create or replace function public.itinerary_days_sync_index()
returns trigger
language plpgsql
as $$
declare
  v_start date;
begin
  select start_date into v_start from public.trips where id = new.trip_id;
  if v_start is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.day_index is not null then
      new.day_date := v_start + new.day_index - 1;
    else
      new.day_index := new.day_date - v_start + 1;
    end if;
  elsif new.day_index is distinct from old.day_index then
    new.day_date := v_start + new.day_index - 1;
  else
    new.day_index := new.day_date - v_start + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists itinerary_days_sync_index on public.itinerary_days;
create trigger itinerary_days_sync_index
  before insert or update of day_index, day_date, trip_id on public.itinerary_days
  for each row execute function public.itinerary_days_sync_index();

create or replace function public.itinerary_locations_sync_index()
returns trigger
language plpgsql
as $$
declare
  v_start date;
begin
  select start_date into v_start from public.trips where id = new.trip_id;
  if v_start is null then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.start_index is not null)
    or (tg_op = 'UPDATE' and (new.start_index, new.end_index)
          is distinct from (old.start_index, old.end_index)) then
    new.start_date := v_start + new.start_index - 1;
    new.end_date := v_start + new.end_index - 1;
  else
    new.start_index := new.start_date - v_start + 1;
    new.end_index := new.end_date - v_start + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists itinerary_locations_sync_index on public.itinerary_locations;
create trigger itinerary_locations_sync_index
  before insert or update of start_index, end_index, start_date, end_date, trip_id
  on public.itinerary_locations
  for each row execute function public.itinerary_locations_sync_index();

-- Confirm-and-push on day numbers. Same gap-aware shift as the date version.
create or replace function public.shift_and_insert_itinerary(
  p_trip_id     uuid,
  p_from_index  int,
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
  v_first int;
  v_shift int;
  v_len   int;
begin
  set constraints all deferred;

  select min(day_index) into v_first
  from public.itinerary_days
  where trip_id = p_trip_id and day_index >= p_from_index;

  v_shift := case
    when v_first is null then 0
    else greatest(0, p_count - (v_first - p_from_index))
  end;

  update public.itinerary_days
  set day_index = day_index + v_shift
  where trip_id = p_trip_id and day_index >= p_from_index;

  insert into public.itinerary_days
    (trip_id, day_index, title, sub, events, tag, tone,
     group_id, group_name, location_id, created_by)
  select
    p_trip_id, p_from_index + g, p_title, p_sub, coalesce(p_events, '[]'::jsonb), p_tag, p_tone,
    v_group, v_name, p_location_id, v_uid
  from generate_series(0, p_count - 1) as g;

  update public.itinerary_locations
  set start_index = start_index + v_shift,
      end_index   = end_index + v_shift
  where trip_id = p_trip_id
    and id is distinct from p_location_id
    and start_index >= p_from_index;

  update public.itinerary_locations
  set start_index = least(start_index, p_from_index),
      end_index   = end_index + v_shift
  where trip_id = p_trip_id
    and (id = p_location_id or start_index < p_from_index)
    and end_index >= p_from_index;

  select greatest(
    (select day_count from public.trips where id = p_trip_id),
    (select max(day_index) from public.itinerary_days where trip_id = p_trip_id),
    (select max(end_index) from public.itinerary_locations where trip_id = p_trip_id)
  ) into v_len;

  update public.trips
  set day_count = v_len, end_date = start_date + v_len - 1
  where id = p_trip_id;
end;
$$;

-- Location span with push, on day numbers. Same as the date version.
create or replace function public.set_location_span_with_shift(
  p_location_id uuid,
  p_trip_id     uuid,
  p_name        text,
  p_start_index int,
  p_end_index   int
) returns void
language plpgsql
as $$
declare
  v_count int := (p_end_index - p_start_index) + 1;
  v_first int;
  v_shift int;
  v_len   int;
begin
  set constraints all deferred;

  select min(d) into v_first from (
    select min(day_index) as d
    from public.itinerary_days
    where trip_id = p_trip_id and day_index >= p_start_index
      and location_id is distinct from p_location_id
    union all
    select min(start_index) as d
    from public.itinerary_locations
    where trip_id = p_trip_id and id <> p_location_id and start_index >= p_start_index
  ) x;

  v_shift := case
    when v_first is null then 0
    else greatest(0, v_count - (v_first - p_start_index))
  end;

  update public.itinerary_days
  set day_index = day_index + v_shift
  where trip_id = p_trip_id and day_index >= p_start_index
    and location_id is distinct from p_location_id;

  update public.itinerary_locations
  set start_index = start_index + v_shift,
      end_index   = end_index + v_shift
  where trip_id = p_trip_id and id <> p_location_id and start_index >= p_start_index;

  update public.itinerary_locations
  set name = p_name, start_index = p_start_index, end_index = p_end_index
  where id = p_location_id;

  select greatest(
    (select day_count from public.trips where id = p_trip_id),
    (select max(day_index) from public.itinerary_days where trip_id = p_trip_id),
    (select max(end_index) from public.itinerary_locations where trip_id = p_trip_id)
  ) into v_len;

  update public.trips
  set day_count = v_len, end_date = start_date + v_len - 1
  where id = p_trip_id;
end;
$$;

-- Drag: each day id takes the day number at the same position.
create or replace function public.reschedule_itinerary_days_to(
  p_trip_id uuid,
  p_day_ids uuid[],
  p_indexes int[]
) returns void
language plpgsql
as $$
begin
  set constraints all deferred;

  if array_length(p_day_ids, 1) is distinct from array_length(p_indexes, 1) then
    raise exception 'reschedule id count % does not match index count %',
      array_length(p_day_ids, 1), array_length(p_indexes, 1);
  end if;

  update public.itinerary_days d
  set day_index = m.new_index
  from (
    select i.id, ix.new_index
    from unnest(p_day_ids) with ordinality as i(id, ord)
    join unnest(p_indexes) with ordinality as ix(new_index, ord) using (ord)
  ) m
  where d.id = m.id and d.trip_id = p_trip_id;
end;
$$;

drop function if exists public.reschedule_itinerary_days(uuid, uuid[]);

-- Share view: days ordered by day number. Otherwise unchanged.
create or replace function public.shared_trip(p_token text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'name', t.name,
    'country', t.country,
    'day_count', (
      select count(*) from public.itinerary_days d where d.trip_id = t.id
    ),
    'locations', coalesce((
      select json_agg(
        json_build_object('name', l.name, 'sort_order', l.sort_order)
        order by l.sort_order
      )
      from public.itinerary_locations l
      where l.trip_id = t.id
    ), '[]'::json),
    'days', coalesce((
      select json_agg(
        json_build_object(
          'ordinal', x.ordinal,
          'title', x.title,
          'tag', x.tag,
          'tone', x.tone,
          'location_name', x.location_name,
          'events', x.events
        )
        order by x.ordinal
      )
      from (
        select
          row_number() over (order by d.day_index) as ordinal,
          d.title,
          d.tag,
          d.tone,
          d.events,
          (select l.name from public.itinerary_locations l where l.id = d.location_id) as location_name
        from public.itinerary_days d
        where d.trip_id = t.id
      ) x
    ), '[]'::json)
  )
  from public.trips t
  where t.share_token = p_token
    and t.is_public = true;
$$;

grant execute on function public.shared_trip(text) to anon, authenticated;
