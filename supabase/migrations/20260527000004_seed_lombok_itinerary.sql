-- Seed the 8-day itinerary fixture for the Lombok trip.
-- Idempotent: skips if any itinerary_days already exist for that trip.
-- Paste AFTER 20260527000003_phase_3_itinerary.sql.

do $$
declare
  v_trip_id uuid;
  v_created_by uuid;
begin
  select t.id, tm.user_id
    into v_trip_id, v_created_by
  from public.trips t
  join public.trip_members tm on tm.trip_id = t.id
  where t.slug = 'lombok'
  order by case tm.role when 'owner' then 0 else 1 end, tm.user_id
  limit 1;

  if v_trip_id is null then
    raise notice 'Lombok trip not found — run the trips migration + seed first.';
    return;
  end if;

  if exists (select 1 from public.itinerary_days where trip_id = v_trip_id) then
    raise notice 'Itinerary days already exist for trip % — skipping.', v_trip_id;
    return;
  end if;

  insert into public.itinerary_days (trip_id, day_date, title, sub, tag, tone, created_by) values
    (v_trip_id, date '2026-06-12', 'Land in Mataram',     'Pickup → south to Kuta. Sunset at Mandalika.',     'ARRIVE',  'sand', v_created_by),
    (v_trip_id, date '2026-06-13', 'Selong Belanak',      'Long lefts. Lunch at the warung. Mawi at golden.', 'SURF',    'sea',  v_created_by),
    (v_trip_id, date '2026-06-14', 'Gili Trawangan',      'Ferry 09:00. Refresher dive + snorkel turtles.',   'DIVE',    'sea',  v_created_by),
    (v_trip_id, date '2026-06-15', 'Gili Meno · slow',    'Hammock day. Sunset dive 17:00.',                  'DIVE',    'sea',  v_created_by),
    (v_trip_id, date '2026-06-16', 'Senaru gateway',      'Return to Lombok. Drive to Senaru. Pre-trek brief.', 'TRANSIT', 'clay', v_created_by),
    (v_trip_id, date '2026-06-17', 'Rinjani · ascent',    'Sembalun route. Camp at 2,639m. Cold night.',      'TREK',    'moss', v_created_by),
    (v_trip_id, date '2026-06-18', 'Rinjani · summit',    '02:30 push. 3,726m. Descent to crater lake.',      'TREK',    'moss', v_created_by),
    (v_trip_id, date '2026-06-19', 'Slow morning + fly',  'Hot springs, drive south, evening flight.',        'DEPART',  'sand', v_created_by);

  raise notice 'Seeded 8 itinerary days for trip %.', v_trip_id;
end$$;
