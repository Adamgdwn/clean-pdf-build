import { useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";

import { apiFetch } from "../lib/api";
import type { AdminFeedbackRequest, AdminManagedUser, AdminOverview, SessionUser } from "../types";

function formatTimestamp(timestamp: string | null) {
  if (!timestamp) return "Not set";
  return new Date(timestamp).toLocaleString();
}

function formatFeedbackLabel(value: string) {
  return value.replaceAll("_", " ");
}

function formatProfileKind(value: AdminManagedUser["profileKind"]) {
  if (!value) return "Unclassified";
  if (value === "easydraft_staff") return "EasyDraft staff";
  return "EasyDraft user";
}

// ─── Sidebar summary card ────────────────────────────────────────────────────

type SidebarProps = {
  adminOverview: AdminOverview;
  adminUsers: AdminManagedUser[];
};

export function AdminSidebarSummary({ adminOverview, adminUsers }: SidebarProps) {
  return (
    <section className="card">
      <div className="section-heading compact">
        <p className="eyebrow">Admin</p>
        <span>{adminUsers.length} accounts</span>
      </div>
      <div className="stack">
        <div className="admin-metrics">
          <div className="metric">
            <span>Users</span>
            <strong>{adminOverview.metrics.totalUsers}</strong>
          </div>
          <div className="metric">
            <span>Workspaces</span>
            <strong>{adminOverview.metrics.totalWorkspaces}</strong>
          </div>
          <div className="metric">
            <span>Documents</span>
            <strong>{adminOverview.metrics.totalDocuments}</strong>
          </div>
          <div className="metric">
            <span>MRR</span>
            <strong>${adminOverview.metrics.estimatedMrrUsd}</strong>
          </div>
        </div>
        <p className="muted">
          Full admin tools are available in the main workspace, including account status,
          privilege review, password resets, and delete controls for testing.
        </p>
        {adminOverview.recentSubscriptions.slice(0, 3).map((subscription) => (
          <div key={subscription.id} className="row-card">
            <div>
              <strong>{subscription.billing_plan_key}</strong>
              <p className="muted">
                {subscription.status} · {subscription.seat_count} seats
              </p>
            </div>
            <span>{formatTimestamp(subscription.current_period_end)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Full admin console panel ─────────────────────────────────────────────────

type ConsoleProps = {
  session: Session;
  sessionUser: SessionUser;
  adminOverview: AdminOverview;
  adminUsers: AdminManagedUser[];
  adminFeedbackRequests: AdminFeedbackRequest[];
  onRefresh: () => void;
};

export function AdminConsole({
  session,
  sessionUser,
  adminOverview,
  adminUsers,
  adminFeedbackRequests,
  onRefresh,
}: ConsoleProps) {
  const [adminInviteName, setAdminInviteName] = useState("");
  const [adminInviteEmail, setAdminInviteEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, {
    status: AdminFeedbackRequest["status"];
    priority: AdminFeedbackRequest["priority"];
    ownerUserId: string | null;
    resolutionNote: string;
  }>>({});

  function getFeedbackDraft(feedbackRequest: AdminFeedbackRequest) {
    return feedbackDrafts[feedbackRequest.id] ?? {
      status: feedbackRequest.status,
      priority: feedbackRequest.priority,
      ownerUserId: feedbackRequest.ownerUserId,
      resolutionNote: feedbackRequest.resolutionNote ?? "",
    };
  }

  function updateFeedbackDraft(
    feedbackRequestId: string,
    patch: Partial<ReturnType<typeof getFeedbackDraft>>,
  ) {
    setFeedbackDrafts((current) => ({
      ...current,
      [feedbackRequestId]: {
        ...(current[feedbackRequestId] ?? {
          status: "new" as const,
          priority: "medium" as const,
          ownerUserId: null,
          resolutionNote: "",
        }),
        ...patch,
      },
    }));
  }

  async function handleAdminSendPasswordReset(userId: string) {
    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      const payload = await apiFetch<{ email: string; redirectTo: string }>("/admin-user-reset", session, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      setNoticeMessage(`Password reset email sent to ${payload.email}.`);
      onRefresh();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAdminInviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      const payload = await apiFetch<{
        email: string;
        status: "invited" | "existing_account" | "pending_invite";
        redirectTo: string;
      }>("/admin-user-invite", session, {
        method: "POST",
        body: JSON.stringify({
          email: adminInviteEmail,
          displayName: adminInviteName.trim() || undefined,
        }),
      });

      if (payload.status === "invited") {
        setNoticeMessage(
          `Invite email sent to ${payload.email}. They can finish signup and land back in EasyDraft at ${payload.redirectTo}.`,
        );
      } else if (payload.status === "pending_invite") {
        setNoticeMessage(
          `${payload.email} already has a pending invite or unconfirmed account. Ask them to use the original invite email or resend from Supabase if needed.`,
        );
      } else {
        setNoticeMessage(
          `${payload.email} already has an account. Ask them to sign in directly, or use password reset if they need help getting back in.`,
        );
      }

      setAdminInviteName("");
      setAdminInviteEmail("");
      onRefresh();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAdminDeleteUser(userId: string) {
    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);
    setConfirmDeleteUserId(null);

    try {
      const payload = await apiFetch<{ email: string; deletedUserId: string }>(
        "/admin-user-delete",
        session,
        { method: "POST", body: JSON.stringify({ userId }) },
      );
      setNoticeMessage(`${payload.email} was deleted from EasyDraft.`);
      onRefresh();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveFeedback(feedbackRequest: AdminFeedbackRequest) {
    const draft = getFeedbackDraft(feedbackRequest);
    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await apiFetch("/admin-feedback", session, {
        method: "POST",
        body: JSON.stringify({
          feedbackRequestId: feedbackRequest.id,
          status: draft.status,
          priority: draft.priority,
          ownerUserId: draft.ownerUserId,
          resolutionNote: draft.resolutionNote.trim() || null,
        }),
      });
      setNoticeMessage(`Updated feedback item "${feedbackRequest.title}".`);
      setFeedbackDrafts((current) => {
        const next = { ...current };
        delete next[feedbackRequest.id];
        return next;
      });
      onRefresh();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  const openFeedbackCount = adminFeedbackRequests.filter((request) => request.status !== "closed").length;
  const unassignedFeedbackCount = adminFeedbackRequests.filter((request) => !request.ownerUserId).length;
  const highPriorityFeedbackCount = adminFeedbackRequests.filter((request) => request.priority === "high").length;

  return (
    <section className="panel admin-console-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Admin console</p>
          <h3>Review accounts, privileges, and testing access in one place</h3>
        </div>
        <button
          className="secondary-button"
          disabled={isLoading}
          onClick={onRefresh}
        >
          Refresh admin data
        </button>
      </div>

      {errorMessage ? <div className="alert">{errorMessage}</div> : null}
      {noticeMessage ? <div className="alert success">{noticeMessage}</div> : null}

      <div className="split admin-console-grid">
        <div className="stack">
          <div className="admin-metrics">
            <div className="metric">
              <span>Users</span>
              <strong>{adminOverview.metrics.totalUsers}</strong>
            </div>
          <div className="metric">
            <span>Queued emails</span>
            <strong>{adminOverview.metrics.pendingNotifications}</strong>
          </div>
          <div className="metric">
            <span>Failed emails</span>
            <strong>{adminOverview.metrics.failedNotifications}</strong>
          </div>
          <div className="metric">
            <span>Workspaces</span>
            <strong>{adminOverview.metrics.totalWorkspaces}</strong>
            </div>
            <div className="metric">
              <span>Documents</span>
              <strong>{adminOverview.metrics.totalDocuments}</strong>
            </div>
          </div>

          <div className="toolbar-card">
            <div className="section-heading compact">
              <p className="eyebrow">Queues</p>
              <span>Operational visibility</span>
            </div>
            <div className="stack">
              <div className="row-card">
                <div>
                  <strong>Notifications</strong>
                  <p className="muted">
                    {adminOverview.metrics.pendingNotifications} queued · {adminOverview.metrics.failedNotifications} failed
                  </p>
                </div>
                <span>{formatTimestamp(adminOverview.metrics.oldestPendingNotificationAt)}</span>
              </div>
              <div className="row-card">
                <div>
                  <strong>Processing jobs</strong>
                  <p className="muted">
                    {adminOverview.metrics.queuedProcessingJobs} queued or running
                  </p>
                </div>
                <span>{formatTimestamp(adminOverview.metrics.oldestQueuedProcessingAt)}</span>
              </div>
            </div>
          </div>

          <div className="toolbar-card">
            <div className="section-heading compact">
              <p className="eyebrow">Invite testers</p>
              <span>Supabase auth invite</span>
            </div>
            <p className="muted action-note">
              Send a tester into EasyDraft before assigning documents. Once they sign in with the invited
              email, any pending collaborator or signer access for that email attaches automatically.
            </p>
            <form className="stack form-block" onSubmit={handleAdminInviteUser}>
              <label className="form-field">
                <span>Name</span>
                <input
                  value={adminInviteName}
                  onChange={(event) => setAdminInviteName(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Email</span>
                <input
                  required
                  type="email"
                  value={adminInviteEmail}
                  onChange={(event) => setAdminInviteEmail(event.target.value)}
                />
              </label>
              <button
                className="secondary-button"
                disabled={isLoading || !adminInviteEmail.trim()}
                type="submit"
              >
                Send tester invite
              </button>
            </form>
          </div>

          <div className="toolbar-card">
            <div className="section-heading compact">
              <p className="eyebrow">Recent workspaces</p>
              <span>{adminOverview.recentWorkspaces.length}</span>
            </div>
            <div className="stack">
              {adminOverview.recentWorkspaces.slice(0, 4).map((workspace) => (
                <div key={workspace.id} className="row-card">
                  <div>
                    <strong>{workspace.name}</strong>
                    <p className="muted">
                      {workspace.workspace_type} · {workspace.slug}
                    </p>
                  </div>
                  <span>{formatTimestamp(workspace.created_at)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="toolbar-card">
            <div className="section-heading compact">
              <p className="eyebrow">Feedback queue</p>
              <span>{adminFeedbackRequests.length}</span>
            </div>
            <p className="muted action-note">
              Keep bug reports and feature requests moving with a lightweight operator loop: assign, prioritize,
              update status, and close with a note.
            </p>
            <div className="admin-metrics">
              <div className="metric">
                <span>Open</span>
                <strong>{openFeedbackCount}</strong>
              </div>
              <div className="metric">
                <span>Unassigned</span>
                <strong>{unassignedFeedbackCount}</strong>
              </div>
              <div className="metric">
                <span>High priority</span>
                <strong>{highPriorityFeedbackCount}</strong>
              </div>
            </div>
            <div className="stack" style={{ marginTop: "1rem" }}>
              {adminFeedbackRequests.length === 0 ? (
                <p className="muted">No feedback has been submitted yet.</p>
              ) : (
                adminFeedbackRequests.slice(0, 8).map((feedbackRequest) => {
                  const draft = getFeedbackDraft(feedbackRequest);

                  return (
                    <div key={feedbackRequest.id} className="row-card" style={{ display: "block" }}>
                      <div className="section-heading compact">
                        <p className="eyebrow">{feedbackRequest.feedbackType === "bug_report" ? "Bug report" : "Feature request"}</p>
                        <span>{formatFeedbackLabel(feedbackRequest.status)} · {feedbackRequest.priority}</span>
                      </div>
                      <strong>{feedbackRequest.title}</strong>
                      <p className="muted">
                        {feedbackRequest.requesterEmail} · {formatTimestamp(feedbackRequest.createdAt)}
                      </p>
                      <p className="muted">
                        Source: {formatFeedbackLabel(feedbackRequest.source)}
                        {feedbackRequest.requestedPath ? ` · ${feedbackRequest.requestedPath}` : ""}
                      </p>
                      <p className="muted" style={{ whiteSpace: "pre-wrap" }}>{feedbackRequest.details}</p>
                      <div className="form-grid compact-grid">
                        <label className="form-field">
                          <span>Status</span>
                          <select
                            value={draft.status}
                            onChange={(event) =>
                              updateFeedbackDraft(feedbackRequest.id, {
                                status: event.target.value as AdminFeedbackRequest["status"],
                              })
                            }
                          >
                            <option value="new">New</option>
                            <option value="acknowledged">Acknowledged</option>
                            <option value="planned">Planned</option>
                            <option value="in_progress">In progress</option>
                            <option value="closed">Closed</option>
                          </select>
                        </label>
                        <label className="form-field">
                          <span>Priority</span>
                          <select
                            value={draft.priority}
                            onChange={(event) =>
                              updateFeedbackDraft(feedbackRequest.id, {
                                priority: event.target.value as AdminFeedbackRequest["priority"],
                              })
                            }
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                        </label>
                      </div>
                      <p className="muted">
                        Owner: {feedbackRequest.ownerDisplayName ?? "Unassigned"}
                        {feedbackRequest.ownerEmail ? ` (${feedbackRequest.ownerEmail})` : ""}
                      </p>
                      <label className="form-field">
                        <span>Resolution note</span>
                        <textarea
                          rows={3}
                          value={draft.resolutionNote}
                          onChange={(event) =>
                            updateFeedbackDraft(feedbackRequest.id, { resolutionNote: event.target.value })
                          }
                          placeholder="Capture the fix, decision, workaround, or reason for closing."
                        />
                      </label>
                      <div className="action-row action-wrap">
                        <button
                          className="ghost-button"
                          disabled={isLoading}
                          onClick={() => updateFeedbackDraft(feedbackRequest.id, { ownerUserId: sessionUser.id })}
                          type="button"
                        >
                          Assign to me
                        </button>
                        <button
                          className="ghost-button"
                          disabled={isLoading}
                          onClick={() => updateFeedbackDraft(feedbackRequest.id, { ownerUserId: null })}
                          type="button"
                        >
                          Unassign
                        </button>
                        <button
                          className="secondary-button"
                          disabled={isLoading}
                          onClick={() => handleSaveFeedback(feedbackRequest)}
                          type="button"
                        >
                          Save feedback update
                        </button>
                      </div>
                      <p className="muted">
                        Last updated: {formatTimestamp(feedbackRequest.updatedAt)}
                        {feedbackRequest.updatedByDisplayName ? ` by ${feedbackRequest.updatedByDisplayName}` : ""}
                        {feedbackRequest.resolvedAt ? ` · closed ${formatTimestamp(feedbackRequest.resolvedAt)}` : ""}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="toolbar-card">
          <div className="section-heading compact">
            <p className="eyebrow">Accounts</p>
            <span>{adminUsers.length}</span>
          </div>
          <p className="muted action-note">
            Use this view to confirm account status, see who has admin access, trigger password resets,
            and delete test accounts when you need a clean slate.
          </p>
          <div className="stack admin-user-list">
            {adminUsers.length === 0 ? (
              <p className="muted">No user accounts exist yet.</p>
            ) : (
              adminUsers.map((adminUser) => (
                <div key={adminUser.id} className="row-card admin-user-card">
                  <div className="admin-user-copy">
                    <strong>
                      {adminUser.id === sessionUser.id ? "You" : adminUser.displayName}
                    </strong>
                    <p className="muted">{adminUser.email}</p>
                    <p className="muted">
                      {adminUser.status === "confirmed" ? "Confirmed" : "Pending confirmation"} ·
                      created {formatTimestamp(adminUser.createdAt)}
                    </p>
                    <p className="muted">
                      Last sign in: {formatTimestamp(adminUser.lastSignInAt)} · workspaces:{" "}
                      {adminUser.workspaceCount} · documents: {adminUser.documentCount}
                    </p>
                    {adminUser.companyName ? (
                      <p className="muted">Company: {adminUser.companyName}</p>
                    ) : null}
                    <p className="muted">Profile: {formatProfileKind(adminUser.profileKind)}</p>
                    <p className="muted">
                      Privileges: {adminUser.privilegeLabels.join(", ")}
                    </p>
                  </div>
                  <div className="field-actions">
                    {adminUser.isPlatformAdmin ? <span>Platform admin</span> : null}
                    <button
                      className="ghost-button"
                      disabled={isLoading}
                      onClick={() => handleAdminSendPasswordReset(adminUser.id)}
                      type="button"
                    >
                      Send reset email
                    </button>
                    {confirmDeleteUserId === adminUser.id ? (
                      <div className="delete-confirm-inline">
                        <p className="muted delete-confirm-warning">
                          Permanently deletes this account and all associated data. Cannot be undone.
                        </p>
                        <div className="row-inline">
                          <button
                            className="ghost-button danger-button"
                            disabled={isLoading}
                            onClick={() => handleAdminDeleteUser(adminUser.id)}
                            type="button"
                          >
                            Confirm delete
                          </button>
                          <button
                            className="ghost-button"
                            onClick={() => setConfirmDeleteUserId(null)}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="ghost-button danger-button"
                        disabled={isLoading || !adminUser.canDelete}
                        onClick={() => setConfirmDeleteUserId(adminUser.id)}
                        type="button"
                      >
                        Delete user
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
