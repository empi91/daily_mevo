---
date: "2026-06-19T11:51:10+0200"
researcher: Claude
git_commit: 691a2830836bbb3d8ae6bfa5669365efc02dfd56
branch: main
repository: daily_mevo
topic: "Quality gates — CI pipeline, pre-commit hooks, and auto-deploy (Phase 5 + F-03)"
tags: [research, codebase, ci, github-actions, pre-commit, deploy, quality-gates]
status: complete
last_updated: "2026-06-19"
last_updated_by: Claude
---

# Research: Quality Gates — CI Pipeline, Pre-commit Hooks, and Auto-Deploy

**Date**: 2026-06-19T11:51:10+0200
**Researcher**: Claude
**Git Commit**: 691a283
**Branch**: main
**Repository**: daily_mevo

## Research Question

What is the current state of quality-gate tooling (lint, typecheck, test, build), CI infrastructure, pre-commit hooks, and deploy automation? What gaps need to be filled for Phase 5 + F-03?

## Summary

The project has a mature test suite (22 test files, ~2600 LOC across backend + frontend) and all quality-gate commands exist locally, but **zero CI automation** and **zero pre-commit hooks** are configured. Deployment is fully manual via SSH. The research maps every existing gate command, identifies gaps, and documents the deploy mechanism so `/10x-plan` can produce a concrete implementation plan.

## Detailed Findings

### 1. Backend Quality Gates

#### 1.1 Ruff (lint + format)

- **Installed**: `ruff>=0.11` in `pyproject.toml:24`
- **Config**: No `[tool.ruff]` section — runs on 100% defaults (88-char line length, default rule set)
- **Commands**:
  - `uv run ruff check .` — lint
  - `uv run ruff format --check .` — format check
- **Current state**: Both commands work locally. No CI enforcement.

#### 1.2 Mypy (typecheck)

- **Installed**: `mypy>=1.15` in `pyproject.toml:25`
- **Config** (`pyproject.toml:30-36`):
  - `strict = false`
  - `warn_return_any = true`, `warn_unused_configs = true`
  - `ignore_missing_imports` for: `asyncpg`, `apscheduler.*`, `logfire`, `fastapi_users.*`, `fastapi_users_db_sqlalchemy`
- **Command**: `uv run mypy .`
- **Current state**: Works locally. Not strict. No CI enforcement.

#### 1.3 Pytest (unit + integration tests)

- **Installed**: `pytest>=8.0`, `pytest-asyncio>=0.26` in `pyproject.toml:22-23`
- **Config** (`pyproject.toml:39-47`):
  - `asyncio_mode = "auto"`
  - Markers: `integration` (needs `TEST_DATABASE_URL`), `smoke` (needs running server)
  - Suppresses `DeprecationWarning` from `asyncpg`
- **Test inventory** (13 files, ~1889 lines):

  | File | Lines | Category |
  |------|-------|----------|
  | `tests/conftest.py` | 270 | Fixtures |
  | `tests/test_aggregation.py` | 298 | Integration |
  | `tests/test_auth.py` | 200 | Integration |
  | `tests/test_collector_integration.py` | 337 | Integration |
  | `tests/test_collector.py` | 46 | Unit |
  | `tests/test_gbfs_client.py` | 77 | Unit |
  | `tests/test_gbfs_contract.py` | 85 | Unit (contract) |
  | `tests/test_geocode.py` | 70 | Integration |
  | `tests/test_monitoring.py` | 90 | Integration |
  | `tests/test_retention.py` | 126 | Integration |
  | `tests/test_smoke.py` | 37 | Smoke |
  | `tests/test_stations_api.py` | 253 | Integration |

- **DB requirement**: Integration tests need `MEVO_TEST_DATABASE_URL` pointing to a Postgres 16 instance. `conftest.py` runs Alembic migrations at session start, truncates tables between tests.
- **Safety guard** (`conftest.py:113-125`): Refuses to run against non-localhost unless DSN contains "test".

#### 1.4 Alembic (migrations)

- **Config**: `alembic.ini` + `alembic/env.py`
- **Env var**: `MEVO_DATABASE_URL` (overrides `alembic.ini` default)
- **Tests integration**: `conftest.py` temporarily sets `MEVO_DATABASE_URL` to the test URL, runs `alembic upgrade head` at session start.

