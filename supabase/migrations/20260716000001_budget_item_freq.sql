-- How-often model for budget walk rows: a line's total is unit price x quantity.
-- freq drives the quantity source: once (1), times (count or a dated span),
-- daily (the row's day-slots). amount_cents stays the computed total.
alter table trip_budget_items
  add column if not exists freq text not null default 'once';
alter table trip_budget_items
  add column if not exists count integer not null default 1;
