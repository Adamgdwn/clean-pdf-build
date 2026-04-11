import type { Session } from "@supabase/supabase-js";

import { AuthPanel } from "../AuthPanel";
import { FeedbackPanel } from "../FeedbackPanel";

export type PublicPage = "home" | "pricing" | "privacy" | "terms" | "security";

const MARKETING_PRICING = {
  trialDays: 30,
  monthlySeatCad: 12,
  annualSeatCad: 120,
  annualMonthlyEquivalentCad: 10,
  tokenPackCad: 12,
  tokenPackCount: 12,
};

type Props = {
  publicPage: PublicPage;
  pendingInviteToken: string | null;
  errorMessage: string | null;
  noticeMessage: string | null;
  onNavigatePublicPage: (nextPage: PublicPage) => void;
  onSessionCreated: (session: Session) => void;
  onRegistered: () => void;
};

function renderLegalPage(page: PublicPage) {
  if (page === "privacy") {
    return {
      eyebrow: "Privacy",
      title: "We collect the minimum needed to run document workflows.",
      body: "EasyDraft stores account details, document metadata, audit events, billing state, and files you upload so your team can prepare, route, sign, and export PDFs. Payment card details stay with Stripe, and external signers are limited to the workflow data needed for their assigned actions.",
      bullets: [
        "Uploaded PDFs and signature assets stay in private storage.",
        "Audit events, notifications, and completion history are stored to support traceability.",
        "Workspace owners control member access and can remove users or documents from active views.",
      ],
    };
  }

  if (page === "terms") {
    return {
      eyebrow: "Terms",
      title: "EasyDraft is a workflow platform for private beta teams.",
      body: "Private beta access is provided for business workflow testing and operational use. Teams remain responsible for deciding whether a workflow is appropriate for their own legal and compliance requirements, especially where certificate-backed or jurisdiction-specific signing standards are required.",
      bullets: [
        "Subscriptions cover internal users, and tokens cover managed external routing only.",
        "Customers are responsible for the content they upload and the recipients they invite.",
        "Certificate-backed digital signatures are not part of the current beta offering.",
      ],
    };
  }

  return {
    eyebrow: "Security",
    title: "The current trust model is SHA-256 export integrity plus workflow audit history.",
    body: "EasyDraft uses authenticated workspaces, private storage, role-based access, audit events, signed preview and download URLs, and queue-based notifications. The current beta does not claim certificate-backed PDF signing; instead it records a SHA-256 hash for the rendered export and shows that value in the completion certificate.",
    bullets: [
      "Sensitive API routes are rate-limited and support a shared Redis-backed limiter in production.",
      "Notification and processing queues are visible in admin metrics so failures are easier to spot.",
      "Certificate-backed signing remains gated off until a real provider integration exists.",
    ],
  };
}

