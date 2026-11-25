-- The structured plan saved with the home idea (walk answers + route), made in
-- the same AI call. Null on rows saved before it existed; those are made again
-- once. Re-runnable.

alter table public.home_ideas
  add column if not exists plan jsonb;
