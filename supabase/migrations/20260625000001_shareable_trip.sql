-- Shareable trip: publish a trip as a public, read-only itinerary.
-- One read-only security-definer projection function is the ONLY thing anon
-- can touch; base tables stay closed. Copying needs no privileged write (the
-- copier inserts under their own RLS). Idempotent: safe to paste-and-run.

-- 1. Share handle on trips.
alter table public.trips
  add column if not exists share_token text,
  add column if not exists is_public boolean not null default false,
  add column if not exists shared_at timestamptz;

-- Unguessable token is the capability; unique so a lookup is unambiguous.
create unique index if not exists trips_share_token_key
  on public.trips (share_token)
  where share_token is not null;

-- 2. Safe projection. SECURITY DEFINER so it can read across RLS, but it only
-- ever selects itinerary skeleton fields: no day_date, no created_by, no member
-- join, and it never touches expenses/budget/savings tables. Returns null when
-- the token is unknown or the trip is not currently public.
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
          row_number() over (order by d.day_date) as ordinal,
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

-- Anyone (signed in or not) may read a shared projection; nothing else opens up.
grant execute on function public.shared_trip(text) to anon, authenticated;
