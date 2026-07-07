-- Couple activities: the activities a couple generally enjoys (surf, hike,
-- museums, ...), added to the existing dining_preferences "what we like" row.
-- Two-level profile slice 2. Free-text list, same shape as vibe_tags/cuisines.
-- Idempotent: safe to paste-and-run again.

alter table public.dining_preferences
  add column if not exists activities text[] not null default '{}';
