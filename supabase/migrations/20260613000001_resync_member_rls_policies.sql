-- Re-sync all RLS policies to the committed member-based definitions.
--
-- Production drifted: its write (INSERT/UPDATE/DELETE) policies required the
-- workspace OWNER role (a leftover from an early "only the owner edits" design),
-- so invited members could read everything but create or edit nothing. The
-- committed migrations have always gated writes on membership
-- (is_workspace_member / is_trip_workspace_member / is_checklist_workspace_member).
--
-- The drifted policies carried legacy NAMES, so dropping by the committed name
-- alone would miss them. This file first drops EVERY policy on each target
-- table, then recreates the correct member-based set. Idempotent and
-- self-healing against any naming.
--
-- Note: only PERMISSIVE policies exist here (the project never uses RESTRICTIVE).

-- ---------------------------------------------------------------------------
-- 1. Drop every existing policy on each target table (any name).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'trips', 'trip_members', 'itinerary_days', 'packing_items',
    'packing_categories', 'expenses', 'expense_categories', 'trip_notes',
    'itinerary_locations', 'dream_itinerary_days', 'trip_savings_contributions',
    'trip_budget_moves', 'checklists', 'checklist_categories', 'checklist_items'
  ]
  loop
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Recreate the committed member-based policies.
-- ---------------------------------------------------------------------------

-- trips ----------------------------------------------------------------------
create policy trips_select_members on public.trips
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy trips_insert_members on public.trips
  for insert to authenticated with check (
    public.is_workspace_member(workspace_id) and created_by = auth.uid()
  );
create policy trips_update_members on public.trips
  for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
create policy trips_delete_members on public.trips
  for delete to authenticated using (public.is_workspace_member(workspace_id));

-- trip_members ---------------------------------------------------------------
create policy trip_members_select on public.trip_members
  for select to authenticated using (public.is_trip_workspace_member(trip_id));
create policy trip_members_insert on public.trip_members
  for insert to authenticated with check (public.is_trip_workspace_member(trip_id));
create policy trip_members_delete on public.trip_members
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- itinerary_days -------------------------------------------------------------
create policy itinerary_days_select on public.itinerary_days
  for select to authenticated using (public.is_trip_workspace_member(trip_id));
create policy itinerary_days_insert on public.itinerary_days
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );
create policy itinerary_days_update on public.itinerary_days
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));
create policy itinerary_days_delete on public.itinerary_days
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- packing_items --------------------------------------------------------------
create policy packing_items_select on public.packing_items
  for select to authenticated using (public.is_trip_workspace_member(trip_id));
create policy packing_items_insert on public.packing_items
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id) and added_by = auth.uid()
  );
create policy packing_items_update on public.packing_items
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));
create policy packing_items_delete on public.packing_items
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- packing_categories ---------------------------------------------------------
create policy packing_categories_select on public.packing_categories
  for select to authenticated using (public.is_trip_workspace_member(trip_id));
create policy packing_categories_insert on public.packing_categories
  for insert to authenticated with check (public.is_trip_workspace_member(trip_id));
create policy packing_categories_update on public.packing_categories
  for update to authenticated using (public.is_trip_workspace_member(trip_id));
create policy packing_categories_delete on public.packing_categories
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- expenses -------------------------------------------------------------------
create policy expenses_select on public.expenses
  for select to authenticated using (public.is_trip_workspace_member(trip_id));
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    public.is_trip_workspace_member(trip_id)
    and exists (
      select 1
      from public.trips t
      join public.workspace_members wm on wm.workspace_id = t.workspace_id
      where t.id = trip_id and wm.user_id = paid_by
    )
  );
create policy expenses_update on public.expenses
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));
create policy expenses_delete on public.expenses
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- expense_categories ---------------------------------------------------------
create policy expense_categories_select on public.expense_categories
  for select to authenticated using (public.is_trip_workspace_member(trip_id));
create policy expense_categories_insert on public.expense_categories
  for insert to authenticated with check (public.is_trip_workspace_member(trip_id));
