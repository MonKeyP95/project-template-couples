-- De-duplicate backfilled day summaries. The mini-events backfill
-- (20260610000001) copied each old `sub` into a single event but left `sub`
-- populated. Now that `sub` is the summary layer again, those legacy days show
-- the same text twice (collapsed summary + lone event). Clear `sub` where it
-- exactly duplicates the day's single timeless event, so the card falls back to
-- the event for its summary. Only touches that exact duplicate case. Idempotent
-- (after running, the cleared rows no longer match the guard).

update public.itinerary_days
set sub = null
where coalesce(btrim(sub), '') <> ''
  and jsonb_typeof(events) = 'array'
  and jsonb_array_length(events) = 1
  and btrim(events -> 0 ->> 'text') = btrim(sub);
