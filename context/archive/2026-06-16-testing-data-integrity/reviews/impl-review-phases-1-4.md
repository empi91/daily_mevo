<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Data Integrity Tests

- **Plan**: context/changes/testing-data-integrity/plan.md
- **Scope**: Phases 1–4 of 5
- **Date**: 2026-06-16
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — No safeguard against accidental production teardown

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/conftest.py:126
- **Detail**: db_pool teardown runs `alembic downgrade base` which drops all tables. If MEVO_TEST_DATABASE_URL is accidentally set to a production database URL, this destroys all production data. The only safeguard is the env var name containing "TEST".
- **Fix**: Add an assertion in db_pool that the DSN points to localhost/127.0.0.1 or contains "test" in the database name.
  - Strength: Cheap one-liner that prevents catastrophic misconfiguration.
  - Tradeoff: Would need adjustment if tests ever run against a remote test DB (e.g., CI with cloud Postgres).
  - Confidence: HIGH — standard safety pattern for test fixtures.
  - Blind spot: None significant.
- **Decision**: FIXED — added _assert_safe_test_dsn() guard in conftest.py

### F2 — No connection timeout on test DB pool

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/conftest.py:121
- **Detail**: asyncpg.create_pool() is called without timeout constraints. If the test DB is unreachable, this hangs until TCP timeout (often 2+ minutes) with no clear error message.
- **Fix**: Add timeout=10 to the create_pool call.
- **Decision**: FIXED — added min_size=1, max_size=5, timeout=10 to create_pool

### F3 — Repeated httpx monkeypatch boilerplate

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/test_collector_integration.py (5 occurrences)
- **Detail**: The httpx.AsyncClient.__init__ monkeypatch is duplicated in all 5 test functions with identical boilerplate.
- **Fix**: Extract a shared pytest fixture that accepts a MockTransport and patches httpx.AsyncClient for the test.
- **Decision**: FIXED — extracted patch_httpx fixture, replaced 5 occurrences

### F4 — Env var mutation not parallel-safe

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: tests/conftest.py:93-108
- **Detail**: _run_alembic temporarily overwrites os.environ["MEVO_DATABASE_URL"]. Fine for sequential runs; would race under pytest-xdist.
- **Decision**: SKIPPED

### F5 — Three different asyncio loop_scope strategies

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: tests/test_aggregation.py:9, tests/test_auth.py, tests/test_gbfs_client.py
- **Detail**: Session-scoped loop for integration tests, module-scoped for auth, per-test for unit tests. Intentional but undocumented.
- **Decision**: PENDING

### F6 — Stricter assertion than plan in contract test

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Adherence
- **Location**: tests/test_gbfs_contract.py:test_vehicle_types_available_contains_bike_types
- **Detail**: Plan says "at least one station has vehicle_type_id in {bike, ebike}". Implementation asserts both "bike" AND "ebike" are present across all stations. Stricter — functionally better for catching drift.
- **Decision**: PENDING

### F7 — Bare dict return type with type: ignore

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: tests/test_gbfs_contract.py:14,20
- **Detail**: Bare `dict` with `# type: ignore` comments. Could use `dict[str, Any]` to avoid the suppression.
- **Decision**: PENDING
