-- Add signing token quota to billing plans
alter table billing_plans
  add column if not exists included_signing_tokens int4 not null default 10;
update billing_plans set included_signing_tokens = 25  where key = 'starter';
update billing_plans set included_signing_tokens = 100 where key = 'team';
update billing_plans set included_signing_tokens = 500 where key = 'business';
-- One-time signing token per external signer per send/remind
-- Allows external signers to complete their assigned fields without an EasyDraft account.
-- Token is valid until the document due date (or 7 days if none is set).
create table if not exists document_signing_tokens (
  id           uuid        primary key default gen_random_uuid(),
  document_id  uuid        not null references documents(id) on delete cascade,
  signer_id    uuid        not null references document_signers(id) on delete cascade,
  signer_email text        not null,
  token        text        not null unique,
  expires_at   timestamptz not null,
  voided_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists document_signing_tokens_token_idx    on document_signing_tokens(token);
create index if not exists document_signing_tokens_document_idx on document_signing_tokens(document_id);
create index if not exists document_signing_tokens_signer_idx   on document_signing_tokens(signer_id);
