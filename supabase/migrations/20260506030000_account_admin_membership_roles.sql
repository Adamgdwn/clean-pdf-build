do $$
begin
  if exists (
    select 1
    from pg_type type
    join pg_enum enum_value on enum_value.enumtypid = type.oid
    join pg_namespace namespace on namespace.oid = type.typnamespace
    where namespace.nspname = 'public'
      and type.typname = 'workspace_role'
      and enum_value.enumlabel = 'owner'
  ) and not exists (
    select 1
    from pg_type type
    join pg_enum enum_value on enum_value.enumtypid = type.oid
    join pg_namespace namespace on namespace.oid = type.typnamespace
    where namespace.nspname = 'public'
      and type.typname = 'workspace_role'
      and enum_value.enumlabel = 'account_admin'
  ) then
    alter type public.workspace_role rename value 'owner' to 'account_admin';
  end if;

  if exists (
    select 1
    from pg_type type
    join pg_enum enum_value on enum_value.enumtypid = type.oid
    join pg_namespace namespace on namespace.oid = type.typnamespace
    where namespace.nspname = 'public'
      and type.typname = 'organization_role'
      and enum_value.enumlabel = 'owner'
  ) and not exists (
    select 1
    from pg_type type
    join pg_enum enum_value on enum_value.enumtypid = type.oid
    join pg_namespace namespace on namespace.oid = type.typnamespace
    where namespace.nspname = 'public'
      and type.typname = 'organization_role'
      and enum_value.enumlabel = 'account_admin'
  ) then
    alter type public.organization_role rename value 'owner' to 'account_admin';
  end if;
end $$;
