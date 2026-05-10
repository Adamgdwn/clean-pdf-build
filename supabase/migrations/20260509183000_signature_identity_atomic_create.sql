create or replace function public.create_signature_identity(
  p_user_id uuid,
  p_label text,
  p_title_text text,
  p_signer_name text,
  p_signer_email text,
  p_organization_name text,
  p_assurance_level public.signature_assurance_level,
  p_signature_type public.signature_appearance_type,
  p_typed_text text,
  p_storage_path text,
  p_provider public.signature_identity_provider,
  p_status public.signature_identity_status,
  p_signing_reason text,
  p_is_default boolean,
  p_consent_version text,
  p_consent_accepted_at timestamptz,
  p_evidence_retention_policy text
)
returns public.signature_identities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity public.signature_identities;
begin
  if p_user_id is null then
    raise exception 'User is required.';
  end if;

  if p_is_default then
    update public.signature_identities
       set is_default = false
     where user_id = p_user_id
       and deleted_at is null
       and is_default = true;
  end if;

  insert into public.signature_identities (
    user_id,
    label,
    title_text,
    signer_name,
    signer_email,
    organization_name,
    assurance_level,
    signature_type,
    typed_text,
    storage_path,
    provider,
    status,
    signing_reason,
    is_default,
    consent_version,
    consent_accepted_at,
    evidence_retention_policy
  )
  values (
    p_user_id,
    p_label,
    p_title_text,
    p_signer_name,
    p_signer_email,
    p_organization_name,
    p_assurance_level,
    p_signature_type,
    p_typed_text,
    p_storage_path,
    p_provider,
    p_status,
    p_signing_reason,
    coalesce(p_is_default, false),
    p_consent_version,
    p_consent_accepted_at,
    p_evidence_retention_policy
  )
  returning * into v_identity;

  return v_identity;
end;
$$;

revoke all on function public.create_signature_identity(
  uuid,
  text,
  text,
  text,
  text,
  text,
  public.signature_assurance_level,
  public.signature_appearance_type,
  text,
  text,
  public.signature_identity_provider,
  public.signature_identity_status,
  text,
  boolean,
  text,
  timestamptz,
  text
) from public;

grant execute on function public.create_signature_identity(
  uuid,
  text,
  text,
  text,
  text,
  text,
  public.signature_assurance_level,
  public.signature_appearance_type,
  text,
  text,
  public.signature_identity_provider,
  public.signature_identity_status,
  text,
  boolean,
  text,
  timestamptz,
  text
) to service_role;
