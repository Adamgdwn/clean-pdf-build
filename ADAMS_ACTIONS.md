# Adam's Actions

Only the remaining tasks are listed here.
Anything already completed has been removed.

This is the owner checklist for a credible controlled launch, not the full product roadmap.

---

## Ship blockers

### Database and deploy state
- [ ] Apply the latest hosted Supabase migration:
  - `20260417120000_invite_and_signing_verification.sql`
- [ ] Apply the PDF signature migration:
  - `20260422100000_pdf_signature_paths.sql`
- [ ] Confirm production is running the current `main` build after this push.

### PDF signature rollout
- [ ] Create and keep private these Supabase Storage buckets:
  - `documents-unsigned`
  - `documents-signed`
  - `signatures`
- [ ] Set these Vercel env vars in Preview and Production:
  - `SUPABASE_UNSIGNED_DOCUMENT_BUCKET`
  - `SUPABASE_SIGNED_DOCUMENT_BUCKET`
  - `DOCUMENSO_API_BASE_URL`
  - `DOCUMENSO_API_KEY`
  - `DOCUMENSO_WEBHOOK_SECRET`
  - `P12_CERT_BASE64`
  - `P12_CERT_PASSPHRASE`
- [ ] In Documenso, create a webhook pointing to:
  - `https://easydraftdocs.app/api/documenso-webhook`
- [ ] Run the Path 1 smoke test:
  - upload with `Signature path = Path 1`
  - place a signature field
  - prepare the PDF
  - complete the document
  - generate the signed PDF
  - confirm the signed PDF comes from `documents-signed`
- [ ] Run the Path 2 smoke test:
  - upload with `Signature path = Path 2`
  - add an internal signer and one external signer
  - create the Documenso envelope
  - confirm the embedded signer session appears for the internal signer when applicable
  - confirm the external email invite arrives
  - complete the signing flow
  - confirm the final PDF is copied back into `documents-signed`
- [ ] Confirm the `Signature audit trail` panel shows expected `signature_events` rows for both Path 1 and Path 2

### Stripe
- [ ] Stripe Dashboard → Billing → enable `Send an invoice for free trials`
- [ ] Stripe Dashboard → Billing → enable `Send emails about upcoming renewals`
- [ ] Stripe Dashboard → Branding → upload logo, set brand colour, set business name
- [ ] Run one full checkout test with `4242 4242 4242 4242`
- [ ] Confirm the subscription appears correctly inside the app after checkout
- [ ] Open the billing portal and confirm it loads correctly
- [ ] Replay at least one Stripe test webhook event and confirm duplicate delivery does not duplicate billing state changes
- [ ] **Rotate the Stripe live key** — the old `sk_live_...` was in `.env`; roll it in the Stripe dashboard and update Vercel with the new one

### Supabase
- [ ] **Rotate the Supabase management API token** — the old `sbp_v0_...` was in `.env`; revoke it at supabase.com → account → Access Tokens and generate a fresh one only when needed for a migration task

### Processor (manual trigger)
- [ ] Set `EASYDRAFT_PROCESSOR_SECRET` in Vercel (Production + Preview) — any random string, e.g. `openssl rand -hex 32`
- [ ] Add the same value as a GitHub repo secret named `PROCESSOR_SECRET`:
  - GitHub → repository → Settings → Secrets and variables → Actions → New secret
- [ ] When needed: trigger from Actions UI (Actions → Processor run → Run workflow) and confirm the response is `ok: true`
- Note: no automatic schedule — add one to the workflow file when real notification retry volume justifies it

### Email and external signer flow
- [ ] Send one real `platform_managed` workflow to an external email address
- [ ] Confirm the workflow email arrives
- [ ] Confirm the signing link opens
- [ ] Confirm the signer can request the verification code email
- [ ] Confirm the verification code email arrives
- [ ] Confirm the signer can verify and complete the action successfully
- [ ] Confirm a completed signing link is no longer reusable
- [ ] Confirm reminder/resend still works for a pending external signer

### Domains and public trust routes
- [ ] Confirm `https://easydraftdocs.app` has a valid certificate in production
- [ ] Confirm `https://easydraftdocs.com` redirects to `.app`
- [ ] Run:

```bash
npm run smoke:public-routes -- https://easydraftdocs.app
```

- [ ] Confirm `/pricing`, `/privacy`, `/terms`, and `/security` all return `200`

### Alert routing (B4)
- [ ] In Sentry: add alert rule — any new error → email `admin@agoperations.ca`
- [ ] In Sentry: add alert rule — error rate spike (> 5 events / 5 min) → same email
- [ ] Assign named owners in `docs/operator-runbook.md` for: failed notifications, stuck jobs, deploy smoke checks

### Full owner smoke test
- [ ] Sign up as a brand-new owner account and confirm landing in the owner/admin experience
- [ ] Visit `/pricing` while signed out and confirm pricing + CTA behavior is clear
- [ ] Create a saved signature
- [ ] Upload a PDF
- [ ] Add a signer
- [ ] Place a field
- [ ] Send the workflow
- [ ] Complete the signing flow in a private window
- [ ] Download the signed PDF
- [ ] Verify the SHA-256 value matches local `sha256sum`
- [ ] Invite a teammate
- [ ] Accept the invite with the invited email and confirm workspace membership attaches correctly
- [ ] Try the invite with the wrong signed-in email and confirm it is blocked clearly
- [ ] If the test user has multiple workspaces, switch workspaces and confirm documents, billing, and team data all rescope correctly
- [ ] Purchase tokens and confirm the balance updates correctly
- [ ] Delete a test account and confirm deletion completes cleanly

---

## Fix Before Broader Launch

- [ ] Strengthen executed-record durability for completed workflows
- [ ] Review privacy, terms, and security copy with founder/legal eyes before broader selling
- [ ] Add automated integration or E2E coverage for:
  - invite acceptance (happy path + wrong-email + expired-token)
  - external signer verification (OTP gate, superseded link, replayed link)
  - billing checkout and webhook idempotency

---

## Not Required For Controlled Launch

- [ ] Extract the remaining workflow panels from `App.tsx`
- [ ] Surface token history in billing
- [ ] Add stronger trial-end conversion messaging
- [ ] Integrate certificate-backed PDF signing

Reference:

- [docs/pdf-signature-rollout.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/pdf-signature-rollout.md)
