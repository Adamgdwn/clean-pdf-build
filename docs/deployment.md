# Deployment

## Vercel

### Recommended project setup

- Import the GitHub repository into Vercel
- Set the project Root Directory to `apps/web`
- Keep the framework as Vite

Because the Vercel project root is `apps/web`, the files in `apps/web/api` become the production API surface.

### Domain behavior

- `https://easydraftdocs.app` is the canonical application origin
- `https://easydraftdocs.com`, `www` variants, and known production `vercel.app` aliases should redirect to the canonical `.app` domain
- Supabase Auth should keep the same canonical `site_url` so auth flows and notification links stay consistent
- Vercel must also rewrite `/pricing`, `/privacy`, `/terms`, and `/security` to the SPA entry so direct trust-page links work outside client-side navigation

### Required environment variables

Set these in Vercel for Preview and Production:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_DOCUMENT_BUCKET`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DOCUMENT_BUCKET`
- `SUPABASE_SIGNATURE_BUCKET`
- `EASYDRAFT_ADMIN_EMAILS`
- `EASYDRAFT_APP_ORIGIN`
- `EASYDRAFT_EMAIL_PROVIDER`
- `RESEND_API_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `EASYDRAFT_NOTIFICATION_FROM_EMAIL`
- `EASYDRAFT_NOTIFICATION_FROM_NAME`
- `EASYDRAFT_NOTIFICATION_REPLY_TO`
- `EASYDRAFT_REQUIRE_STRIPE`
- `EASYDRAFT_REQUIRE_EMAIL_DELIVERY`
- `EASYDRAFT_PROCESSOR_SECRET`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `SENTRY_DSN`
- `VITE_SENTRY_DSN`
- `EASYDRAFT_ENABLE_CERTIFICATE_SIGNING`
- `VITE_EASYDRAFT_ENABLE_CERTIFICATE_SIGNING`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Recommended values:

- `VITE_SUPABASE_URL` = hosted Supabase project URL
- `SUPABASE_URL` = same hosted Supabase project URL
- `VITE_SUPABASE_ANON_KEY` = hosted Supabase publishable or anon key
- `SUPABASE_ANON_KEY` = same publishable or anon key
- `SUPABASE_SERVICE_ROLE_KEY` = hosted Supabase service-role secret
- `VITE_SUPABASE_DOCUMENT_BUCKET` = `documents`
- `SUPABASE_DOCUMENT_BUCKET` = `documents`
- `SUPABASE_SIGNATURE_BUCKET` = `signatures`
- `EASYDRAFT_ADMIN_EMAILS` = `admin@agoperations.ca`
- `EASYDRAFT_APP_ORIGIN` = `https://easydraftdocs.app`
- `EASYDRAFT_EMAIL_PROVIDER` = `resend` (recommended) or `smtp` for a self-hosted mail server
- `RESEND_API_KEY` = your Resend API key if `EASYDRAFT_EMAIL_PROVIDER=resend`; verify your sending domain in the Resend dashboard and add the DKIM and SPF DNS records to your domain
- `SMTP_HOST` = your SMTP server host if `EASYDRAFT_EMAIL_PROVIDER=smtp`
- `SMTP_PORT` = your SMTP server port such as `587`
- `SMTP_SECURE` = `false` for STARTTLS on port `587` or `true` for SMTPS on port `465`
- `SMTP_USER` = your SMTP username if auth is required
- `SMTP_PASSWORD` = your SMTP password if auth is required
- `EASYDRAFT_NOTIFICATION_FROM_EMAIL` = verified sender address for notifications
- `EASYDRAFT_NOTIFICATION_FROM_NAME` = optional human-friendly sender name such as `EasyDraft`
- `EASYDRAFT_NOTIFICATION_REPLY_TO` = optional reply-to mailbox for notification responses
- `EASYDRAFT_REQUIRE_STRIPE` = `true` in environments where billing must fail closed if Stripe is missing
- `EASYDRAFT_REQUIRE_EMAIL_DELIVERY` = `true` in environments where managed sends must fail closed if email is missing
- `EASYDRAFT_PROCESSOR_SECRET` = shared secret required by the processor service in production; send it as `x-processor-secret` or `Authorization: Bearer <secret>`
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` = shared Redis limiter credentials required for production rate limiting
- `SENTRY_DSN` = server-side Sentry DSN for workflow API, Vercel handlers, and processor errors
- `VITE_SENTRY_DSN` = browser-side Sentry DSN for the web client
- `EASYDRAFT_ENABLE_CERTIFICATE_SIGNING` = `false` unless a real provider-backed certificate-signing implementation is live
- `VITE_EASYDRAFT_ENABLE_CERTIFICATE_SIGNING` = match the server-side certificate-signing flag
- `STRIPE_SECRET_KEY` = your Stripe secret key for the environment
- `STRIPE_WEBHOOK_SECRET` = the signing secret for the `POST /api/stripe-webhook` endpoint

### Post-deploy smoke check

After each production deployment, run:

```bash
npm run smoke:public-routes -- https://easydraftdocs.app
```

All of `/pricing`, `/privacy`, `/terms`, and `/security` must return `200`.

## Supabase

### Project setup

1. Create a Supabase project.
2. Apply all SQL migrations in `supabase/migrations/` in order. Key migrations:
   - `20260330230000_initial_workflow.sql` — base tables
   - `20260405120000_signing_tokens.sql` — external signer token ledger
   - `20260406223000_annual_billing_plan.sql` — annual billing plan
   - `20260407033000_digital_signature_identity_fields.sql` — digital-signature profile fields
   - `20260407120000_onboarding_flag.sql` — server-side onboarding flag on profiles
3. Confirm the private `documents` bucket exists.
4. Enable Email auth.
5. Set your site URL and allowed redirect URLs to your Vercel domains.
6. Set your auth redirect URLs to include both the production Vercel URL and preview domains if you want auth testing on previews.

Recommended production auth values:

- site URL = `https://easydraftdocs.app`
- for the current internal pilot, email confirmation can stay off so new users land in the app immediately after signup
- if you turn email confirmation back on later, the web app now passes the current origin as the confirmation return URL
- allowed redirects include:
  - `https://easydraftdocs.app/**`
  - `https://easydraftdocs.com/**`
  - `https://www.easydraftdocs.app/**`
  - `https://www.easydraftdocs.com/**`
  - `https://*-adamgoodwin-8648s-projects.vercel.app/**`

