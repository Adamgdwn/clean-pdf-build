import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";

import { apiFetch } from "../lib/api";
import type { GuestSigningSession, SessionUser, WorkspaceInviteDetails } from "../types";

type Props = {
  sessionUser: SessionUser | null;
  guestSigningSession: GuestSigningSession | null;
  hasPendingInvite: boolean;
  pendingInviteDetails?: WorkspaceInviteDetails["invitation"] | null;
  onSessionCreated: (session: Session) => void;
  onRegistered: () => void;
  variant?: "customer" | "team";
  defaultMode?: "sign_in" | "sign_up";
  allowDirectSignup?: boolean;
};

export function AuthPanel({
  sessionUser,
  guestSigningSession,
  hasPendingInvite,
  pendingInviteDetails,
  onSessionCreated,
  onRegistered,
  variant = "customer",
  defaultMode = "sign_in",
  allowDirectSignup = true,
}: Props) {
  const canSignUp = allowDirectSignup || hasPendingInvite;
  const preferredInitialMode = defaultMode === "sign_up" && !canSignUp ? "sign_in" : defaultMode;
  const [authMode, setAuthMode] = useState<"sign_in" | "sign_up">(preferredInitialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [accountType, setAccountType] = useState<"individual" | "corporate">("corporate");
  const [workspaceName, setWorkspaceName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  useEffect(() => {
    if (canSignUp || authMode !== "sign_up") {
      return;
    }

    setAuthMode("sign_in");
  }, [authMode, canSignUp]);

  useEffect(() => {
    if (!pendingInviteDetails?.email) {
      return;
    }

    setEmail((currentValue) => currentValue || pendingInviteDetails.email);
    setAuthMode("sign_up");
  }, [pendingInviteDetails?.email]);

  function fallbackToBrowserFormSignIn(nextEmail: string, nextPassword: string) {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/auth-password-form";
    form.style.display = "none";

    const emailInput = document.createElement("input");
    emailInput.name = "email";
    emailInput.value = nextEmail;
    form.appendChild(emailInput);

    const passwordInput = document.createElement("input");
    passwordInput.name = "password";
    passwordInput.value = nextPassword;
    form.appendChild(passwordInput);

    document.body.appendChild(form);
    form.submit();
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      if (authMode === "sign_in") {
        fallbackToBrowserFormSignIn(email, password);
        return;
      } else {
        const payload = await apiFetch<{ session: Session | null; user: { email?: string | null } | null }>(
          "/auth-register",
          null,
          {
            method: "POST",
              body: JSON.stringify({
                email,
                password,
                fullName,
                accountType,
                workspaceName:
                  accountType === "corporate" ? workspaceName.trim() || undefined : undefined,
              }),
            },
          );
        if (!payload.session) {
          setErrorMessage(
            "Account created but could not sign in automatically. Please sign in below.",
          );
          return;
        }
        onSessionCreated(payload.session);
        onRegistered();
        setNoticeMessage("Welcome to EasyDraftDocs — you're all set.");
      }
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handlePasswordReset() {
    if (!email.trim()) {
      setErrorMessage("Enter your email first, then request a password reset link.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await apiFetch("/auth-password-reset", null, {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setNoticeMessage(`Password reset email sent to ${email.trim()}.`);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  // Signed-in users: no auth UI needed in the sidebar
  if (sessionUser) {
    return null;
  }

  // Guest signers: show a minimal identity card in the sidebar
  if (guestSigningSession) {
    return (
      <section className="card">
        <p className="eyebrow">Guest signing</p>
        {errorMessage ? <div className="alert">{errorMessage}</div> : null}
        {noticeMessage ? <div className="alert success">{noticeMessage}</div> : null}
        <div className="stack">
          <p className="muted">
            Signing as <strong>{guestSigningSession.signerName}</strong>
          </p>
          <p className="muted">{guestSigningSession.signerEmail}</p>
          <p className="muted">Complete your assigned fields in the document panel to the right.</p>
        </div>
      </section>
    );
  }

  const eyebrow =
    variant === "team"
      ? authMode === "sign_up"
        ? "Team invite"
        : "AG Operations team"
      : authMode === "sign_up"
        ? "Start free trial"
        : "Customer sign in";

  const introCopy =
    variant === "team"
      ? hasPendingInvite
        ? "Use the invited email address to activate your AG Operations team account."
        : "AG Operations team members sign in here for support, admin visibility, billing review, and internal testing."
      : authMode === "sign_up"
        ? "Create your EasyDraft workspace, upload your first PDF, and invite teammates when you're ready."
        : "Returning customer teams can sign in here to continue active workflows, billing, and workspace management.";

  return (
    <section className="card">
      <p className="eyebrow">{eyebrow}</p>

      {errorMessage ? <div className="alert">{errorMessage}</div> : null}
      {noticeMessage ? <div className="alert success">{noticeMessage}</div> : null}

      <form className="stack" onSubmit={handleAuthSubmit}>
          <p className="muted">{introCopy}</p>

          {hasPendingInvite ? (
            <div className="alert success">
              {pendingInviteDetails?.status === "expired"
                ? `This invitation for ${pendingInviteDetails.email} has expired. Ask the workspace owner to send a new invite.`
                : pendingInviteDetails?.status === "accepted"
                  ? `This invitation for ${pendingInviteDetails.email} was already accepted. Sign in with that address to continue.`
                  : pendingInviteDetails?.workspace?.name
                    ? `You're invited to ${pendingInviteDetails.workspace.name} as ${pendingInviteDetails.role.replaceAll("_", " ")}. Use ${pendingInviteDetails.email} to accept this invite.`
                : "You have a pending invitation. Sign up or sign in to join the workspace."}
            </div>
          ) : null}

          {canSignUp ? (
            <div className="pill-row">
              <button
                className={`pill-button ${authMode === "sign_in" ? "active" : ""}`}
                onClick={() => setAuthMode("sign_in")}
                type="button"
              >
                Sign in
              </button>
              <button
                className={`pill-button ${authMode === "sign_up" ? "active" : ""}`}
                onClick={() => setAuthMode("sign_up")}
                type="button"
              >
                Sign up
              </button>
            </div>
          ) : null}

          {authMode === "sign_up" ? (
            <>
              <p className="muted">
                {hasPendingInvite
                  ? "Create your account with the invited email address so the workspace attaches to the right identity."
                  : "Start a 30-day free trial with no card up front. Create your workspace, invite your team, and send your first workflow from the same account."}
              </p>
              <label className="form-field">
                <span>Full name</span>
                <input
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
              </label>
              {!hasPendingInvite ? (
                <>
                  <div className="pill-row">
                    <button
                      className={`pill-button ${accountType === "corporate" ? "active" : ""}`}
                      onClick={() => setAccountType("corporate")}
                      type="button"
                    >
                      Corporate account
                    </button>
                    <button
                      className={`pill-button ${accountType === "individual" ? "active" : ""}`}
                      onClick={() => setAccountType("individual")}
                      type="button"
                    >
                      Individual account
                    </button>
                  </div>
                  {accountType === "corporate" ? (
                    <>
                      <label className="form-field">
                        <span>Organization name</span>
                        <input
                          required
                          autoComplete="organization"
                          placeholder="e.g. Acme Corp"
                          value={workspaceName}
                          onChange={(event) => setWorkspaceName(event.target.value)}
                        />
                      </label>
                      <p className="muted">
                        Your company account will own billing, seats, and the shared token balance for invited team members.
                      </p>
                    </>
                  ) : (
                    <p className="muted">
                      Start with your own account and workspace. You can prepare, send, and manage documents without setting up a company account first.
                    </p>
                  )}
                </>
              ) : null}
            </>
          ) : null}

          <label className="form-field">
            <span>Email</span>
            <input
              required
              type="email"
              autoComplete={authMode === "sign_in" ? "username" : "email"}
              placeholder={pendingInviteDetails?.email ?? undefined}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>Password</span>
            <input
              required
              type="password"
              autoComplete={authMode === "sign_in" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="primary-button" disabled={isLoading} type="submit">
            {authMode === "sign_in" ? "Continue" : "Start free trial"}
          </button>

          {authMode === "sign_in" ? (
            <button
              className="ghost-button"
              disabled={isLoading}
              onClick={handlePasswordReset}
              type="button"
            >
              Forgot password
            </button>
          ) : null}

          {!hasPendingInvite ? (
            <p className="muted">
              If you were invited, sign in with the same email from your invite and the workspace
              will attach automatically.
            </p>
          ) : (
            <p className="muted">
              If you use a different email, EasyDraft will block the invite so the workspace cannot attach to the wrong account.
            </p>
          )}
      </form>
    </section>
  );
}
