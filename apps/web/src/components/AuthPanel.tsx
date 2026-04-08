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

  return (
    <section className="card">
      <p className="eyebrow">Authentication</p>

      {errorMessage ? <div className="alert">{errorMessage}</div> : null}
      {noticeMessage ? <div className="alert success">{noticeMessage}</div> : null}

      {guestSigningSession ? (
        <div className="stack">
          <p className="eyebrow">Guest signing</p>
          <p className="muted">
            Signing as <strong>{guestSigningSession.signerName}</strong>
          </p>
          <p className="muted">{guestSigningSession.signerEmail}</p>
          <p className="muted">Complete your assigned fields in the document panel to the right.</p>
        </div>
      ) : sessionUser ? (
        sessionUser.isAdmin ? <p className="eyebrow">Admin console enabled</p> : null
      ) : (
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
              <label className="form-field">
                <span>Full name</span>
                <input
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Team or company name <span className="muted">(optional)</span></span>
                <input
                  autoComplete="organization"
                  placeholder="e.g. Acme Corp"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                />
              </label>
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
            {authMode === "sign_in" ? "Continue" : "Create account"}
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
      )}
    </section>
  );
}
