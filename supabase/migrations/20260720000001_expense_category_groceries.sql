-- Add a "Groceries" expense category to every existing trip. New trips already
-- get it via EXPENSE_CATEGORIES in createTrip. Appended at the end of each trip's
-- categories (its current max sort_order + 1). Idempotent: safe to re-run.
insert into public.expense_categories (trip_id, name, sort_order)
select t.id,
       'Groceries',
       coalesce(
         (select max(ec.sort_order) + 1
          from public.expense_categories ec
          where ec.trip_id = t.id),
         0)
from public.trips t
on conflict (trip_id, name) do nothing;
