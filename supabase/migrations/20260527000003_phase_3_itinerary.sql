-- Phase 3: itinerary_days
-- One row per planned day of a trip. Rendered as the timeline on /trips/[slug].
-- Stores day_date only; ordinal + day-of-week + display date derive at render.

create table public.itinerary_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_date date not null,
  title text not null check (length(trim(title)) > 0),
  sub text,
  tag text not null check (length(trim(tag)) > 0),
  tone text not null check (tone in ('sea', 'clay', 'moss', 'sand')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (trip_id, day_date)
);

create index itinerary_days_trip_date_idx on public.itinerary_days (trip_id, day_date);

alter table public.itinerary_days enable row level security;

create policy itinerary_days_select on public.itinerary_days
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

create policy itinerary_days_insert on public.itinerary_days
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );

create policy itinerary_days_update on public.itinerary_days
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));

create policy itinerary_days_delete on public.itinerary_days
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));
