-- Seed 7 Lombok expenses matching design_handoff_together_app/mobile-app.jsx
-- INITIAL_EXPENSES. Idempotent: skips if any expenses already exist for the
-- trip. Assigns paid_by based on workspace role — workspace owner ≡ "M",
-- the other trip member ≡ "G". Paste AFTER 20260527000001_phase_3_expenses.sql.

do $$
declare
  v_trip_id uuid;
  v_m uuid;
  v_g uuid;
begin
  select t.id, tm.user_id
    into v_trip_id, v_m
  from public.trips t
  join public.trip_members tm on tm.trip_id = t.id and tm.role = 'owner'
  where t.slug = 'lombok'
  limit 1;

  if v_trip_id is null then
    raise notice 'Lombok trip not found — run the trips migration + seed first.';
    return;
  end if;

  select tm.user_id
    into v_g
  from public.trip_members tm
  where tm.trip_id = v_trip_id and tm.user_id <> v_m
  order by tm.added_at
  limit 1;

  if v_g is null then
    v_g := v_m;
  end if;

  if exists (select 1 from public.expenses where trip_id = v_trip_id) then
    raise notice 'Expenses already exist for trip % — skipping.', v_trip_id;
    return;
  end if;

  insert into public.expenses (trip_id, title, amount_cents, currency, paid_by, category, day_date) values
    (v_trip_id, 'Surfboard rental · 8d',            9600, 'EUR', v_m, 'Surf',    '2026-06-12'),
    (v_trip_id, 'Ferry · Bangsal → Gili Trawangan', 2440, 'EUR', v_g, 'Transit', '2026-06-14'),
    (v_trip_id, 'Padi refresher dive',              7800, 'EUR', v_m, 'Dive',    '2026-06-14'),
    (v_trip_id, 'Warung dinner · Selong',           1820, 'EUR', v_g, 'Food',    '2026-06-13'),
    (v_trip_id, 'Scooter rental · 4d',              4200, 'EUR', v_m, 'Transit', '2026-06-12'),
    (v_trip_id, 'Rinjani trek permit',              8800, 'EUR', v_g, 'Trek',    '2026-06-16'),
    (v_trip_id, 'Beach grill · Mawi',               3250, 'EUR', v_m, 'Food',    '2026-06-13');
end $$;
