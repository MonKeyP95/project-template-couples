-- Phase 4: dream rows in the trips table.
-- Dates were already nullable from Phase 3. The Phase 3 migration added an
-- anonymous table-level CHECK auto-named `trips_check`:
--   check (end_date is null or start_date is null or end_date >= start_date)
-- which permitted half-states (start set, end null). We tighten it to
-- "both null or both set", which collapses the dream/trip distinction to one
-- clean invariant.
--
-- We also add fuzzy_when text for free-form dream timing ("summer 2030").

alter table public.trips
  add column fuzzy_when text;

alter table public.trips drop constraint if exists trips_check;
alter table public.trips add constraint trips_dates_check
  check (
    (start_date is null and end_date is null)
    or (start_date is not null and end_date is not null and end_date >= start_date)
  );
