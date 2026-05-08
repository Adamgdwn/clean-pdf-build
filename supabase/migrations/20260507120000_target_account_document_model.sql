do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_class') then
    create type public.account_class as enum ('personal', 'corporate_admin', 'corporate_member');
  end if;

  if not exists (select 1 from pg_type where typname = 'document_mode') then
    create type public.document_mode as enum ('initiator', 'internal_signer', 'external_signer');
  end if;

  if not exists (select 1 from pg_type where typname = 'authority_level') then
    create type public.authority_level as enum ('viewer', 'signer', 'document_admin', 'org_admin_override');
  end if;
end $$;

create table if not exists public.account_members (
  account_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_class public.account_class not null,
  is_primary_admin boolean not null default false,
  source_membership_role text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (account_id, user_id)
);

create index if not exists account_members_user_idx on public.account_members(user_id);
create index if not exists account_members_workspace_idx on public.account_members(workspace_id);
create index if not exists account_members_class_idx on public.account_members(account_class);

create table if not exists public.document_participants (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text,
  display_name text,
  document_mode public.document_mode not null,
  authority public.authority_level not null,
  legacy_signer_id uuid references public.document_signers(id) on delete set null,
  source_access_role text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint document_participants_identity_check
    check (user_id is not null or email is not null)
);

create unique index if not exists document_participants_document_user_mode_key
  on public.document_participants(document_id, user_id, document_mode);

create unique index if not exists document_participants_legacy_signer_key
  on public.document_participants(legacy_signer_id)
  where legacy_signer_id is not null;

create index if not exists document_participants_document_idx
  on public.document_participants(document_id);

create index if not exists document_participants_user_idx
  on public.document_participants(user_id);

create index if not exists document_participants_authority_idx
  on public.document_participants(authority);

