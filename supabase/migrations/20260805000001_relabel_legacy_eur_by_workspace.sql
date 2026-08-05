-- Finishes what 20260730000003 was meant to do.
--
-- That migration relabels legacy 'EUR' rows to the workspace's real currency,
-- but every statement is gated on `w.currency <> 'EUR'`. A workspace whose own
-- currency had never been changed off the 'EUR' default therefore matched
-- nothing: trips and expenses recorded before multi-currency stayed labelled
-- EUR forever. Statement 1 below closes that hole, so this file is one paste.
--
-- RELABEL, never a conversion: no amount_cents is touched and no rate is
-- applied. These figures were typed in the couple's own money at a time when
-- the app could only draw a euro sign -- the digits were always right and only
-- the label was wrong. Multiplying by a EUR->DKK rate would corrupt them.
--
-- The one exception is deliberate and is NOT a conversion either: an expense
-- entered in the couple's real currency against the mislabelled 'EUR' home was
-- converted INTO euros on the way in (280.00 kr stored as home 37.51 with an
-- fx_rate). Once the home label is correct that row is in its own home currency
-- and must carry no conversion at all, so its home_amount_cents and fx_rate are
-- dropped back to null -- the state `resolveHomeAmount` returns for a same-
-- currency expense. Its contribution to totals goes back to amount_cents, which
-- is the correction, not a rate being applied.
--
-- Guards, so nothing genuinely foreign is caught:
--   * only rows still saying 'EUR'
--   * a trip holding an expense converted from a GENUINELY foreign currency
--     (one that is not the workspace's own) keeps its home currency: those
--     cents were computed at a real rate into euros, so relabelling them would
--     misstate real money. Same refusal `updateTrip` applies in the app.
--
-- itinerary_locations.currency is deliberately left alone: it defaults to null
-- and any value there was set by hand after multi-currency shipped, so an 'EUR'
-- location is a real euro destination.
--
-- Safe to run repeatedly: after the first run nothing eligible still says 'EUR'.

-- 1. The workspace currency, which everything below reads as the truth. Delete
--    this statement if you would rather set it at /profile first; the rest of
--    the file behaves identically either way.
update public.workspaces
set currency = 'DKK'
where currency = 'EUR';

-- 2. Trips: the spend default and the home currency were the same mislabel, and
--    each is fixed independently (an earlier partial backfill may have moved one
--    without the other).
update public.trips t
set home_currency = w.currency
from public.workspaces w
where w.id = t.workspace_id
  and t.home_currency = 'EUR'
  and w.currency <> 'EUR'
  and not exists (
    select 1
    from public.expenses e
    where e.trip_id = t.id
      and e.home_amount_cents is not null
      and e.currency <> w.currency
  );

-- 3. Follows the trip's own home rather than the workspace, so a trip skipped
--    above (genuinely foreign conversions) keeps a matching pair.
update public.trips
set currency = home_currency
where currency = 'EUR'
  and home_currency <> 'EUR';

-- 4. Expenses: carried onto the trip's new home label, so a row's currency and
--    its trip's home currency stay the same fact.
update public.expenses e
set currency = t.home_currency
from public.trips t
where t.id = e.trip_id
  and e.currency = 'EUR'
  and e.home_amount_cents is null
  and t.home_currency <> 'EUR';

-- 5. Restores the invariant `resolveHomeAmount` writes: an expense already in
--    its trip's home currency carries no conversion. Independent of the relabel
--    and correct on its own terms, so it is safe whatever ran above.
update public.expenses e
set home_amount_cents = null,
    fx_rate = null
from public.trips t
where t.id = e.trip_id
  and e.currency = t.home_currency
  and e.home_amount_cents is not null;
