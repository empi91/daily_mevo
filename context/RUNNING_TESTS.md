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

# Type checking
uv run mypy tests/test_aggregation.py tests/test_collector_integration.py tests/test_gbfs_contract.py
```

Without `MEVO_TEST_DATABASE_URL`, integration tests skip gracefully.

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