create table if not exists public.document_participant_tokens (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.document_participants(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  voided_at timestamptz,
  verification_code_hash text,
  verification_code_sent_at timestamptz,
  verification_code_expires_at timestamptz,
  verification_attempt_count integer not null default 0,
  verified_at timestamptz,
  last_viewed_at timestamptz,
  last_completed_at timestamptz,
  void_reason text,
  legacy_signing_token_id uuid references public.document_signing_tokens(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists document_participant_tokens_participant_idx
  on public.document_participant_tokens(participant_id);

create index if not exists document_participant_tokens_document_idx
  on public.document_participant_tokens(document_id);

create index if not exists document_participant_tokens_token_idx
  on public.document_participant_tokens(token);

create or replace function public.is_account_member(target_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.account_members member
    where member.account_id = target_account_id
      and member.user_id = auth.uid()
  );
$$;

create or replace function public.document_authority(target_document_id uuid)
returns public.authority_level
language sql
stable
security definer
set search_path = public
as $$
  select participant.authority
  from public.document_participants participant
  where participant.document_id = target_document_id
    and participant.user_id = auth.uid()
  order by case participant.authority
    when 'org_admin_override' then 4
    when 'document_admin' then 3
    when 'signer' then 2
    else 1
  end desc
  limit 1;
$$;

alter table public.account_members enable row level security;
alter table public.document_participants enable row level security;
alter table public.document_participant_tokens enable row level security;

drop policy if exists "account members can read account members" on public.account_members;
create policy "account members can read account members"
on public.account_members
for select
to authenticated
using (public.is_account_member(account_id));

drop policy if exists "document participants can read participants" on public.document_participants;
create policy "document participants can read participants"
on public.document_participants
for select
to authenticated
using (public.document_authority(document_id) is not null);

-- TEMP_MIGRATION_BRIDGE
insert into public.account_members (
  account_id,
  workspace_id,
  user_id,
  account_class,
  is_primary_admin,
  source_membership_role,
  created_at,
  updated_at
)
select
  organization.id,
  workspace.id,
  membership.user_id,
  case
    when organization.account_type = 'individual' then 'personal'::public.account_class
    when membership.role in ('account_admin', 'admin', 'billing_admin') then 'corporate_admin'::public.account_class
    else 'corporate_member'::public.account_class
  end,
  membership.user_id = organization.owner_user_id,
  membership.role::text,
  membership.created_at,
  timezone('utc', now())
from public.organization_memberships membership
join public.organizations organization on organization.id = membership.organization_id
left join public.workspaces workspace on workspace.organization_id = organization.id
on conflict (account_id, user_id) do update
set
  workspace_id = coalesce(excluded.workspace_id, public.account_members.workspace_id),
  account_class = excluded.account_class,
  is_primary_admin = excluded.is_primary_admin,
  source_membership_role = excluded.source_membership_role,
  updated_at = timezone('utc', now());

-- TEMP_MIGRATION_BRIDGE
insert into public.account_members (
  account_id,
  workspace_id,
  user_id,
  account_class,
  is_primary_admin,
  source_membership_role,
  created_at,
  updated_at
)
select
  organization.id,
  workspace.id,
  membership.user_id,
  case
    when workspace.workspace_type = 'personal' or organization.account_type = 'individual' then 'personal'::public.account_class
    when membership.role in ('account_admin', 'admin', 'billing_admin') then 'corporate_admin'::public.account_class
    else 'corporate_member'::public.account_class
  end,
  membership.user_id = coalesce(organization.owner_user_id, workspace.owner_user_id),
  membership.role::text,
  membership.created_at,
  timezone('utc', now())
from public.workspace_memberships membership
join public.workspaces workspace on workspace.id = membership.workspace_id
join public.organizations organization on organization.id = workspace.organization_id
on conflict (account_id, user_id) do nothing;

-- TEMP_MIGRATION_BRIDGE
insert into public.document_participants (
  document_id,
  user_id,
  email,
  display_name,
  document_mode,
  authority,
  source_access_role,
  created_at,
  updated_at
)
select
  document.id,
  document.uploaded_by_user_id,
  null,
  null,
  'initiator'::public.document_mode,
  'document_admin'::public.authority_level,
  'document_admin',
  document.created_at,
  timezone('utc', now())
from public.documents document
on conflict (document_id, user_id, document_mode) do nothing;

-- TEMP_MIGRATION_BRIDGE
insert into public.document_participants (
  document_id,
  user_id,
  email,
  display_name,
  document_mode,
  authority,
  source_access_role,
  created_at,
  updated_at
)
select
  access_entry.document_id,
  access_entry.user_id,
  null,
  null,
  'initiator'::public.document_mode,
  case
    when access_entry.role = 'viewer' then 'viewer'::public.authority_level
    when access_entry.role = 'signer' then 'signer'::public.authority_level
    else 'document_admin'::public.authority_level
  end,
  access_entry.role::text,
  access_entry.created_at,
  timezone('utc', now())
from public.document_access access_entry
on conflict (document_id, user_id, document_mode) do update
set
  authority = excluded.authority,
  source_access_role = excluded.source_access_role,
  updated_at = timezone('utc', now());

-- TEMP_MIGRATION_BRIDGE
insert into public.document_participants (
  document_id,
  user_id,
  email,
  display_name,
  document_mode,
  authority,
  legacy_signer_id,
  source_access_role,
  created_at,
  updated_at
)
select
  signer.document_id,
  signer.user_id,
  signer.email,
  signer.name,
  case
    when signer.participant_type = 'internal' then 'internal_signer'::public.document_mode
    else 'external_signer'::public.document_mode
  end,
  'signer'::public.authority_level,
  signer.id,
  'signer',
  signer.created_at,
  timezone('utc', now())
from public.document_signers signer
on conflict (legacy_signer_id) where legacy_signer_id is not null do update
set
  user_id = excluded.user_id,
  email = excluded.email,
  display_name = excluded.display_name,
  document_mode = excluded.document_mode,
  authority = excluded.authority,
  updated_at = timezone('utc', now());

-- TEMP_MIGRATION_BRIDGE
insert into public.document_participant_tokens (
  participant_id,
  document_id,
  token,
  expires_at,
  voided_at,
  verification_code_hash,
  verification_code_sent_at,
  verification_code_expires_at,
  verification_attempt_count,
  verified_at,
  last_viewed_at,
  last_completed_at,
  void_reason,
  legacy_signing_token_id,
  created_at
)
select
  participant.id,
  token.document_id,
  token.token,
  token.expires_at,
  token.voided_at,
  token.verification_code_hash,
  token.verification_code_sent_at,
  token.verification_code_expires_at,
  token.verification_attempt_count,
  token.verified_at,
  token.last_viewed_at,
  token.last_completed_at,
  token.void_reason,
  token.id,
  token.created_at
from public.document_signing_tokens token
join public.document_participants participant on participant.legacy_signer_id = token.signer_id
on conflict (token) do nothing;
