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

Documents now support three operational paths:

- `self_managed`: keep the PDF in the workspace while you edit it, then download it or distribute it through your own shared storage
- `internal_use_only`: keep the PDF in EasyDraft, collect signatures from authenticated internal users, and use the built-in audit trail without third-party certification
- `platform_managed`: keep the PDF in the workspace, send the next signature request from the app, and queue notifications back to the originator when signatures are completed

For near-term planning, the team roadmap now has a first-principles future-state workflow diagram in [future-workflow-roadmap.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/future-workflow-roadmap.md). It keeps the next additions centered on clear blockers, initiator updates, safe revision handling, reassignment, reminders, and a clean completion package.

Current operating guides:

- [user-instructions.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/user-instructions.md)
- [admin-instructions.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/admin-instructions.md)

For the current internal pilot, hosted signup can auto-confirm users so team members reach the app immediately after creating an account. If you later switch email confirmation back on, EasyDraft now sends users back to the current app origin after they confirm.

Important distinction:

- Supabase Auth handles account invite, signup, confirmation, and password reset emails
- EasyDraft workflow emails can now use SMTP or Resend for routed action requests and progress updates when enabled

That means testers can still be invited into the app and create accounts even if workflow email delivery is not enabled yet, and you are no longer locked to Resend for managed notifications.

Admin access uses the same sign-in form as every other user. Sign up or sign in with `admin@agoperations.ca` to unlock the EasyDraft admin console, which now includes account status review, privilege visibility, password-reset email actions, and test-user deletion.

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
- Workflow notifications can use SMTP or Resend once the matching email settings and `EASYDRAFT_NOTIFICATION_FROM_EMAIL` are configured
- When a supported email provider is configured, managed signature emails are attempted immediately during send and completion events
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

## Current Product Status

The product is in a strong pilot and tester-readiness stage:

- core document upload, editing, routing, signing, audit, export, lock, and reopen flows are working
- internal, self-managed, and platform-managed paths are available
- staged routing, approvals, due dates, waiting-on status, request changes, reject, cancel, and reassignment exist in the workflow layer
- external signers can complete their assigned fields via a one-time token link without creating an account
- overdue and blocked indicators are visible in the document list
- reminder emails can be sent to pending signers on platform-managed workflows
- workflow notification emails are live via Resend from `noreply@easydraftdocs.app`
- billing is still safe to test in placeholder mode while the business setup catches up
- certificate-backed external signing remains an optional next-phase capability

That means the current build is suitable for a free 30-day tester cohort, but not yet positioned as a fully commercialized paid product.

## Current Rollout Status

Current known live status:

- `https://easydraftdocs.app` is live
- `https://easydraftdocs.app/api/health` is responding from the Vercel API
- Resend is configured as the workflow email provider
- `easydraftdocs.app` is a verified sending domain in Resend (DKIM + SPF)
- workflow notification emails send from `noreply@easydraftdocs.app`
- the `document_signing_tokens` table is live in production Supabase
- token-based external signing is active: external signers receive a one-time link and can complete their fields without creating an EasyDraft account
- signing token quotas are included in each billing plan (starter: 25, team: 100, business: 500)
- overdue and blocked status badges are visible in the document list
- remind signers action is available for platform-managed workflows

The remaining pre-commercialization step is Stripe: add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to Vercel once the Stripe account and pricing are ready.

## Latest Workflow Updates

The current build now includes these workflow and policy improvements:

- a user can be a collaborator and a signer on the same document without losing their stronger role
- duplicate signer emails are blocked per document
- a new `internal_use_only` path for low-cost internal signing inside EasyDraft
- hosted signup now auto-confirms for the current internal pilot, and the app passes an explicit return URL if email confirmation is re-enabled later
- the production auth project was cleared back to zero users so Prime Boilers testing can start from a clean slate
- admin login guidance now appears in the auth card and under the empty Documents state
- a real admin console now exists for testing and operations
  - account list
  - account status
  - privilege visibility
  - tester invite email action
  - password reset email action
  - test-user deletion
- routed signer notifications are based on required signature and initial fields only
- managed notification emails send immediately via Resend when a workflow is sent or a reminder is triggered
- collaborator invites are now clearly separated from routed signer setup
- the document UI shows clearer role labels like `owner + signer`
- signer-facing actions are less noisy and only show completion controls when the current user is the assigned signer
- workflow due dates and overdue visibility
- overdue and blocked indicators are shown as badges in the document list
- explicit `waiting on` summaries in the document response and UI
- signer-driven `request changes` and `reject workflow` actions
- initiator-driven `cancel workflow`
- participant reassignment for blocked or unavailable signers
- remind signers action for platform-managed workflows (reuses existing token or issues a fresh one)
- external signers receive a one-time token link and can complete their assigned fields without an EasyDraft account
- signing token quotas are tracked per workspace billing period
- a future-state workflow roadmap document for the team in [future-workflow-roadmap.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/future-workflow-roadmap.md)

## Immediate Marketability Tasks

### Adam Next Steps

