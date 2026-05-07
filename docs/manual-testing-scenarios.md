# Manual Testing Scenarios

Use this scenario catalog before running structured tests. It defines the people, coverage goals, and test cases for the controlled EasyDraftDocs launch pass.

The companion execution document is [manual-testing-protocol.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/manual-testing-protocol.md).

## Purpose

Validate the product from account admin setup through document completion, including:

- single-user preparation and lock-down behavior
- internal-only signing
- platform-managed external signing
- sequential routing
- parallel routing
- mixed internal and external flows
- invite acceptance and wrong-account protection
- signer verification, token replay, reminders, audit trail, export hash, and lock/reopen

## Test Personas

Use the real inboxes consistently so results are comparable across runs.

| Persona | Email | Primary use |
|---|---|---|
| Account admin / sender | `admin@agoperations.ca` | Application administrator, organization account admin, workflow sender, admin checks |
| Internal member A | `adamgoodwin@shaw.ca` | Workspace teammate, editor, internal signer |
| Internal member B | `marketing@agoperations.ca` | Billing/admin or marketing workspace member |
| Internal signer C | `adamgdwn@hotmail.com` | Internal signer or invited member |
| External signer A | `adamgdwn@gmail.com` | No-account guest signer, Gmail deliverability |
| External signer B | `adam.goodwin@primeboiler.com` | No-account guest signer, corporate-domain deliverability |

Keep each mailbox signed in with a separate browser profile, private window, or device. Do not reuse a browser session across personas unless the scenario is specifically testing wrong-account behavior.

## Common Evidence To Capture

For each scenario, record:

- browser and device
- exact test account used
- document name
- delivery mode
- routing strategy
- participant list and order
- screenshots of success or error states
- received email subject and arrival time
- audit trail events
- version history entries
- final PDF download status
- SHA-256 value shown in the certificate
- local `sha256sum` result when testing export integrity
- token balance before and after external sends
- any confusing wording, missing state, or unnecessary friction

## Priority Bands

| Priority | Meaning |
|---|---|
| P0 | Must pass before any external pilot. Broken auth, signing, email, privacy, billing, or document integrity. |
| P1 | Should pass before controlled launch. Important workflow trust or usability issue. |
| P2 | Useful confidence or polish check. Can be tracked as improvement if it fails gracefully. |

## Scenario Catalog

### S00 - Test Environment Readiness

Priority: P0

Goal: Confirm the target environment is safe to test.

Steps:

1. Confirm the latest build is deployed to the target origin.
2. Confirm required migrations are applied.
3. Confirm private storage buckets exist.
4. Confirm `admin@agoperations.ca` is listed in `EASYDRAFT_ADMIN_EMAILS`.
5. Confirm email delivery provider is configured.
6. Confirm Stripe mode is understood: test, live, or placeholder.
7. Run public route smoke checks.

Expected result:

- Public pages load.
- Admin can sign in.
- No missing environment errors appear.
- Testers know whether billing actions are test-mode or real.

### S01 - Account Admin Signup And First Workspace

Priority: P0

Goal: Validate account admin onboarding and default landing.

Tester:

- Work-domain account admin email, for example `admin@agoperations.ca`

Steps:

1. Sign up directly as a corporate account admin using a work-domain email.
2. Confirm public-email corporate signup is rejected with the organization-email message.
3. Confirm the account admin experience loads first.
4. Confirm organization, workspace, billing, team, and document areas appear.
5. Create or confirm a saved signature.
6. Complete onboarding if prompted.

Expected result:

- Account admin lands in the organization/admin experience.
- Corporate signup requires a verified organization email domain.
- Workspace navigation is clear.
- Saved signature can be created without errors.

### S02 - Team Invite Happy Path

Priority: P0

Goal: Confirm invited teammates attach to the correct organization and workspace.

Tester:

- Sender: `admin@agoperations.ca`
- Invitee: `adamgoodwin@shaw.ca`

Steps:

