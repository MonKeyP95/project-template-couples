-- Seed the 17-item packing fixture for the Lombok trip.
-- Idempotent: skips if any packing_items already exist for that trip.
-- Paste AFTER 20260526000003_phase_3_packing.sql.

do $$
declare
  v_trip_id uuid;
  v_added_by uuid;
begin
  select t.id, tm.user_id
    into v_trip_id, v_added_by
  from public.trips t
  join public.trip_members tm on tm.trip_id = t.id
  where t.slug = 'lombok'
  order by case tm.role when 'owner' then 0 else 1 end, tm.user_id
  limit 1;

  if v_trip_id is null then
    raise notice 'Lombok trip not found — run the trips migration + seed first.';
    return;
  end if;

  if exists (select 1 from public.packing_items where trip_id = v_trip_id) then
    raise notice 'Packing items already exist for trip % — skipping.', v_trip_id;
    return;
  end if;

  insert into public.packing_items (trip_id, category, label, done, added_by) values
    (v_trip_id, 'Surf kit',  '3/2mm wetsuit',           true,  v_added_by),
    (v_trip_id, 'Surf kit',  'Surf wax (warm)',         true,  v_added_by),
    (v_trip_id, 'Surf kit',  'Leash + spare',           false, v_added_by),
    (v_trip_id, 'Surf kit',  'Reef booties',            false, v_added_by),
    (v_trip_id, 'Dive kit',  'Mask + snorkel',          true,  v_added_by),
    (v_trip_id, 'Dive kit',  'Logbook + pen',           false, v_added_by),
    (v_trip_id, 'Dive kit',  'Dive computer',           true,  v_added_by),
    (v_trip_id, 'Trek',      'Approach shoes (Rinjani)', false, v_added_by),
    (v_trip_id, 'Trek',      'Headlamp + spare batt.',  false, v_added_by),
    (v_trip_id, 'Trek',      'Insulated layer',         false, v_added_by),
    (v_trip_id, 'Everyday',  'Reef-safe SPF 50',        true,  v_added_by),
    (v_trip_id, 'Everyday',  'Linen shirts x3',         true,  v_added_by),
    (v_trip_id, 'Everyday',  'Sandals',                 false, v_added_by),
    (v_trip_id, 'Everyday',  'Filter water bottle',     false, v_added_by),
    (v_trip_id, 'Documents', 'Passports (6mo+ valid)',  true,  v_added_by),
    (v_trip_id, 'Documents', 'Dive insurance card',     false, v_added_by),
    (v_trip_id, 'Documents', 'Visa on arrival fee EUR 25', false, v_added_by);

  raise notice 'Seeded 17 packing items for trip %.', v_trip_id;
end$$;
