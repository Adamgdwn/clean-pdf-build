import { useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";

import { apiFetch } from "../lib/api";
import type { AccountClass, BillingOverview, WorkspaceTeam, WorkspaceTeamInvitation } from "../types";

const ACCOUNT_CLASS_LABELS: Record<AccountClass, string> = {
  personal: "Personal",
  corporate_admin: "Corporate admin",
  corporate_member: "Corporate member",
};

function parseInviteEmails(value: string) {
  const seen = new Set<string>();

  return value
    .split(/[\s,;]+/)
    .map((email) => email.trim())
    .filter(Boolean)
    .filter((email) => {
      const normalized = email.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

type Props = {
  session: Session;
  team: WorkspaceTeam;
  billingOverview: BillingOverview | null;
  onTeamRefresh: () => void;
};

export function TeamPanel({ session, team, billingOverview, onTeamRefresh }: Props) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteAccountClass, setInviteAccountClass] = useState<AccountClass>("corporate_member");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [workspaceName, setWorkspaceName] = useState(
    team.organization.accountType === "corporate" ? team.organization.name : team.workspace.name,
  );
  const [editingRoleUserId, setEditingRoleUserId] = useState<string | null>(null);
  const [editingAccountClassValue, setEditingAccountClassValue] = useState<AccountClass>("corporate_member");
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<string | null>(null);

  const subscription = billingOverview?.subscription ?? null;
  const isAccountAdminOrAdmin = team.members.some(
    (m) => m.isCurrentUser && m.accountClass === "corporate_admin",
  );
  const isCurrentUserAccountAdmin = team.members.some((m) => m.isCurrentUser && m.accountClass === "corporate_admin");

  const totalOccupied = team.members.length + team.pendingInvitations.length;
  const seatCount = subscription?.seatCount ?? 0;
  const isSubscribed = subscription && ["active", "trialing"].includes(subscription.status);
  const overSeat = isSubscribed && totalOccupied > seatCount;
  const availableSeats = Math.max(0, seatCount - totalOccupied);
  const parsedInviteEmails = parseInviteEmails(inviteEmail);

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (parsedInviteEmails.length === 0) return;

    if (parsedInviteEmails.length > 10) {
      setErrorMessage("Send up to 10 invitations at a time.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      const sentEmails: string[] = [];
      const failedInvites: string[] = [];
      const seatWarnings: string[] = [];

      for (const email of parsedInviteEmails) {
        try {
          const result = await apiFetch<{ invitation: { email: string }; seatWarning: string | null }>(
            "/workspace-invite",
            session,
            { method: "POST", body: JSON.stringify({ email, accountClass: inviteAccountClass }) },
          );
          sentEmails.push(result.invitation.email);
          if (result.seatWarning) seatWarnings.push(result.seatWarning);
        } catch (error) {
          failedInvites.push(`${email}: ${(error as Error).message}`);
        }
      }

      if (sentEmails.length > 0) {
        setInviteEmail("");
        const warning = seatWarnings.at(-1);
        setNoticeMessage(
          `${sentEmails.length} invitation${sentEmails.length === 1 ? "" : "s"} sent.${warning ? ` ${warning}` : ""}`,
        );
      }

      if (failedInvites.length > 0) {
        setErrorMessage(`Could not send ${failedInvites.length} invite${failedInvites.length === 1 ? "" : "s"}: ${failedInvites.join("; ")}`);
      }

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
      setNoticeMessage(
        team.organization.accountType === "corporate"
          ? "Organization name updated."
          : "Workspace name updated.",
      );
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
        body: JSON.stringify({ userId, accountClass: editingAccountClassValue }),
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
      setNoticeMessage(
        team.organization.accountType === "corporate"
          ? "Member removed from organization."
          : "Member removed from workspace.",
      );
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
        <p className="eyebrow">{team.organization.accountType === "corporate" ? "Organization" : "Team"}</p>
        {isAccountAdminOrAdmin && !editingName ? (
          <button
            className="ghost-button"
            onClick={() => {
              setEditingName(true);
              setWorkspaceName(team.organization.accountType === "corporate" ? team.organization.name : team.workspace.name);
            }}
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
          <p><strong>{team.organization.accountType === "corporate" ? team.organization.name : team.workspace.name}</strong></p>
        )}

        {/* Seat summary */}
        {isSubscribed ? (
          <p className="muted">
            {team.members.length} active and {team.pendingInvitations.length} invited seat{totalOccupied === 1 ? "" : "s"} count against {seatCount} purchased.
            {overSeat
              ? ` ${totalOccupied - seatCount} assignment${totalOccupied - seatCount === 1 ? "" : "s"} need more purchased seats.`
              : ` ${availableSeats} available.`}
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
                <span className="muted">{ACCOUNT_CLASS_LABELS[member.accountClass]}</span>
                {isAccountAdminOrAdmin && !member.isCurrentUser ? (
                  <button
                    className="ghost-button small"
                    disabled={isLoading}
                    onClick={() => {
                      setEditingRoleUserId(editingRoleUserId === member.userId ? null : member.userId);
                      setEditingAccountClassValue(member.accountClass);
                      setConfirmRemoveUserId(null);
                    }}
                    type="button"
                  >
                    Change role
                  </button>
                ) : null}
                {isAccountAdminOrAdmin && member.email ? (
                  <button
                    className="ghost-button small"
                    disabled={isLoading}
                    onClick={() => handleSendReset(member.userId, member.email)}
                    type="button"
                  >
                    Reset
                  </button>
                ) : null}
                {isAccountAdminOrAdmin && !member.isCurrentUser ? (
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
                  value={editingAccountClassValue}
                  onChange={(e) => setEditingAccountClassValue(e.target.value as AccountClass)}
                  style={{ flex: 1 }}
                >
                  {isCurrentUserAccountAdmin ? <option value="corporate_admin">Corporate admin - full organization control</option> : null}
                  <option value="corporate_member">Corporate member</option>
                </select>
                <button
                  className="secondary-button"
                  disabled={isLoading || editingAccountClassValue === member.accountClass}
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
                  Remove <strong>{member.displayName}</strong> from this {team.organization.accountType === "corporate" ? "organization" : "workspace"}? They will lose access immediately.
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
                  <p className="muted">{ACCOUNT_CLASS_LABELS[inv.accountClass]} · invited</p>
                </div>
                {isAccountAdminOrAdmin ? (
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
        {isAccountAdminOrAdmin ? (
          <>
            <p className="eyebrow" style={{ marginTop: "0.5rem" }}>Invite teammates</p>
            <p className="muted">
              Internal members are billed at either $12 CAD per user/month or $120 CAD per
              user/year. External signers are not billed as users, and token purchases are shared across the {team.organization.accountType === "corporate" ? "organization" : "account"}.
              Paste up to 10 email addresses separated by commas, spaces, or new lines.
            </p>
            {isCurrentUserAccountAdmin ? (
              <p className="muted">
                You can intentionally name more than one account admin for turnover coverage, vacation coverage, and shared workload. Only account admins can grant account admin access.
              </p>
            ) : null}
            <form className="stack" onSubmit={handleInvite}>
              <label className="form-field">
                <span>Email addresses</span>
                <textarea
                  required
                  placeholder={"teammate@company.com\nsecond@company.com"}
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </label>
              <div className="row-card">
                <label className="form-field" style={{ flex: 1, margin: 0 }}>
                  <span>Role</span>
                  <select
                    value={inviteAccountClass}
                    onChange={(e) => setInviteAccountClass(e.target.value as AccountClass)}
                  >
                    {isCurrentUserAccountAdmin ? <option value="corporate_admin">Corporate admin - full organization control</option> : null}
                    <option value="corporate_member">Corporate member</option>
                  </select>
                </label>
                <button
                  className="secondary-button"
                  disabled={isLoading || parsedInviteEmails.length === 0}
                  type="submit"
                  style={{ alignSelf: "flex-end" }}
                >
                  {isLoading
                    ? "Sending…"
                    : parsedInviteEmails.length > 1
                      ? `Send ${parsedInviteEmails.length} invites`
                      : "Send invite"}
                </button>
              </div>
            </form>
          </>
        ) : null}
      </div>
    </section>
  );
}
