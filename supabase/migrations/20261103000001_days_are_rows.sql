-- Every day of a trip is a real itinerary_days row.
--
-- Days 1..length always have a row; an empty ("blank") day is a row with no
-- title, sub or events (not itinerary_day_is_planned). sync_trip_days keeps
-- that true and runs from triggers, so writers don't have to: it fills
-- missing numbers with blanks, removes blanks that are unplaced, past the end
-- or sharing a number with another day, and files each blank under the
-- location that owns its number. Length = greatest(day_count, last planned
-- day), so blanks never stretch a trip.
--
-- The (trip_id, day_index) unique becomes initially deferred: a planned day
-- may be written onto a blank's number and the statement trigger removes the
-- blank before commit. Two planned days on one number still fail (23505 at
-- commit). The push/span/keep-dates functions shift planned days only, so a
-- blank counts as a gap, as a missing row did before. Idempotent.

alter table public.itinerary_days
  drop constraint if exists itinerary_days_trip_id_day_index_key;
alter table public.itinerary_days
  add constraint itinerary_days_trip_id_day_index_key
  unique (trip_id, day_index) deferrable initially deferred;

-- The location that owns day p_index: the one whose declared span covers it,
-- else the unspanned one whose planned days run around it, else none.
create or replace function public.itinerary_position_owner(
  p_trip_id uuid,
  p_index   int
) returns uuid
language sql
stable
as $$
  select coalesce(
    (
      select l.id from public.itinerary_locations l
      where l.trip_id = p_trip_id
        and l.start_index <= p_index and p_index <= l.end_index
      order by l.sort_order
      limit 1
    ),
    (
      select l.id from public.itinerary_locations l
      join public.itinerary_days d
        on d.location_id = l.id
       and d.day_index is not null
       and public.itinerary_day_is_planned(d.title, d.sub, d.events)
      where l.trip_id = p_trip_id and l.start_index is null
      group by l.id, l.sort_order
      having min(d.day_index) <= p_index and p_index <= max(d.day_index)
      order by l.sort_order
      limit 1
    )
  );
$$;

create or replace function public.sync_trip_days(p_trip_id uuid)
returns void
language plpgsql
as $$
declare
  v_len int;
begin
  select greatest(coalesce(t.day_count, 0), coalesce(max(d.day_index), 0))
  into v_len
  from public.trips t
  left join public.itinerary_days d
    on d.trip_id = t.id
   and public.itinerary_day_is_planned(d.title, d.sub, d.events)
  where t.id = p_trip_id
  group by t.day_count;

  if v_len is null then
    return;
  end if;

  delete from public.itinerary_days b
  where b.trip_id = p_trip_id
    and not public.itinerary_day_is_planned(b.title, b.sub, b.events)
    and (
      b.day_index is null
      or b.day_index > v_len
      or exists (
        select 1 from public.itinerary_days o
        where o.trip_id = b.trip_id
          and o.day_index = b.day_index
          and o.id <> b.id
          and (public.itinerary_day_is_planned(o.title, o.sub, o.events) or o.id < b.id)
      )
    );

  insert into public.itinerary_days (trip_id, day_index, tone, created_by)
  select p_trip_id, g, 'sand', coalesce(auth.uid(), t.created_by)
  from public.trips t
  cross join generate_series(1, v_len) as g
  where t.id = p_trip_id
    and not exists (
      select 1 from public.itinerary_days d
      where d.trip_id = p_trip_id and d.day_index = g
    );

  update public.itinerary_days b
  set location_id = public.itinerary_position_owner(p_trip_id, b.day_index)
  where b.trip_id = p_trip_id
    and not public.itinerary_day_is_planned(b.title, b.sub, b.events)
    and b.location_id is distinct from public.itinerary_position_owner(p_trip_id, b.day_index);
end;
$$;

-- Statement triggers: one sync per touched trip. Writes made by the sync
-- itself (trigger depth > 1) don't re-trigger it.
create or replace function public.sync_trip_days_after_statement()
returns trigger
language plpgsql
as $$
declare
  v_trip uuid;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  for v_trip in select distinct trip_id from changed loop
    perform public.sync_trip_days(v_trip);
  end loop;
  return null;
end;
$$;

drop trigger if exists itinerary_days_sync_insert on public.itinerary_days;
create trigger itinerary_days_sync_insert
  after insert on public.itinerary_days
  referencing new table as changed
  for each statement execute function public.sync_trip_days_after_statement();

drop trigger if exists itinerary_days_sync_update on public.itinerary_days;
create trigger itinerary_days_sync_update
  after update on public.itinerary_days
  referencing new table as changed
  for each statement execute function public.sync_trip_days_after_statement();

drop trigger if exists itinerary_days_sync_delete on public.itinerary_days;
create trigger itinerary_days_sync_delete
  after delete on public.itinerary_days
  referencing old table as changed
  for each statement execute function public.sync_trip_days_after_statement();

