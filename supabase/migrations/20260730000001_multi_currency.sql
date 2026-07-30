-- Multi-currency: per-workspace/trip/location currency, plus the converted home
-- amount on each expense. Safe to run repeatedly.

alter table public.expenses
  add column if not exists home_amount_cents integer,
  add column if not exists fx_rate numeric(18,8),
  add column if not exists home_amount_confirmed boolean not null default false;

alter table public.workspaces
  add column if not exists currency text not null default 'EUR';

alter table public.trips
  add column if not exists currency text not null default 'EUR';

alter table public.itinerary_locations
  add column if not exists currency text;

-- 3-letter ISO codes only, matching the existing check on expenses.currency.
-- Dropped first so a re-run replaces rather than collides.
alter table public.workspaces drop constraint if exists workspaces_currency_check;
alter table public.workspaces
  add constraint workspaces_currency_check check (char_length(currency) = 3);

alter table public.trips drop constraint if exists trips_currency_check;
alter table public.trips
  add constraint trips_currency_check check (char_length(currency) = 3);

alter table public.itinerary_locations
  drop constraint if exists itinerary_locations_currency_check;
alter table public.itinerary_locations
  add constraint itinerary_locations_currency_check
  check (currency is null or char_length(currency) = 3);
