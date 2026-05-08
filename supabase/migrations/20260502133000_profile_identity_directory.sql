alter table public.profiles
  add column if not exists username text,
  add column if not exists account_type public.account_type not null default 'individual',
  add column if not exists workspace_name text;
alter table public.easydraft_user_profiles
  add column if not exists email text,
  add column if not exists display_name text,
  add column if not exists username text,
  add column if not exists company_name text,
  add column if not exists account_type public.account_type not null default 'individual',
  add column if not exists workspace_name text;
alter table public.easydraft_staff_profiles
  add column if not exists email text,
  add column if not exists display_name text,
  add column if not exists username text,
  add column if not exists company_name text,
  add column if not exists account_type public.account_type not null default 'individual',
  add column if not exists workspace_name text;
create or replace function public.normalize_profile_username(
  target_email text,
  user_meta jsonb default '{}'::jsonb
)
returns text
language plpgsql
immutable
as $$
declare
  requested_username text;
begin
  requested_username := lower(
    coalesce(
      nullif(trim(user_meta ->> 'username'), ''),
      nullif(trim(split_part(coalesce(target_email, ''), '@', 1)), ''),
      'user'
    )
  );

  requested_username := regexp_replace(requested_username, '[^a-z0-9._-]+', '-', 'g');
  requested_username := regexp_replace(requested_username, '^[._-]+|[._-]+$', '', 'g');

  return coalesce(nullif(requested_username, ''), 'user');
end;
$$;
create or replace function public.resolve_profile_account_type(
  user_meta jsonb default '{}'::jsonb,
  app_meta jsonb default '{}'::jsonb
)
returns public.account_type
language plpgsql
stable
as $$
declare
  requested_account_type text;
begin
  requested_account_type := lower(
    coalesce(
      nullif(trim(user_meta ->> 'account_type'), ''),
      nullif(trim(app_meta ->> 'account_type'), '')
    )
  );

  if requested_account_type = 'corporate' then
    return 'corporate'::public.account_type;
  end if;

  return 'individual'::public.account_type;
end;
$$;
create or replace function public.resolve_profile_company_name(
  target_email text,
  user_meta jsonb default '{}'::jsonb,
  resolved_account_type public.account_type default 'individual'
)
returns text
language plpgsql
stable
as $$
declare
  requested_company_name text;
  workspace_label text;
  normalized_domain text;
begin
  requested_company_name := nullif(trim(user_meta ->> 'company_name'), '');

  if requested_company_name is not null then
    return requested_company_name;
  end if;

  workspace_label := nullif(trim(user_meta ->> 'workspace_name'), '');

  if resolved_account_type = 'corporate' and workspace_label is not null then
    return workspace_label;
  end if;

  normalized_domain := lower(split_part(coalesce(target_email, ''), '@', 2));

  if normalized_domain = 'agoperations.ca' then
    return 'AG Operations';
  end if;

  return null;
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
    insert into public.easydraft_staff_profiles (
      user_id,
      email,
      display_name,
      username,
      company_name,
      account_type,
      workspace_name
    )
    values (
      new.id,
      new.email,
      new.display_name,
      new.username,
      new.company_name,
      new.account_type,
      new.workspace_name
    )
    on conflict (user_id) do update
    set
      email = excluded.email,
      display_name = excluded.display_name,
      username = excluded.username,
      company_name = excluded.company_name,
      account_type = excluded.account_type,
      workspace_name = excluded.workspace_name;

    delete from public.easydraft_user_profiles where user_id = new.id;
  else
    insert into public.easydraft_user_profiles (
      user_id,
      email,
      display_name,
      username,
      company_name,
      account_type,
      workspace_name
    )
    values (
      new.id,
      new.email,
      new.display_name,
      new.username,
      new.company_name,
      new.account_type,
      new.workspace_name
    )
    on conflict (user_id) do update
    set
      email = excluded.email,
      display_name = excluded.display_name,
      username = excluded.username,
      company_name = excluded.company_name,
      account_type = excluded.account_type,
      workspace_name = excluded.workspace_name;

    delete from public.easydraft_staff_profiles where user_id = new.id;
  end if;

  return new;
