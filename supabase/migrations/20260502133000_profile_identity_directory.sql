alter table public.easydraft_user_profiles
  add column if not exists email text,
  add column if not exists display_name text,
  add column if not exists username text,
  add column if not exists company_name text,
  add column if not exists account_type public.account_type not null default 'individual',
  add column if not exists workspace_name text,
  add column if not exists avatar_url text,
  add column if not exists job_title text,
  add column if not exists locale text,
  add column if not exists timezone text,
  add column if not exists marketing_opt_in boolean not null default false,
  add column if not exists product_updates_opt_in boolean not null default true,
  add column if not exists last_seen_at timestamptz,
  add column if not exists onboarding_completed_at timestamptz;

alter table public.easydraft_staff_profiles
  add column if not exists email text,
  add column if not exists display_name text,
  add column if not exists username text,
  add column if not exists company_name text,
  add column if not exists account_type public.account_type not null default 'individual',
  add column if not exists workspace_name text,
  add column if not exists avatar_url text,
  add column if not exists job_title text,
  add column if not exists locale text,
  add column if not exists timezone text,
  add column if not exists marketing_opt_in boolean not null default false,
  add column if not exists product_updates_opt_in boolean not null default true,
  add column if not exists last_seen_at timestamptz,
  add column if not exists onboarding_completed_at timestamptz;

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

create or replace function public.sync_easydraft_profile_from_auth_user()
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

  if inferred_profile_kind = 'easydraft_staff' then
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
      coalesce(new.email, ''),
      inferred_display_name,
      inferred_username,
      inferred_company_name,
      inferred_account_type,
      inferred_workspace_name
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
      coalesce(new.email, ''),
      inferred_display_name,
      inferred_username,
      inferred_company_name,
      inferred_account_type,
      inferred_workspace_name
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

drop trigger if exists sync_easydraft_profile_from_auth_user on auth.users;
create trigger sync_easydraft_profile_from_auth_user
after insert or update of email, raw_user_meta_data, raw_app_meta_data on auth.users
for each row
execute function public.sync_easydraft_profile_from_auth_user();

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
    )::text,
    'profile_kind',
    public.resolve_profile_kind(
      email,
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
  auth_user.id,
  coalesce(auth_user.email, ''),
  coalesce(
    nullif(trim(coalesce(auth_user.raw_user_meta_data ->> 'full_name', auth_user.raw_user_meta_data ->> 'name')), ''),
    nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
    'User'
  ),
  public.normalize_profile_username(auth_user.email, coalesce(auth_user.raw_user_meta_data, '{}'::jsonb)),
  public.resolve_profile_company_name(
    auth_user.email,
    coalesce(auth_user.raw_user_meta_data, '{}'::jsonb),
    public.resolve_profile_account_type(
      coalesce(auth_user.raw_user_meta_data, '{}'::jsonb),
      coalesce(auth_user.raw_app_meta_data, '{}'::jsonb)
    )
  ),
  public.resolve_profile_account_type(
    coalesce(auth_user.raw_user_meta_data, '{}'::jsonb),
    coalesce(auth_user.raw_app_meta_data, '{}'::jsonb)
  ),
  nullif(trim(auth_user.raw_user_meta_data ->> 'workspace_name'), '')
from auth.users auth_user
where public.resolve_profile_kind(
  auth_user.email,
  coalesce(auth_user.raw_user_meta_data, '{}'::jsonb),
  coalesce(auth_user.raw_app_meta_data, '{}'::jsonb)
) = 'easydraft_user'
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
  auth_user.id,
  coalesce(auth_user.email, ''),
  coalesce(
    nullif(trim(coalesce(auth_user.raw_user_meta_data ->> 'full_name', auth_user.raw_user_meta_data ->> 'name')), ''),
    nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
    'User'
  ),
  public.normalize_profile_username(auth_user.email, coalesce(auth_user.raw_user_meta_data, '{}'::jsonb)),
  public.resolve_profile_company_name(
    auth_user.email,
    coalesce(auth_user.raw_user_meta_data, '{}'::jsonb),
    public.resolve_profile_account_type(
      coalesce(auth_user.raw_user_meta_data, '{}'::jsonb),
      coalesce(auth_user.raw_app_meta_data, '{}'::jsonb)
    )
  ),
  public.resolve_profile_account_type(
    coalesce(auth_user.raw_user_meta_data, '{}'::jsonb),
    coalesce(auth_user.raw_app_meta_data, '{}'::jsonb)
  ),
  nullif(trim(auth_user.raw_user_meta_data ->> 'workspace_name'), '')
from auth.users auth_user
where public.resolve_profile_kind(
  auth_user.email,
  coalesce(auth_user.raw_user_meta_data, '{}'::jsonb),
  coalesce(auth_user.raw_app_meta_data, '{}'::jsonb)
) = 'easydraft_staff'
on conflict (user_id) do update
set
  email = excluded.email,
  display_name = excluded.display_name,
  username = excluded.username,
  company_name = excluded.company_name,
  account_type = excluded.account_type,
  workspace_name = excluded.workspace_name;