#### 1.5 Missing backend tooling

- No `pre-commit` in dev dependencies
- No `pytest-cov` / coverage configuration
- No security scanning (`bandit`, `pip-audit`)
- No `[tool.ruff]` custom configuration
- Mypy not in strict mode

### 2. Frontend Quality Gates

#### 2.1 ESLint (lint)

- **Installed**: `eslint ^10.3.0` + `typescript-eslint ^8.59.2`, `eslint-plugin-react-hooks ^7.1.1`, `eslint-plugin-react-refresh ^0.5.2` in `frontend/package.json:23-29`
- **Config** (`frontend/eslint.config.js`): Flat config format (ESLint v10). Extends `js.configs.recommended`, `tseslint.configs.recommended`, `reactHooks.configs.flat.recommended`, `reactRefresh.configs.vite`. Zero custom rules.
- **Command**: `cd frontend && npm run lint` (runs `eslint .`)
- **Current state**: Works locally. No CI enforcement.

#### 2.2 TypeScript (typecheck)

- **Installed**: `typescript ~6.0.2` in `frontend/package.json:37`
- **Config**: Three tsconfig files via project references:
  - `tsconfig.app.json` — app code, target ES2023, `noUnusedLocals`, `noUnusedParameters`, **no `strict: true`**
  - `tsconfig.node.json` — build tooling (vite.config.ts)
  - `tsconfig.test.json` — test files, types: `vitest/globals`, `@testing-library/jest-dom`
- **Command**: `cd frontend && npm run typecheck` (runs `tsc -b`)
- **Note**: `strict: true` is absent from all tsconfigs — `strictNullChecks`, `noImplicitAny`, etc. are all OFF.

#### 2.3 Vitest (component tests)

- **Installed**: `vitest ^4.1.9`, `@testing-library/react ^16.3.2`, `jsdom ^29.1.1` in `frontend/package.json:30-35`
- **Config** (`frontend/vitest.config.ts`): jsdom environment, globals enabled, setup file imports `@testing-library/jest-dom/vitest`, CSS processing enabled.
- **Test inventory** (11 files, 710 lines):

  | File | Lines |
  |------|-------|
  | `StationSearch.test.tsx` | 128 |
  | `StationDetailPage.test.tsx` | 103 |
  | `AvailabilityHeatmap.test.tsx` | 89 |
  | `RegisterPage.test.tsx` | 81 |
  | `DayPartDetail.test.tsx` | 73 |
  | `LoginPage.test.tsx` | 67 |
  | `PopularStations.test.tsx` | 55 |
  | `Layout.test.tsx` | 46 |
  | `HomePage.test.tsx` | 38 |
  | `DayOfWeekTabs.test.tsx` | 23 |
  | `EmptyState.test.tsx` | 7 |

- **Command**: `cd frontend && npm test` (runs `vitest run`)

#### 2.4 Vite Build

- **Config** (`frontend/vite.config.ts`): React + Tailwind plugins, dev proxy `/api` → `localhost:8000`.
- **Command**: `cd frontend && npm run build` (runs `tsc -b && vite build` — typecheck is a build gate)
- **Already validated in Docker**: The Dockerfile frontend-builder stage runs `npm ci && npm run build`.

#### 2.5 Missing frontend tooling

- No Prettier (no formatter)
- No `strict: true` in TypeScript
- No test coverage configuration
- No CI enforcement

### 3. Deploy Mechanism

#### 3.1 Current flow (fully manual)

1. Developer runs `./deploy.sh` from local machine
2. Script SSHs to Mikr.us VPS (`mikrus` SSH alias → `root@srv66.mikr.us:10312`)
3. Server-side: `git pull` → `docker compose build` → `docker compose up -d`
4. Health check polls `http://localhost:20312/health` up to 18 times × 5s = 90s
5. Previous image tagged `:prev` for rollback (`./rollback.sh`)

#### 3.2 deploy.sh (`deploy.sh`)

