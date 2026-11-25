-- The saved home ideas become a set: `ideas` holds up to three full ideas
-- (pill, label, body, plan), made in one AI call. The single-idea columns go.
-- A row with an empty set is made again once. Re-runnable.

alter table public.home_ideas
  add column if not exists ideas jsonb not null default '[]';

alter table public.home_ideas drop column if exists label;
alter table public.home_ideas drop column if exists body;
alter table public.home_ideas drop column if exists options;
alter table public.home_ideas drop column if exists plan;
