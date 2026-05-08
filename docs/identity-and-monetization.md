# Identity And Monetization

> Planning note: the live private-beta product currently uses the simpler `seats + shared external tokens` story shown in the app, guide, and README. The quota-based ideas below remain internal exploration, not current public pricing. The canonical implementation model is the target account/document model described in [target-model-rollout.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/target-model-rollout.md).

## Product recommendation

For this product, charge for internal team usage and workflow volume, not for external signers.

That means:

- `corporate_admin` and `corporate_member` account members count as paid corporate seats
- external signers and viewers from outside the account do not
- usage charges should track completed documents, OCR pages, and storage

This matches the customer value better than charging by raw recipient count and keeps the product feeling fair for multi-signer flows.

## How to store user info

### 1. Keep identity in Supabase Auth

Store the authentication identity in `auth.users` and keep product-facing profile data in EasyDraft's role-specific profile tables.

Official guidance from Supabase says Auth data lives in the Auth schema and that you should create your own `public` tables for API access and RLS-protected product data:

- https://supabase.com/docs/guides/auth/managing-user-data
- https://supabase.com/docs/guides/auth/users

### 2. Store only the data you need

Recommended user data split:

- `auth.users`: login identity, provider, email verification state
- `public.easydraft_user_profiles`: customer/product-user profile rows for individual users and team members
- `public.easydraft_staff_profiles`: internal EasyDraft staff profile rows
- `public.organizations`: parent account for individual or corporate customers
- `public.account_members`: canonical account membership and account class
- `public.account_invitations`: canonical pending and accepted account invitations
- `public.organization_license_assignments`: which purchased or trial seats are assigned, invited, suspended, or revoked
- `public.organization_account_events`: account-administration audit events such as primary account admin change and closure requests
- `public.document_participants`: canonical document mode and authority
- `public.document_participant_tokens`: canonical external signer token and verification state

Avoid storing more PII than necessary in v1.

Good defaults for v1:

- email
- display name
- company name
- timezone
- locale
- product update opt-in
- marketing opt-in

Do not collect:

- home address
- date of birth
- unnecessary phone numbers
- payment card details directly

Stripe should own card storage.

### 3. Use parent accounts for billing

Billing should attach to the customer account boundary, not an individual document and not an individual signer.

That gives you:

- one billing customer per individual or corporate account
- one subscription per account
- multiple internal members under the same paid corporate account
- a shared token pool that corporate administrators can monitor and top up
- room to support agencies, law firms, finance teams, and multi-department customers later

The repo now includes the base account/workspace tables in [20260330234500_identity_and_billing.sql](/home/adamgoodwin/code/Applications/Clean_pdf_build/supabase/migrations/20260330234500_identity_and_billing.sql) and the parent-organization layer in [20260409130000_organizations_parent_accounts.sql](/home/adamgoodwin/code/Applications/Clean_pdf_build/supabase/migrations/20260409130000_organizations_parent_accounts.sql).

### 4. Recommended account model

Use three account classes:

- `personal`: one user operating alone, with their own billing and private workspace
- `corporate_admin`: a corporate account administrator with account, member, billing, and lifecycle authority
- `corporate_member`: a corporate account member without account-owner authority

Use document modes for workflow participation:

- `initiator`: document originator or setup/admin participant
- `internal_signer`: authenticated EasyDraft signer
- `external_signer`: token-based guest signer

Use authority levels for document permission:

- `viewer`
- `signer`
- `document_admin`
- `org_admin_override`

Recommended hierarchy:

- `User`
- `Organization`
- `Workspace`
- `Document`

That means:

- users keep their own login identity
- corporate admins add or remove member access
- billing and shared token usage belong to the corporate account
- workspaces remain the operational container for document flows

### 5. Organization admin operating path

Corporate signup is a first-class path, not a profile fallback:

1. the user chooses an organization account
2. the signup form requires full name, organization name, role/title, work-domain email, and password
3. EasyDraft derives username, locale, and timezone metadata instead of asking for it up front
4. direct corporate signup rejects public email domains; public-email users can join corporate accounts by invitation only
5. Supabase Auth stores login identity and metadata
6. EasyDraft creates or resolves the role-specific profile row
7. the account boundary is a `corporate` organization with a stored `verified_email_domain`
8. the creator becomes `corporate_admin` in `account_members`
9. direct corporate signups start as `pending_verification`; invited users attach to the already verified organization
10. the user lands in the organization admin dashboard