1. Run one live email smoke test:
   - send yourself a tester invite from the admin console
   - confirm the Supabase invite email arrives (Supabase sends this directly)
   - send one `platform_managed` workflow to an external email address
   - confirm the workflow email arrives from `noreply@easydraftdocs.app` and opens back into EasyDraft
   - click the signing link and verify the guest signing session loads without requiring login
2. Set up the Stripe account properly:
   - create the Stripe account
   - complete business profile and payout details
   - create the initial product and monthly price
   - decide what the free tester month looks like before billing begins
3. Wire Stripe to production once pricing is ready:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - pricing copy and plan naming that match the real offer
4. Define the first tester offer clearly:
   - free for 30 days
   - who it is for
   - what kind of support they can expect
   - what feedback you want from them
6. Create a small pilot test set:
   - one admin or owner
   - one editor
   - one internal signer
   - one external signer using a real outside email if available
7. Run the structured workflow test pass below in this order:
   - `internal_use_only`
   - `self_managed`
   - `platform_managed`
   - staged internal then external
   - approval-only path
8. For each run, verify:
   - sign up and sign in
   - saved signatures
   - PDF upload
   - field placement
   - routing selection
   - stage handoff
   - lock and reopen
   - revision and save-as flow
   - preview, download, and export output
   - audit trail and version history
9. Keep a simple defect log with:
   - page or screen
   - expected behavior
   - actual behavior
   - severity
   - whether it is wording, workflow, or rendering
10. Set up lightweight market-facing assets:
   - a short landing page headline and subhead
   - one pricing page draft
   - one demo workflow PDF set
   - a short tester onboarding email
11. Only after the workflow pass feels stable, enable one live external service at a time:
   - SMTP first if notification testing becomes necessary
   - Stripe later when pricing and billing are ready for real users
   - Dropbox Sign only when certificate-backed external signing becomes a real requirement

### Codex Next Steps

1. Add change-impact classification after partial completion:
   - `non_material`
   - `review_required`
   - `resign_required`
2. Improve completion packaging:
   - clearer completion summary
   - cleaner export/share handoff
   - stronger audit presentation
5. Tighten the product polish that affects conversion:
   - calmer onboarding copy
   - clearer path labels
   - cleaner empty states
   - better “what happens next” guidance
6. Support a stronger tester-to-paid path:
   - billing-plan labels in the app
   - pricing-aware onboarding copy
   - account and workspace status visibility
7. Add a simple readiness checklist for switching from free pilot mode to paid mode.

## Cost-Effective Build Guidance

Keep the product sharp by being selective about where money and complexity go.

- Default to `internal_use_only` for internal teams during the pilot. It gives strong workflow coverage without third-party signing costs.
- Treat `platform_managed` as a product capability, but do not pay for certificate-backed external signing until you have real demand that justifies it.
- Leave Stripe in placeholder mode until the workflow, packaging, and pricing story feel stable. Billing complexity is easy to add later and expensive to rethink early.
- Leave notification delivery off until you need real inbox testing. During early testing, in-app progress and shared test accounts are cheaper and faster.
- Keep OCR and field detection lightweight. Use the current queued processor and manual triggers before paying for always-on heavy document infrastructure.
- Avoid creating a new workflow type for every customer request. Reuse the current dimensions:
  - participant type
  - routing strategy
  - stage
  - delivery mode
  - lock policy
- Prioritize clarity over automation. A clear workflow builder, clean signer screens, and trustworthy exports will win more pilot confidence than expensive AI or enterprise integrations added too early.
- Measure pain before buying solutions. Only spend on notification volume, advanced OCR, or third-party signing once the pilot shows those are the actual bottlenecks.

## Product Build Priorities

Build in this order to stay lean without losing product quality:

1. Make the core signing and approval paths feel obvious and dependable.
2. Make exports, audit history, revisions, and lock behavior trustworthy.
3. Make the signer and originator UX calmer and clearer.
4. Make the free tester experience feel polished enough to recommend to another team.
5. Add reminder, resend, and change-impact handling.
6. Add live email delivery.
7. Add live billing.
8. Add third-party certified signing only when the product and customer need are proven.

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
   - In `internal_use_only`, internal signers log in to EasyDraft and complete assigned fields inside the app.
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

This is still one of the most important product rules to implement more deeply.

Today:

- The system supports reopen and continued signing.
- The system records audit and version events.
- The system now supports due dates, waiting-on status, request changes, reject, cancel, and reassignment.

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

### 2B. Single Signer Internal-Only Flow

1. Upload one PDF in `internal_use_only`.
2. Add one internal signer and one required signature field.
3. Open it for internal signing.
4. Sign in as that user and complete the field.

Expected:

- the document stays inside EasyDraft
- no automatic signer email is required
- the audit trail records the internal signing activity
- the document reaches `completed` when all required assigned signing fields are done

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
2. Validate notification timing with live SMTP or Resend credentials.
3. Validate multi-signer routing in production.
4. Validate request-changes, reject, cancel, due-date, and reassignment behavior.
5. Validate reopen, edit, and resend-for-changes behavior.
6. Only then validate certificate-backed digital signing with a real provider.

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
