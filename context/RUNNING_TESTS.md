# Running Tests

## Prerequisites

- Docker installed and running
- `uv sync` completed (installs dev dependencies including pytest, pytest-asyncio)

## Start the test database

```bash
docker run -d --name mevo-test-db -p 5433:5432 -e POSTGRES_PASSWORD=test postgres:16
```

This starts a blank Postgres 16 instance on port 5433. Tests create the schema automatically via Alembic migrations.

## Set environment variables

```bash
export MEVO_TEST_DATABASE_URL="postgresql://postgres:test@localhost:5433/postgres"
export MEVO_JWT_SECRET="test-secret-for-local-testing-only"
```

## Run tests

```bash
# All tests
uv run pytest -v

# Only integration tests (require test DB)
uv run pytest -m integration -v

# Phase 2: Aggregation math tests
uv run pytest tests/test_aggregation.py -v

# Phase 3: Collector integration tests
uv run pytest tests/test_collector_integration.py -v

# Phase 4: GBFS contract tests (no DB required)
uv run pytest tests/test_gbfs_contract.py -v

# Phase 5: Station API tests (require test DB)
uv run pytest tests/test_stations_api.py -v

# Phase 6: Auth tests (require test DB)
uv run pytest tests/test_auth.py -v

# Phase 7: Geocode tests (require test DB)
uv run pytest tests/test_geocode.py -v

# Phase 8: Smoke tests (run against a live server, no test DB needed)
# Default: http://localhost:8000 — override with MEVO_SMOKE_BASE_URL
uv run pytest tests/test_smoke.py -m smoke -v
# Against production (via SSH tunnel):
# ssh -f -N -L 20312:localhost:20312 mikrus
# MEVO_SMOKE_BASE_URL="http://localhost:20312" uv run pytest tests/test_smoke.py -m smoke -v

# Phase 9: Retention & monitoring tests (no DB required — fully mocked)
uv run pytest tests/test_retention.py -v
uv run pytest tests/test_monitoring.py -v

# Type checking
uv run mypy tests/test_aggregation.py tests/test_collector_integration.py tests/test_gbfs_contract.py tests/test_stations_api.py tests/test_auth.py tests/test_geocode.py tests/test_smoke.py tests/test_retention.py tests/test_monitoring.py
```

Without `MEVO_TEST_DATABASE_URL`, integration tests skip gracefully.

## E2E tests (Playwright, real browser)

Requires the backend (`uv run uvicorn app.main:app`) and frontend (`npm run dev --prefix frontend`) to be running, or Playwright will start them automatically via the `webServer` config.

```bash
# All E2E tests (Playwright starts servers automatically if not running)
npx playwright test

# With visible browser
npx playwright test --headed

# Auth cookie round-trip tests only (issue #24 guard)
npx playwright test e2e/auth-session.spec.ts

# Station page tests only
npx playwright test e2e/stations.spec.ts

# Against production (use for diagnosing issue #24)
E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts

# Open Playwright UI (interactive test runner)
npx playwright test --ui
```

The `station detail page loads from popular stations list` test skips when no station data exists in the local dev DB — this is expected.

## Frontend tests

Frontend tests use Vitest + @testing-library/react with jsdom. No database or backend required.

```bash
# Prerequisites: install frontend dependencies
cd frontend && npm install

# All frontend tests
cd frontend && npm test

# Single test file
cd frontend && npx vitest run src/components/AvailabilityHeatmap.test.tsx

# Watch mode (re-runs on file changes)
cd frontend && npm run test:watch

# TypeScript check (includes test files)
cd frontend && npx tsc -b
```

## Pre-commit hooks

```bash
# Install pre-commit hooks (one-time after clone)
uv run pre-commit install

# Run all pre-commit hooks manually (useful before pushing)
uv run pre-commit run --all-files
```

## Full CI gate sequence (local verification)

Run these in order to replicate what CI checks on every push:

```bash
# Backend gates
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run pytest -v

# Frontend gates
cd frontend && npm run lint
cd frontend && npm run typecheck
cd frontend && npm test
cd frontend && npm run build
```

## Smoke tests

```bash
# Against local dev server (default: http://localhost:8000)
uv run pytest tests/test_smoke.py -m smoke -v

# Against production
MEVO_SMOKE_BASE_URL="https://dailymevo.pl" uv run pytest tests/test_smoke.py -m smoke -v
```

## Stop the test database

```bash
docker stop mevo-test-db
docker rm mevo-test-db
```

## How test data works

The test DB starts empty. Tests seed their own data:
1. Session fixture runs `alembic upgrade head` → creates tables
2. Each test inserts specific data via `insert_test_snapshots()` (in `conftest.py`)
3. After each test, `clean_tables` fixture truncates all tables
4. Session teardown runs `alembic downgrade base` → drops tables
