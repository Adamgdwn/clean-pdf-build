alter table public.signature_identities
  add column if not exists consent_version text not null default 'signature_identity_v1',
  add column if not exists consent_accepted_at timestamptz not null default timezone('utc', now()),
  add column if not exists evidence_retention_policy text not null default 'retain_identity_record_after_delete',
  add column if not exists deleted_at timestamptz,
  add column if not exists delete_verified_at timestamptz,
  add column if not exists delete_confirmed_email text,
  add column if not exists delete_confirmed_label text;

drop index if exists public.signature_identities_user_email_assurance_key;

create unique index if not exists signature_identities_user_email_assurance_active_key
  on public.signature_identities(user_id, lower(signer_email), assurance_level)
  where deleted_at is null;

create index if not exists signature_identities_deleted_idx
  on public.signature_identities(user_id, deleted_at)
  where deleted_at is not null;

drop policy if exists "users can delete their signature identities" on public.signature_identities;
