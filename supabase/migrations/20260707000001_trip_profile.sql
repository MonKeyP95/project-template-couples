-- Trip profile (two-level profile, slice 1): per-trip structured profile
-- (headline + chips + free brief) stored as one jsonb column. Idempotent.
alter table trips add column if not exists trip_profile jsonb;
