-- First-class, orderable packing categories per trip. Items link by the
-- existing packing_items.category text column (name match) -- no rename means
-- no drift, so a category_id FK isn't needed.

create table if not exists public.packing_categories (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sort_order int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (trip_id, name)
);

create index if not exists packing_categories_trip_idx
  on public.packing_categories (trip_id, sort_order);

alter table public.packing_categories enable row level security;

do $$
begin
  create policy packing_categories_select on public.packing_categories
    for select to authenticated using (public.is_trip_workspace_member(trip_id));
  create policy packing_categories_insert on public.packing_categories
    for insert to authenticated with check (public.is_trip_workspace_member(trip_id));
  create policy packing_categories_update on public.packing_categories
    for update to authenticated using (public.is_trip_workspace_member(trip_id));
  create policy packing_categories_delete on public.packing_categories
    for delete to authenticated using (public.is_trip_workspace_member(trip_id));
exception
  when duplicate_object then null;
end $$;

-- Backfill: turn categories already present in items into rows, ordered by
-- when each category first appeared. Idempotent via the unique constraint.
insert into public.packing_categories (trip_id, name, sort_order)
select trip_id,
       category,
       row_number() over (
         partition by trip_id order by min(created_at)
       ) - 1 as sort_order
from public.packing_items
group by trip_id, category
on conflict (trip_id, name) do nothing;
