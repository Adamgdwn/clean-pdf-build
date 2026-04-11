# EasyDraftDocs

A production-ready, minimal-change PDF workflow platform. Teams upload existing contracts and agreements, place only the fields they need, assign signers, route for signatures and approvals, and receive a complete audit trail and signed export without turning EasyDraft into a general PDF editor.

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
- Individual and corporate account signup paths
- Corporate accounts with shared billing, member administration, and pooled external signer tokens
- Team invitations with organization and workspace membership management
- Stripe billing: 30-day free trial (no card), $12 CAD/seat/month or $120 CAD/seat/year, prepaid shared external signer tokens
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
- Individual accounts for solo users and corporate accounts for teams
- Corporate admin view with shared billing and pooled token balance
- Team invitations with organization and workspace membership management
- Workspace-aware navigation with persistent active-workspace selection
- Owner-first organization control center with KPI summary, watchlist, billing, team, and admin layers
- Public landing page with dedicated pricing, privacy, terms, and security routes
- Stripe billing: 30-day free trial, seat subscription, token packs, and Customer Portal
- Email via Resend (`noreply@easydraftdocs.app`, DKIM + SPF verified) or SMTP
- Admin console for user management, resets, and deletion
- Feedback intake with bug reports, feature requests, and admin-side triage workflow
- Change-impact classification for post-sign document edits with `non_material`, `review_required`, and `resign_required`
- Redis-backed production rate limiting plus admin-visible queue metrics and Sentry hooks
- Self-service account deletion
- User guide at `/guide.html`

### Still intentionally unfinished
- **Certificate-backed PDF signing**: the `DigitalSignatureProfile` model and UI exist, but actual PAdES/CAdES embedding is still a TODO in `renderDocumentExportToStorage`.
- **Background processing runtime**: OCR and queued notification retries still need a durable scheduled/container deployment.
- **External alert routing**: error capture and queue visibility exist, but production alert delivery and escalation ownership still need final operational setup.

### Current product boundary
- EasyDraft is a workflow-safe PDF execution layer, not a full PDF editor.
- After upload, the intended scope is still minimal workflow changes only: place fields, assign participants, route, sign, review, lock, reopen, and complete.
- The next hardening pass should strengthen signer verification and executed-record durability before adding broader editing power.

---

## Latest product changes

The latest application pass closed the most important product-surface gaps for selling and onboarding:

- owner-capable users land in `org_admin` by default
- organization admin and workspace views are visually separated and easy to toggle
- signup now distinguishes between individual accounts and corporate parent accounts
- corporate accounts own shared member access, billing posture, and token purchasing
- owner KPIs and “needs attention” items now lead the experience
- landing page now answers product purpose, audience, and next actions above the fold
- `/pricing` is now a first-class public route with clearer subscription/token explanation
- invitation emails now explain inviter, organization, role, and expected outcome
- invite acceptance now activates the joined organization and confirms membership clearly
- active workspace is explicit and persistent for multi-workspace users
- loading/skeleton states now cover workspace hydration and switching

## What Just Completed

- Public trust/legal pages now exist as first-class routes and have deployment smoke coverage.
- Certificate-backed signing claims were corrected so public copy reflects the current live assurance level.
- Admin feedback intake moved from raw storage toward a triage-ready operator workflow.
- Rate limiting, observability, and queue/admin visibility were hardened for private beta operations.
- Workflow change-impact handling and the operator loop were documented more clearly across the repo.
- The product direction was re-audited against the latest brief to re-center EasyDraft on its core: upload, place fields, assign, verify, complete, preserve evidence.

---

## Documentation map

