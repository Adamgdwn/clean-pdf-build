do $$
begin
  if not exists (select 1 from pg_type where typname = 'participant_type') then
    create type public.participant_type as enum ('internal', 'external');
  end if;

  if not exists (select 1 from pg_type where typname = 'lock_policy') then
    create type public.lock_policy as enum (
      'owner_only',
      'owner_and_editors',
      'owner_editors_and_active_signer'
    );
  end if;
end $$;

do $$
begin
  alter type public.field_kind add value if not exists 'approval';
exception
  when duplicate_object then null;
end $$;

alter table public.documents
  add column if not exists lock_policy public.lock_policy not null default 'owner_only';

alter table public.document_signers
  add column if not exists participant_type public.participant_type not null default 'external',
  add column if not exists routing_stage integer not null default 1;

update public.document_signers signer
set participant_type = case
  when document.delivery_mode = 'internal_use_only' then 'internal'::public.participant_type
  else 'external'::public.participant_type
end
from public.documents document
where signer.document_id = document.id
  and signer.participant_type = 'external';

alter table public.document_signers
  drop constraint if exists document_signers_routing_stage_check;

alter table public.document_signers
  add constraint document_signers_routing_stage_check
  check (routing_stage > 0);
