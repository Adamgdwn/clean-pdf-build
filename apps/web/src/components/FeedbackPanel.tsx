import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";

import { apiFetch } from "../lib/api";
import type { SessionUser } from "../types";

type FeedbackKind = "bug_report" | "feature_request";

type Props = {
  session: Session | null;
  sessionUser: SessionUser | null;
  source: "public_site" | "workspace_shell";
  compact?: boolean;
};

export function FeedbackPanel({ session, sessionUser, source, compact = false }: Props) {
  const [activeKind, setActiveKind] = useState<FeedbackKind | null>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState(sessionUser?.email ?? "");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  useEffect(() => {
    setEmail(sessionUser?.email ?? "");
  }, [sessionUser?.email]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeKind) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await apiFetch("/feedback", session, {
        method: "POST",
        body: JSON.stringify({
          feedbackType: activeKind,
          title,
          details,
          email: sessionUser ? undefined : email,
          source,
          requestedPath: typeof window !== "undefined" ? window.location.pathname : null,
        }),
      });

      setNoticeMessage(
        activeKind === "bug_report"
          ? "Bug report received. Thanks for helping tighten the product."
          : "Feature request received. We’ll use it to shape the roadmap.",
      );
      setTitle("");
      setDetails("");
      setActiveKind(null);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className={`card ${compact ? "feedback-card-compact" : "feedback-card"}`}>
      <div className="section-heading compact">
        <p className="eyebrow">Feedback</p>
        <span>Direct to the product queue</span>
      </div>
      <p className="muted">
        Send issues and ideas straight into EasyDraft so they do not get lost in chat or email.
      </p>
      <div className="action-row action-wrap feedback-button-row">
        <button
          className={`ghost-button ${activeKind === "bug_report" ? "active" : ""}`}
          onClick={() => {
            setActiveKind("bug_report");
            setNoticeMessage(null);
          }}
          type="button"
        >
          Report a Bug
        </button>
        <button
          className={`ghost-button ${activeKind === "feature_request" ? "active" : ""}`}
          onClick={() => {
            setActiveKind("feature_request");
            setNoticeMessage(null);
          }}
          type="button"
        >
          Request a Feature or Tool
        </button>
      </div>

      {activeKind ? (
        <form className="stack form-block" onSubmit={handleSubmit}>
          {!sessionUser ? (
            <label className="form-field">
              <span>Email</span>
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
              />
            </label>
          ) : null}
          <label className="form-field">
            <span>{activeKind === "bug_report" ? "Bug title" : "Feature or tool title"}</span>
            <input
              required
              maxLength={140}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={activeKind === "bug_report" ? "What broke?" : "What would help most?"}
            />
          </label>
          <label className="form-field">
            <span>Details</span>
            <textarea
              required
              rows={compact ? 4 : 5}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              placeholder={
                activeKind === "bug_report"
                  ? "Describe what you were doing, what happened, and what you expected instead."
                  : "Describe the workflow, problem, or tool you want and why it matters."
              }
            />
          </label>
          <div className="action-row action-wrap">
            <button className="secondary-button" disabled={isLoading} type="submit">
              {isLoading ? "Sending…" : activeKind === "bug_report" ? "Submit bug report" : "Submit request"}
            </button>
            <button
              className="ghost-button"
              disabled={isLoading}
              onClick={() => setActiveKind(null)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {errorMessage ? <div className="alert">{errorMessage}</div> : null}
      {noticeMessage ? <div className="alert success">{noticeMessage}</div> : null}
    </section>
  );
}