- Tags current image as `:prev` (line 10)
- `git pull` (line 13), `docker compose build` (line 16), `docker compose up -d` (line 19)
- Health check loop: polls for `"status":"ok"` in response (lines 22-38)
- SSH alias `mikrus` configured per `context/deployment/deploy-plan.md:176-182`

#### 3.3 rollback.sh (`rollback.sh`)

- Stops current container, retags `:prev` as `:latest`, restarts
- Same health check pattern on port 20312

#### 3.4 Dockerfile (3-stage multi-stage build)

- Stage 1: `python:3.12-slim` + `uv` — `uv sync --frozen --no-dev`
- Stage 2: `node:20-slim` — `npm ci` + `npm run build`
- Stage 3: `python:3.12-slim` runtime — copies `.venv`, `frontend/dist`, `app/`, `alembic/`, `scripts/entrypoint.sh`. Non-root `mevo` user.

#### 3.5 docker-compose.yml

- Port: `${MIKRUS_APP_PORT:-20000}:8000`
- Memory: 768MB (hard limit + swap limit)
- Logging: json-file, 10MB × 3 files
- Healthcheck: Python urllib → `http://localhost:8000/health` every 30s

#### 3.6 entrypoint.sh (`scripts/entrypoint.sh`)

- `alembic upgrade head` then `exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log`

#### 3.7 Health endpoint (`app/main.py:214-313`)

Returns comprehensive status: DB connectivity, collector status, data freshness, retention config, DB size. Both `deploy.sh` and docker-compose healthcheck use it.

#### 3.8 Environment variables

All app vars use `MEVO_` prefix (`app/config.py`). Deploy vars: `MIKRUS_SERVER`, `MIKRUS_SSH_PORT`, `MIKRUS_APP_PORT`, `MIKRUS_API_KEY` (from `.env.example:25-29`).

#### 3.9 Mikr.us /exec API

Documented in `context/foundation/infrastructure.md:94-113`. POST to `https://api.mikr.us/exec` with API key. 60s timeout. **Not currently used** by deploy scripts — they use SSH exclusively. Could be an alternative for CI-triggered deploys without SSH key management.

### 4. Smoke Tests (already built)

`tests/test_smoke.py` (37 lines) with `@pytest.mark.smoke` marker:
- Uses `MEVO_SMOKE_BASE_URL` env var (configurable — local or production)
- Plain `httpx.AsyncClient` — hits real HTTP, no ASGI transport
- Ready to be wired into post-deploy CI step

### 5. CI Requirements from Test Plan §5

The test plan quality gates table (`test-plan.md:116-136`) specifies these required CI gates:

| Gate | Command | When required |
|------|---------|---------------|
| ruff check | `uv run ruff check .` | required (now) |
| ruff format --check | `uv run ruff format --check .` | required (now) |
| mypy | `uv run mypy .` | required (now) |
| eslint | `cd frontend && npm run lint` | required (now) |
| tsc | `cd frontend && npm run typecheck` | required (now) |
| pytest | `uv run pytest` | required (Phases 1-4 done) |
| vitest | `cd frontend && npm test` | required (Phase 3 done) |
| frontend build | `cd frontend && npm run build` | required after Phase 5 |
| pre-commit hooks | via pre-commit framework | required after Phase 5 |

### 6. GitHub Actions Requirements

For CI to run the full test suite:

1. **Postgres 16 service container** — integration tests need `MEVO_TEST_DATABASE_URL`
2. **Python 3.12 + uv** — backend dependencies
3. **Node.js 20** — frontend dependencies
4. **Secrets**: `MEVO_JWT_SECRET` (required for auth tests)
5. **Trigger**: push to main + PR to main (at minimum)
6. **For auto-deploy**: SSH key or Mikr.us API key in GitHub Secrets

## Code References

