-- Trip documents: bookings, confirmations, tickets, anything. They live in the
-- receipts table and bucket, tagged kind = 'document'. `entries` holds the
-- document's dated legs/events (a return flight is two single days, a stay is
-- one span); a read fills it only while null, so hand edits stick. RLS and the
-- storage policies are unchanged (already per trip). Re-runnable.

alter table public.receipts
  add column if not exists kind text not null default 'receipt';
alter table public.receipts
  add column if not exists entries jsonb;
alter table public.receipts
  add column if not exists original_name text;

alter table public.receipts drop constraint if exists receipts_kind_check;
alter table public.receipts
  add constraint receipts_kind_check check (kind in ('receipt', 'document'));

create index if not exists receipts_trip_kind_idx
  on public.receipts (trip_id, kind);
