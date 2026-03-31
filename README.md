# Clean PDF Build

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

## Deployment shape

- Vercel hosts the web app and the `apps/web/api/*` serverless endpoints
- Supabase provides Auth, Postgres, Storage, and invites-backed collaboration
- Stripe Checkout and the billing portal drive subscriptions against workspace records
- GitHub Actions runs CI on each push and PR
- A separate processor service can be deployed as a container later for heavier OCR and transform workloads

Detailed steps live in [deployment.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/deployment.md).
Identity and pricing guidance live in [identity-and-monetization.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/identity-and-monetization.md).

Billing endpoints now live in:

- [billing-overview.ts](/home/adamgoodwin/code/Applications/Clean_pdf_build/apps/web/api/billing-overview.ts)
- [billing-checkout.ts](/home/adamgoodwin/code/Applications/Clean_pdf_build/apps/web/api/billing-checkout.ts)
- [billing-portal.ts](/home/adamgoodwin/code/Applications/Clean_pdf_build/apps/web/api/billing-portal.ts)
- [stripe-webhook.ts](/home/adamgoodwin/code/Applications/Clean_pdf_build/apps/web/api/stripe-webhook.ts)

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
