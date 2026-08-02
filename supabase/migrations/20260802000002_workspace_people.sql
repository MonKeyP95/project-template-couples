-- Travellers who are not users. A person row is a subject that can hold money;
-- workspace_members stays the auth/permission backbone. Safe to run repeatedly.

create table if not exists public.workspace_people (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  user_id      uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists workspace_people_workspace_idx
  on public.workspace_people (workspace_id);

-- One person row per member per workspace. Partial, because avatars share the
-- null user_id and must not collide with each other.
create unique index if not exists workspace_people_user_idx
  on public.workspace_people (workspace_id, user_id)
  where user_id is not null;

-- Backfill: every existing member becomes a person. Fresh uuids, so a user in
-- two workspaces gets one row per workspace.
insert into public.workspace_people (workspace_id, display_name, user_id)
select wm.workspace_id, coalesce(p.display_name, 'Member'), wm.user_id
from public.workspace_members wm
left join public.profiles p on p.id = wm.user_id
on conflict do nothing;

-- Drop the old foreign keys FIRST. They still point at auth.users, and the
-- data migration below writes person ids -- which Postgres would check against
-- users and reject.
alter table public.expenses drop constraint if exists expenses_paid_by_fkey;
alter table public.trip_savings_contributions
  drop constraint if exists trip_savings_contributions_user_id_fkey;

-- Data migration: rewrite the two subject columns from user ids to person ids.
-- Self-limiting -- after one pass these hold person ids, which match no user_id.
update public.expenses e
set paid_by = wp.id
from public.trips t
join public.workspace_people wp on wp.workspace_id = t.workspace_id
where e.trip_id = t.id and wp.user_id = e.paid_by;

update public.trip_savings_contributions s
set user_id = wp.id
from public.trips t
join public.workspace_people wp on wp.workspace_id = t.workspace_id
where s.trip_id = t.id and wp.user_id = s.user_id;

-- Point them at people, now that no row references auth.users.
alter table public.expenses
  add constraint expenses_paid_by_fkey
  foreign key (paid_by) references public.workspace_people(id) on delete restrict;

alter table public.trip_savings_contributions
  add constraint trip_savings_contributions_user_id_fkey
  foreign key (user_id) references public.workspace_people(id) on delete restrict;

-- RLS: people are readable and writable by workspace members.
alter table public.workspace_people enable row level security;

drop policy if exists workspace_people_select on public.workspace_people;
create policy workspace_people_select on public.workspace_people
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_people_insert on public.workspace_people;
create policy workspace_people_insert on public.workspace_people
  for insert to authenticated with check (public.is_workspace_member(workspace_id));

drop policy if exists workspace_people_update on public.workspace_people;
create policy workspace_people_update on public.workspace_people
  for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists workspace_people_delete on public.workspace_people;
create policy workspace_people_delete on public.workspace_people
  for delete to authenticated using (public.is_workspace_member(workspace_id));

-- The two subject policies were identical in shape: a join to workspace_members
-- proving the subject belongs to the trip's workspace. Both now join people, so
-- an avatar counts as a subject.
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    public.is_trip_workspace_member(trip_id)
    and exists (
      select 1
      from public.trips t
      join public.workspace_people wp on wp.workspace_id = t.workspace_id
      where t.id = trip_id and wp.id = paid_by
    )
  );

drop policy if exists savings_insert on public.trip_savings_contributions;
create policy savings_insert on public.trip_savings_contributions
  for insert to authenticated
  with check (
    public.is_trip_workspace_member(trip_id)
    and exists (
      select 1
      from public.trips t
      join public.workspace_people wp on wp.workspace_id = t.workspace_id
      where t.id = trip_id and wp.id = user_id
    )
  );

-- A new member gets a person row automatically, so signup and invite-accept
-- need no application changes.
create or replace function public.handle_new_workspace_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_people (workspace_id, display_name, user_id)
  values (
    new.workspace_id,
    coalesce(
      (select display_name from public.profiles where id = new.user_id),
      'Member'
    ),
    new.user_id
  )
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_workspace_member_created on public.workspace_members;
create trigger on_workspace_member_created
  after insert on public.workspace_members
  for each row execute function public.handle_new_workspace_member();
