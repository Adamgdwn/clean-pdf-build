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

**Typecheck, tests, and build all pass.** The product is feature-complete for an internal pilot.

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

### What is a stub / next phase
- **Certificate-backed PDF signing** — `DigitalSignatureProfile` records and the UI exist; the provider wiring (PAdES/CAdES embedding) is a clearly marked TODO in `renderDocumentExportToStorage` in `service.ts`. Safe to leave until there is proven customer demand.
- **Change-impact classification** — edits after partial signing are audited but not yet classified as `non_material`, `review_required`, or `resign_required`.
- **Rate limiting depth** — basic in-memory throttling is now in place for sensitive API paths, but a shared/distributed limiter would still be better before heavier public traffic.

---

## Next steps

### Before any external users

1. **Apply all Supabase migrations to production**
   ```bash
   npx supabase db push
   ```
   Pending migrations add: `export_sha256` column, external signer token ledger, workspace invitations, Stripe CAD billing plan, and digital-signature identity fields.

2. **Verify Stripe is wired in production**
   - `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` must be set in Vercel
   - Confirm the `easydraft_team` and `easydraft_team_annual` billing plan rows exist in the `billing_plans` table
   - Test a full checkout → webhook → subscription sync in Stripe test mode first
   - See `STRIPE_INTEGRATION_NOTES.md` for the full setup checklist

3. **Run a structured end-to-end smoke test** (one person, ~30 min)
   Use one owner account and one normal user account.
   - Sign up → receive free trial
   - Confirm both `User workspace` and `Owner portal` are visible for the owner account
   - Create one saved signature in the signature library
   - Create one digital-signature profile with signer identity details
   - Upload a PDF → add a signer → add a signature field → send
   - During signing, choose a `Reason for signing` and optional `Signing location`
   - Open the signer token link in a private window → complete the field
   - Download the signed PDF → open the completion certificate → verify SHA-256 hash matches `sha256sum` output
   - Invite a teammate → accept the invite → confirm workspace membership
   - Cancel the trial from the billing portal
   - Delete the test account

4. **Confirm email delivery end-to-end**
   - Send a platform-managed workflow to an external address
   - Confirm the email arrives from `noreply@easydraftdocs.app`
   - Check the signing link opens correctly and the guest session loads

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
