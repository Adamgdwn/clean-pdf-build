import type { Session } from "@supabase/supabase-js";
import type { MouseEvent } from "react";

import { AuthPanel } from "../AuthPanel";
import { FeedbackPanel } from "../FeedbackPanel";
import type { WorkspaceInviteDetails } from "../../types";

export type PublicPage = "home" | "pricing" | "privacy" | "terms" | "security" | "team";

const MARKETING_PRICING = {
  trialDays: 30,
  monthlySeatCad: 12,
  annualSeatCad: 120,
  annualMonthlyEquivalentCad: 10,
  tokenPackCad: 12,
  tokenPackCount: 12,
};

const MARKETING_HERO_IMAGES = [
  {
    src: "/marketing/easydraft-workflow-paths.png",
    alt: "EasyDraft three affordable workflow paths: self-managed, collaborative team, and enterprise custom.",
  },
  {
    src: "/marketing/easydraft-document-lifecycle.png",
    alt: "EasyDraft document lifecycle from upload through prepare, send, sign, finalize, seal, and export.",
  },
];

type Props = {
  publicPage: PublicPage;
  pendingInviteToken: string | null;
  pendingInviteDetails?: WorkspaceInviteDetails["invitation"] | null;
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
  pendingInviteDetails,
  errorMessage,
  noticeMessage,
  onNavigatePublicPage,
  onSessionCreated,
  onRegistered,
}: Props) {
  const legalPage = publicPage === "privacy" || publicPage === "terms" || publicPage === "security"
    ? renderLegalPage(publicPage)
    : null;
  const isTeamPage = publicPage === "team";
  const showCustomerStartSection = publicPage === "home" || publicPage === "pricing";
  const showMarketingSidebar = !isTeamPage;

  function handlePublicNav(event: MouseEvent<HTMLAnchorElement>, nextPage: PublicPage) {
    event.preventDefault();
    onNavigatePublicPage(nextPage);
  }

  return (
    <div className="landing-shell">
      <header className="landing-header">
        <div className="landing-header-row">
          <div className="brand">
            <span className="brand-mark">ED</span>
            <div>
              <h1>EasyDraft</h1>
              <p>Refine. Share. Sign.</p>
            </div>
          </div>
          <nav className="landing-nav">
            <a className="landing-nav-link" href="/" onClick={(event) => handlePublicNav(event, "home")}>Home</a>
            <a className="landing-nav-link" href="/pricing" onClick={(event) => handlePublicNav(event, "pricing")}>Pricing</a>
            <a className="landing-nav-link" href="/security" onClick={(event) => handlePublicNav(event, "security")}>Security</a>
            <a className="landing-nav-link" href="/privacy" onClick={(event) => handlePublicNav(event, "privacy")}>Privacy</a>
            <a className="landing-nav-link" href="/terms" onClick={(event) => handlePublicNav(event, "terms")}>Terms</a>
            <a className="landing-nav-cta" href={isTeamPage ? "#team-access" : "#landing-start"}>
              {isTeamPage ? "Team sign in" : "Start free trial"}
            </a>
          </nav>
        </div>
      </header>
      {publicPage === "home" ? (
        <section className="landing-infographic-heroes" id="landing-tour" aria-label="EasyDraft workflow overview">
          {MARKETING_HERO_IMAGES.map((image) => (
            <img
              key={image.src}
              className="landing-infographic-hero-image"
              src={image.src}
              alt={image.alt}
            />
          ))}
        </section>
      ) : null}
      <div className={`landing-body ${publicPage === "pricing" ? "pricing-page-shell" : ""} ${isTeamPage ? "landing-body-team" : ""}`}>
        <div className="landing-value">
          {publicPage === "home" ? (
            <>
              <p className="eyebrow">Customer-ready document workflows</p>
              <h2>Send clear, private document workflows without making customers learn your internal process</h2>
              <p className="landing-sub">
                EasyDraft gives your team one place to upload existing PDFs, route internal reviews, collect
                signatures, and keep a clean audit trail while customers see a focused, low-friction signing experience.
              </p>
              <div className="landing-cta-row">
                <a className="primary-button" href="#landing-start">Start free trial</a>
                <a className="ghost-button" href="/pricing" onClick={(event) => handlePublicNav(event, "pricing")}>View pricing</a>
                <a className="ghost-button" href="#landing-tour">See how it works</a>
              </div>
              <div className="landing-proof-grid">
                <div className="landing-proof-card">
                  <strong>For your customer</strong>
                  <span>Outside signers get a dedicated action flow instead of your full internal workspace.</span>
                </div>
                <div className="landing-proof-card">
                  <strong>For your team</strong>
                  <span>Keep review, routing, billing, and workspace control inside one private operating surface.</span>
                </div>
                <div className="landing-proof-card">
                  <strong>For your records</strong>
                  <span>Capture audit history, routing status, and SHA-256 export integrity in one completion trail.</span>
                </div>
              </div>
              <ul className="landing-features">
                <li>
                  <strong>Use the PDFs you already have</strong>
                  <span>Upload existing agreements, route them internally, then send customers only what they need to see and sign.</span>
                </li>
                <li>
                  <strong>Keep external signers out of your workspace</strong>
                  <span>Customers do not need to navigate your admin views, billing controls, or internal preparation screens.</span>
                </li>
                <li>
                  <strong>See status without chasing people</strong>
                  <span>Track who is up next, what is complete, and what still needs attention from one place.</span>
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
                <a className="primary-button" href="#landing-start">Start free trial</a>
                <a className="ghost-button" href="/" onClick={(event) => handlePublicNav(event, "home")}>Back to overview</a>
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
          {publicPage === "team" ? (
            <>
              <p className="eyebrow">AG Operations team access</p>
              <h2>A dedicated team entry point for support, admin visibility, and internal workflow operations</h2>
              <p className="landing-sub">
                This page is for AG Operations team members who manage customer workspaces, review admin metrics,
                handle tester invites, and support internal document operations. Customer-facing traffic should stay on the main site.
              </p>
              <div className="landing-proof-grid">
                <div className="landing-proof-card">
                  <strong>Support access</strong>
                  <span>Review customer workspace state, invites, and account status from the team side of the product.</span>
                </div>
                <div className="landing-proof-card">
                  <strong>Admin visibility</strong>
                  <span>Watch queue health, billing posture, and internal readiness without mixing that message into the customer homepage.</span>
                </div>
                <div className="landing-proof-card">
                  <strong>Invite-safe onboarding</strong>
                  <span>Invited team members can activate the correct account without crossing into the public customer flow.</span>
                </div>
              </div>
              <ul className="landing-features">
                <li>
                  <strong>Separate from the customer homepage</strong>
                  <span>Customer messaging stays focused on clean document workflows, while team access stays operational.</span>
                </li>
                <li>
                  <strong>Built for internal coordination</strong>
                  <span>Use this page for AG Operations sign-in, invite-based team activation, and password resets.</span>
                </li>
                <li>
                  <strong>Same secure product, clearer entry points</strong>
                  <span>The product stays unified behind the scenes, but each audience gets a page that matches its job.</span>
                </li>
              </ul>
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
        {showMarketingSidebar ? (
          <div className="landing-hero-stack">
            <section className="card landing-showcase-panel">
              <div className="section-heading compact">
                <p className="eyebrow">Customer focus</p>
                <span>Clear by design</span>
              </div>
              <div className="landing-showcase-list">
                <div className="row-card landing-showcase-item">
                  <div>
                    <strong>Dedicated signing surface</strong>
                    <p className="muted">External signers act in a focused page built for completion, not exploration.</p>
                  </div>
                </div>
                <div className="row-card landing-showcase-item">
                  <div>
                    <strong>Internal work stays internal</strong>
                    <p className="muted">Preparation, approvals, team controls, and billing visibility stay with your team.</p>
                  </div>
                </div>
                <div className="row-card landing-showcase-item">
                  <div>
                    <strong>Status stays visible</strong>
                    <p className="muted">Know who is waiting, who has finished, and when the final export is ready.</p>
                  </div>
                </div>
              </div>
            </section>
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
              <div className="landing-inline-actions">
                {showCustomerStartSection ? (
                  <a className="ghost-button" href="#landing-start">Start your workspace</a>
                ) : (
                  <a className="ghost-button" href="/" onClick={(event) => handlePublicNav(event, "home")}>Back to overview</a>
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="landing-auth" id="team-access">
            <AuthPanel
              sessionUser={null}
              guestSigningSession={null}
              hasPendingInvite={pendingInviteToken !== null}
              pendingInviteDetails={pendingInviteDetails}
              onSessionCreated={onSessionCreated}
              onRegistered={onRegistered}
              variant="team"
              defaultMode="sign_in"
              allowDirectSignup={false}
            />
            {errorMessage ? <div className="alert" style={{ marginTop: "0.75rem" }}>{errorMessage}</div> : null}
            {noticeMessage ? <div className="alert success" style={{ marginTop: "0.75rem" }}>{noticeMessage}</div> : null}
            <section className="card landing-side-note">
              <div className="section-heading compact">
                <p className="eyebrow">Team path</p>
                <span>Separate from customer traffic</span>
              </div>
              <p className="muted">
                Keep AG Operations sign-in, tester invites, billing review, and admin visibility on a dedicated page.
              </p>
              <p className="muted">
                Customer-facing messaging stays on the main site so buyers see the workflow value first.
              </p>
            </section>
          </div>
        )}
      </div>
      {showCustomerStartSection ? (
        <section className="landing-section" id="landing-start">
          <div className="landing-section-header">
            <p className="eyebrow">Get started</p>
            <h3>Start your workspace and move your first customer-ready workflow through the system</h3>
            <p className="muted">
              Create your account, set up your workspace, and begin preparing documents in the same place your team will manage them.
            </p>
          </div>
          <div className="landing-access-grid">
            <div className="landing-access-card">
              <AuthPanel
                sessionUser={null}
                guestSigningSession={null}
                hasPendingInvite={pendingInviteToken !== null}
                pendingInviteDetails={pendingInviteDetails}
                onSessionCreated={onSessionCreated}
                onRegistered={onRegistered}
                variant="customer"
                defaultMode="sign_up"
              />
              {errorMessage ? <div className="alert" style={{ marginTop: "0.75rem" }}>{errorMessage}</div> : null}
              {noticeMessage ? <div className="alert success" style={{ marginTop: "0.75rem" }}>{noticeMessage}</div> : null}
            </div>
            <article className="card landing-access-card landing-access-secondary">
              <p className="eyebrow">What happens next</p>
              <h3>Your customer workflow starts here</h3>
              <p className="muted">
                Everything on this page is designed for customer-facing teams who want a clean start and a clear path to sending live documents.
              </p>
              <ul className="landing-features compact">
                <li>
                  <strong>Create your workspace</strong>
                  <span>Name your workspace, invite teammates, and centralize the PDFs your customers need to review and sign.</span>
                </li>
                <li>
                  <strong>Prepare without friction</strong>
                  <span>Set routing, assign signers, and control the flow before anything reaches a customer inbox.</span>
                </li>
                <li>
                  <strong>Send with confidence</strong>
                  <span>Track progress, review the audit trail, and export the final record when the workflow is complete.</span>
                </li>
              </ul>
            </article>
          </div>
        </section>
      ) : null}
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
          <p className="muted">
            From upload through completion, the workflow stays visible to your team while customers only see the action path they need.
          </p>
        </div>
        {publicPage === "home" ? null : (
          <article className="toolbar-card landing-tour-visual">
            <img
              className="landing-tour-image"
              src="/marketing/easydraft-document-lifecycle.png"
              alt="EasyDraft document lifecycle from upload through prepare, send, sign, finalize, seal, and export."
            />
          </article>
        )}
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
            <p className="muted">Owners monitor billing, workflow risk, audit history, and final exports from one control center.</p>
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
            <a className="ghost-button" href="/privacy" onClick={(event) => handlePublicNav(event, "privacy")}>Open privacy</a>
          </article>
          <article className="toolbar-card">
            <strong>Terms</strong>
            <p className="muted">Review the private-beta usage posture and scope of the current release.</p>
            <a className="ghost-button" href="/terms" onClick={(event) => handlePublicNav(event, "terms")}>Open terms</a>
          </article>
          <article className="toolbar-card">
            <strong>Security</strong>
            <p className="muted">See how SHA-256 integrity, audit history, and queue visibility work today.</p>
            <a className="ghost-button" href="/security" onClick={(event) => handlePublicNav(event, "security")}>Open security</a>
          </article>
          <article className="toolbar-card">
            <strong>Getting started</strong>
            <p className="muted">Review pricing, start a workspace, and move from setup to your first live workflow without leaving the customer path.</p>
            {showCustomerStartSection ? (
              <a className="ghost-button" href="#landing-start">Open workspace setup</a>
            ) : (
              <a className="ghost-button" href="/" onClick={(event) => handlePublicNav(event, "home")}>Back to overview</a>
            )}
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
