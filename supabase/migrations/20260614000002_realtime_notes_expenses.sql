-- Enable Realtime for notes and expenses so the on-the-road page reflects a
-- partner's edits live (they previously synced only on focus/reload). Adds them
-- to the supabase_realtime publication and sets replica identity full (RLS needs
-- the full row on UPDATE/DELETE). Idempotent.

do $$
begin
  alter publication supabase_realtime add table public.trip_notes;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.expenses;
exception when duplicate_object then null;
end $$;

alter table public.trip_notes replica identity full;
alter table public.expenses   replica identity full;
