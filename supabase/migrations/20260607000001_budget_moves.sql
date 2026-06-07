-- Budget-move log: a dated record of each budget reallocation between location
-- envelopes (or the unallocated pool). An allocation event, NOT spend -- never
-- counted toward expenses or settle-up. from/to null = the unallocated pool (a
-- since-deleted location also reads null -> rendered "Unallocated"). RLS mirrors
-- trip_savings_contributions. Idempotent: safe to paste-and-run repeatedly.

create table if not exists public.trip_budget_moves (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references public.trips(id) on delete cascade,
  from_location_id uuid references public.itinerary_locations(id) on delete set null,
  to_location_id   uuid references public.itinerary_locations(id) on delete set null,
  amount_cents     integer not null check (amount_cents > 0),
  created_by       uuid not null references auth.users(id) on delete restrict,
  created_at       timestamptz not null default now()
);

create index if not exists trip_budget_moves_trip_idx
  on public.trip_budget_moves (trip_id, created_at desc);

alter table public.trip_budget_moves enable row level security;

drop policy if exists budget_moves_select on public.trip_budget_moves;
create policy budget_moves_select on public.trip_budget_moves
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists budget_moves_insert on public.trip_budget_moves;
create policy budget_moves_insert on public.trip_budget_moves
  for insert to authenticated
  with check (
    public.is_trip_workspace_member(trip_id)
    and created_by = auth.uid()
  );

drop policy if exists budget_moves_delete on public.trip_budget_moves;
create policy budget_moves_delete on public.trip_budget_moves
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- Re-create the move RPC so it also logs the move, atomically with the budget
-- change (same transaction). auth.uid() is the caller under SECURITY INVOKER.
create or replace function public.move_location_budget(
  p_trip_id uuid,
  p_from    uuid,
  p_to      uuid,
  p_amount  integer
) returns void
language plpgsql
as $$
declare
  v_from_budget integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;

  if p_from is not null then
    select budget_cents into v_from_budget
    from public.itinerary_locations
    where id = p_from and trip_id = p_trip_id
    for update;
    if not found then
      raise exception 'Source location not found.';
    end if;
    if v_from_budget is null then
      raise exception 'Source has no budget to move.';
    end if;
    if v_from_budget < p_amount then
      raise exception 'Not enough budget to move.';
    end if;
  end if;

  if p_to is not null then
    update public.itinerary_locations
    set budget_cents = coalesce(budget_cents, 0) + p_amount
    where id = p_to and trip_id = p_trip_id;
    if not found then
      raise exception 'Destination location not found.';
    end if;
  end if;

  if p_from is not null then
    update public.itinerary_locations
    set budget_cents = nullif(v_from_budget - p_amount, 0)
    where id = p_from;
  end if;

  insert into public.trip_budget_moves
    (trip_id, from_location_id, to_location_id, amount_cents, created_by)
  values
    (p_trip_id, p_from, p_to, p_amount, auth.uid());
end;
$$;