end;
$$;
drop trigger if exists sync_role_specific_profile_tables on public.profiles;
create trigger sync_role_specific_profile_tables
after insert or update on public.profiles
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
  inferred_account_type public.account_type;
  inferred_workspace_name text;
  inferred_company_name text;
  inferred_username text;
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
  inferred_account_type := public.resolve_profile_account_type(
    coalesce(new.raw_user_meta_data, '{}'::jsonb),
    coalesce(new.raw_app_meta_data, '{}'::jsonb)
  );
  inferred_workspace_name := nullif(trim(new.raw_user_meta_data ->> 'workspace_name'), '');
  inferred_company_name := public.resolve_profile_company_name(
    new.email,
    coalesce(new.raw_user_meta_data, '{}'::jsonb),
    inferred_account_type
  );
  inferred_username := public.normalize_profile_username(
    new.email,
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  );

  insert into public.profiles (
    id,
    email,
    display_name,
    username,
    company_name,
    account_type,
    workspace_name,
    profile_kind
  )
  values (
    new.id,
    coalesce(new.email, ''),
    inferred_display_name,
    inferred_username,
    inferred_company_name,
    inferred_account_type,
    inferred_workspace_name,
    inferred_profile_kind
  )
  on conflict (id) do update
  set
    email = excluded.email,
    username = case
      when nullif(trim(public.profiles.username), '') is null then excluded.username
      else public.profiles.username
    end,
    company_name = coalesce(public.profiles.company_name, excluded.company_name),
    account_type = excluded.account_type,
    workspace_name = coalesce(excluded.workspace_name, public.profiles.workspace_name),
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
after insert or update of email, raw_user_meta_data, raw_app_meta_data on auth.users
for each row
execute function public.sync_profile_from_auth_user();
with preferred_organizations as (
  select distinct on (membership.user_id)
    membership.user_id,
    organization.name,
    organization.account_type
  from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id
  order by
    membership.user_id,
    case membership.role
      when 'owner' then 0
      when 'admin' then 1
      when 'billing_admin' then 2
      else 3
    end,
    membership.created_at
),
preferred_workspaces as (
  select distinct on (membership.user_id)
    membership.user_id,
    workspace.name,
    workspace.workspace_type
  from public.workspace_memberships membership
  join public.workspaces workspace on workspace.id = membership.workspace_id
  order by
    membership.user_id,
    case membership.role
      when 'owner' then 0
      when 'admin' then 1
      when 'billing_admin' then 2
      else 3
    end,
    membership.created_at
)
update public.profiles profile
set
  username = coalesce(
    nullif(trim(profile.username), ''),
    public.normalize_profile_username(coalesce(auth_user.email, profile.email), coalesce(auth_user.raw_user_meta_data, '{}'::jsonb))
  ),
  account_type = coalesce(
    case
      when lower(coalesce(auth_user.raw_user_meta_data ->> 'account_type', auth_user.raw_app_meta_data ->> 'account_type', '')) = 'corporate'
        then 'corporate'::public.account_type
      when lower(coalesce(auth_user.raw_user_meta_data ->> 'account_type', auth_user.raw_app_meta_data ->> 'account_type', '')) = 'individual'
        then 'individual'::public.account_type
      else null
    end,
    preferred_organizations.account_type,
    case
      when preferred_workspaces.workspace_type = 'team' then 'corporate'::public.account_type
      when preferred_workspaces.workspace_type = 'personal' then 'individual'::public.account_type
      else null
    end,
    profile.account_type,
    'individual'::public.account_type
  ),
  workspace_name = coalesce(
    nullif(trim(auth_user.raw_user_meta_data ->> 'workspace_name'), ''),
    preferred_organizations.name,
    preferred_workspaces.name,
    profile.workspace_name
  ),
  company_name = coalesce(
    profile.company_name,
    nullif(trim(auth_user.raw_user_meta_data ->> 'company_name'), ''),
    case
      when lower(coalesce(auth_user.raw_user_meta_data ->> 'account_type', auth_user.raw_app_meta_data ->> 'account_type', '')) = 'corporate'
        then coalesce(
          nullif(trim(auth_user.raw_user_meta_data ->> 'workspace_name'), ''),
          preferred_organizations.name,
          preferred_workspaces.name
        )
      when preferred_organizations.account_type = 'corporate'
        then preferred_organizations.name
      when lower(split_part(coalesce(auth_user.email, profile.email), '@', 2)) = 'agoperations.ca'
        then 'AG Operations'
      else null
    end
  )
from auth.users auth_user
left join preferred_organizations on preferred_organizations.user_id = auth_user.id
left join preferred_workspaces on preferred_workspaces.user_id = auth_user.id
where auth_user.id = profile.id;
update auth.users
set raw_user_meta_data = jsonb_strip_nulls(
  coalesce(raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object(
    'username',
    coalesce(
      nullif(trim(raw_user_meta_data ->> 'username'), ''),
      public.normalize_profile_username(email, coalesce(raw_user_meta_data, '{}'::jsonb))
    ),
    'company_name',
    coalesce(
      nullif(trim(raw_user_meta_data ->> 'company_name'), ''),
      public.resolve_profile_company_name(
        email,
        coalesce(raw_user_meta_data, '{}'::jsonb),
        public.resolve_profile_account_type(
          coalesce(raw_user_meta_data, '{}'::jsonb),
          coalesce(raw_app_meta_data, '{}'::jsonb)
        )
      )
    ),
    'account_type',
    public.resolve_profile_account_type(
      coalesce(raw_user_meta_data, '{}'::jsonb),
      coalesce(raw_app_meta_data, '{}'::jsonb)
    )::text
  )
)
where true;
insert into public.easydraft_user_profiles (
  user_id,
  email,
  display_name,
  username,
  company_name,
  account_type,
  workspace_name
)
select
  id,
  email,
  display_name,
  username,
  company_name,
  account_type,
  workspace_name
from public.profiles
where profile_kind = 'easydraft_user'
on conflict (user_id) do update
set
  email = excluded.email,
  display_name = excluded.display_name,
  username = excluded.username,
  company_name = excluded.company_name,
  account_type = excluded.account_type,
  workspace_name = excluded.workspace_name;
insert into public.easydraft_staff_profiles (
  user_id,
  email,
  display_name,
  username,
  company_name,
  account_type,
  workspace_name
)
select
  id,
  email,
  display_name,
  username,
  company_name,
  account_type,
  workspace_name
from public.profiles
where profile_kind = 'easydraft_staff'
on conflict (user_id) do update
set
  email = excluded.email,
  display_name = excluded.display_name,
  username = excluded.username,
  company_name = excluded.company_name,
  account_type = excluded.account_type,
  workspace_name = excluded.workspace_name;