1. Account admin invites `adamgoodwin@shaw.ca` to the workspace.
2. Confirm invite email arrives.
3. Accept invite while signed out or in a clean browser profile.
4. Sign in or create the account with `adamgoodwin@shaw.ca`.
5. Confirm joined-workspace message.
6. Confirm documents, team, and billing scope match the invited workspace.

Expected result:

- Invite acceptance succeeds only for the invited email.
- Active workspace is set to the joined workspace.
- Audit/admin views show the new member.

### S03 - Wrong-Account Invite Block

Priority: P0

Goal: Confirm invite acceptance fails closed when the signed-in account email does not match the invited email.

Tester:

- Invitee: `marketing@agoperations.ca`
- Wrong signed-in account: `adamgdwn@hotmail.com`

Steps:

1. Account admin invites `marketing@agoperations.ca`.
2. Open the invite link while signed in as `adamgdwn@hotmail.com`.
3. Attempt to accept the invite.
4. Sign out and retry with `marketing@agoperations.ca`.

Expected result:

- Wrong account is blocked with a clear recovery message.
- Correct account can accept.
- No membership is created for the wrong account.

### S04 - Workspace Switching And Scope Isolation

Priority: P0

Goal: Confirm multi-workspace users do not see stale or cross-workspace data.

Tester:

- `admin@agoperations.ca`
- `adamgoodwin@shaw.ca`

Steps:

1. Ensure tester belongs to at least two workspaces.
2. Create or identify one document in each workspace.
3. Switch active workspace.
4. Check document list, billing, team, and account admin panels.
5. Refresh the browser and confirm the selected workspace persists.

Expected result:

- Documents, billing, team, and admin data rescope together.
- No data from workspace A appears while workspace B is active.

### S05 - Self-Managed Single-User Flow

Priority: P0

Goal: Validate a simple single-use document that never sends external notifications.

Tester:

- `admin@agoperations.ca`

Steps:

1. Upload a small PDF.
2. Select `self_managed`.
3. Add one signer or prepare without notification.
4. Place a signature field, date field, and text field.
5. Save the draft.
6. Download or share through the self-managed path.
7. Confirm no external workflow email is sent.

Expected result:

- PDF remains private in the app.
- Fields save and reload.
- Self-managed flow does not consume external signing tokens.
- No managed signing email is sent.

### S06 - Lock Before Completion And Reopen

Priority: P0

Goal: Validate lock-down behavior before all required fields are completed.

Tester:

- `admin@agoperations.ca`

Steps:

1. Create a document with at least one outstanding required field.
2. Lock the document.
3. Attempt to sign or edit the outstanding field.
4. Confirm the lock event appears in audit/version history.
5. Reopen the document.
6. Confirm signing or editing can continue.

Expected result:

- Lock prevents further signing or mutation.
- Reopen records an event and restores the workflow.
- Previously completed evidence is preserved.

### S07 - Internal-Only Single Signer

Priority: P0

Goal: Validate one internal signer inside the app.

Tester:

- Sender: `admin@agoperations.ca`
- Signer: `adamgoodwin@shaw.ca`

Steps:

1. Upload a PDF.
2. Select `internal_use_only`.
3. Add `adamgoodwin@shaw.ca` as internal signer.
4. Place a required signature field.
5. Open for internal signing.
6. Sign in as the signer and complete the field.
7. Return as account admin and inspect status, audit trail, and certificate.

Expected result:

- Signer can complete only their assigned field.
- Document reaches `completed`.
- Audit trail and version history are correct.

### S08 - Internal Sequential Routing

Priority: P0

Goal: Validate ordered internal signing.

Tester:

- Stage 1: `adamgoodwin@shaw.ca`
- Stage 2: `marketing@agoperations.ca`

Steps:

1. Create an internal-only document with two required signer fields.
2. Set routing to sequential.
3. Send or open the workflow.
4. Sign in as stage 2 first and attempt to sign.
5. Complete stage 1.
6. Confirm stage 2 becomes eligible.
7. Complete stage 2.

