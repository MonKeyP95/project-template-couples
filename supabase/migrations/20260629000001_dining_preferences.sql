-- Dining preferences: a couple's "what we like" profile, one row per workspace.
-- Seeds the restaurant discovery agent's search (Phase 5, slice A). RLS via the
-- existing is_workspace_member helper. Idempotent: safe to paste-and-run again.

create table if not exists public.dining_preferences (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  budget_band text not null default 'any',
  vibe_tags text[] not null default '{}',
  dietary text[] not null default '{}',
  cuisines text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.dining_preferences enable row level security;

do $$
begin
  create policy dining_preferences_select on public.dining_preferences
    for select to authenticated using (public.is_workspace_member(workspace_id));
  create policy dining_preferences_insert on public.dining_preferences
    for insert to authenticated with check (public.is_workspace_member(workspace_id));
  create policy dining_preferences_update on public.dining_preferences
    for update to authenticated
    using (public.is_workspace_member(workspace_id))
    with check (public.is_workspace_member(workspace_id));
exception
  when duplicate_object then null;
end $$;
