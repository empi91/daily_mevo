---
date: 2026-06-18T21:20:45Z
researcher: Claude
git_commit: 8476cf7ec04b4c1b6e242a96d256039763d9ec7f
branch: main
repository: daily_mevo
topic: "Test plan refresh — production burns, CI pipeline gap, and new risks after phases 1-3"
tags: [research, testing, ci-pipeline, production-parity, risk-map-update]
status: complete
last_updated: 2026-06-18
last_updated_by: Claude
---

# Research: Test Plan Refresh — Production Burns, CI Pipeline Gap, and New Risks

**Date**: 2026-06-18T21:20:45Z
**Researcher**: Claude
**Git Commit**: 8476cf7ec04b4c1b6e242a96d256039763d9ec7f
**Branch**: main
**Repository**: daily_mevo

## Research Question

After implementing test plan phases 1-3 (all tests green), production is broken in multiple ways (auth sessions, DB storage limits). What are the concrete gaps between the test suite and production reality? What does the CI pipeline need? Does the risk map require new entries or re-ranking?

## Summary

The test suite has a **fundamental deployment-parity blind spot**: all tests run in-process (ASGI transport) against a local Postgres, while production runs behind PgBouncer on Supabase with HTTPS, real browser cookies, and CORS enforcement. Three distinct production failures in auth alone went undetected. Additionally, there is **zero CI automation** — no GitHub Actions, no pre-commit hooks, no automated quality gates. The risk map needs two changes: re-rank Risk #4 from Medium/Medium to High/High, and add a new Risk #8 for unbounded data growth exhausting DB storage.

## Detailed Findings

### 1. Production vs Local Gaps

Five concrete gaps where tests pass but production breaks:

#### 1.1 Cookie Domain Not Set

`app/auth/config.py:14-19` — `CookieTransport` sets `cookie_secure`, `cookie_samesite`, `cookie_httponly` but **never sets `cookie_domain`**. When the backend runs on `srv66-20312.wykr.es` while the frontend is on `dailymevo.pl`, the browser silently rejects the cookie because the implicit domain doesn't match.

Tests bypass this entirely: `tests/test_auth.py:16-17` manually constructs a `Cookie` header, never testing whether a browser would store/resend it.

#### 1.2 CORS Origins Default to localhost

`app/config.py:17` — `cors_origins` defaults to `["http://localhost:5173"]`. Production needs override via `.env`. If the env var is missing or malformatted, all cross-origin credentialed requests silently fail. The CORS test (`tests/test_auth.py:178-198`) only checks against the localhost default.

#### 1.3 Test DB is Local Postgres, Production is Supabase PgBouncer

Tests use direct Postgres on port 5433 (`tests/conftest.py:139`). Production uses Supabase's PgBouncer (transaction mode, port 6543). The `statement_cache_size=0` workaround in `app/db.py:7` and `app/auth/db.py:14` was added after production 500s — local tests can never reproduce this class of failure since they connect directly to Postgres which supports prepared statements natively.

#### 1.4 No Deployment Validation Beyond `/health`

`deploy.sh:22-28` only checks the `/health` endpoint after deploy. The `/health` endpoint can return OK while auth is completely broken (confirmed by the `users` table incident). No post-deploy smoke test validates auth endpoints, frontend serving, or CORS headers.

#### 1.5 Environment Parity for Secure Cookies

`app/auth/config.py:18` sets `cookie_secure = settings.environment != "development"`. Tests run with `environment=development` by default, so the `Secure` flag behavior is never exercised in tests.

### 2. Test Suite Blind Spots (8 Categories)

| # | Category | Concrete failure that slips through |
|---|----------|-------------------------------------|
| 1 | Environment parity | `cookie_secure` flag never tested in production mode |
| 2 | Migration ordering | Fresh-DB `alembic upgrade head` could fail if migrations reference renamed columns |
| 3 | DB storage limits | INSERT fails silently when Supabase hits 500MB, health still returns OK |
| 4 | Collector scheduling | Overlapping APScheduler runs could double-insert snapshots |
| 5 | Frontend-backend contract | Frontend mocks hardcoded JSON shapes; backend field renames break prod, not tests |
| 6 | Real browser cookies | ASGI transport bypasses SameSite/Domain/Secure enforcement |
| 7 | Deployment artifact integrity | Docker multi-stage build serves different asset paths than dev |
| 8 | Timezone edge cases | DST transitions produce ghost rows in station_availability |

### 3. CI Pipeline State

**What exists (manual only):**
- All quality tools installed: `ruff`, `mypy`, `pytest`, `eslint`, `tsc`, `vitest`
- Frontend has working `lint`, `typecheck`, `test`, `build` scripts in `package.json`
- Backend has pytest with `integration`/`smoke` markers
- Deploy script (`deploy.sh`) with health check + rollback script
- Docker multi-stage build (Dockerfile)

**What is completely missing:**
- `.github/workflows/` — **no GitHub Actions at all**
- `.pre-commit-config.yaml` — **no pre-commit hooks**
- `Makefile` or task runner — no unified way to run all checks
- Automated deployment (CD) on merge
- Test coverage reporting
- Branch protection or required status checks

