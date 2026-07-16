-- Empty days are real rows: allow a day to have no title/tag so a materialized
-- empty day (a date in a location's span with no events) is insertable. tone
-- stays required (styling, defaults to 'sand'). Idempotent.
alter table public.itinerary_days alter column title drop not null;
alter table public.itinerary_days alter column tag   drop not null;
alter table public.itinerary_days drop constraint if exists itinerary_days_title_check;
alter table public.itinerary_days drop constraint if exists itinerary_days_tag_check;