- [ADAMS_ACTIONS.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/ADAMS_ACTIONS.md): launch-owner task list
- [docs/go-live-checklist.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/go-live-checklist.md): deployment and release gate checklist
- [docs/admin-instructions.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/admin-instructions.md): operator and admin workflow guide
- [docs/workflow-matrix.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/workflow-matrix.md): canonical workflow patterns
- [docs/architecture.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/architecture.md): system and codebase structure
- [docs/identity-and-monetization.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/identity-and-monetization.md): role and billing model
- [docs/operator-runbook.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/operator-runbook.md): queue, feedback, and release operating loop
- [docs/current-priority-handoff.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/current-priority-handoff.md): end-of-day summary of what completed and what comes next
- [CHANGELOG.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/CHANGELOG.md): release-facing change log

---

## Next steps

### Immediate product hardening

1. **Keep the product boundary tight**
   - preserve EasyDraft as a minimal workflow-safe PDF system
   - avoid expanding into arbitrary content/layout editing
   - keep the workflow core extraction focused on field placement, signer actions, and workflow state

2. **Harden external signer verification**
   - add email OTP verification before final external signature/initial/approval submit
   - bind verification method to the completion event
   - tighten token replay, resend invalidation, and completion idempotency

3. **Strengthen executed-record durability**
   - prevent ordinary deletion of completed executed records
   - make reopen/create-next-workflow behavior preserve completed history cleanly
   - keep final PDF hash, certificate, and audit chain attached to the executed artifact

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

3. **Verify trust and legal surfaces**
   - confirm `/pricing`, `/privacy`, `/terms`, and `/security` resolve directly after deployment
   - review privacy, terms, and security copy with legal/founder eyes before broader selling
   - add customer-ready screenshots or proof content for sales conversations

### Short-term product improvements

4. **Close remaining change-impact coverage gaps**
   - verify every post-sign document mutation path maps to `non_material`, `review_required`, or `resign_required`
   - keep the current classification model and tighten endpoint coverage rather than redesigning it

5. **Keep deployment truth aligned with production controls**
   - document Upstash-backed rate limiting and Sentry DSNs in `.env.example` and deployment docs
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

8. **Operationalize monitoring**
   - keep Sentry and admin queue metrics wired in production
   - add alert routing and operator ownership for failed notifications and stuck jobs
   - use the operator runbook and smoke checks on every deploy

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
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Shared production rate limiting |
| `SENTRY_DSN` + `VITE_SENTRY_DSN` | Server/client error capture |
| `EASYDRAFT_ENABLE_CERTIFICATE_SIGNING` + `VITE_EASYDRAFT_ENABLE_CERTIFICATE_SIGNING` | Explicitly gated certificate-signing feature flag |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Stripe billing; required when `EASYDRAFT_REQUIRE_STRIPE=true` or in production runtime |
| `RESEND_API_KEY` or SMTP vars | Email delivery; required when `EASYDRAFT_REQUIRE_EMAIL_DELIVERY=true` or in production runtime |
| `EASYDRAFT_PROCESSOR_SECRET` | Shared secret for processor endpoints; required in production runtime |
| `SUPABASE_DOCUMENT_BUCKET` + `SUPABASE_SIGNATURE_BUCKET` | Storage bucket names |

---

## Key product rules

**Completion is field-level, not envelope-level.** A document stays signable until every required assigned action field is complete — or someone explicitly locks it. Locking records who locked it and when.

**Tokens are consumed per external workflow send.** Internal participants on platform-managed workflows don't consume tokens. 1 token = 1 workflow sent to at least one external participant. For corporate accounts, token balance is shared across the organization and tracked as all-time credits minus all-time usage.

**Corporate accounts are parent accounts.** A user can operate alone with an individual account or belong to a corporate account that owns billing, member administration, and the shared token bucket. Workspaces remain the operational container for documents.

**Account deletion is irreversible.** It cancels Stripe, removes all storage files, and cascade-deletes the entire DB record tree. Users must type their email address to confirm.

**SHA-256 integrity, not cryptographic signing (yet).** Every download generates a SHA-256 hash of the rendered PDF bytes and stores it on the document. The completion certificate shows this hash. Full PAdES/CAdES signing is a clearly marked next step in the code.

**License posture is proprietary.** This repository is intentionally unlicensed for public reuse. See [LICENSE.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/LICENSE.md).

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
