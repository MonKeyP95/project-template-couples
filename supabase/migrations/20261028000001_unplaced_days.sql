-- One trip model, step 6a: unplaced days.
--
-- An unplaced day is an itinerary day with day_index null: it keeps its
-- content and location, leaves its block, and is never moved or ordered by
-- the push/span/reorder functions (they only touch day_index >= x or explicit
-- ids). Days that moving a start later pushed below Day 1 become unplaced (or
-- go, when empty), and day numbers below 1 are refused from now on.
-- unplace_days_outside settles the days a dates/length change leaves outside
-- the trip. Idempotent.
--
-- Pre-flight (read-only):
--   select
--     count(*) filter (where coalesce(btrim(title), '') <> '' or coalesce(btrim(sub), '') <> ''
--       or jsonb_array_length(coalesce(events, '[]'::jsonb)) > 0) as planned_below_1,
--     count(*) as all_below_1
--   from public.itinerary_days where day_index < 1;
--   select count(*) as spans_below_1 from public.itinerary_locations where start_index < 1;

create or replace function public.itinerary_day_is_planned(
  p_title text,
  p_sub text,
  p_events jsonb
) returns boolean
language sql
immutable
as $$
  select coalesce(btrim(p_title), '') <> ''
    or coalesce(btrim(p_sub), '') <> ''
    or jsonb_array_length(coalesce(p_events, '[]'::jsonb)) > 0;
$$;

delete from public.itinerary_days
where day_index < 1
  and not public.itinerary_day_is_planned(title, sub, events);

update public.itinerary_days
set day_index = null, group_id = null, group_name = null
where day_index < 1;

update public.itinerary_locations
set start_index = null, end_index = null
where end_index < 1;

update public.itinerary_locations
set start_index = 1
where start_index < 1;

alter table public.itinerary_days
  drop constraint if exists itinerary_days_day_index_positive;
alter table public.itinerary_days
  add constraint itinerary_days_day_index_positive
  check (day_index is null or day_index >= 1);

alter table public.itinerary_locations
  drop constraint if exists itinerary_locations_start_index_positive;
alter table public.itinerary_locations
  add constraint itinerary_locations_start_index_positive
  check (start_index is null or start_index >= 1);

-- In the trip's current numbering, days outside [p_first, p_last] (p_last null
-- = no end) are deleted when empty and unplaced when planned; location spans
-- are trimmed to the range, or cleared when fully outside. Returns the ids
-- that were unplaced, so the caller can delete them once the trip update has
-- gone through.
create or replace function public.unplace_days_outside(
  p_trip_id uuid,
  p_first   int,
  p_last    int
) returns uuid[]
language plpgsql
as $$
declare
  v_ids uuid[];
begin
  delete from public.itinerary_days
  where trip_id = p_trip_id
    and (day_index < p_first or day_index > p_last)
    and not public.itinerary_day_is_planned(title, sub, events);

  with moved as (
    update public.itinerary_days
    set day_index = null, group_id = null, group_name = null
    where trip_id = p_trip_id
      and (day_index < p_first or day_index > p_last)
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from moved;

  update public.itinerary_locations
  set start_index = null, end_index = null
  where trip_id = p_trip_id
    and (end_index < p_first or start_index > p_last);

  update public.itinerary_locations
  set start_index = greatest(start_index, p_first),
      end_index = least(end_index, coalesce(p_last, end_index))
  where trip_id = p_trip_id
    and start_index is not null;

  return v_ids;
end;
$$;

-- Share view: unplaced days are not part of the shared plan.
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
      select count(*) from public.itinerary_days d
      where d.trip_id = t.id and d.day_index is not null
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
        where d.trip_id = t.id and d.day_index is not null
      ) x
    ), '[]'::json)
  )
  from public.trips t
  where t.share_token = p_token
    and t.is_public = true;
$$;

grant execute on function public.shared_trip(text) to anon, authenticated;
