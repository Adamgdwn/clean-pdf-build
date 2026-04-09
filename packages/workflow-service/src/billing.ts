import Stripe from "stripe";
import { z } from "zod";

import { getCanonicalAppOrigin, readServerEnv, shouldRequireStripe } from "./env.js";
import { AppError } from "./errors.js";
import {
  resolveAuthenticatedUser,
  resolveWorkspaceForUser,
  type AuthenticatedUser,
} from "./service.js";
import { createServiceRoleClient } from "./supabase.js";

// ---------------------------------------------------------------------------
// Internal row types
// ---------------------------------------------------------------------------

type BillingPlanRow = {
  key: string;
  name: string;
  monthly_price_usd: number; // stored as CAD whole-dollar amount per the new model
  billing_interval: "month" | "year";
  included_internal_seats: number;
  included_completed_docs: number;
  included_ocr_pages: number;
  included_storage_gb: number;
  included_signing_tokens: number;
  active: boolean;
};

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  workspace_type: "personal" | "team";
  owner_user_id: string;
  billing_email: string | null;
};

type WorkspaceMembershipRow = {
  workspace_id: string;
  user_id: string;
  role: "owner" | "admin" | "member" | "billing_admin";
};

type WorkspaceBillingCustomerRow = {
  id: string;
  workspace_id: string;
  provider_customer_id: string | null;
  billing_email: string | null;
};

type WorkspaceSubscriptionRow = {
  id: string;
  workspace_id: string;
  provider_subscription_id: string | null;
  billing_plan_key: string;
  status: string;
  seat_count: number;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  trial_ends_at: string | null;
  updated_at: string;
};

function getPlanMonthlyEquivalentCad(plan: Pick<BillingPlanRow, "monthly_price_usd" | "billing_interval">) {
  return plan.billing_interval === "year" ? plan.monthly_price_usd / 12 : plan.monthly_price_usd;
}