drop trigger if exists itinerary_locations_sync_insert on public.itinerary_locations;
create trigger itinerary_locations_sync_insert
  after insert on public.itinerary_locations
  referencing new table as changed
  for each statement execute function public.sync_trip_days_after_statement();

drop trigger if exists itinerary_locations_sync_update on public.itinerary_locations;
create trigger itinerary_locations_sync_update
  after update on public.itinerary_locations
  referencing new table as changed
  for each statement execute function public.sync_trip_days_after_statement();

drop trigger if exists itinerary_locations_sync_delete on public.itinerary_locations;
create trigger itinerary_locations_sync_delete
  after delete on public.itinerary_locations
  referencing old table as changed
  for each statement execute function public.sync_trip_days_after_statement();

create or replace function public.trips_sync_days()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  perform public.sync_trip_days(new.id);
  return null;
end;
$$;

drop trigger if exists trips_sync_days on public.trips;
create trigger trips_sync_days
  after insert or update of start_date, end_date, day_count on public.trips
  for each row execute function public.trips_sync_days();

-- Push: as before, with blanks counted as gaps (planned days only).
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
  select min(day_index) into v_first
  from public.itinerary_days
  where trip_id = p_trip_id and day_index >= p_from_index
    and public.itinerary_day_is_planned(title, sub, events);

  v_shift := case
    when v_first is null then 0
    else greatest(0, p_count - (v_first - p_from_index))
  end;

  update public.itinerary_days
  set day_index = day_index + v_shift
  where trip_id = p_trip_id and day_index >= p_from_index
    and public.itinerary_day_is_planned(title, sub, events);

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
    (select max(day_index) from public.itinerary_days
      where trip_id = p_trip_id and public.itinerary_day_is_planned(title, sub, events)),
    (select max(end_index) from public.itinerary_locations where trip_id = p_trip_id)
  ) into v_len;

  update public.trips
  set day_count = v_len, end_date = start_date + v_len - 1
  where id = p_trip_id;
end;
$$;

-- Span with push: as before, with blanks counted as gaps.
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
  select min(d) into v_first from (
    select min(day_index) as d
    from public.itinerary_days
    where trip_id = p_trip_id and day_index >= p_start_index
      and location_id is distinct from p_location_id
      and public.itinerary_day_is_planned(title, sub, events)
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
    and location_id is distinct from p_location_id
    and public.itinerary_day_is_planned(title, sub, events);

  update public.itinerary_locations
  set start_index = start_index + v_shift,
      end_index   = end_index + v_shift
  where trip_id = p_trip_id and id <> p_location_id and start_index >= p_start_index;

  update public.itinerary_locations
  set name = p_name, start_index = p_start_index, end_index = p_end_index
  where id = p_location_id;

  select greatest(
    (select day_count from public.trips where id = p_trip_id),
    (select max(day_index) from public.itinerary_days
      where trip_id = p_trip_id and public.itinerary_day_is_planned(title, sub, events)),
    (select max(end_index) from public.itinerary_locations where trip_id = p_trip_id)
  ) into v_len;

  update public.trips
  set day_count = v_len, end_date = start_date + v_len - 1
  where id = p_trip_id;
end;
$$;

-- Keep the dates: planned days and spans shift; blanks are recomputed.
create or replace function public.shift_trip_days(
  p_trip_id uuid,
  p_shift   int
) returns void
language plpgsql
as $$
begin
  update public.itinerary_days
  set day_index = day_index + p_shift
  where trip_id = p_trip_id and day_index is not null
    and public.itinerary_day_is_planned(title, sub, events);

  update public.itinerary_locations
  set start_index = start_index + p_shift,
      end_index = end_index + p_shift
  where trip_id = p_trip_id and start_index is not null;
end;
$$;

-- Backfill every trip.
select public.sync_trip_days(id) from public.trips;

-- Checks (each should return no rows):
--
-- 1. Trips whose placed rows don't match their length.
--   select t.name, t.day_count, count(d.id) as rows
--   from public.trips t
--   left join public.itinerary_days d on d.trip_id = t.id and d.day_index is not null
--   group by t.id
--   having count(d.id) <> greatest(coalesce(t.day_count, 0), coalesce(max(d.day_index), 0))
--       or count(distinct d.day_index) <> count(d.id);
--
-- 2. Blanks that are unplaced or past the end.
--   select d.trip_id, d.day_index from public.itinerary_days d
--   join public.trips t on t.id = d.trip_id
--   where not public.itinerary_day_is_planned(d.title, d.sub, d.events)
--     and (d.day_index is null or d.day_index > greatest(coalesce(t.day_count, 0),
--       (select coalesce(max(p.day_index), 0) from public.itinerary_days p
--        where p.trip_id = t.id and public.itinerary_day_is_planned(p.title, p.sub, p.events))));
