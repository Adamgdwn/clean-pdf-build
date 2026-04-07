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
      (document.workflowState !== "completed" && document.waitingOn.isOverdue),
  ).length;

  const occupiedSeats = workspaceTeam
    ? workspaceTeam.members.length + workspaceTeam.pendingInvitations.length
    : 0;
  const availableSeats = billingOverview?.subscription?.seatCount ?? 0;
  const tokenBalance = billingOverview?.externalTokens.available ?? 0;

  const ownerWatchlist = [...documents]
    .filter(
      (document) =>
        document.isOverdue ||
        document.operationalStatus === "changes_requested" ||
        (document.operationalStatus === "active" && document.workflowState !== "completed"),
    )
    .sort((left, right) => {
      if (left.isOverdue !== right.isOverdue) {
        return left.isOverdue ? -1 : 1;
      }

      return (right.sentAt ?? right.uploadedAt).localeCompare(left.sentAt ?? left.uploadedAt);
    })
    .slice(0, 5);

  return (
    <section className="owner-portal">
      <div className="panel owner-hero-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Owner portal</p>
            <h3>Monitor company activity, team access, billing, and follow-up in one place</h3>
          </div>
          <button className="secondary-button" onClick={() => {
            onRefreshBilling();
            onRefreshTeam();
            onRefreshAdmin();
          }}>
            Refresh owner data
          </button>
        </div>
        <p className="muted action-note">
          This is the company control area for owners and representatives. Use the workspace area
          for day-to-day document prep, signing, and routing.
        </p>
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
                      <p className="muted">
                        {document.waitingOn.summary}
                      </p>
                      <p className="muted">
                        {document.isOverdue ? "Overdue" : document.operationalStatus.replaceAll("_", " ")} ·
                        last activity {formatTimestamp(document.sentAt ?? document.uploadedAt)}
                      </p>
                    </div>
                    <span>{document.deliveryMode.replaceAll("_", " ")}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          {billingOverview ? (
            <BillingPanel session={session} billingOverview={billingOverview} />
          ) : null}

          {workspaceTeam ? (
            <TeamPanel
              session={session}
              team={workspaceTeam}
              billingOverview={billingOverview}
              onTeamRefresh={onRefreshTeam}
            />
          ) : null}
        </div>

        <div className="stack">
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
                    <strong>Workspace overview</strong>
                    <p className="muted">
                      Keep team access, subscription choices, and invitation flow under one roof.
                    </p>
                  </div>
                </div>
                <div className="row-card">
                  <div>
                    <strong>Operational visibility</strong>
                    <p className="muted">
                      Use the watchlist and billing summary here before switching back into the user workspace.
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
