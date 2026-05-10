# Corporate Admin To Sequential Signing Gap Analysis

Date: 2026-05-09

## Scope

Scenario reviewed:

1. A new user signs up as a corporate account admin.
2. The corporate admin buys or assigns 10 licenses.
3. The admin initiates a document workflow.
4. Five signers complete the document in order.
5. The initiator receives progress notifications, including a stall that requires follow-up.
6. The document is finalized and distributed.

Assumption: the desired workflow is a platform-managed EasyDraft workflow unless noted otherwise. Path 2 Documenso can cover part of the signature story, but the native EasyDraft workflow is the clearest source of current routing, notification, reminder, and audit behavior.

## Current Coverage

Re-audit note: this document was updated after the 2026-05-09 implementation pass. Items marked "now" reflect the current code in this working tree.

### 1. Corporate Admin Signup

Current state:

- Direct corporate signup creates a corporate organization, workspace, account member, and account admin context.
- Corporate signup requires a non-public organization email domain.
- Duplicate corporate organization names and verified domains are blocked.
- New corporate organizations are created as `pending_verification`.
- While pending verification, the account admin can review the admin center, but billing, team invites, and new workflow sends are blocked until EasyDraft activates the organization.
- Signup copy now explicitly says corporate accounts are verification-gated before billing, team invites, and workflow sends unlock.

Assessment:

- The account boundary is strong enough for controlled launch.
- The activation gate remains intentional. The previous expectation-setting gap is reduced, but the launch script must still include operator activation before seat assignment and sending can be tested.

### 2. Assigning 10 Licenses

Current state:

- Billing supports subscription seat quantity.
- The organization admin overview reports purchased seats, occupied seats, assigned seats, invited seats, suspended seats, available seats, and over-assignment.
- Inviting a teammate creates an account invitation and reserves an invited license assignment.
- Accepted invitations become assigned member seats.
- If members plus pending invites exceed the subscription seat count, the invite flow returns a warning.
- The team invite form now accepts a paste-list of up to 10 email addresses separated by commas, spaces, or new lines.
- The team panel now distinguishes active seats, invited seats, available seats, and over-assigned seats in user-facing copy.

Assessment:

- The product supports "invite 10 people into 10 seats" as an operational model.
- It does not yet enforce seat count server-side. This is documented as intentional for launch, but it is a gap if "assign 10 licenses" means a strict entitlement system.
- Bulk invitation for the 10-seat launch scenario is now covered. A dedicated named-seat license object/table remains future work if seat administration becomes a standalone feature.

### 3. Initiating A Document

Current state:

- The admin can upload a PDF, choose delivery mode, add participants, place required signature/initial/approval fields, assign fields, configure routing, set a due date, and send.
- Platform-managed send requires active workspace/account status, an active plan, configured managed email delivery, and enough external signing tokens for currently eligible external signers.
- Self-managed and internal-only flows are available, but they do not provide the same managed external email routing.

Assessment:

- The document initiation flow covers the scenario.
- The sender must choose `platform_managed` and sequential routing for the target scenario.
- Due date is document-level only, not per signer or per stage.

### 4. Five Signers In Order

Current state:

- Sequential routing is implemented by finding the lowest pending stage and then the lowest signing order within that stage.
- The routing eligibility rule now lives in shared domain code and is covered by a five-signer ordered regression test.
- Only currently eligible signers can complete assigned action fields.
- External signers use a token link and must verify by email code before completing an action.
- When signer N completes their required action field, EasyDraft queues notifications for newly eligible signer N+1.
- The participant panel shows signer state: waiting, awaiting action, partially signed, signed, last emailed, and notification status.
- The participant form now gives explicit setup guidance for a strict five-person signing line: keep participants in stage 1 and set action orders 1 through 5.

Assessment:

- Five signers in strict order are supported if each signer has a required action field and each signer has a signing order.
- Stage terminology exists in the data model and UI, but staged routing is not first-class enough for more complex "department then customer" flows.
- The launch path is now explicitly tested for one stage with orders 1 through 5. Multi-stage workflow design is still a separate roadmap item.

### 5. Initiator Progress Notifications

Current state:

- A document setting controls whether to notify the originator as signing/approval progress occurs.
- For platform-managed workflows, EasyDraft now queues `signature_progress` for the originator when a signer has no remaining required assigned action fields, rather than after every field.
- The progress email includes next eligible signer names when routing has moved forward, e.g. the next signer has been notified.
- If a signer requests changes or rejects the workflow, EasyDraft queues a `workflow_update` email to the originator.
- When the full document completes, EasyDraft queues a `workflow_update` completion notice to the originator.
- The document workspace includes a notification timeline with queued/sent/failed status.
- The account admin portal shows platform queue health: pending notifications, failed notifications, queued jobs, and oldest pending email.

Assessment:

