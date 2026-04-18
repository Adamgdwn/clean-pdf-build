# Current Priority Handoff

Date: `2026-04-17`

## What just completed

- Public trust/legal surfaces were hardened and documented:
  - direct routes for `/pricing`, `/privacy`, `/terms`, and `/security`
  - deployment smoke checks for those routes
  - public copy corrected so certificate-backed signing is not presented as live
- Operations and ownership loops were tightened:
  - admin-visible queue metrics
  - lightweight feedback intake + triage workflow
  - operator runbook and changelog discipline
- Repo/docs alignment improved:
  - deployment and env documentation updated
  - proprietary license posture documented
  - workflow/change-impact/operator docs reconciled with the current codebase
- Invite and external signer trust hardening landed:
  - workspace invite acceptance now requires the invited email address
  - pre-auth invite details now show workspace, role, and recipient email clearly
  - external signer actions now require an emailed one-time verification code
  - superseded and completed signing links are invalidated more aggressively
- Billing safety tightened:
  - Stripe free-trial checkout now defines invoice behavior explicitly when no payment method is on file
  - webhook dedupe now records Stripe object IDs in addition to event IDs
- The product was re-audited against the latest core-workflow brief.

## Current judgment

EasyDraft is strongest when treated as a **minimal-change, workflow-safe PDF execution system**.

That means:
- upload an existing PDF
- place only the fields needed
- assign signers/participants
- route the workflow reliably
- verify signers appropriately
- complete with durable evidence

It should **not** drift into a general PDF editor.

## What is next

### Immediate next engineering priorities

1. Harden external signer verification
   - validate the live email-code flow against real delivery and reminder behavior
   - confirm operators can diagnose expired, completed, and mismatched-link states quickly
   - keep the verification evidence narrow and truthful in customer-facing language

2. Strengthen executed-record durability
   - prevent ordinary deletion of completed executed records
   - preserve completed history when reopening or starting a new revision workflow
   - keep the final export hash, certificate, and audit chain attached to the executed artifact

3. Keep the workflow surface narrow
   - preserve field overlay + routing + completion as the product heart
   - avoid broad editing features unless they directly support workflow execution

4. Extract the workflow core from `App.tsx`
   - `FieldEditorPanel`
   - `WorkflowChecklistPanel`
   - `SignerActionPanel`
   - `SignatureLibraryPanel`

### Next product checks

- Verify the live app still feels like a workflow tool, not an editor.
- Run real-user tests through all three delivery modes.
- Confirm the signer experience remains simple, trustworthy, and unsurprising with the added verification step.

## Verification status

At end of day, the current branch verifies cleanly with:

```bash
npm run typecheck
npm run test
npm run build
```
