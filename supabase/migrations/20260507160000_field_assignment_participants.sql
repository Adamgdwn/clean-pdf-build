alter table public.document_fields
  add column if not exists assignee_participant_id uuid;

alter table public.document_fields
  drop constraint if exists document_fields_assignee_participant_id_fkey;

alter table public.document_fields
  add constraint document_fields_assignee_participant_id_fkey
  foreign key (assignee_participant_id)
  references public.document_participants(id)
  on delete set null;

create index if not exists document_fields_assignee_participant_id_idx
  on public.document_fields(assignee_participant_id);

-- Backfill legacy signer assignments into participant assignments before runtime cutover.
update public.document_fields field
set assignee_participant_id = participant.id
from public.document_participants participant
where field.assignee_participant_id is null
  and field.assignee_signer_id is not null
  and participant.legacy_signer_id = field.assignee_signer_id
  and participant.document_id = field.document_id;
