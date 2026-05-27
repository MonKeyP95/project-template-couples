-- Seeds the Lombok fixture trip into the first workspace it finds.
-- Idempotent: re-running is a no-op if (workspace_id, slug='lombok') already exists.
-- Paste once into Supabase SQL Editor AFTER 20260526000001_phase_3_trips.sql.

do $$
declare
  v_workspace_id uuid;
  v_user_id uuid;
  v_trip_id uuid;
begin
  -- Pick the oldest workspace that has at least one member. In MVP each user
  -- belongs to exactly one workspace, so this is unambiguous.
  select w.id, wm.user_id
    into v_workspace_id, v_user_id
  from public.workspaces w
  join public.workspace_members wm on wm.workspace_id = w.id
  order by w.created_at asc, wm.role desc, wm.user_id asc
  limit 1;

  if v_workspace_id is null then
    raise notice 'No workspace found — skipping Lombok seed.';
    return;
  end if;

  if exists (
    select 1 from public.trips
    where workspace_id = v_workspace_id and slug = 'lombok'
  ) then
    raise notice 'Lombok trip already exists in workspace % — skipping.', v_workspace_id;
    return;
  end if;

  insert into public.trips (
    workspace_id, slug, name, country, start_date, end_date, lat, lng, created_by
  )
  values (
    v_workspace_id, 'lombok', 'Lombok', 'Indonesia',
    date '2026-06-12', date '2026-06-20',
    -8.7, 116.3,
    v_user_id
  )
  returning id into v_trip_id;

  insert into public.trip_members (trip_id, user_id, role)
  select v_trip_id, wm.user_id, wm.role
  from public.workspace_members wm
  where wm.workspace_id = v_workspace_id;

  raise notice 'Seeded Lombok trip % into workspace %.', v_trip_id, v_workspace_id;
end$$;
