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

  if inferred_profile_kind = 'easydraft_staff' and inferred_account_type = 'individual' then
    inferred_account_type := 'corporate'::public.account_type;
  end if;

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
      workspace_name,
      last_seen_at
    )
    values (
      new.id,
      coalesce(new.email, ''),
      inferred_display_name,
      inferred_username,
      inferred_company_name,
      inferred_account_type,
      inferred_workspace_name,
      timezone('utc', now())
    )
    on conflict (user_id) do update
    set
      email = excluded.email,
      username = case
        when nullif(trim(public.easydraft_staff_profiles.username), '') is null then excluded.username
        else public.easydraft_staff_profiles.username
      end,
      company_name = coalesce(public.easydraft_staff_profiles.company_name, excluded.company_name),
      account_type = excluded.account_type,
      workspace_name = coalesce(excluded.workspace_name, public.easydraft_staff_profiles.workspace_name),
      last_seen_at = excluded.last_seen_at,
      display_name = case
        when nullif(trim(public.easydraft_staff_profiles.display_name), '') is null then excluded.display_name
        when public.easydraft_staff_profiles.display_name = split_part(public.easydraft_staff_profiles.email, '@', 1) then excluded.display_name
        else public.easydraft_staff_profiles.display_name
      end;

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
      last_seen_at
    )
    values (
      new.id,
      coalesce(new.email, ''),
      inferred_display_name,
      inferred_username,
      inferred_company_name,
      inferred_account_type,
      inferred_workspace_name,
      timezone('utc', now())
    )
    on conflict (user_id) do update
    set
      email = excluded.email,
      username = case
        when nullif(trim(public.easydraft_user_profiles.username), '') is null then excluded.username
        else public.easydraft_user_profiles.username
      end,
      company_name = coalesce(public.easydraft_user_profiles.company_name, excluded.company_name),
      account_type = excluded.account_type,
      workspace_name = coalesce(excluded.workspace_name, public.easydraft_user_profiles.workspace_name),
      last_seen_at = excluded.last_seen_at,
      display_name = case
        when nullif(trim(public.easydraft_user_profiles.display_name), '') is null then excluded.display_name
        when public.easydraft_user_profiles.display_name = split_part(public.easydraft_user_profiles.email, '@', 1) then excluded.display_name
        else public.easydraft_user_profiles.display_name
      end;

    delete from public.easydraft_staff_profiles where user_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_role_specific_profile_tables on public.profiles;
drop function if exists public.sync_role_specific_profile_tables();

alter table public.easydraft_user_profiles
  drop constraint if exists easydraft_user_profiles_user_id_fkey,
  add constraint easydraft_user_profiles_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.easydraft_staff_profiles
  drop constraint if exists easydraft_staff_profiles_user_id_fkey,
  add constraint easydraft_staff_profiles_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

do $$
declare
  fk record;
  delete_action text;
  update_action text;
begin
  for fk in
    select
      constraint_record.conrelid,
      constraint_record.conname,
      array_agg(quote_ident(attribute_record.attname) order by key_record.ordinality) as column_names,
      constraint_record.confdeltype,
      constraint_record.confupdtype
    from pg_constraint constraint_record
    join unnest(constraint_record.conkey) with ordinality as key_record(attnum, ordinality) on true
    join pg_attribute attribute_record
      on attribute_record.attrelid = constraint_record.conrelid
      and attribute_record.attnum = key_record.attnum
    where constraint_record.contype = 'f'
      and constraint_record.confrelid = 'public.profiles'::regclass
      and constraint_record.conrelid not in (
        'public.easydraft_user_profiles'::regclass,
        'public.easydraft_staff_profiles'::regclass
      )
    group by
      constraint_record.conrelid,
      constraint_record.conname,
      constraint_record.confdeltype,
      constraint_record.confupdtype
  loop
    if array_length(fk.column_names, 1) <> 1 then
      raise exception 'Cannot retarget multi-column profile foreign key %.%', fk.conrelid::regclass, fk.conname;
    end if;

    delete_action := case fk.confdeltype
      when 'a' then ''
      when 'r' then ' on delete restrict'
      when 'c' then ' on delete cascade'
      when 'n' then ' on delete set null'
      when 'd' then ' on delete set default'
      else ''
    end;

    update_action := case fk.confupdtype
      when 'a' then ''
      when 'r' then ' on update restrict'
      when 'c' then ' on update cascade'
      when 'n' then ' on update set null'
      when 'd' then ' on update set default'
      else ''
    end;

    execute format('alter table %s drop constraint %I', fk.conrelid::regclass, fk.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%s) references auth.users(id)%s%s',
      fk.conrelid::regclass,
      fk.conname,
      array_to_string(fk.column_names, ', '),
      delete_action,
      update_action
    );
  end loop;
end;
$$;

drop table public.profiles;
