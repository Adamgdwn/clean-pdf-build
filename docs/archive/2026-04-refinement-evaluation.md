# EasyDraft Refinement Evaluation

Date: April 11, 2026

This memo responds to the new team-evaluation brief in Downloads using current repository state as the primary source of truth. The substantive external audit memo referenced by the brief was not available locally, so this document evaluates the product against the brief's required dimensions rather than pretending to answer missing findings.

## Executive Judgment

The earlier audit direction appears broadly right on the big themes: trust claims must stay tightly aligned to implementation, commercial readiness depends as much on operational support as on feature coverage, and the product should prefer smaller credibility-building controls over large speculative systems. That framing is still useful.

What is now outdated or incomplete is the implied baseline. The codebase has moved materially since the earlier documentation snapshots. Distributed rate limiting, change-impact classification, trust/legal surfaces, admin queue visibility, Sentry hooks, and feedback intake now exist in code. Several top-level docs still describe those items as future work, which creates a new risk: people can now make the wrong judgment because the written state lags the implemented state.

Current readiness judgment:

- Ready for internal use: yes.
- Ready for controlled private beta: yes.
- Ready for a selective paid pilot with hands-on founder support: almost, but only if the immediate operational items below are closed first.
- Ready for broad selling: no.

Biggest remaining risks:

- operational durability is still too manual because the document processor is exposed as an HTTP service, but durable scheduled/container deployment is not yet evidenced in repo docs or runtime setup;
- source-of-truth drift across README and ops docs can cause the team to under-sell real progress or overstate what still needs to happen;
- the new feedback intake is a good capture mechanism, but not yet a complete operating loop for prioritization, ownership, requester follow-up, and closure;
- certificate-backed signing remains intentionally out of scope, so customer-facing language must continue to be tightly controlled.

What we should do now:

- reconcile the key docs to match implemented behavior;
- operationalize the processor and treat notification/processing lag as a real production surface;
- add a lean feedback triage loop with assignee, status discipline, and response expectations;
- run a commercial smoke pass against the now-current trust and workflow behavior.

What we should not do now:

- do not build a real certificate-signing integration before demand justifies it;
- do not start heavy architecture breakup beyond the refactors that directly improve supportability and safe change;
- do not build a heavyweight support platform for feedback before a lightweight triage process proves insufficient.

## Source-of-Truth Reconciliation

The repo currently contains several doc-to-code mismatches that should be treated as a product-readiness issue of their own.

| Area | Repo reality | Stale or conflicting documentation | Assessment |
|---|---|---|---|
| Change-impact classification | Implemented in schema, migration, service logic, and tests. | `README.md`, `docs/workflow-matrix.md`, and `docs/admin-instructions.md` still describe it as unfinished or next-step work. | Documentation is stale. |
| Distributed rate limiting | `packages/workflow-service/src/rate-limit.ts` supports Upstash-backed limiting with production enforcement. | `README.md` and `docs/go-live-checklist.md` still describe shared rate limiting as future work. | Documentation is stale. |
| Trust/legal surfaces | Public privacy, terms, and security surfaces exist in the web app. | `README.md`, `docs/admin-instructions.md`, and `docs/go-live-checklist.md` still list them as pending publication. | Documentation is stale unless the team means legal review, not page existence. |
| Observability/admin queue visibility | Sentry hooks and admin metrics for failed and aging notifications/jobs exist in code. | `docs/go-live-checklist.md` still frames monitoring and queue visibility as post-go-live work. | Documentation is stale. |
| Public-surface extraction | Public-site components already exist and are not only in the monolithic app shell anymore. | `docs/architecture.md` still lists public landing extraction as the next step. | Documentation is stale. |
| Certificate-backed signing | Still not implemented as real PDF certificate signing and correctly remains out of scope. | README and admin docs say it is not integrated; guide/public copy also avoid claiming it is live. | Documentation is accurate. |
| Processor durability | Manual/HTTP-triggered processor surfaces exist. Durable scheduled/container deployment is still described as needed. | Docs consistently still treat this as unfinished. | Documentation is accurate. |

## Finding Inventory And Assessment Table

