import { useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";

import { apiFetch } from "../lib/api";
import type { BillingOverview, WorkspaceTeam, WorkspaceTeamInvitation } from "../types";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  billing_admin: "Billing admin",
};

type Props = {
  session: Session;
  team: WorkspaceTeam;
  billingOverview: BillingOverview | null;
  onTeamRefresh: () => void;
};

export function TeamPanel({ session, team, billingOverview, onTeamRefresh }: Props) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "member" | "admin" | "billing_admin">("member");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [workspaceName, setWorkspaceName] = useState(team.workspace.name);
  const [editingRoleUserId, setEditingRoleUserId] = useState<string | null>(null);
  const [editingRoleValue, setEditingRoleValue] = useState<"owner" | "member" | "admin" | "billing_admin">("member");
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<string | null>(null);

  const subscription = billingOverview?.subscription ?? null;
  const isOwnerOrAdmin = team.members.some(
    (m) => m.isCurrentUser && ["owner", "admin"].includes(m.role),
  );
  const isCurrentUserOwner = team.members.some((m) => m.isCurrentUser && m.role === "owner");

  const totalOccupied = team.members.length + team.pendingInvitations.length;
  const seatCount = subscription?.seatCount ?? 0;
  const isSubscribed = subscription && ["active", "trialing"].includes(subscription.status);
  const overSeat = isSubscribed && totalOccupied > seatCount;

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inviteEmail.trim()) return;

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      const result = await apiFetch<{ invitation: { email: string }; seatWarning: string | null }>(
        "/workspace-invite",
        session,
        { method: "POST", body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }) },
      );
      setInviteEmail("");
      setNoticeMessage(`Invitation sent to ${result.invitation.email}.${result.seatWarning ? ` ${result.seatWarning}` : ""}`);
      onTeamRefresh();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResend(invitation: WorkspaceTeamInvitation) {
    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await apiFetch("/workspace-invite-resend", session, {
        method: "POST",
        body: JSON.stringify({ invitationId: invitation.id }),
      });
      setNoticeMessage(`Invite resent to ${invitation.email}.`);
      onTeamRefresh();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRevoke(invitation: WorkspaceTeamInvitation) {
    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await apiFetch(`/workspace-invite?invitationId=${encodeURIComponent(invitation.id)}`, session, {
        method: "DELETE",
      });
      setNoticeMessage(`Invitation to ${invitation.email} revoked.`);
      onTeamRefresh();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceName.trim()) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      await apiFetch("/workspace-update", session, {
        method: "PATCH",
        body: JSON.stringify({ name: workspaceName.trim() }),
      });
      setEditingName(false);
      setNoticeMessage("Workspace name updated.");
      onTeamRefresh();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSendReset(userId: string, email: string | null) {
    if (!email) return;

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      const payload = await apiFetch<{ email: string }>("/workspace-member-reset", session, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      setNoticeMessage(`Password reset email sent to ${payload.email}.`);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleChangeRole(userId: string) {
    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);
    setEditingRoleUserId(null);

    try {
      await apiFetch("/workspace-member-role", session, {
        method: "PATCH",
        body: JSON.stringify({ userId, role: editingRoleValue }),
      });
      setNoticeMessage("Role updated.");
      onTeamRefresh();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);
    setConfirmRemoveUserId(null);

    try {
      await apiFetch("/workspace-member", session, {
        method: "DELETE",
        body: JSON.stringify({ userId }),
      });
      setNoticeMessage("Member removed from workspace.");
      onTeamRefresh();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="card">
      <div className="section-heading compact">
        <p className="eyebrow">Team</p>
        {isOwnerOrAdmin && !editingName ? (
          <button
            className="ghost-button"
            onClick={() => { setEditingName(true); setWorkspaceName(team.workspace.name); }}
            type="button"
          >
            Rename
          </button>
        ) : null}
      </div>

      {errorMessage ? <div className="alert">{errorMessage}</div> : null}
      {noticeMessage ? <div className="alert success">{noticeMessage}</div> : null}

      <div className="stack">
        {/* Workspace name */}
        {editingName ? (
          <form className="row-card" onSubmit={handleSaveName}>
            <input
              autoFocus
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="secondary-button" disabled={isLoading} type="submit">Save</button>
            <button className="ghost-button" onClick={() => setEditingName(false)} type="button">Cancel</button>
          </form>
        ) : (
          <p><strong>{team.workspace.name}</strong></p>
        )}

        {/* Seat summary */}
        {isSubscribed ? (
          <p className="muted">
            {totalOccupied} of {seatCount} seat{seatCount !== 1 ? "s" : ""} used
            {overSeat ? " — visit Billing to add seats" : ""}
          </p>
        ) : null}

        {/* Members */}
        {team.members.map((member) => (
          <div key={member.userId} className="row-card" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <strong>{member.displayName}{member.isCurrentUser ? " (you)" : ""}</strong>
                <p className="muted">{member.email ?? ""}</p>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexShrink: 0 }}>
                <span className="muted">{ROLE_LABELS[member.role] ?? member.role}</span>
                {isOwnerOrAdmin && !member.isCurrentUser ? (
                  <button
                    className="ghost-button small"
                    disabled={isLoading}
                    onClick={() => {
                      setEditingRoleUserId(editingRoleUserId === member.userId ? null : member.userId);
                      setEditingRoleValue(member.role as "owner" | "member" | "admin" | "billing_admin");
                      setConfirmRemoveUserId(null);
                    }}
                    type="button"
                  >
                    Change role
                  </button>
                ) : null}
                {isOwnerOrAdmin && member.email ? (
                  <button
                    className="ghost-button small"
                    disabled={isLoading}
                    onClick={() => handleSendReset(member.userId, member.email)}
                    type="button"
                  >
                    Reset
                  </button>
                ) : null}
                {isOwnerOrAdmin && !member.isCurrentUser ? (
                  <button
                    className="ghost-button small"
                    disabled={isLoading}
                    onClick={() => {
                      setConfirmRemoveUserId(confirmRemoveUserId === member.userId ? null : member.userId);
                      setEditingRoleUserId(null);
                    }}
                    type="button"
                    style={{ color: "var(--danger)" }}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>

            {/* Inline role editor */}
            {editingRoleUserId === member.userId ? (
              <div className="row-inline" style={{ paddingTop: "4px", borderTop: "1px solid var(--border)" }}>
                <select
                  value={editingRoleValue}
                  onChange={(e) => setEditingRoleValue(e.target.value as "owner" | "member" | "admin" | "billing_admin")}
                  style={{ flex: 1 }}
                >
                  {isCurrentUserOwner ? <option value="owner">Owner</option> : null}
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="billing_admin">Billing admin</option>
                </select>
                <button
                  className="secondary-button"
                  disabled={isLoading || editingRoleValue === member.role}
                  onClick={() => handleChangeRole(member.userId)}
                  type="button"
                >
                  Save
                </button>
                <button
                  className="ghost-button"
                  onClick={() => setEditingRoleUserId(null)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            ) : null}

            {/* Inline remove confirmation */}
            {confirmRemoveUserId === member.userId ? (
              <div className="delete-confirm-inline">
                <p className="delete-confirm-warning">
                  Remove <strong>{member.displayName}</strong> from this workspace? They will lose access immediately.
                </p>
                <div className="row-inline">
                  <button
                    className="ghost-button danger-button"
                    disabled={isLoading}
                    onClick={() => handleRemoveMember(member.userId)}
                    type="button"
                  >
                    Confirm remove
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => setConfirmRemoveUserId(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ))}

        {/* Pending invitations */}
        {team.pendingInvitations.length > 0 ? (
          <>
            <p className="eyebrow" style={{ marginTop: "0.5rem" }}>Pending invitations</p>
            {team.pendingInvitations.map((inv) => (
              <div key={inv.id} className="row-card">
                <div>
                  <span>{inv.email}</span>
                  <p className="muted">{ROLE_LABELS[inv.role] ?? inv.role} · invited</p>
                </div>
                {isOwnerOrAdmin ? (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      className="ghost-button"
                      disabled={isLoading}
                      onClick={() => handleResend(inv)}
                      type="button"
                    >
                      Resend
                    </button>
                    <button
                      className="ghost-button"
                      disabled={isLoading}
                      onClick={() => handleRevoke(inv)}
                      type="button"
                    >
                      Revoke
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </>
        ) : null}

        {/* Invite form */}
        {isOwnerOrAdmin ? (
          <>
            <p className="eyebrow" style={{ marginTop: "0.5rem" }}>Invite a teammate</p>
            <p className="muted">
              Internal team members are billed at either $12 CAD per user/month or $120 CAD per
              user/year. External signers are not billed as users.
            </p>
            {isCurrentUserOwner ? (
              <p className="muted">
                Owners can also invite another owner or representative from here.
              </p>
            ) : null}
            <form className="stack" onSubmit={handleInvite}>
              <label className="form-field">
                <span>Email address</span>
                <input
                  required
                  type="email"
                  placeholder="teammate@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </label>
              <div className="row-card">
                <label className="form-field" style={{ flex: 1, margin: 0 }}>
                  <span>Role</span>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as "owner" | "member" | "admin" | "billing_admin")}
                  >
                    {isCurrentUserOwner ? <option value="owner">Owner / company rep</option> : null}
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    <option value="billing_admin">Billing admin</option>
                  </select>
                </label>
                <button
                  className="secondary-button"
                  disabled={isLoading || !inviteEmail.trim()}
                  type="submit"
                  style={{ alignSelf: "flex-end" }}
                >
                  {isLoading ? "Sending…" : "Send invite"}
                </button>
              </div>
            </form>
          </>
        ) : null}
      </div>
    </section>
  );
}
