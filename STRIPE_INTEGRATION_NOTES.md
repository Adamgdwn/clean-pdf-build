# Stripe Integration Notes

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | Yes (for live billing) | Stripe secret key (`sk_live_…` or `sk_test_…`). If absent, the app runs in **placeholder mode** — no charges, unlimited tokens, gates are open. |
| `STRIPE_WEBHOOK_SECRET` | Yes (for live billing) | Webhook signing secret from the Stripe dashboard endpoint (`whsec_…`). If absent, all webhooks are accepted without verification and idempotency is bypassed. |

All other env vars (`SUPABASE_*`, `EASYDRAFT_*`) are documented in `packages/workflow-service/src/env.ts`.

---

## Stripe Objects Expected

### Products / Prices

This integration uses **inline `price_data`** in every Checkout Session, so you do **not** need to pre-create Price or Product objects in Stripe.

The product names that will appear in the Stripe dashboard after first use:

| Product name | Type | Price |
|---|---|---|
| `EasyDraftDocs - Team` | Recurring subscription | $12 CAD / seat / month |
| `EasyDraftDocs External Signer Tokens` | One-time payment | $12 CAD per bundle |

### Customer Portal

The Stripe **Customer Portal** must be enabled and configured in your Stripe dashboard under:  
`Settings → Billing → Customer portal`

Minimum recommended configuration: allow cancellation, allow payment method updates.

---

## Webhook Events Handled

Register a single webhook endpoint in Stripe pointing to:

- **Vercel (production):** `https://<your-domain>/api/stripe-webhook`
- **Local (via Stripe CLI):** see Local Testing section below

| Event | Action |
|---|---|
| `checkout.session.completed` (subscription) | Upserts `workspace_billing_customers`, then fetches and upserts the subscription record |
| `checkout.session.completed` (one-time payment) | Credits 12 external signer tokens to the workspace via `billing_usage_events` |
| `customer.subscription.created` | Upserts subscription record |
| `customer.subscription.updated` | Upserts subscription record (handles seat changes, cancellations, renewals) |
| `customer.subscription.deleted` | Marks subscription as `canceled` |
| `invoice.paid` | Re-fetches and upserts subscription record (belt-and-suspenders for renewal) |
| `invoice.payment_failed` | Re-fetches and upserts subscription record (captures `past_due` status) |

All events are processed **idempotently** via the `stripe_processed_events` table. Duplicate deliveries are safely ignored.

---

## How Seat Sync Works

1. At checkout, the user selects a seat count (minimum 1). This is passed as `quantity` to `stripe.checkout.sessions.create`.
2. Stripe stores the quantity on the Subscription item.
3. On `customer.subscription.created/updated` webhooks, `subscription.items.data[0].quantity` is synced to `workspace_subscriptions.seat_count`.
4. Seat changes (upgrades/downgrades) go through the Customer Portal — Stripe fires `customer.subscription.updated` which re-syncs the count.
5. `seat_count` is displayed in the Billing Panel. The monthly cost shown in the UI is `seat_count × $12 CAD`.

There is currently **no server-side enforcement** that `seat_count` matches actual workspace member count. That is intentional — the launch model trusts the customer to select the correct number of seats.

---

## How Token Crediting and Consumption Works

### Crediting (purchase)

1. User clicks **"Buy 12 tokens — $12 CAD"** in the Billing Panel.
2. App calls `POST /billing-token-checkout` → creates a Stripe one-time Checkout Session (`mode: 'payment'`) with `metadata.checkout_type = 'token_purchase'`.
3. User completes payment in Stripe Checkout.
4. Stripe fires `checkout.session.completed` with `payment_status = 'paid'`.
5. Webhook handler inserts a `billing_usage_events` row:
   - `meter_key = 'external_token_credit'`
   - `quantity = 12`
   - `metadata.stripe_event_id` for traceability
6. Token balance updates immediately on next billing overview fetch.

**Tokens are credited by webhook only** — not from the client-side success redirect. This prevents crediting before payment is confirmed.

### Consumption (send)

1. When a platform-managed document is sent (or reminded) with external signers, `assertWorkspaceHasSigningTokens()` is called.
2. It computes available tokens = `sum(external_token_credit)` − `sum(signing_token usage)` from `billing_usage_events`.
3. If insufficient, an HTTP 402 error is returned with a clear message.
4. If sufficient, one `signing_token` usage event is inserted per external signer (already implemented in `service.ts`).

### Token Balance Formula

```
available = sum(billing_usage_events WHERE meter_key = 'external_token_credit')
          − sum(billing_usage_events WHERE meter_key = 'signing_token')
```

Both sums are **all-time** (tokens do not expire or reset per billing period). Tokens are a prepaid balance that accumulates across purchases.

### Rules

- Internal-only workflows do not consume tokens.
- `internal_use_only` delivery mode never calls `assertWorkspaceHasSigningTokens()`.
- Only workspaces with an `active` or `trialing` subscription can purchase tokens.
- Placeholder mode (no `STRIPE_SECRET_KEY`) bypasses all token and subscription gates.

---

## Local Testing Steps

### Prerequisites

- [Stripe CLI](https://stripe.com/docs/stripe-cli) installed and authenticated (`stripe login`)
- Local dev server running (`npm run dev` in repo root)

### Steps

1. **Set env vars** in your local `.env` (or equivalent):
   ```
   STRIPE_SECRET_KEY=sk_test_…
   STRIPE_WEBHOOK_SECRET=whsec_…  # (set after step 2)
   ```

2. **Forward webhooks** with the Stripe CLI:
   ```bash
   stripe listen --forward-to localhost:4000/stripe-webhook
   ```
   Copy the `whsec_…` signing secret printed by the CLI and set it as `STRIPE_WEBHOOK_SECRET`.

3. **Test subscription checkout:**
   - Open the app, go to Billing.
   - Enter seat count, click Subscribe.
   - Use Stripe test card `4242 4242 4242 4242`, any future expiry, any CVC.
   - On success, the CLI terminal shows `checkout.session.completed` followed by `customer.subscription.created`.
   - Refresh the app — the Billing Panel should show the active subscription.

4. **Test token purchase:**
   - With an active subscription, click **"Buy 12 tokens — $12 CAD"**.
   - Complete checkout with the test card.
   - CLI shows `checkout.session.completed` with `checkout_type=token_purchase`.
   - Refresh — token balance should show 12 available.

5. **Test token consumption:**
   - Create a platform-managed document with an external signer.
   - Send the document — 1 token is consumed.
   - Refresh Billing — available tokens should decrease by 1.

6. **Test payment failure:**
   - Use test card `4000 0000 0000 0341` (card always declines after attaching).
   - Invoice payment failure fires `invoice.payment_failed` → subscription status becomes `past_due`.

7. **Test idempotency:**
   - Run `stripe events resend <event_id>` for a `checkout.session.completed` event that already credited tokens.
   - Tokens should **not** be double-credited — the `stripe_processed_events` table blocks the second insert.
