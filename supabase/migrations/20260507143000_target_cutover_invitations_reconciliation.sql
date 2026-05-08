create table if not exists public.account_invitations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  email text not null,
  account_class public.account_class not null,
  invited_by_user_id uuid references auth.users(id) on delete set null,
  token text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists account_invitations_account_idx
  on public.account_invitations(account_id);

create index if not exists account_invitations_workspace_idx
  on public.account_invitations(workspace_id);

create index if not exists account_invitations_email_idx
  on public.account_invitations(lower(email));

create unique index if not exists account_invitations_pending_email_key
  on public.account_invitations(account_id, lower(email))
  where accepted_at is null;

create unique index if not exists document_participants_document_email_mode_key
  on public.document_participants(document_id, email, document_mode);

alter table public.account_invitations enable row level security;

drop policy if exists "account members can read account invitations" on public.account_invitations;
create policy "account members can read account invitations"
on public.account_invitations
for select
to authenticated
using (public.is_account_member(account_id));

-- TEMP_MIGRATION_BRIDGE
insert into public.account_invitations (
  id,
  account_id,
  workspace_id,
  email,
  account_class,
  invited_by_user_id,
  token,
  expires_at,
  accepted_at,
  created_at,
  updated_at
)
select
  invitation.id,
  workspace.organization_id,
  invitation.workspace_id,
  invitation.email,
  case
    when workspace.workspace_type = 'personal' or organization.account_type = 'individual' then 'personal'::public.account_class
    when invitation.role in ('account_admin', 'admin', 'billing_admin') then 'corporate_admin'::public.account_class
    else 'corporate_member'::public.account_class
  end,
  invitation.invited_by_user_id,
  invitation.token,
  invitation.expires_at,
  invitation.accepted_at,
  invitation.created_at,
  timezone('utc', now())
from public.workspace_invitations invitation
join public.workspaces workspace on workspace.id = invitation.workspace_id
join public.organizations organization on organization.id = workspace.organization_id
on conflict (token) do update
set
  account_id = excluded.account_id,
  workspace_id = excluded.workspace_id,
  email = excluded.email,
  account_class = excluded.account_class,
  invited_by_user_id = excluded.invited_by_user_id,
  expires_at = excluded.expires_at,
  accepted_at = excluded.accepted_at,
  updated_at = timezone('utc', now());

create or replace view public.target_model_reconciliation_summary as
with
legacy_account_members as (
  select organization_id as account_id, user_id
  from public.organization_memberships
),
target_account_members as (
  select account_id, user_id, account_class
  from public.account_members
),
legacy_document_participants as (
  select document_id, user_id::text as identity_key, 'access' as source_key
  from public.document_access
  union all
  select document_id, id::text as identity_key, 'signer' as source_key
  from public.document_signers
),
target_document_participants as (
  select
    document_id,
    coalesce(legacy_signer_id::text, user_id::text, lower(email)) as identity_key,
    case when legacy_signer_id is null then 'access' else 'signer' end as source_key
  from public.document_participants
),
legacy_tokens as (
  select id, token
  from public.document_signing_tokens
),
target_tokens as (
  select legacy_signing_token_id as id, token
  from public.document_participant_tokens
)
select
  'account_members'::text as dataset,
  (select count(*) from legacy_account_members)::bigint as legacy_count,
  (select count(*) from target_account_members)::bigint as target_count,
  (
    select count(*)
    from legacy_account_members legacy
    left join target_account_members target
      on target.account_id = legacy.account_id
      and target.user_id = legacy.user_id
    where target.user_id is null
  )::bigint as mismatch_count,
  (
    select count(*)
    from target_account_members
    where account_id is null or user_id is null or account_class is null
  )::bigint as null_unmapped_count
union all
select
  'document_participants'::text,
  (select count(*) from legacy_document_participants)::bigint,
  (select count(*) from target_document_participants)::bigint,
  (
    select count(*)
    from legacy_document_participants legacy
    left join target_document_participants target
      on target.document_id = legacy.document_id
      and target.identity_key = legacy.identity_key
      and target.source_key = legacy.source_key
    where target.identity_key is null
  )::bigint,
  (
    select count(*)
    from public.document_participants
    where document_id is null
      or document_mode is null
      or authority is null
      or (user_id is null and email is null)
  )::bigint
union all
select
  'document_participant_tokens'::text,
  (select count(*) from legacy_tokens)::bigint,
  (select count(*) from public.document_participant_tokens)::bigint,
  (
    select count(*)
    from legacy_tokens legacy
    left join target_tokens target
      on target.id = legacy.id
      or target.token = legacy.token
    where target.token is null
  )::bigint,
  (
    select count(*)
    from public.document_participant_tokens
    where participant_id is null or document_id is null or token is null
  )::bigint
union all
select
  'account_invitations'::text,
  (select count(*) from public.workspace_invitations)::bigint,
  (select count(*) from public.account_invitations)::bigint,
  (
    select count(*)
    from public.workspace_invitations legacy
    left join public.account_invitations target on target.token = legacy.token
    where target.token is null
  )::bigint,
  (
    select count(*)
    from public.account_invitations
    where account_id is null or email is null or account_class is null
  )::bigint;
