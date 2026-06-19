# Deployment Parity Testing Implementation Plan

## Overview

Prove the deployed artifact works end-to-end by closing the five production-vs-local gaps identified in the 2026-06-18 test-plan refresh. This phase adds config regression tests (cookie/CORS, PgBouncer, migration state), expands the smoke test suite from 3 to ~8 tests covering the full auth lifecycle, hardens the CI pipeline with Docker build verification and automated rollback, and lays the Playwright foundation for browser-level auth cookie verification. Covers test-plan risks #4 (deploy-time config divergence) and #8 (deploy verification angle).

## Current State Analysis

The test suite runs entirely in-process via `ASGITransport` with localhost defaults. Three separate production failures (PgBouncer `statement_cache_size`, missing `users` table, cookie session persistence — issue #24) all escaped this test suite because no test exercised the real transport stack, production env config, or browser cookie behavior.

### Key Discoveries:

- **Smoke coverage is minimal**: 3 tests (`/health`, `/auth/register` weakly, `/stations`) — no login, no authenticated endpoints, no CORS verification (`tests/test_smoke.py`)
- **Cookie config has no test coverage**: `CookieTransport` in `app/auth/config.py:14-19` sets `cookie_secure`, `cookie_samesite`, `cookie_httponly` based on `settings.environment`, but no test verifies the correct attributes appear in `Set-Cookie` headers under production settings
- **CORS test only covers localhost**: `tests/test_auth.py:178-200` verifies `http://localhost:5173` origin — no test verifies production origins like `https://dailymevo.pl`
- **PgBouncer fix has no regression guard**: `statement_cache_size=0` is set in `app/db.py:7` and `app/auth/db.py:14` but no test asserts this, so a refactor could silently remove it
- **Migration chain is 6 revisions deep** (`001`→`006`), linear, head is `006` — no test verifies the chain is consistent or that head matches expectations
- **API contract is manual**: 5 Pydantic models in `app/api/models.py` mirrored as TypeScript interfaces in `frontend/src/api/stations.ts` with no automated drift detection
- **Docker image is never built in CI** — only during deploy; a broken Dockerfile surfaces only after merge to main
- **CI deploy has no rollback**: if smoke tests fail, the job exits 1 but production stays broken until manual intervention
- **`rollback.sh` has a weak single health check** after a fixed 10s wait, unlike deploy's 90s polling loop

## Desired End State

After this plan is complete:
1. CI catches Docker build regressions on every PR (before merge)
2. A failed deploy automatically rolls back to the `:prev` image
3. Config regression tests guard PgBouncer settings, migration state, cookie attributes, and CORS headers under production-like config
4. Smoke tests verify the full auth lifecycle (register → login → /users/me → logout) and CORS headers against the deployed instance
5. API contract tests catch frontend-backend type drift
6. A basic Playwright E2E suite verifies browser cookie round-trip — the gap that caused issue #24
7. All smoke tests are mandatory quality gates — a failing auth flow blocks deploys

How to verify: all new tests pass in CI, the deploy job includes rollback-on-failure, and `docker compose build` runs on every PR.

## What We're NOT Doing

- **Fixing issue #24** (auth session persistence) — this phase creates the quality gate that will verify a future fix, not the fix itself
- **Full E2E test suite** — Phase 4 lays the Playwright foundation; `/10x-e2e` will expand coverage
- **OpenAPI codegen** — contract tests use a lightweight Python dict approach, not generated types
- **PgBouncer integration test** — we test the config value, not behavior through a real pooler
- **Port mismatch automation** — documented as a known config dependency, not automated
- **Admin user cleanup endpoint** — smoke tests use timestamped emails that accumulate harmlessly
- **Cookie domain env var** — same-origin serving makes `cookie_domain=None` correct; adding a configurable override is out of scope

## Implementation Approach

Four phases, each independently testable:

1. **Config & contract regression tests** — pure pytest tests that run in CI with no external dependencies. Override settings to simulate production config, assert cookie/CORS headers, guard PgBouncer settings, verify migration chain, validate API response shapes.
2. **Smoke test expansion** — extend the existing `tests/test_smoke.py` to cover the full auth lifecycle and CORS against the deployed instance. Uses `httpx` (no browser), timestamped unique emails.
3. **CI pipeline hardening** — add a `docker-build` job to CI, wire automated rollback into the deploy job, upgrade `rollback.sh` with a polling health check.
4. **Basic E2E tests (Playwright)** — install Playwright, write seed tests for browser auth cookie round-trip and CORS. This phase is intentionally left open for refinement via `/10x-e2e` before implementation.

## Critical Implementation Details

### Cookie attribute testing under production config

The env-specific integration test must override `settings.environment` to `"production"` and `settings.cors_origins` to `["https://dailymevo.pl"]` *before* the app processes the request. The `api_client` fixture boots the app at session scope, so the override must happen at the right point — either via monkeypatch on the settings object or by creating a separate test-scoped client with production settings. The existing `api_client` fixture in `tests/conftest.py:161` patches `settings.database_url` via monkeypatch, so the same pattern applies.

### Smoke test auth flow creates real users in production

Each smoke run registers a user with a timestamped email (e.g., `smoke-1718800000@test.local`). These accumulate in the production `users` table. At current deploy frequency (~1-2/day), this is negligible. The existing `test_smoke_register` already uses this pattern (`tests/test_smoke.py:40`).

---

## Phase 1: Config & Contract Regression Tests

### Overview

Add pytest tests that verify production-critical configuration values and API contract shapes. These run in CI against the test database (no external dependencies) and catch the class of bugs that caused the three production failures.

### Changes Required:

#### 1. PgBouncer statement_cache_size regression test

**File**: `tests/test_deployment_parity.py` (new)

**Intent**: Assert that both database connection layers (`app/db.py` asyncpg pool and `app/auth/db.py` SQLAlchemy engine) configure `statement_cache_size=0`, preventing a silent revert of the PgBouncer fix from commit `edf8495`.

**Contract**: Two test functions that import the pool/engine creation code and inspect the configuration arguments. No database connection needed — this is a config inspection test.

#### 2. Migration head assertion test

**File**: `tests/test_deployment_parity.py`

**Intent**: Assert that the Alembic migration chain is consistent and the current head matches the expected revision (`006`). Catches the "migration recorded but table missing" class of bug by verifying the chain has no gaps.

**Contract**: Uses `alembic.config.Config` and `alembic.script.ScriptDirectory` to inspect the migration chain. Asserts: single head (no branches), head revision matches expected value, all revisions form a linear chain. No database connection needed.

#### 3. Cookie attribute integration test (production settings)

**File**: `tests/test_deployment_parity.py`

**Intent**: Verify that under production-like settings (`environment="production"`, `cors_origins=["https://dailymevo.pl"]`), the `Set-Cookie` header on a login response contains the correct attributes: `HttpOnly`, `SameSite=lax`, `Secure`, and `Path=/`.

**Contract**: Marker `@pytest.mark.integration`. Creates a test-scoped `httpx.AsyncClient` with `ASGITransport(app=app)` after monkeypatching `settings.environment = "production"` and `settings.cors_origins = ["https://dailymevo.pl"]`. Registers a user, logs in via `POST /api/v1/auth/cookie/login`, inspects `Set-Cookie` response header. Asserts presence of `httponly`, `samesite=lax`, `secure`, `path=/` directives.

#### 4. CORS headers integration test (production origin)

**File**: `tests/test_deployment_parity.py`

**Intent**: Verify that CORS preflight and actual requests with a production `Origin` header receive correct `Access-Control-Allow-Origin` and `Access-Control-Allow-Credentials` headers. Complements the existing localhost-only CORS test in `tests/test_auth.py:178-200`.

**Contract**: Same production-settings client as the cookie test. Sends `OPTIONS` preflight with `Origin: https://dailymevo.pl` and `Access-Control-Request-Method: POST`. Asserts `access-control-allow-origin` equals `https://dailymevo.pl` and `access-control-allow-credentials` equals `true`. Also verifies that an unauthorized origin is rejected.

#### 5. API contract shape validation

**File**: `tests/test_api_contract.py` (new)

**Intent**: Validate that backend API responses contain the exact field names and compatible types that the frontend TypeScript interfaces expect. Catches field renames, removals, or type changes that would break the frontend.

**Contract**: Marker `@pytest.mark.integration`. Defines expected-fields dicts for each endpoint matching the TypeScript interfaces in `frontend/src/api/stations.ts`:
- `GET /api/v1/stations` → `StationResponse` fields: `station_id`, `name`, `address`, `lat`, `lon`, `capacity`
- `GET /api/v1/stations/{id}` → `StationDetailResponse` fields: above + `availability` (list of `AvailabilitySlot` with `day_of_week`, `time_slot`, `avg_bikes`, `avg_ebikes`, `sample_count`, `reliability_label`)
- `GET /api/v1/stations/nearby` → `NearbyStationResponse` fields: above + `distance_m`
- `GET /api/v1/geocode` → `GeocodeResponse` fields: `lat`, `lon`, `display_name`

Uses the `api_client` fixture with seeded test data. Calls each endpoint, validates response JSON keys match expected-fields dicts. Type assertions: numeric fields are `int`/`float`, string fields are `str`, list fields are `list`.

### Success Criteria:

#### Automated Verification:

- All tests in `tests/test_deployment_parity.py` pass: `uv run pytest tests/test_deployment_parity.py -v`
- All tests in `tests/test_api_contract.py` pass: `uv run pytest tests/test_api_contract.py -v`
- Type checking passes: `uv run mypy tests/test_deployment_parity.py tests/test_api_contract.py`
- Linting passes: `uv run ruff check tests/test_deployment_parity.py tests/test_api_contract.py`
- Existing tests still pass: `uv run pytest -v`

#### Manual Verification:

- Review test assertions match the actual TypeScript interfaces in `frontend/src/api/stations.ts`
- Verify cookie attribute test correctly simulates production settings

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Smoke Test Expansion

### Overview

Expand the smoke test suite from 3 to ~8 tests covering the full auth lifecycle, station detail, and CORS verification against the deployed instance. These tests run post-deploy in CI and serve as the mandatory quality gate.

### Changes Required:

#### 1. Auth flow smoke tests

**File**: `tests/test_smoke.py`

**Intent**: Add smoke tests that exercise the complete auth lifecycle against the deployed instance: register → login → access protected endpoint → logout. This is the test that would have caught issue #24 (auth session not persisting) and the PgBouncer 500 on auth endpoints.

**Contract**: Four new test functions using the existing `smoke_client` fixture:
- `test_smoke_login` — registers a user with timestamped email, then `POST /api/v1/auth/cookie/login` with form-urlencoded `username`/`password`. Asserts status 204 and `Set-Cookie` header contains `fastapiusersauth`.
- `test_smoke_authenticated_access` — after login, `GET /api/v1/users/me` with the cookie from login response. Asserts status 200 and response contains `email` field matching the registered email.
- `test_smoke_logout` — after authenticated access, `POST /api/v1/auth/cookie/logout` with the cookie. Asserts status 204.
- `test_smoke_protected_after_logout` — after logout, `GET /api/v1/users/me` without cookie. Asserts status 401.

These tests must run in order within the module. Use a module-level variable or fixture to share the registered credentials and cookie across tests.

#### 2. Station detail smoke test

**File**: `tests/test_smoke.py`

**Intent**: Verify that station detail endpoint works against the deployed instance, not just the list endpoint.

**Contract**: `test_smoke_station_detail` — fetches `/api/v1/stations` to get a station ID, then `GET /api/v1/stations/{id}`. Asserts status 200 and response contains `station_id`, `name`, and `availability` fields.

#### 3. CORS preflight smoke test

**File**: `tests/test_smoke.py`

**Intent**: Verify that the deployed instance returns correct CORS headers for the production frontend origin. Catches the case where `MEVO_CORS_ORIGINS` is missing from production `.env`.

**Contract**: `test_smoke_cors_preflight` — sends `OPTIONS /api/v1/stations` with `Origin: https://dailymevo.pl` and `Access-Control-Request-Method: GET`. Asserts `access-control-allow-origin` contains `https://dailymevo.pl` and `access-control-allow-credentials` is `true`.

#### 4. Strengthen existing register smoke test

**File**: `tests/test_smoke.py`

**Intent**: The current `test_smoke_register` only asserts "not 500". Strengthen it to assert the expected status code and response shape.

**Contract**: Modify `test_smoke_register` to assert status 201 and response JSON contains `id` and `email` fields. Keep the timestamped email pattern. A 400 (duplicate email) is still acceptable if the test runs multiple times, but 422/500 should fail.

### Success Criteria:

#### Automated Verification:

- All smoke tests pass against a local dev server: start `uv run uvicorn app.main:app` and run `MEVO_SMOKE_BASE_URL=http://localhost:8000 uv run pytest tests/test_smoke.py -v`
- Linting passes: `uv run ruff check tests/test_smoke.py`
- Type checking passes: `uv run mypy tests/test_smoke.py`
- Existing non-smoke tests still pass: `uv run pytest -v --ignore=tests/test_smoke.py`

#### Manual Verification:

- Review that auth flow tests correctly chain register → login → authenticated access → logout
- Verify CORS smoke test uses the actual production origin from `.env.example`
- Confirm smoke tests skip gracefully when the server is unreachable (existing skip guard)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: CI Pipeline Hardening

### Overview

Add a Docker build verification job to CI (runs on every PR), wire automated rollback into the deploy job on smoke failure, and upgrade `rollback.sh` with a polling health check loop matching `deploy.sh`'s pattern.

### Changes Required:

#### 1. Docker build CI job

**File**: `.github/workflows/ci.yml`

**Intent**: Add a `docker-build` job that runs `docker compose build` on every push and PR, catching Dockerfile regressions (missing COPY, broken multi-stage, dependency issues) before merge to main.

**Contract**: New job `docker-build` at the top level (no `needs:`, runs in parallel with `backend` and `frontend`). Steps: checkout, `docker compose build`. The `deploy` job's `needs:` updated to `[backend, frontend, docker-build]` so a broken Docker build blocks deploy.

#### 2. Automated rollback on smoke failure

**File**: `.github/workflows/ci.yml`

**Intent**: If the health check or smoke tests fail after deploy, automatically SSH into the server and run `rollback.sh` before the job exits with failure. Reduces MTTR from "engineer notices and SSHs in" to "CI fixes it in seconds".

**Contract**: Add a step after the smoke test step that runs `if: failure()` (GitHub Actions conditional). This step uses `appleboy/ssh-action@v1` (same secrets as deploy) to run `cd /app && ./rollback.sh` on the server. The step name should clearly indicate it's a rollback. The job still exits with failure status so the team is notified.

#### 3. Upgrade rollback.sh health check

**File**: `rollback.sh`

**Intent**: Replace the single 10s-wait health check with a polling loop matching `deploy.sh`'s 18×5s pattern, so rollback correctly handles slow container starts.

**Contract**: Replace the `sleep 10` + single curl check (lines 23-34) with a loop: poll `http://localhost:20312/health` every 5s, up to 18 attempts (90s total), checking for `"status":"ok"`. Exit 0 on success, exit 1 on timeout.

#### 4. Document port mismatch

**File**: `docker-compose.yml`

**Intent**: Add a comment noting that `MIKRUS_APP_PORT` must be set in production `.env` and that `deploy.sh`/`rollback.sh` hardcode port 20312.

**Contract**: A single comment line above the ports mapping.

### Success Criteria:

#### Automated Verification:

- CI workflow YAML is valid: `python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
- Docker build succeeds locally: `docker compose build`
- Rollback script is syntactically valid: `bash -n rollback.sh`
- Existing CI jobs still work (verify structure by reading the YAML)

#### Manual Verification:

- Review CI workflow changes: `docker-build` job runs in parallel, `deploy` depends on all three jobs
- Review rollback step uses `if: failure()` correctly
- Verify rollback.sh polling loop matches deploy.sh pattern
- Confirm deploy job still works end-to-end on a push to main

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Basic E2E Tests (Playwright)

### Overview

Install Playwright and write seed E2E tests that verify browser-level auth cookie round-trip — the exact gap that caused issue #24 (auth session not persisting in the browser). This phase establishes the Playwright infrastructure and a small set of foundational tests. It is intentionally left open for expansion and refinement via `/10x-e2e` before implementation.

**Note**: This phase should be refined with `/10x-e2e` before implementation. The test list below is a starting point — the E2E skill will apply its risk-based methodology, seed test pattern, and anti-pattern review to produce the final test specifications.

### Changes Required:

#### 1. Playwright infrastructure setup

**File**: `playwright.config.ts` (new, project root) and `package.json` or dedicated config

**Intent**: Install Playwright and configure it for the project. The dev server serves both frontend and backend at the same origin (FastAPI + StaticFiles), so Playwright should target a single base URL.

**Contract**: Playwright config with `baseURL` defaulting to `http://localhost:8000` (overridable via env var). Single project (Chromium is sufficient for deployment-parity testing). Test directory: `e2e/` at project root. `webServer` config to auto-start `uvicorn` if not already running.

#### 2. Auth cookie round-trip E2E test

**File**: `e2e/auth-session.spec.ts` (new)

**Intent**: Verify that a real browser can register, log in, receive a session cookie, access a protected page, and maintain the session across navigation. This is the test that would catch issue #24.

**Contract**: Test flow:
1. Navigate to the register page
2. Fill in email (timestamped) and password, submit
3. Navigate to the login page
4. Fill in credentials, submit
5. Assert redirect to a logged-in state (e.g., dashboard or home showing user email)
6. Navigate to a protected area (e.g., user profile or favourites)
7. Assert the page loads without a 401 redirect
8. Reload the page — assert session persists (cookie survives navigation)
9. Log out
10. Assert redirect back to logged-out state

Locators: `getByRole`, `getByLabel`, `getByText` — never CSS selectors or XPath. No `page.waitForTimeout()` — wait for state (`toBeVisible()`, `waitForURL()`). Unique timestamped email for test isolation.

#### 3. CORS and cookie attributes E2E test

**File**: `e2e/auth-session.spec.ts` (same file or new)

**Intent**: Verify that the browser actually stores and sends the `fastapiusersauth` cookie. This goes beyond what httpx can test — the browser's cookie jar applies `SameSite`, `Secure`, and `Domain` rules that httpx doesn't.

**Contract**: After login, inspect browser cookies via Playwright's `context.cookies()` API. Assert:
- Cookie named `fastapiusersauth` exists
- `httpOnly` is `true`
- `sameSite` is `Lax`
- `secure` matches the expected value for the environment
- `path` is `/`

#### 4. Public page loads E2E test

**File**: `e2e/stations.spec.ts` (new)

**Intent**: Verify that the main public flow works in a real browser — station list loads, a station can be clicked, and the detail page renders availability data.

**Contract**: Test flow:
1. Navigate to the home page
2. Assert station list is visible (at least one station rendered)
3. Click a station link
4. Assert station detail page loads with station name and availability data visible
5. Assert no console errors during navigation

#### 5. CI integration for E2E (optional — may be deferred to /10x-e2e)

**File**: `.github/workflows/ci.yml`

**Intent**: Run Playwright E2E tests in CI. This may be deferred to the `/10x-e2e` expansion if the CI integration is complex.

**Contract**: New job or step that installs Playwright browsers, starts the dev server, and runs `npx playwright test`. Requires the test database to be available.

### Success Criteria:

#### Automated Verification:

- Playwright installs successfully: `npx playwright install chromium`
- E2E tests pass locally: `npx playwright test`
- No lint errors in test files
- Existing tests unaffected

#### Manual Verification:

- Watch E2E tests run in headed mode: `npx playwright test --headed`
- Verify auth cookie round-trip test demonstrates the full login lifecycle
- Confirm cookie attribute assertions match production expectations
- Review that tests follow E2E best practices (no `waitForTimeout`, accessible locators, test independence)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- PgBouncer `statement_cache_size=0` config assertion (both `app/db.py` and `app/auth/db.py`)
- Alembic migration chain consistency (single head, linear chain, expected revision)

### Integration Tests:

- Cookie attributes under production settings (login → inspect `Set-Cookie`)
- CORS headers under production origin (preflight → inspect response headers)
- API contract shape validation (all 4 endpoint groups)

### Smoke Tests (against deployed instance):

- Full auth flow: register → login → /users/me → logout → 401
- Station detail endpoint
- CORS preflight with production origin
- Health endpoint (existing)
- Stations list (existing, kept)

### E2E Tests (Playwright, browser):

- Auth cookie round-trip (register → login → protected page → session persistence → logout)
- Cookie attribute inspection via browser API
- Station list → detail navigation

## Performance Considerations

- Docker build in CI adds ~2-3 min to PR checks (no layer caching on GitHub Actions free tier). This is acceptable given it catches Dockerfile regressions before merge.
- Smoke tests add ~10-15s to deploy time (auth flow + CORS check). Negligible.
- E2E tests add ~30-60s when run locally; CI time depends on whether a dev server needs to start.

## Migration Notes

- **Auth smoke tests will block deploys if issue #24 is still present.** The auth flow test (register → login → /users/me) is a mandatory quality gate. If the deployed instance can't complete this flow, CI will roll back and fail. This means issue #24 must be fixed either before or alongside deploying Phase 2's smoke tests to production.
- **Rollback.sh changes affect production.** The polling loop upgrade (Phase 3) changes a production script. Deploy the updated script via the normal git pull flow — it will be available on the next deploy.

## References

- Research: `context/changes/testing-deployment-parity/research.md`
- Test plan: `context/foundation/test-plan.md` §3 Phase 6, §2 Risk #4 and #8
- Existing CORS test: `tests/test_auth.py:178-200`
- Existing smoke tests: `tests/test_smoke.py`
- Cookie transport config: `app/auth/config.py:14-19`
- PgBouncer fix: `app/db.py:7`, `app/auth/db.py:14`
- Migration chain: `alembic/versions/001-006`
- API models: `app/api/models.py:1-46`
- TS interfaces: `frontend/src/api/stations.ts:3-45`
- CI workflow: `.github/workflows/ci.yml`
- Deploy/rollback scripts: `deploy.sh`, `rollback.sh`
- Issue #24: auth session not persisting on `dailymevo.pl`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Config & Contract Regression Tests

#### Automated

- [x] 1.1 All tests in test_deployment_parity.py pass — 15edb32
- [x] 1.2 All tests in test_api_contract.py pass — 15edb32
- [x] 1.3 Type checking passes on new test files — 15edb32
- [x] 1.4 Linting passes on new test files — 15edb32
- [x] 1.5 Existing tests still pass — 15edb32

#### Manual

- [x] 1.6 Test assertions match actual TypeScript interfaces — 15edb32
- [x] 1.7 Cookie attribute test correctly simulates production settings — 15edb32

### Phase 2: Smoke Test Expansion

#### Automated

- [x] 2.1 All smoke tests pass against local dev server — 9ed3672
- [x] 2.2 Linting passes on test_smoke.py — 9ed3672
- [x] 2.3 Type checking passes on test_smoke.py — 9ed3672
- [x] 2.4 Existing non-smoke tests still pass — 9ed3672

#### Manual

- [x] 2.5 Auth flow tests correctly chain register → login → access → logout — 9ed3672
- [x] 2.6 CORS smoke test uses actual production origin — 9ed3672
- [x] 2.7 Smoke tests skip gracefully when server unreachable — 9ed3672

### Phase 3: CI Pipeline Hardening

#### Automated

- [x] 3.1 CI workflow YAML is valid — 56e8f2d
- [x] 3.2 Docker build succeeds locally — 56e8f2d
- [x] 3.3 Rollback script is syntactically valid — 56e8f2d

#### Manual

- [x] 3.4 Docker-build job runs in parallel with backend/frontend — 56e8f2d
- [x] 3.5 Rollback step uses if: failure() correctly — 56e8f2d
- [x] 3.6 Rollback.sh polling loop matches deploy.sh pattern — 56e8f2d
- [x] 3.7 Deploy job works end-to-end on push to main — 56e8f2d

### Phase 4: Basic E2E Tests (Playwright)

#### Automated

- [x] 4.1 Playwright installs successfully — 733a52a
- [x] 4.2 E2E tests pass locally — 733a52a
- [x] 4.3 No lint errors in test files — 733a52a
- [x] 4.4 Existing tests unaffected — 733a52a

#### Manual

- [x] 4.5 Auth cookie round-trip demonstrates full login lifecycle — 733a52a
- [x] 4.6 Cookie attribute assertions match production expectations — 733a52a
- [x] 4.7 Tests follow E2E best practices (no waitForTimeout, accessible locators) — 733a52a
