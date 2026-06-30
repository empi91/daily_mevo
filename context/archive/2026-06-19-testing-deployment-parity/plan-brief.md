# Deployment Parity Testing — Plan Brief

> Full plan: `context/changes/testing-deployment-parity/plan.md`
> Research: `context/changes/testing-deployment-parity/research.md`

## What & Why

Prove the deployed artifact works end-to-end by closing five production-vs-local gaps that caused three separate production failures (PgBouncer 500s, missing users table, broken auth sessions). The existing test suite runs entirely in-process with localhost defaults — no test exercises the real transport stack, production env config, or browser cookie behavior.

## Starting Point

The test suite has 11 backend test files (1568 LOC) and 11 frontend test files (710 LOC), but all run against `ASGITransport` with localhost defaults. Smoke tests exist (3 tests: health, weak register, stations list) but cover no auth flow, CORS, or cookie verification. CI deploys to Mikr.us with a 90s health poll but no rollback on failure. Docker image is never built in CI — only during deploy.

## Desired End State

Every deploy is verified beyond `/health`: the full auth lifecycle works (register → login → protected endpoint → logout), CORS headers match production origins, cookie attributes are correct, and the Docker image builds successfully. If any of these fail, CI automatically rolls back to the previous image. A Playwright E2E suite verifies the browser-level cookie round-trip that caused issue #24.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|----------|--------|-------------------|--------|
| Rollback automation | Wire rollback.sh into CI on smoke failure | Reduces MTTR from manual SSH to seconds; production stays broken otherwise. | Plan |
| Docker build in CI | Run on every PR, not just deploy | Catches Dockerfile regressions before merge; the three-stage build has fragile COPY layers. | Plan |
| API contract approach | Python dict of expected fields per endpoint | Lightweight, no codegen tooling; catches field renames/removals/type changes. | Plan |
| Cookie/CORS testing | Env-specific integration test with production settings | Fast and deterministic in CI; smoke tests cover the deployed layer separately. | Plan |
| PgBouncer guard | Unit test asserting config values | Cheap regression guard; behavioral test would need a real PgBouncer instance. | Plan |
| Migration verification | Test asserting chain consistency and head revision | Catches the "migration recorded but table missing" class of bug. | Plan |
| Smoke test scope | Health + full auth flow + station detail + CORS | Covers the historically broken area (auth) and adds the quality gate for issue #24. | Plan |
| Test user cleanup | Timestamped emails, no cleanup | Simplest; users accumulate harmlessly at ~1-2/day deploy frequency. | Plan |
| Auth smoke = hard gate | Mandatory — failing auth flow triggers rollback | Forces issue #24 fix before any deploy succeeds; quality gate works as designed. | Plan |
| Port mismatch | Document, don't automate | CI uses SMOKE_BASE_URL from secrets (correct port); automated check would be brittle. | Plan |
| E2E approach | Basic Playwright foundation, open for /10x-e2e expansion | Browser cookie round-trip is the gap that caused issue #24; httpx can't test it. | Plan |
| Rollback.sh health check | Upgrade to polling loop (match deploy.sh) | Single 10s-wait check is unreliable for slow container starts. | Plan |

## Scope

**In scope:**
- PgBouncer `statement_cache_size` regression test
- Alembic migration chain verification test
- Cookie attribute test under production settings
- CORS header test under production origin
- API contract shape validation (4 endpoint groups)
- Expanded smoke tests (~8 tests with full auth flow)
- Docker build CI job on every PR
- Automated rollback in CI deploy job
- Rollback.sh polling loop upgrade
- Basic Playwright E2E (auth cookie round-trip, station navigation)

**Out of scope:**
- Fixing issue #24 (creates the quality gate, not the fix)
- Full E2E suite (foundation only; /10x-e2e expands)
- OpenAPI codegen for contract testing
- PgBouncer behavioral test with real pooler
- Admin user cleanup endpoint
- Cookie domain env var addition

## Architecture / Approach

Four test layers, each catching a different class of deployment-parity bug:
1. **Config regression tests** (pytest, CI) — assert production-critical settings produce correct behavior in-process
2. **Smoke tests** (httpx, post-deploy) — verify real HTTP against the deployed instance
3. **CI hardening** (GitHub Actions) — Docker build verification + automated rollback safety net
4. **E2E tests** (Playwright, browser) — verify browser-level cookie behavior that httpx cannot

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|-----------------|----------|
| 1. Config & Contract Regression Tests | Guards for PgBouncer, migrations, cookies, CORS, API shapes | Cookie test needs correct settings override timing with session-scoped fixtures |
| 2. Smoke Test Expansion | Full auth lifecycle + CORS against deployed instance | Auth smoke tests will block deploys until issue #24 is fixed |
| 3. CI Pipeline Hardening | Docker build on PRs, automated rollback, upgraded rollback.sh | Rollback.sh is a production script — changes deploy via git pull |
| 4. Basic E2E Tests (Playwright) | Browser auth cookie round-trip, station navigation | Playwright setup and CI integration add infra complexity |

**Prerequisites:** Test database running (Docker Postgres on port 5433), CI secrets configured (`SMOKE_BASE_URL`, SSH keys), Node.js for Playwright
**Estimated effort:** ~3-4 sessions across 4 phases

## Open Risks & Assumptions

- **Auth smoke tests will block all deploys until issue #24 is fixed** — this is by design (mandatory quality gate), but means #24 must be addressed before or alongside Phase 2 deployment
- **Reverse proxy on Mikr.us is unknown** — if nginx/Caddy sits in front of the Docker container and strips `Host` headers, `cookie_domain=None` may not work even with same-origin serving
- **Production `.env` contents are unverified** — CORS smoke test assumes `MEVO_CORS_ORIGINS` includes `https://dailymevo.pl`; if it doesn't, the smoke test will correctly fail
- **Phase 4 (E2E) is intentionally open** — designed to be refined by `/10x-e2e` before implementation

## Success Criteria (Summary)

- All new config/contract tests pass in CI, guarding against the three classes of production failure
- Smoke tests verify the full auth lifecycle against the deployed instance and trigger automated rollback on failure
- Playwright E2E tests prove the browser stores and sends the auth cookie correctly
