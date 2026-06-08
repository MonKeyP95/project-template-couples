-- First-class, per-trip expense categories. Expenses link by the existing
-- expenses.category text column (name match) -- no rename means no drift, so a
-- category_id FK isn't needed. Mirrors packing_categories.

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sort_order int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (trip_id, name)
);

create index if not exists expense_categories_trip_idx
  on public.expense_categories (trip_id, sort_order);

alter table public.expense_categories enable row level security;

do $$
begin
  create policy expense_categories_select on public.expense_categories
    for select to authenticated using (public.is_trip_workspace_member(trip_id));
  create policy expense_categories_insert on public.expense_categories
    for insert to authenticated with check (public.is_trip_workspace_member(trip_id));
  create policy expense_categories_update on public.expense_categories
    for update to authenticated using (public.is_trip_workspace_member(trip_id));
  create policy expense_categories_delete on public.expense_categories
    for delete to authenticated using (public.is_trip_workspace_member(trip_id));
exception
  when duplicate_object then null;
end $$;

-- Seed the default set for every existing trip. Idempotent via the unique
-- constraint; any category already present (e.g. from an expense) is left as-is.
insert into public.expense_categories (trip_id, name, sort_order)
select t.id, d.name, d.sort_order
from public.trips t
cross join (values
  ('Surf', 0),
  ('Dive', 1),
  ('Trek', 2),
  ('Food', 3),
  ('Transit', 4),
  ('Lodging', 5),
  ('Other', 6)
) as d(name, sort_order)
on conflict (trip_id, name) do nothing;
