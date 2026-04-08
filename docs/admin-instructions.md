# Administration Instructions

This guide covers the current admin and operator workflow for EasyDraft.

Use this guide if you are responsible for:

- platform admin access
- test-user management
- billing setup
- production configuration
- operational checks before broader rollout

## What the admin layer does today

Current admin and operator capabilities include:

- viewing admin metrics
- switching between user workspace and owner portal
- reviewing account status
- sending tester invite emails
- checking privilege visibility
- sending password reset emails
- deleting test users when allowed
- reviewing workspace and subscription placeholders

Billing is present in the product, but it is still safe to operate in placeholder mode until the Stripe account is ready.

## Admin access

Admin access uses the same sign-in form as regular users.

Current admin email:

- `admin@agoperations.ca`

Required environment setting:

- `EASYDRAFT_ADMIN_EMAILS`

Before relying on admin tools, confirm that the admin email is included in that environment variable.

## Admin console areas

The current admin console provides:

- total users
- pending notifications
- total workspaces
- total documents
- recent workspaces
- tester invite form
- account list
- account confirmation status
- privilege labels
- password reset action
- delete control for test cleanup where allowed

Use the refresh action in the admin console after operational changes if the data looks stale.

## Recommended admin smoke test

1. Sign in as the admin user.
2. Confirm the admin console appears.
3. Confirm the owner portal appears and the company dashboard loads.
3. Send one tester invite email.
4. Confirm the metrics render without errors.
5. Confirm at least one non-admin owner and one signer account exist.
6. Trigger one password reset for a test account.
7. Confirm test-user deletion works only where expected.

## Tester invitation flow

Current recommended tester onboarding flow:

1. Use the admin console `Invite testers` form.
2. Supabase Auth sends the invite email.
3. The tester follows the invite, creates their account, and lands back in EasyDraft.
4. The tester fills in profile details inside the app.
5. Any pending document collaborator or signer access for that same email attaches automatically after sign-in.

Important distinction:

- Supabase Auth handles tester invite and account emails
- EasyDraft workflow emails use the configured SMTP or Resend provider when enabled

## Billing status

Current billing state:

- app billing UI exists
- checkout and billing portal flows exist
- placeholder mode is acceptable for testing
- live Stripe should not be considered ready until account setup is finished

Relevant endpoints:

- [billing-overview.ts](/home/adamgoodwin/code/Applications/Clean_pdf_build/apps/web/api/billing-overview.ts)
- [billing-checkout.ts](/home/adamgoodwin/code/Applications/Clean_pdf_build/apps/web/api/billing-checkout.ts)
- [billing-portal.ts](/home/adamgoodwin/code/Applications/Clean_pdf_build/apps/web/api/billing-portal.ts)
- [stripe-webhook.ts](/home/adamgoodwin/code/Applications/Clean_pdf_build/apps/web/api/stripe-webhook.ts)

## Stripe setup checklist

To move from tester mode toward a marketable paid product:

1. Create or finalize the Stripe account.
2. Complete business profile and payout setup.
3. Decide the initial plan structure and pricing copy.
4. Add these production secrets to Vercel:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
5. Create the webhook endpoint:
   - `https://easydraftdocs.app/api/stripe-webhook`
6. Subscribe the webhook to the current required events.
7. Run one checkout test and one billing portal test.

Reference:

- [go-live-checklist.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/go-live-checklist.md)
- [identity-and-monetization.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/identity-and-monetization.md)

## Supabase and environment checks

Confirm these remain correct in preview and production:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DOCUMENT_BUCKET`
- `SUPABASE_SIGNATURE_BUCKET`
- `EASYDRAFT_ADMIN_EMAILS`
- `EASYDRAFT_APP_ORIGIN`

Also confirm:

- Auth `site_url` is correct
- redirect allow-lists are correct
- the `documents` bucket is private
- the `signatures` bucket is private
- all migrations are applied

## Workflow operations to validate

For production confidence, admins or operators should test:

- upload and preview
- owner portal and user workspace switching
- saved signature creation
- digital-signature profile creation
- internal-use-only flow
- self-managed flow
- platform-managed flow
- sequential routing
- parallel routing
- staged routing
- approvals
- due dates and overdue visibility
- request changes
- reject
- cancel
- participant reassignment
- lock and reopen
- audit trail
- version history
- signing reason and optional signing location captured at signing time

## Notifications and email delivery

Current notification behavior:

- managed signer notifications are queued only in `platform_managed`
- originator progress updates are queued on completion events when enabled
- workflow updates such as changes requested or rejection can notify the initiator

If enabling live email delivery, configure:

- `EASYDRAFT_EMAIL_PROVIDER`
- `EASYDRAFT_NOTIFICATION_FROM_EMAIL`
- `EASYDRAFT_NOTIFICATION_FROM_NAME`
- `RESEND_API_KEY` if the provider is `resend`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASSWORD` if the provider is `smtp`

