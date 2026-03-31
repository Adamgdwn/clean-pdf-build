# Deployment

## Vercel

### Recommended project setup

- Import the GitHub repository into Vercel
- Set the project Root Directory to `apps/web`
- Keep the framework as Vite

Because the Vercel project root is `apps/web`, the files in `apps/web/api` become the production API surface.

### Required environment variables

Set these in Vercel for Preview and Production:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_DOCUMENT_BUCKET`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DOCUMENT_BUCKET`
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
- `STRIPE_SECRET_KEY` = your Stripe secret key for the environment
- `STRIPE_WEBHOOK_SECRET` = the signing secret for the `POST /api/stripe-webhook` endpoint

## Supabase

### Project setup

1. Create a Supabase project.
2. Apply the SQL in [20260330230000_initial_workflow.sql](/home/adamgoodwin/code/Applications/Clean_pdf_build/supabase/migrations/20260330230000_initial_workflow.sql).
3. Confirm the private `documents` bucket exists.
4. Enable Email auth.
5. Set your site URL and allowed redirect URLs to your Vercel domains.
6. Set your auth redirect URLs to include both the production Vercel URL and preview domains if you want auth testing on previews.

### What the migration creates

- `profiles`
- `documents`
- `document_access`
- `document_invites`
- `document_signers`
- `document_fields`
- `document_versions`
- `document_audit_events`
- `document_processing_jobs`

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
3. Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`.

The current implementation creates recurring Checkout prices inline from the seeded billing plans, so you do not need to pre-create Stripe Price IDs just to get the first subscription flow working.

## Processor service

The local processor service is still a separate boundary by design. It currently advances queued jobs with mocked OCR and field-detection outputs.

Near-term production options:

- deploy it as a small container on Fly.io, Railway, or Render
- point it at the same Supabase project
- trigger it on a schedule or by webhook

This keeps heavy processing off Vercel while preserving the same workflow state and audit history.

## Local-to-hosted mapping

- local Supabase -> hosted Supabase project
- local Fastify workflow API -> Vercel serverless handlers in `apps/web/api`
- local processor -> containerized worker
