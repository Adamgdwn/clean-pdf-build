# Adam's Actions

Your personal to-do list scraped from across the documentation. Check things off as you go.

---

## 🔴 Before any external users touch the product

### Supabase

- [ ] Run `npx supabase db push` to apply all pending migrations to production
  - Adds: `export_sha256`, signing token ledger, workspace invitations, CAD billing plans, digital-signature identity fields, `onboarding_completed_at`
- [ ] Confirm Auth `site_url` = `https://easydraftdocs.app` in the Supabase dashboard
- [ ] Confirm redirect allow-list includes:
  - `https://easydraftdocs.app/**`
  - `https://easydraftdocs.com/**`
  - `https://www.easydraftdocs.app/**`
  - `https://www.easydraftdocs.com/**`
- [ ] Confirm Email auth is enabled
- [ ] Confirm the `documents` bucket exists and is set to **private**

### Vercel — environment variables

- [ ] Confirm all of these exist in both Preview and Production:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_SUPABASE_DOCUMENT_BUCKET`
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_DOCUMENT_BUCKET`
  - `SUPABASE_SIGNATURE_BUCKET`
  - `EASYDRAFT_ADMIN_EMAILS` (set to `admin@agoperations.ca`)
  - `EASYDRAFT_APP_ORIGIN` (set to `https://easydraftdocs.app`)
  - `EASYDRAFT_REQUIRE_STRIPE=true`
  - `EASYDRAFT_REQUIRE_EMAIL_DELIVERY=true`
  - `EASYDRAFT_PROCESSOR_SECRET`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`

### Stripe — account and webhook setup

- [ ] Switch Stripe account to **live mode** (or confirm it already is)
- [ ] Add `STRIPE_SECRET_KEY` (live key) to Vercel
- [ ] Create a webhook endpoint in the Stripe dashboard pointing to:
  `https://easydraftdocs.app/api/stripe-webhook`
- [ ] Subscribe the webhook to these events:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`
- [ ] Copy the webhook signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` in Vercel

### Stripe — Dashboard settings (manual, not settable via API)

- [ ] **Settings → Billing → Subscriptions and emails → enable "Send an invoice for free trials"**
  Sends the customer a $0 invoice email the moment their trial subscription is created. Without this they have no paper trail showing they signed up or what they will owe.
- [ ] **Settings → Billing → Subscriptions and emails → enable "Send emails about upcoming renewals"**
  Emails customers ~7 days before trial ends to collect a payment method. Critical — the checkout allows sign-up without a card, so this email is the customer's only prompt before they get charged.
- [ ] **Settings → Billing → Customer portal → enable and configure**
  Minimum: allow cancellation, allow payment method updates.
- [ ] **Settings → Branding → upload logo, set brand colour, set business name**
  Applies to all Stripe-generated emails and the Customer Portal.

### Stripe — smoke test

- [ ] Run one full checkout test (test card `4242 4242 4242 4242`) and confirm subscription appears in the app
- [ ] Run one billing-portal test and confirm cancellation and payment method flows work

### Email

- [x] `EASYDRAFT_EMAIL_PROVIDER=resend` set in Vercel *(done)*
- [x] `RESEND_API_KEY` set in Vercel *(done)*
- [x] `EASYDRAFT_NOTIFICATION_FROM_EMAIL=noreply@easydraftdocs.app` set *(done)*
- [x] `easydraftdocs.app` verified in Resend with DKIM + SPF *(done)*
- [ ] Send one real platform-managed workflow to an external address and confirm the email arrives and the signing link opens correctly

### Vercel — domains

- [ ] Confirm `easydraftdocs.app` is attached and has a valid certificate
- [ ] Confirm `easydraftdocs.com` is attached and redirects to `.app`

---

## 🟠 End-to-end smoke test (~30 min, one person)

Run this once before showing the product to anyone external.

- [ ] Sign up as a new user → confirm you land on the Owner Portal billing section
- [ ] Start a 30-day free trial (no card required)
- [ ] Confirm $0 invoice email arrives from Stripe
- [ ] Confirm both **User workspace** and **Owner portal** tabs are visible
- [ ] Create one saved signature in the signature library
- [ ] Create one digital-signature profile with signer identity details
- [ ] Upload a PDF → add a signer → add a signature field → send
- [ ] During signing, select a **Reason for signing** and optional **Signing location**
- [ ] Open the signer token link in a private/incognito window → complete the field
- [ ] Download the signed PDF → open the completion certificate → verify the SHA-256 hash matches `sha256sum` output
- [ ] Invite a teammate → accept the invite → confirm workspace membership appears
- [ ] Cancel the trial from the billing portal
- [ ] Delete the test account and confirm the deletion cascade completes

---

## 🟡 Shortly after launch (pilot feedback phase)

### Monitoring

- [ ] Add Vercel log drains or connect a Sentry DSN for error tracking
- [ ] Watch the `document_notifications` table for rows with `status = 'failed'` — these are emails that didn't send
- [ ] The admin console shows `pendingNotifications` and `queuedProcessingJobs` counts — check these periodically

### Processor deployment (for sustained use)

- [ ] Decide how to deploy the document processor (`services/document-processor`) — options: Fly.io, Railway, Render, or cron-triggered function
- [ ] Until deployed, run manually when needed:
  ```bash
  npm run processor:run-queued
  npm run processor:run-notifications
  ```

### Product decisions

- [ ] Decide if you want to deploy the processor for notification retries and queued OCR / field-detection jobs, or handle these manually for the pilot
- [ ] Tighten the signer experience before showing to clients (current flow works but is clinical — see README item 7)
- [ ] The landing page needs to be sign-in and information only, then the homepage is either the client's desktop or the owner's area, depending on sign-in

---

## 🔵 Future / when demand is proven

- [ ] Wire certificate-backed PDF signing (PAdES/CAdES) — the TODO block in `renderDocumentExportToStorage` in `service.ts` describes exactly what to do; pick a provider (`easy_draft_remote`, `qualified_remote`, or `organization_hsm`)
- [ ] Add change-impact classification for edits after partial signing (`non_material` / `review_required` / `resign_required`)
- [ ] Upgrade rate limiting from single-instance in-memory to a shared/distributed store before heavier public traffic
- [ ] Collect Dropbox Sign credentials for when the integration is ready:
  - API key
  - client ID
  - client secret
  - webhook signing secret
  - Store in Vercel as: `DROPBOX_SIGN_API_KEY`, `DROPBOX_SIGN_CLIENT_ID`, `DROPBOX_SIGN_CLIENT_SECRET`, `DROPBOX_SIGN_WEBHOOK_SECRET`
