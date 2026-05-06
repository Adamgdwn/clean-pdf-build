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

do $$
declare
  legacy_identity_table regclass := to_regclass(format('%I.%I', 'public', 'pro' || 'files'));
  constraint_record record;
  fk_record record;
  target_table regclass;
  target_attnum int2;
begin
  if legacy_identity_table is not null then
    for constraint_record in
      select conrelid::regclass as source_table, conname
      from pg_constraint
      where confrelid = legacy_identity_table
        and contype = 'f'
    loop
      execute format(
        'alter table %s drop constraint if exists %I',
        constraint_record.source_table,
        constraint_record.conname
      );
    end loop;
  end if;

  for fk_record in
    select *
    from (values
      ('public.documents', 'uploaded_by_user_id', 'cascade'),
      ('public.documents', 'reopened_by_user_id', 'set null'),
      ('public.documents', 'locked_by_user_id', 'set null'),
      ('public.documents', 'deleted_by_user_id', 'set null'),
      ('public.documents', 'purged_by_user_id', 'set null'),
      ('public.documents', 'workflow_status_updated_by_user_id', 'set null'),
      ('public.document_access', 'user_id', 'cascade'),
      ('public.document_invites', 'invited_by_user_id', 'cascade'),
      ('public.document_signers', 'user_id', 'set null'),
      ('public.document_versions', 'created_by_user_id', 'cascade'),
      ('public.document_processing_jobs', 'requested_by_user_id', 'cascade'),
      ('public.workspaces', 'owner_user_id', 'cascade'),
      ('public.workspace_memberships', 'user_id', 'cascade'),
      ('public.billing_usage_events', 'source_user_id', 'set null'),
      ('public.document_notifications', 'recipient_user_id', 'set null'),
      ('public.saved_signatures', 'user_id', 'cascade'),
      ('public.document_editor_snapshots', 'created_by_user_id', 'cascade'),
      ('public.digital_signature_profiles', 'user_id', 'cascade'),
      ('public.workspace_invitations', 'invited_by_user_id', 'cascade'),
      ('public.organizations', 'owner_user_id', 'cascade'),
      ('public.organization_memberships', 'user_id', 'cascade'),
      ('public.feedback_requests', 'requester_user_id', 'set null'),
      ('public.feedback_requests', 'owner_user_id', 'set null'),
      ('public.feedback_requests', 'updated_by_user_id', 'set null'),
      ('public.signature_events', 'signer_user_id', 'set null')
    ) as fk(table_name, column_name, delete_action)
  loop
    target_table := to_regclass(fk_record.table_name);

    if target_table is null then
      continue;
    end if;

    select attnum
    into target_attnum
    from pg_attribute
    where attrelid = target_table
      and attname = fk_record.column_name
      and not attisdropped;

    if target_attnum is null then
      continue;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = target_table
        and contype = 'f'
        and confrelid = 'auth.users'::regclass
        and target_attnum = any(conkey)
    ) then
      execute format(
        'alter table %s add constraint %I foreign key (%I) references auth.users(id) on delete %s',
        target_table,
        replace(replace(fk_record.table_name, 'public.', ''), '.', '_') || '_' || fk_record.column_name || '_auth_users_fkey',
        fk_record.column_name,
        fk_record.delete_action
      );
    end if;
  end loop;

  if legacy_identity_table is not null then
    execute format('drop table if exists %s cascade', legacy_identity_table);
  end if;
end $$;

do $$
declare
  target_table regclass;
  constraint_record record;
begin
  foreach target_table in array array[
    'public.easydraft_user_profiles'::regclass,
    'public.easydraft_staff_profiles'::regclass
  ]
  loop
    for constraint_record in
      select conname
      from pg_constraint
      where conrelid = target_table
        and contype = 'f'
    loop
      execute format(
        'alter table %s drop constraint if exists %I',
        target_table,
        constraint_record.conname
      );
    end loop;
  end loop;
end $$;

