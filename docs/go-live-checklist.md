# Go-Live Checklist

Use this after workflow testing passes and before you present EasyDraft as production-ready.

Current scope reminder:
- present EasyDraft as a minimal-change PDF workflow execution system
- do not position it as a broad PDF editor
- prioritize workflow trust, signer verification, and executed-record durability over feature breadth

## Canonical domains

- Canonical app domain: `https://easydraftdocs.app`
- Redirected domains:
  - `https://easydraftdocs.com`
  - `https://www.easydraftdocs.com`
  - `https://www.easydraftdocs.app`
  - known production `vercel.app` aliases

## Vercel

1. Confirm these environment variables exist in both Preview and Production:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_SUPABASE_DOCUMENT_BUCKET`
   - `VITE_SUPABASE_UNSIGNED_DOCUMENT_BUCKET`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_DOCUMENT_BUCKET`
   - `SUPABASE_UNSIGNED_DOCUMENT_BUCKET`
   - `SUPABASE_SIGNED_DOCUMENT_BUCKET`
   - `SUPABASE_SIGNATURE_BUCKET`
   - `DOCUMENSO_API_BASE_URL`
   - `DOCUMENSO_API_KEY`
   - `DOCUMENSO_WEBHOOK_SECRET`
   - `EASYDRAFT_ADMIN_EMAILS`
   - `EASYDRAFT_APP_ORIGIN`
   - `EASYDRAFT_REQUIRE_STRIPE=true`
   - `EASYDRAFT_REQUIRE_EMAIL_DELIVERY=true`
   - `EASYDRAFT_PROCESSOR_SECRET`
2. Keep `EASYDRAFT_APP_ORIGIN` set to `https://easydraftdocs.app`.
3. Confirm the custom domains are attached and issuing valid certificates:
   - `easydraftdocs.app`
   - `easydraftdocs.com`
4. Confirm the host redirect rules in [vercel.json](/home/adamgoodwin/code/Applications/Clean_pdf_build/vercel.json) are active in production.

## Supabase

1. Confirm Auth `site_url` is `https://easydraftdocs.app`.
2. Confirm redirect allow-list includes:
   - `https://easydraftdocs.app/**`
   - `https://easydraftdocs.com/**`
   - `https://www.easydraftdocs.app/**`
   - `https://www.easydraftdocs.com/**`
   - preview `vercel.app` wildcard if you want preview auth testing
3. Confirm Email auth is enabled.
4. Confirm the `documents-unsigned`, `documents-signed`, and `signatures` buckets exist and remain private.
5. Confirm all SQL migrations are fully applied, including:
   - `20260405120000_signing_tokens.sql`
   - `20260406223000_annual_billing_plan.sql`
   - `20260407033000_digital_signature_identity_fields.sql`
   - `20260407120000_onboarding_flag.sql`
   - `20260417120000_invite_and_signing_verification.sql`
   - `20260422100000_pdf_signature_paths.sql`

## PDF signature paths

1. Confirm Path 1 environment is live:
   - `P12_CERT_BASE64`
   - `P12_CERT_PASSPHRASE`
2. Confirm Path 2 environment is live:
   - `DOCUMENSO_API_BASE_URL`
   - `DOCUMENSO_API_KEY`
   - `DOCUMENSO_WEBHOOK_SECRET`
3. In Documenso, confirm the webhook points to:
   - `https://easydraftdocs.app/api/documenso-webhook`
4. Run one Path 1 smoke test from upload through signed PDF download.
5. Run one Path 2 smoke test from upload through webhook-completed signed PDF copy-back.
6. Confirm the `Signature audit trail` panel shows signature-path events for the test documents.

## Stripe

1. Create the live Stripe account or switch the existing one to live mode.
2. Add to Vercel:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
3. Create a webhook endpoint at:
   - `https://easydraftdocs.app/api/stripe-webhook`
4. Subscribe the webhook to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
5. Configure these **Dashboard settings** (one-time, manual — not settable via API):
   - `Settings → Billing → Subscriptions and emails` → **enable "Send an invoice for free trials"**
     Sends the customer a $0 invoice email when their trial subscription is created. Without this, the customer has no confirmation they signed up or what they will owe.
   - `Settings → Billing → Subscriptions and emails` → **enable "Send emails about upcoming renewals"**
     Emails the customer ~7 days before trial ends to collect a payment method. Critical because `payment_method_collection: "if_required"` allows sign-up without a card — this email is their only prompt to add one before being charged.
   - `Settings → Branding` → upload logo, set brand colour, set business name
     Applies to all Stripe-generated emails and the Customer Portal.
