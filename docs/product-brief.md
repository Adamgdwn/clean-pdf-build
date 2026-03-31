# Product Brief

## Working title

EasyDraft

## Promise

Prepare, route, sign, and export everyday PDFs without making the user think like a PDF technician.

## v1 scope

- Authentication
- PDF upload and rendering
- Basic editing: add text, add image, reorder pages, rotate pages, delete pages, merge, split
- OCR for scanned PDFs
- Automatic form field detection
- Manual field editing and assignment
- Multi-signer wizard
- Sequential and parallel signing flows
- Shared access roles: owner, editor, signer, viewer
- Audit trail and version history
- Export completed PDF

## Core workflow states

- Draft
- Prepared
- Sent
- Partially signed
- Completed
- Reopened

## Key product rule

Document completion is not signer completion.

A document remains signable until:

- all required assigned signing fields are complete, or
- a user with lock permission explicitly locks it

Locking must record:

- who locked it
- when it was locked

## Non-goals

- Full desktop publishing
- Enterprise admin
- SSO
- AI chat
- Native mobile apps
- Offline-first support

## Jobs to be done

- “I need to upload a contract, detect likely fields, fix the mistakes, and send it in minutes.”
- “I need to know exactly who is blocking completion and which required field is still open.”
- “I need a safe history of edits, sends, signatures, reopen events, and exports.”

## Success criteria for the bootstrap

- The repo expresses the intended system boundaries clearly
- Workflow rules live in shared testable code
- A lightweight demo can show lock, reopen, and field completion behavior
- The stack can grow into real persistence and processing without rewrite pressure
