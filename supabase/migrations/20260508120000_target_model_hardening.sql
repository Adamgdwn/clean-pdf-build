-- Harden target account/document model after the initial cutover migrations.
-- This migration is intentionally additive/superseding because the May 7
-- migrations have already been applied to remote environments.

create index if not exists organization_memberships_org_user_idx
  on public.organization_memberships(organization_id, user_id);

create index if not exists workspace_memberships_workspace_user_idx
  on public.workspace_memberships(workspace_id, user_id);

create index if not exists workspace_invitations_workspace_lower_email_idx
  on public.workspace_invitations(workspace_id, lower(email));

create index if not exists document_participants_document_lower_email_mode_idx
  on public.document_participants(document_id, lower(email), document_mode)
  where email is not null;

with organization_source as (
  select
    organization.id as account_id,
    workspace.id as workspace_id,
    membership.user_id,
    case
      when organization.account_type = 'individual' then 'personal'::public.account_class
      when membership.role in ('account_admin', 'admin', 'billing_admin') then 'corporate_admin'::public.account_class
      else 'corporate_member'::public.account_class
    end as account_class,
    membership.user_id = organization.owner_user_id as is_primary_admin,
    membership.role::text as source_membership_role,
    membership.created_at,
    1 as source_priority
  from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id
  left join lateral (
    select workspace.id
    from public.workspaces workspace
    where workspace.organization_id = organization.id
    order by
      (workspace.owner_user_id = membership.user_id) desc,
      workspace.created_at asc,
      workspace.id asc
    limit 1
  ) workspace on true
),
workspace_source as (
  select
    organization.id as account_id,
    workspace.id as workspace_id,
    membership.user_id,
    case
      when workspace.workspace_type = 'personal' or organization.account_type = 'individual' then 'personal'::public.account_class
      when membership.role in ('account_admin', 'admin', 'billing_admin') then 'corporate_admin'::public.account_class
      else 'corporate_member'::public.account_class
    end as account_class,
    membership.user_id = coalesce(organization.owner_user_id, workspace.owner_user_id) as is_primary_admin,
    membership.role::text as source_membership_role,
    membership.created_at,
    2 as source_priority
  from public.workspace_memberships membership
  join public.workspaces workspace on workspace.id = membership.workspace_id
  join public.organizations organization on organization.id = workspace.organization_id
),
ranked_source as (
  select
    *,
    row_number() over (
      partition by account_id, user_id
      order by
        is_primary_admin desc,
        case account_class
          when 'corporate_admin' then 1
          when 'personal' then 2
          else 3
        end,
        source_priority asc,
        created_at asc,
        workspace_id asc nulls last
    ) as row_rank
  from (
    select * from organization_source
    union all
    select * from workspace_source
  ) source
)
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
  account_id,
  workspace_id,
  user_id,
  account_class,
  is_primary_admin,
  source_membership_role,
  created_at,
  timezone('utc', now())
from ranked_source
where row_rank = 1
on conflict (account_id, user_id) do update
set
  workspace_id = coalesce(excluded.workspace_id, public.account_members.workspace_id),
  account_class = excluded.account_class,
  is_primary_admin = excluded.is_primary_admin,
  source_membership_role = excluded.source_membership_role,
  updated_at = timezone('utc', now());

with ranked_legacy_invitations as (
  select
    invitation.id,
    workspace.organization_id as account_id,
    invitation.workspace_id,
    lower(invitation.email) as normalized_email,
    invitation.email,
    case
      when workspace.workspace_type = 'personal' or organization.account_type = 'individual' then 'personal'::public.account_class
      when invitation.role in ('account_admin', 'admin', 'billing_admin') then 'corporate_admin'::public.account_class
      else 'corporate_member'::public.account_class
    end as account_class,
    invitation.invited_by_user_id,
    invitation.token,
    invitation.expires_at,
    invitation.accepted_at,
    invitation.created_at,
    row_number() over (
      partition by workspace.organization_id, lower(invitation.email)
      order by
        (invitation.accepted_at is null) desc,
        invitation.created_at desc,
        invitation.expires_at desc,
        invitation.id desc
    ) as row_rank
  from public.workspace_invitations invitation
  join public.workspaces workspace on workspace.id = invitation.workspace_id
  join public.organizations organization on organization.id = workspace.organization_id
),
winning_invitations as (
  select *
  from ranked_legacy_invitations
  where row_rank = 1
)
update public.account_invitations invitation
set
  accepted_at = coalesce(invitation.accepted_at, timezone('utc', now())),
  updated_at = timezone('utc', now())
from winning_invitations winner
where invitation.account_id = winner.account_id
  and lower(invitation.email) = winner.normalized_email
  and invitation.accepted_at is null
  and invitation.token <> winner.token;