- The prior field-level noise gap is reduced for signer-level progress. Stage-level progress remains future work because stages are not yet a first-class product flow.
- The handoff gap is resolved for next eligible signer names.
- The initiator completion-notice gap is resolved for an in-app final package link, but not for automatic distribution to all participants.
- The notification timeline is useful for operations, but the main user-facing status relies on the initiator returning to the document workspace.

### 6. Stall And Follow-Up

Current state:

- Documents can have a due date.
- The response model derives `isOverdue` and `waitingOn`, so the UI can show who the workflow is waiting on and whether the workflow is overdue.
- The initiator can manually click "Remind signers" for all currently eligible signers or "Resend" for an individual eligible pending signer.
- Reminders requeue the pending signature request and reuse or refresh external signing tokens.
- The processor endpoint can drain queued notifications and failed/pending email work when triggered.
- A processor endpoint, `/notifications/run-overdue-reminders`, can scan overdue platform-managed workflows, queue reminders for currently eligible signers, and queue an originator escalation. The root script `processor:run-overdue-reminders` calls this endpoint.
- Overdue reminder/escalation cooldown defaults to 24 hours in the processor function.
- External token sessions record `last_viewed_at` and `last_completed_at`.

Assessment:

- Manual follow-up exists and is reasonably direct.
- Automatic signer reminder plus originator escalation is now implemented as a processor operation. It still needs a production scheduler/cron entry to run continuously.
- Due dates remain document-level only, so SLA-style follow-up by signer or stage is not yet supported.
- Viewed/completed timestamps are recorded for token sessions, but the participant row does not yet expose a clear "viewed but not signed" state.

### 7. Finalizing And Distributing

Current state:

- When all required assigned action fields are complete, the document is marked completed, unlocked, versioned, and audited.
- When the document transitions to completed, EasyDraft now renders and persists the final PDF export, stores the SHA-256 digest, and writes an audit event.
- Downloads still use a 10-minute signed URL.
- Share links still use a 24-hour signed URL and record an audit event.
- Path 1 can generate a server-signed PDF after completion when the P12 certificate is configured.
- Path 2 Documenso can copy the completed Documenso PDF back into `documents-signed` via webhook when Documenso is configured.
- The certificate page can be generated client-side from document signers, fields, and audit trail.
- The certificate copy now reflects that the final rendered PDF hash may be generated on workflow completion, not only at download time.

Assessment:

- Finalization, completion-time export generation, secure download/share, and originator completion notice are covered.
- Automatic final distribution to all signers, CC recipients, or configured external targets is still not covered.
- The completion notice links the originator back into EasyDraft rather than attaching PDFs or minting participant-specific share links.

## Gap Register

| ID | Area | Status | Gap / finding | Impact | Recommended action |
|---|---|---|---|---|---|
| G1 | Corporate signup | Partial | Corporate accounts still start `pending_verification`, blocking billing, invites, and new workflow sends. Signup copy now explains this. | A fresh corporate admin cannot immediately complete the requested 10-license/signing scenario without operator activation. | Keep activation as an explicit launch test step. Decide whether controlled-launch admins are pre-verified, manually activated immediately, or deliberately held for review. |
| G2 | Licenses | Open | Seat count is advisory, not enforced. | An admin can over-invite beyond purchased seats; finance and access can drift. | Keep advisory mode only if intentional for controlled launch. Before broader launch, decide whether to block over-assignment or require billing update first. |
| G3 | Licenses | Resolved for launch | The team invite form now accepts up to 10 pasted email addresses. | Assigning 10 seats is no longer one-at-a-time for the target scenario. | Manually test a 9-email paste invite against a 10-seat account, including duplicate and invalid email behavior. |
| G4 | Licenses | Partial | License assignment is clearer in copy and summaries, but still invite/member driven rather than a standalone named-seat object. | Admins can understand assigned, invited, available, and over-assigned states, but there is no dedicated license administration table. | Add a dedicated license table/action state only if selling seat administration as a feature. |
| G5 | Routing | Partial | Sequential signer handoff works and the one-stage five-signer path is now covered by a domain regression test. Stage-level routing remains a future roadmap item. | Complex workflows like "department then customer" still need careful explanation and testing. | For launch, test one stage with orders 1-5. Treat multi-stage workflow design as separate future work. |
| G6 | Originator notifications | Resolved for signer-level progress | Progress emails now fire when the signer has no remaining required assigned actions, not after each required field. | Multi-field signers should no longer generate noisy originator updates. | Keep this behavior in the full journey smoke test. Add stage-level granularity only when stages become first-class. |
| G7 | Originator notifications | Resolved | Handoff email metadata/copy now includes next eligible signer names when the workflow advances. | The initiator can see who owns the next step without returning to the workspace. | Verify email rendering in the managed-email provider during launch testing. |
| G8 | Originator notifications | Partial | A completion `workflow_update` is queued to the originator when the whole document completes. | The initiator is notified that the final PDF/certificate package is ready in EasyDraft. | Decide later whether to add a distinct `document_completed` event type or richer final-package email template. |
| G9 | Stall handling | Open | Due date is document-level only. | A five-signer sequence cannot express separate deadlines for signer 1 vs signer 5. | Add per-signer or per-stage due dates before relying on SLA-style follow-up. |
| G10 | Stall handling | Partial | Processor support now queues overdue signer reminders and originator escalation, but it must be scheduled in production. | Stalls can be handled automatically once the processor endpoint is invoked on a cadence. | Add a cron/scheduler entry for `processor:run-overdue-reminders` and verify the 24-hour cooldown policy. |
| G11 | Stall handling | Partial | External token sessions record `last_viewed_at` and `last_completed_at`, but the participant row does not expose a clear "viewed but not signed" state. | Follow-up still lacks visible context such as unopened, opened, verified, or stuck. | Surface token viewed/completed state beside the participant and include it in reminder/escalation decisions. |
| G12 | Stall handling | Partial | Participant rows show last email status, including failed notification status, and the notification timeline shows queue state. Recovery remains mostly manual. | A failed signer email is visible, but the fix path is still resend/operator review rather than guided repair. | Add a clearer failed-email callout with resend/fix instructions beside the affected participant. |
| G13 | Final distribution | Partial | The originator receives a completion notice and can download/share from EasyDraft, but final PDF/share/certificate distribution to all signers or CC recipients remains manual. | "Finalizing" is closer to closed-loop for the initiator, but not for all recipients. | Add optional automatic completion distribution to originator, all signers, CC recipients, or configured distribution targets after deciding recipient policy. |
| G14 | Final PDF | Resolved for native export | Native completion now renders and persists the final PDF export, stores SHA-256, and records an export audit event. | Completion and final export generation now occur together for native EasyDraft export. | Manually verify export audit and certificate hash after signer 5 completes. Path 1 certificate-backed signing still requires its configured P12 flow. |
| G15 | Test coverage | Partial | A domain test covers five ordered signers, and the manual script below covers the full 10-license / five-signer / stall path. | Automated E2E coverage is still missing for the entire cross-flow journey. | Run the manual script for launch. Add Playwright/API E2E coverage when test accounts and email harness are available. |

