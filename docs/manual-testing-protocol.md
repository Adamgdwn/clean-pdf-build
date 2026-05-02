# Manual Testing Protocol And Results

Use this document as the repeatable test run workbook for EasyDraftDocs. Start with the scenario catalog in [manual-testing-scenarios.md](/home/adamgoodwin/code/Applications/Clean_pdf_build/docs/manual-testing-scenarios.md), then copy the templates below for each run.

## Test Run Header

| Field | Value |
|---|---|
| Run ID | `YYYY-MM-DD-environment-initials` |
| Tester |  |
| Date |  |
| Environment | Production / Preview / Local |
| Origin URL |  |
| Build or commit |  |
| Browser and version |  |
| Device / OS |  |
| Stripe mode | Test / Live / Placeholder / Not tested |
| Email provider | Resend / SMTP / Supabase Auth / Not tested |
| Notes |  |

## Accounts Used

| Role | Email | Browser profile / device | Signed in? | Notes |
|---|---|---|---|---|
| Owner / sender | `admin@agoperations.ca` |  |  |  |
| Internal member A | `adamgoodwin@shaw.ca` |  |  |  |
| Internal member B | `marketing@agoperations.ca` |  |  |  |
| Internal signer C | `adamgdwn@hotmail.com` |  |  |  |
| External signer A | `adamgdwn@gmail.com` |  |  |  |
| External signer B | `adam.goodwin@primeboiler.com` |  |  |  |

## Pre-Run Checklist

| Check | Status | Evidence / notes |
|---|---|---|
| Target origin loads | Not run |  |
| `/pricing`, `/privacy`, `/terms`, `/security` load | Not run |  |
| Admin can sign in | Not run |  |
| Test inboxes are accessible | Not run |  |
| Latest build confirmed | Not run |  |
| Required migrations confirmed | Not run |  |
| Profile identity fields populated in Supabase | Not run | Confirm `profiles` plus role-specific profile tables show email, username, company, account type, and workspace name after signup/invite tests. |
| Storage buckets confirmed private | Not run |  |
| Email provider configured | Not run |  |
| Billing mode confirmed | Not run |  |
| Sample PDFs ready | Not run |  |

Status values: `Pass`, `Fail`, `Blocked`, `Not run`, `N/A`.

## Result Status Rules

| Status | Meaning |
|---|---|
| Pass | Expected behavior observed with evidence. |
| Fail | Behavior is wrong, unsafe, or materially confusing. Create an issue. |
| Blocked | Could not test because setup, credentials, data, or environment was unavailable. |
| Not run | Intentionally skipped for this pass. |
| N/A | Scenario does not apply to this environment. |

## Severity Rules

| Severity | Meaning |
|---|---|
| Critical | Blocks signing, auth, billing, privacy, document integrity, or causes data exposure. |
| High | Blocks a major supported workflow or creates serious user trust risk. |
| Medium | Workflow can continue, but usability, clarity, or recovery is meaningfully poor. |
| Low | Cosmetic, wording, polish, or low-risk improvement. |

## Scenario Results Summary

