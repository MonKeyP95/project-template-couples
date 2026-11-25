-- Home ideas live in `trip_ideas` now; `home_ideas` only keeps the
-- fingerprint. Drops the old saved-set column. Re-runnable.

alter table public.home_ideas drop column if exists ideas;
