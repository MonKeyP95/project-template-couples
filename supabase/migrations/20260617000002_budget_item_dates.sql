-- Add optional dates to budget items. Used only by trip-wide items (no
-- location to inherit dates from); located items leave these null.
-- Idempotent: safe to paste-and-run multiple times.

alter table public.trip_budget_items
  add column if not exists when_start date,
  add column if not exists when_end date;
