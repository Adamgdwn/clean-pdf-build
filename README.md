# EasyDraft

Deployable foundation for a cloud-processed PDF workflow product focused on the common path:

- authentication
- PDF upload and preview
- shared document access
- signer and field assignment
- self-managed distribution and platform-managed signing paths
- audit trail and version history
- queued OCR and field-detection jobs
- Stripe-backed workspace billing bootstrap
- explicit lock and reopen behavior

## Workflow paths

Documents now support two operational paths:

- `self_managed`: keep the PDF in the workspace while you edit it, then download it or distribute it through your own shared storage
- `platform_managed`: keep the PDF in the workspace, send the next signature request from the app, and queue notifications back to the originator when signatures are completed

## Stack

- `apps/web`: React + Vite client prepared for Vercel
- `services/workflow-api`: local Fastify API for parity with production handlers
- `services/document-processor`: local processor service that advances queued jobs
- `packages/domain`: shared workflow rules and schemas
- `packages/workflow-service`: Supabase-backed workflow logic used by both local API and Vercel functions
- `supabase/`: local Supabase config and SQL migration

## Product rule that matters most

Signature completion is tracked at the field level.

A document remains signable until:

- all required assigned signing fields are complete, or
- a user with permission explicitly locks it

Locking records who locked it and when.

## Local development

1. Install dependencies:

```bash
npm install
```

2. Start Supabase:

```bash
npm run supabase:start
```

3. Copy the values from `npx supabase status -o env` into `.env` using `.env.example` as the template.

4. Start the local app stack:

```bash
npm run dev
```

That runs:

- web client on `http://localhost:5173`
- workflow API on `http://localhost:4000`
- processor service on `http://localhost:4010`

To process queued OCR and field-detection jobs locally:

```bash
npm run processor:run-queued
```

To retry queued notification emails locally:

```bash
npm run processor:run-notifications
```

## Deployment shape

