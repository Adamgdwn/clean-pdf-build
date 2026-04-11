import { useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { AdminConsole } from "./AdminPanel";
import { BillingPanel } from "./BillingPanel";
import { TeamPanel } from "./TeamPanel";
import type {
  AdminManagedUser,
  AdminOverview,
  BillingOverview,
  SessionUser,
  WorkflowDocument,
  WorkspaceTeam,
} from "../types";

function formatTimestamp(timestamp: string | null) {
  if (!timestamp) return "Not set";
  return new Date(timestamp).toLocaleString();
}

function formatShortDate(timestamp: string | null) {
  if (!timestamp) return "Not scheduled";
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function subscriptionStatusLabel(status: string | null) {
  if (!status) return "No subscription";

  switch (status) {
    case "active":
      return "Active";
    case "trialing":
      return "Free trial";
    case "past_due":
      return "Past due";
    case "canceled":
      return "Canceled";
    case "incomplete":
      return "Incomplete";
    default:
      return formatStatusLabel(status);
  }
}

function scrollToSection(sectionId: string) {
  document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getAttentionSeverity(document: WorkflowDocument) {
  if (document.isOverdue || document.waitingOn.isOverdue) {
    return { label: "Overdue", rank: 0, tone: "critical" as const };
  }

  if (document.operationalStatus === "rejected" || document.operationalStatus === "canceled") {
    return { label: "Blocked", rank: 1, tone: "high" as const };
  }

  if (document.operationalStatus === "changes_requested") {
    return { label: "Review", rank: 2, tone: "medium" as const };
  }

  return { label: "Monitor", rank: 3, tone: "low" as const };
}

type Props = {
  session: Session;
  sessionUser: SessionUser;
  documents: WorkflowDocument[];
  workspaceTeam: WorkspaceTeam | null;
  billingOverview: BillingOverview | null;
  adminOverview: AdminOverview | null;
  adminUsers: AdminManagedUser[];
  onRefreshTeam: () => Promise<void>;
  onRefreshBilling: () => Promise<void>;
  onRefreshAdmin: () => Promise<void>;
  onSwitchToWorkspace: () => void;
  onNavigateToDocument: (documentId: string) => void;
};

export function OwnerPortal({
  session,
  sessionUser,
  documents,
  workspaceTeam,
  billingOverview,
  adminOverview,
  adminUsers,
  onRefreshTeam,
  onRefreshBilling,
  onRefreshAdmin,
  onSwitchToWorkspace,
  onNavigateToDocument,
}: Props) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const completedDocuments = documents.filter((document) => document.workflowState === "completed").length;
  const activeDocuments = documents.filter(
    (document) => document.operationalStatus === "active" && document.workflowState !== "completed",
  ).length;
  const overdueDocuments = documents.filter((document) => document.isOverdue).length;
  const actionNeededDocuments = documents.filter(
    (document) =>
      document.operationalStatus === "changes_requested" ||
      document.operationalStatus === "rejected" ||
      document.operationalStatus === "canceled" ||
      (document.workflowState !== "completed" && document.waitingOn.isOverdue),
  ).length;

  const occupiedSeats = workspaceTeam
    ? workspaceTeam.members.length + workspaceTeam.pendingInvitations.length
    : 0;
  const availableSeats = billingOverview?.subscription?.seatCount ?? 0;
  const tokenBalance = billingOverview?.externalTokens.available ?? 0;
  const activeMemberCount = workspaceTeam?.members.length ?? 0;
  const pendingInvitationCount = workspaceTeam?.pendingInvitations.length ?? 0;
  const currentMembershipRole =
    billingOverview?.workspace.membershipRole ??
    workspaceTeam?.members.find((member) => member.isCurrentUser)?.role ??
    null;

  const draftDocuments = documents.filter((document) => document.workflowState === "draft").length;
  const sentDocuments = documents.filter((document) =>
    ["sent", "partially_signed", "pending"].includes(document.workflowState),
  ).length;
  const lockedDocuments = documents.filter((document) => Boolean(document.lockedAt)).length;
  const managedDocuments = documents.filter((document) => document.deliveryMode === "platform_managed").length;

  const subscription = billingOverview?.subscription ?? null;
  const currentPlan = subscription
    ? billingOverview?.plans.find((plan) => plan.key === subscription.planKey) ?? null
    : null;
  const currentPlanName = currentPlan?.name ?? "No plan selected yet";
  const subscriptionStatus = subscriptionStatusLabel(subscription?.status ?? null);
  const renewsOn = subscription?.currentPeriodEnd ? formatShortDate(subscription.currentPeriodEnd) : null;
  const trialEndsOn = subscription?.trialEndsAt ? formatShortDate(subscription.trialEndsAt) : null;
  const queuePressure = adminOverview
    ? adminOverview.metrics.pendingNotifications +
      adminOverview.metrics.failedNotifications +
      adminOverview.metrics.queuedProcessingJobs
    : 0;

  const ownerWatchlist = [...documents]
    .filter(
      (document) =>
        document.isOverdue ||
        document.waitingOn.isOverdue ||
        document.operationalStatus === "changes_requested" ||
        document.operationalStatus === "rejected" ||
        document.operationalStatus === "canceled",
    )
    .sort((left, right) => {
      const leftSeverity = getAttentionSeverity(left);
      const rightSeverity = getAttentionSeverity(right);

      if (leftSeverity.rank !== rightSeverity.rank) {
        return leftSeverity.rank - rightSeverity.rank;
      }

      return (right.sentAt ?? right.uploadedAt).localeCompare(left.sentAt ?? left.uploadedAt);
    })
    .slice(0, 6);

  const recentDocuments = [...documents]
    .sort((left, right) => (right.sentAt ?? right.uploadedAt).localeCompare(left.sentAt ?? left.uploadedAt))
    .slice(0, 6);

  const ownerCount = workspaceTeam?.members.filter((member) => member.role === "owner").length ?? 0;
  const adminCount = workspaceTeam?.members.filter((member) => member.role === "admin").length ?? 0;
  const billingAdminCount = workspaceTeam?.members.filter((member) => member.role === "billing_admin").length ?? 0;

  async function handleRefreshAll() {
    setIsRefreshing(true);
    setRefreshError(null);

    try {
      await Promise.all([onRefreshBilling(), onRefreshTeam(), onRefreshAdmin()]);
    } catch (error) {
      setRefreshError((error as Error).message);
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <section className="owner-portal">
      <div className="panel owner-hero-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Organization control center</p>
            <h3>Run the business from one operating view</h3>
          </div>
          <button className="secondary-button" disabled={isRefreshing} onClick={handleRefreshAll} type="button">
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <p className="muted action-note">
          Start here to review company health, commercial posture, team access, and workflows that need attention before dropping into document work.
        </p>

        {refreshError ? <div className="alert">{refreshError}</div> : null}

        {documents.length === 0 || activeMemberCount <= 1 ? (
          <section className="toolbar-card owner-summary-card">
            <div className="section-heading compact">
              <p className="eyebrow">Launch checklist</p>
              <span>{workspaceTeam?.workspace.name ?? billingOverview?.workspace.name ?? "Workspace"}</span>
            </div>
            <div className="stack">
              <div className="row-card">
                <div>
                  <strong>{subscription ? "Review trial and billing" : "Start a free trial"}</strong>
                  <p className="muted">Confirm seats, token balance, and plan posture before inviting your team.</p>
                </div>
                <button className="ghost-button" onClick={() => scrollToSection("section-billing")} type="button">
                  Billing
                </button>
              </div>
              <div className="row-card">
                <div>
                  <strong>Invite a teammate</strong>
                  <p className="muted">Bring one collaborator into the workspace so the product feels real in a team setting.</p>
                </div>
                <button className="ghost-button" onClick={() => scrollToSection("section-team")} type="button">
                  Team
                </button>
              </div>
              <div className="row-card">
                <div>
                  <strong>Upload your first workflow</strong>
                  <p className="muted">Switch to the workspace, upload a PDF, and send a live test workflow end to end.</p>
                </div>
                <button className="ghost-button" onClick={onSwitchToWorkspace} type="button">
                  Workspace
                </button>
              </div>
              <div className="row-card">
                <div>
                  <strong>Review the guide</strong>
                  <p className="muted">Keep the first-run path tight: billing, team setup, upload, send, sign, export.</p>
                </div>
                <a className="ghost-button" href="/guide.html" rel="noopener noreferrer" target="_blank">
                  Guide
                </a>
              </div>
            </div>
          </section>
        ) : null}

        <div className="quick-actions owner-actions">
          <p className="eyebrow">Owner actions</p>
          <div className="quick-actions-grid">
            <button className="quick-action-item" onClick={() => scrollToSection("section-attention")} type="button">
              <strong className="quick-action-label">Review watchlist</strong>
              <span className="muted">{ownerWatchlist.length} workflow{ownerWatchlist.length === 1 ? "" : "s"} need review</span>
            </button>
            <button className="quick-action-item" onClick={() => scrollToSection("section-billing")} type="button">
              <strong className="quick-action-label">{subscription ? "Manage billing" : "Start free trial"}</strong>
              <span className="muted">{subscriptionStatus} · {tokenBalance} tokens available</span>
            </button>
            <button className="quick-action-item" onClick={() => scrollToSection("section-team")} type="button">
              <strong className="quick-action-label">{activeMemberCount <= 1 ? "Invite teammate" : "Manage team"}</strong>
              <span className="muted">{activeMemberCount} members · {pendingInvitationCount} pending invites</span>
            </button>
            {documents.length === 0 ? (
              <button className="quick-action-item" onClick={onSwitchToWorkspace} type="button">
                <strong className="quick-action-label">Upload first workflow</strong>
                <span className="muted">Open the workspace and start with a PDF</span>
              </button>
            ) : sessionUser.isAdmin ? (
              <button className="quick-action-item" onClick={() => scrollToSection("section-admin")} type="button">
                <strong className="quick-action-label">Review admin console</strong>
                <span className="muted">{queuePressure} queue item{queuePressure === 1 ? "" : "s"} to review</span>
              </button>
            ) : (
              <button className="quick-action-item" onClick={() => window.open("/guide.html", "_blank", "noopener,noreferrer")} type="button">
                <strong className="quick-action-label">Review quick guide</strong>
                <span className="muted">Open the product guide in a separate tab</span>
              </button>
            )}
            {documents.length > 0 ? (
              <button className="quick-action-item" onClick={onSwitchToWorkspace} type="button">
                <strong className="quick-action-label">Open workspace</strong>
                <span className="muted">Jump into document editing and routing</span>
              </button>
            ) : null}
          </div>
        </div>

        <div className="owner-metrics-grid">
          <div className="metric">
            <span>Active workflows</span>
            <strong>{activeDocuments}</strong>
            <p>Documents currently moving through routing, signatures, or approvals.</p>
          </div>
          <div className="metric">
            <span>Needs attention</span>
            <strong>{actionNeededDocuments}</strong>
            <p>Overdue items, rejected workflows, or change requests waiting on action.</p>
          </div>
          <div className="metric">
            <span>Overdue</span>
            <strong>{overdueDocuments}</strong>
            <p>Workflows that need a nudge, reprioritization, or intervention.</p>
          </div>
          <div className="metric">
            <span>Seats in use</span>
            <strong>{availableSeats > 0 ? `${occupiedSeats}/${availableSeats}` : occupiedSeats}</strong>
            <p>Members plus pending invitations compared with subscribed capacity.</p>
          </div>
          <div className="metric">
            <span>Token balance</span>
            <strong>{tokenBalance}</strong>
            <p>Prepaid managed-send capacity available for outside signers.</p>
          </div>
          <div className="metric">
            <span>Subscription</span>
            <strong>{subscriptionStatus}</strong>
            <p>{trialEndsOn ? `Trial ends ${trialEndsOn}.` : renewsOn ? `Renews ${renewsOn}.` : "No renewal date scheduled yet."}</p>
          </div>
        </div>

        <div className="owner-summary-grid">
          <section className="toolbar-card owner-summary-card">
            <div className="section-heading compact">
              <p className="eyebrow">Company snapshot</p>
              <span>{workspaceTeam?.workspace.name ?? billingOverview?.workspace.name ?? "Workspace"}</span>
            </div>
            <div className="stack">
              <div className="row-card">
                <div>
                  <strong>Access posture</strong>
                  <p className="muted">
                    {activeMemberCount} active member{activeMemberCount === 1 ? "" : "s"} and {pendingInvitationCount} pending invite{pendingInvitationCount === 1 ? "" : "s"}.
                  </p>
                </div>
                <span>{currentMembershipRole ? formatStatusLabel(currentMembershipRole) : "Admin view"}</span>
              </div>
              <div className="row-card">
                <div>
                  <strong>Role coverage</strong>
                  <p className="muted">
                    {ownerCount} super user{ownerCount === 1 ? "" : "s"}, {adminCount} admin{adminCount === 1 ? "" : "s"}, {billingAdminCount} billing admin{billingAdminCount === 1 ? "" : "s"}.
                  </p>
                </div>
                <span>{sessionUser.name}</span>
              </div>
            </div>
          </section>

          <section className="toolbar-card owner-summary-card">
            <div className="section-heading compact">
              <p className="eyebrow">Commercial snapshot</p>
              <span>{billingOverview?.billingMode === "placeholder" ? "Testing mode" : "Live billing"}</span>
            </div>
            <div className="stack">
              <div className="row-card">
                <div>
                  <strong>{currentPlanName}</strong>
                  <p className="muted">{subscriptionStatus}</p>
                </div>
                <span>
                  {subscription?.seatCount
                    ? `${subscription.seatCount} seat${subscription.seatCount === 1 ? "" : "s"}`
                    : "Trial ready"}
                </span>
              </div>
              <div className="row-card">
                <div>
                  <strong>Seat usage</strong>
                  <p className="muted">
                    {availableSeats > 0
                      ? `${occupiedSeats} occupied against ${availableSeats} subscribed seats.`
                      : `${occupiedSeats} occupied seats tracked right now.`}
                  </p>
                </div>
                <span>{tokenBalance} tokens</span>
              </div>
            </div>
          </section>

          <section className="toolbar-card owner-summary-card">
            <div className="section-heading compact">
              <p className="eyebrow">Workflow snapshot</p>
              <span>{documents.length} total</span>
            </div>
            <div className="stack">
              <div className="row-card">
                <div>
                  <strong>Pipeline balance</strong>
                  <p className="muted">
                    {draftDocuments} draft, {sentDocuments} in flight, {completedDocuments} completed.
                  </p>
                </div>
                <span>{lockedDocuments} locked</span>
              </div>
              <div className="row-card">
                <div>
                  <strong>Managed routing load</strong>
                  <p className="muted">
                    {managedDocuments} workflow{managedDocuments === 1 ? "" : "s"} currently rely on EasyDraft-managed notifications and follow-up.
                  </p>
                </div>
                <span>{ownerWatchlist.length} flagged</span>
              </div>
            </div>
          </section>
        </div>
      </div>

      <section className="owner-portal-grid">
        <div className="stack">
          <section className="card" id="section-attention">
            <div className="section-heading compact">
              <p className="eyebrow">Needs attention now</p>
              <span>{ownerWatchlist.length} items</span>
            </div>
            <div className="stack">
              {ownerWatchlist.length === 0 ? (
                <p className="muted">No workflows need attention right now.</p>
              ) : (
                ownerWatchlist.map((document) => {
                  const severity = getAttentionSeverity(document);

                  return (
                    <button
                      key={document.id}
                      className="row-card row-card-button"
                      onClick={() => onNavigateToDocument(document.id)}
                      type="button"
                      title="Open in workspace"
                    >
                      <div>
                        <div className="owner-watchlist-heading">
                          <strong>{document.name}</strong>
                          <span className={`status-chip status-chip-${severity.tone}`}>{severity.label}</span>
                        </div>
                        <p className="muted">{document.waitingOn.summary}</p>
                        <p className="muted">
                          {formatStatusLabel(document.operationalStatus)} · last activity {formatTimestamp(document.sentAt ?? document.uploadedAt)}
                        </p>
                      </div>
                      <span>{formatStatusLabel(document.deliveryMode)} →</span>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="card">
            <div className="section-heading compact">
              <p className="eyebrow">Recent workflow activity</p>
              <span>{recentDocuments.length} items</span>
            </div>
            <div className="stack">
              {recentDocuments.length === 0 ? (
                <p className="muted">No documents exist yet. Upload a PDF when you are ready to start the company workflow trail.</p>
              ) : (
                recentDocuments.map((document) => (
                  <div key={document.id} className="row-card">
                    <div>
                      <strong>{document.name}</strong>
                      <p className="muted">
                        {formatStatusLabel(document.workflowState)} · {formatStatusLabel(document.deliveryMode)}
                      </p>
                    </div>
                    <span>{formatShortDate(document.sentAt ?? document.uploadedAt)}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <div id="section-billing">
            {billingOverview ? (
              <BillingPanel session={session} billingOverview={billingOverview} onBillingRefresh={onRefreshBilling} />
            ) : (
              <section className="card">
                <div className="section-heading compact">
                  <p className="eyebrow">Billing</p>
                  <span>Loading…</span>
                </div>
                <p className="muted">
                  Billing details are loading. Use refresh above if this persists.
                </p>
              </section>
            )}
          </div>

          <div id="section-team">
            {workspaceTeam ? (
              <TeamPanel
                session={session}
                team={workspaceTeam}
                billingOverview={billingOverview}
                onTeamRefresh={onRefreshTeam}
              />
            ) : (
              <section className="card">
                <div className="section-heading compact">
                  <p className="eyebrow">Team</p>
                  <span>Loading…</span>
                </div>
                <p className="muted">
                  Team membership is loading. Use refresh above if this persists.
                </p>
              </section>
            )}
          </div>
        </div>

        <div className="stack">
          <section className="card">
            <div className="section-heading compact">
              <p className="eyebrow">System posture</p>
              <span>{billingOverview?.billingMode === "placeholder" ? "Pilot mode" : "Production mode"}</span>
            </div>
            <div className="stack">
              <div className="row-card">
                <div>
                  <strong>Account identity</strong>
                  <p className="muted">
                    {workspaceTeam?.organization.name ?? billingOverview?.organization.name ?? workspaceTeam?.workspace.name ?? billingOverview?.workspace.name ?? "Workspace"} is the shared account container for drafts, approvals, signatures, exports, and billing.
                  </p>
                </div>
                <span>{billingOverview?.organization.accountType ?? "corporate"}</span>
              </div>
              <div className="row-card">
                <div>
                  <strong>Billing mode</strong>
                  <p className="muted">
                    {billingOverview?.billingMode === "placeholder"
                      ? "Testing mode. Add Stripe keys to activate live billing."
                      : "Live billing. Renewals, seats, and token purchases are production operations."}
                  </p>
                </div>
                <span>{subscriptionStatus}</span>
              </div>
              {adminOverview ? (
                <div className="row-card">
                  <div>
                  <strong>Platform queue</strong>
                  <p className="muted">
                      {adminOverview.metrics.pendingNotifications} pending notification{adminOverview.metrics.pendingNotifications === 1 ? "" : "s"}, {adminOverview.metrics.failedNotifications} failed notification{adminOverview.metrics.failedNotifications === 1 ? "" : "s"}, and {adminOverview.metrics.queuedProcessingJobs} queued processing job{adminOverview.metrics.queuedProcessingJobs === 1 ? "" : "s"}.
                  </p>
                  <p className="muted">
                    Oldest pending email: {formatTimestamp(adminOverview.metrics.oldestPendingNotificationAt)} · oldest queued job: {formatTimestamp(adminOverview.metrics.oldestQueuedProcessingAt)}
                  </p>
                </div>
                <span>{queuePressure} total</span>
              </div>
              ) : null}
            </div>
          </section>

          {sessionUser.isAdmin && adminOverview ? (
            <div id="section-admin">
              <AdminConsole
                session={session}
                sessionUser={sessionUser}
                adminOverview={adminOverview}
                adminUsers={adminUsers}
                onRefresh={onRefreshAdmin}
              />
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
}
