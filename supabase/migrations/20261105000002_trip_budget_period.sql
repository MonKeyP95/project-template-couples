-- trips.budget_period: what the on-the-road budget card compares against --
-- today's share ('day'), this trip-week's ('week'), or the trip so far
-- ('trip'). Chosen per trip beside the budget estimate; existing trips get
-- 'trip', which is what the old PaceLine showed.
--
-- Idempotent: safe to paste-and-run multiple times.

alter table public.trips
  add column if not exists budget_period text not null default 'trip';

alter table public.trips
  drop constraint if exists trips_budget_period_check;
alter table public.trips
  add constraint trips_budget_period_check
  check (budget_period in ('day', 'week', 'trip'));