### What the migrations create

- `profiles`
- `documents`
- `document_access`
- `document_invites`
- `document_signers`
- `document_fields`
- `document_versions`
- `document_audit_events`
- `document_processing_jobs`
- `document_signing_tokens` (token-based guest signing for external participants)
- `billing_plans`, `workspace_subscriptions`, `billing_usage_events` (billing and token quota tracking)

It also creates:

- storage bucket provisioning for `documents`
- row-level security for collaborator reads
- private upload policy scoped to the uploader's folder

## GitHub

### CI

The repo includes a GitHub Actions workflow at [ci.yml](/home/adamgoodwin/code/Applications/Clean_pdf_build/.github/workflows/ci.yml) that runs:

- `npm ci`
- `npm run typecheck`
- `npm run test`
- `npm run build`

### Vercel previews

Use Vercel's GitHub integration so each pull request gets a preview deployment automatically.

## Stripe

### Endpoints

- `POST /api/billing-checkout` creates a subscription Checkout session for the current workspace
- `POST /api/billing-portal` creates a Stripe billing portal session
- `POST /api/stripe-webhook` verifies Stripe signatures and syncs `workspace_billing_customers` and `workspace_subscriptions`

### Minimum Stripe setup

1. Create a webhook endpoint in Stripe pointing at `/api/stripe-webhook`.
2. Subscribe it to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
3. Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`.

The current implementation creates recurring Checkout prices inline from the seeded billing plans, so you do not need to pre-create Stripe Price IDs just to get the first subscription flow working.

## Future signing vendor

The Dropbox Sign integration is not wired yet, but you can prepare the production account now. Collect:

- API key
- client ID
- client secret
- webhook signing secret
- approved callback URL plan using the canonical origin

Recommended callback base: `https://easydraftdocs.app`

Until that integration is wired, `internal_use_only` is the built-in low-cost signing path for authenticated internal users. It relies on EasyDraft accounts, saved signatures, and the audit trail rather than third-party certificate-backed signing.

## Notifications and processor service

Managed signature emails are attempted inline when notifications are queued and a supported email provider is configured. In production runtime, platform-managed sends now fail closed if email delivery is not configured. Resend is the recommended provider. The separate processor is still useful for retries and for OCR / field-detection workloads.

## Processor service

The local processor service is still a separate boundary by design. It currently advances queued jobs with mocked OCR and field-detection outputs. In production runtime it now requires `EASYDRAFT_PROCESSOR_SECRET`.

Near-term production options:

- deploy it as a small container on Fly.io, Railway, or Render
- point it at the same Supabase project
- trigger it on a schedule or by webhook

This keeps OCR, field detection, and notification retries off Vercel while preserving the same workflow state and audit history.

## Local-to-hosted mapping

- local Supabase -> hosted Supabase project
- local Fastify workflow API -> Vercel serverless handlers in `apps/web/api`
- local processor -> containerized worker

Detailed launch prep also lives in [go-live-checklist.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/go-live-checklist.md).
Operational response steps live in [operator-runbook.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/operator-runbook.md).
