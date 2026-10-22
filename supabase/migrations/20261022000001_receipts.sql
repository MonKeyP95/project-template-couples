-- Receipt attachments: photos/PDFs per trip, optionally linked to an expense.
-- expense_id null = in the trip's receipt pile. Files live in the private
-- `receipts` Storage bucket at {trip_id}/{receipt_id}.{ext}; object access is
-- gated by the trip id in the path. Re-runnable.

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  expense_id uuid references public.expenses(id) on delete set null,
  storage_path text not null,
  mime_type text not null
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  uploaded_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  read_status text not null default 'pending'
    check (read_status in ('pending', 'done', 'failed')),
  reading jsonb,
  created_at timestamptz not null default now()
);

create index if not exists receipts_trip_idx
  on public.receipts (trip_id, created_at desc);
create index if not exists receipts_expense_idx
  on public.receipts (expense_id);

alter table public.receipts enable row level security;

drop policy if exists receipts_select on public.receipts;
create policy receipts_select on public.receipts
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

-- A linked expense must belong to the same trip.
drop policy if exists receipts_insert on public.receipts;
create policy receipts_insert on public.receipts
  for insert to authenticated
  with check (
    public.is_trip_workspace_member(trip_id)
    and (
      expense_id is null
      or exists (
        select 1 from public.expenses e
        where e.id = expense_id and e.trip_id = receipts.trip_id
      )
    )
  );

drop policy if exists receipts_update on public.receipts;
create policy receipts_update on public.receipts
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (
    public.is_trip_workspace_member(trip_id)
    and (
      expense_id is null
      or exists (
        select 1 from public.expenses e
        where e.id = expense_id and e.trip_id = receipts.trip_id
      )
    )
  );

drop policy if exists receipts_delete on public.receipts;
create policy receipts_delete on public.receipts
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- Storage: private bucket, objects readable/writable by the trip's members.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists receipts_objects_select on storage.objects;
create policy receipts_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and public.is_trip_workspace_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists receipts_objects_insert on storage.objects;
create policy receipts_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and public.is_trip_workspace_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists receipts_objects_delete on storage.objects;
create policy receipts_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'receipts'
    and public.is_trip_workspace_member(((storage.foldername(name))[1])::uuid)
  );
