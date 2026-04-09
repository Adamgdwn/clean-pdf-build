import { useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { apiFetch } from "../lib/api";
import type { BillingOverview } from "../types";

function formatDate(timestamp: string | null) {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function daysUntil(timestamp: string | null) {
  if (!timestamp) return null;
  const diff = new Date(timestamp).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function subscriptionStatusLabel(status: string) {
  switch (status) {
    case "active":
      return "Active";
    case "trialing":
      return "Free trial";
    case "past_due":
      return "Past due — payment required";
    case "canceled":
      return "Canceled";
    case "incomplete":
      return "Incomplete";
    default:
      return status;
  }
}

function formatPlanUnitPrice(
  plan: BillingOverview["plans"][number],
  seatCount = 1,
) {
  const total = plan.priceCad * seatCount;
  const intervalLabel = plan.billingInterval === "year" ? "year" : "month";
  return `$${total} CAD / ${intervalLabel}`;
}

function formatPerSeatPrice(plan: BillingOverview["plans"][number]) {
  return `$${plan.priceCad} CAD per user / ${plan.billingInterval}`;
}

type Props = {
  session: Session;
  billingOverview: BillingOverview;
  onBillingRefresh?: () => void;
};

export function BillingPanel({ session, billingOverview, onBillingRefresh }: Props) {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [confirmingTokenPurchase, setConfirmingTokenPurchase] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [seatCount, setSeatCount] = useState(
    billingOverview.subscription?.seatCount ?? billingOverview.workspace.internalMemberCount ?? 1,
  );
  const [selectedPlanKey, setSelectedPlanKey] = useState(
    billingOverview.subscription?.planKey ?? billingOverview.plans[0]?.key ?? "",
  );

  const { subscription, externalTokens, plans, workspace, billingMode } = billingOverview;
  const isSubscribed = subscription !== null && ["active", "trialing"].includes(subscription.status);
  const isTrialing = subscription?.status === "trialing";
  const trialDaysLeft = daysUntil(subscription?.trialEndsAt ?? null);
  const renewalDate = formatDate(subscription?.currentPeriodEnd ?? null);
  const trialEndDate = formatDate(subscription?.trialEndsAt ?? null);
  const cancelAtEnd = subscription?.cancelAtPeriodEnd ?? false;
  const selectedPlan =
    plans.find((plan) => plan.key === selectedPlanKey) ?? plans[0] ?? null;
  const currentPlan =
    (subscription ? plans.find((plan) => plan.key === subscription.planKey) : null) ?? selectedPlan;

  async function handleSubscriptionCheckout() {
    if (!selectedPlan) return;
    setIsRedirecting(true);
    setErrorMessage(null);

    try {
      const payload = await apiFetch<{ url: string }>("/billing-checkout", session, {
        method: "POST",
        body: JSON.stringify({ planKey: selectedPlan.key, seatCount }),
      });
      window.location.assign(payload.url);
    } catch (error) {
      setErrorMessage((error as Error).message);
      setIsRedirecting(false);
    }
  }

  async function handleTokenCheckout() {
    if (!confirmingTokenPurchase) {
      setConfirmingTokenPurchase(true);
      return;
    }
    setConfirmingTokenPurchase(false);
    setIsRedirecting(true);
    setErrorMessage(null);

    try {
      const payload = await apiFetch<{ url: string }>("/billing-token-checkout", session, {
        method: "POST",
      });
      window.location.assign(payload.url);
    } catch (error) {
      setErrorMessage((error as Error).message);
      setIsRedirecting(false);
    }
  }

  async function handleBillingPortal() {
    setIsRedirecting(true);
    setErrorMessage(null);

    try {
      const payload = await apiFetch<{ url: string }>("/billing-portal", session, {
        method: "POST",
      });
      window.location.assign(payload.url);
    } catch (error) {
      setErrorMessage((error as Error).message);
      setIsRedirecting(false);
    }
  }

  return (
    <section className="card">
      <div className="section-heading compact">
        <p className="eyebrow">Billing</p>
        <span>{workspace.name}</span>
      </div>

      {billingMode === "placeholder" ? (
        <p className="muted">
          Billing is in testing mode — no live charges occur. Add{" "}
          <code>STRIPE_SECRET_KEY</code> and <code>STRIPE_WEBHOOK_SECRET</code> to make billing
          live.
        </p>
      ) : null}

      {errorMessage ? <div className="alert">{errorMessage}</div> : null}

      <div className="stack">
        <div className="row-card">
          <p className="eyebrow" style={{ margin: 0 }}>
            Team subscription
          </p>
        </div>

        {isSubscribed && subscription && currentPlan ? (
          <>
            <div className="row-card">
              <div>
                <strong>{currentPlan.name}</strong>
                <p className="muted">
                  {subscriptionStatusLabel(subscription.status)}
                  {cancelAtEnd ? " · Cancels at period end" : ""}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <strong>
                  {subscription.seatCount} seat{subscription.seatCount !== 1 ? "s" : ""}
                </strong>
                <p className="muted">
                  {isTrialing
                    ? "Free during trial"
                    : formatPlanUnitPrice(currentPlan, subscription.seatCount)}
                </p>
              </div>
            </div>

            {subscription.status === "past_due" ? (
              <div className="alert">
                <strong>Payment past due.</strong> Your subscription is at risk. Update your payment
                method to keep access active.
              </div>
            ) : null}

            {isTrialing && trialDaysLeft !== null ? (
              <div className="alert success">
                Your free trial ends in <strong>{trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""}</strong>
                {trialEndDate ? ` (${trialEndDate})` : ""}.
                No payment required until then — cancel anytime.
              </div>
            ) : null}

            {isTrialing ? (
              <p className="muted">
                After your trial, you&apos;ll be charged{" "}
                {formatPlanUnitPrice(currentPlan, subscription.seatCount)} for{" "}
                {subscription.seatCount} seat{subscription.seatCount !== 1 ? "s" : ""}.
                {currentPlan.billingInterval === "year"
                  ? " That works out to $10 CAD per user / month equivalent."
                  : ""}
              </p>
            ) : renewalDate ? (
              <p className="muted">
                {cancelAtEnd ? "Ends" : "Renews"}: {renewalDate}
              </p>
            ) : null}

            <p className="muted">
              Internal team members are billed on the {currentPlan.billingInterval === "year" ? "annual" : "monthly"} plan you selected.
              External signers are not billed as users. Tokens remain $12 CAD for 12.
            </p>

            <button
              className="secondary-button"
              disabled={isRedirecting}
              onClick={handleBillingPortal}
            >
              {isRedirecting
                ? "Redirecting…"
                : subscription.status === "past_due"
                  ? "Update payment method"
                  : isTrialing
                    ? "Add payment method"
                    : "Manage billing — change seats or plan"}
            </button>
          </>
        ) : selectedPlan ? (
          <>
            <div className="stack">
              {plans.map((plan) => (
                <label key={plan.key} className="row-card" style={{ cursor: "pointer" }}>
                  <div>
                    <strong>{plan.name}</strong>
                    <p className="muted">{formatPerSeatPrice(plan)}</p>
                    {plan.billingInterval === "year" ? (
                      <p className="muted">$10 CAD per user / month equivalent when billed annually.</p>
                    ) : null}
                  </div>
                  <input
                    type="radio"
                    name="billing-plan"
                    checked={selectedPlanKey === plan.key}
                    onChange={() => setSelectedPlanKey(plan.key)}
                  />
                </label>
              ))}
            </div>

            <p className="muted">
              No credit card required to start. Cancel anytime during the 30-day trial. External
              signers are not billed as users, and tokens stay at $12 CAD for 12.
            </p>

            <div className="row-card">
              <label htmlFor="seat-count">
                <strong>Seats</strong>
                <p className="muted">How many internal team members will use EasyDraftDocs?</p>
              </label>
              <input
                id="seat-count"
                type="number"
                min={1}
                max={500}
                value={seatCount}
                onChange={(event) => setSeatCount(Math.max(1, Number(event.target.value)))}
                style={{ width: "5rem" }}
              />
            </div>

            <p className="muted">
              After the trial: {formatPlanUnitPrice(selectedPlan, seatCount)}
              {selectedPlan.billingInterval === "year"
                ? ` ($${selectedPlan.monthlyEquivalentPriceCad * seatCount} CAD / month equivalent)`
                : ""}
            </p>

            <button
              className="primary-button"
              disabled={isRedirecting}
              onClick={handleSubscriptionCheckout}
            >
              {isRedirecting
                ? "Redirecting…"
                : `Start free trial — ${seatCount} seat${seatCount !== 1 ? "s" : ""}`}
            </button>
          </>
        ) : (
          <p className="muted">No plans available. Contact support.</p>
        )}

        <div className="row-card" style={{ marginTop: "1rem" }}>
          <p className="eyebrow" style={{ margin: 0 }}>
            External signer tokens
          </p>
        </div>

        <div className="row-card">
          <span>Token balance</span>
          <strong>
            {externalTokens.available} available
            {externalTokens.purchased > 0
              ? ` (${externalTokens.used} used of ${externalTokens.purchased} purchased)`
              : ""}
          </strong>
        </div>

        <p className="muted">
          External signer tokens are only used when sending workflows outside your organization.
          Internal team approvals are covered by your seat subscription.
        </p>
        <p className="muted">
          $12 CAD buys 12 external signer tokens. 1 token = 1 external workflow sent outside your
          organization.
        </p>

        {isSubscribed ? (
          confirmingTokenPurchase ? (
            <div className="stack">
              <div className="alert">
                This will charge <strong>$12 CAD</strong> to your payment method on file and add 12 external signer tokens to your balance.
              </div>
              <div className="row-inline">
                <button className="primary-button" disabled={isRedirecting} onClick={handleTokenCheckout}>
                  {isRedirecting ? "Redirecting…" : "Confirm — $12 CAD"}
                </button>
                <button className="ghost-button" onClick={() => setConfirmingTokenPurchase(false)} type="button">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="ghost-button" disabled={isRedirecting} onClick={handleTokenCheckout}>
              Buy 12 tokens — $12 CAD
            </button>
          )
        ) : (
          <p className="muted">
            Subscribe to a team plan above to purchase external signer tokens.
          </p>
        )}
      </div>
    </section>
  );
}
