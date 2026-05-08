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

  return 'easydraft_user'::public.profile_kind;
end;
$$;
with desired_profiles as (
  select
    profile.id,
    case
      when lower(profile.email) = 'admin@agoperations.ca'
        then 'easydraft_staff'::public.profile_kind
      else 'easydraft_user'::public.profile_kind
    end as profile_kind,
    case
      when lower(profile.email) = 'admin@agoperations.ca'
        then 'corporate'::public.account_type
      when lower(coalesce(auth_user.raw_user_meta_data ->> 'account_type', auth_user.raw_app_meta_data ->> 'account_type', '')) = 'corporate'
        then 'corporate'::public.account_type
      else 'individual'::public.account_type
    end as account_type,
    coalesce(
      nullif(trim(auth_user.raw_user_meta_data ->> 'workspace_name'), ''),
      nullif(trim(profile.workspace_name), ''),
      case
        when lower(profile.email) = 'admin@agoperations.ca' then 'AG Operations'
        else null
      end
    ) as workspace_name,
    case
      when lower(profile.email) = 'admin@agoperations.ca'
        then 'AG Operations'
      when lower(coalesce(auth_user.raw_user_meta_data ->> 'account_type', auth_user.raw_app_meta_data ->> 'account_type', '')) = 'corporate'
        then coalesce(
          nullif(trim(auth_user.raw_user_meta_data ->> 'company_name'), ''),
          nullif(trim(auth_user.raw_user_meta_data ->> 'workspace_name'), ''),
          nullif(trim(profile.company_name), '')
        )
      else null
    end as company_name
  from public.profiles profile
  left join auth.users auth_user on auth_user.id = profile.id
)
update public.profiles profile
set
  profile_kind = desired.profile_kind,
  account_type = desired.account_type,
  workspace_name = desired.workspace_name,
  company_name = desired.company_name
from desired_profiles desired
where desired.id = profile.id;
update auth.users auth_user
set raw_user_meta_data = jsonb_strip_nulls(
  coalesce(auth_user.raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object(
    'profile_kind',
    case
      when lower(auth_user.email) = 'admin@agoperations.ca' then 'easydraft_staff'
      else 'easydraft_user'
    end,
    'account_type',
    case
      when lower(auth_user.email) = 'admin@agoperations.ca' then 'corporate'
      when lower(coalesce(auth_user.raw_user_meta_data ->> 'account_type', auth_user.raw_app_meta_data ->> 'account_type', '')) = 'corporate'
        then 'corporate'
      else 'individual'
    end,
    'company_name',
    case
      when lower(auth_user.email) = 'admin@agoperations.ca' then 'AG Operations'
      when lower(coalesce(auth_user.raw_user_meta_data ->> 'account_type', auth_user.raw_app_meta_data ->> 'account_type', '')) = 'corporate'
        then coalesce(
          nullif(trim(auth_user.raw_user_meta_data ->> 'company_name'), ''),
          nullif(trim(auth_user.raw_user_meta_data ->> 'workspace_name'), '')
        )
      else null
    end
  )
)
where auth_user.id in (select id from public.profiles);
update public.organizations organization
set account_type = case
  when owner_profile.profile_kind = 'easydraft_staff'
    or owner_profile.account_type = 'corporate'
    then 'corporate'::public.account_type
  else 'individual'::public.account_type
end
from public.profiles owner_profile
where owner_profile.id = organization.owner_user_id;
update public.workspaces workspace
set workspace_type = case
  when organization.account_type = 'corporate' then 'team'::public.workspace_type
  else 'personal'::public.workspace_type
end
from public.organizations organization
where organization.id = workspace.organization_id;
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
delete from public.easydraft_staff_profiles staff_profile
where not exists (
  select 1
  from public.profiles profile
  where profile.id = staff_profile.user_id
    and profile.profile_kind = 'easydraft_staff'
);
delete from public.easydraft_user_profiles user_profile
where not exists (
  select 1
  from public.profiles profile
  where profile.id = user_profile.user_id
    and profile.profile_kind = 'easydraft_user'
);
