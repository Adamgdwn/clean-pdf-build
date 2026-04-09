# EasyDraftDocs

A production-ready PDF workflow platform. Teams upload contracts and agreements, assign signers, route for signatures and approvals, and receive a complete audit trail and signed export — without chasing anyone down.

**Live:** [easydraftdocs.app](https://easydraftdocs.app) · **User guide:** [easydraftdocs.app/guide.html](https://easydraftdocs.app/guide.html)

---

## What it does

- PDF upload with private Supabase Storage
- Three workflow paths: self-managed, internal-only, and platform-managed routing
- Sequential and parallel signing with stage-based routing
- Field types: signature, initial, approval, date, text
- Free-placement resizable signature for signers (no pre-placed field required)
- External signers via one-time token link — no account needed
- Full audit trail, version history, lock/reopen, and completion certificate with SHA-256 hash
- Team invitations with workspace membership and role management
- Stripe billing: 30-day free trial (no card), $12 CAD/seat/month or $120 CAD/seat/year, prepaid external signer tokens
- Self-service account deletion: cancels Stripe, deletes all storage, cascades DB

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite → Vercel |
| Serverless API | Vercel Functions (`apps/web/api/`) |
| Local API parity | Fastify (`services/workflow-api`) |
| Background jobs | Node processor (`services/document-processor`) |
| Database + Auth | Supabase (Postgres + RLS + Auth) |
| Storage | Supabase Storage (private buckets) |
| Billing | Stripe Checkout + Customer Portal |
| Email | Resend (configured) or SMTP |
| Shared logic | `packages/workflow-service`, `packages/domain` |

---

## Current status (April 2026)

**Typecheck, tests, and build all pass.** The product is feature-complete for an internal pilot. An owner portal audit (April 2026) identified the highest-priority gaps before showing the product to the first paying team — those are the focus of the next development sprint.

### What is live and working
- All three delivery modes (self-managed, internal-only, platform-managed)
- Sequential and parallel routing with stage-based handoffs
- External signer token links — no account required
- Free-placement signature canvas for signers
- Stripe billing: free trial, seat subscription, token packs, Customer Portal
- Team invitations, workspace membership, role management
- Email via Resend (`noreply@easydraftdocs.app`, DKIM + SPF verified)
- Full audit trail, SHA-256 export hash, completion certificate
- Admin console (user management, account reset, deletion)
- Self-service account deletion
- User guide at `/guide.html`
- Welcome email triggered on registration (via Resend/SMTP, non-fatal if unconfigured)
- Server-side onboarding flag (`onboarding_completed_at` on `profiles`) — state follows the user across devices and browsers
- Authenticated identity block in the sidebar — avatar initial, display name, sign-out
- Toast feedback on sign-in and sign-out
- Personalized onboarding prompt with first name and product value line
- Prominent empty-state card with upload CTA for new users with no documents
- Sidebar toolbox nav — scrolls to Documents, Signatures, or Account section
- Quick actions card — Upload PDF, Resume last, Create signature, Team & billing
- Billing fuel gauge — trial countdown or "Active" status + token balance in sidebar header
- Team summary bar — workspace name + member count with one-click owner portal access
- Token purchase two-step confirmation — shows charge and card detail before redirecting

### What is a stub / next phase
- **Certificate-backed PDF signing** — `DigitalSignatureProfile` records and the UI exist; the provider wiring (PAdES/CAdES embedding) is a clearly marked TODO in `renderDocumentExportToStorage` in `service.ts`. Safe to leave until there is proven customer demand.
- **Change-impact classification** — edits after partial signing are audited but not yet classified as `non_material`, `review_required`, or `resign_required`.
- **Rate limiting depth** — basic in-memory throttling is now in place for sensitive API paths, but a shared/distributed limiter would still be better before heavier public traffic.
- **Organization admin gaps** — see the audit section below for the full list.

---

## Organization admin audit — path forward (April 2026)

An 18-finding audit of the owner-facing surfaces was completed in April 2026. The findings below are the actionable items sorted by priority and effort. Complete the critical items before the first paying team sees the product.

### Critical gaps

**1. Inline role change for existing members** (`TeamPanel.tsx`)
- Members cannot have their role changed after invitation — there is no UI or API endpoint for it.
- Add a role selector per member row that issues a PATCH request to a new `/api/workspace-member-role` endpoint.
- This is blocking: an owner cannot recover from a mis-assigned role without dev intervention.

**2. Member removal** (`TeamPanel.tsx`)
- There is no way to remove a member from the workspace — only pending invitations can be revoked.
- Add a "Remove" action per row that issues a DELETE to a new `/api/workspace-member` endpoint.
- Pair with an inline confirmation (same pattern as token purchase) — not `window.confirm()`.

**3. Watchlist navigation** (`OwnerPortal.tsx`)
- The "Documents needing attention" watchlist shows document names but they are not clickable.
- Pass a navigation callback from `App.tsx` into `OwnerPortal` and call it on row click.
- Low effort, high signal — the watchlist is the owner's most-used daily view.

**4. Replace `window.confirm()` in AdminPanel** (`AdminPanel.tsx`)
- `handleAdminDeleteUser` uses `window.confirm()` for a destructive irreversible action.
- Replace with an inline confirmation state (show warning + confirm button), same pattern as the token purchase flow.

### High-priority gaps

**5. Invitation expiry visibility** (`TeamPanel.tsx`)
- Pending invitation rows show no expiry date. Owners cannot tell if an invite is stale or still valid.
- Show `expiresAt` on each pending row. Style expired invites differently (muted or strikethrough).

**6. Remove duplicate "People and access" card** (`OwnerPortal.tsx`)
- OwnerPortal renders a "People and access" preview card that lists members and pending invites.
- TeamPanel (below it) covers this completely and in more detail.
- Remove the duplicate card — it adds scroll without information.

**7. Parallelize owner data refresh** (`OwnerPortal.tsx`)
- The "Refresh" button calls three sequential `await` fetches: billing, team, admin. ~3× slower than it needs to be.
- Wrap all three in `Promise.all`. Show a spinner or "Refreshing…" label during the fetch.

**8. Subscription seat/plan change** (`BillingPanel.tsx`)
- Once subscribed, there is no way to change the plan or seat count from within the app.
- The Stripe Customer Portal covers this, but the "Manage billing" button should be more prominent and carry a label like "Change seats or plan".

### Medium gaps

**9. Token consumption history** (`BillingPanel.tsx`)
- The `billing_usage_events` table has a full ledger of every token credit and spend event, but none of it is surfaced in the UI.
- Add a collapsible "Token history" section below the current balance — last 10 events from the ledger.

**10. Trial conversion call-to-action**
- During a free trial the billing panel says "Add payment method" but there is no urgency or framing around conversion.
- Add a short line showing days remaining and what happens at trial end (specific price, specific date).

**11. Empty admin state**
- When there are no pending notifications or queued jobs the admin panel renders blank sections.
- Add a "System is healthy" or "Nothing pending" indicator so owners know the panel loaded correctly.

**12. Owner portal loading state**
- All three owner panel sections (billing, team, admin) fetch independently. If one is slow the section renders blank.
- Add skeleton loaders or a "Loading…" indicator per section so the owner knows data is arriving.

### Summary table

| # | Area | Effort | Impact |
|---|------|--------|--------|
| 1 | Inline role change | Medium | Critical — ops blocker |
| 2 | Member removal | Medium | Critical — ops blocker |
| 3 | Watchlist navigation | Low | Critical — daily flow |
| 4 | Replace window.confirm | Low | Critical — unsafe UI |
| 5 | Invitation expiry | Low | High |
| 6 | Remove duplicate card | Low | High |
| 7 | Parallelize refresh | Low | High |
| 8 | Seat/plan change CTA | Low | High |
| 9 | Token history | Medium | Medium |
| 10 | Trial conversion CTA | Low | Medium |
| 11 | Empty admin state | Low | Medium |
| 12 | Owner loading states | Medium | Medium |

**Recommended order:** 3 → 4 → 6 → 7 → 5 → 8 → 2 → 1 → 9 → 10 → 11 → 12

---

## Next steps

### Before any external users (~93% complete as of April 2026)

Infrastructure is done: all 4 migrations applied to production, all Vercel env vars set, Stripe live mode wired with all 6 webhook events, auth config and storage buckets verified. What remains is manual configuration and a final smoke test.

1. **Stripe dashboard — manual steps (3 items)**
   - Billing → enable "Send an invoice for free trials"
   - Billing → enable "Send emails about upcoming renewals"
   - Branding → upload logo, set brand colour and business name

2. **Stripe checkout test**
   - Run a full checkout with card `4242 4242 4242 4242`
   - Confirm subscription appears in the app and the $0 invoice email arrives

3. **Domains**
   - Attach `easydraftdocs.app` in Vercel with a valid TLS certificate
   - Set `easydraftdocs.com` to redirect to `.app`

4. **Email delivery — one real send**
   - Send a platform-managed workflow to an external address
   - Confirm the email arrives from `noreply@easydraftdocs.app` and the signing link opens

5. **End-to-end smoke test** (~30 min)
   - Sign up as a new user → confirm landing in Organization admin view
   - Start free trial → confirm $0 invoice email from Stripe
   - Create a saved signature, upload a PDF, add a signer, place a field, send
   - Open signing link in private window → complete the field
   - Download signed PDF → verify SHA-256 hash matches `sha256sum` output
   - Invite a teammate → accept invite → confirm workspace membership
   - Purchase tokens → confirm balance updates
   - Cancel trial from billing portal
   - Delete test account → confirm deletion completes

### Short-term product improvements (pilot feedback phase)

5. **Add change-impact classification**
   When a document is edited after one or more signatures exist, classify the change:
   - `non_material` — labels, metadata, layout-only — no resigning needed
   - `review_required` — content changed in unsigned sections — notify affected signers
   - `resign_required` — signed text or field placement changed — flag impacted signatures, require resigning
   See the scenario test matrix in this README for the expected behavior.

6. **Upgrade rate limiting beyond single-instance memory**
   Sensitive API paths now have baseline throttling. Before heavier external traffic:
   - move to a shared store or edge-native rate limiter
   - keep the strictest limits on signing token validation, document upload, and notification dispatch

7. **Tighten the signer experience**
   The current signer flow works but is clinical. Before showing it to clients:
   - Add a purpose-built signing page (not the full sidebar layout)
   - Show the document prominently with field highlights
   - Make the submit confirmation feel deliberate and reassuring

8. **Wire certificate-backed PDF signing (when demand is proven)**
   The TODO block in `renderDocumentExportToStorage` (`service.ts`) describes exactly what to implement. When ready:
   - Pick a provider: `easy_draft_remote`, `qualified_remote`, or `organization_hsm`
   - Use `node-signpdf` or the provider SDK to embed a PKCS#7 `/Sig` annotation
   - The `DigitalSignatureProfile` model and UI are already in place
   - Keep signer identity in the reusable profile, but capture signing reason and location at signing time

### Operations

9. **Set up monitoring**
   - Add Vercel log drains or a Sentry DSN for error tracking
   - Watch the `document_notifications` table for `failed` status rows — these are emails that didn't send
   - The admin console shows `pendingNotifications` and `queuedProcessingJobs` counts

10. **Processor deployment**
    The document processor (`services/document-processor`) handles OCR jobs and queued notification retries. For the pilot it can be triggered manually:
    ```bash
    npm run processor:run-queued
    npm run processor:run-notifications
    ```
    For sustained usage, deploy it as a container or a cron-triggered function.

---

## Local development

```bash
npm install
npm run supabase:start
# copy values from: npx supabase status -o env → .env
npm run dev
```

Runs:
- Web client: `http://localhost:5173`
- Workflow API: `http://localhost:4000`
- Processor: `http://localhost:4010`

To run pending jobs manually:
```bash
npm run processor:run-queued
npm run processor:run-notifications
```

---

## Verification

```bash
npm run typecheck   # passes clean
npm run test        # passes clean
npm run build       # passes clean
```

CI runs all three on every push and PR via `.github/workflows/ci.yml`.

---

## Environment variables

See `.env.example`. Required for a working deployment:

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` | Client-side Supabase |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase |
| `EASYDRAFT_ADMIN_EMAILS` | Comma-separated admin email addresses |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Stripe billing; required when `EASYDRAFT_REQUIRE_STRIPE=true` or in production runtime |
| `RESEND_API_KEY` or SMTP vars | Email delivery; required when `EASYDRAFT_REQUIRE_EMAIL_DELIVERY=true` or in production runtime |
| `EASYDRAFT_PROCESSOR_SECRET` | Shared secret for processor endpoints; required in production runtime |
| `SUPABASE_DOCUMENT_BUCKET` + `SUPABASE_SIGNATURE_BUCKET` | Storage bucket names |

---

## Key product rules

**Completion is field-level, not envelope-level.** A document stays signable until every required assigned action field is complete — or someone explicitly locks it. Locking records who locked it and when.

**Tokens are consumed per external workflow send.** Internal team participants on platform-managed workflows don't consume tokens. 1 token = 1 workflow sent to at least one external participant. Token balance is all-time credits minus all-time usage.

**Account deletion is irreversible.** It cancels Stripe, removes all storage files, and cascade-deletes the entire DB record tree. Users must type their email address to confirm.

**SHA-256 integrity, not cryptographic signing (yet).** Every download generates a SHA-256 hash of the rendered PDF bytes and stores it on the document. The completion certificate shows this hash. Full PAdES/CAdES signing is a clearly marked next step in the code.

---

## Document lifecycle

1. **Upload** — PDF stored privately; document created in `draft`
2. **Prepare** — Add signers, assign fields, choose routing and delivery mode
3. **Send** — Routing activated; eligible participants notified
4. **Sign** — Participants complete assigned fields; sequential routing advances stage by stage
5. **Complete** — All required assigned fields done; document becomes `completed`
6. **Export** — Download renders signatures into the PDF; SHA-256 hash recorded; completion certificate available
7. **Lock / Reopen** — Explicit lock prevents further changes; reopen resumes the workflow

---

## Workflow paths

| Mode | Description |
|---|---|
| `self_managed` | Store and edit in EasyDraftDocs; distribute yourself via download or share link |
| `internal_use_only` | Internal team signs inside the app; no external emails sent |
| `platform_managed` | EasyDraftDocs emails each participant a secure signing link in routing order |

---

## Reference docs

- [User guide](apps/web/public/guide.html) — full customer lifecycle, in-app at `/guide.html`
- [Stripe integration notes](STRIPE_INTEGRATION_NOTES.md) — billing setup, webhook events, local testing
- [Deployment guide](docs/deployment.md)
- [Go-live checklist](docs/go-live-checklist.md)
- [Identity and monetization](docs/identity-and-monetization.md)
- [Future workflow roadmap](docs/future-workflow-roadmap.md)

---

## Scenario test matrix

Use this order to validate each delivery path before showing the product externally.

### 1. Internal-only single signer
Upload → add internal signer → add required signature field → open for signing → sign in as that user → complete field → verify `completed` state and audit trail.

### 2. Platform-managed single external signer
Upload → add external signer → add required field → send → open token link in private window → complete field → download PDF → verify SHA-256 hash in certificate.

### 3. Sequential two-signer
Add signer A (stage 1) and signer B (stage 2) → send → complete A → verify B becomes eligible → complete B → verify completion.

### 4. Parallel two-signer
Add both signers → parallel routing → send → both eligible simultaneously → complete both in any order → verify completion.

### 5. Request changes flow
Send to a signer → signer requests changes → verify document pauses and originator is notified → reopen → resend.

### 6. Lock before completion
Prepare a document with outstanding required fields → lock manually → verify it is no longer signable → reopen → verify signable again.

### 7. Free-placement signature
Send a document with no pre-placed fields → sign in as the signer → use the Place Your Own Signature canvas → drag to position and resize → Place and sign → verify field appears in audit trail.

### 8. Billing full cycle
Start free trial → add payment method → buy token pack → send to external signer (verify token consumed) → cancel subscription from portal → verify access continues until period end.
