-- One-time backfill: point every existing trip's home_currency at its
-- workspace's currency.
--
-- Trips created before the workspace currency existed took the 'EUR' column
-- default, and home_currency is deliberately not editable in the app (it is
-- frozen at creation), so those trips had no way to convert into the money the
-- couple actually banks in.
--
-- Only touches trips that still hold the 'EUR' default AND whose workspace
-- says something else, so a trip genuinely banked in EUR is left alone and a
-- re-run is a no-op. Safe to run repeatedly.

update public.trips t
set home_currency = w.currency
from public.workspaces w
where w.id = t.workspace_id
  and t.home_currency = 'EUR'
  and w.currency <> 'EUR';
