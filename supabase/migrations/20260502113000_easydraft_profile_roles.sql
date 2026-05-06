drop trigger if exists sync_easydraft_profile_from_auth_user on auth.users;

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

create trigger sync_easydraft_profile_from_auth_user
after insert or update of email, raw_user_meta_data, raw_app_meta_data on auth.users
for each row
execute function public.sync_easydraft_profile_from_auth_user();

update auth.users
set raw_user_meta_data = jsonb_set(
  coalesce(raw_user_meta_data, '{}'::jsonb),
  '{profile_kind}',
  to_jsonb(public.resolve_profile_kind(email, coalesce(raw_user_meta_data, '{}'::jsonb), coalesce(raw_app_meta_data, '{}'::jsonb))::text),
  true
);

insert into public.easydraft_user_profiles (user_id, email, display_name)
select
  auth_user.id,
  coalesce(auth_user.email, ''),
  coalesce(
    nullif(trim(coalesce(auth_user.raw_user_meta_data ->> 'full_name', auth_user.raw_user_meta_data ->> 'name')), ''),
    nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
    'User'
  )
from auth.users auth_user
where public.resolve_profile_kind(
  auth_user.email,
  coalesce(auth_user.raw_user_meta_data, '{}'::jsonb),
  coalesce(auth_user.raw_app_meta_data, '{}'::jsonb)
) = 'easydraft_user'
on conflict (user_id) do update
set
  email = excluded.email,
  display_name = excluded.display_name;

insert into public.easydraft_staff_profiles (user_id, email, display_name)
select
  auth_user.id,
  coalesce(auth_user.email, ''),
  coalesce(
    nullif(trim(coalesce(auth_user.raw_user_meta_data ->> 'full_name', auth_user.raw_user_meta_data ->> 'name')), ''),
    nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
    'User'
  )
from auth.users auth_user
where public.resolve_profile_kind(
  auth_user.email,
  coalesce(auth_user.raw_user_meta_data, '{}'::jsonb),
  coalesce(auth_user.raw_app_meta_data, '{}'::jsonb)
) = 'easydraft_staff'
on conflict (user_id) do update
set
  email = excluded.email,
  display_name = excluded.display_name;

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