## Recommended Test Script

Use this as the manual scenario for the full launch pass.

1. Sign up with a work-domain email as a corporate account admin.
2. Confirm the signup copy and post-signup notice make the `pending_verification` state clear.
3. Activate the organization through the EasyDraft admin flow.
4. Buy or simulate a 10-seat team subscription.
5. Paste 9 teammate email addresses into the invite form and send them in one pass.
6. Confirm license summary shows 10 purchased, 10 occupied, 0 available, and 0 over-assigned.
7. Upload a PDF as the admin.
8. Choose `platform_managed`.
9. Turn on originator notifications.
10. Add five signers in stage 1 with signing orders 1 through 5.
11. Add one required action field for each signer.
12. Set a due date.
13. Send the document.
14. Confirm only signer 1 receives the first action request.
15. Complete signer 1 and confirm signer 2 receives the next action request.
16. Confirm the initiator receives a signer-complete progress email naming signer 2 as the next notified signer.
17. Complete signer 2.
18. Leave signer 3 incomplete past the due-date threshold used for the test.
19. Confirm the document shows overdue/waiting on signer 3.
20. Run the overdue reminder processor (`npm run processor:run-overdue-reminders` against the running processor) or trigger `/notifications/run-overdue-reminders`.
21. Confirm signer 3 receives an overdue reminder and the initiator receives an overdue escalation.
22. Use individual `Resend` for signer 3 and confirm the notification timeline records it.
23. Complete signers 3, 4, and 5 in order.
24. Confirm the document reaches completed and the initiator receives a completion email.
25. Confirm the final export SHA-256 is present before manually downloading.
26. Download the final PDF and generate the certificate.
27. Create a secure share link.
28. Confirm audit trail includes send, signer notifications, progress notifications, overdue reminder/escalation, manual resend, field completions, completion, completion-time export, and share.

## Clarifying Questions

These decisions affect what should be built next:

1. Should "assign 10 licenses" mean strict purchased-seat enforcement, or is advisory over-assignment acceptable for controlled launch?
2. Should progress notification granularity stay signer-level, or should stage-level updates become a product setting when stage workflows are promoted?
3. What is the desired production stall policy: how often should the overdue reminder processor run, and should escalation differ after N days?
4. On completion, should EasyDraft automatically distribute final PDF/certificate links to all signers, selected CC recipients, or only the originator?
5. For the five-signer scenario, is the target path native EasyDraft platform-managed signing, Documenso Path 2, or both?

## Verification Run

Code-level verification completed after the implementation pass:

- `npm run typecheck`
- `npm test --workspaces --if-present`

Automated coverage now includes the one-stage, five-signer ordered routing rule. The full corporate signup, 10-seat invite, managed email, overdue processor, and final export distribution path still requires the manual launch script above because it depends on auth, billing/subscription state, email delivery, storage, and processor scheduling.