function comparePlans(left: BillingPlanRow, right: BillingPlanRow) {
  if (left.billing_interval !== right.billing_interval) {
    return left.billing_interval === "month" ? -1 : 1;
  }

  return left.monthly_price_usd - right.monthly_price_usd;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const subscriptionCheckoutInputSchema = z.object({
  planKey: z.string().min(1).default("easydraft_team"),
  seatCount: z.number().int().min(1).max(500).default(1),
});

// ---------------------------------------------------------------------------
// Stripe client
// ---------------------------------------------------------------------------

let cachedStripeClient: Stripe | null = null;

function isStripeConfigured() {
  const env = readServerEnv();
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

function assertStripeConfigurationReady() {
  const env = readServerEnv();

  if (isStripeConfigured()) {
    return true;
  }

  if (!shouldRequireStripe(env)) {
    return false;
  }

  throw new AppError(
    503,
    "Stripe billing is required in this environment. Configure STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.",
  );
}

function getStripeClient() {
  const env = readServerEnv();

  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError(
      503,
      "Stripe is not configured yet. Add STRIPE_SECRET_KEY to your environment.",
    );
  }

  if (!cachedStripeClient) {
    cachedStripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  }

  return cachedStripeClient;
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

function requireBillingPermission(membership: WorkspaceMembershipRow | null) {
  if (!membership || !["owner", "admin", "billing_admin"].includes(membership.role)) {
    throw new AppError(403, "You do not have permission to manage billing for this workspace.");
  }
}

// ---------------------------------------------------------------------------
// Workspace helpers
// ---------------------------------------------------------------------------

async function getBillingWorkspaceForUser(
  user: AuthenticatedUser,
  preferredWorkspaceId?: string | null,
) {
  const workspace = (await resolveWorkspaceForUser(user, preferredWorkspaceId)) as WorkspaceRow;
  const adminClient = createServiceRoleClient();
  const { data: membership, error: membershipError } = await adminClient
    .from("workspace_memberships")
    .select("workspace_id, user_id, role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    throw new AppError(500, membershipError.message);
  }

  return {
    workspace,
    membership: (membership ?? null) as WorkspaceMembershipRow | null,
  };
}

async function listActivePlans() {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("billing_plans")
    .select(
      "key, name, monthly_price_usd, billing_interval, included_internal_seats, included_completed_docs, included_ocr_pages, included_storage_gb, included_signing_tokens, active",
    )
    .eq("active", true);

  if (error) {
    throw new AppError(500, error.message);
  }

  return ((data ?? []) as BillingPlanRow[]).sort(comparePlans);
}

async function getLatestSubscriptionForWorkspace(workspaceId: string) {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("workspace_subscriptions")
    .select(
      "id, workspace_id, provider_subscription_id, billing_plan_key, status, seat_count, current_period_start, current_period_end, cancel_at_period_end, trial_ends_at, updated_at",
    )
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new AppError(500, error.message);
  }

  return ((data ?? [])[0] ?? null) as WorkspaceSubscriptionRow | null;
}

async function countWorkspaceMembers(workspaceId: string) {
  const adminClient = createServiceRoleClient();
  const { count, error } = await adminClient
    .from("workspace_memberships")
    .select("*", { head: true, count: "exact" })
    .eq("workspace_id", workspaceId);

  if (error) {
    throw new AppError(500, error.message);
  }

  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Stripe customer management
// ---------------------------------------------------------------------------

async function getOrCreateStripeCustomer(workspace: WorkspaceRow, user: AuthenticatedUser) {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("workspace_billing_customers")
    .select("id, workspace_id, provider_customer_id, billing_email")
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (error) {
    throw new AppError(500, error.message);
  }

  const existingCustomer = (data ?? null) as WorkspaceBillingCustomerRow | null;

  if (existingCustomer?.provider_customer_id) {
    return existingCustomer.provider_customer_id;
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email: workspace.billing_email ?? user.email,
    name: workspace.name,
    metadata: {
      workspace_id: workspace.id,
      workspace_slug: workspace.slug,
      owner_user_id: workspace.owner_user_id,
    },
  });

  const payload = {
    workspace_id: workspace.id,
    provider: "stripe",
    provider_customer_id: customer.id,
    billing_email: workspace.billing_email ?? user.email,
  };

  if (existingCustomer) {
    const { error: updateError } = await adminClient
      .from("workspace_billing_customers")
      .update(payload)
      .eq("id", existingCustomer.id);

    if (updateError) {
      throw new AppError(500, updateError.message);
    }
  } else {
    const { error: insertError } = await adminClient
      .from("workspace_billing_customers")
      .insert(payload);

    if (insertError) {
      throw new AppError(500, insertError.message);
    }
  }

  return customer.id;
}

// ---------------------------------------------------------------------------
// Subscription helpers
// ---------------------------------------------------------------------------

function formatStripeTimestamp(timestamp: number | null) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}

async function upsertSubscriptionRecord(
  workspaceId: string,
  subscription: Stripe.Subscription,
  fallbackPlanKey: string,
) {
  const adminClient = createServiceRoleClient();
  const primaryItem = subscription.items.data[0];
  const seatCount = primaryItem?.quantity ?? 1;
  const billingPlanKey = subscription.metadata.plan_key || fallbackPlanKey;
  const existing = await getLatestSubscriptionForWorkspace(workspaceId);

  const payload = {
    workspace_id: workspaceId,
    provider: "stripe",
    provider_subscription_id: subscription.id,
    billing_plan_key: billingPlanKey,
    status: subscription.status,
    seat_count: seatCount,
    current_period_start: formatStripeTimestamp(primaryItem?.current_period_start ?? null),
    current_period_end: formatStripeTimestamp(primaryItem?.current_period_end ?? null),
    cancel_at_period_end: subscription.cancel_at_period_end,
    trial_ends_at: formatStripeTimestamp(subscription.trial_end),
  };

  if (existing) {
    const { error } = await adminClient
      .from("workspace_subscriptions")
      .update(payload)
      .eq("id", existing.id);

    if (error) {
      throw new AppError(500, error.message);
    }

    return;
  }

  const { error } = await adminClient.from("workspace_subscriptions").insert(payload);

  if (error) {
    throw new AppError(500, error.message);
  }
}

