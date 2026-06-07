-- Atomic budget transfer between location envelopes (or the unallocated pool).
-- Replaces the action's read-then-two-writes with one transaction so a partial
-- failure can't leave money lost, and a row lock prevents a stale-read race
-- when both partners move budget at once. Either endpoint may be null = the
-- unallocated pool (that side performs no write). A source whose target reaches
-- zero is cleared to null (matches the budget_cents > 0 CHECK). SECURITY INVOKER
-- (default): caller RLS gates every read/write. Idempotent (create or replace).

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

  -- Validate the debit before any write: lock the source row, require a target
  -- that covers the amount.
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

  -- Credit the destination.
  if p_to is not null then
    update public.itinerary_locations
    set budget_cents = coalesce(budget_cents, 0) + p_amount
    where id = p_to and trip_id = p_trip_id;
    if not found then
      raise exception 'Destination location not found.';
    end if;
  end if;

  -- Debit the source (zero clears the target to null).
  if p_from is not null then
    update public.itinerary_locations
    set budget_cents = nullif(v_from_budget - p_amount, 0)
    where id = p_from;
  end if;
end;
$$;
