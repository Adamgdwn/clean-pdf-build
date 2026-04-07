alter table public.digital_signature_profiles
  add column if not exists signer_name text,
  add column if not exists signer_email text,
  add column if not exists organization_name text,
  add column if not exists signing_reason text;

update public.digital_signature_profiles
set
  signer_name = coalesce(nullif(signer_name, ''), label),
  signing_reason = coalesce(nullif(signing_reason, ''), 'approve')
where signer_name is null
   or signer_name = ''
   or signing_reason is null
   or signing_reason = '';

alter table public.digital_signature_profiles
  alter column signer_name set not null,
  alter column signer_name set default '',
  alter column signing_reason set default 'approve';
