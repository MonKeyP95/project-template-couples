-- Every figure recorded before multi-currency was typed in the couple's own
-- money while the app could only draw a euro sign. The digits are correct; the
-- label was always wrong.
--
-- So this RELABELS and never converts: no amount_cents is touched, no rate is
-- applied. Multiplying by a EUR->DKK rate would corrupt data that was never in
-- euros to begin with.
--
-- Guarded three ways so it cannot touch anything genuinely foreign:
--   * only rows still saying 'EUR'
--   * only workspaces whose currency is NOT 'EUR' (a genuinely EUR-banked
--     workspace has nothing to fix)
--   * expenses only where home_amount_cents is null -- a non-null home amount
--     means a real conversion happened, so that row is genuinely foreign
--
-- Safe to run repeatedly: after the first run nothing still says 'EUR'.

-- Trips: both the spend default and the home currency were the same mislabel.
update public.trips t
set currency = w.currency,
    home_currency = w.currency
from public.workspaces w
where w.id = t.workspace_id
  and t.currency = 'EUR'
  and t.home_currency = 'EUR'
  and w.currency <> 'EUR';

-- Expenses: same relabel, skipping any row that has actually been converted.
update public.expenses e
set currency = w.currency
from public.trips t
join public.workspaces w on w.id = t.workspace_id
where t.id = e.trip_id
  and e.currency = 'EUR'
  and e.home_amount_cents is null
  and w.currency <> 'EUR';
