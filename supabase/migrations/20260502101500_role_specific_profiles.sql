do $$
begin
  if not exists (select 1 from pg_type where typname = 'profile_kind') then
    create type public.profile_kind as enum ('easydraft_user', 'easydraft_staff');
  end if;
end $$;

create table if not exists public.easydraft_user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  username text,
  company_name text,
  account_type public.account_type not null default 'individual',
  workspace_name text,
  avatar_url text,
  job_title text,
  locale text,
  timezone text,
  marketing_opt_in boolean not null default false,
  product_updates_opt_in boolean not null default true,
  last_seen_at timestamptz,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.easydraft_staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  username text,
  company_name text,
  account_type public.account_type not null default 'individual',
  workspace_name text,
  avatar_url text,
  job_title text,
  locale text,
  timezone text,
  marketing_opt_in boolean not null default false,
  product_updates_opt_in boolean not null default true,
  last_seen_at timestamptz,
  onboarding_completed_at timestamptz,
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

create or replace function public.sync_easydraft_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  inferred_profile_kind public.profile_kind;
  inferred_display_name text;
begin
  inferred_profile_kind := public.resolve_profile_kind(
    new.email,
    coalesce(new.raw_user_meta_data, '{}'::jsonb),
    coalesce(new.raw_app_meta_data, '{}'::jsonb)
  );
  inferred_display_name := coalesce(
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'User'
  );

  if inferred_profile_kind = 'easydraft_staff' then
    insert into public.easydraft_staff_profiles (user_id, email, display_name)
    values (new.id, coalesce(new.email, ''), inferred_display_name)
    on conflict (user_id) do update
    set
      email = excluded.email,
      display_name = excluded.display_name;

    delete from public.easydraft_user_profiles where user_id = new.id;
  else
    insert into public.easydraft_user_profiles (user_id, email, display_name)
    values (new.id, coalesce(new.email, ''), inferred_display_name)
    on conflict (user_id) do update
    set
      email = excluded.email,
      display_name = excluded.display_name;

    delete from public.easydraft_staff_profiles where user_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_easydraft_profile_from_auth_user on auth.users;
create trigger sync_easydraft_profile_from_auth_user
after insert or update of email, raw_user_meta_data, raw_app_meta_data on auth.users
for each row
execute function public.sync_easydraft_profile_from_auth_user();

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
