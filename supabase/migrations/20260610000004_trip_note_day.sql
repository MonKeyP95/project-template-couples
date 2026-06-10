-- Day-filed notes: a trip_note can be tagged to a specific day, mirroring
-- expenses.day_date. Nullable; null = a general (un-dated) note, unchanged
-- behaviour. The On the Road page jots notes tagged to today.
-- No RLS change: existing trip_notes policies gate by trip via
-- is_trip_workspace_member().
-- Idempotent: safe to paste-and-run multiple times.

alter table public.trip_notes
  add column if not exists day_date date;

create index if not exists trip_notes_trip_day_idx
  on public.trip_notes (trip_id, day_date);
