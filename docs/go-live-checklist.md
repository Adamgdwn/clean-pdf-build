# Go-Live Checklist

Use this after workflow testing passes and before you present EasyDraft as production-ready.

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
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_DOCUMENT_BUCKET`
   - `SUPABASE_SIGNATURE_BUCKET`
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
4. Confirm the `documents` bucket exists and remains private.
5. Confirm all SQL migrations are fully applied, including `20260405120000_signing_tokens.sql`.

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
5. Run one checkout test and one billing-portal test after the keys are added.

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
2. Create at least one non-admin owner account and two signer accounts for smoke tests.
3. Verify:
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

## Final release gate

Only claim production readiness after all of these are true:

- HTTPS domain behavior is correct
- auth redirects are correct
- Stripe live checkout works
- notification delivery works with your chosen provider
- managed signing flow passes with real users
- you have chosen and integrated the real signature vendor path
