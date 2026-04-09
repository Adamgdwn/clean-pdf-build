# Adam's Actions

Everything below must be done before active selling begins.
This is the short owner checklist, not the full product roadmap.

---

## Outstanding before launch

### Supabase
- [x] ~~`npx supabase db push`~~ — all 4 pending migrations applied via Management API
- [x] Auth `site_url` = `https://easydraftdocs.app` ✓ confirmed
- [x] Redirect allow-list includes both `.app/**` and `.com/**` ✓ confirmed
- [x] `documents` bucket is **private** ✓ confirmed

### Vercel — environment variables
All of the following are confirmed in Production:
- [x] `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` + `VITE_SUPABASE_DOCUMENT_BUCKET`
- [x] `SUPABASE_URL` + `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY`
- [x] `SUPABASE_DOCUMENT_BUCKET` + `SUPABASE_SIGNATURE_BUCKET`
- [x] `EASYDRAFT_ADMIN_EMAILS` + `EASYDRAFT_APP_ORIGIN`
- [x] `EASYDRAFT_REQUIRE_STRIPE=true` + `EASYDRAFT_REQUIRE_EMAIL_DELIVERY=true` — added
- [x] `EASYDRAFT_PROCESSOR_SECRET` — generated and added
- [x] `STRIPE_SECRET_KEY` (live) + `STRIPE_WEBHOOK_SECRET`

### Stripe
- [x] Live mode ✓ confirmed
- [x] Webhook → `https://easydraftdocs.app/api/stripe-webhook` ✓ confirmed (all 6 events)
- [x] Customer portal ✓ confirmed active (cancellation + payment method updates enabled)
- [ ] **Dashboard → Billing → enable "Send an invoice for free trials"** (must do manually)
- [ ] **Dashboard → Billing → enable "Send emails about upcoming renewals"** (must do manually — critical)
- [ ] **Dashboard → Branding** — upload logo, set brand colour and business name
- [ ] Run one full checkout test (card `4242 4242 4242 4242`) and confirm subscription appears in the app

### Email
- [ ] Send one real platform-managed workflow to an external address and confirm the email arrives and the signing link opens

### Domains
- [ ] `easydraftdocs.app` attached with valid certificate
- [ ] `easydraftdocs.com` redirects to `.app`

### End-to-end smoke test (~30 min)
Run this once before showing the product to anyone:
- [ ] Sign up as a new user → confirm landing in Owner Portal
- [ ] Visit `/pricing` unauthenticated → confirm pricing copy and CTA route correctly
- [ ] Start a free trial → confirm $0 invoice email arrives from Stripe
- [ ] Create a saved signature, upload a PDF, add a signer, place a field, send
- [ ] Open signing link in private window → complete the field
- [ ] Download signed PDF → verify SHA-256 hash matches `sha256sum` output
- [ ] Invite a teammate → accept invite → confirm workspace membership
- [ ] If the user belongs to more than one workspace, switch workspaces and confirm the documents, billing, and team data change together
- [ ] Purchase tokens → confirm balance updates
- [ ] Cancel trial from billing portal
- [ ] Delete test account → confirm deletion completes

---

## Next build phase

These are the next product loops to close after launch configuration is done:

- [ ] Publish privacy policy
- [ ] Publish terms of service
- [ ] Add security/privacy summary for prospects
- [ ] Surface token history in billing
- [ ] Add stronger trial-end conversion messaging
- [ ] Move rate limiting to a shared/distributed implementation
- [ ] Deploy OCR/notification processor on a durable schedule
- [ ] Evaluate certificate-backed PDF signing only after customer demand is proven
