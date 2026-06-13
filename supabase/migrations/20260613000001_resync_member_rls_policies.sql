-- Re-sync all RLS policies to the committed member-based definitions.
--
-- Production drifted: its write (INSERT/UPDATE/DELETE) policies required the
-- workspace OWNER role, so invited members could read everything but create or
-- edit nothing. The committed migrations have always gated writes on
-- is_workspace_member / is_trip_workspace_member / is_checklist_workspace_member
-- (any member). This file re-asserts every policy verbatim so prod matches the
-- code. Drop-then-create makes it idempotent and replaces any drifted version
-- carrying the same name.
--
-- Note: only fixes PERMISSIVE policies (the project's only kind). If prod ever
-- gained a RESTRICTIVE owner policy, it would need an explicit drop.

-- trips ----------------------------------------------------------------------
drop policy if exists trips_select_members on public.trips;
create policy trips_select_members on public.trips
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists trips_insert_members on public.trips;
create policy trips_insert_members on public.trips
  for insert to authenticated with check (
    public.is_workspace_member(workspace_id) and created_by = auth.uid()
  );

drop policy if exists trips_update_members on public.trips;
create policy trips_update_members on public.trips
  for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists trips_delete_members on public.trips;
create policy trips_delete_members on public.trips
  for delete to authenticated using (public.is_workspace_member(workspace_id));

-- trip_members ---------------------------------------------------------------
drop policy if exists trip_members_select on public.trip_members;
create policy trip_members_select on public.trip_members
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists trip_members_insert on public.trip_members;
create policy trip_members_insert on public.trip_members
  for insert to authenticated with check (public.is_trip_workspace_member(trip_id));

drop policy if exists trip_members_delete on public.trip_members;
create policy trip_members_delete on public.trip_members
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- itinerary_days -------------------------------------------------------------
drop policy if exists itinerary_days_select on public.itinerary_days;
create policy itinerary_days_select on public.itinerary_days
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists itinerary_days_insert on public.itinerary_days;
create policy itinerary_days_insert on public.itinerary_days
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );

drop policy if exists itinerary_days_update on public.itinerary_days;
create policy itinerary_days_update on public.itinerary_days
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));

drop policy if exists itinerary_days_delete on public.itinerary_days;
create policy itinerary_days_delete on public.itinerary_days
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- packing_items --------------------------------------------------------------
drop policy if exists packing_items_select on public.packing_items;
create policy packing_items_select on public.packing_items
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists packing_items_insert on public.packing_items;
create policy packing_items_insert on public.packing_items
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id) and added_by = auth.uid()
  );

drop policy if exists packing_items_update on public.packing_items;
create policy packing_items_update on public.packing_items
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));

drop policy if exists packing_items_delete on public.packing_items;
create policy packing_items_delete on public.packing_items
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- packing_categories ---------------------------------------------------------
drop policy if exists packing_categories_select on public.packing_categories;
create policy packing_categories_select on public.packing_categories
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists packing_categories_insert on public.packing_categories;
create policy packing_categories_insert on public.packing_categories
  for insert to authenticated with check (public.is_trip_workspace_member(trip_id));

drop policy if exists packing_categories_update on public.packing_categories;
create policy packing_categories_update on public.packing_categories
  for update to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists packing_categories_delete on public.packing_categories;
create policy packing_categories_delete on public.packing_categories
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- expenses -------------------------------------------------------------------
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists expenses_insert on public.expenses;
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

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));

drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- expense_categories ---------------------------------------------------------
drop policy if exists expense_categories_select on public.expense_categories;
create policy expense_categories_select on public.expense_categories
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists expense_categories_insert on public.expense_categories;
create policy expense_categories_insert on public.expense_categories
  for insert to authenticated with check (public.is_trip_workspace_member(trip_id));

drop policy if exists expense_categories_update on public.expense_categories;
create policy expense_categories_update on public.expense_categories
  for update to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists expense_categories_delete on public.expense_categories;
create policy expense_categories_delete on public.expense_categories
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- trip_notes -----------------------------------------------------------------
drop policy if exists trip_notes_select on public.trip_notes;
create policy trip_notes_select on public.trip_notes
  for select using (public.is_trip_workspace_member(trip_id));

drop policy if exists trip_notes_insert on public.trip_notes;
create policy trip_notes_insert on public.trip_notes
  for insert with check (
    public.is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );

drop policy if exists trip_notes_update on public.trip_notes;
create policy trip_notes_update on public.trip_notes
  for update using (public.is_trip_workspace_member(trip_id));

drop policy if exists trip_notes_delete on public.trip_notes;
create policy trip_notes_delete on public.trip_notes
  for delete using (public.is_trip_workspace_member(trip_id));

-- itinerary_locations --------------------------------------------------------
drop policy if exists itinerary_locations_select on public.itinerary_locations;
create policy itinerary_locations_select on public.itinerary_locations
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists itinerary_locations_insert on public.itinerary_locations;
create policy itinerary_locations_insert on public.itinerary_locations
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );

