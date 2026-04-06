import { useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { apiFetch } from "../lib/api";
import type { BillingOverview } from "../types";

function formatTimestamp(timestamp: string | null) {
  if (!timestamp) return "Not set";
  return new Date(timestamp).toLocaleString();
}

type Props = {
  session: Session;
  billingOverview: BillingOverview;
};

export function BillingPanel({ session, billingOverview }: Props) {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleBillingCheckout(planKey: string) {
    setIsRedirecting(true);
    setErrorMessage(null);

    try {
      const payload = await apiFetch<{ url: string }>("/billing-checkout", session, {
        method: "POST",
        body: JSON.stringify({ planKey }),
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
        <span>{billingOverview.workspace.workspaceType}</span>
      </div>

      {errorMessage ? <div className="alert">{errorMessage}</div> : null}

      <div className="stack">
        <div className="row-card">
          <div>
            <strong>{billingOverview.workspace.name}</strong>
            <p className="muted">
              {billingOverview.subscription
                ? `${billingOverview.subscription.planKey} · ${billingOverview.subscription.status}`
                : "No active subscription"}
            </p>
          </div>
          <span>{billingOverview.workspace.internalMemberCount} seats in workspace</span>
        </div>
        {billingOverview.billingMode === "placeholder" ? (
          <p className="muted">
            Billing is in testing mode. No live charges occur right now. Plan buttons stay clickable,
            but they loop through a non-live preview until Stripe keys are configured.
          </p>
        ) : null}
        <div className="row-card">
          <span>Signing tokens</span>
          <strong>
            {billingOverview.signingTokens.available} / {billingOverview.signingTokens.includedInPlan} available this period
          </strong>
        </div>
        {billingOverview.subscription ? (
          <>
            <p className="muted">
              Renewal date: {formatTimestamp(billingOverview.subscription.currentPeriodEnd)}
            </p>
            <button
              className="secondary-button"
              disabled={isRedirecting}
              onClick={handleBillingPortal}
            >
              Manage billing
            </button>
          </>
        ) : (
          billingOverview.plans.map((plan) => (
            <div key={plan.key} className="row-card">
              <div>
                <strong>
                  {plan.name} · ${plan.monthlyPriceUsd}/mo
                </strong>
                <p className="muted">
                  {plan.includedCompletedDocs} docs · {plan.includedOcrPages} OCR pages ·{" "}
                  {plan.includedStorageGb} GB · {plan.includedSigningTokens} signing tokens
                </p>
              </div>
              <button
                className="ghost-button"
                disabled={isRedirecting}
                onClick={() => handleBillingCheckout(plan.key)}
              >
                Choose
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
