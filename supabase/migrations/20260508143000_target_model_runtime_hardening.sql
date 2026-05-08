alter table public.document_participants
  add column if not exists signing_required boolean,
  add column if not exists routing_stage integer,
  add column if not exists signing_order integer;

alter table public.document_participants
  drop constraint if exists document_participants_routing_stage_check;

alter table public.document_participants
  add constraint document_participants_routing_stage_check
  check (routing_stage is null or routing_stage > 0);

update public.document_participants participant
set
  signing_required = signer.required,
  routing_stage = signer.routing_stage,
  signing_order = signer.signing_order,
  updated_at = timezone('utc', now())
from public.document_signers signer
where participant.legacy_signer_id = signer.id
  and (
    participant.signing_required is distinct from signer.required
    or participant.routing_stage is distinct from signer.routing_stage
    or participant.signing_order is distinct from signer.signing_order
  );

create index if not exists document_participants_document_routing_idx
  on public.document_participants(document_id, routing_stage, signing_order)
  where authority = 'signer';

create or replace function public.create_document_signer_participant(
  p_document_id uuid,
  p_name text,
  p_email text,
  p_document_mode public.document_mode,
  p_required boolean,
  p_routing_stage integer,
  p_signing_order integer
)
returns table(signer_id uuid, participant_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signer_id uuid;
  v_participant_id uuid;
  v_participant_type public.participant_type;
begin
  if p_document_id is null or p_name is null or trim(p_name) = '' or p_email is null or trim(p_email) = '' then
    raise exception 'Document, signer name, and signer email are required.';
  end if;

  if coalesce(p_routing_stage, 0) <= 0 then
    raise exception 'Routing stage must be greater than zero.';
  end if;

  v_participant_type := case
    when p_document_mode = 'external_signer' then 'external'::public.participant_type
    else 'internal'::public.participant_type
  end;

  insert into public.document_signers (
    document_id,
    name,
    email,
    participant_type,
    required,
    routing_stage,
    signing_order
  )
  values (
    p_document_id,
    p_name,
    lower(trim(p_email)),
    v_participant_type,
    coalesce(p_required, true),
    p_routing_stage,
    p_signing_order
  )
  returning id into v_signer_id;

  insert into public.document_participants (
    document_id,
    email,
    display_name,
    document_mode,
    authority,
    legacy_signer_id,
    source_access_role,
    signing_required,
    routing_stage,
    signing_order
  )
  values (
    p_document_id,
    lower(trim(p_email)),
    p_name,
    p_document_mode,
    'signer'::public.authority_level,
    v_signer_id,
    'signer',
    coalesce(p_required, true),
    p_routing_stage,
    p_signing_order
  )
  returning id into v_participant_id;

  signer_id := v_signer_id;
  participant_id := v_participant_id;
  return next;
end;
$$;

create or replace function public.reassign_document_signer_participant(
  p_signer_id uuid,
  p_name text,
  p_email text,
  p_document_mode public.document_mode
)
returns table(signer_id uuid, participant_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document_id uuid;
  v_document_mode public.document_mode;
  v_participant_type public.participant_type;
  v_participant_id uuid;
begin
  if p_signer_id is null or p_name is null or trim(p_name) = '' or p_email is null or trim(p_email) = '' then
    raise exception 'Signer, signer name, and signer email are required.';
  end if;

  select signer.document_id
    into v_document_id
  from public.document_signers signer
  where signer.id = p_signer_id
  for update;

  if v_document_id is null then
    raise exception 'Signer not found.';
  end if;

  select coalesce(p_document_mode, participant.document_mode, 'external_signer'::public.document_mode)
    into v_document_mode
  from public.document_participants participant
  where participant.legacy_signer_id = p_signer_id
  limit 1;

  v_participant_type := case
    when v_document_mode = 'external_signer' then 'external'::public.participant_type
    else 'internal'::public.participant_type
  end;

  update public.document_signers
  set
    name = p_name,
    email = lower(trim(p_email)),
    user_id = null,
    participant_type = v_participant_type
  where id = p_signer_id;

  update public.document_participants
  set
    user_id = null,
    email = lower(trim(p_email)),
    display_name = p_name,
    document_mode = v_document_mode,
    authority = 'signer'::public.authority_level,
    source_access_role = 'signer',
    updated_at = timezone('utc', now())
  where legacy_signer_id = p_signer_id
  returning id into v_participant_id;

  if v_participant_id is null then
    insert into public.document_participants (
      document_id,
      email,
      display_name,
      document_mode,
      authority,
      legacy_signer_id,
      source_access_role,
      signing_required,
      routing_stage,
      signing_order
    )
    select
      signer.document_id,
      lower(trim(p_email)),
      p_name,
      v_document_mode,
      'signer'::public.authority_level,
      signer.id,
      'signer',
      signer.required,
      signer.routing_stage,
      signer.signing_order
    from public.document_signers signer
    where signer.id = p_signer_id
    returning id into v_participant_id;
  end if;

  signer_id := p_signer_id;
  participant_id := v_participant_id;
  return next;
end;
$$;

create or replace function public.accept_account_invitation(
  p_invitation_id uuid,
  p_user_id uuid
)
returns table(workspace_id uuid, account_class public.account_class, accepted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.account_invitations%rowtype;
  v_workspace public.workspaces%rowtype;
  v_accepted_at timestamptz;
begin
  select *
    into v_invitation
  from public.account_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'Invitation not found.';
  end if;

  if v_invitation.expires_at < timezone('utc', now()) then
    raise exception 'Invitation has expired.';
  end if;

  if v_invitation.workspace_id is null then
    raise exception 'Invitation is not attached to a workspace.';
  end if;

  select *
    into v_workspace
  from public.workspaces
  where id = v_invitation.workspace_id
  for update;

  if not found then
    raise exception 'Workspace not found.';
  end if;

  insert into public.account_members (
    account_id,
    workspace_id,
    user_id,
    account_class,
    is_primary_admin
  )
  values (
    v_invitation.account_id,
    v_invitation.workspace_id,
    p_user_id,
    v_invitation.account_class,
    v_workspace.owner_user_id = p_user_id
  )
  on conflict (account_id, user_id)
  do update set
    workspace_id = coalesce(excluded.workspace_id, public.account_members.workspace_id),
    account_class = excluded.account_class,
    is_primary_admin = public.account_members.is_primary_admin or excluded.is_primary_admin,
    updated_at = timezone('utc', now());

  update public.account_invitations
  set accepted_at = coalesce(accepted_at, timezone('utc', now()))
  where id = v_invitation.id
  returning public.account_invitations.accepted_at into v_accepted_at;

  workspace_id := v_invitation.workspace_id;
  account_class := v_invitation.account_class;
  accepted_at := v_accepted_at;
  return next;
end;
$$;
