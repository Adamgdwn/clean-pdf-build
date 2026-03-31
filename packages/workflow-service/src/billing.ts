import Stripe from "stripe";
import { z } from "zod";

import { readServerEnv } from "./env.js";
import { AppError } from "./errors.js";
import {
  ensureDefaultWorkspaceForUser,
  resolveAuthenticatedUser,
  type AuthenticatedUser,
} from "./service.js";
import { createServiceRoleClient } from "./supabase.js";

type BillingPlanRow = {
  key: string;
  name: string;
  monthly_price_usd: number;
  included_internal_seats: number;
  included_completed_docs: number;
  included_ocr_pages: number;
  included_storage_gb: number;
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

const checkoutInputSchema = z.object({
  planKey: z.string().min(1),
});

let cachedStripeClient: Stripe | null = null;

function isStripeConfigured() {
  const env = readServerEnv();
  return Boolean(env.STRIPE_SECRET_KEY);
}

function getStripeClient() {
  const env = readServerEnv();

  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError(503, "Stripe is not configured yet. Add STRIPE_SECRET_KEY in Vercel and local env.");
  }

  if (!cachedStripeClient) {
    cachedStripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  }

  return cachedStripeClient;
}

function requireBillingPermission(membership: WorkspaceMembershipRow | null) {
  if (!membership || !["owner", "admin", "billing_admin"].includes(membership.role)) {
    throw new AppError(403, "You do not have permission to manage billing for this workspace.");
  }
}

async function getBillingWorkspaceForUser(user: AuthenticatedUser) {
  const workspace = (await ensureDefaultWorkspaceForUser(user)) as WorkspaceRow;
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
      "key, name, monthly_price_usd, included_internal_seats, included_completed_docs, included_ocr_pages, included_storage_gb, active",
    )
    .eq("active", true)
    .order("monthly_price_usd", { ascending: true });

  if (error) {
    throw new AppError(500, error.message);
  }

  return (data ?? []) as BillingPlanRow[];
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
    const { error: insertError } = await adminClient.from("workspace_billing_customers").insert(payload);

    if (insertError) {
      throw new AppError(500, insertError.message);
    }
  }

  return customer.id;
}

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
    const { error } = await adminClient.from("workspace_subscriptions").update(payload).eq("id", existing.id);

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

export async function getBillingOverviewForAuthorizationHeader(authorizationHeader: string | undefined) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const workspaceContext = await getBillingWorkspaceForUser(user);
  const { workspace, membership } = workspaceContext;
  const [plans, subscription, internalMemberCount] = await Promise.all([
    listActivePlans(),
    getLatestSubscriptionForWorkspace(workspace.id),
    countWorkspaceMembers(workspace.id),
  ]);

  return {
    billingMode: isStripeConfigured() ? "live" : "placeholder",
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
        }
      : null,
    plans: plans.map((plan) => ({
      key: plan.key,
      name: plan.name,
      monthlyPriceUsd: plan.monthly_price_usd,
      includedInternalSeats: plan.included_internal_seats,
      includedCompletedDocs: plan.included_completed_docs,
      includedOcrPages: plan.included_ocr_pages,
      includedStorageGb: Number(plan.included_storage_gb),
    })),
  };
}

export async function createCheckoutSessionForAuthorizationHeader(
  authorizationHeader: string | undefined,
  input: unknown,
  origin: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace, membership } = await getBillingWorkspaceForUser(user);
  requireBillingPermission(membership);

  const existingSubscription = await getLatestSubscriptionForWorkspace(workspace.id);

  if (existingSubscription && ["trialing", "active", "past_due", "incomplete"].includes(existingSubscription.status)) {
    throw new AppError(409, "This workspace already has a subscription. Use the billing portal to manage it.");
  }

  const parsed = checkoutInputSchema.parse(input);
  const plans = await listActivePlans();
  const selectedPlan = plans.find((plan) => plan.key === parsed.planKey);

  if (!selectedPlan) {
    throw new AppError(404, "Billing plan not found.");
  }

  if (!isStripeConfigured()) {
    return {
      url: `${origin}?checkout=placeholder&plan=${encodeURIComponent(selectedPlan.key)}`,
    };
  }

  const stripe = getStripeClient();
  const customerId = await getOrCreateStripeCustomer(workspace, user);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: workspace.id,
    success_url: `${origin}?checkout=success`,
    cancel_url: `${origin}?checkout=cancelled`,
    allow_promotion_codes: true,
    metadata: {
      workspace_id: workspace.id,
      plan_key: selectedPlan.key,
    },
    subscription_data: {
      metadata: {
        workspace_id: workspace.id,
        plan_key: selectedPlan.key,
      },
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: selectedPlan.monthly_price_usd * 100,
          recurring: {
            interval: "month",
          },
          product_data: {
            name: `EasyDraft ${selectedPlan.name}`,
            description: `${selectedPlan.included_completed_docs} completed docs, ${selectedPlan.included_ocr_pages} OCR pages, ${selectedPlan.included_storage_gb} GB storage.`,
            metadata: {
              workspace_id: workspace.id,
              plan_key: selectedPlan.key,
            },
          },
        },
      },
    ],
  });

  if (!session.url) {
    throw new AppError(500, "Stripe did not return a checkout URL.");
  }

  return {
    url: session.url,
  };
}

export async function createBillingPortalSessionForAuthorizationHeader(
  authorizationHeader: string | undefined,
  origin: string,
) {
  const user = await resolveAuthenticatedUser(authorizationHeader);
  const { workspace, membership } = await getBillingWorkspaceForUser(user);
  requireBillingPermission(membership);

  if (!isStripeConfigured()) {
    return {
      url: `${origin}?billing=portal_placeholder&workspace=${encodeURIComponent(workspace.slug)}`,
    };
  }

  const customerId = await getOrCreateStripeCustomer(workspace, user);
  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: origin,
  });

  return {
    url: session.url,
  };
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

export async function handleStripeWebhook(rawBody: Buffer, signature: string | undefined) {
  const env = readServerEnv();

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return { received: true, placeholder: true };
  }

  if (!signature) {
    throw new AppError(400, "Missing Stripe signature header.");
  }

  const stripe = getStripeClient();
  const event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const workspaceId = session.metadata?.workspace_id ?? session.client_reference_id;
    const planKey = session.metadata?.plan_key ?? "starter";
    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    const subscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

    if (workspaceId && customerId) {
      const adminClient = createServiceRoleClient();
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
        await adminClient.from("workspace_billing_customers").update(billingPayload).eq("id", existingCustomer.id);
      } else {
        await adminClient.from("workspace_billing_customers").insert(billingPayload);
      }

      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await upsertSubscriptionRecord(workspaceId, subscription, planKey);
      }
    }
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId =
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const workspaceId = subscription.metadata.workspace_id || (await lookupWorkspaceIdForCustomer(customerId));

    if (workspaceId) {
      await upsertSubscriptionRecord(workspaceId, subscription, subscription.metadata.plan_key || "starter");
    }
  }

  return { received: true };
}
