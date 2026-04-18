# Changelog

This project uses a lightweight changelog. Update this file for each release or pilot deployment that changes user-facing behavior, trust posture, or operator workflow.

## Unreleased

- Added external signer email-code verification before guest signature, initial, and approval completion.
- Tightened signing-token invalidation for superseded and completed guest links.
- Blocked workspace invite acceptance when the signed-in account email does not match the invited email.
- Added pre-auth invite detail lookup so pending invites show workspace, role, and invited email clearly.
- Made Stripe free-trial end behavior explicit with invoice creation when no payment method is present, and tightened webhook dedupe.
- Introduced `Refine. Share. Sign.` as the product slogan across the public site and app shell.
- Fixed direct public-route deployment support for `/pricing`, `/privacy`, `/terms`, and `/security`.
- Added a public-route smoke script for post-deploy verification.
- Tightened documentation around env requirements, trust posture, and operator workflows.
- Expanded feedback handling toward a triage-ready admin workflow.
- Re-centered the repo docs around EasyDraft as a minimal-change workflow-safe PDF execution system rather than a broad editor.
- Added a current-priority handoff so the completed work and next hardening priorities are explicit.
