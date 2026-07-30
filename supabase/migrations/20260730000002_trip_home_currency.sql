-- A trip carries two currencies:
--   currency       - what you spend there (the expense-entry default)
--   home_currency  - where your bank account is; every expense converts INTO
--                    this, and it is frozen at trip creation so changing the
--                    workspace currency later cannot rewrite a recorded trip.
--
-- Backfills home_currency from currency, which reproduces the previous
-- behaviour exactly (conversion target was the trip's own currency).
-- Safe to run repeatedly.

alter table public.trips
  add column if not exists home_currency text;

update public.trips
set home_currency = currency
where home_currency is null;

alter table public.trips
  alter column home_currency set default 'EUR';

alter table public.trips
  alter column home_currency set not null;

alter table public.trips drop constraint if exists trips_home_currency_check;
alter table public.trips
  add constraint trips_home_currency_check
  check (char_length(home_currency) = 3);
