---
date: 2026-06-19T12:00:00+02:00
researcher: Claude
git_commit: 295b202d2575eb6d04e3db3fd4d426b2bcd7abea
branch: main
repository: daily_mevo
topic: "Deployment parity testing — Docker build, cookie/CORS under prod env, smoke tests, API contract"
tags: [research, codebase, deployment, parity, cookies, cors, smoke-tests, docker, api-contract]
status: complete
last_updated: 2026-06-19
last_updated_by: Claude
---

# Research: Deployment Parity Testing

**Date**: 2026-06-19T12:00:00+02:00
**Researcher**: Claude
**Git Commit**: 295b202d2575eb6d04e3db3fd4d426b2bcd7abea
**Branch**: main
**Repository**: daily_mevo

## Research Question

What deployment-parity gaps exist between the local/test environment and production (`dailymevo.pl` on Mikr.us)? What does the current test and deploy infrastructure already cover, and what must Phase 6 add to prove the deployed artifact works end-to-end — covering Docker build, cookie/CORS behavior, smoke test scope, and frontend-backend API contract?

## Summary

Five deployment-parity gaps were identified in the 2026-06-18 test-plan refresh research. This research confirms all five remain open, quantifies the current smoke test coverage (3 endpoints, no CORS/cookie/auth-session testing), and maps the exact code locations where production config diverges from test defaults. The critical finding is that **the same-origin serving model** (frontend `dist` served by FastAPI's `StaticFiles`) likely sidesteps the worst cookie-domain mismatch, but the architecture still has no tests that verify cookie attributes, CORS headers, or authenticated flows against a deployed instance. The frontend-backend API contract is maintained manually in two places with no codegen or contract test — a latent drift risk.

## Detailed Findings

### 1. Docker Build & Deployment Infrastructure

**Dockerfile** (`Dockerfile`): Three-stage build — Python deps (stage 1, `python:3.12-slim` + `uv sync --frozen --no-dev`), frontend assets (stage 2, `node:20-slim` + `npm ci && npm run build`), runtime (stage 3, non-root `mevo` user). Entrypoint: `scripts/entrypoint.sh` which runs `alembic upgrade head` then `uvicorn app.main:app` on port 8000.

**docker-compose.yml**: Single `app` service. Port mapped via `${MIKRUS_APP_PORT:-20000}:8000`. Env loaded from `.env`. Memory limit 768m. Healthcheck: `curl http://localhost:8000/health` every 30s. No database service — production uses external Supabase.

**docker-compose.dev.yml**: Local Postgres only (`postgres:16-alpine`). No app service — dev runs outside Docker.

**deploy.sh**: Runs via SSH to `mikrus`. Tags current image as `:prev` for rollback, `git pull`, `docker compose build`, `docker compose up -d`, polls `localhost:20312/health` every 5s for 90s. Exits 1 on failure (suggests `./rollback.sh`).

**rollback.sh**: Restores `:prev` image tag, restarts container, verifies health.

**Gap — port mismatch**: `docker-compose.yml` defaults to port 20000 (line 5), but `deploy.sh` health-checks port 20312 (line 24). Production `.env` must set `MIKRUS_APP_PORT=20312`. No test validates this.

**Gap — no Docker build test in CI**: The CI workflow builds the frontend (`npm run build`) and runs backend tests, but never runs `docker compose build` or tests the Docker image. A broken Dockerfile or missing file in the COPY layer would only surface on deploy.

**Gap — deploy.sh has no automated rollback on smoke failure**: If smoke tests fail post-deploy in CI, the pipeline exits 1 but does not run `rollback.sh`. The `:prev` tag exists but is not used automatically.

### 2. Cookie / CORS / Auth Configuration

**CookieTransport** (`app/auth/config.py:14-19`):
```python
cookie_transport = CookieTransport(
    cookie_max_age=settings.jwt_lifetime_seconds,  # 2592000 (30 days)
    cookie_httponly=True,
    cookie_samesite="lax",
    cookie_secure=settings.environment != "development",
)
```

**Missing parameters**: No `cookie_name` (defaults to `fastapiusersauth`), no `cookie_domain` (defaults to `None` — browser scopes cookie to exact response host), no `cookie_path` (defaults to `/`).

**CORS** (`app/main.py:202-206`): `CORSMiddleware` with `allow_origins=settings.cors_origins`, `allow_credentials=True`. Default origins: `["http://localhost:5173"]` (`app/config.py:17`). Production must override via `MEVO_CORS_ORIGINS` env var.

**`.env.example:23`** documents the production override (commented out):
```
# MEVO_CORS_ORIGINS=["https://srv66-20312.wykr.es","https://dailymevo.pl","https://www.dailymevo.pl"]
```

**Same-origin serving mitigates cookie_domain gap**: The frontend `dist` is served by FastAPI via `StaticFiles` (`app/main.py:316-324`), meaning the browser sends requests to the same origin that served the page. With `cookie_domain=None`, the cookie is scoped to the response host, which matches. However, this relies on users accessing the app at the host where the API responds — if `dailymevo.pl` proxies to `srv66-20312.wykr.es` and the proxy doesn't set the correct `Host` header, the cookie domain mismatch breaks auth.

**Gap — no `cookie_domain` env var**: Even though same-origin serving likely works, there's no way to explicitly set `cookie_domain` via configuration if the deployment model changes.

**Gap — CORS default is localhost-only**: If `MEVO_CORS_ORIGINS` is missing from production `.env`, all cross-origin requests from the frontend are silently rejected.

**Gap — no tests verify cookie attributes**: No test checks that `Set-Cookie` headers contain the correct `HttpOnly`, `SameSite`, `Secure`, `Domain`, and `Path` attributes for the production environment.

**Gap — no tests verify CORS headers**: No smoke test sends an `Origin` header and checks `Access-Control-Allow-Origin` / `Access-Control-Allow-Credentials` response headers.

### 3. Existing Smoke Tests & CI Deploy Pipeline

**Smoke tests** (`tests/test_smoke.py`): 3 tests, all using `httpx.AsyncClient` against `MEVO_SMOKE_BASE_URL`:

| Test | Endpoint | Assertion |
|------|----------|-----------|
| `test_smoke_health` (line 33) | `GET /health` | status 200, `{"status": "ok"}` |
| `test_smoke_register` (line 40) | `POST /api/v1/auth/register` | status != 500 (accepts 400/409/422) |
| `test_smoke_stations` (line 49) | `GET /api/v1/stations` | status 200 |

**Skip guard** (line 22): autouse fixture hits `/health` synchronously; skips entire module if unreachable.

**CI deploy job** (`.github/workflows/ci.yml:85-134`):
1. SSH to Mikr.us, tag `:prev`, `git pull`, `docker compose build && up -d`
2. Health poll: `curl` loop, 18 × 5s = 90s timeout, checks for `"status":"ok"`
3. Smoke tests: `uv run pytest tests/test_smoke.py -v` with `MEVO_SMOKE_BASE_URL` from secrets

**Gap — no login/session smoke test**: No test exercises `POST /auth/cookie/login` or verifies that a session cookie enables access to protected routes (e.g., `GET /users/me`).

**Gap — register test is weak**: Accepts any non-500 status. A 422 (validation error) or 400 (bad request) passes silently, masking config issues.

**Gap — no CORS verification in smoke**: No test sends `Origin` header.

**Gap — no cookie attribute verification**: No test inspects `Set-Cookie` response headers.

**Gap — no automated rollback**: CI exits 1 on smoke failure but does not roll back.

### 4. Frontend-Backend API Contract

**Frontend API client** (`frontend/src/api/client.ts:1-52`): Uses native `fetch` with `credentials: 'include'` against `/api/v1` prefix (relative path, same-origin).

**Endpoints used by frontend** (`frontend/src/api/stations.ts`, `frontend/src/api/auth.ts`):

| Frontend call | Backend endpoint | TS type | Pydantic model |
|---------------|-----------------|---------|----------------|
| `fetchStations()` | `GET /stations` | `StationResponse[]` | `StationResponse` |
| `fetchStationDetail(id)` | `GET /stations/{id}` | `StationDetailResponse` | `StationDetailResponse` |
| `fetchNearbyStations(lat,lon,limit)` | `GET /stations/nearby` | `NearbyStationResponse[]` | `NearbyStationResponse` |
| `geocodeAddress(q)` | `GET /geocode` | `GeocodeResponse` | `GeocodeResponse` |
| `register(email,password)` | `POST /auth/register` | — | fastapi-users |
| `login(email,password)` | `POST /auth/cookie/login` | — | fastapi-users |
| `logout()` | `POST /auth/cookie/logout` | — | fastapi-users |
| `fetchCurrentUser()` | `GET /users/me` | — | fastapi-users |

**Type comparison** — all field names and types match between `app/api/models.py` and `frontend/src/api/stations.ts`. Minor notes:
- `NearbyStationResponse.distance_m` is `int` in Pydantic, `number` in TS — compatible.
- `avg_bikes`/`avg_ebikes` are `float` in Pydantic, `number` in TS — compatible, but Python's `NaN`/`Infinity` would break JSON serialization.

**Gap — no shared schema or codegen**: Types are manually maintained in both layers. Any model change in the backend requires a manual update in the frontend, with no automated contract test to catch drift.

**Gap — no contract test for API response shapes**: No test validates that backend responses match the TypeScript interfaces the frontend expects. Phase 2 integration tests assert response content but not against the TS type definitions.

### 5. PgBouncer / DB Connection Parity

**asyncpg pool** (`app/db.py:7`): `statement_cache_size=0` — correct for PgBouncer transaction mode.

**SQLAlchemy engine for auth** (`app/auth/db.py:14`): `connect_args={"statement_cache_size": 0}` — also correct.

**Alembic** (`alembic/env.py:13-16`): Reads `MEVO_DATABASE_URL`, strips `+asyncpg`, connects via SQLAlchemy. Uses `pool.NullPool` (line 38). Does **not** set `statement_cache_size=0` in connection args — minor inconsistency, but NullPool creates short-lived connections so practically safe.

**Entrypoint** (`scripts/entrypoint.sh`): Runs `alembic upgrade head` before starting the app. This ensures migrations run on deploy, but there is no verification that the resulting schema matches what the app expects.

**Gap — no migration-state verification at startup**: The app does not check that `alembic_version` matches the expected head revision. A deployment could run against an un-migrated or partially-migrated database.

**Gap — test DB is local Postgres, production is Supabase PgBouncer**: Tests connect directly to Postgres (port 5433) which supports prepared statements natively. The `statement_cache_size=0` workaround is set in the app code but never exercised in tests — a regression that removes this setting would pass all tests but fail in production.

**Gap — no `statement_cache_size` regression test**: No test asserts that `statement_cache_size=0` is configured in the pool creation calls.

## Code References

- `Dockerfile` — three-stage build, entrypoint at `scripts/entrypoint.sh`
- `docker-compose.yml` — single `app` service, port `${MIKRUS_APP_PORT:-20000}:8000`
- `deploy.sh` — SSH deploy with `:prev` tagging and 90s health poll
- `rollback.sh` — restores `:prev` image
- `app/auth/config.py:14-19` — CookieTransport config (no `cookie_domain`)
- `app/config.py:5,17,19` — `environment`, `cors_origins`, `jwt_secret` settings
- `app/main.py:202-206` — CORSMiddleware setup
- `app/main.py:316-324` — StaticFiles serving frontend `dist`
- `app/db.py:7` — `statement_cache_size=0` in asyncpg pool
- `app/auth/db.py:14` — `statement_cache_size=0` in SQLAlchemy engine
- `alembic/env.py:13-16,38` — DB URL loading and NullPool
- `scripts/entrypoint.sh` — `alembic upgrade head` then `uvicorn`
- `tests/test_smoke.py` — 3 smoke tests (health, register, stations)
- `.github/workflows/ci.yml:85-134` — deploy job with health poll + smoke tests
- `app/api/models.py:1-45` — Pydantic response models
- `frontend/src/api/stations.ts:3-45` — TypeScript interfaces (manual mirror)
- `frontend/src/api/client.ts:1-52` — fetch client with `credentials: 'include'`
- `.env.example` — production env var documentation

## Architecture Insights

1. **Same-origin serving is the key architectural decision that simplifies cookie/CORS**: Because FastAPI serves the frontend `dist` via `StaticFiles`, the browser's same-origin policy means cookies and CORS are not cross-origin concerns in the normal case. The `credentials: 'include'` in the fetch client works because requests go to `/api/v1/...` on the same origin. This makes `cookie_domain=None` (implicit) work correctly — but only if the reverse proxy (if any) preserves the `Host` header.

2. **The three historical production failures all share a root cause**: Tests used `ASGITransport` (in-process) with localhost defaults. None of the failures (PgBouncer, missing table, cookie persistence) could have been caught by in-process tests. Phase 6 must add tests that exercise the real HTTP transport stack against a deployed instance.

3. **Manual API contract maintenance is the latent risk**: With 6 response models manually mirrored between Python and TypeScript, any model change requires synchronized updates in both layers. A contract test that validates backend responses against a shared schema (or at minimum against the TS interface expectations) would catch drift before it reaches users.

4. **Docker build is untested in CI**: The CI workflow runs tests against source, but the actual Docker image is only built during deploy. A Dockerfile regression (missing COPY, wrong entrypoint, broken multi-stage) surfaces only after merge to main when the deploy job runs.

## Historical Context (from prior changes)

- `context/archive/2026-06-18-test-plan-refresh-2026-06-18/research.md` — identified the 5 production-vs-local gaps that motivate this phase: (1) cookie domain mismatch, (2) CORS origins defaulting to localhost, (3) PgBouncer `statement_cache_size` parity, (4) health-only deploy check, (5) no secure cookie verification. All 5 remain open.
- `context/archive/2026-06-16-testing-api-auth/research.md` — Phase 2 research. Established the `api_client` fixture and integration test patterns. CORS test exists but only against `localhost` origin.
- `context/archive/2026-06-19-db-storage-retention/research.md` — Phase 4 research. Retention/purge implementation. Deploy verification angle (Risk #8) needs to confirm purge runs in production.

## Related Research

- `context/archive/2026-06-18-test-plan-refresh-2026-06-18/research.md` — 5 production-vs-local gaps analysis
- `context/archive/2026-06-16-testing-api-auth/research.md` — Phase 2 API + auth test patterns
- `context/changes/testing-quality-gates/` — Phase 5 CI pipeline (deploy job wiring)

## Open Questions

1. **Reverse proxy configuration on Mikr.us**: Is there an nginx/Caddy/Traefik reverse proxy in front of the Docker container? Does it preserve `Host` headers? This affects whether `cookie_domain=None` works correctly on `dailymevo.pl`.

2. **Production `.env` contents**: Does the production `.env` set `MEVO_CORS_ORIGINS` and `MEVO_ENVIRONMENT=production`? The `.env.example` documents these but there's no way to verify remotely without SSH access.

3. **Automated rollback scope**: Should Phase 6 wire `rollback.sh` into the CI deploy job on smoke failure, or is manual rollback acceptable?

4. **Docker build in CI**: Should the CI workflow add a `docker compose build` step on every PR (to catch Dockerfile regressions early), or only test during deploy?

5. **API contract test approach**: Should we use a lightweight approach (backend test that validates response JSON against a schema derived from the TS interfaces) or a heavier codegen tool (e.g., openapi-typescript generating TS types from FastAPI's OpenAPI spec)?
