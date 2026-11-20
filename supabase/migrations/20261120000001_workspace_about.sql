-- The couple's own words on /profile: a short description and home country.
-- Shown on /profile and fed to the AI as background. Re-runnable.

alter table public.workspaces
  add column if not exists description text not null default '';

alter table public.workspaces
  drop constraint if exists workspaces_description_length;

alter table public.workspaces
  add constraint workspaces_description_length
  check (char_length(description) <= 300);

-- Where the couple lives, free text ("Denmark"). Read by the AI as the usual
-- starting point of a trip; never used to assume what is reachable.
alter table public.workspaces
  add column if not exists home_country text not null default '';

alter table public.workspaces
  drop constraint if exists workspaces_home_country_length;

alter table public.workspaces
  add constraint workspaces_home_country_length
  check (char_length(home_country) <= 60);
