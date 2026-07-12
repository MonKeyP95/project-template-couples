-- Describe-only detail tags per expense category (e.g. Food -> burgers, sushi).
-- Profile-intent only; never touches money. Idempotent.
alter table public.expense_categories
  add column if not exists details text[] not null default '{}';
