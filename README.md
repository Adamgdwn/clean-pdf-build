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

**Typecheck and production build pass.** EasyDraft now presents as a business workflow platform rather than a dressed-up single-user PDF tool. The owner/admin landing, invite flow, signer surface, pricing visibility, and workspace-awareness work are all in the product.

### What is live and working
- All three delivery modes: self-managed, internal-only, and platform-managed
- Sequential and parallel routing with internal and external participants
- External signer token links with no account required
- Dedicated external signer surface with completion confirmation
- Free-placement signature canvas for signers
- Full audit trail, version history, lock/reopen, and completion certificate with SHA-256 export hash
- Team invitations with workspace membership and role management
- Workspace-aware navigation with persistent active-workspace selection
- Owner-first organization control center with KPI summary, watchlist, billing, team, and admin layers
- Public landing page with dedicated pricing route and product-tour content
- Stripe billing: 30-day free trial, seat subscription, token packs, and Customer Portal
- Email via Resend (`noreply@easydraftdocs.app`, DKIM + SPF verified) or SMTP
- Admin console for user management, resets, and deletion
- Self-service account deletion
- User guide at `/guide.html`

### Still intentionally unfinished
- **Certificate-backed PDF signing**: the `DigitalSignatureProfile` model and UI exist, but actual PAdES/CAdES embedding is still a TODO in `renderDocumentExportToStorage`.
- **Change-impact classification**: edits after partial signing are audited, but not yet classified into `non_material`, `review_required`, or `resign_required`.
- **Distributed rate limiting**: sensitive routes have baseline in-memory protection, but heavier public traffic should move to a shared limiter.
- **Background processing runtime**: OCR and queued notification retries still need a durable scheduled/container deployment.

---

## Latest product changes

The latest application pass closed the most important product-surface gaps for selling and onboarding:

- owner-capable users land in `org_admin` by default
- organization admin and workspace views are visually separated and easy to toggle
- owner KPIs and “needs attention” items now lead the experience
- landing page now answers product purpose, audience, and next actions above the fold
- `/pricing` is now a first-class public route with clearer subscription/token explanation
- invitation emails now explain inviter, organization, role, and expected outcome
- invite acceptance now activates the joined organization and confirms membership clearly
- active workspace is explicit and persistent for multi-workspace users
- loading/skeleton states now cover workspace hydration and switching

---

## Documentation map

- [ADAMS_ACTIONS.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/ADAMS_ACTIONS.md): launch-owner task list
- [docs/go-live-checklist.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/go-live-checklist.md): deployment and release gate checklist
- [docs/admin-instructions.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/admin-instructions.md): operator and admin workflow guide
- [docs/workflow-matrix.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/workflow-matrix.md): canonical workflow patterns
- [docs/architecture.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/architecture.md): system and codebase structure
- [docs/identity-and-monetization.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/identity-and-monetization.md): role and billing model

---

## Next steps

### Before active selling

1. **Finish manual launch configuration**
   - Stripe Billing → enable "Send an invoice for free trials"
   - Stripe Billing → enable "Send emails about upcoming renewals"
   - Stripe Branding → upload logo, set brand colour and business name

2. **Run the final commercial smoke test**
   - Run a full checkout with card `4242 4242 4242 4242`
   - Confirm subscription appears in the app and the $0 invoice email arrives
   - Send one real platform-managed workflow to an external address and confirm the signing link opens
   - Sign up as a new owner and confirm landing in Organization admin view
   - Accept an invite into an existing org and confirm the correct workspace becomes active
   - Switch between at least two workspaces and confirm billing, team data, and documents remain scoped correctly

3. **Publish trust and legal surfaces**
   - add privacy policy
   - add terms of service
   - add a short security/privacy summary for prospects
   - add customer-ready screenshots or proof content for sales conversations

### Short-term product improvements

4. **Add change-impact classification**
   - `non_material`: labels, metadata, layout-only changes
   - `review_required`: content changes in unsigned sections
   - `resign_required`: changes that affect already signed content or field placement

5. **Upgrade rate limiting beyond single-instance memory**
   - move to a shared store or edge-native limiter
   - keep the strictest limits on signing token validation, uploads, and notification dispatch

6. **Improve billing clarity in-product**
   - surface recent token ledger activity from `billing_usage_events`
   - add stronger trial-end messaging with specific date and expected charge
   - keep “change seats or plan” prominent for owners

7. **Wire certificate-backed PDF signing when demand is proven**
   - pick a provider: `easy_draft_remote`, `qualified_remote`, or `organization_hsm`
   - use `node-signpdf` or provider SDK to embed a PKCS#7 `/Sig` annotation
   - keep signer identity in reusable profiles and capture reason/location at signing time

### Operations

8. **Set up monitoring**
   - add Vercel log drains or Sentry
   - watch `document_notifications` for `failed` rows
   - track `pendingNotifications` and `queuedProcessingJobs` in the admin console

9. **Deploy the processor on a durable schedule**
   The document processor (`services/document-processor`) handles OCR jobs and queued notification retries. For the pilot it can be triggered manually:
   ```bash
   npm run processor:run-queued
   npm run processor:run-notifications
   ```
   For sustained usage, deploy it as a container or cron-triggered worker.

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
