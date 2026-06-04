-- Itinerary block name.
-- A multi-day add can carry a name (e.g. "Rinjani Trek"); it is stamped on
-- every row of the span alongside group_id so the UI caption can show it.
-- Single-day adds and pre-existing rows leave group_name null. Inherits the
-- table's existing RLS; no index.

alter table public.itinerary_days add column if not exists group_name text;
