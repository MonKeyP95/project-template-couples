-- Completes 20260730000003.
--
-- That migration required BOTH trips.currency and trips.home_currency to still
-- say 'EUR'. In practice an earlier home-currency-only backfill had already
-- moved home_currency to the workspace currency, so the trips update matched
-- nothing and only the expenses were relabelled -- leaving trips holding a
-- spend currency of 'EUR' against a non-EUR home.
--
-- Symptom: the expense form pre-fills EUR on a DKK-banked trip, and every
-- total carries a pointless "~ EUR" local-equivalent line.
--
-- Relabel only, no conversion: these figures were never euros. A trip whose
-- home genuinely is EUR is left alone. Safe to run repeatedly.

update public.trips
set currency = home_currency
where currency = 'EUR'
  and home_currency <> 'EUR';
