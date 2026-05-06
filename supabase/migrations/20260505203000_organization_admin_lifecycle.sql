alter table public.organizations
  add column if not exists status text not null default 'active',
  add column if not exists suspended_at timestamptz,
  add column if not exists closing_requested_at timestamptz,
  add column if not exists closed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organizations_status_check'
  ) then
    alter table public.organizations
      add constraint organizations_status_check
      check (status in ('active', 'payment_required', 'suspended', 'closing', 'closed'));
  end if;
end $$;

create table if not exists public.organization_license_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  invited_email text,
  role public.organization_role not null default 'member',
  status text not null default 'assigned',
  assigned_by_user_id uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint organization_license_assignments_status_check
    check (status in ('assigned', 'invited', 'suspended', 'revoked')),
  constraint organization_license_assignments_identity_check
    check (user_id is not null or invited_email is not null)
);

create unique index if not exists organization_license_assignments_active_user_idx
on public.organization_license_assignments(organization_id, user_id);

create unique index if not exists organization_license_assignments_active_invite_idx
on public.organization_license_assignments(organization_id, invited_email);

create index if not exists organization_license_assignments_organization_status_idx
on public.organization_license_assignments(organization_id, status);

drop trigger if exists set_organization_license_assignments_updated_at on public.organization_license_assignments;
create trigger set_organization_license_assignments_updated_at
before update on public.organization_license_assignments
for each row
execute function public.set_updated_at();

create table if not exists public.organization_account_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists organization_account_events_organization_created_idx
on public.organization_account_events(organization_id, created_at desc);

alter table public.organization_license_assignments enable row level security;
alter table public.organization_account_events enable row level security;

drop policy if exists "members can read organization licenses" on public.organization_license_assignments;
create policy "members can read organization licenses"
on public.organization_license_assignments
for select
to authenticated
using (public.is_organization_member(organization_id));

drop policy if exists "members can read organization account events" on public.organization_account_events;
create policy "members can read organization account events"
on public.organization_account_events
for select
to authenticated
using (public.is_organization_member(organization_id));

insert into public.organization_license_assignments (
  organization_id,
  workspace_id,
  user_id,
  role,
  status,
  assigned_by_user_id,
  assigned_at
)
select distinct on (membership.organization_id, membership.user_id)
  membership.organization_id,
  workspace.id,
  membership.user_id,
  membership.role,
  'assigned',
  organization.owner_user_id,
  membership.created_at
from public.organization_memberships membership
join public.organizations organization on organization.id = membership.organization_id
left join public.workspaces workspace on workspace.organization_id = membership.organization_id
on conflict do nothing;

insert into public.organization_license_assignments (
  organization_id,
  workspace_id,
  invited_email,
  role,
  status,
  assigned_by_user_id,
  assigned_at
)
select distinct on (workspace.organization_id, lower(invitation.email))
  workspace.organization_id,
  invitation.workspace_id,
  lower(invitation.email),
  invitation.role::text::public.organization_role,
  'invited',
  invitation.invited_by_user_id,
  invitation.created_at
from public.workspace_invitations invitation
join public.workspaces workspace on workspace.id = invitation.workspace_id
where invitation.accepted_at is null
  and invitation.expires_at > timezone('utc', now())
on conflict do nothing;
