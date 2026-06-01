-- Trip-level planned budget + saved-so-far running total.
-- Both shared across the workspace; covered by existing trips RLS policies.
-- Idempotent: safe to paste-and-run multiple times.

alter table public.trips
  add column if not exists planned_budget_cents integer not null default 0;

alter table public.trips
  add column if not exists saved_cents integer not null default 0;

-- Preserve Lombok's previously-hardcoded €2,800 (was in src/lib/trips/fixtures.ts)
-- so its budget tab does not visibly regress once we stop reading the fixture.
update public.trips
  set planned_budget_cents = 280000
  where slug = 'lombok' and planned_budget_cents = 0;
