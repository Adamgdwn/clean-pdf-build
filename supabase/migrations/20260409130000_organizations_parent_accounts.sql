do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_type') then
    create type public.account_type as enum ('individual', 'corporate');
  end if;

  if not exists (select 1 from pg_type where typname = 'organization_role') then
    create type public.organization_role as enum ('owner', 'admin', 'member', 'billing_admin');
  end if;
end $$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  account_type public.account_type not null default 'individual',
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  billing_email text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.organization_role not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (organization_id, user_id)
);

alter table public.workspaces
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

drop trigger if exists set_organizations_updated_at on public.organizations;
create trigger set_organizations_updated_at
before update on public.organizations
for each row
execute function public.set_updated_at();

with created_organizations as (
  insert into public.organizations (name, slug, account_type, owner_user_id, billing_email)
  select
    workspace.name,
    workspace.slug,
    case
      when workspace.workspace_type = 'team' then 'corporate'::public.account_type
      else 'individual'::public.account_type
    end,
    workspace.owner_user_id,
    workspace.billing_email
  from public.workspaces workspace
  where workspace.organization_id is null
  on conflict (slug) do update
  set
    name = excluded.name,
    account_type = excluded.account_type,
    owner_user_id = excluded.owner_user_id,
    billing_email = excluded.billing_email
  returning id, slug
)
update public.workspaces workspace
set organization_id = organization.id
from public.organizations organization
where workspace.organization_id is null
  and organization.slug = workspace.slug;

insert into public.organization_memberships (organization_id, user_id, role, created_at)
select
  workspace.organization_id,
  membership.user_id,
  membership.role::text::public.organization_role,
  membership.created_at
from public.workspace_memberships membership
join public.workspaces workspace on workspace.id = membership.workspace_id
where workspace.organization_id is not null
on conflict (organization_id, user_id) do update
set role = excluded.role;

alter table public.workspaces
  alter column organization_id set not null;

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
  );
$$;

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;

create policy "members can read organizations"
on public.organizations
for select
to authenticated
using (public.is_organization_member(id));

create policy "members can read organization memberships"
on public.organization_memberships
for select
to authenticated
using (public.is_organization_member(organization_id));