- Vercel hosts the web app and the `apps/web/api/*` serverless endpoints
- Supabase provides Auth, Postgres, Storage, and invites-backed collaboration
- Stripe Checkout and the billing portal drive subscriptions against workspace records
- Stripe gracefully falls back to placeholder mode until `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are configured
- Resend can deliver notification emails once `RESEND_API_KEY` and `EASYDRAFT_NOTIFICATION_FROM_EMAIL` are configured
- When Resend is configured, managed signature emails are attempted immediately during send and completion events
- GitHub Actions runs CI on each push and PR
- A separate processor service can be deployed as a container later for heavier OCR and transform workloads

Detailed steps live in [deployment.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/deployment.md).
Launch prep lives in [go-live-checklist.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/go-live-checklist.md).
Identity and pricing guidance live in [identity-and-monetization.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/identity-and-monetization.md).

Billing endpoints now live in:

- [billing-overview.ts](/home/adamgoodwin/code/Applications/Clean_pdf_build/apps/web/api/billing-overview.ts)
- [billing-checkout.ts](/home/adamgoodwin/code/Applications/Clean_pdf_build/apps/web/api/billing-checkout.ts)
- [billing-portal.ts](/home/adamgoodwin/code/Applications/Clean_pdf_build/apps/web/api/billing-portal.ts)
- [stripe-webhook.ts](/home/adamgoodwin/code/Applications/Clean_pdf_build/apps/web/api/stripe-webhook.ts)

## Latest Workflow Updates

The current build now includes these workflow and policy improvements:

- a user can be a collaborator and a signer on the same document without losing their stronger role
- duplicate signer emails are blocked per document
- routed signer notifications are based on required signature and initial fields only
- managed notification emails are attempted immediately when Resend is configured
- collaborator invites are now clearly separated from routed signer setup
- the document UI shows clearer role labels like `owner + signer`
- signer-facing actions are less noisy and only show completion controls when the current user is the assigned signer

There is also a new database migration to apply:

- [20260331120000_unique_signer_email_per_document.sql](/home/adamgoodwin/code/Applications/Clean_pdf_build/supabase/migrations/20260331120000_unique_signer_email_per_document.sql)

## Concrete Next Steps For Adam

1. Pull `main` and apply the latest Supabase migration locally and in hosted environments.
2. Sign in with `admin@agoperations.ca` and run the structured workflow test pass below.
3. Create three realistic test identities:
   - one owner/editor
   - one signer-only user
   - one owner or editor who is also assigned as a signer
4. Configure Resend when you are ready for live notification delivery:
   - `RESEND_API_KEY`
   - `EASYDRAFT_NOTIFICATION_FROM_EMAIL`
5. Run one real managed-signing flow with Resend enabled and verify:
   - the first email arrives
   - the link opens the correct document
   - the originator progress message arrives after a signature is completed
6. Keep Stripe in placeholder mode until you are ready to wire live billing:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
7. Continue Dropbox Sign pricing and account setup so the integration handoff is ready when we start that phase.
8. Keep notes on:
   - any wording that still feels internal
   - any moment where the next action is unclear
   - any signer-facing screen that still feels too dense

## Concrete Next Steps For Codex

1. Implement change-impact tracking once signatures have started.
2. Add explicit resend and remind actions instead of relying only on reopen.
3. Differentiate `non_material`, `review_required`, and `resign_required` edits.
4. Add signer invalidation markers so affected signatures can remain valid, require acknowledgement, or require re-sign.
5. Build a signed-snapshot comparison view between the last signed state and the current draft.
6. Improve signer-facing progress UI even further:
   - clearer "you are next" states
   - a calmer signer-only action area
   - friendlier access and audit labels
7. Expand admin operations pages for:
   - user lookup
   - workspace lookup
   - subscription placeholders
   - notification health
   - processing-job health

## Document Lifecycle Walkthrough

The intended lifecycle should be treated as field-centric and audit-centric, not envelope-centric.

1. Upload
   - Owner uploads the PDF.
   - The file is stored privately.
   - The document starts in `draft`.
2. Prepare
   - Owner or editor adds fields, assigns signers, chooses sequential or parallel routing, and decides between self-managed or platform-managed flow.
   - Collaborator invites are for editors and viewers. Routed signers should be added through the signer list.
   - OCR and field detection can be queued.
   - The document moves into `prepared` once usable structure exists.
3. Send
   - In `self_managed`, the owner downloads or shares the file themselves.
   - In `platform_managed`, EasyDraft queues signer notifications and owner progress updates.
   - The document moves into `sent`.
4. Partial completion
   - A signer completes only the fields assigned to them.
   - The document stays signable until all required assigned signing fields are complete, unless an explicit lock happens.
   - The document moves into `partially signed` when some required assigned signing fields are complete but not all.
5. Completion
   - When all required assigned signing fields are complete, the document becomes `completed`.
   - Export remains available.
6. Reopen
   - An authorized user can reopen the document when further signing is needed.
   - Reopen must always be explicit and auditable.
7. Lock
   - An authorized user can explicitly lock the document before full completion.
   - Lock records who locked it and when.

## Change Handling After Signing Starts

This is the next important workflow rule to implement more deeply.

Today:

- The system already supports reopen and continued signing.
- The system already records audit and version events.

Next rule to add:

- Any edit after one or more signatures exist should be classified by impact.

Recommended impact levels:

1. `non_material`
   - layout cleanup, labels, internal notes, metadata-only changes
   - does not require re-sign
2. `review_required`
   - changed text in a non-signed section, added attachment, changed optional field
   - should notify affected signers and owner
3. `resign_required`
   - changed signed text, changed required field placement, changed assignee, changed signing order, changed a completed signature field’s context
   - should flag impacted signatures as no longer sufficient and require re-sign

Recommended behavior:

1. Capture a signed snapshot whenever a signer completes a signature or initial field.
2. When edits happen later, compare the current working version against the last signed snapshot.
3. Mark impacted signers without silently throwing away prior work.
4. Let the owner choose:
   - continue without resend
   - notify impacted signers
   - force resend and re-sign

## Scenario Test Matrix

Use these scenarios in order.

### 1. Single User Draft And Export

1. Upload one PDF.
2. Add a text field and one signature field.
3. Save as copy.
4. Download.
5. Share with signed URL.
6. Confirm audit trail and version history are readable.

Expected:

- draft -> prepared
- undo/redo works for field placement
- clear all removes fields and is reversible through history

### 2. Single Signer Managed Flow

1. Upload one PDF in `platform_managed`.
2. Add one signer and one required signature field.
3. Send for signatures.
4. Complete the field as that signer.

Expected:

- sent -> partially signed or completed depending on remaining required fields
- originator gets progress notification when configured
- completed state appears only when all required assigned signing fields are done

### 3. Sequential Multi-Signer Flow

1. Add signer A and signer B.
2. Set sequential routing.
3. Assign required fields to each signer.
4. Send.
5. Complete signer A.
6. Verify signer B becomes the next routed signer.

Expected:

- only the next eligible signer is notified
- owner sees who is next
- signer B is not considered blocked by envelope completion semantics

### 4. Parallel Multi-Signer Flow

1. Add signer A and signer B.
2. Set parallel routing.
3. Assign required fields to both.
4. Send.

Expected:

- both eligible signers are queued at once
- owner notifications reflect incremental progress

### 5. Edit After One Signature Exists

1. Start a two-signer flow.
2. Let signer A complete their field.
3. Reopen or continue editing.
4. Move or resize a non-signed field.
5. Change a signed section of text or field placement.

Expected today:

- version history and audit trail capture the edit
- reopen is explicit

Expected next:

- the app should classify whether signer A stays valid, must review, or must re-sign

### 6. Send Back For Changes And Re-Sign

1. Complete one signer.
2. Make a material document change.
3. Mark that change as `resign_required`.
4. Re-route affected signers only.

Expected next:

- affected signatures are flagged, not silently discarded
- unaffected signers are preserved where possible
- owner sees exactly who must re-sign and why

### 7. Explicit Lock Before Full Completion

1. Prepare a document with outstanding required fields.
2. Lock it manually.

Expected:

- document is no longer signable
- audit trail records who locked it and when
- reopening restores signability

### 8. Self-Managed Distribution Path

1. Upload one PDF as `self_managed`.
2. Edit and assign fields.
3. Download or generate a share link.
4. Do not use managed notifications.

Expected:

- the document remains a workspace-centered editing object
- no automatic signer emails are queued
- export and sharing remain available

## Suggested Testing Order

1. Validate local UX and workflow transitions.
2. Validate notification timing with live Resend credentials.
3. Validate multi-signer routing in production.
4. Validate reopen, edit, and resend-for-changes behavior.
5. Only then validate certificate-backed digital signing with a real provider.

## Verification

The current repository passes:

```bash
npm run typecheck
npm run test
npm run build
```

I also validated the latest local integration path on March 30, 2026 by:

- booting the Supabase stack with `npx supabase start`
- applying the SQL migration successfully
- creating a real auth user through local Supabase Auth
- creating a document through the workflow API
- processing the queued OCR job through the processor service

## Notes

- Storage uploads are private by default.
- Browser uploads go directly to Supabase Storage in a user-scoped folder.
- Shared previews use signed URLs from the server layer after access is verified.
- The current worker produces mocked OCR and field-detection results, but the queue and audit path are real.
