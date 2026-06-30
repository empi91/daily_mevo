# Auth Session Fix (Issue #24) — Plan Brief

> Full plan: `context/changes/auth-session-fix/plan.md`
> Research: `context/changes/auth-session-fix/research.md`

## What & Why

Fix GitHub issue #24: on `https://dailymevo.pl`, the `fastapiusersauth` cookie is set on login but the session doesn't survive a page reload — the user appears logged out. Works fine locally. The fix is driven entirely by the existing test contract (Playwright + smoke + parity); no code is touched until diagnostics name the cause.

## Starting Point

The test contract is locked: three layers (parity unit/integration, smoke, Playwright) all assert `httpOnly`, `SameSite=Lax`, `Secure=(env != development)`, `path=/`, and host-only (no `Domain=`). The only knob that drives cookie attributes is `MEVO_ENVIRONMENT`. Production topology is single-origin via Cloudflare Tunnel. `MEVO_ENVIRONMENT`'s actual value on the VPS was an open question left by the parity archive — never verified remotely.

## Desired End State

All 3 Playwright tests in `e2e/auth-session.spec.ts` pass against `https://dailymevo.pl`; smoke passes against prod; parity and in-process auth suites still pass in CI; the prod `users` table has zero leftover test users; the change made has a documented atomic undo path.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Plan shape | Diagnostic → narrow → fix (3 + cleanup phases) | Honors "tests first, don't touch code"; fix details are filled in after Phase 1 evidence lands | Plan |
| `change.md` candidate #1 (`cookie_domain="dailymevo.pl"`) | Struck from candidates | Contradicts parity archive `plan.md:44` decision that host-only is correct; no test asserts a `Domain=` attribute | Research + Plan |
| `change.md` candidate #4 (SameSite cross-origin) | Struck from candidates | Single-origin topology rules it out structurally (`app/main.py:316-324`, `frontend/src/api/client.ts:1`) | Research |
| Cleanup of prod-DB test users | Bounded scope + SSH+psql DELETE as Phase 4 | Minimizes pollution upfront; guarantees clean DB at close-out | Plan |
| Cloudflare isolation | Conditional Step 1b — only if Step 1 curl shows Cloudflare alters Set-Cookie | Avoids unnecessary A/B work and 2x DB pollution when CF is innocent | Plan |
| Fix mechanism scope | VPS .env edit OR small change in `app/config.py` / `app/auth/config.py` only | Matches research finding that `MEVO_ENVIRONMENT` is the only relevant knob; anything else triggers STOP-and-replan | Research + Plan |
| Acceptance gate | 3 Playwright (prod) + smoke (prod) + parity (CI) + in-process auth (CI) all green | Matches the locked three-layer test contract from the parity archive | Plan |

## Scope

**In scope:**
- Running the 5-step diagnostic sequence against production
- Capturing evidence in `diagnostic-findings.md`
- Applying one small fix (env var on VPS, or one-line change in `app/config.py` / `app/auth/config.py`)
- Verifying all 4 test layers stay/turn green
- Deleting accumulated test-user pollution from the prod DB
- Documenting the atomic undo path

**Out of scope:**
- Setting `cookie_domain="dailymevo.pl"` (contradicts locked contract)
- Introducing new `MEVO_COOKIE_*` env vars
- Changes to Cloudflare Tunnel config, Dockerfile, docker-compose, frontend, middleware ordering, or tests
- Reproducing the bug locally (structurally impossible — localhost is http)
- Adding a nightly CI guard or automated test-user teardown infrastructure

## Architecture / Approach

Four phases, increasing blast radius. Phase 1 runs five bounded diagnostic steps with explicit "stop and decide" gates, each captured in a working evidence log. Phase 2 makes the smallest possible change the evidence names — env var on VPS or one-line code change — and records an atomic undo path. Phase 3 runs the locked four-layer test contract for acceptance. Phase 4 cleans the prod DB and closes the change. The deliberate gating in Phase 1 is the plan's main value; pre-specifying the fix would be speculation since the change.md candidate list has 4–5 entries.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Diagnostic sequence | `diagnostic-findings.md` with `## Identified Root Cause` (or `## STOP — Out of Scope`) | Implementer rushes past a surprising step instead of pausing; root cause is outside scope and triggers STOP-and-replan |
| 2. Apply identified fix | Single change — VPS .env or one-line code change — with atomic undo path recorded | Scope creep (a "while I'm here" cleanup); root cause turns out to need Cloudflare or proxy changes |
| 3. Verify against test contract | All 4 test layers green; `## Applied Fix & Undo Path` section in findings | A test layer regresses (parity especially), forcing a Phase 2 re-think |
| 4. Cleanup & close-out | 0 leftover test users in prod DB; `change.md` status = complete | Foreign-key constraints on `users` block the DELETE; needs cascade discussion |

**Prerequisites:** SSH access to mikrus; `MEVO_TEST_DATABASE_URL` set locally for parity tests; Playwright + Chromium installed (already present); `node_modules/.bin/playwright` present (verified).
**Estimated effort:** ~1 session (1–2 hours) if Step 0 names the root cause; ~2 sessions if Cloudflare bypass is needed or the fix is a code change going through PR.

## Open Risks & Assumptions

- **Assumes the VPS deploy path is `deploy.sh` + `docker compose`** — the SSH commands in Phase 1 and Phase 2 use this; if a different mechanism is in play, the exact command shapes need to be confirmed before running.
- **Assumes `users` has no blocking foreign keys for the DELETE in Phase 4** — Mevo's roadmap mentions a future favourites feature; if any FKs exist today, the cleanup needs a cascade approach.
- **Assumes the existing parity test (`tests/test_deployment_parity.py:143-180`) actually runs in CI** — if it's skipped without `MEVO_TEST_DATABASE_URL`, the acceptance gate has a hole; verify CI logs after Phase 3.
- **Assumes Cloudflare Tunnel preserves the Host header to `dailymevo.pl`** — if it forwards as `srv66-20312.wykr.es` or localhost, host-only cookies break in ways no test catches. Phase 1 Step 2 surfaces this via the browser's stored `domain` attribute.

## Success Criteria (Summary)

- A real user can log in at `https://dailymevo.pl`, reload the page, and still be logged in.
- `E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts` passes all 3 tests.
- The prod `users` table has 0 rows matching the test-user pattern; the change has a one-line undo path documented in `diagnostic-findings.md`.
