# Architecture

## System boundaries

### Client app

Responsibilities:

- authentication UX
- upload initiation
- PDF preview and editing interactions
- signer setup, review, and send flows
- audit and version history views

This layer should stay thin. It orchestrates, but does not own workflow truth or heavy document processing.

### Workflow service

Responsibilities:

- authentication/session validation
- document metadata and workflow state
- role-based access control
- field assignment
- signer routing
- audit trail
- version history
- export eligibility

### Document-processing service

Responsibilities:

- OCR jobs
- field-detection jobs
- PDF transforms such as rotate, reorder, split, merge, and flatten
- provenance and confidence metadata for machine-assisted results

### Storage

Responsibilities:

- object storage for source PDFs, working artifacts, thumbnails, and exports
- relational storage for workflow state, access control, and audit records
- queue storage for processing jobs

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
- `document.exported`

## Next implementation step after this bootstrap

1. Replace in-memory workflow storage with Postgres
2. Replace mock processing responses with queue-backed jobs
3. Persist version snapshots after each editing transform
4. Add real PDF canvas editing using PDF.js plus server-side transform jobs
