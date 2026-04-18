# Adam's Actions

Only the remaining tasks are listed here.
Anything already completed has been removed.

This is the owner checklist for a credible controlled launch, not the full product roadmap.

---

## Ship blockers

### Database and deploy state
- [ ] Apply the latest hosted Supabase migration:
  - `20260417120000_invite_and_signing_verification.sql`
- [ ] Confirm production is running the current `main` build after the launch-hardening push.

### Stripe
- [ ] Stripe Dashboard → Billing → enable `Send an invoice for free trials`
- [ ] Stripe Dashboard → Billing → enable `Send emails about upcoming renewals`
- [ ] Stripe Dashboard → Branding → upload logo, set brand colour, set business name
- [ ] Run one full checkout test with `4242 4242 4242 4242`
- [ ] Confirm the subscription appears correctly inside the app after checkout
- [ ] Open the billing portal and confirm it loads correctly
- [ ] Replay at least one Stripe test webhook event and confirm duplicate delivery does not duplicate billing state changes

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

### Ops and ownership
- [ ] Decide the production processor runtime:
  - durable scheduled/container deployment
  - or explicitly limited manual controlled-launch operation
- [ ] If shipping beyond very light pilot usage, deploy the processor on a durable schedule/container
- [ ] Assign an owner for:
  - failed notifications
  - stuck processing jobs
  - deploy smoke checks
- [ ] Run the operator daily checks once from the current production environment and confirm the response path is clear

---

## Fix Before Broader Launch

- [ ] Strengthen executed-record durability for completed workflows
- [ ] Review privacy, terms, and security copy with founder/legal eyes before broader selling
- [ ] Add automated integration or E2E coverage for:
  - invite acceptance
  - external signer verification
  - billing checkout and webhook update flow

---

## Not Required For Controlled Launch

- [ ] Extract the remaining workflow panels from `App.tsx`
- [ ] Surface token history in billing
- [ ] Add stronger trial-end conversion messaging
- [ ] Integrate certificate-backed PDF signing
