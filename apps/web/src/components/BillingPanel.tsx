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
    case "active":     return "Active";
    case "trialing":   return "Free trial";
    case "past_due":   return "Past due — payment required";
    case "canceled":   return "Canceled";
    case "incomplete": return "Incomplete";
    default:           return status;
  }
}

type Props = {
  session: Session;
  billingOverview: BillingOverview;
  onBillingRefresh?: () => void;
};

export function BillingPanel({ session, billingOverview, onBillingRefresh }: Props) {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [seatCount, setSeatCount] = useState(
    billingOverview.subscription?.seatCount ?? billingOverview.workspace.internalMemberCount ?? 1,
  );

  const { subscription, externalTokens, plans, workspace, billingMode } = billingOverview;
  const teamPlan = plans[0] ?? null; // only one active plan (easydraft_team)
  const isSubscribed = subscription !== null && ["active", "trialing"].includes(subscription.status);
  const isTrialing = subscription?.status === "trialing";
  const trialDaysLeft = daysUntil(subscription?.trialEndsAt ?? null);
  const renewalDate = formatDate(subscription?.currentPeriodEnd ?? null);
  const trialEndDate = formatDate(subscription?.trialEndsAt ?? null);
  const cancelAtEnd = subscription?.cancelAtPeriodEnd ?? false;

  async function handleSubscriptionCheckout() {
    if (!teamPlan) return;
    setIsRedirecting(true);
    setErrorMessage(null);

    try {
      const payload = await apiFetch<{ url: string }>("/billing-checkout", session, {
        method: "POST",
        body: JSON.stringify({ planKey: teamPlan.key, seatCount }),
      });
      window.location.assign(payload.url);
    } catch (error) {
      setErrorMessage((error as Error).message);
      setIsRedirecting(false);
    }
  }

  async function handleTokenCheckout() {
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
        {/* ------------------------------------------------------------------ */}
        {/* Team subscription section                                           */}
        {/* ------------------------------------------------------------------ */}
        <div className="row-card">
          <p className="eyebrow" style={{ margin: 0 }}>
            Team subscription
          </p>
        </div>

        {isSubscribed && subscription ? (
          <>
            <div className="row-card">
              <div>
                <strong>EasyDraftDocs — Team</strong>
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
                  {isTrialing ? "Free during trial" : `$${subscription.seatCount * (teamPlan?.monthlyPriceCad ?? 12)} CAD / month`}
                </p>
              </div>
            </div>

            {isTrialing && trialDaysLeft !== null ? (
              <div className="alert success">
                Your free trial ends in <strong>{trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""}</strong>
                {trialEndDate ? ` (${trialEndDate})` : ""}.
                No payment required until then — cancel anytime.
              </div>
            ) : null}

            {isTrialing ? (
              <p className="muted">
                After your trial, you'll be charged ${subscription.seatCount * (teamPlan?.monthlyPriceCad ?? 12)} CAD/month
                for {subscription.seatCount} seat{subscription.seatCount !== 1 ? "s" : ""}.
                Add a payment method before your trial ends to continue uninterrupted.
              </p>
            ) : renewalDate ? (
              <p className="muted">
                {cancelAtEnd ? "Ends" : "Renews"}: {renewalDate}
              </p>
            ) : null}

            <p className="muted">
              Internal team members are billed at $12 CAD per user/month. External signers are not
              billed as users.
            </p>

            <button
              className="secondary-button"
              disabled={isRedirecting}
              onClick={handleBillingPortal}
            >
              {isRedirecting ? "Redirecting…" : isTrialing ? "Add payment method" : "Manage billing"}
            </button>
          </>
        ) : teamPlan ? (
          <>
            <div className="row-card">
              <div>
                <strong>{teamPlan.name}</strong>
                <p className="muted">
                  30 days free, then ${teamPlan.monthlyPriceCad} CAD per user / month
                </p>
              </div>
            </div>

            <p className="muted">
              No credit card required to start. Cancel anytime. Internal team members are billed
              at $12 CAD per user/month after the trial. External signers are not billed as users.
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
              After the trial: ${seatCount * teamPlan.monthlyPriceCad} CAD / month
            </p>

            <button
              className="primary-button"
              disabled={isRedirecting}
              onClick={handleSubscriptionCheckout}
            >
              {isRedirecting ? "Redirecting…" : `Start free trial — ${seatCount} seat${seatCount !== 1 ? "s" : ""}`}
            </button>
          </>
        ) : (
          <p className="muted">No plans available. Contact support.</p>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* External signer tokens section                                      */}
        {/* ------------------------------------------------------------------ */}
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
          <button
            className="ghost-button"
            disabled={isRedirecting}
            onClick={handleTokenCheckout}
          >
            {isRedirecting ? "Redirecting…" : "Buy 12 tokens — $12 CAD"}
          </button>
        ) : (
          <p className="muted">
            Subscribe to the team plan above to purchase external signer tokens.
          </p>
        )}
      </div>
    </section>
  );
}