- `pyproject.toml:22-28` — Dev dependencies (pytest, ruff, mypy)
- `pyproject.toml:30-47` — mypy + pytest config
- `tests/conftest.py:92` — `MEVO_TEST_DATABASE_URL` env var read
- `tests/conftest.py:95-110` — Alembic migration helper for tests
- `tests/conftest.py:128-144` — `db_pool` session fixture
- `tests/conftest.py:161-200` — `api_client` session fixture
- `tests/test_smoke.py:1-37` — Smoke test suite (ready for post-deploy)
- `frontend/package.json:6-14` — All npm scripts
- `frontend/eslint.config.js:1-22` — ESLint flat config
- `frontend/vitest.config.ts:1-14` — Vitest configuration
- `frontend/tsconfig.app.json:1-26` — App TypeScript config (no strict)
- `deploy.sh:1-38` — SSH-based deploy script
- `rollback.sh:1-30` — Rollback script
- `Dockerfile:1-40` — Multi-stage Docker build
- `docker-compose.yml:1-25` — Production compose config
- `scripts/entrypoint.sh:1-4` — Container entrypoint
- `app/main.py:214-313` — Health endpoint
- `app/config.py:1-30` — Settings model (all env vars)
- `.env.example:25-29` — Mikr.us deploy vars

## Architecture Insights

1. **All gate commands already exist and work locally** — the gap is purely CI/CD automation and pre-commit enforcement.
2. **Postgres is required for the majority of the test suite** — 7 of 12 test files are integration tests. CI must provide a Postgres 16 service container.
3. **The build command is a two-gate pipeline** — `npm run build` runs `tsc -b && vite build`, so TypeScript errors already block builds (including Docker builds).
4. **Deploy is SSH-based, not API-based** — despite the Mikr.us `/exec` API being available (60s timeout), all deploy/rollback scripts use SSH. For CI auto-deploy, the choice is: (a) store an SSH key in GitHub Secrets, or (b) switch to the `/exec` API with the API key.
5. **Smoke tests are pre-built but unwired** — `tests/test_smoke.py` exists with `@pytest.mark.smoke` and configurable `MEVO_SMOKE_BASE_URL`. Just needs a CI step post-deploy.
6. **768MB memory constraint on Mikr.us** — Docker build happens on the server (not in CI), so CI doesn't need to build the Docker image. CI's job is quality gates; deployment builds on the server.

## Historical Context (from prior changes)

- `context/archive/2026-06-16-testing-data-integrity/plan.md:46` — "Not adding CI configuration (Phase 4 of the test plan rollout)" — explicitly deferred
- `context/archive/2026-06-16-testing-api-auth/plan.md:38` — "Post-deploy CI integration — wiring smoke test into CI is Phase 4's job" — deferred
- `context/archive/2026-06-05-station-availability-page/plan.md:46` — "No CI/CD pipeline setup (F-03 — separate slice, parallel work)" — deferred
- `context/archive/2026-06-13-friendly-domain/plan.md:45` — "Setting up CI/CD for domain management" — out of scope
- `context/foundation/infrastructure.md:249-252` — "CI/CD pipeline setup (but /exec API and deploy script enable GitHub Actions integration)" — explicitly deferred to later
- `context/foundation/roadmap.md:92-103` — F-03 at `status: ready`, overdue since ~2026-06-09

## Discrepancies Found

1. **CLAUDE.md:19** says "Deployment target: Fly.io (placeholder)" — actual target is Mikr.us since `infrastructure.md` was written.
2. **tech-stack-v2.md:8** has `deployment_target: fly` — same stale placeholder.
3. **F-03 is overdue** — planned for ~2026-06-09, S-02 (user-auth) shipped 2026-06-13 without it.

### 7. Hooks Design Notes

Three hook layers are in scope. No hooks are currently configured (`.claude/settings.json` has no `hooks` key; no `.pre-commit-config.yaml` exists).

#### 7.1 Claude Code per-edit hook — linter

A Claude Code `PostToolUse` hook on the `Edit`/`Write` tools. After every file edit, run the appropriate linter:

- **Backend** (`.py` files): `uv run ruff check --fix $EDITED_FILE` — auto-fixes what it can, reports the rest. Fast (~200ms per file).
- **Frontend** (`.ts`/`.tsx` files): `cd frontend && npx eslint $EDITED_FILE` — reports issues. Also fast for single files.

Configured in `.claude/settings.json` under `hooks.PostToolUse`. The hook script needs to detect file extension and route to the right linter.

#### 7.2 Claude Code per-edit hook — type check

