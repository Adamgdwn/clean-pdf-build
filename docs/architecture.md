# Architecture

## System boundaries

### Client app

Responsibilities:

- authentication UX
- public marketing and pricing surfaces
- upload initiation
- PDF preview and editing interactions
- signer setup, review, and send flows
- owner/admin control-center orchestration
- active workspace selection and persistence
- audit and version history views

This layer should stay thin. It orchestrates, but does not own workflow truth or heavy document processing.

### Workflow service

Responsibilities:

- authentication/session validation
- account resolution across individual and corporate parent accounts
- organization membership and billing scope
- document metadata and workflow state
- role-based access control
- field assignment
- participant classification and signer routing
- staged handoffs across internal and external participants
- approval and signature workflow completion
- lock policy enforcement
- audit trail
- version history
- export eligibility

For current workflow reference (states, delivery modes, routing strategies, field types, permissions), see [future-workflow-roadmap.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/future-workflow-roadmap.md).

### Document-processing service

Responsibilities:

- OCR jobs
- field-detection jobs
- PDF transforms such as rotate, reorder, split, merge, and flatten
- provenance and confidence metadata for machine-assisted results

### Storage

Responsibilities:

- object storage for source PDFs, working artifacts, thumbnails, and exports
- relational storage for account hierarchy, workflow state, access control, and audit records
- queue storage for processing jobs

## Account hierarchy

EasyDraft now uses a parent-account model:

- `User` — login identity in Supabase Auth plus product profile
- `Organization` — parent account boundary (`individual` or `corporate`)
- `Workspace` — operational container for documents and day-to-day workflow activity
- `Document` — workflow record owned by a workspace

Product behavior:

- individual accounts get a private account and workspace
- corporate accounts own billing, member management, and the shared external-token pool
- workspaces remain the unit that documents, team screens, and workflow data attach to

## Client component structure

The client app (`apps/web/src/`) is being incrementally extracted from a monolithic `App.tsx` into focused components. Current state:

```
src/
  types.ts                  — shared client-side type definitions
  App.tsx                   — top-level orchestrator (workspace shell, public routes, signer flow, owner/workspace state)
  components/
    AuthPanel.tsx           — sign-in/sign-up form, signed-in view, guest signing banner
    AdminPanel.tsx          — AdminConsole (full panel) + AdminSidebarSummary (card)
    BillingPanel.tsx        — billing overview, plan selection, portal link
    ErrorBoundary.tsx       — reusable error boundary with Try Again reset
```

Extraction order (in progress):
1. ✅ AuthPanel — auth form + guest signing banner, owns its own loading/error state
2. ✅ AdminPanel — AdminConsole owns invite/delete/reset handlers + scoped error state
3. ✅ BillingPanel — checkout/portal handlers + scoped redirect/error state
4. ✅ OwnerPortal — owner-first KPI, watchlist, billing/team/admin composition
5. Next: DocumentSidebar, WorkflowChecklistPanel, FieldEditorPanel, public landing/pricing extraction

## Workflow features added

### Per-signer notification status (Session 5)
Each participant row in the workflow now shows:
- Last emailed timestamp and delivery status (`queued` / `sent` / `failed`) derived from `document.notifications`
- Individual **Resend** button for eligible pending signers on platform-managed documents
- `remindDocumentSignersForAuthorizationHeader` accepts optional `signerIds` to scope reminders to specific signers

### Completion certificate (Session 5)
A **Certificate** button appears in Document Actions when `workflowState === "completed"`. It generates a standalone HTML page client-side from `document.signers`, `document.fields`, and `document.auditTrail` and opens it in a new tab. The user can print to PDF from there. No server round-trip required.

State that remains in App.tsx intentionally:
- `session` / `sessionUser` — needed by nearly every handler
- `guestSigningSession` — consumed by field canvas and field-complete handler
- `selectedDocument` / `documents` — drives entire workspace panel
- `activeWorkspaceId` / `availableWorkspaces` — scopes authenticated data across organization billing, team, and document flows
- `publicPage` — controls unauthenticated home vs pricing route behavior

## Recommended boring stack

- Client: React + Vite + TypeScript
- Workflow API: Fastify + TypeScript
- Processing service: Fastify worker facade + TypeScript
- Shared domain: Zod schemas + pure TypeScript rules
- Database: Postgres
- Object storage: S3-compatible bucket storage
- Queue: Redis-backed job queue

## Security posture

- Cloud processing is default, but isolated behind service boundaries
- Access decisions happen in the workflow service, not in the client
- Audit events are append-only in spirit even if storage changes later
- Lock and reopen actions are explicit events, never inferred from UI state
- Processing services should operate on scoped object references, not broad account access

## Event examples

- `document.uploaded`
- `document.prepared`
- `document.sent`
- `document.locked`
- `document.reopened`
- `field.created`
- `field.assigned`
- `field.completed`
- `processing.ocr.requested`
- `processing.ocr.completed`
- `processing.field_detection.completed`
- `document.renamed`
- `document.exported`

## Next implementation steps

1. Extract the public landing and pricing surfaces out of `App.tsx`.
2. Extract the document workspace sidebar and checklist/editor panels into focused components.
3. Replace in-memory/shared-instance assumptions such as rate limiting with durable infrastructure.
4. Deploy OCR and notification processing on a scheduled/container runtime.