async function lookupWorkspaceIdForCustomer(customerId: string) {
  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from("workspace_billing_customers")
    .select("workspace_id")
    .eq("provider_customer_id", customerId)
    .maybeSingle();

  if (error) {
    throw new AppError(500, error.message);
  }

  return (data?.workspace_id ?? null) as string | null;
}

// ---------------------------------------------------------------------------
// External token balance (prepaid model)
//
// Balance = sum of all "external_token_credit" usage events
//           minus sum of all "signing_token" (usage) events
// Both are all-time totals — tokens do not expire or reset per period.
// ---------------------------------------------------------------------------

async function computeExternalTokenBalance(workspaceId: string) {
  const adminClient = createServiceRoleClient();

  const [creditResult, usageResult] = await Promise.all([
    adminClient
      .from("billing_usage_events")
      .select("quantity")
      .eq("workspace_id", workspaceId)
      .eq("meter_key", "external_token_credit"),
    adminClient
      .from("billing_usage_events")
      .select("quantity")
      .eq("workspace_id", workspaceId)
      .eq("meter_key", "signing_token"),
  ]);

  const purchased = (creditResult.data ?? []).reduce(
    (sum: number, row: { quantity: number }) => sum + (row.quantity ?? 0),
    0,
  );
  const used = (usageResult.data ?? []).reduce(
    (sum: number, row: { quantity: number }) => sum + (row.quantity ?? 0),
    0,
  );

  return {
    available: Math.max(0, purchased - used),
    used,
    purchased,
  };
}

// Exported function consumed by service.ts to gate external sends.
export async function getWorkspaceSigningTokenBalance(workspaceId: string) {
  const { available, purchased } = await computeExternalTokenBalance(workspaceId);
  return { available, includedInPlan: purchased };
}

// ---------------------------------------------------------------------------
// Webhook idempotency
// ---------------------------------------------------------------------------

/**
 * Attempts to mark a Stripe event as processed.
 * Returns true if this is the first time we've seen this event (safe to process).
 * Returns false if it was already processed (skip to avoid double-crediting).
 */
async function markStripeEventProcessed(
  eventId: string,
  eventType: string,
  workspaceId: string | null,
): Promise<boolean> {
  const adminClient = createServiceRoleClient();
  const { error } = await adminClient.from("stripe_processed_events").insert({
    stripe_event_id: eventId,
    event_type: eventType,
    workspace_id: workspaceId,
  });

  // Unique constraint violation = already processed
  if (error) {
    if (error.code === "23505") {
      return false;
    }

    throw new AppError(500, `Failed to record Stripe event: ${error.message}`);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Public API: billing overview
// ---------------------------------------------------------------------------

export async function getBillingOverviewForAuthorizationHeader(
  authorizationHeader: string | undefined,
  preferredWorkspaceId?: string | null,
) {
  const stripeReady = isStripeConfigured();
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace, membership } = await getBillingWorkspaceForUser(user, preferredWorkspaceId);

  const [plans, subscription, internalMemberCount] = await Promise.all([
    listActivePlans(),
    getLatestSubscriptionForWorkspace(workspace.id),
    countWorkspaceMembers(workspace.id),
  ]);

  const tokenBalance = await computeExternalTokenBalance(workspace.id);

  return {
    billingMode: stripeReady ? ("live" as const) : ("placeholder" as const),
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      workspaceType: workspace.workspace_type,
      membershipRole: membership?.role ?? null,
      internalMemberCount,
    },
    subscription: subscription
      ? {
          planKey: subscription.billing_plan_key,
          status: subscription.status,
          seatCount: subscription.seat_count,
          currentPeriodEnd: subscription.current_period_end,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          trialEndsAt: subscription.trial_ends_at ?? null,
        }
      : null,
    externalTokens: {
      available: tokenBalance.available,
      used: tokenBalance.used,
      purchased: tokenBalance.purchased,
    },
    plans: plans.map((plan) => ({
      key: plan.key,
      name: plan.name,
      priceCad: plan.monthly_price_usd,
      billingInterval: plan.billing_interval,
      monthlyEquivalentPriceCad: getPlanMonthlyEquivalentCad(plan),
      includedInternalSeats: plan.included_internal_seats,
      includedCompletedDocs: plan.included_completed_docs,
      includedOcrPages: plan.included_ocr_pages,
      includedStorageGb: Number(plan.included_storage_gb),
    })),
  };
}