| Scenario | Priority | Status | Tester / accounts | Evidence | Issue IDs | Notes |
|---|---|---|---|---|---|---|
| S00 - Test Environment Readiness | P0 | Not run |  |  |  |  |
| S01 - Owner Signup And First Workspace | P0 | Not run |  |  |  |  |
| S02 - Team Invite Happy Path | P0 | Not run |  |  |  |  |
| S03 - Wrong-Account Invite Block | P0 | Not run |  |  |  |  |
| S04 - Workspace Switching And Scope Isolation | P0 | Not run |  |  |  |  |
| S05 - Self-Managed Single-User Flow | P0 | Not run |  |  |  |  |
| S06 - Lock Before Completion And Reopen | P0 | Not run |  |  |  |  |
| S07 - Internal-Only Single Signer | P0 | Not run |  |  |  |  |
| S08 - Internal Sequential Routing | P0 | Not run |  |  |  |  |
| S09 - Internal Parallel Routing | P0 | Not run |  |  |  |  |
| S10 - Platform-Managed Single External Signer | P0 | Not run |  |  |  |  |
| S11 - External Sequential Routing | P0 | Not run |  |  |  |  |
| S12 - External Parallel Routing | P0 | Not run |  |  |  |  |
| S13 - Mixed Internal Then External Sequential Flow | P0 | Not run |  |  |  |  |
| S14 - Mixed Parallel Flow | P1 | Not run |  |  |  |  |
| S15 - Request Changes, Reopen, Resend | P0 | Not run |  |  |  |  |
| S16 - Reject And Cancel | P1 | Not run |  |  |  |  |
| S17 - Reassign Signer After Send | P1 | Not run |  |  |  |  |
| S18 - Reminder And Resend | P0 | Not run |  |  |  |  |
| S19 - Verification Code Failure Cases | P0 | Not run |  |  |  |  |
| S20 - Free-Placement Signature | P1 | Not run |  |  |  |  |
| S21 - Field Type Coverage | P1 | Not run |  |  |  |  |
| S22 - Post-Sign Mutation Impact | P1 | Not run |  |  |  |  |
| S23 - Export, Certificate, Hash, And Audit Trail | P0 | Not run |  |  |  |  |
| S24 - Billing Trial, Token Purchase, And Portal | P0/P2 | Not run |  |  |  |  |
| S25 - Session Persistence And Sign-Out | P1 | Not run |  |  |  |  |
| S26 - Account Deletion Safety | P1 | Not run |  |  |  |  |
| S27 - Admin Operations And Feedback | P1 | Not run |  |  |  |  |
| S28 - PDF Signature Paths | P1 | Not run |  |  |  |  |

## Detailed Scenario Result Template

Copy this block once per scenario that needs detail beyond the summary table.

```markdown
### SXX - Scenario Name

Status:
Severity if failed:
Tester:
Date/time:
Environment:
Document name:
Accounts:

Steps executed:
1.
2.
3.

Expected:

Actual:

Evidence:
- Screenshot:
- Email subject and arrival time:
- Audit trail entries:
- Version history entries:
- Certificate SHA-256:
- Local sha256sum:
- Token balance before:
- Token balance after:

Result notes:

Issue or improvement created:
```

## Issue Log

| ID | Scenario | Severity | Type | Title | Repro summary | Owner | Status | Resolution |
|---|---|---|---|---|---|---|---|---|
| T-001 |  |  | Bug / Improvement / Question |  |  |  | New |  |

Issue status values: `New`, `Acknowledged`, `In progress`, `Fixed`, `Retest`, `Closed`, `Deferred`.

## Improvement Log

Use this for product improvements that are not defects.

| ID | Scenario | Area | Observation | Suggested improvement | Priority | Decision |
|---|---|---|---|---|---|---|
| I-001 |  |  |  |  | Low / Medium / High |  |

## Positive Findings

Capture what worked well so the launch decision is not only a defect list.

| Scenario | What worked well | Evidence | Reuse in sales/onboarding? |
|---|---|---|---|
|  |  |  |  |

## Email Delivery Log

| Scenario | Sender | Recipient | Email type | Expected trigger | Arrival time | Link opened? | Notes |
|---|---|---|---|---|---|---|---|
|  | `admin@agoperations.ca` |  | Invite / signing / verification / reminder / reset |  |  |  |  |

## Token And Billing Log

| Scenario | Starting token balance | Action | Ending token balance | Expected change | Pass? | Notes |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

## Export Integrity Log

| Scenario | Document | Certificate SHA-256 | Local `sha256sum` | Match? | Notes |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

## Final Run Decision

| Gate | Status | Notes |
|---|---|---|
| P0 scenarios passed or accepted | Not run |  |
| No unresolved Critical issues | Not run |  |
| No unresolved High launch blockers | Not run |  |
| Email delivery acceptable | Not run |  |
| External signer flow acceptable | Not run |  |
| Export hash and certificate acceptable | Not run |  |
| Billing acceptable for this environment | Not run |  |
| Admin/operator visibility acceptable | Not run |  |

Decision:

- `Go`
- `Go with noted limitations`
- `No-go`

Decision notes:

## Retest Protocol

For every `Fixed` issue:

1. Re-run the exact failed scenario.
2. Re-run one adjacent scenario that could have been affected.
3. Record the fixed build or commit.
4. Move the issue to `Closed` only after evidence is attached.
