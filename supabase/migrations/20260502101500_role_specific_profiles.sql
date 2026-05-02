do $$
begin
  if not exists (select 1 from pg_type where typname = 'profile_kind') then
    create type public.profile_kind as enum ('easydraft_user', 'easydraft_staff');
  end if;
end $$;

alter table public.profiles
  add column if not exists profile_kind public.profile_kind;

update public.profiles
set profile_kind = case
  when lower(split_part(email, '@', 2)) = 'agoperations.ca' then 'easydraft_staff'::public.profile_kind
  else 'easydraft_user'::public.profile_kind
end
where profile_kind is null;

alter table public.profiles
  alter column profile_kind set default 'easydraft_user',
  alter column profile_kind set not null;

create table if not exists public.easydraft_user_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.easydraft_staff_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.resolve_profile_kind(
  target_email text,
  user_meta jsonb default '{}'::jsonb,
  app_meta jsonb default '{}'::jsonb
)
returns public.profile_kind
language plpgsql
stable
as $$
declare
  requested_kind text;
  normalized_domain text;
begin
  requested_kind := lower(
    coalesce(
      nullif(trim(user_meta ->> 'profile_kind'), ''),
      nullif(trim(app_meta ->> 'profile_kind'), '')
    )
  );

  if requested_kind = 'easydraft_staff' then
    return 'easydraft_staff'::public.profile_kind;
  end if;

  if requested_kind = 'easydraft_user' then
    return 'easydraft_user'::public.profile_kind;
  end if;

  normalized_domain := lower(split_part(coalesce(target_email, ''), '@', 2));

  if normalized_domain = 'agoperations.ca' then
    return 'easydraft_staff'::public.profile_kind;
  end if;

  return 'easydraft_user'::public.profile_kind;
end;
$$;

create or replace function public.sync_role_specific_profile_tables()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.profile_kind = 'easydraft_staff' then
    insert into public.easydraft_staff_profiles (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

    delete from public.easydraft_user_profiles where user_id = new.id;
  else
    insert into public.easydraft_user_profiles (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

    delete from public.easydraft_staff_profiles where user_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_role_specific_profile_tables on public.profiles;
create trigger sync_role_specific_profile_tables
after insert or update of profile_kind on public.profiles
for each row
execute function public.sync_role_specific_profile_tables();

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  inferred_display_name text;
  inferred_profile_kind public.profile_kind;
begin
  inferred_display_name := coalesce(
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'User'
  );

  inferred_profile_kind := public.resolve_profile_kind(
    new.email,
    coalesce(new.raw_user_meta_data, '{}'::jsonb),
    coalesce(new.raw_app_meta_data, '{}'::jsonb)
  );

  insert into public.profiles (id, email, display_name, profile_kind)
  values (new.id, coalesce(new.email, ''), inferred_display_name, inferred_profile_kind)
  on conflict (id) do update
  set
    email = excluded.email,
    profile_kind = excluded.profile_kind,
    display_name = case
      when nullif(trim(public.profiles.display_name), '') is null then excluded.display_name
      when public.profiles.display_name = split_part(public.profiles.email, '@', 1) then excluded.display_name
      else public.profiles.display_name
    end;

  return new;
end;
$$;

drop trigger if exists sync_profile_from_auth_user on auth.users;
create trigger sync_profile_from_auth_user
after insert or update of email, raw_user_meta_data on auth.users
for each row
execute function public.sync_profile_from_auth_user();

insert into public.profiles (id, email, display_name, profile_kind)
select
  auth_user.id,
  coalesce(auth_user.email, ''),
  coalesce(
    nullif(trim(coalesce(auth_user.raw_user_meta_data ->> 'full_name', auth_user.raw_user_meta_data ->> 'name')), ''),
    nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
    'User'
  ),
  public.resolve_profile_kind(
    auth_user.email,
    coalesce(auth_user.raw_user_meta_data, '{}'::jsonb),
    coalesce(auth_user.raw_app_meta_data, '{}'::jsonb)
  )
from auth.users auth_user
on conflict (id) do update
set
  email = excluded.email,
  profile_kind = excluded.profile_kind;

insert into public.easydraft_user_profiles (user_id)
select id
from public.profiles
where profile_kind = 'easydraft_user'
on conflict (user_id) do nothing;

insert into public.easydraft_staff_profiles (user_id)
select id
from public.profiles
where profile_kind = 'easydraft_staff'
on conflict (user_id) do nothing;

delete from public.easydraft_user_profiles
where user_id in (
  select id
  from public.profiles
  where profile_kind <> 'easydraft_user'
);

delete from public.easydraft_staff_profiles
where user_id in (
  select id
  from public.profiles
  where profile_kind <> 'easydraft_staff'
);

drop trigger if exists set_easydraft_user_profiles_updated_at on public.easydraft_user_profiles;
create trigger set_easydraft_user_profiles_updated_at
before update on public.easydraft_user_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_easydraft_staff_profiles_updated_at on public.easydraft_staff_profiles;
create trigger set_easydraft_staff_profiles_updated_at
before update on public.easydraft_staff_profiles
for each row
execute function public.set_updated_at();

alter table public.easydraft_user_profiles enable row level security;
alter table public.easydraft_staff_profiles enable row level security;

create policy "users can read their EasyDraft user profile"
on public.easydraft_user_profiles
for select
to authenticated
using (user_id = auth.uid());

create policy "users can insert their EasyDraft user profile"
on public.easydraft_user_profiles
for insert
to authenticated
with check (user_id = auth.uid());

create policy "users can update their EasyDraft user profile"
on public.easydraft_user_profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users can read their EasyDraft staff profile"
on public.easydraft_staff_profiles
for select
to authenticated
using (user_id = auth.uid());

create policy "users can insert their EasyDraft staff profile"
on public.easydraft_staff_profiles
for insert
to authenticated
with check (user_id = auth.uid());

create policy "users can update their EasyDraft staff profile"
on public.easydraft_staff_profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