// ---------------------------------------------------------------------------
// Public API: subscription checkout
// ---------------------------------------------------------------------------

export async function createCheckoutSessionForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
  origin: string,
  preferredWorkspaceId?: string | null,
) {
  const appOrigin = getCanonicalAppOrigin();
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace, membership } = await getBillingWorkspaceForUser(user, preferredWorkspaceId);
  requireBillingPermission(membership);

  const existingSubscription = await getLatestSubscriptionForWorkspace(workspace.id);

  if (
    existingSubscription &&
    ["trialing", "active", "past_due", "incomplete"].includes(existingSubscription.status)
  ) {
    throw new AppError(
      409,
      "This workspace already has a subscription. Use the billing portal to manage it.",
    );
  }

  const parsed = subscriptionCheckoutInputSchema.parse(input);
  const plans = await listActivePlans();
  const selectedPlan = plans.find((plan) => plan.key === parsed.planKey);

  if (!selectedPlan) {
    throw new AppError(404, "Billing plan not found.");
  }

  if (!assertStripeConfigurationReady()) {
    return {
      url: `${appOrigin}?checkout=placeholder&plan=${encodeURIComponent(selectedPlan.key)}`,
    };
  }

  const stripe = getStripeClient();
  const customerId = await getOrCreateStripeCustomer(workspace, user);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: workspace.id,
    success_url: `${appOrigin}?checkout=success`,
    cancel_url: `${appOrigin}?checkout=cancelled`,
    allow_promotion_codes: true,
    // No payment method required during the 30-day free trial.
    // Stripe will email the customer before the trial ends to collect one.
    payment_method_collection: "if_required",
    metadata: {
      workspace_id: workspace.id,
      plan_key: selectedPlan.key,
      checkout_type: "subscription",
    },
    subscription_data: {
      trial_period_days: 30,
      metadata: {
        workspace_id: workspace.id,
        plan_key: selectedPlan.key,
      },
    },
    line_items: [
      {
        quantity: parsed.seatCount,
        price_data: {
          currency: "cad",
          unit_amount: selectedPlan.monthly_price_usd * 100,
          recurring: {
            interval: selectedPlan.billing_interval,
          },
          product_data: {
            name: selectedPlan.name,
            description:
              selectedPlan.billing_interval === "year"
                ? "Internal team members are billed at $120 CAD per user/year. External signers are not billed as users."
                : "Internal team members are billed at $12 CAD per user/month. External signers are not billed as users.",
          },
        },
      },
    ],
  });

  if (!session.url) {
    throw new AppError(500, "Stripe did not return a checkout URL.");
  }

  return { url: session.url };
}

// ---------------------------------------------------------------------------
// Public API: external token purchase checkout
// ---------------------------------------------------------------------------

// Constants for the token bundle
const TOKEN_BUNDLE_PRICE_CAD = 12; // $12 CAD
const TOKEN_BUNDLE_SIZE = 12;      // 12 tokens per bundle

