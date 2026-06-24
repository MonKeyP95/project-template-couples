-- Link a planned budget item to the expense created when it is marked "paid".
-- on delete set null: deleting that expense from the ledger reverts the cost to
-- unpaid. Idempotent: safe to paste-and-run multiple times.

alter table public.trip_budget_items
  add column if not exists paid_expense_id uuid
    references public.expenses(id) on delete set null;
