-- A short free-text description of the couple, written by its members.
-- Shown on /profile and fed to the AI as background. Re-runnable.

alter table public.workspaces
  add column if not exists description text not null default '';

alter table public.workspaces
  drop constraint if exists workspaces_description_length;

alter table public.workspaces
  add constraint workspaces_description_length
  check (char_length(description) <= 300);
