-- Semi-private packing: add owner_id to packing_items and packing_categories.
-- null owner_id = shared (today's behaviour); a user id = personal/semi-private.
-- Privacy is UI-only; select stays member-gated so either partner can view both
-- lists. Insert is tightened so you can only create shared rows or rows you own.
-- Idempotent: safe to paste-and-run repeatedly.

alter table public.packing_items
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

alter table public.packing_categories
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

create index if not exists packing_items_owner_idx
  on public.packing_items (trip_id, owner_id);
create index if not exists packing_categories_owner_idx
  on public.packing_categories (trip_id, owner_id);

-- Swap unique(trip_id, name) -> unique nulls not distinct(trip_id, owner_id, name)
-- so each owner (and the shared scope) gets its own "Clothes" without collision,
-- while two shared "Clothes" still collide (NULLS NOT DISTINCT, Postgres 15+).
alter table public.packing_categories
  drop constraint if exists packing_categories_trip_id_name_key;
alter table public.packing_categories
  drop constraint if exists packing_categories_trip_owner_name_key;
alter table public.packing_categories
  add constraint packing_categories_trip_owner_name_key
  unique nulls not distinct (trip_id, owner_id, name);

-- Tighten insert RLS on both tables: member AND (shared OR owned by caller).
drop policy if exists packing_items_insert on public.packing_items;
create policy packing_items_insert on public.packing_items
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id)
    and added_by = auth.uid()
    and (owner_id is null or owner_id = auth.uid())
  );

drop policy if exists packing_categories_insert on public.packing_categories;
create policy packing_categories_insert on public.packing_categories
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id)
    and (owner_id is null or owner_id = auth.uid())
  );