export async function createTokenCheckoutSessionForAuthorizationHeader(
  authorizationHeader: string | undefined,
  origin: string,
  preferredWorkspaceId?: string | null,
) {
  const appOrigin = getCanonicalAppOrigin();
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace, membership } = await getBillingWorkspaceForUser(user, preferredWorkspaceId);
  requireBillingPermission(membership);

  // Only subscribed workspaces can purchase tokens
  const subscription = await getLatestSubscriptionForWorkspace(workspace.id);

  if (!subscription || !["active", "trialing"].includes(subscription.status)) {
    throw new AppError(
      402,
      "An active team subscription is required before purchasing external signer tokens.",
    );
  }

  if (!assertStripeConfigurationReady()) {
    return {
      url: `${appOrigin}?checkout=placeholder&plan=token_bundle`,
    };
  }

  const stripe = getStripeClient();
  const customerId = await getOrCreateStripeCustomer(workspace, user);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    client_reference_id: workspace.id,
    success_url: `${appOrigin}?checkout=success`,
    cancel_url: `${appOrigin}?checkout=cancelled`,
    metadata: {
      workspace_id: workspace.id,
      checkout_type: "token_purchase",
      token_quantity: String(TOKEN_BUNDLE_SIZE),
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: TOKEN_BUNDLE_PRICE_CAD * 100, // $12 CAD = 1200 cents
          product_data: {
            name: "EasyDraftDocs External Signer Tokens",
            description:
              `${TOKEN_BUNDLE_SIZE} tokens. 1 token = 1 external workflow sent outside your organization.`,
          },
        },
      },
    ],
  });

  if (!session.url) {
    throw new AppError(500, "Stripe did not return a checkout URL.");
  }

  return { url: session.url };
}

// ---------------------------------------------------------------------------
// Public API: billing portal
// ---------------------------------------------------------------------------

export async function createBillingPortalSessionForAuthorizationHeader(
  authorizationHeader: string | undefined,
  origin: string,
  preferredWorkspaceId?: string | null,
) {
  const appOrigin = getCanonicalAppOrigin();
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace, membership } = await getBillingWorkspaceForUser(user, preferredWorkspaceId);
  requireBillingPermission(membership);

  if (!assertStripeConfigurationReady()) {
    return {
      url: `${appOrigin}?billing=portal_placeholder&workspace=${encodeURIComponent(workspace.slug)}`,
    };
  }

  const customerId = await getOrCreateStripeCustomer(workspace, user);
  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: appOrigin,
  });

  return { url: session.url };
}

// ---------------------------------------------------------------------------
// Public API: Stripe webhook handler
// ---------------------------------------------------------------------------

