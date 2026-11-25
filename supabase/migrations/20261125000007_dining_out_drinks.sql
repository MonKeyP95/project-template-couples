-- Rename the default "Food" expense category to "Dining out" on every trip and
-- add "Drinks" right after it. Categories link by name, so every table that
-- stores a category name is renamed too. Re-runnable: each step only touches
-- rows still in the old state.

-- 1. Category lists: rename, or drop "Food" where "Dining out" already exists.
update public.expense_categories c
set name = 'Dining out'
where c.name = 'Food'
  and not exists (
    select 1 from public.expense_categories d
    where d.trip_id = c.trip_id and d.name = 'Dining out'
  );

delete from public.expense_categories c
where c.name = 'Food'
  and exists (
    select 1 from public.expense_categories d
    where d.trip_id = c.trip_id and d.name = 'Dining out'
  );

-- 2. Everything that stores a category name.
update public.expenses set category = 'Dining out' where category = 'Food';
update public.trip_budget_items set category = 'Dining out' where category = 'Food';
update public.trip_suggestions set category = 'Dining out' where category = 'Food';

update public.itinerary_days
set events = (
  select jsonb_agg(
    case when e->>'category' = 'Food'
      then jsonb_set(e, '{category}', '"Dining out"')
      else e
    end
    order by ord
  )
  from jsonb_array_elements(events) with ordinality as t(e, ord)
)
where events @> '[{"category": "Food"}]';

-- 3. Drinks right after Dining out (or last when a trip has no Dining out).
--    The shift runs only for trips that do not have Drinks yet.
update public.expense_categories c
set sort_order = c.sort_order + 1
from public.expense_categories d
where d.trip_id = c.trip_id
  and d.name = 'Dining out'
  and c.sort_order > d.sort_order
  and not exists (
    select 1 from public.expense_categories x
    where x.trip_id = c.trip_id and x.name = 'Drinks'
  );

insert into public.expense_categories (trip_id, name, sort_order)
select t.id, 'Drinks', coalesce(
  (select d.sort_order + 1 from public.expense_categories d
   where d.trip_id = t.id and d.name = 'Dining out'),
  (select coalesce(max(m.sort_order), -1) + 1 from public.expense_categories m
   where m.trip_id = t.id)
)
from public.trips t
on conflict (trip_id, name) do nothing;
