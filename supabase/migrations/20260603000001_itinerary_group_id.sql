-- Itinerary "added together" grouping.
-- A multi-day add (e.g. a 3-day trek) stamps all its rows with one shared
-- group_id so the UI can draw a fine border around them. Single-day adds and
-- all pre-existing rows leave group_id null (ungrouped). Inherits the table's
-- existing RLS; no index (N per trip is tiny).

alter table public.itinerary_days add column if not exists group_id uuid;
