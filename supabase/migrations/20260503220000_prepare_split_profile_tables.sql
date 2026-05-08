alter table public.easydraft_user_profiles
  add column if not exists avatar_url text,
  add column if not exists job_title text,
  add column if not exists locale text,
  add column if not exists timezone text,
  add column if not exists marketing_opt_in boolean not null default false,
  add column if not exists product_updates_opt_in boolean not null default true,
  add column if not exists last_seen_at timestamptz,
  add column if not exists onboarding_completed_at timestamptz;
alter table public.easydraft_staff_profiles
  add column if not exists avatar_url text,
  add column if not exists job_title text,
  add column if not exists locale text,
  add column if not exists timezone text,
  add column if not exists marketing_opt_in boolean not null default false,
  add column if not exists product_updates_opt_in boolean not null default true,
  add column if not exists last_seen_at timestamptz,
  add column if not exists onboarding_completed_at timestamptz;
insert into public.easydraft_staff_profiles (
  user_id,
  email,
  display_name,
  username,
  avatar_url,
  company_name,
  account_type,
  workspace_name,
  job_title,
  locale,
  timezone,
  marketing_opt_in,
  product_updates_opt_in,
  last_seen_at,
  onboarding_completed_at,
  created_at,
  updated_at
)
select
  id,
  email,
  display_name,
  username,
  avatar_url,
  company_name,
  account_type,
  workspace_name,
  job_title,
  locale,
  timezone,
  marketing_opt_in,
  product_updates_opt_in,
  last_seen_at,
  onboarding_completed_at,
  created_at,
  updated_at
from public.profiles
where profile_kind = 'easydraft_staff'
on conflict (user_id) do update
set
  email = excluded.email,
  display_name = excluded.display_name,
  username = excluded.username,
  avatar_url = excluded.avatar_url,
  company_name = excluded.company_name,
  account_type = excluded.account_type,
  workspace_name = excluded.workspace_name,
  job_title = excluded.job_title,
  locale = excluded.locale,
  timezone = excluded.timezone,
  marketing_opt_in = excluded.marketing_opt_in,
  product_updates_opt_in = excluded.product_updates_opt_in,
  last_seen_at = excluded.last_seen_at,
  onboarding_completed_at = excluded.onboarding_completed_at,
  updated_at = excluded.updated_at;
insert into public.easydraft_user_profiles (
  user_id,
  email,
  display_name,
  username,
  avatar_url,
  company_name,
  account_type,
  workspace_name,
  job_title,
  locale,
  timezone,
  marketing_opt_in,
  product_updates_opt_in,
  last_seen_at,
  onboarding_completed_at,
  created_at,
  updated_at
)
select
  id,
  email,
  display_name,
  username,
  avatar_url,
  company_name,
  account_type,
  workspace_name,
  job_title,
  locale,
  timezone,
  marketing_opt_in,
  product_updates_opt_in,
  last_seen_at,
  onboarding_completed_at,
  created_at,
  updated_at
from public.profiles
where profile_kind = 'easydraft_user'
on conflict (user_id) do update
set
  email = excluded.email,
  display_name = excluded.display_name,
  username = excluded.username,
  avatar_url = excluded.avatar_url,
  company_name = excluded.company_name,
  account_type = excluded.account_type,
  workspace_name = excluded.workspace_name,
  job_title = excluded.job_title,
  locale = excluded.locale,
  timezone = excluded.timezone,
  marketing_opt_in = excluded.marketing_opt_in,
  product_updates_opt_in = excluded.product_updates_opt_in,
  last_seen_at = excluded.last_seen_at,
  onboarding_completed_at = excluded.onboarding_completed_at,
  updated_at = excluded.updated_at;
delete from public.easydraft_user_profiles user_profile
using public.profiles profile
where user_profile.user_id = profile.id
  and profile.profile_kind <> 'easydraft_user';
delete from public.easydraft_staff_profiles staff_profile
using public.profiles profile
where staff_profile.user_id = profile.id
  and profile.profile_kind <> 'easydraft_staff';
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
      avatar_url,
      company_name,
      account_type,
      workspace_name,
      job_title,
      locale,
      timezone,
      marketing_opt_in,
      product_updates_opt_in,
      onboarding_completed_at,
      last_seen_at
    )
    values (
      new.id,
      new.email,
      new.display_name,
      new.username,
      new.avatar_url,
      new.company_name,
      new.account_type,
      new.workspace_name,
      new.job_title,
      new.locale,
      new.timezone,
      new.marketing_opt_in,
      new.product_updates_opt_in,
      new.onboarding_completed_at,
      new.last_seen_at
    )
    on conflict (user_id) do update
    set
      email = excluded.email,
      display_name = excluded.display_name,
      username = excluded.username,
      avatar_url = excluded.avatar_url,
      company_name = excluded.company_name,
      account_type = excluded.account_type,
      workspace_name = excluded.workspace_name,
      job_title = excluded.job_title,
      locale = excluded.locale,
      timezone = excluded.timezone,
      marketing_opt_in = excluded.marketing_opt_in,
      product_updates_opt_in = excluded.product_updates_opt_in,
      onboarding_completed_at = excluded.onboarding_completed_at,
      last_seen_at = excluded.last_seen_at;

    delete from public.easydraft_user_profiles where user_id = new.id;
  else
    insert into public.easydraft_user_profiles (
      user_id,
      email,
      display_name,
      username,
      avatar_url,
      company_name,
      account_type,
      workspace_name,
      job_title,
      locale,
      timezone,
      marketing_opt_in,
      product_updates_opt_in,
      onboarding_completed_at,
      last_seen_at
    )
    values (
      new.id,
      new.email,
      new.display_name,
      new.username,
      new.avatar_url,
      new.company_name,
      new.account_type,
      new.workspace_name,
      new.job_title,
      new.locale,
      new.timezone,
      new.marketing_opt_in,
      new.product_updates_opt_in,
      new.onboarding_completed_at,
      new.last_seen_at
    )
    on conflict (user_id) do update
    set
      email = excluded.email,
      display_name = excluded.display_name,
      username = excluded.username,
      avatar_url = excluded.avatar_url,
      company_name = excluded.company_name,
      account_type = excluded.account_type,
      workspace_name = excluded.workspace_name,
      job_title = excluded.job_title,
      locale = excluded.locale,
      timezone = excluded.timezone,
      marketing_opt_in = excluded.marketing_opt_in,
      product_updates_opt_in = excluded.product_updates_opt_in,
      onboarding_completed_at = excluded.onboarding_completed_at,
      last_seen_at = excluded.last_seen_at;

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
