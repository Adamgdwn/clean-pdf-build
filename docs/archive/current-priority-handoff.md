# Current Priority Handoff

Date: `2026-04-21`

## What just completed

### Security and session hardening (B1)

- Removed the redundant custom session layer (`loadStoredSession`, `persistSession`, `clearStoredSession`).
- Browser-side Supabase client is now hydrated via `onAuthStateChange` and `auth.setSession()` on the login redirect handoff. This means `autoRefreshToken: true` actually works — previously the access token expired after one hour with no recovery path.
- `TOKEN_REFRESHED` events now update the React session state so subsequent API calls use the fresh token.
- `handleSignOut()` now calls `auth.signOut()` to invalidate the refresh token server-side. Previously sign-out only cleared localStorage; the refresh token remained valid.
- Registration via `onSessionCreated` now hydrates the browser client so auto-refresh starts immediately after account creation.

### Processor runtime (B2)

- Created `POST /api/processor-run` Vercel function — runs notifications, OCR jobs, and document purges sequentially behind `EASYDRAFT_PROCESSOR_SECRET`. Each job type is error-isolated: a Resend failure does not prevent purges from running.
- Returns HTTP 200 if all clean, 207 if any task errored. Sentry receives a per-task scoped exception on any failure.
- Registered in `api/[...route].ts` alongside all other Vercel handlers — no new hosting platform.
- Created `.github/workflows/processor-cron.yml`: triggers every 30 minutes, retries transient curl errors, exits non-zero on a 207 so GitHub sends alert email.
- Upgrade path documented in `docs/deployment.md`: when notification retry latency matters, a 15 MB Alpine + supercronic container calling the same endpoint can be deployed to Fly.io with three commands.

### Credentials cleanup

- Live Stripe secret key removed from `.env` — replace with `sk_test_...` for local dev; live key lives in Vercel only.
- Supabase management API token removed from `.env` — regenerate only when needed for a migration task; rotate the old token in the Supabase dashboard.

## Current judgment

Two of the four original ship blockers are now resolved in code (B1 session, B2 processor). The remaining two are operational and operator-executed:

- **B3** — run the live commercial smoke test against real Stripe + Resend
- **B4** — wire Sentry alert rules and assign owners for failed-notification and stuck-job response

Typecheck, build, and tests all pass clean.

---

## Remaining plan

### Ship blockers — operator-executed (no code changes required)

**B3 — Live smoke test**

Run this against the deployed production stack before any active selling. The scenario matrix is already in `ADAMS_ACTIONS.md`. The minimum path:

1. Sign up as a new account admin → confirm org admin landing
2. Stripe checkout with `4242 4242 4242 4242` → confirm subscription in-app and portal loads
3. Send one `platform_managed` workflow to a real external email → confirm signing link arrives, OTP gate works, link is dead after completion
4. Accept a workspace invite from a different browser session
5. Delete the test account → confirm clean cascade

**B4 — Alert routing**

In the Sentry project:
- Add an alert rule: any new error → email `admin@agoperations.ca` immediately
- Add an alert rule: error rate spike (> 5 events / 5 min) → same
- The `processor-cron` GitHub Actions workflow already emails on job failure; no additional wiring needed there

Assign named owners in `docs/operator-runbook.md` for:
- failed notification rows (check admin queue view)
- stuck OCR jobs (check admin queue view)
- deploy smoke checks after each push to `main`

---

### Fix before broader launch

**H1 — Integration test coverage for launch-critical paths**

The following paths are smoke-tested manually but have no automated coverage. Add test files alongside `packages/workflow-service/src/security.test.ts`:

- Invite acceptance: happy path, wrong-email rejection, expired-token rejection
- Workspace switch: documents, billing, and team data re-scope correctly
- Guest signing: token session creation, OTP gate enforced, superseded-link rejection, replayed-link rejection
- Stripe webhook: duplicate `checkout.session.completed` event does not double-apply billing state

**H2 — Trust-copy pass on public pages**

Founder/legal read-through of `/privacy`, `/terms`, `/security`, `/pricing`. Specifically verify:
- No language implies certificate-backed signing is live
- Storage and retention wording matches the temporary-by-default retention behavior
- Signer verification is described as "email-code-gated link," not "cryptographic signature"
- Pricing matches actual Stripe config (trial length, seat price, token pack amount)

**H3 — Stripe webhook idempotency test**

Replay the same `checkout.session.completed` event twice in a test. Assert billing state is unchanged on the second delivery. README claims "webhook dedupe is tighter" — prove it with a test.

---

### Post-launch (tracked, not blocking)

**L1 — Extract high-churn flows from `App.tsx`** (currently 4755 lines)

Extraction order by regression risk:
1. Guest/external signer container (lines ~1937–1955 + related state) — most isolated
2. Workspace hydration + switching — already partially in hooks
3. Onboarding prompt — single-use, easy to lift
4. Document workspace shell — largest piece, save for last

Each extraction gets its own PR with snapshot tests. Do not attempt a single rewrite.

**L2 — Cookie-backed auth BFF**

Only worth building if an enterprise deal specifically asks about token-handling posture. The current approach (Supabase session in its own localStorage key with auto-refresh) is materially better after B1 and is acceptable for SMB buyers. Track as a design doc, not a sprint item.

**L3 — Token-ledger history in billing UI**

Surface recent `billing_usage_events` rows so owners can see token consumption at a glance.

**L4 — Trial-end conversion messaging**

Stronger in-product prompt with specific trial-end date and expected charge amount.

**L5 — Certificate-backed PDF signing**

Wire only when a real customer deal requires it. Pick a provider (`node-signpdf`, Dropbox Sign, or a qualified TSP), embed a PKCS#7 `/Sig` annotation, keep signer identity in reusable profiles. The `EASYDRAFT_ENABLE_CERTIFICATE_SIGNING` flag is already wired to gate the UI.

---

## Verification status

```bash
npm run typecheck   # passes clean
npm run test        # passes clean (18 tests)
npm run build       # passes clean
```