### 4. Risk Map Update Recommendations

#### Re-rank Risk #4: Medium/Medium → High/High

The existing Risk #4 ("Auth flow breaks in production") is exactly what happened, but it was under-ranked. Three separate production failures confirm both impact and likelihood:
1. `statement_cache_size` incompatibility with PgBouncer → 500 on all auth endpoints
2. Missing `users` table despite Alembic recording migration 005
3. Cookie `SameSite=lax` + no `cookie_domain` → browser silently rejects session

**Broadened scope recommended:** "Deploy-time configuration or migration state diverges from local — auth, DB connections, or CORS fail silently in production."

#### Add Risk #8: Unbounded Snapshot Growth Exhausts DB Storage

- **Impact:** High — when Supabase pauses the DB, all reads/writes fail, entire app goes down
- **Likelihood:** High — already triggered in production (issue #25)
- **Source:** Issue #25; issue #11 (snapshot retention, open since earlier); no retention/purge code exists anywhere in `app/`
- **What would prove protection:** A test that seeds old snapshots, runs a cleanup function, and verifies rows are deleted
- **Cheapest layer:** Integration test (seed + purge + assert)
- **Anti-pattern:** Testing that the cron job is scheduled, not that it actually deletes data

#### S-03 (Favourites): No New Risk Needed Yet

Favourites is standard CRUD behind auth. Risks fall under existing #3 (API correctness) and #4 (auth). Re-evaluate if implementation introduces client-side state management complexity.

## Code References

- `app/auth/config.py:14-19` — CookieTransport config (no cookie_domain)
- `app/config.py:17` — CORS origins defaulting to localhost
- `app/db.py:7` — statement_cache_size=0 workaround for PgBouncer
- `app/auth/db.py:14` — same workaround for auth DB engine
- `tests/conftest.py:139` — test DB connection (local Postgres, no PgBouncer)
- `tests/conftest.py:189` — ASGITransport-based test client (bypasses real HTTP)
- `tests/test_auth.py:16-17` — manual Cookie header construction
- `tests/test_auth.py:178-198` — CORS test only against localhost origin
- `deploy.sh:22-28` — post-deploy health check (only /health)
- `scripts/entrypoint.sh` — runs alembic upgrade head on deploy
- `.env.example:22-23` — CORS origins env var documentation
- `frontend/package.json:7-14` — quality scripts (lint, typecheck, test, build)
- `pyproject.toml:22-28` — dev dependencies (all tools present)

## Architecture Insights

The fundamental architecture gap is **the absence of a deployment verification layer**. The project has:
- ✅ Good unit/integration test coverage for business logic
- ✅ Good component test coverage for frontend rendering
- ❌ No verification that the Docker image actually works
- ❌ No verification that production environment config is correct
- ❌ No CI pipeline to run any of this automatically
- ❌ No post-deploy smoke tests wired into the deployment flow

The test pyramid is well-formed at the bottom (unit + integration) but has **nothing at the top** (no E2E, no deploy verification, no CI gate). This explains exactly why "all tests green, production broken."

## Historical Context

- `context/archive/2026-06-11-user-auth/` — auth implementation; cookie transport decisions made here
- `context/archive/2026-06-13-friendly-domain/` — CORS config for dailymevo.pl added
- `context/archive/2026-06-16-testing-api-auth/` — Phase 2 tests; the auth test pattern that uses manual cookie headers was established here
- `context/archive/2026-06-18-testing-frontend/` — Phase 3 tests; frontend mocking pattern established
- GitHub issue #24 — B-01: auth session not persisting
- GitHub issue #25 — B-02: Supabase DB exceeding 0.5GB

## Implications for the Test Plan Refresh

The refresh should:

1. **Re-rank Risk #4** to High/High and broaden its scope to deployment parity
2. **Add Risk #8** (DB storage exhaustion) — High/High, already triggered
3. **Expand Phase 4** (quality gates) beyond just "CI pipeline config" to include:
   - Post-deploy smoke test wiring (hit auth + API + frontend, not just /health)
   - GitHub Actions with lint + typecheck + backend tests + frontend tests + build
   - Pre-commit hooks (ruff check + ruff format)
4. **Consider a Phase 5** for deployment parity testing:
   - Docker image build + start verification
   - Cookie attribute assertions under production env settings
   - CORS validation against production origins
   - Frontend-backend contract tests (API response shapes match frontend expectations)
5. **Update §4 Stack** to include smoke test runner and Docker-based integration test option
6. **Update §5 Quality Gates** with the specific gates needed (now that we know what's missing)

## Open Questions

1. Should the smoke tests (`test_smoke.py`) be wired into `deploy.sh` as a post-deploy verification step, or should they run in CI against a staging-like environment?
2. Is a dedicated staging/preview environment feasible on the Mikr.us VPS, or should deploy verification run against the production URL immediately after deploy (with rollback on failure)?
3. Should frontend-backend contract tests live in the backend test suite (validating API response shapes) or in the frontend suite (validating mock shapes match real API)?
4. For the DB storage risk (#8): what's the retention policy? Keep snapshots for N days? Archive to cold storage? Aggregate and purge raw data?
