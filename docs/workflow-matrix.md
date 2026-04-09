# Workflow Matrix

This matrix turns common document-handling requests into a small set of canonical flows.

The goal is to avoid inventing a new workflow type for every customer story. Most requests can be expressed as a combination of:

- origin: internal or external
- participants: internal, external, or mixed
- routing: sequential, parallel, or staged
- delivery: self-managed, internal-use-only, or platform-managed
- completion control: all required fields complete, or authorized lock

## Canonical flows

| ID | Flow | Origin | Participants | Routing | Delivery | Returns to | Typical use |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | Internal single-use | Internal | Internal | Single signer or optional signer | Self-managed or internal-use-only | Originator or workspace | One person edits, signs if needed, saves, downloads, distributes, or locks |
| F2 | Internal multi-signature | Internal | Internal | Sequential or parallel | Internal-use-only | Originator | Department approvals, internal signoffs, controlled revision loop |
| F3 | Internal then external | Internal | Mixed | Staged | Platform-managed | Originator | Prepare internally, finalize internally, send outward for customer or vendor signature |
| F4 | Internal multi-signature then external approval | Internal | Mixed | Staged with internal sequential or parallel, then external | Platform-managed | Originator | Internal review before external signoff or acknowledgment |
| F5 | Shared-folder mixed signing | Internal or external | Mixed | Sequential, parallel, or staged | Depends on recipient handling | Shared folder and originator | Team-managed document pool with revision trace by user identity |
| F6 | External-only signing | Internal | External | Single, sequential, or parallel | Platform-managed or self-managed | Originator | Send directly to customer, tenant, supplier, or applicant without internal signers |
| F7 | External intake and return | External | Mixed | Staged | Self-managed or platform-managed | Internal originator | Outside party drops in a file, internal team edits or signs, then returns it |
| F8 | Approval without signature | Internal or external | Internal, external, or mixed | Sequential, parallel, or staged | Any | Originator or record owner | Review, approve, reject, acknowledge, or comment without every step being a legal signature |

## Recommended v1 workflow rules

### Treat these as dimensions, not separate engines

- `deliveryMode` decides how the file is delivered or kept inside the app.
- `routingStrategy` decides whether signers act sequentially or in parallel.
- participant type decides whether signers are internal users, external invitees, or both.
- stage boundaries decide when the workflow moves from internal to external or back again.

### Keep "shared folder" out of the workflow core

Shared folder is best treated as an intake or collaboration surface, not as a separate routing model.

The same underlying flow should still answer:

- who can edit
- who can sign
- who is next
- whether changes create a revision
- when the document is complete

### Keep lock authority narrow

Do not assume any signer can lock at any time.

Safer defaults:

- owner can lock
- originator can lock
- admins can lock
- optionally current active signer can lock if policy allows

## Exceptions every flow should support

These are common enough that they should be first-class behaviors, not edge cases.

- reopen after lock
- revision after partial completion
- signer reassignment or delegation
- decline or reject
- cancel by originator
- expiration
- reminders and nudges
- post-completion distribution
- audit trail for every major action

## Minimal state model

The current core states are still reasonable:

- draft
- prepared
- sent
- partially signed
- completed
- reopened

Common operational statuses that may also deserve visibility in the UI, even if they are not top-level workflow states:

- awaiting internal review
- awaiting external signature
- declined
- canceled
- expired
- locked early

## Suggested product language

For the product spec, describe the experience as a workflow builder with a small number of knobs:

1. Choose who participates: internal, external, or mixed.
2. Choose how signing moves: sequential, parallel, or staged.
3. Choose how delivery works: self-managed, internal-only, or app-managed.
4. Choose who gets notified and when.
5. Choose who can lock, reopen, or revise.

## Mapping to the current model

The existing domain model already supports the main shape of this matrix:

- access roles: owner, editor, signer, viewer
- routing strategies: sequential, parallel
- delivery modes: self-managed, internal-use-only, platform-managed
- workflow states: draft, prepared, sent, partially signed, completed, reopened
- notifications for signature request and signature progress

What would still need explicit product and data-model decisions for full coverage:

- staged routing as a first-class concept
- expire status surfaced more explicitly in the UI
- lock permissions by policy instead of broad signer access
- change-impact classification after partial signing

## Future-state roadmap

For the full current workflow reference (states, routing, delivery modes, field types, permissions), see [future-workflow-roadmap.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/future-workflow-roadmap.md).

## Next steps for workflow coverage

- formalize staged routing as a first-class workflow concept rather than an emergent pattern
- add change-impact classification for post-sign edits
- decide how expiration should appear operationally for owners and participants
- evaluate certificate-backed signing only when customer demand justifies it