create policy expense_categories_update on public.expense_categories
  for update to authenticated using (public.is_trip_workspace_member(trip_id));
create policy expense_categories_delete on public.expense_categories
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- trip_notes -----------------------------------------------------------------
create policy trip_notes_select on public.trip_notes
  for select using (public.is_trip_workspace_member(trip_id));
create policy trip_notes_insert on public.trip_notes
  for insert with check (
    public.is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );
create policy trip_notes_update on public.trip_notes
  for update using (public.is_trip_workspace_member(trip_id));
create policy trip_notes_delete on public.trip_notes
  for delete using (public.is_trip_workspace_member(trip_id));

-- itinerary_locations --------------------------------------------------------
create policy itinerary_locations_select on public.itinerary_locations
  for select to authenticated using (public.is_trip_workspace_member(trip_id));
create policy itinerary_locations_insert on public.itinerary_locations
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );
create policy itinerary_locations_update on public.itinerary_locations
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));
create policy itinerary_locations_delete on public.itinerary_locations
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- dream_itinerary_days -------------------------------------------------------
create policy dream_itinerary_days_select on public.dream_itinerary_days
  for select to authenticated using (public.is_trip_workspace_member(trip_id));
create policy dream_itinerary_days_insert on public.dream_itinerary_days
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );
create policy dream_itinerary_days_update on public.dream_itinerary_days
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));
create policy dream_itinerary_days_delete on public.dream_itinerary_days
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- trip_savings_contributions -------------------------------------------------
create policy savings_select on public.trip_savings_contributions
  for select to authenticated using (public.is_trip_workspace_member(trip_id));
create policy savings_insert on public.trip_savings_contributions
  for insert to authenticated
  with check (
    public.is_trip_workspace_member(trip_id) and user_id = auth.uid()
  );
create policy savings_delete on public.trip_savings_contributions
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- trip_budget_moves ----------------------------------------------------------
create policy budget_moves_select on public.trip_budget_moves
  for select to authenticated using (public.is_trip_workspace_member(trip_id));
create policy budget_moves_insert on public.trip_budget_moves
  for insert to authenticated
  with check (
    public.is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );
create policy budget_moves_delete on public.trip_budget_moves
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- checklists -----------------------------------------------------------------
create policy checklists_select on public.checklists
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy checklists_insert on public.checklists
  for insert to authenticated with check (
    public.is_workspace_member(workspace_id) and created_by = auth.uid()
  );
create policy checklists_update on public.checklists
  for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
create policy checklists_delete on public.checklists
  for delete to authenticated using (public.is_workspace_member(workspace_id));

-- checklist_categories -------------------------------------------------------
create policy checklist_categories_select on public.checklist_categories
  for select to authenticated using (public.is_checklist_workspace_member(checklist_id));
create policy checklist_categories_insert on public.checklist_categories
  for insert to authenticated with check (public.is_checklist_workspace_member(checklist_id));
create policy checklist_categories_update on public.checklist_categories
  for update to authenticated
  using (public.is_checklist_workspace_member(checklist_id))
  with check (public.is_checklist_workspace_member(checklist_id));
create policy checklist_categories_delete on public.checklist_categories
  for delete to authenticated using (public.is_checklist_workspace_member(checklist_id));

-- checklist_items ------------------------------------------------------------
create policy checklist_items_select on public.checklist_items
  for select to authenticated using (public.is_checklist_workspace_member(checklist_id));
create policy checklist_items_insert on public.checklist_items
  for insert to authenticated with check (
    public.is_checklist_workspace_member(checklist_id) and added_by = auth.uid()
  );
create policy checklist_items_update on public.checklist_items
  for update to authenticated
  using (public.is_checklist_workspace_member(checklist_id))
  with check (public.is_checklist_workspace_member(checklist_id));
create policy checklist_items_delete on public.checklist_items
  for delete to authenticated using (public.is_checklist_workspace_member(checklist_id));
