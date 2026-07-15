-- Budget item marks: distinguish who supplied each price and flag the unpriceable.
-- estimated   -> the assistant supplied this amount (an estimate, not your figure)
-- source_url  -> a real web-search result backing the amount, when it found one
-- price_unknown -> the assistant could not find or reasonably estimate a price
--                  (amount_cents stays 0; the line is shown as "no reliable price")
-- Idempotent: safe to paste-and-run repeatedly.

alter table trip_budget_items add column if not exists estimated boolean not null default false;
alter table trip_budget_items add column if not exists source_url text;
alter table trip_budget_items add column if not exists price_unknown boolean not null default false;