Expected result:

- Stage 2 cannot sign early.
- Stage 2 becomes available only after stage 1 completes.
- Completion occurs after both fields are done.

### S09 - Internal Parallel Routing

Priority: P0

Goal: Validate simultaneous internal signing.

Tester:

- `adamgoodwin@shaw.ca`
- `marketing@agoperations.ca`

Steps:

1. Create an internal-only document with two required signers.
2. Set routing to parallel.
3. Open the workflow.
4. Confirm both signers can act immediately.
5. Complete signers in either order.

Expected result:

- Both signers are eligible at the same time.
- Completion waits until both required fields are done.

### S10 - Platform-Managed Single External Signer

Priority: P0

Goal: Validate the core external guest signing flow.

Tester:

- Sender: `admin@agoperations.ca`
- External signer: `adamgdwn@gmail.com`

Steps:

1. Upload a PDF.
2. Select `platform_managed`.
3. Add `adamgdwn@gmail.com` as an external signer.
4. Place a required signature field.
5. Record token balance.
6. Send the workflow.
7. Confirm signing email arrives.
8. Open the signing link in a private window.
9. Request verification code.
10. Confirm verification email arrives.
11. Enter code and complete signature, reason, and optional location.
12. Attempt to reuse the completed link.
13. Download the signed PDF and certificate as account admin.
14. Compare certificate hash with local `sha256sum`.

Expected result:

- Token balance decreases according to current product rule.
- Guest signer does not need an account.
- Verification is required before signature completion.
- Completed link cannot be reused to mutate the document.
- Certificate hash matches downloaded PDF bytes.

### S11 - External Sequential Routing

Priority: P0

Goal: Validate external signers in series.

Tester:

- Stage 1: `adamgdwn@gmail.com`
- Stage 2: `adam.goodwin@primeboiler.com`

Steps:

1. Create a platform-managed document with two external signers.
2. Set routing to sequential.
3. Send the workflow.
4. Confirm only stage 1 receives or can use a live signing action first.
5. Complete stage 1 with verification.
6. Confirm stage 2 notification arrives or becomes active.
7. Complete stage 2 with verification.

Expected result:

- Stage 2 cannot complete before stage 1.
- Stage transition is visible to the sender.
- Final completion and certificate include both signers.

### S12 - External Parallel Routing

Priority: P0

Goal: Validate external signers in parallel.

Tester:

- `adamgdwn@gmail.com`
- `adam.goodwin@primeboiler.com`

Steps:

1. Create a platform-managed document with two external signers.
2. Set routing to parallel.
3. Send the workflow.
4. Confirm both signing emails arrive.
5. Complete either signer first.
6. Confirm document remains pending.
7. Complete the second signer.

Expected result:

- Both external signers are eligible immediately.
- Completion waits for both required actions.
- Token usage and notification history are correct.

### S13 - Mixed Internal Then External Sequential Flow

Priority: P0

Goal: Validate a practical "prepare internally, send externally" series flow.

Tester:

- Internal stage: `adamgoodwin@shaw.ca`
- External stage: `adam.goodwin@primeboiler.com`

Steps:

1. Create a platform-managed document.
2. Add internal signer in stage 1.
3. Add external signer in stage 2.
4. Set routing to sequential.
5. Send the workflow.
6. Complete internal stage.
7. Confirm external notification is sent only after internal completion.
8. Complete external stage with verification.

Expected result:

- Internal signer works inside the app.
- External signer uses dedicated guest signer page.
- Stage handoff is clear and auditable.

### S14 - Mixed Parallel Flow

Priority: P1

Goal: Validate internal and external signers acting at the same time.

Tester:

- Internal signer: `marketing@agoperations.ca`
- External signer: `adamgdwn@gmail.com`

Steps:

1. Create a platform-managed document.
2. Add one internal signer and one external signer.
3. Set routing to parallel.
4. Send the workflow.
5. Complete either signer first.
6. Confirm the other signer remains eligible.
7. Complete second signer.

