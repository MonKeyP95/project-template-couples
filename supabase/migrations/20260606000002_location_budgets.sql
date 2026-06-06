-- Location-bucketed budgets: a per-location target plus an explicit location
-- tag on expenses (overrides date-based attribution). Both nullable. RLS is
-- already enforced on these tables by trip -> workspace membership, so the
-- existing row-level policies cover the new columns; no new policies needed.
-- Idempotent: safe to paste-and-run multiple times.

-- Per-location budget target. Null = no target set (not counted as allocated).
alter table public.itinerary_locations
  add column if not exists budget_cents integer
  check (budget_cents is null or budget_cents > 0);

-- Explicit location tag on an expense. Null = attribute by date.
-- on delete set null: deleting a location reverts its expenses to auto.
alter table public.expenses
  add column if not exists location_id uuid
  references public.itinerary_locations(id) on delete set null;
