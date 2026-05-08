select
  dataset,
  legacy_count,
  target_count,
  mismatch_count,
  null_unmapped_count,
  case
    when mismatch_count = 0 and null_unmapped_count = 0 then 'pass'
    else 'fail'
  end as status
from public.target_model_reconciliation_summary
where dataset in (
  'account_members',
  'document_participants',
  'document_participant_tokens',
  'account_invitations'
)
order by dataset;