export function PublicSite({
  publicPage,
  pendingInviteToken,
  errorMessage,
  noticeMessage,
  onNavigatePublicPage,
  onSessionCreated,
  onRegistered,
}: Props) {
  const legalPage = publicPage === "privacy" || publicPage === "terms" || publicPage === "security"
    ? renderLegalPage(publicPage)
    : null;

  return (
    <div className="landing-shell">
      <header className="landing-header">
        <div className="landing-header-row">
          <div className="brand">
            <span className="brand-mark">ED</span>
            <div>
              <h1>EasyDraft</h1>
              <p>Private document workflows, reusable signatures, and clean handoffs.</p>
            </div>
          </div>
          <nav className="landing-nav">
            <button className="landing-nav-link" onClick={() => onNavigatePublicPage("home")} type="button">Home</button>
            <button className="landing-nav-link" onClick={() => onNavigatePublicPage("pricing")} type="button">Pricing</button>
            <button className="landing-nav-link" onClick={() => onNavigatePublicPage("security")} type="button">Security</button>
            <button className="landing-nav-link" onClick={() => onNavigatePublicPage("privacy")} type="button">Privacy</button>
            <button className="landing-nav-link" onClick={() => onNavigatePublicPage("terms")} type="button">Terms</button>
            <a className="landing-nav-cta" href="#landing-auth">Start free trial</a>
          </nav>
        </div>
      </header>
      <div className={`landing-body ${publicPage === "pricing" ? "pricing-page-shell" : ""}`}>
        <div className="landing-value">
          {publicPage === "home" ? (
            <>
              <p className="eyebrow">Built for operations, finance, HR, legal, and real-estate teams</p>
              <h2>Private document workflows for teams that need routing, signing, and an audit trail</h2>
              <p className="landing-sub">
                EasyDraftDocs gives your team one place to upload PDFs, route approvals, collect signatures,
                and keep a clean completion trail without forcing external signers to learn your internal tools.
              </p>
              <div className="landing-cta-row">
                <a className="primary-button" href="#landing-auth">Start free trial</a>
                <button className="ghost-button" onClick={() => onNavigatePublicPage("pricing")} type="button">View pricing</button>
                <a className="ghost-button" href="#landing-tour">Explore product tour</a>
              </div>
              <div className="landing-proof-grid">
                <div className="landing-proof-card">
                  <strong>What it&apos;s for</strong>
                  <span>Private document workflows, routing, signing, and audit-ready exports.</span>
                </div>
                <div className="landing-proof-card">
                  <strong>How trust works today</strong>
                  <span>SHA-256 export integrity, audit history, explicit routing, and visible workspace ownership.</span>
                </div>
                <div className="landing-proof-card">
                  <strong>What happens next</strong>
                  <span>Start a free trial, review pricing, or take a quick product tour before signing in.</span>
                </div>
              </div>
              <ul className="landing-features">
                <li>
                  <strong>Private PDF vault</strong>
                  <span>Secure uploads with signed preview URLs, completion certificates, and audit trails.</span>
                </li>
                <li>
                  <strong>Reusable signatures</strong>
                  <span>Save your signature and initials once and reuse them on assigned workflow fields.</span>
                </li>
                <li>
                  <strong>Managed routing</strong>
                  <span>Sequential or parallel signing, internal or external participants, and a visible waiting-on state.</span>
                </li>
              </ul>
            </>
          ) : null}
          {publicPage === "pricing" ? (
            <>
              <p className="eyebrow">Pricing</p>
              <h2>Clear team pricing for internal seats and external workflow volume</h2>
              <p className="landing-sub">
                EasyDraft is priced for teams, not one-off consumer signing. Subscriptions cover your internal operators,
                while external workflow routing uses tokens only when EasyDraft handles outside delivery for you.
              </p>
              <div className="landing-cta-row">
                <a className="primary-button" href="#landing-auth">Start free trial</a>
                <button className="ghost-button" onClick={() => onNavigatePublicPage("home")} type="button">Back to overview</button>
              </div>
              <div className="landing-proof-grid">
                <div className="landing-proof-card">
                  <strong>No surprise billing</strong>
                  <span>Trial, seats, plan status, and token balance stay visible to owners inside the control center.</span>
                </div>
                <div className="landing-proof-card">
                  <strong>External signers stay free</strong>
                  <span>Outside signers do not need accounts and do not become paid seats.</span>
                </div>
                <div className="landing-proof-card">
                  <strong>Buy only when it matters</strong>
                  <span>Internal-only and self-managed distribution flows do not consume external routing tokens.</span>
                </div>
              </div>
            </>
          ) : null}
          {legalPage ? (
            <>
              <p className="eyebrow">{legalPage.eyebrow}</p>
              <h2>{legalPage.title}</h2>
              <p className="landing-sub">{legalPage.body}</p>
              <ul className="landing-features">
                {legalPage.bullets.map((bullet) => (
                  <li key={bullet}>
                    <strong>{legalPage.eyebrow}</strong>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
        <div className="landing-auth" id="landing-auth">
          <AuthPanel
            sessionUser={null}
            guestSigningSession={null}
            hasPendingInvite={pendingInviteToken !== null}
            onSessionCreated={onSessionCreated}
            onRegistered={onRegistered}
          />
          {errorMessage ? <div className="alert" style={{ marginTop: "0.75rem" }}>{errorMessage}</div> : null}
          {noticeMessage ? <div className="alert success" style={{ marginTop: "0.75rem" }}>{noticeMessage}</div> : null}
          <section className="card landing-side-note">
            <div className="section-heading compact">
              <p className="eyebrow">{publicPage === "pricing" ? "Owner visibility" : "Current trust model"}</p>
              <span>{publicPage === "pricing" ? "Always visible" : "SHA-256 + audit trail"}</span>
            </div>
            <p className="muted">
              Team subscriptions cover your internal members. External managed workflows use prepaid tokens,
              so outside signers do not become paid seats.
            </p>
            <p className="muted">
              The current beta records SHA-256 export hashes and workflow history. Certificate-backed PDF signing is not part of the live beta yet.
            </p>
          </section>
        </div>
      </div>
      <section className="landing-section" id="landing-pricing">
        <div className="landing-section-header">
          <p className="eyebrow">Pricing</p>
          <h3>Simple team billing with a clear external-signer model</h3>
          <p className="muted">
            Internal members are part of your subscription. External signers are free to invite, and only managed external workflow sends consume tokens.
          </p>
        </div>
        <div className="landing-pricing-grid">
          <article className="toolbar-card landing-price-card">
            <p className="eyebrow">Free trial</p>
            <strong className="landing-price-value">{MARKETING_PRICING.trialDays} days free</strong>
            <p className="landing-price-detail">No card required to start</p>
            <p className="muted">Create your workspace, invite teammates, and run real workflows before choosing a paid team plan.</p>
          </article>
          <article className="toolbar-card landing-price-card">
            <p className="eyebrow">Team subscription</p>
            <strong className="landing-price-value">${MARKETING_PRICING.monthlySeatCad} CAD</strong>
            <p className="landing-price-detail">Per internal user / month</p>
            <p className="muted">
              Or ${MARKETING_PRICING.annualSeatCad} CAD per user / year
              {" "}
              (${MARKETING_PRICING.annualMonthlyEquivalentCad} CAD per user / month equivalent).
            </p>
            <p className="muted">Owners, admins, editors, and internal members are covered by your plan. Billing stays visible to owners inside the control center.</p>
          </article>
          <article className="toolbar-card landing-price-card">
            <p className="eyebrow">External tokens</p>
            <strong className="landing-price-value">${MARKETING_PRICING.tokenPackCad} CAD</strong>
            <p className="landing-price-detail">{MARKETING_PRICING.tokenPackCount} external workflow tokens</p>
            <p className="muted">
              1 token = 1 managed external workflow send. Self-managed and internal-only flows do not use tokens.
            </p>
          </article>
        </div>
      </section>
      <section className="landing-section" id="landing-tour">
        <div className="landing-section-header">
          <p className="eyebrow">Product tour</p>
          <h3>How a team uses EasyDraft in practice</h3>
        </div>
        <div className="landing-tour-grid">
          <article className="toolbar-card landing-tour-card">
            <span className="landing-tour-step">1</span>
            <strong>Upload and prepare</strong>
            <p className="muted">Upload a PDF, add participants, place fields, choose routing, and confirm the workflow checklist.</p>
          </article>
          <article className="toolbar-card landing-tour-card">
            <span className="landing-tour-step">2</span>
            <strong>Route and sign</strong>
            <p className="muted">EasyDraft tracks who is next, handles internal or external participation, and keeps the waiting-on state visible.</p>
          </article>
          <article className="toolbar-card landing-tour-card">
            <span className="landing-tour-step">3</span>
            <strong>Review and export</strong>
            <p className="muted">Owners monitor billing, team access, workflow risk, audit history, and final exports from one control center.</p>
          </article>
        </div>
      </section>
      <footer className="landing-section">
        <div className="landing-section-header">
          <p className="eyebrow">Trust links</p>
          <h3>Review the current beta posture before you send live workflows</h3>
        </div>
        <div className="landing-faq-grid">
          <article className="toolbar-card">
            <strong>Privacy</strong>
            <p className="muted">Understand what the beta stores and what stays with providers like Stripe.</p>
            <button className="ghost-button" onClick={() => onNavigatePublicPage("privacy")} type="button">Open privacy</button>
          </article>
          <article className="toolbar-card">
            <strong>Terms</strong>
            <p className="muted">Review the private-beta usage posture and scope of the current release.</p>
            <button className="ghost-button" onClick={() => onNavigatePublicPage("terms")} type="button">Open terms</button>
          </article>
          <article className="toolbar-card">
            <strong>Security</strong>
            <p className="muted">See how SHA-256 integrity, audit history, and queue visibility work today.</p>
            <button className="ghost-button" onClick={() => onNavigatePublicPage("security")} type="button">Open security</button>
          </article>
        </div>
        <div style={{ marginTop: "18px" }}>
          <FeedbackPanel
            session={null}
            sessionUser={null}
            source="public_site"
            compact
          />
        </div>
      </footer>
    </div>
  );
}