| Audit point | Team assessment | Evidence | Severity | Recommended action | Timing | Document admin |
|---|---|---|---|---|---|---|
| Product positioning and trust claims | Mostly agree | Public site and guide now describe SHA-256 export integrity, audit history, and no live certificate-backed signing; repo docs still contain stale pre-hardening language. | High | Align README, architecture, admin, and go-live docs to current product truth and keep certificate language narrow. | Immediate | Product + engineering |
| Workflow clarity and edge-case handling | Mostly agree | Delivery modes, routing, lock/reopen, guest signing, and change-impact classification are implemented; the new Mermaid flow helps explain paths, but ops docs still understate current behavior. | Medium | Treat documentation and workflow walkthroughs as part of product quality; add one canonical workflow reference and retire stale duplicates. | Immediate | Product + engineering |
| Signing, legal, and commercial readiness | Partially agree | The product is careful not to claim qualified or certificate-backed signing; completion certificates and audit history exist, but a serious buyer still needs clear explanation of what is and is not being certified. | High | Keep selling posture at trustworthy workflow platform, not advanced legal-signature product; add concise buyer-facing language and legal review of terms/privacy/security copy. | Immediate | Founder/legal + product |
| Security and observability | Mostly agree | Sentry hooks, Redis-ready rate limiting, admin queue metrics, and processor secret enforcement are present. The main remaining gap is operational proof and runbook maturity, not complete absence of controls. | High | Validate production env wiring, add alerting/runbook ownership, and document expected response to failed notifications or stuck jobs. | Immediate | Engineering + ops |
| Billing and token model clarity | Mostly agree | README, public surfaces, and product language consistently describe seats plus shared external tokens. This is one of the clearer parts of the current system. | Medium | Keep the current model; improve in-product token ledger visibility and trial-end communication rather than redesigning monetization. | Near-term | Product + engineering |
| Background job and operational readiness | Agree | Processor endpoints exist, but repo docs still describe manual or scheduled triggering as an operational next step. This is a real support risk for paid usage. | High | Deploy the processor on a durable schedule/container and define monitoring, retry ownership, and manual fallback steps. | Immediate | Engineering + ops |
| Feedback intake loop quality | Partially agree | `feedback_requests` captures type, title, details, requester, source, path, and a basic status, but there is no visible triage workflow, assignment, SLA, requester communication, or closure discipline yet. | Medium | Add the smallest possible operating loop: assignee, status taxonomy, review cadence, and response template. Avoid heavier tooling until volume proves it necessary. | Near-term | Product + ops |
| Architecture and refactor timing | Mostly agree | Some earlier refactors already landed; the remaining monolith work is real, but not the highest commercial risk compared with docs, processor ops, and trust alignment. | Medium | Continue targeted extraction only where it improves safe change or supportability; do not start a broad structural rewrite now. | Foundational | Engineering |

## Augmentations

- Add a formal documentation reconciliation task. The biggest newly visible risk is no longer only missing capability; it is stale documentation that misstates capability and readiness.
- Add an operational readiness check for the processor, not just code readiness. The product can look feature-complete while still depending on manual queue handling.
- Add a buyer-communication task that states exactly what the completion certificate proves and what it does not prove.
- Add a lean support-operations layer for feedback intake so the new buttons become an actual loop instead of a database inbox.
- Add a release-responsible checklist item that compares public copy, guide copy, README, and admin docs before any pilot or paid conversation.

## Simplifications

- Do not respond to the missing external audit by fabricating a one-to-one rebuttal table. Use the brief's dimensions and current product reality instead.
- Do not start a broader architectural breakup as a beta-readiness project. The current pressure points are operational and communicative, not primarily structural.
- Do not introduce a heavy ticketing system for feedback. A minimal status/assignee/review process will cover the current stage.
- Do not broaden the signing roadmap into provider selection or cryptographic integration work until there is stronger customer pull.

## Delivery Plan

### Immediate

