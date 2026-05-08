import { useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { AdminConsole } from "./AdminPanel";
import { BillingPanel } from "./BillingPanel";
import { TeamPanel } from "./TeamPanel";
import { apiFetch } from "../lib/api";
import type {
  AdminFeedbackRequest,
  AdminManagedUser,
  AdminOverview,
  BillingOverview,
  OrganizationAdminOverview,
  SessionUser,
  WorkflowDocument,
  WorkspaceTeam,
} from "../types";
import type { AccountClass } from "../types";

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

function formatStorageAmount(bytes: number) {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }

  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${bytes} B`;
}

function formatStatusLabel(status: string) {
  if (status === "corporate_admin") return "Corporate admin";
  if (status === "corporate_member") return "Corporate member";
  if (status === "personal") return "Personal";
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
  organizationAdminOverview: OrganizationAdminOverview | null;
  adminOverview: AdminOverview | null;
  adminUsers: AdminManagedUser[];
  adminFeedbackRequests: AdminFeedbackRequest[];
  onRefreshTeam: () => Promise<void>;
  onRefreshBilling: () => Promise<void>;
  onRefreshAdmin: () => Promise<void>;
  onSwitchToWorkspace: () => void;
  onNavigateToDocument: (documentId: string) => void;
};

export function AccountAdminPortal({
  session,
  sessionUser,
  documents,
  workspaceTeam,
  billingOverview,
  organizationAdminOverview,
  adminOverview,
  adminUsers,
  adminFeedbackRequests,
  onRefreshTeam,
  onRefreshBilling,
  onRefreshAdmin,
  onSwitchToWorkspace,
  onNavigateToDocument,
}: Props) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [accountActionError, setAccountActionError] = useState<string | null>(null);
  const [accountActionNotice, setAccountActionNotice] = useState<string | null>(null);
  const [transferTargetUserId, setTransferTargetUserId] = useState("");
  const [closeConfirmName, setCloseConfirmName] = useState("");
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
  const licenseSummary = organizationAdminOverview?.licenseSummary ?? null;
  const occupiedLicenseSeats = licenseSummary?.occupiedSeats ?? occupiedSeats;
  const purchasedLicenseSeats = licenseSummary?.purchasedSeats ?? billingOverview?.subscription?.seatCount ?? 0;
  const availableLicenseSeats = licenseSummary?.availableSeats ?? Math.max(0, purchasedLicenseSeats - occupiedSeats);
  const tokenBalance = organizationAdminOverview?.tokens.available ?? billingOverview?.externalTokens.available ?? 0;
  const activeMemberCount = workspaceTeam?.members.length ?? 0;
  const pendingInvitationCount = workspaceTeam?.pendingInvitations.length ?? 0;
  const currentAccountClass: AccountClass | null =
    organizationAdminOverview?.account.accountClass ??
    billingOverview?.workspace.accountClass ??
    workspaceTeam?.members.find((member) => member.isCurrentUser)?.accountClass ??
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
  const includedStorageGb = currentPlan?.includedStorageGb ?? null;
  const usedStorageBytes = billingOverview?.storage.usedBytes ?? 0;
  const usedStorageGb = usedStorageBytes / 1024 ** 3;
  const storageUtilization =
    includedStorageGb && includedStorageGb > 0 ? Math.min(999, Math.round((usedStorageGb / includedStorageGb) * 100)) : null;
  const queuePressure = adminOverview
    ? adminOverview.metrics.pendingNotifications +
      adminOverview.metrics.failedNotifications +
      adminOverview.metrics.queuedProcessingJobs
    : 0;

  const accountAdminWatchlist = [...documents]
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

  const corporateAdminCount = workspaceTeam?.members.filter((member) => member.accountClass === "corporate_admin").length ?? 0;
  const corporateMemberCount = workspaceTeam?.members.filter((member) => member.accountClass === "corporate_member").length ?? 0;
  const accountStatus = organizationAdminOverview?.account.status ?? "active";
  const billingAuthority = organizationAdminOverview?.authority.canManageBilling ?? false;
  const peopleAuthority = organizationAdminOverview?.authority.canManagePeople ?? false;

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

  async function handleChangePrimaryAccountAdmin() {
    if (!transferTargetUserId) {
      setAccountActionError("Choose the new primary account admin first.");
      return;
    }

    const target = organizationAdminOverview?.members.find(
      (member) => member.userId === transferTargetUserId,
    );

    if (!target) {
      setAccountActionError("The new primary account admin must be an active member.");
      return;
    }

    if (
      !window.confirm(
        `Make ${target.displayName} the primary account admin? You will remain an admin on this account.`,
      )
    ) {
      return;
    }

    setAccountActionError(null);
    setAccountActionNotice(null);

    try {
      await apiFetch("/organization-primary-admin", session, {
        method: "POST",
        body: JSON.stringify({ targetUserId: transferTargetUserId }),
      });
      setAccountActionNotice("Primary account admin updated.");
      setTransferTargetUserId("");
      await Promise.all([onRefreshTeam(), onRefreshBilling()]);
    } catch (error) {
      setAccountActionError((error as Error).message);
    }
  }

  async function handleRequestClosure() {
    const accountName = organizationAdminOverview?.account.name;

    if (!accountName || closeConfirmName !== accountName) {
      setAccountActionError("Type the exact organization name before requesting closure.");
      return;
    }

    if (
      !window.confirm(
        "Request account closure? This will mark the account as closing and block new rollout work until the closure is resolved.",
      )
    ) {
      return;
    }

    setAccountActionError(null);
    setAccountActionNotice(null);

    try {
      await apiFetch("/organization-close", session, {
        method: "POST",
        body: JSON.stringify({ confirmName: closeConfirmName }),
      });
      setAccountActionNotice("Account closure requested.");
      setCloseConfirmName("");
      await onRefreshBilling();
    } catch (error) {
      setAccountActionError((error as Error).message);
    }
  }

  return (
    <section className="account-admin-portal">
      <div className="panel account-admin-hero-panel">
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

        {accountStatus === "pending_verification" ? (
          <div className="alert">
            This corporate account is pending EasyDraft verification. You can review the admin center now, but billing,
            team invites, and new workflow sends unlock after the organization is activated.
          </div>
        ) : null}

        {documents.length === 0 || activeMemberCount <= 1 ? (
          <section className="toolbar-card account-admin-summary-card">
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

        <div className="quick-actions account-admin-actions">
          <p className="eyebrow">Account admin actions</p>
          <div className="quick-actions-grid">
            <button className="quick-action-item" onClick={() => scrollToSection("section-attention")} type="button">
              <strong className="quick-action-label">Review watchlist</strong>
              <span className="muted">{accountAdminWatchlist.length} workflow{accountAdminWatchlist.length === 1 ? "" : "s"} need review</span>
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

        <div className="account-admin-metrics-grid">
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
            <strong>
              {purchasedLicenseSeats > 0
                ? `${occupiedLicenseSeats}/${purchasedLicenseSeats}`
                : occupiedLicenseSeats}
            </strong>
            <p>
              {licenseSummary?.overAssignedBy
                ? `${licenseSummary.overAssignedBy} assignment${licenseSummary.overAssignedBy === 1 ? "" : "s"} need more purchased seats.`
                : `${availableLicenseSeats} seat${availableLicenseSeats === 1 ? "" : "s"} available for assignment.`}
            </p>
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
          <div className="metric">
            <span>Account status</span>
            <strong>{formatStatusLabel(accountStatus)}</strong>
            <p>
              {organizationAdminOverview?.account.closingRequestedAt
                ? `Closure requested ${formatShortDate(organizationAdminOverview.account.closingRequestedAt)}.`
                : billingAuthority
                  ? "You can manage billing, seats, tokens, and account posture."
                  : peopleAuthority
                    ? "You can manage people and assigned access without billing authority."
                    : "Your account authority is limited to workspace operations."}
            </p>
          </div>
          <div className="metric">
            <span>Document storage</span>
            <strong>{formatStorageAmount(usedStorageBytes)}</strong>
            <p>
              {storageUtilization !== null && includedStorageGb
                ? `${storageUtilization}% of ${includedStorageGb} GB included on the current plan.`
                : "Storage usage is based on source PDFs plus rendered exports in this workspace."}
            </p>
          </div>
        </div>

        <div className="account-admin-summary-grid">
          <section className="toolbar-card account-admin-summary-card">
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
                <span>{currentAccountClass ? formatStatusLabel(currentAccountClass) : "Admin view"}</span>
              </div>
              <div className="row-card">
                <div>
                  <strong>Role coverage</strong>
                  <p className="muted">
                    {corporateAdminCount} corporate admin{corporateAdminCount === 1 ? "" : "s"}, {corporateMemberCount} corporate member{corporateMemberCount === 1 ? "" : "s"}.
                  </p>
                </div>
                <span>{sessionUser.name}</span>
              </div>
            </div>
          </section>

          <section className="toolbar-card account-admin-summary-card">
            <div className="section-heading compact">
              <p className="eyebrow">Account controls</p>
              <span>{organizationAdminOverview?.account.status ?? "loading"}</span>
            </div>
            <div className="stack">
              {accountActionError ? <div className="alert">{accountActionError}</div> : null}
              {accountActionNotice ? <div className="alert success">{accountActionNotice}</div> : null}
              <div className="row-card">
                <div>
                  <strong>Change primary account admin</strong>
                  <p className="muted">
                    Move primary account control to another active member while keeping the audit trail intact.
                  </p>
                </div>
                <div className="action-row">
                  <select
                    disabled={!organizationAdminOverview?.authority.canChangePrimaryAccountAdmin}
                    value={transferTargetUserId}
                    onChange={(event) => setTransferTargetUserId(event.target.value)}
                  >
                    <option value="">Choose account admin</option>
                    {(organizationAdminOverview?.members ?? [])
                      .filter((member) => !member.isPrimaryAccountAdmin)
                      .map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.displayName}
                        </option>
                      ))}
                  </select>
                  <button
                    className="ghost-button"
                    disabled={!organizationAdminOverview?.authority.canChangePrimaryAccountAdmin || !transferTargetUserId}
                    onClick={handleChangePrimaryAccountAdmin}
                    type="button"
                  >
                    Transfer
                  </button>
                </div>
              </div>
              <div className="row-card">
                <div>
                  <strong>Request account closure</strong>
                  <p className="muted">
                    Puts the organization into a closing state so billing, retention, and export can be handled deliberately.
                  </p>
                </div>
                <div className="stack">
                  <input
                    disabled={!organizationAdminOverview?.authority.canCloseAccount}
                    placeholder={organizationAdminOverview?.account.name ?? "Organization name"}
                    value={closeConfirmName}
                    onChange={(event) => setCloseConfirmName(event.target.value)}
                  />
                  <button
                    className="ghost-button"
                    disabled={
                      !organizationAdminOverview?.authority.canCloseAccount ||
                      closeConfirmName !== organizationAdminOverview.account.name
                    }
                    onClick={handleRequestClosure}
                    type="button"
                  >
                    Request closure
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="toolbar-card account-admin-summary-card">
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
                    {purchasedLicenseSeats > 0
                      ? `${occupiedLicenseSeats} occupied against ${purchasedLicenseSeats} purchased seats.`
                      : `${occupiedLicenseSeats} occupied seats tracked right now.`}
                  </p>
                </div>
                <span>{availableLicenseSeats} available</span>
              </div>
              <div className="row-card">
                <div>
                  <strong>Token balance</strong>
                  <p className="muted">
                    {organizationAdminOverview
                      ? `${organizationAdminOverview.tokens.purchased} purchased and ${organizationAdminOverview.tokens.used} consumed.`
                      : "Token usage will appear here after billing loads."}
                  </p>
                </div>
                <span>{tokenBalance} available</span>
              </div>
            </div>
          </section>

          <section className="toolbar-card account-admin-summary-card">
            <div className="section-heading compact">
              <p className="eyebrow">License assignments</p>
              <span>{organizationAdminOverview?.members.length ?? activeMemberCount} people</span>
            </div>
            <div className="stack">
              {(organizationAdminOverview?.members ?? []).slice(0, 4).map((member) => (
                <div className="row-card" key={member.userId}>
                  <div>
                    <strong>{member.displayName}</strong>
                    <p className="muted">
                      {member.email ?? "No email"} · {formatStatusLabel(member.accountClass)}
                      {member.isPrimaryAccountAdmin ? " · primary account admin" : ""}
                    </p>
                  </div>
                  <span>{formatStatusLabel(member.licenseStatus)}</span>
                </div>
              ))}
              {(organizationAdminOverview?.pendingInvitations ?? []).slice(0, 3).map((invitation) => (
                <div className="row-card" key={invitation.id}>
                  <div>
                    <strong>{invitation.email}</strong>
                    <p className="muted">
                      Pending invite · {formatStatusLabel(invitation.accountClass)} · expires {formatShortDate(invitation.expiresAt)}
                    </p>
                  </div>
                  <span>{formatStatusLabel(invitation.licenseStatus)}</span>
                </div>
              ))}
              {!organizationAdminOverview ? (
                <p className="muted">Account license detail is loading. Refresh if this persists.</p>
              ) : organizationAdminOverview.members.length === 0 && organizationAdminOverview.pendingInvitations.length === 0 ? (
                <p className="muted">No license assignments exist yet.</p>
              ) : null}
            </div>
          </section>

          <section className="toolbar-card account-admin-summary-card">
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
                <span>{accountAdminWatchlist.length} flagged</span>
              </div>
            </div>
          </section>

          <section className="toolbar-card account-admin-summary-card">
            <div className="section-heading compact">
              <p className="eyebrow">Storage snapshot</p>
              <span>{formatStorageAmount(usedStorageBytes)}</span>
            </div>
            <div className="stack">
              <div className="row-card">
                <div>
                  <strong>Retention posture</strong>
                  <p className="muted">
                    {billingOverview?.storage.temporaryDocumentCount ?? 0} temporary document{(billingOverview?.storage.temporaryDocumentCount ?? 0) === 1 ? "" : "s"} and {billingOverview?.storage.retainedDocumentCount ?? 0} retained document{(billingOverview?.storage.retainedDocumentCount ?? 0) === 1 ? "" : "s"} currently occupy storage.
                  </p>
                </div>
                <span>{billingOverview?.storage.purgeScheduledCount ?? 0} scheduled</span>
              </div>
              <div className="row-card">
                <div>
                  <strong>Capacity view</strong>
                  <p className="muted">
                    {storageUtilization !== null && includedStorageGb
                      ? `${formatStorageAmount(usedStorageBytes)} used against ${includedStorageGb} GB included.`
                      : "Select or start a paid plan to compare current storage against the included allowance."}
                  </p>
                </div>
                <span>{billingOverview?.storage.purgedDocumentCount ?? 0} purged</span>
              </div>
            </div>
          </section>
        </div>
      </div>

      <section className="account-admin-portal-grid">
        <div className="stack">
          <section className="card" id="section-attention">
            <div className="section-heading compact">
              <p className="eyebrow">Needs attention now</p>
              <span>{accountAdminWatchlist.length} items</span>
            </div>
            <div className="stack">
              {accountAdminWatchlist.length === 0 ? (
                <p className="muted">No workflows need attention right now.</p>
              ) : (
                accountAdminWatchlist.map((document) => {
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
                        <div className="account-admin-watchlist-heading">
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
                adminFeedbackRequests={adminFeedbackRequests}
                onRefresh={onRefreshAdmin}
              />
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
}