Expected result:

- Internal and external paths can run in parallel.
- Sender status display stays accurate.

### S15 - Request Changes, Reopen, Resend

Priority: P0

Goal: Validate a signer can stop the flow and the account admin can resume it.

Tester:

- Signer: `adamgdwn@gmail.com` or `adamgoodwin@shaw.ca`

Steps:

1. Send a document to a signer.
2. As signer, request changes.
3. Confirm account admin sees paused or changes-requested state.
4. Confirm notification or queue behavior for the sender.
5. Sender reopens or updates the document.
6. Resend or continue the workflow.
7. Complete the signer action.

Expected result:

- Workflow pauses clearly.
- Account admin can recover without losing audit history.
- Resend/reminder behavior remains correct.

### S16 - Reject And Cancel

Priority: P1

Goal: Validate negative completion paths.

Tester:

- Signer: `adam.goodwin@primeboiler.com`

Steps:

1. Send a document.
2. As signer, reject if the UI exposes reject.
3. Confirm account admin status and audit entry.
4. Create a second document and cancel it as account admin.
5. Confirm signers cannot complete canceled documents.

Expected result:

- Rejection and cancellation block further signing.
- Account admin sees a clear status and audit trail.

### S17 - Reassign Signer After Send

Priority: P1

Goal: Validate signer reassignment and change-impact handling.

Tester:

- Original signer: `adamgdwn@gmail.com`
- Replacement signer: `adam.goodwin@primeboiler.com`

Steps:

1. Send a document to the original signer.
2. Reassign the signer before completion.
3. Confirm old link is invalid or no longer authorized.
4. Confirm replacement signer gets access.
5. Complete as replacement signer.

Expected result:

- Old signer cannot complete after reassignment.
- Replacement signer can complete.
- Audit/version history explains the change.

### S18 - Reminder And Resend

Priority: P0

Goal: Validate a pending signer can be reminded without changing the workflow.

Tester:

- Pending signer: `adam.goodwin@primeboiler.com`

Steps:

1. Send a platform-managed workflow.
2. Do not complete the signer action.
3. As sender, send reminder/resend to the pending signer.
4. Confirm reminder email arrives.
5. Complete from the latest valid link.

Expected result:

- Reminder goes only to the pending signer.
- Link works and does not duplicate token consumption beyond the intended rule.

### S19 - Verification Code Failure Cases

Priority: P0

Goal: Validate external verification fails safely.

Tester:

- External signer: `adamgdwn@gmail.com`

Steps:

1. Open a valid external signing link.
2. Attempt to complete a signature before requesting a code.
3. Request a code.
4. Enter an invalid code.
5. Repeat invalid attempts until limit is reached.
6. Request a fresh code after lockout or expiry behavior allows it.
7. Complete with the correct code.

Expected result:

- Completion is blocked before verification.
- Bad codes show useful errors.
- Too many bad attempts require a fresh code.
- Correct code allows completion.

### S20 - Free-Placement Signature

Priority: P1

Goal: Validate signing when no field was pre-placed.

Tester:

- `adamgoodwin@shaw.ca` or `adamgdwn@gmail.com`

Steps:

1. Send or open a document with no pre-placed signature fields.
2. Use the free-placement signature control.
3. Place and resize the signature.
4. Complete the signing action.
5. Download final PDF and inspect placement.

Expected result:

- Signer can place a signature.
- Placement is preserved in final export.
- Audit trail records the action.

### S21 - Field Type Coverage

Priority: P1

Goal: Validate every supported field kind.

Tester:

- Any internal or external signer

Steps:

1. Place signature, initials, approval, date, and text fields.
2. Assign fields to one or more signers.
3. Complete each field.
4. Confirm final PDF and certificate show expected values.

Expected result:

- All field types can be completed.
- Required fields block completion until filled.
- Optional fields do not block completion.

### S22 - Post-Sign Mutation Impact

Priority: P1