| Item | Problem being solved | Intended outcome | Why now | Rough effort | Dependencies | Success signal |
|---|---|---|---|---|---|---|
| Reconcile product docs to implementation reality | The team currently has conflicting sources of truth. | README and key docs reflect the same readiness picture as the code. | Prevents bad decisions, mis-selling, and duplicated work. | Small | None beyond repo review | No key doc still claims already-shipped hardening work is missing. |
| Operationalize processor runtime | Queue handling is still too dependent on manual or informal operations. | Notifications and processing have a durable runtime with clear ownership. | This is the main blocker between private beta and confident paid usage. | Medium | Deployment target and secrets | Queued jobs and notifications drain without manual intervention during smoke tests. |
| Write a lean ops runbook for failures | Controls exist, but support response is not yet clearly operationalized. | Admins know what to do when notifications fail or jobs back up. | Monitoring without response discipline does not reduce risk enough. | Small | Admin metrics and processor deployment | A founder/operator can explain and execute the response path in one pass. |
| Tighten buyer-facing trust language | The product is credible, but only if it is described precisely. | Sales and pilot conversations stay aligned with actual signing and certificate behavior. | Trust damage from fuzzy claims is larger than the effort to clarify them. | Small | Founder/legal review | Public and internal sales language consistently avoids overstating signature guarantees. |

### Near-term

| Item | Problem being solved | Intended outcome | Why now | Rough effort | Dependencies | Success signal |
|---|---|---|---|---|---|---|
| Add feedback triage discipline | The new intake stores requests but does not yet guarantee action or closure. | Requests move through a visible lightweight loop with clear ownership. | Enough volume now exists to justify process, but not dedicated tooling. | Small | Decision on assignee and cadence | Every new feedback item has an assignee and current status within the agreed review window. |
| Improve in-product billing clarity | The monetization model is sound, but more usage transparency reduces avoidable support questions. | Owners can understand trial timing, seat posture, and token consumption more easily. | Good follow-on once trust and ops basics are settled. | Small to medium | Existing billing and usage data | Fewer billing clarification questions during pilot onboarding and renewal discussions. |
| Consolidate workflow explanation surfaces | Multiple docs now overlap and drift. | One canonical workflow explanation is used for product, support, and planning. | This lowers future documentation drift and training burden. | Small | Documentation reconciliation | Team can point to one workflow reference without caveats. |

### Foundational

| Item | Problem being solved | Intended outcome | Why now | Rough effort | Dependencies | Success signal |
|---|---|---|---|---|---|---|
| Continue targeted client extraction | `App.tsx` and related orchestration still carry complexity. | Safer incremental change in the highest-churn UI areas. | Worth doing after commercial trust and operations are steadier. | Medium | Stable product priorities | New UI work lands in focused components without increasing cross-surface regression risk. |
| Mature observability from capture to alerting | Error capture exists, but a mature operating model needs thresholds and alerts. | The team notices meaningful failures quickly and responds predictably. | More valuable once the runtime topology is stable. | Medium | Processor deployment and agreed ops ownership | Alerting catches stuck queues or repeated failures before customers report them. |
| Reassess paid-pilot gate after real usage | The current judgment is based on code and docs more than sustained live behavior. | Pilot readiness is based on measured operator confidence, not optimism. | This keeps the team honest after the first wave of real usage. | Small | Private-beta feedback and smoke data | Founders can name the top recurring issues and their current mitigation status clearly. |

## Decision Log

- We are treating the missing audit memo as unavailable evidence, not filling the gap with invented findings.
- Repo implementation is considered more authoritative than stale docs when the two conflict.
- The product should be framed as a trustworthy private-beta workflow platform, not a broad-market advanced-signature product.
- The next readiness push should focus on operational durability and truth alignment rather than large new feature work.
- Feedback intake should be strengthened with process first, not with heavier tooling first.
- Architecture work remains important, but it does not outrank processor durability, documentation alignment, or trust-language discipline right now.

## Open Questions

- Has legal actually approved the current privacy, terms, and security content, or do those pages merely exist technically?
- What runtime and ownership model will be used for the processor in production: scheduled container, cron-triggered service, or another managed worker?
- Who owns feedback triage in practice during beta: founder, product, support, or a rotating engineering lead?
- What exact bar does the team want to use for “paid pilot” approval: successful smoke tests, a week of stable queue processing, a number of happy testers, or a specific support burden threshold?
- Is there any customer segment already expecting certificate-backed or regulated-signature behavior, or can that remain explicitly deferred without hurting current pipeline quality?
