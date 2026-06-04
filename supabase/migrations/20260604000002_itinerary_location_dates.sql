-- Optional date span for an itinerary location (e.g. Kuta = Jun 12-16).
-- Both null = "span implied by its days" (current behavior). When set, the
-- whole range renders as fillable empty-day slots. The check keeps them
-- consistent. Inherits the table's existing RLS; no index. Idempotent.

alter table public.itinerary_locations
  add column if not exists start_date date,
  add column if not exists end_date   date;

alter table public.itinerary_locations
  drop constraint if exists itinerary_locations_span_chk;
alter table public.itinerary_locations
  add constraint itinerary_locations_span_chk
  check (
    (start_date is null and end_date is null)
    or (start_date is not null and end_date is not null and end_date >= start_date)
  );