Goal: Validate changes after signing starts produce the expected consequence.

Steps:

1. Start a workflow and complete at least one signer field.
2. Rename the document.
3. Add a signer.
4. Change routing.
5. Add or clear fields.
6. Observe whether the system records `non_material`, `review_required`, or `resign_required`.

Expected result:

- Non-material changes do not reset signing.
- Review-required changes pause the workflow.
- Resign-required changes clear affected completed actions.

### S23 - Export, Certificate, Hash, And Audit Trail

Priority: P0

Goal: Validate executed-record evidence.

Steps:

1. Complete any signing workflow.
2. Download the signed PDF.
3. Open the completion certificate.
4. Record the certificate SHA-256.
5. Run `sha256sum` on the downloaded file.
6. Review participant actions, timestamps, audit trail, and version history.

Expected result:

- Hashes match.
- Certificate includes participants and events.
- Audit trail is understandable.

### S24 - Billing Trial, Token Purchase, And Portal

Priority: P0 if billing is enabled; P2 if placeholder mode.

Goal: Validate commercial flow and external token accounting.

Tester:

- Account admin: `admin@agoperations.ca`

Steps:

1. Start or confirm free trial.
2. Run checkout with test card if in Stripe test mode.
3. Confirm subscription appears in the app.
4. Buy an external signer token pack.
5. Send a platform-managed external workflow.
6. Confirm token balance decreases correctly.
7. Open billing portal.
8. Cancel or update subscription only in the intended test environment.

Expected result:

- Billing state syncs after checkout and webhooks.
- Token balance is understandable.
- Portal opens and returns to the app.

### S25 - Session Persistence And Sign-Out

Priority: P1

Goal: Validate auth sessions and refresh behavior.

Steps:

1. Sign in as an internal user.
2. Leave the session open longer than one hour if practical.
3. Refresh and perform an authenticated action.
4. Sign out.
5. Attempt to use the old browser tab or API action.

Expected result:

- Valid session refreshes without forcing unexpected logout.
- Sign-out invalidates access.

### S26 - Account Deletion Safety

Priority: P1

Goal: Validate irreversible cleanup using only disposable test accounts.

Tester:

- Use a disposable non-account admin account only.

Steps:

1. Create a test account with at least one document.
2. Attempt deletion without typing the confirming email.
3. Complete deletion confirmation.
4. Confirm storage and account data are removed.
5. Confirm the account can no longer sign in.

Expected result:

- Destructive action requires clear confirmation.
- Deletion completes cleanly for disposable accounts.

### S27 - Admin Operations And Feedback

Priority: P1

Goal: Validate operator visibility.

Tester:

- `admin@agoperations.ca`

Steps:

1. Open admin console.
2. Review users, workspaces, documents, and queue metrics.
3. Submit feedback from a user account.
4. Triage it in admin.
5. Trigger password reset for a test user.

Expected result:

- Admin data loads without errors.
- Feedback can be triaged.
- Password reset email arrives.

### S28 - PDF Signature Paths

Priority: P1 for controlled launch unless signature paths are being marketed.

Goal: Validate Path 1 and Path 2 behavior.

Steps:

1. Run one Path 1 document from upload through signed PDF download.
2. Confirm output is in `documents-signed`.
3. Run one Path 2 document through Documenso envelope creation.
4. Complete internal and external signer actions.
5. Confirm webhook completion and signed PDF copy-back.
6. Confirm `signature_events` appear in the audit panel.

Expected result:

- Path 1 and Path 2 produce expected signed output and events.
- Path 3 remains disabled or returns the intended unavailable response.

## Suggested Execution Order

For a full controlled-launch pass:

1. S00
2. S01 to S04
3. S05 to S10
4. S11 to S15
5. S18 to S23
6. S24 if billing is enabled
7. S25 to S28 as confidence and operations checks

For a fast smoke pass after a deploy:

1. S00
2. S01
3. S07
4. S10
5. S11 or S12
6. S23
7. S27 queue check