6. Run one checkout test and one billing-portal test after the keys are added.
7. Replay at least one Stripe test webhook event to confirm duplicate delivery does not duplicate billing state changes.

## Notification Email

Resend is configured and live for production. The following are already complete:

- [x] `EASYDRAFT_EMAIL_PROVIDER=resend` set in Vercel (Production + Development)
- [x] `RESEND_API_KEY` set in Vercel (Production + Development)
- [x] `EASYDRAFT_NOTIFICATION_FROM_EMAIL=noreply@easydraftdocs.app` set in Vercel
- [x] `easydraftdocs.app` verified as sending domain in Resend (DKIM + SPF)

Remaining:

1. Send one real notification to verify deliverability and link behavior end-to-end.
2. Decide whether you also want the processor deployed for notification retries and queued OCR / field-detection jobs.

## Dropbox Sign

EasyDraft does not yet have the Dropbox Sign integration wired in, but these are the items to collect now so the handoff is smooth later:

1. Dropbox Sign API app or production app
2. API key
3. client ID
4. client secret
5. webhook signing secret
6. redirect URL plan for embedded flows
   - recommended callback base: `https://easydraftdocs.app`

Store the future values in your secret manager or Vercel using these names for consistency:

- `DROPBOX_SIGN_API_KEY`
- `DROPBOX_SIGN_CLIENT_ID`
- `DROPBOX_SIGN_CLIENT_SECRET`
- `DROPBOX_SIGN_WEBHOOK_SECRET`

## Admin and operations

1. Confirm `admin@agoperations.ca` is included in `EASYDRAFT_ADMIN_EMAILS`.
2. Create at least one non-admin account admin account and two signer accounts for smoke tests.
3. Verify:
   - account-admin-capable user lands in organization admin by default
   - workspace switcher appears when a user belongs to more than one workspace
   - switching workspace updates documents, billing, and team scope together
   - public `/pricing` route loads and explains seats vs tokens clearly
   - signature library can save at least one typed signature
   - digital-signature profile can be created without browser fetch errors
   - upload
   - internal-use-only signing
   - field placement
   - self-managed sharing
   - managed send
   - sequential routing
   - parallel routing
   - lock
   - reopen
   - audit trail
   - version history
   - per-signer notification status visible in participant list
   - per-signer Resend button sends reminder only to that signer
   - Completion certificate opens as printable HTML on completed documents
   - external signer opens a dedicated signer page rather than the internal workspace shell
   - external signer must request and enter the emailed verification code before completing a signature, initial, or approval action
   - signing flow prompts for `Reason for signing` and optional `Signing location`
   - wrong-account workspace invite acceptance is blocked with a clear recovery message
   - the product still feels like field placement + routing + completion, not arbitrary document editing

## Final release gate

Only claim production readiness after all of these are true:

- HTTPS domain behavior is correct
- auth redirects are correct
- Stripe live checkout works
- notification delivery works with your chosen provider
- managed signing flow passes with real users
- Path 1 and Path 2 PDF signature flows pass with real credentials
- workspace switching stays correctly scoped for multi-workspace users
- pricing and trial language are understandable to a first-time visitor
- certificate-backed signing remains clearly out of scope unless a real provider integration has been completed and verified

## Next steps after go-live

Once the above is complete, the next operational/product tasks should be:

1. Keep legal/trust pages verified:
   - review privacy policy, terms, and security copy before major selling pushes
   - run `npm run smoke:public-routes -- https://easydraftdocs.app` after deploys
2. Add monitoring and alerting:
   - keep Sentry or equivalent active
   - keep Vercel log drains or equivalent enabled
   - alert on failed notification rows and aging queues
3. Keep deployment docs aligned with live runtime requirements and env vars.
4. Processor runtime — verify manual trigger works:
   - Set `EASYDRAFT_PROCESSOR_SECRET` in Vercel and `PROCESSOR_SECRET` as a GitHub repo secret.
   - Go to Actions → Processor run → Run workflow and confirm `ok: true` in the response.
   - Add a `schedule:` block to the workflow file when notification retry volume justifies it (see `docs/deployment.md`).
5. Harden the core workflow before adding broader feature surface:
   - stronger executed-record retention / reopen behavior
   - extraction of workflow core panels from `App.tsx`
6. Keep the signature rollout notes current:
   - update [pdf-signature-rollout.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/pdf-signature-rollout.md) after each live credential or workflow change
