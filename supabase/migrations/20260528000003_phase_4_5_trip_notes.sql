-- Phase 4.5: trip_notes table for per-trip free-text notes.
-- Mirrors the child-table shape of packing_items / expenses / itinerary_days:
-- one row per note, cascade on trip delete, RLS via is_trip_workspace_member().
--
-- Idempotent: safe to paste-and-run multiple times.

create table if not exists public.trip_notes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  body text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trip_notes_trip_created_idx
  on public.trip_notes (trip_id, created_at desc);

alter table public.trip_notes enable row level security;

drop policy if exists trip_notes_select on public.trip_notes;
create policy trip_notes_select on public.trip_notes
  for select using (is_trip_workspace_member(trip_id));

drop policy if exists trip_notes_insert on public.trip_notes;
create policy trip_notes_insert on public.trip_notes
  for insert with check (
    is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );

drop policy if exists trip_notes_update on public.trip_notes;
create policy trip_notes_update on public.trip_notes
  for update using (is_trip_workspace_member(trip_id));

drop policy if exists trip_notes_delete on public.trip_notes;
create policy trip_notes_delete on public.trip_notes
  for delete using (is_trip_workspace_member(trip_id));