A second `PostToolUse` hook (or combined with the linter hook) that runs type checking after edits:

- **Backend** (`.py` files): `uv run mypy $EDITED_FILE` — single-file check. Mypy single-file mode is fast (~1-3s) when the daemon (`dmypy`) is not used, but may miss cross-file type errors. Alternative: `uv run mypy --follow-imports=silent $EDITED_FILE` to limit scope.
- **Frontend** (`.ts`/`.tsx` files): `cd frontend && npx tsc -b --noEmit` — TypeScript doesn't support single-file checking well (project references mode needs the full project). This runs in ~2-5s on this codebase.

**Trade-off**: Running full `tsc -b` or full `mypy .` on every edit may be too slow for the edit loop. Single-file mypy is fast but incomplete. The plan should decide the exact scope.

#### 7.3 Git pre-commit hook — ruff + related tests

A git pre-commit hook (via the `pre-commit` framework) that runs:

1. **Ruff lint + format** on staged files only — `pre-commit` handles file filtering natively via its `types: [python]` filter.
2. **Related tests** for staged files — custom script that maps staged source files to their test files and runs only those.

**Source-to-test mapping convention** (observed from the codebase):

| Source file pattern | Test file(s) |
|---|---|
| `app/aggregation.py` | `tests/test_aggregation.py` |
| `app/retention.py` | `tests/test_retention.py` |
| `app/monitoring.py` | `tests/test_monitoring.py` |
| `app/collector/*.py` | `tests/test_collector.py`, `tests/test_collector_integration.py`, `tests/test_gbfs_client.py`, `tests/test_gbfs_contract.py` |
| `app/api/stations.py` | `tests/test_stations_api.py` |
| `app/api/geocode.py` | `tests/test_geocode.py` |
| `app/auth/*.py` | `tests/test_auth.py` |
| `app/main.py`, `app/config.py`, `app/db.py` | `tests/test_smoke.py` (skip — smoke needs a running server) |
| `frontend/src/components/Foo.tsx` | `frontend/src/components/Foo.test.tsx` (co-located) |
| `frontend/src/pages/Bar.tsx` | `frontend/src/pages/Bar.test.tsx` (co-located) |
| `tests/test_*.py` (test file itself staged) | Run that test file directly |
| `tests/conftest.py` | Run all backend tests (shared fixtures) |
| `frontend/src/test/*` | Run all frontend tests (shared fixtures/helpers) |

**Implementation approach**: A shell script (`scripts/run-related-tests.sh`) that:
1. Receives staged file list from pre-commit
2. Builds a set of backend test files + a flag for frontend tests
3. Runs `uv run pytest <matched-test-files>` if any backend matches
4. Runs `cd frontend && npm test` if any frontend matches
5. Skips if no test files matched (pure config/docs change)

**Pre-commit framework config** (`.pre-commit-config.yaml`):
- `ruff` hooks from `astral-sh/ruff-pre-commit` (lint + format, fast, official)
- `local` hook for the related-tests script

**Dependencies needed**: `pre-commit` must be added to dev deps (`pyproject.toml`). Developers run `pre-commit install` once after clone.

**Integration test caveat**: Related tests include integration tests that need `MEVO_TEST_DATABASE_URL`. If the env var is absent, those tests skip gracefully (existing behavior in `conftest.py`). The pre-commit hook should document this: "Start the test DB for full coverage, or integration tests will be skipped."

## Open Questions

1. **Deploy trigger from CI**: SSH key in GitHub Secrets vs. Mikr.us `/exec` API? SSH is proven (deploy.sh uses it), `/exec` avoids key management but has a 60s timeout.
2. **Coverage threshold**: No coverage tooling exists. Should Phase 5 add `pytest-cov` with a minimum threshold, or defer to a later phase?
3. **Strict TypeScript / strict mypy**: Both are currently non-strict. Enabling is a separate effort — should it be in scope or out?
4. **CLAUDE.md update**: The Fly.io placeholder should be corrected to Mikr.us. In scope for this change?
5. **Per-edit type check scope**: Full project type check (`mypy .` / `tsc -b`) vs. single-file? Full is correct but slower; single-file is fast but may miss cross-file breakage.
