# Target Account and Document Model Rollout

This note is the staging and production path for the target account/document model. It assumes the May 7 target-model migrations are already applied and must not be rewritten in place. Production hardening is delivered by a later superseding migration.

## Canonical Model

### Account classes

| Account class | Meaning | Canonical table |
|---|---|---|
| `personal` | One user operating their own account and workspace | `account_members.account_class` |
| `corporate_admin` | Corporate account administrator with account, member, billing, and lifecycle authority | `account_members.account_class` |
| `corporate_member` | Corporate account member without account-owner authority | `account_members.account_class` |

### Document modes

| Document mode | Meaning | Canonical table |
|---|---|---|
| `initiator` | User who owns or administers document setup | `document_participants.document_mode` |
| `internal_signer` | Authenticated EasyDraft signer | `document_participants.document_mode` |
| `external_signer` | Token-based guest signer, no account required | `document_participants.document_mode` |

### Authority levels

| Authority | Meaning | Canonical table |
|---|---|---|
| `viewer` | Can view when granted document access | `document_participants.authority` |
| `signer` | Can complete assigned signer actions | `document_participants.authority` |
| `document_admin` | Can administer document setup and workflow | `document_participants.authority` |
| `org_admin_override` | Corporate admin override for organization-scoped documents | `document_participants.authority` |

## Canonical Tables

- `account_members`: primary account membership source.
- `account_invitations`: primary team/account invitation source.
- `document_participants`: primary document identity, document mode, and authority source.
- `document_participant_tokens`: primary signing-link and email-verification token source.
- `document_fields.assignee_participant_id`: primary field assignment foreign key.

Legacy tables are still present only where the previous schema owns data that has not yet moved to a target table. Do not add new feature logic that treats those tables as primary.

## Hardening Migration

Apply `supabase/migrations/20260508120000_target_model_hardening.sql` after the May 7 migrations. It:

- deduplicates `account_members` from the union of `organization_memberships` and `workspace_memberships`
- deduplicates pending `account_invitations` by account and lowercased email
- enforces case-insensitive uniqueness for document participant email per document and mode
- enforces same-document field assignment with a composite foreign key
- refreshes `target_model_reconciliation_summary` so validation checks the real legacy sources
- adds indexes needed by the dedupe and reconciliation joins

## Staging Verification Queries

Run these in the Supabase SQL editor after the hardening migration is applied.

```sql
select *
from public.target_model_reconciliation_summary
order by dataset;
```

Expected: every `mismatch_count` and `null_or_unmapped_count` is `0`, except `field_participant_assignments.legacy_count` may be non-zero until the final signer-field bridge is retired.

```sql
select document_id, lower(email) as normalized_email, document_mode, count(*)
from public.document_participants
where email is not null
group by document_id, lower(email), document_mode
having count(*) > 1;
```

Expected: zero rows.

```sql
select field.id, field.document_id, field.assignee_participant_id, participant.document_id as participant_document_id
from public.document_fields field
join public.document_participants participant on participant.id = field.assignee_participant_id
where participant.document_id <> field.document_id;
```

Expected: zero rows.

```sql
select account_id, lower(email) as normalized_email, count(*)
from public.account_invitations
where accepted_at is null
group by account_id, lower(email)
having count(*) > 1;
```

Expected: zero rows.

```sql
select count(*) as signer_only_field_count
from public.document_fields
where assignee_participant_id is null
  and assignee_signer_id is not null;
```

Expected: zero for a clean cutover. Any non-zero result means the signer-to-participant bridge is still doing live work.

```sql
select token.id, token.document_id, token.participant_id
from public.document_participant_tokens token
left join public.document_participants participant on participant.id = token.participant_id
where participant.id is null
   or participant.document_id <> token.document_id;
```

Expected: zero rows.

## Staging Preflight

- Confirm the hardening migration is next in the migration list and has not been edited after review.
- Take a staging database backup before applying it.
- Apply migrations to staging before deploying the app build that expects the hardened constraints.
- Run the verification queries above and record the results.
- Run `npm run typecheck`, `npm test`, and `npm run build` against the same commit.

## Staging Test Plan

- Sign up a personal account and confirm `account_members.account_class = 'personal'`.
- Sign up a corporate admin and confirm `account_members.account_class = 'corporate_admin'`.
- Invite a corporate member, accept with the invited email, and confirm only `account_members` and `account_invitations` are the primary writes.
- Create a document with an internal signer and an external signer.
- Assign fields to both signers and confirm `document_fields.assignee_participant_id` is populated.
- Send the workflow and confirm `document_participant_tokens` stores the active signing link.
- Complete internal and external signing, including email-code verification for the external signer.
- Re-run the reconciliation view after completion.

## Production Preflight

- Production backup exists and restore access is confirmed.
- Staging has passed the same migration and smoke plan with zero unexpected reconciliation mismatches.
- Vercel environment variables are current and no local `.env` values are needed for production.
- Stripe webhooks are healthy before the app deploy.
- Confirm that no manual SQL cleanup has been applied in staging without being represented by a migration.

## Rollback Notes

Database rollback should be forward-only. If the hardening migration exposes bad data, create a corrective migration rather than editing an applied migration. For app rollback, redeploy the previous Vercel deployment only after confirming it can run against the hardened schema. Do not drop legacy tables until the final cleanup pass has removed the signer-routing bridge.

## Final Cleanup Prerequisites

- `document_signers` routing fields have a target-model home, or the workflow engine no longer needs `required`, `routing_stage`, and `signing_order`.
- `document_fields.assignee_participant_id` is populated for all active assigned fields.
- `document_participant_tokens` has no core lookup dependency on `legacy_signer_id`.
- `target_model_reconciliation_summary` shows no mismatches.
- No `TEMP_MIGRATION_BRIDGE` references remain in runtime code.
