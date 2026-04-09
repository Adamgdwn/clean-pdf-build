import { useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";

import { apiFetch } from "../lib/api";
import type { GuestSigningSession, SessionUser } from "../types";

type Props = {
  sessionUser: SessionUser | null;
  guestSigningSession: GuestSigningSession | null;
  hasPendingInvite: boolean;
  onSessionCreated: (session: Session) => void;
  onRegistered: () => void;
};

export function AuthPanel({
  sessionUser,
  guestSigningSession,
  hasPendingInvite,
  onSessionCreated,
  onRegistered,
}: Props) {
  const [authMode, setAuthMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

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
              workspaceName: workspaceName.trim() || undefined,
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

  return (
    <section className="card">
      <p className="eyebrow">{authMode === "sign_up" ? "Start free trial" : "Sign in"}</p>

      {errorMessage ? <div className="alert">{errorMessage}</div> : null}
      {noticeMessage ? <div className="alert success">{noticeMessage}</div> : null}

      <form className="stack" onSubmit={handleAuthSubmit}>
          <p className="muted">
            Owners, administrators, and employees all sign in here. There is no separate admin portal.
          </p>

          {hasPendingInvite ? (
            <div className="alert success">
              You have a pending invitation. Sign up or sign in to join the workspace.
            </div>
          ) : null}

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

          {authMode === "sign_up" ? (
            <>
              <p className="muted">
                {hasPendingInvite
                  ? "Create your account to join the invited workspace. Your organization access will attach automatically after sign-up."
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
                    Team subscriptions cover internal members. External managed workflows use prepaid tokens, so outside signers do not become paid seats.
                  </p>
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
          ) : null}
      </form>
    </section>
  );
}