export async function handleStripeWebhook(rawBody: Buffer, signature: string | undefined) {
  const env = readServerEnv();

  if (!env.STRIPE_WEBHOOK_SECRET) {
    if (!shouldRequireStripe(env)) {
      return { received: true, placeholder: true };
    }

    throw new AppError(
      503,
      "Stripe webhook handling is required in this environment. Configure STRIPE_WEBHOOK_SECRET.",
    );
  }

  if (!signature) {
    throw new AppError(400, "Missing Stripe signature header.");
  }

  const stripe = getStripeClient();
  const event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);

  const adminClient = createServiceRoleClient();

  // ------------------------------------------------------------------
  // checkout.session.completed
  // ------------------------------------------------------------------
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const workspaceId = session.metadata?.workspace_id ?? session.client_reference_id ?? null;
    const checkoutType = session.metadata?.checkout_type ?? "subscription";
    const customerId =
      typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);

    if (!workspaceId) {
      return { received: true };
    }

    // Idempotency check
    const isNew = await markStripeEventProcessed(event.id, event.type, workspaceId);

    if (!isNew) {
      return { received: true, skipped: true };
    }

    // Upsert the billing customer record
    if (customerId) {
      const { data: existingCustomer } = await adminClient
        .from("workspace_billing_customers")
        .select("id")
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      const billingPayload = {
        workspace_id: workspaceId,
        provider: "stripe",
        provider_customer_id: customerId,
        billing_email: session.customer_details?.email ?? null,
      };

      if (existingCustomer?.id) {
        await adminClient
          .from("workspace_billing_customers")
          .update(billingPayload)
          .eq("id", existingCustomer.id);
      } else {
        await adminClient.from("workspace_billing_customers").insert(billingPayload);
      }
    }

    if (checkoutType === "token_purchase" && session.payment_status === "paid") {
      // Credit tokens — confirmed by Stripe payment, not by client-side redirect
      const tokenQty = parseInt(session.metadata?.token_quantity ?? String(TOKEN_BUNDLE_SIZE), 10);
      await adminClient.from("billing_usage_events").insert({
        workspace_id: workspaceId,
        meter_key: "external_token_credit",
        quantity: tokenQty,
        occurred_at: new Date().toISOString(),
        metadata: {
          stripe_event_id: event.id,
          stripe_session_id: session.id,
          checkout_type: "token_purchase",
        },
      });
    } else if (checkoutType === "subscription" || checkoutType == null) {
      // Sync subscription record
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : (session.subscription?.id ?? null);

      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await upsertSubscriptionRecord(
          workspaceId,
          subscription,
          session.metadata?.plan_key ?? "easydraft_team",
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // customer.subscription.created / updated / deleted
  // ------------------------------------------------------------------
  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id;
    const workspaceId =
      subscription.metadata.workspace_id || (await lookupWorkspaceIdForCustomer(customerId));

    if (!workspaceId) {
      return { received: true };
    }

    // Idempotency check
    const isNew = await markStripeEventProcessed(event.id, event.type, workspaceId);

    if (!isNew) {
      return { received: true, skipped: true };
    }

    await upsertSubscriptionRecord(
      workspaceId,
      subscription,
      subscription.metadata.plan_key || "easydraft_team",
    );
  }

  // ------------------------------------------------------------------
  // invoice.paid — belt-and-suspenders subscription active confirmation
  // ------------------------------------------------------------------
  if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId =
      typeof invoice.customer === "string" ? invoice.customer : (invoice.customer?.id ?? null);

    if (!customerId) {
      return { received: true };
    }

    const workspaceId = await lookupWorkspaceIdForCustomer(customerId);

    if (!workspaceId) {
      return { received: true };
    }

    const isNew = await markStripeEventProcessed(event.id, event.type, workspaceId);

    if (!isNew) {
      return { received: true, skipped: true };
    }

    // If this invoice is for a subscription, re-fetch and sync the subscription record
    // invoice.subscription was removed from Stripe's TypeScript types in SDK v17+
    // but still exists at runtime on invoice objects. Cast through unknown to access it.
    const rawInvoiceSub = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
    const subscriptionId =
      typeof rawInvoiceSub === "string" ? rawInvoiceSub : (rawInvoiceSub?.id ?? null);

    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await upsertSubscriptionRecord(workspaceId, subscription, "easydraft_team");
    }
  }

  // ------------------------------------------------------------------
  // invoice.payment_failed — mark subscription as past_due
  // ------------------------------------------------------------------
  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId =
      typeof invoice.customer === "string" ? invoice.customer : (invoice.customer?.id ?? null);

    if (!customerId) {
      return { received: true };
    }

    const workspaceId = await lookupWorkspaceIdForCustomer(customerId);

    if (!workspaceId) {
      return { received: true };
    }

    const isNew = await markStripeEventProcessed(event.id, event.type, workspaceId);

    if (!isNew) {
      return { received: true, skipped: true };
    }

    // invoice.subscription was removed from Stripe's TypeScript types in SDK v17+
    // but still exists at runtime on invoice objects. Cast through unknown to access it.
    const rawInvoiceSub = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
    const subscriptionId =
      typeof rawInvoiceSub === "string" ? rawInvoiceSub : (rawInvoiceSub?.id ?? null);

    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await upsertSubscriptionRecord(workspaceId, subscription, "easydraft_team");
    }
  }

  return { received: true };
}
