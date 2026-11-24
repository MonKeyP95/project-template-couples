-- Note reminders: a trip_note can carry "remind me at" a moment. Null = no
-- reminder; "done" sets it back to null. Due = remind_at <= now().
-- No RLS change: existing trip_notes policies gate by trip via
-- is_trip_workspace_member().
-- Idempotent: safe to paste-and-run multiple times.

alter table public.trip_notes
  add column if not exists remind_at timestamptz;
