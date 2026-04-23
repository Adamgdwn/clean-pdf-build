# Operator Runbook

## Purpose

Use this runbook during private beta and paid-pilot operations to keep trust-sensitive issues visible, triaged, and closed without introducing heavyweight support tooling.

## Daily checks

1. Review the admin queue metrics:
   - queued notifications
   - failed notifications
   - queued or running processing jobs
   - oldest pending notification timestamp
   - oldest queued processing job timestamp
2. Review temporary-storage posture:
   - documents scheduled for purge soon
   - any retained documents that should no longer stay in EasyDraft
   - any unexpected growth in document storage
3. Review the admin feedback queue:
   - new reports
   - high-priority items
   - anything unassigned
   - anything closed without a resolution note
4. Review PDF-signature health:
   - any Path 1 signing failures
   - any missing signed PDFs in `documents-signed`
   - any Documenso webhook delivery gaps
   - whether `signature_events` entries are appearing for newly signed documents
5. If a deploy occurred, run:

```bash
npm run smoke:public-routes -- https://easydraftdocs.app
```

Direct public links to `/pricing`, `/privacy`, `/terms`, and `/security` must return `200`.

## Queue response rules

- If `failedNotifications > 0`, review the most recent failures first and confirm the email provider configuration is still valid.
- If the oldest queued notification or processing job is older than 15 minutes in production, treat it as an operator issue rather than waiting for user reports.
- If a signed document is marked `signed` but no object exists in `documents-signed`, treat it as a production incident and verify the signature path and provider logs immediately.
- If Documenso webhooks stop arriving, first confirm the webhook secret, Documenso endpoint configuration, and Vercel function logs for `/api/documenso-webhook`.
- If the processor is deployed separately, verify the worker runtime and shared `EASYDRAFT_PROCESSOR_SECRET` first.
- If needed, run the local/manual queue commands while investigating:
- If retention cleanup needs to run manually, trigger:

```bash
npm run processor:run-queued
npm run processor:run-notifications
npm run processor:run-purges
```

## Feedback triage loop

Use the admin feedback queue as the minimum viable operating loop.

Status meanings:

- `new`: not reviewed yet
- `acknowledged`: reviewed and accepted into the queue
- `planned`: approved for an upcoming pass
- `in_progress`: currently being worked
- `closed`: resolved, declined, or superseded

Priority meanings:

- `low`: useful, but not urgent
- `medium`: normal product/ops follow-up
- `high`: user trust, blocker, or repeated support burden

Working rules:

- Assign every actionable item to an owner.
- Add a resolution note before or when closing an item.
- Escalate anything that affects trust, billing, account access, or document completion flow.
- Keep lightweight process until request volume proves a dedicated support tool is necessary.

## Release discipline

For every pilot or production deploy:

1. Update [CHANGELOG.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/CHANGELOG.md) with user-visible and operator-visible changes.
2. Run:

```bash
npm run typecheck
npm run test
npm run build
```

3. Deploy.
4. Run the public-route smoke script against the deployed origin.
5. Check admin queue metrics and feedback queue once after deploy.
6. Run one PDF-signature smoke test whenever signature-related code changed:
   - one Path 1 document
   - one Path 2 document if Documenso credentials are configured

## Trust posture reminders

- EasyDraft currently provides SHA-256 export integrity plus workflow audit history.
- Path 1 now provides internal P12-backed PDF signing for controlled/internal workflows.
- Path 2 now relies on Documenso for managed signing workflows and completion callbacks.
- Path 3 remains intentionally unavailable beyond the `503` stub.
- Legal/trust pages exist, but direct-link verification must remain part of release hygiene.