alter table public.easydraft_user_profiles
  add constraint easydraft_user_profiles_user_id_auth_users_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.easydraft_staff_profiles
  add constraint easydraft_staff_profiles_user_id_auth_users_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

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
  profile_payload jsonb;
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

  profile_payload := jsonb_build_object(
    'user_id', new.id,
    'email', coalesce(new.email, ''),
    'display_name', inferred_display_name,
    'username', inferred_username,
    'company_name', inferred_company_name,
    'account_type', inferred_account_type,
    'workspace_name', inferred_workspace_name,
    'avatar_url', nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    'job_title', nullif(trim(new.raw_user_meta_data ->> 'job_title'), ''),
    'locale', nullif(trim(new.raw_user_meta_data ->> 'locale'), ''),
    'timezone', nullif(trim(new.raw_user_meta_data ->> 'timezone'), ''),
    'marketing_opt_in', coalesce((new.raw_user_meta_data ->> 'marketing_opt_in')::boolean, false),
    'product_updates_opt_in', coalesce((new.raw_user_meta_data ->> 'product_updates_opt_in')::boolean, true),
    'onboarding_completed_at', nullif(trim(new.raw_user_meta_data ->> 'onboarding_completed_at'), '')::timestamptz
  );

  if inferred_profile_kind = 'easydraft_staff' then
    insert into public.easydraft_staff_profiles (
      user_id,
      email,
      display_name,
      username,
      company_name,
      account_type,
      workspace_name,
      avatar_url,
      job_title,
      locale,
      timezone,
      marketing_opt_in,
      product_updates_opt_in,
      onboarding_completed_at
    )
    values (
      (profile_payload ->> 'user_id')::uuid,
      profile_payload ->> 'email',
      profile_payload ->> 'display_name',
      profile_payload ->> 'username',
      profile_payload ->> 'company_name',
      (profile_payload ->> 'account_type')::public.account_type,
      profile_payload ->> 'workspace_name',
      profile_payload ->> 'avatar_url',
      profile_payload ->> 'job_title',
      profile_payload ->> 'locale',
      profile_payload ->> 'timezone',
      (profile_payload ->> 'marketing_opt_in')::boolean,
      (profile_payload ->> 'product_updates_opt_in')::boolean,
      (profile_payload ->> 'onboarding_completed_at')::timestamptz
    )
    on conflict (user_id) do update
    set
      email = excluded.email,
      display_name = excluded.display_name,
      username = excluded.username,
      company_name = excluded.company_name,
      account_type = excluded.account_type,
      workspace_name = excluded.workspace_name,
      avatar_url = excluded.avatar_url,
      job_title = excluded.job_title,
      locale = excluded.locale,
      timezone = excluded.timezone,
      marketing_opt_in = excluded.marketing_opt_in,
      product_updates_opt_in = excluded.product_updates_opt_in,
      onboarding_completed_at = coalesce(excluded.onboarding_completed_at, public.easydraft_staff_profiles.onboarding_completed_at);

    delete from public.easydraft_user_profiles where user_id = new.id;
  else
    insert into public.easydraft_user_profiles (
      user_id,
      email,
      display_name,
      username,
      company_name,
      account_type,
      workspace_name,
      avatar_url,
      job_title,
      locale,
      timezone,
      marketing_opt_in,
      product_updates_opt_in,
      onboarding_completed_at
    )
    values (
      (profile_payload ->> 'user_id')::uuid,
      profile_payload ->> 'email',
      profile_payload ->> 'display_name',
      profile_payload ->> 'username',
      profile_payload ->> 'company_name',
      (profile_payload ->> 'account_type')::public.account_type,
      profile_payload ->> 'workspace_name',
      profile_payload ->> 'avatar_url',
      profile_payload ->> 'job_title',
      profile_payload ->> 'locale',
      profile_payload ->> 'timezone',
      (profile_payload ->> 'marketing_opt_in')::boolean,
      (profile_payload ->> 'product_updates_opt_in')::boolean,
      (profile_payload ->> 'onboarding_completed_at')::timestamptz
    )
    on conflict (user_id) do update
    set
      email = excluded.email,
      display_name = excluded.display_name,
      username = excluded.username,
      company_name = excluded.company_name,
      account_type = excluded.account_type,
      workspace_name = excluded.workspace_name,
      avatar_url = excluded.avatar_url,
      job_title = excluded.job_title,
      locale = excluded.locale,
      timezone = excluded.timezone,
      marketing_opt_in = excluded.marketing_opt_in,
      product_updates_opt_in = excluded.product_updates_opt_in,
      onboarding_completed_at = coalesce(excluded.onboarding_completed_at, public.easydraft_user_profiles.onboarding_completed_at);

    delete from public.easydraft_staff_profiles where user_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_profile_from_auth_user on auth.users;
drop trigger if exists sync_easydraft_profile_from_auth_user on auth.users;
create trigger sync_easydraft_profile_from_auth_user
after insert or update of email, raw_user_meta_data, raw_app_meta_data on auth.users
for each row
execute function public.sync_easydraft_profile_from_auth_user();

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