with ranked_legacy_invitations as (
  select
    invitation.id,
    workspace.organization_id as account_id,
    invitation.workspace_id,
    invitation.email,
    case
      when workspace.workspace_type = 'personal' or organization.account_type = 'individual' then 'personal'::public.account_class
      when invitation.role in ('account_admin', 'admin', 'billing_admin') then 'corporate_admin'::public.account_class
      else 'corporate_member'::public.account_class
    end as account_class,
    invitation.invited_by_user_id,
    invitation.token,
    invitation.expires_at,
    invitation.accepted_at,
    invitation.created_at,
    row_number() over (
      partition by workspace.organization_id, lower(invitation.email)
      order by
        (invitation.accepted_at is null) desc,
        invitation.created_at desc,
        invitation.expires_at desc,
        invitation.id desc
    ) as row_rank
  from public.workspace_invitations invitation
  join public.workspaces workspace on workspace.id = invitation.workspace_id
  join public.organizations organization on organization.id = workspace.organization_id
)
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
  id,
  account_id,
  workspace_id,
  lower(email),
  account_class,
  invited_by_user_id,
  token,
  expires_at,
  accepted_at,
  created_at,
  timezone('utc', now())
from ranked_legacy_invitations
where row_rank = 1
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

with ranked_participants as (
  select
    id,
    first_value(id) over (
      partition by document_id, lower(email), document_mode
      order by
        (legacy_signer_id is not null) desc,
        (user_id is not null) desc,
        case authority
          when 'org_admin_override' then 4
          when 'document_admin' then 3
          when 'signer' then 2
          else 1
        end desc,
        created_at asc,
        id asc
    ) as winner_id,
    row_number() over (
      partition by document_id, lower(email), document_mode
      order by
        (legacy_signer_id is not null) desc,
        (user_id is not null) desc,
        case authority
          when 'org_admin_override' then 4
          when 'document_admin' then 3
          when 'signer' then 2
          else 1
        end desc,
        created_at asc,
        id asc
    ) as row_rank
  from public.document_participants
  where email is not null
),
participant_merge as (
  select id as loser_id, winner_id
  from ranked_participants
  where row_rank > 1
)
update public.document_participant_tokens token
set participant_id = participant_merge.winner_id
from participant_merge
where token.participant_id = participant_merge.loser_id;

with ranked_participants as (
  select
    id,
    first_value(id) over (
      partition by document_id, lower(email), document_mode
      order by
        (legacy_signer_id is not null) desc,
        (user_id is not null) desc,
        case authority
          when 'org_admin_override' then 4
          when 'document_admin' then 3
          when 'signer' then 2
          else 1
        end desc,
        created_at asc,
        id asc
    ) as winner_id,
    row_number() over (
      partition by document_id, lower(email), document_mode
      order by
        (legacy_signer_id is not null) desc,
        (user_id is not null) desc,
        case authority
          when 'org_admin_override' then 4
          when 'document_admin' then 3
          when 'signer' then 2
          else 1
        end desc,
        created_at asc,
        id asc
    ) as row_rank
  from public.document_participants
  where email is not null
),
participant_merge as (
  select id as loser_id, winner_id
  from ranked_participants
  where row_rank > 1
)
update public.document_fields field
set assignee_participant_id = participant_merge.winner_id
from participant_merge
where field.assignee_participant_id = participant_merge.loser_id;

with ranked_participants as (
  select
    id,
    row_number() over (
      partition by document_id, lower(email), document_mode
      order by
        (legacy_signer_id is not null) desc,
        (user_id is not null) desc,
        case authority
          when 'org_admin_override' then 4
          when 'document_admin' then 3
          when 'signer' then 2
          else 1
        end desc,
        created_at asc,
        id asc
    ) as row_rank
  from public.document_participants
  where email is not null
)
delete from public.document_participants participant
using ranked_participants ranked
where participant.id = ranked.id
  and ranked.row_rank > 1;

drop index if exists public.document_participants_document_email_mode_key;

create unique index if not exists document_participants_document_lower_email_mode_key
  on public.document_participants(document_id, lower(email), document_mode)
  where email is not null;

alter table public.document_participants
  drop constraint if exists document_participants_document_id_id_key;

alter table public.document_participants
  add constraint document_participants_document_id_id_key
  unique (document_id, id);

update public.document_fields field
set assignee_participant_id = null
where assignee_participant_id is not null
  and not exists (
    select 1
    from public.document_participants participant
    where participant.id = field.assignee_participant_id
      and participant.document_id = field.document_id
  );

alter table public.document_fields
  drop constraint if exists document_fields_assignee_participant_id_fkey;

alter table public.document_fields
  drop constraint if exists document_fields_document_assignee_participant_fkey;

alter table public.document_fields
  add constraint document_fields_document_assignee_participant_fkey
  foreign key (document_id, assignee_participant_id)
  references public.document_participants(document_id, id)
  on delete set null (assignee_participant_id);

create or replace view public.target_model_reconciliation_summary as
with
legacy_account_members as (
  select organization_id as account_id, user_id
  from public.organization_memberships
  union
  select workspace.organization_id as account_id, membership.user_id
  from public.workspace_memberships membership
  join public.workspaces workspace on workspace.id = membership.workspace_id
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
  )::bigint
union all
select
  'field_participant_assignments'::text,
  (
    select count(*)
    from public.document_fields
    where assignee_signer_id is not null
  )::bigint,
  (
    select count(*)
    from public.document_fields
    where assignee_participant_id is not null
  )::bigint,
  (
    select count(*)
    from public.document_fields field
    where field.assignee_signer_id is not null
      and field.assignee_participant_id is null
  )::bigint,
  (
    select count(*)
    from public.document_fields field
    join public.document_participants participant on participant.id = field.assignee_participant_id
    where participant.document_id <> field.document_id
  )::bigint;
