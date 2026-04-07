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

type Props = {
  session: Session;
  sessionUser: SessionUser;
  documents: WorkflowDocument[];
  workspaceTeam: WorkspaceTeam | null;
  billingOverview: BillingOverview | null;
  adminOverview: AdminOverview | null;
  adminUsers: AdminManagedUser[];
  onRefreshTeam: () => void;
  onRefreshBilling: () => void;
  onRefreshAdmin: () => void;
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
}: Props) {
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
  const selfManagedDocuments = documents.filter((document) => document.deliveryMode === "self_managed").length;
  const internalDocuments = documents.filter((document) => document.deliveryMode === "internal_use_only").length;
  const managedDocuments = documents.filter((document) => document.deliveryMode === "platform_managed").length;

  const subscription = billingOverview?.subscription ?? null;
  const currentPlan = subscription
    ? billingOverview?.plans.find((plan) => plan.key === subscription.planKey) ?? null
    : null;
  const currentPlanName = currentPlan?.name ?? "No plan selected yet";
  const subscriptionStatus = subscriptionStatusLabel(subscription?.status ?? null);
  const renewsOn = subscription?.currentPeriodEnd ? formatShortDate(subscription.currentPeriodEnd) : null;
  const trialEndsOn = subscription?.trialEndsAt ? formatShortDate(subscription.trialEndsAt) : null;

  const ownerWatchlist = [...documents]
    .filter(
      (document) =>
        document.isOverdue ||
        document.operationalStatus === "changes_requested" ||
        document.operationalStatus === "rejected" ||
        (document.operationalStatus === "active" && document.workflowState !== "completed"),
    )
    .sort((left, right) => {
      if (left.isOverdue !== right.isOverdue) {
        return left.isOverdue ? -1 : 1;
      }

      return (right.sentAt ?? right.uploadedAt).localeCompare(left.sentAt ?? left.uploadedAt);
    })
    .slice(0, 5);

  const recentDocuments = [...documents]
    .sort((left, right) => (right.sentAt ?? right.uploadedAt).localeCompare(left.sentAt ?? left.uploadedAt))
    .slice(0, 6);

  const memberPreview = workspaceTeam?.members.slice(0, 4) ?? [];
  const ownerCount = workspaceTeam?.members.filter((member) => member.role === "owner").length ?? 0;
  const adminCount = workspaceTeam?.members.filter((member) => member.role === "admin").length ?? 0;
  const billingAdminCount = workspaceTeam?.members.filter((member) => member.role === "billing_admin").length ?? 0;

  return (
    <section className="owner-portal">
      <div className="panel owner-hero-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Owner portal</p>
            <h3>Company dashboard for oversight, access, billing, and operational follow-through</h3>
          </div>
          <button
            className="secondary-button"
            onClick={() => {
              onRefreshBilling();
              onRefreshTeam();
              onRefreshAdmin();
            }}
          >
            Refresh owner data
          </button>
        </div>
        <p className="muted action-note">
          Use this area like a control room: monitor your team, subscription posture, workflow
          backlog, and who needs attention before switching back into the day-to-day workspace.
        </p>

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
                    {activeMemberCount} active member{activeMemberCount === 1 ? "" : "s"} and{" "}
                    {pendingInvitationCount} pending invite{pendingInvitationCount === 1 ? "" : "s"}.
                  </p>
                </div>
                <span>{currentMembershipRole ? formatStatusLabel(currentMembershipRole) : "Owner view"}</span>
              </div>
              <div className="row-card">
                <div>
                  <strong>Role mix</strong>
                  <p className="muted">
                    {ownerCount} owner{ownerCount === 1 ? "" : "s"}, {adminCount} admin
                    {adminCount === 1 ? "" : "s"}, {billingAdminCount} billing admin
                    {billingAdminCount === 1 ? "" : "s"}.
                  </p>
                </div>
                <span>{sessionUser.name}</span>
              </div>
              <div className="row-card">
                <div>
                  <strong>Vault posture</strong>
                  <p className="muted">
                    Keep drafts, signed previews, and final exports in one searchable company vault
                    instead of scattered folders and inboxes.
                  </p>
                </div>
                <span>Private storage</span>
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
              <div className="row-card">
                <div>
                  <strong>Renewal timing</strong>
                  <p className="muted">
                    {trialEndsOn
                      ? `Trial ends ${trialEndsOn}.`
                      : renewsOn
                        ? `Next billing date ${renewsOn}.`
                        : "No renewal date scheduled yet."}
                  </p>
                </div>
                <span>{billingOverview?.plans.length ?? 0} plans</span>
              </div>
            </div>
          </section>

          <section className="toolbar-card owner-summary-card">
            <div className="section-heading compact">
              <p className="eyebrow">Workflow posture</p>
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
                  <strong>Routing mix</strong>
                  <p className="muted">
                    {selfManagedDocuments} self-managed, {internalDocuments} internal-only, {managedDocuments} managed-send.
                  </p>
                </div>
                <span>{overdueDocuments} overdue</span>
              </div>
              <div className="row-card">
                <div>
                  <strong>Follow-up load</strong>
                  <p className="muted">
                    {actionNeededDocuments > 0
                      ? `${actionNeededDocuments} workflow${actionNeededDocuments === 1 ? "" : "s"} need a nudge, review, or correction.`
                      : "No urgent workflow follow-up is waiting on you right now."}
                  </p>
                </div>
                <span>{ownerWatchlist.length} watchlist</span>
              </div>
            </div>
          </section>
        </div>

        <div className="owner-metrics-grid">
          <div className="metric">
            <span>Active workflows</span>
            <strong>{activeDocuments}</strong>
            <p>Documents currently moving through routing, signatures, or approvals.</p>
          </div>
          <div className="metric">
            <span>Completed</span>
            <strong>{completedDocuments}</strong>
            <p>Finished documents with exports and audit trail available.</p>
          </div>
          <div className="metric">
            <span>Action needed</span>
            <strong>{actionNeededDocuments}</strong>
            <p>Overdue items or workflows waiting on requested changes.</p>
          </div>
          <div className="metric">
            <span>Seats in use</span>
            <strong>{availableSeats > 0 ? `${occupiedSeats}/${availableSeats}` : occupiedSeats}</strong>
            <p>Members plus pending invitations compared with subscribed capacity.</p>
          </div>
          <div className="metric">
            <span>External tokens</span>
            <strong>{tokenBalance}</strong>
            <p>Prepaid managed-send capacity available for outside signers.</p>
          </div>
          <div className="metric">
            <span>Overdue</span>
            <strong>{overdueDocuments}</strong>
            <p>Workflows that need a nudge, a reminder, or a reset in priority.</p>
          </div>
        </div>
      </div>

      <section className="owner-portal-grid">
        <div className="stack">
          <section className="card">
            <div className="section-heading compact">
              <p className="eyebrow">Company watchlist</p>
              <span>{ownerWatchlist.length} items</span>
            </div>
            <div className="stack">
              {ownerWatchlist.length === 0 ? (
                <p className="muted">No workflows need attention right now.</p>
              ) : (
                ownerWatchlist.map((document) => (
                  <div key={document.id} className="row-card">
                    <div>
                      <strong>{document.name}</strong>
                      <p className="muted">{document.waitingOn.summary}</p>
                      <p className="muted">
                        {document.isOverdue ? "Overdue" : formatStatusLabel(document.operationalStatus)} · last
                        activity {formatTimestamp(document.sentAt ?? document.uploadedAt)}
                      </p>
                    </div>
                    <span>{formatStatusLabel(document.deliveryMode)}</span>
                  </div>
                ))
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
                <p className="muted">No documents exist yet. Upload a PDF to start building the company trail.</p>
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

          {billingOverview ? (
            <BillingPanel session={session} billingOverview={billingOverview} />
          ) : (
            <section className="card">
              <div className="section-heading compact">
                <p className="eyebrow">Billing</p>
                <span>Loading</span>
              </div>
              <p className="muted">
                Commercial details are still loading. Refresh owner data to pull current plan,
                renewal, and token information into this dashboard.
              </p>
            </section>
          )}

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
                <span>Loading</span>
              </div>
              <p className="muted">
                Team membership and invitations are still loading. Refresh owner data to sync access controls.
              </p>
            </section>
          )}
        </div>

        <div className="stack">
          <section className="card">
            <div className="section-heading compact">
              <p className="eyebrow">People and access</p>
              <span>{activeMemberCount} members</span>
            </div>
            <div className="stack">
              <div className="row-card">
                <div>
                  <strong>Access coverage</strong>
                  <p className="muted">
                    {activeMemberCount} active member{activeMemberCount === 1 ? "" : "s"} across your company workspace.
                  </p>
                </div>
                <span>{pendingInvitationCount} pending</span>
              </div>
              {memberPreview.length === 0 ? (
                <p className="muted">No members are loaded yet.</p>
              ) : (
                memberPreview.map((member) => (
                  <div key={member.userId} className="row-card">
                    <div>
                      <strong>{member.displayName}{member.isCurrentUser ? " (you)" : ""}</strong>
                      <p className="muted">{member.email ?? "No email"}</p>
                    </div>
                    <span>{formatStatusLabel(member.role)}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="card">
            <div className="section-heading compact">
              <p className="eyebrow">System posture</p>
              <span>{billingOverview?.billingMode === "placeholder" ? "Pilot mode" : "Production mode"}</span>
            </div>
            <div className="stack">
              <div className="row-card">
                <div>
                  <strong>Workspace identity</strong>
                  <p className="muted">
                    {workspaceTeam?.workspace.name ?? billingOverview?.workspace.name ?? "Workspace"}{" "}
                    is your shared operating space for drafts, approvals, signatures, and exports.
                  </p>
                </div>
                <span>{billingOverview?.workspace.workspaceType ?? "team"}</span>
              </div>
              <div className="row-card">
                <div>
                  <strong>Commercial readiness</strong>
                  <p className="muted">
                    {billingOverview?.billingMode === "placeholder"
                      ? "Billing is still in testing mode, so owners can validate plans and flows before live charging."
                      : "Billing is live, so renewals, seats, and token purchases should be treated as production operations."}
                  </p>
                </div>
                <span>{subscriptionStatus}</span>
              </div>
              <div className="row-card">
                <div>
                  <strong>Storage story</strong>
                  <p className="muted">
                    EasyDraft acts like a clean company vault: private uploads, tidy handoffs,
                    reusable signatures, and completed exports all stay linked to the workflow trail.
                  </p>
                </div>
                <span>Vault ready</span>
              </div>
            </div>
          </section>

          {sessionUser.isAdmin && adminOverview ? (
            <AdminConsole
              session={session}
              sessionUser={sessionUser}
              adminOverview={adminOverview}
              adminUsers={adminUsers}
              onRefresh={onRefreshAdmin}
            />
          ) : (
            <section className="card">
              <div className="section-heading compact">
                <p className="eyebrow">Owner controls</p>
                <span>{workspaceTeam?.workspace.name ?? "Company"}</span>
              </div>
              <div className="stack">
                <div className="row-card">
                  <div>
                    <strong>Company oversight</strong>
                    <p className="muted">
                      Review team access, plan posture, and workflow health here before jumping into document prep.
                    </p>
                  </div>
                </div>
                <div className="row-card">
                  <div>
                    <strong>Executive visibility</strong>
                    <p className="muted">
                      Keep owners and representatives aligned on what is active, what is overdue, and who still needs access.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </section>
    </section>
  );
}
