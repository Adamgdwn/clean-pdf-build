# Identity And Monetization

## Product recommendation

For this product, charge for internal team usage and workflow volume, not for external signers.

That means:

- owners, editors, and billing admins count as paid seats
- signers and viewers from outside the workspace do not
- usage charges should track completed documents, OCR pages, and storage

This matches the customer value better than charging by raw recipient count and keeps the product feeling fair for multi-signer flows.

## How to store user info

### 1. Keep identity in Supabase Auth

Store the authentication identity in `auth.users` and keep only product-facing profile data in `public.profiles`.

Official guidance from Supabase says Auth data lives in the Auth schema and that you should create your own `public` user table for API access and RLS-protected product data:

- https://supabase.com/docs/guides/auth/managing-user-data
- https://supabase.com/docs/guides/auth/users

### 2. Store only the data you need

Recommended user data split:

- `auth.users`: login identity, provider, email verification state
- `public.profiles`: display name, avatar URL, company name, locale, timezone, opt-in flags
- `public.organizations`: parent account for individual or corporate customers
- `public.organization_memberships`: which organization the user belongs to and their account role
- `public.workspace_memberships`: which workspace the user belongs to and their workspace role
- `public.document_access`: document-level access for owner, editor, signer, viewer

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

Use two account types:

- `individual`: one user operating alone, with their own billing and private workspace
- `corporate`: a parent account that owns billing, members, and shared external signer tokens

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
