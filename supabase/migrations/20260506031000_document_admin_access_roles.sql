do $$
begin
  if exists (
    select 1
    from pg_type type
    join pg_enum enum_value on enum_value.enumtypid = type.oid
    join pg_namespace namespace on namespace.oid = type.typnamespace
    where namespace.nspname = 'public'
      and type.typname = 'access_role'
      and enum_value.enumlabel = 'owner'
  ) and not exists (
    select 1
    from pg_type type
    join pg_enum enum_value on enum_value.enumtypid = type.oid
    join pg_namespace namespace on namespace.oid = type.typnamespace
    where namespace.nspname = 'public'
      and type.typname = 'access_role'
      and enum_value.enumlabel = 'document_admin'
  ) then
    alter type public.access_role rename value 'owner' to 'document_admin';
  end if;

  if exists (
    select 1
    from pg_type type
    join pg_enum enum_value on enum_value.enumtypid = type.oid
    join pg_namespace namespace on namespace.oid = type.typnamespace
    where namespace.nspname = 'public'
      and type.typname = 'lock_policy'
      and enum_value.enumlabel = 'owner_only'
  ) and not exists (
    select 1
    from pg_type type
    join pg_enum enum_value on enum_value.enumtypid = type.oid
    join pg_namespace namespace on namespace.oid = type.typnamespace
    where namespace.nspname = 'public'
      and type.typname = 'lock_policy'
      and enum_value.enumlabel = 'document_admin_only'
  ) then
    alter type public.lock_policy rename value 'owner_only' to 'document_admin_only';
  end if;

  if exists (
    select 1
    from pg_type type
    join pg_enum enum_value on enum_value.enumtypid = type.oid
    join pg_namespace namespace on namespace.oid = type.typnamespace
    where namespace.nspname = 'public'
      and type.typname = 'lock_policy'
      and enum_value.enumlabel = 'owner_and_editors'
  ) and not exists (
    select 1
    from pg_type type
    join pg_enum enum_value on enum_value.enumtypid = type.oid
    join pg_namespace namespace on namespace.oid = type.typnamespace
    where namespace.nspname = 'public'
      and type.typname = 'lock_policy'
      and enum_value.enumlabel = 'document_admin_and_editors'
  ) then
    alter type public.lock_policy rename value 'owner_and_editors' to 'document_admin_and_editors';
  end if;

  if exists (
    select 1
    from pg_type type
    join pg_enum enum_value on enum_value.enumtypid = type.oid
    join pg_namespace namespace on namespace.oid = type.typnamespace
    where namespace.nspname = 'public'
      and type.typname = 'lock_policy'
      and enum_value.enumlabel = 'owner_editors_and_active_signer'
  ) and not exists (
    select 1
    from pg_type type
    join pg_enum enum_value on enum_value.enumtypid = type.oid
    join pg_namespace namespace on namespace.oid = type.typnamespace
    where namespace.nspname = 'public'
      and type.typname = 'lock_policy'
      and enum_value.enumlabel = 'document_admin_editors_and_active_signer'
  ) then
    alter type public.lock_policy
      rename value 'owner_editors_and_active_signer' to 'document_admin_editors_and_active_signer';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'documents'
      and column_name = 'lock_policy'
  ) then
    alter table public.documents
      alter column lock_policy set default 'document_admin_only'::public.lock_policy;
  end if;
end $$;
