# User Instructions

This guide covers how to use EasyDraft in its current product state.

Use this guide if you are:

- uploading and preparing documents
- assigning participants and fields
- sending a workflow
- completing assigned signature or approval fields
- reviewing workflow progress

## What EasyDraft does today

EasyDraft lets you:

- upload PDFs
- add and assign fields
- invite collaborators
- route internal and external participants
- collect signatures, initials, and approvals
- track audit trail and version history
- lock and reopen a document
- export, share, and duplicate completed or in-progress documents

The current workflow paths are:

- `self_managed`: prepare the PDF in EasyDraft, then download or distribute it yourself
- `internal_use_only`: keep the workflow inside EasyDraft for authenticated internal users
- `platform_managed`: let EasyDraft route the next eligible participant and queue progress notifications

## Signing up after an invite

If you were invited into EasyDraft:

- use the same email address that received the invite
- create your account or sign in
- complete your profile in the Account panel
- start using the app immediately if email confirmation is off for the pilot

Current behavior:

- pending document collaborator and signer access for your invited email attaches automatically after sign-in
- workflow emails are separate from account invite emails

## Roles in the document

- `owner`: full control of the document and workflow
- `editor`: can help prepare the document and manage routing
- `signer`: can complete their assigned workflow fields
- `viewer`: read-only access to the document context and history

A person can be both a collaborator and a signer on the same document.

## Core workflow states

The main workflow lifecycle is:

- `draft`
- `prepared`
- `sent`
- `partially signed`
- `completed`
- `reopened`

The workflow can also show operational status in the UI:

- `active`
- `overdue`
- `changes requested`
- `rejected`
- `canceled`

## Basic document flow

1. Upload a PDF.
2. Choose the workflow path and routing mode.
3. Add participants.
4. Add required fields and assign them to participants.
5. Optionally set a due date.
6. Send or open the workflow.
7. Watch the `waiting on` summary to see who is next.
8. Complete, lock, reopen, or export as needed.

## Creating and preparing a document

When you upload a PDF, choose:

- routing: `sequential` or `parallel`
- path: `self_managed`, `internal_use_only`, or `platform_managed`
- lock policy
- optional due date

After upload, prepare the document by:

- adding participants
- adding fields
- assigning each required signature, initial, or approval field
- checking the setup checklist before send

Important current rule:

- a document is not ready to send until it has at least one participant and every required action field is assigned

## Adding participants

Participants belong in the signer list when they are part of the routing flow.

For each participant, you can set:

- name
- email
- internal or external participant type
- stage
- action order
- required or optional

Use collaborator invites separately for editors and viewers.

## Adding fields

EasyDraft currently supports:

- signature
- initial
- approval
- text
- date

For workflow routing, the most important fields are:

- required signature fields
- required initial fields
- required approval fields

Assign required workflow fields to the correct participant before sending.

## Sending a workflow

What happens depends on the path you selected:

- `self_managed`: the document is marked ready and you distribute it yourself
- `internal_use_only`: internal users sign in and complete assigned fields inside EasyDraft
- `platform_managed`: EasyDraft queues the next eligible participant notification

The document panel shows:

- the current state
- the workflow status
- who the workflow is waiting on
- the due date if one is set

## Completing assigned fields

If you are the active signer, you can complete only the fields assigned to you.

For `platform_managed` workflows, external signers receive a one-time link by email. Clicking the link opens EasyDraft directly to their assigned fields — no account required. The link is valid until the document due date, or 7 days from send if no due date is set.

Current signer actions:

- complete your assigned field
- request changes back to the initiator
- reject the workflow

You can only act when:

- the workflow is active
- your stage is active
- your order is active if the flow is sequential

## Request changes and reject

If you are the active signer and something is wrong:

- use `Request changes` when the initiator should revise and continue
- use `Reject workflow` when you want to stop the current run as rejected

Both actions require a short note and are recorded in audit history.

## Due dates and overdue workflows

Owners and editors can set a workflow due date.

When the due date passes:

- the workflow shows as overdue in the document list
- an overdue badge is shown alongside the document name

## Reminding signers

For `platform_managed` workflows, owners and editors can send a reminder to all pending signers.

Use the `Remind signers` button in the document panel when:

- the workflow has been sent but is not yet complete
- one or more signers have not yet completed their fields

Reminders reuse the existing signing token if one is still valid, or issue a fresh one if it has expired.

## Reassignment

Owners and editors can reassign a participant slot when someone is unavailable or was chosen incorrectly.

Current rule:

- reassignment is intended for pending participant slots
- if a participant has already completed workflow actions, use reopen or duplicate the document instead of reassigning that completed slot

## Lock and reopen

Locking is separate from completion.

Use lock when you want to stop workflow actions explicitly before all required fields are complete.

Use reopen when:

- you need more signatures or approvals
- you need to continue after a lock
- you need to revise the workflow intentionally

Lock and reopen are both auditable.

## Audit trail, versions, and exports

Each document has:

- audit trail
- version history
- secure share links
- export/download support

Use these when you need to:

- prove what happened
- review who acted and when
- generate a copy for external sharing

## Saved signatures

Users can create saved signatures now.

Current supported saved signature types:

- typed
- uploaded image

These can be applied to assigned signature and initial fields.

## Digital signature profiles

Users can also create digital-signature profiles that store signer identity details for future certificate-backed signing.

Current profile fields:

- profile label
- signer full name
- signer email
- title text
- organization
- provider
- assurance level

Important behavior:

- `Reason for signing` is not part of the reusable profile
- `Signing location` is not part of the reusable profile
- both are chosen at signing time so they describe the actual signing event

## Current limitations

The following are not yet fully implemented:

- change-impact classification after partial completion
- certificate-backed external signing provider integration
- fully live billing for paid production use (Stripe keys not yet configured)

## Best practices for testers

- start with a simple one-signer flow
- test all three path types
- use clear participant names and emails
- when signing, choose a clear reason such as `approve` or `verify`
- add signing location if that context matters for the record
- verify `waiting on`, due date, and audit history after each action
- keep notes on any moment where the next step feels unclear
