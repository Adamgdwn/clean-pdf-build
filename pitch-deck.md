# EasyDraftDocs
## Refine. Share. Sign.

*The PDF signing tool that doesn't punish you for having teammates.*

---

## The Problem with Every Other Tool

Most PDF signing platforms were built for enterprise legal departments and then priced that way forever. Small and mid-size teams end up paying for:

| Pain | Reality |
|---|---|
| **Envelope limits** | You hit a cap, then pay per send |
| **Per-seat enterprise pricing** | $25–65 USD per seat/month before add-ons |
| **Required signer accounts** | Clients must register before they can read your document |
| **Feature bloat** | Full layout editors, API suites, custom branding — you use 10% of the product |
| **Audit trail you can't verify** | You trust a black box for your signed records |

---

## What EasyDraftDocs Does

**Upload existing contracts and agreements. Place only the fields you need. Route for signatures. Get a tamper-evident signed record.**

That's the whole product. It is not a PDF editor. It is a workflow-safe execution layer for documents you already have.

---

## How It Works — Seven Steps

```
  Upload → Prepare → Send → Sign → Complete → Export → Lock
```

| Step | What happens |
|---|---|
| **1. Upload** | Your PDF goes into private storage. No one else can see it. |
| **2. Prepare** | Add signers, place fields (signature / initials / approval / date / text), choose routing. |
| **3. Send** | Routing activates. Participants are notified in the order you set. |
| **4. Sign** | Each person completes their assigned fields. Sequential routing advances automatically. |
| **5. Complete** | All required fields done — document is marked complete. |
| **6. Export** | Signatures are rendered into the final PDF. A SHA-256 hash is recorded. |
| **7. Lock** | Explicit lock prevents further changes. Reopen resumes the workflow if needed. |

---

## Three Workflow Modes

Choose per document — not per account.

### Self-Managed
> *You control distribution.*

Store and prepare the document in EasyDraftDocs. Download and send it yourself — email, shared drive, whatever you already use. No routing, no external emails. The audit trail is still recorded internally.

**Best for:** Solo reviews, internal drafts, situations where you own the last mile.

---

### Internal Only
> *Your team signs inside the app.*

All participants are workspace members. No external emails sent. Sign directly in the platform with sequential or parallel routing.

**Best for:** Internal approvals, policy acknowledgements, multi-department sign-offs.

---

### Platform-Managed
> *EasyDraftDocs emails your signers.*

EasyDraftDocs emails each participant a secure, one-time signing link — in routing order. External signers need no account. Before completing any signature or approval action, they verify their identity via a one-time email code.

**Best for:** Client contracts, vendor agreements, anything that goes outside your organization.

> **How it's priced:** 1 token = 1 workflow sent to at least one external participant. Internal participants never consume tokens. Token packs are prepaid and shared across your organization.

---

## Field Types and Signing Options

| Field | Description |
|---|---|
| **Signature** | Full signature canvas |
| **Initials** | Initials block |
| **Approval** | Checkbox-style approval action |
| **Date** | Timestamp field |
| **Text** | Free-text entry |
| **Free-placement** | If no field was pre-assigned, signers can place and resize their own signature anywhere on the document |

---

## The Signed Record

When a document completes, EasyDraftDocs renders all signatures into the final PDF and records a **SHA-256 hash** of that exact file. Every download generates the same hash — so you always know whether the file has changed since signing.

The **completion certificate** includes:
- Every participant name and action
- Timestamps for every event
- The SHA-256 hash of the final PDF
- The full version history

Every action — view, sign, request-changes, lock, reopen — is captured in the **audit trail**, surfaced in the workspace panel.

> **Important:** The SHA-256 hash confirms file integrity. EasyDraftDocs does **not** currently embed cryptographic certificate signatures (PAdES/CAdES). That is a clearly marked next step in the product roadmap, not a current feature.

---

## For Teams: Corporate Accounts

One corporate account owns billing. Members share a token pool. Admins stay in control without touching every document.

**Account structure:**

```
  Organization (corporate account)
  ├── Shared billing + token pool
  ├── Member administration (invite, role, remove)
  ├── Workspace: Sales
  │   ├── NDA_ClientA.pdf
  │   └── MSA_2026.pdf
  └── Workspace: Legal
      └── Policy_update.pdf
```

**What admins get:**

- Owner KPI dashboard — documents needing attention, billing status, member count
- Shared token balance with full usage history
- Invite members by email with role assignment
- Invite acceptance fails closed if the wrong account tries to join (workspace isolation is protected)
- Workspace-aware navigation — billing, team, and documents stay scoped correctly

**Account types:**

| Type | For |
|---|---|
| **Individual** | One user, their own billing, their own workspace |
| **Corporate** | Parent account owns billing, members, and shared token balance |

---

## Pricing

### $12 CAD per seat / month
### or $120 CAD per seat / year

**30-day free trial. No credit card required.**

Everything is included at one price:

- All three workflow modes
- Sequential and parallel routing
- Audit trail, version history, completion certificates
- External signers via one-time link (no account needed)
- Email verification before any external signer action
- Prepaid external signer token packs (shared by org)
- Corporate accounts with admin, billing, and workspace management
- Self-service account deletion (cancels Stripe, removes all data)

---

### How That Compares

Competitor prices are published USD list rates for team/business plans, converted at approximately 1.38 CAD/USD. Prices vary by region and plan.

```
EasyDraftDocs  ████░░░░░░░░░░░░░░░░░░░░░░░░░░░  $12 CAD / seat
HelloSign      ████████████████░░░░░░░░░░░░░░░  ~$30+ CAD / seat
Adobe Sign     ████████████████████████░░░░░░░  ~$43+ CAD / seat
DocuSign Biz   ██████████████████████████████░  ~$52+ CAD / seat
```

EasyDraftDocs costs roughly **half** what major competitors charge — and doesn't cap your envelopes.

---

## What It Is and What It Isn't

Being honest is cheaper than a refund.

### What EasyDraftDocs does well

- Upload any PDF and prepare it for signing without editing the layout
- Place fields, assign participants, route sequentially or in parallel
- Send external signers a one-time link — they don't need an account
- Gate external signing actions behind an email verification code
- Record a full audit trail and SHA-256 integrity hash on every document
- Manage team access, billing, and shared tokens under one corporate account
- Let signers place their own signature if no field was pre-assigned
- Lock completed documents and reopen them if the workflow needs to resume

### What it doesn't do (yet)

- **Full PDF content editing** — EasyDraft is a workflow layer, not a layout editor. Bring your finished document; don't expect to rewrite it here.
- **Certificate-backed cryptographic signing** — SHA-256 confirms file integrity, but embedded PAdES/CAdES signing is a planned next step, not a live feature.
- **Legal compliance guarantees** — Check your jurisdiction's e-signature requirements before relying solely on EasyDraft for legally regulated documents.
- **Integrations or API access** — Standalone workflow tool only, no integrations in the current plan.
- **Custom branding or white-labelling** — Not available on the base plan.

---

## Start Your Free Trial

**30 days. No credit card. Cancel or delete your account anytime — entirely self-service.**

[easydraftdocs.app](https://easydraftdocs.app)

If you outgrow the trial: **$12 CAD per seat per month** is all it costs to keep going.

---

*Questions? Read the user guide at easydraftdocs.app/guide.html*
*Privacy · Terms · Security — easydraftdocs.app*