Then send a real test notification and verify:

- deliverability
- the document link opens correctly
- email wording is acceptable for testers

## Google Workspace SMTP setup

Current recommended setup for `agoperations.ca`:

- use Google Workspace SMTP
- use `admin@agoperations.ca` as the first sender mailbox
- use one mail system for both Supabase Auth emails and EasyDraft workflow emails

Google Workspace SMTP values:

- host: `smtp.gmail.com`
- port: `587`
- secure: `false`
- username: `admin@agoperations.ca`
- password: Google app password for that mailbox

Important rules:

- do not use the normal Gmail password
- turn on 2-Step Verification for `admin@agoperations.ca`
- generate a Google app password and use that as the SMTP password

### Copy-paste Vercel env block

Use these values in Vercel for EasyDraft workflow emails:

```bash
EASYDRAFT_EMAIL_PROVIDER=smtp
EASYDRAFT_NOTIFICATION_FROM_EMAIL=admin@agoperations.ca
EASYDRAFT_NOTIFICATION_FROM_NAME=EasyDraft
EASYDRAFT_NOTIFICATION_REPLY_TO=admin@agoperations.ca
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=admin@agoperations.ca
SMTP_PASSWORD=replace-with-google-app-password
EASYDRAFT_ADMIN_EMAILS=admin@agoperations.ca
EASYDRAFT_APP_ORIGIN=https://easydraftdocs.app
```

If you prefer SMTPS instead of STARTTLS, you can use:

- `SMTP_PORT=465`
- `SMTP_SECURE=true`

### Supabase Auth email setup

To send invites, confirmations, and password resets through the same Gmail mailbox:

1. Open Supabase `Authentication -> Email`.
2. Enable custom SMTP.
3. Set sender email to `admin@agoperations.ca`.
4. Set sender name to `EasyDraft`.
5. Set host to `smtp.gmail.com`.
6. Set port to `587`.
7. Set username to `admin@agoperations.ca`.
8. Set password to the same Google app password used in Vercel.
9. Set `site_url` to your live EasyDraft domain.
10. Confirm redirect URLs include your live domain.

Pilot recommendation:

- keep email confirmation off if you want testers in the app immediately after signup
- keep it on only if you want stricter invite and confirmation control

### First live test sequence

After the Gmail SMTP values are saved in both Vercel and Supabase:

1. Send yourself a tester invite from the admin console.
2. Confirm the Supabase invite email arrives.
3. Sign up or sign in with the invited email.
4. Upload a document.
5. Add a signer using a real test email.
6. Send a `platform_managed` workflow.
7. Confirm the workflow email arrives.
8. Open the document from the email link.
9. Complete the action and confirm the workflow advances.
10. Confirm the notification record shows as sent in EasyDraft.

## Test-user and pilot management

For the free tester month, keep operations lightweight and controlled.

Recommended setup:

- one admin account
- one owner account
- one editor account
- one internal signer
- one external signer

Recommended process:

- keep a simple tester spreadsheet
- note account email, company, role, and status
- track major issues found during the pilot
- use password reset instead of ad hoc account workarounds
- delete stale test accounts when you want a clean testing pool

## Current product boundaries

Admins should communicate these clearly during the pilot:

- billing may still be in placeholder mode
- live email delivery may not be enabled yet
- third-party certificate-backed signing is not yet integrated
- change-impact handling after partial completion is still a next-step feature

That positioning helps keep tester expectations aligned with the current stage of the product.

## Marketability tasks for operations

To make the product more market-ready, operators should prioritize:

- finalizing Stripe account setup
- deciding the free 30-day tester offer terms
- preparing simple pricing copy
- preparing tester onboarding email copy
- validating the core workflow paths with real users
- only enabling paid billing after the tester path feels dependable

## Related references

- [README.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/README.md)
- [go-live-checklist.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/go-live-checklist.md)
- [deployment.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/deployment.md)
- [identity-and-monetization.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/identity-and-monetization.md)