Corporate signup security rules:

- an exact normalized corporate organization name can exist only once
- a verified corporate email domain can belong to only one corporate organization
- direct corporate signup proves inbox access, not organizational authority; new organizations remain pending until EasyDraft verifies the requester should administer that account
- pending corporate organizations cannot invite team members, change billing, buy token packs, create new documents, send workflows, or duplicate documents
- platform admins can activate pending corporate organizations from the admin console after verification
- invite-based signup attaches the user to the existing workspace and organization before the browser session is returned
- accepted invite recovery re-ensures organization membership so partial attachment cannot masquerade as success
- additional corporate admins are intentional: only an existing corporate admin can grant `corporate_admin` access

The organization admin dashboard should answer the operational questions immediately:

- account status
- current primary account admin
- plan and subscription status
- purchased seats, assigned seats, pending invited seats, available seats, and over-assignment
- token balance, tokens purchased, and tokens used
- member names, emails, roles, and license status
- pending invitations
- account events

Billing spend is intentionally narrower than people administration:

- `corporate_admin` can buy seats, open the billing portal, purchase token packs, manage people, change the primary corporate admin, and request account closure
- `corporate_member` can use assigned product access without account lifecycle authority

## Monetization model

### Recommendation for v1

Use a hybrid model:

- seat-based for internal users under a parent account
- plan quotas for workflow volume
- metered overages for OCR/storage if needed

This is the cleanest tradeoff between simplicity and margin protection.

### Why this works

Customers think in terms of:

- “How many people on my team need to prepare and manage documents?”
- “Can our company admin control access and billing in one place?”
- “How many documents do we send each month?”
- “How many scanned pages are we paying the system to process?”

They do not naturally think in terms of:

- API calls
- recipients per envelope
- compute-seconds

### Suggested plans

The migration seeds three starter plans:

- `starter`: $19/month, 1 internal seat, 75 completed docs, 500 OCR pages, 10 GB storage
- `team`: $79/month, 5 internal seats, 500 completed docs, 5,000 OCR pages, 50 GB storage
- `business`: $249/month, 20 internal seats, 2,500 completed docs, 25,000 OCR pages, 250 GB storage

These are intentionally conservative starting points, not final pricing.

### What to meter

Meter these events:

- completed document count
- OCR pages processed
- storage GB-month
- optional extra internal seats

Do not meter basic viewing, signer logins, or draft saves in v1.

## Stripe recommendation

Use Stripe Billing for subscriptions and overages.

Official Stripe docs say Stripe Checkout subscriptions support flat-rate, tiered, and usage-based pricing:

- https://docs.stripe.com/payments/subscriptions
- https://stripe.com/billing/pricing

As of March 30, 2026:

- Stripe Billing pay-as-you-go is listed at `0.7%` of Billing volume
- Stripe Payments online card pricing is listed at `2.9% + 30¢`

Source:

- https://stripe.com/billing/pricing

## Cost implications from your current stack

As of March 30, 2026:

- Supabase Pro is documented at `$25` per month, with `100,000` MAU included, `100 GB` storage included, and `2 million` Edge Function invocations included
- Supabase storage overage is documented at `$0.021` per GB-month
- Vercel Pro is listed at `$20/mo + additional usage`
- Vercel Functions pricing depends on active CPU, provisioned memory, and invocations

Sources:

- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://supabase.com/docs/guides/storage/management/pricing
- https://vercel.com/pricing
- https://vercel.com/docs/functions/usage-and-pricing

Inference:

Your biggest direct variable costs in early production are more likely to come from OCR/processing and storage than from normal signer traffic. That is why metering OCR pages and storage is smarter than metering signatures.

## Practical rollout plan

### Phase 1

- keep personal accounts and direct document access as-is
- create an individual or corporate account at signup
- create one primary workspace under that account
- attach Stripe customer and subscription to the account boundary
- track usage events in `billing_usage_events`

### Phase 2

- move documents under workspace ownership beneath the parent account
- add seat enforcement for corporate members
- add Stripe webhooks to sync subscription state
- expose shared token history and organization-wide admin visibility

### Phase 3

- add annual plans
- add usage-based OCR packs
- add higher-trust business features like custom branding, retention controls, and multi-workspace corporate accounts

## Implementation note

The most important billing rule is this:

bill for internal operator value, not external signer friction.

That keeps the product aligned with your “cheap, secure-feeling, easy-to-use” positioning instead of recreating the resentment users already have toward legacy PDF suites.
