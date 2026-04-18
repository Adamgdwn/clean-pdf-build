alter table public.document_signing_tokens
  add column if not exists verification_code_hash text,
  add column if not exists verification_code_sent_at timestamptz,
  add column if not exists verification_code_expires_at timestamptz,
  add column if not exists verification_attempt_count int4 not null default 0,
  add column if not exists verified_at timestamptz,
  add column if not exists last_viewed_at timestamptz,
  add column if not exists last_completed_at timestamptz,
  add column if not exists void_reason text;

create index if not exists document_signing_tokens_verified_idx
  on public.document_signing_tokens(document_id, signer_id, verified_at);

alter table public.stripe_processed_events
  add column if not exists stripe_object_id text;

create unique index if not exists stripe_processed_events_object_dedupe_idx
  on public.stripe_processed_events(event_type, stripe_object_id, workspace_id)
  where stripe_object_id is not null;
