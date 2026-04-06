import { useState, type FormEvent } from "react";

import { browserSupabase } from "../lib/supabase";
import type { GuestSigningSession, SessionUser } from "../types";

type Props = {
  sessionUser: SessionUser | null;
  guestSigningSession: GuestSigningSession | null;
  onSignOut: () => void;
};

export function AuthPanel({ sessionUser, guestSigningSession, onSignOut }: Props) {
  const [authMode, setAuthMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      if (authMode === "sign_in") {
        const { error } = await browserSupabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await browserSupabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        setNoticeMessage(
          data.session
            ? "Account created and signed in. You can start using EasyDraft now."
            : "Account created. Check your email to confirm your address before signing in.",
        );
      }
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSignOut() {
    await browserSupabase.auth.signOut();
    onSignOut();
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
        <div className="stack">
          <p className="muted">
            Signed in as <strong>{sessionUser.name}</strong>
          </p>
          <p className="muted">{sessionUser.email}</p>
          {sessionUser.isAdmin ? <p className="eyebrow">Admin console enabled</p> : null}
          <button className="secondary-button" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      ) : (
        <form className="stack" onSubmit={handleAuthSubmit}>
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
            <label className="form-field">
              <span>Full name</span>
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </label>
          ) : null}
          <label className="form-field">
            <span>Email</span>
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>Password</span>
            <input
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="primary-button" disabled={isLoading} type="submit">
            {authMode === "sign_in" ? "Continue" : "Create account"}
          </button>
          <p className="muted">
            If you were invited, sign up or sign in with the same email address from your invite.
            Any pending document access will attach automatically after you enter the app.
          </p>
        </form>
      )}
    </section>
  );
}