drop policy if exists itinerary_locations_update on public.itinerary_locations;
create policy itinerary_locations_update on public.itinerary_locations
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));

drop policy if exists itinerary_locations_delete on public.itinerary_locations;
create policy itinerary_locations_delete on public.itinerary_locations
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- dream_itinerary_days -------------------------------------------------------
drop policy if exists dream_itinerary_days_select on public.dream_itinerary_days;
create policy dream_itinerary_days_select on public.dream_itinerary_days
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists dream_itinerary_days_insert on public.dream_itinerary_days;
create policy dream_itinerary_days_insert on public.dream_itinerary_days
  for insert to authenticated with check (
    public.is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );

drop policy if exists dream_itinerary_days_update on public.dream_itinerary_days;
create policy dream_itinerary_days_update on public.dream_itinerary_days
  for update to authenticated
  using (public.is_trip_workspace_member(trip_id))
  with check (public.is_trip_workspace_member(trip_id));

drop policy if exists dream_itinerary_days_delete on public.dream_itinerary_days;
create policy dream_itinerary_days_delete on public.dream_itinerary_days
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- trip_savings_contributions -------------------------------------------------
drop policy if exists savings_select on public.trip_savings_contributions;
create policy savings_select on public.trip_savings_contributions
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists savings_insert on public.trip_savings_contributions;
create policy savings_insert on public.trip_savings_contributions
  for insert to authenticated
  with check (
    public.is_trip_workspace_member(trip_id) and user_id = auth.uid()
  );

drop policy if exists savings_delete on public.trip_savings_contributions;
create policy savings_delete on public.trip_savings_contributions
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- trip_budget_moves ----------------------------------------------------------
drop policy if exists budget_moves_select on public.trip_budget_moves;
create policy budget_moves_select on public.trip_budget_moves
  for select to authenticated using (public.is_trip_workspace_member(trip_id));

drop policy if exists budget_moves_insert on public.trip_budget_moves;
create policy budget_moves_insert on public.trip_budget_moves
  for insert to authenticated
  with check (
    public.is_trip_workspace_member(trip_id) and created_by = auth.uid()
  );

drop policy if exists budget_moves_delete on public.trip_budget_moves;
create policy budget_moves_delete on public.trip_budget_moves
  for delete to authenticated using (public.is_trip_workspace_member(trip_id));

-- checklists -----------------------------------------------------------------
drop policy if exists checklists_select on public.checklists;
create policy checklists_select on public.checklists
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists checklists_insert on public.checklists;
create policy checklists_insert on public.checklists
  for insert to authenticated with check (
    public.is_workspace_member(workspace_id) and created_by = auth.uid()
  );

drop policy if exists checklists_update on public.checklists;
create policy checklists_update on public.checklists
  for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists checklists_delete on public.checklists;
create policy checklists_delete on public.checklists
  for delete to authenticated using (public.is_workspace_member(workspace_id));

-- checklist_categories -------------------------------------------------------
drop policy if exists checklist_categories_select on public.checklist_categories;
create policy checklist_categories_select on public.checklist_categories
  for select to authenticated using (public.is_checklist_workspace_member(checklist_id));

drop policy if exists checklist_categories_insert on public.checklist_categories;
create policy checklist_categories_insert on public.checklist_categories
  for insert to authenticated with check (public.is_checklist_workspace_member(checklist_id));

drop policy if exists checklist_categories_update on public.checklist_categories;
create policy checklist_categories_update on public.checklist_categories
  for update to authenticated
  using (public.is_checklist_workspace_member(checklist_id))
  with check (public.is_checklist_workspace_member(checklist_id));

drop policy if exists checklist_categories_delete on public.checklist_categories;
create policy checklist_categories_delete on public.checklist_categories
  for delete to authenticated using (public.is_checklist_workspace_member(checklist_id));

-- checklist_items ------------------------------------------------------------
drop policy if exists checklist_items_select on public.checklist_items;
create policy checklist_items_select on public.checklist_items
  for select to authenticated using (public.is_checklist_workspace_member(checklist_id));

drop policy if exists checklist_items_insert on public.checklist_items;
create policy checklist_items_insert on public.checklist_items
  for insert to authenticated with check (
    public.is_checklist_workspace_member(checklist_id) and added_by = auth.uid()
  );

drop policy if exists checklist_items_update on public.checklist_items;
create policy checklist_items_update on public.checklist_items
  for update to authenticated
  using (public.is_checklist_workspace_member(checklist_id))
  with check (public.is_checklist_workspace_member(checklist_id));

drop policy if exists checklist_items_delete on public.checklist_items;
create policy checklist_items_delete on public.checklist_items
  for delete to authenticated using (public.is_checklist_workspace_member(checklist_id));
