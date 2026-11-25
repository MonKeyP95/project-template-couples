-- Three short "ask next" options saved with the home idea, made in the same AI
-- call. Re-runnable.

alter table public.home_ideas
  add column if not exists options text[] not null default '{}';
