-- Phase 4: seed four dream rows for every workspace that has Lombok seeded.
-- Idempotent via unique (workspace_id, slug). Pattern mirrors
-- 20260526000002_seed_lombok.sql.

do $$
declare
  ws_id uuid;
  owner_id uuid;
  dream record;
begin
  for ws_id in
    select distinct workspace_id
    from public.trips
    where slug = 'lombok'
  loop
    -- Pick any workspace member as created_by (we don't have auth.uid() in the
    -- SQL Editor). Prefer the workspace owner if present.
    select user_id into owner_id
    from public.workspace_members
    where workspace_id = ws_id
    order by case when role = 'owner' then 0 else 1 end, joined_at asc
    limit 1;

    if owner_id is null then
      continue;
    end if;

    for dream in
      select * from (values
        ('faroe-islands',  'Faroe Islands', 'Faroe Islands',  62.0, -6.8),
        ('patagonia',      'Patagonia',     'Argentina',     -50.0, -73.0),
        ('hokkaido',       'Hokkaido',      'Japan',           43.0, 142.0),
        ('aeolian-isles',  'Aeolian Isles', 'Italy',           38.5, 14.9)
      ) as t(slug, name, country, lat, lng)
    loop
      insert into public.trips (
        workspace_id, slug, name, country, lat, lng,
        start_date, end_date, fuzzy_when, created_by
      )
      values (
        ws_id, dream.slug, dream.name, dream.country,
        dream.lat::numeric(7,4), dream.lng::numeric(7,4),
        null, null, 'someday', owner_id
      )
      on conflict (workspace_id, slug) do nothing;

      -- Add every workspace member as a trip_member so RLS sees them.
      insert into public.trip_members (trip_id, user_id, role)
      select t.id, wm.user_id, 'member'
      from public.trips t
      join public.workspace_members wm on wm.workspace_id = t.workspace_id
      where t.workspace_id = ws_id
        and t.slug = dream.slug
      on conflict (trip_id, user_id) do nothing;
    end loop;
  end loop;
end$$;
