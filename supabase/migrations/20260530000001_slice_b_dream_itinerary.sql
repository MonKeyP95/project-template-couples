-- Slice B: itinerary for dreams (numbered days).
--
-- Dateless dream trips get a parallel, position-keyed itinerary. The dated
-- itinerary_days table is untouched. Mirrors the itinerary_days shape but keyed
-- on (trip_id, day_index) instead of (trip_id, day_date). Idempotent.

create table if not exists public.dream_itinerary_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_index int not null,
  title text not null check (length(trim(title)) > 0),
  sub text,
  tag text not null check (length(trim(tag)) > 0),
  tone text not null check (tone in ('sea', 'clay', 'moss', 'sand')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists dream_itinerary_days_trip_idx
  on public.dream_itinerary_days (trip_id, day_index);

-- Deferrable so the reorder RPC can permute indices in one statement without
-- tripping the per-statement unique check. INITIALLY IMMEDIATE keeps add/edit
-- fail-fast; only the RPC opts into deferral.
alter table public.dream_itinerary_days
  drop constraint if exists dream_itinerary_days_trip_id_day_index_key;
alter table public.dream_itinerary_days
  add constraint dream_itinerary_days_trip_id_day_index_key
  unique (trip_id, day_index) deferrable initially immediate;

alter table public.dream_itinerary_days enable row level security;

drop policy if exists dream_itinerary_days_select on public.dream_itinerary_days;
create policy dream_itinerary_days_select on public.dream_itinerary_days
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists dream_itinerary_days_insert on public.dream_itinerary_days;
create policy dream_itinerary_days_insert on public.dream_itinerary_days
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );

drop policy if exists dream_itinerary_days_update on public.dream_itinerary_days;
create policy dream_itinerary_days_update on public.dream_itinerary_days
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));

drop policy if exists dream_itinerary_days_delete on public.dream_itinerary_days;
create policy dream_itinerary_days_delete on public.dream_itinerary_days
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- Realtime broadcasts for partner sync (matches itinerary_days). Idempotent via
-- the do-block that swallows duplicate_object on re-run.
do $$
begin
  alter publication supabase_realtime add table public.dream_itinerary_days;
exception
  when duplicate_object then null;
end $$;

-- Atomic insertion-shift reorder. SECURITY INVOKER (default) so caller RLS still
-- gates. Existing day_index values sorted are the slots; day_ids[i] takes slot[i].
create or replace function public.reschedule_dream_itinerary_days(
  p_trip_id uuid,
  p_day_ids uuid[]
) returns void
language plpgsql
as $$
declare
  v_indexes int[];
begin
  set constraints all deferred;

  select array_agg(day_index order by day_index)
    into v_indexes
  from public.dream_itinerary_days
  where trip_id = p_trip_id;

  if array_length(v_indexes, 1) is distinct from array_length(p_day_ids, 1) then
    raise exception 'reschedule id count % does not match day count %',
      array_length(p_day_ids, 1), array_length(v_indexes, 1);
  end if;

  update public.dream_itinerary_days d
  set day_index = m.new_index
  from (
    select i.id, ix.new_index
    from unnest(p_day_ids) with ordinality as i(id, ord)
    join unnest(v_indexes) with ordinality as ix(new_index, ord) using (ord)
  ) m
  where d.id = m.id and d.trip_id = p_trip_id;
end;
$$;
