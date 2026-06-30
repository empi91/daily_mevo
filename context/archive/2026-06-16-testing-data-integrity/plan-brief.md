# Data Integrity Tests — Plan Brief

> Full plan: `context/changes/testing-data-integrity/plan.md`
> Research: `context/changes/testing-data-integrity/research.md`

## What & Why

Add the first automated test coverage for MevoStats's data pipeline — aggregation math, collector persistence, and GBFS contract validation. These are the three highest-risk areas identified by the test plan (Risks #1, #2, #6): wrong averages mislead commuters, a dead collector leaves pages stale, and an undetected API change silently halts data collection.

## Starting Point

3 test files exist (356 LOC) covering auth endpoints, GBFS client parsing, and collector model logic. Zero tests for aggregation math, watermark logic, DB integration for the collector, or GBFS contract shape. No pytest configuration in pyproject.toml. No test database setup.

## Desired End State

`uv run pytest` runs 16+ new tests (6 aggregation, 5 collector integration, 5 contract) against a dedicated Docker Postgres, proving the numbers are correct, the pipeline persists data faithfully, and the GBFS API shape matches our models. Test plan §6 cookbook is filled in so future contributors know how to add tests.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|----------|--------|-------------------|--------|
| Test database | Docker Postgres on port 5433 via TEST_DATABASE_URL | Full isolation from main DB; no risk of polluting dev/Supabase data | Plan |
| Schema setup | Alembic migrations in fixtures | Tests the real schema — catches migration bugs too | Plan |
| GBFS contract fixture | Recorded real JSON response | Tests against actual API shape, not our assumptions (avoids circular validation) | Plan |
| Edge case coverage | All 5 aggregation scenarios | Complete coverage of every failure mode the research identified; each test is small | Plan |
| File organization | One file per risk area | Clear mapping to test plan risks, easy to run selectively | Plan |
| Float comparison | pytest.approx | DOUBLE PRECISION weighted averages accumulate minor float drift | Research |

## Scope

**In scope:**
- Test infrastructure (Docker Postgres, Alembic fixtures, pytest config, GBFS fixture files)
- Aggregation math tests (6 functions covering all edge cases)
- Collector integration tests (5 functions: station sync + snapshot persistence)
- GBFS contract tests (5 functions: model validation + envelope structure)
- Test plan §6 cookbook updates

**Out of scope:**
- APScheduler timing tests (implementation mirror)
- `/health` endpoint tests (Phase 2 of test plan)
- DST timezone edge cases (negligible risk)
- CI pipeline configuration (Phase 4 of test plan)
- Any production code changes

## Architecture / Approach

All tests share a session-scoped asyncpg pool fixture pointing at Docker Postgres. Alembic migrations run once at session start. Each test gets clean tables via TRUNCATE between runs. Aggregation tests seed known data → run `aggregate_availability(pool)` → assert against hand-computed expected values. Collector tests mock HTTP (httpx.MockTransport) but hit the real DB. Contract tests validate recorded JSON fixtures against Pydantic models.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|-----------------|----------|
| 1. Test Infrastructure | Docker Postgres setup, shared fixtures, pytest config, GBFS fixture files | Alembic programmatic migration may need env var coordination |
| 2. Aggregation Tests | 6 tests proving math correctness for all edge cases | Getting expected values right (independent computation, not oracle) |
| 3. Collector Integration | 5 tests proving DB persistence and station sync | HTTP mocking must intercept at the right layer |
| 4. GBFS Contract | 5 tests validating API shape against our models | Fixture staleness (needs periodic manual refresh) |
| 5. Cookbook Update | Test plan §6 filled in, §3 marked complete | None — purely documentation |

**Prerequisites:** Docker installed and running; Supabase/main DB credentials not needed for tests
**Estimated effort:** ~2-3 sessions across 5 phases

## Open Risks & Assumptions

- Alembic migrations are assumed to be idempotent (upgrade/downgrade/upgrade works cleanly)
- GBFS fixture files will go stale over time — needs periodic manual refresh (test plan §8 tracks this)
- `test_auth.py` uses a different DB fixture pattern (SQLAlchemy create_all vs Alembic) — the two patterns coexist but should be unified in a future phase

## Success Criteria (Summary)

- `uv run pytest -v` with Docker Postgres running: all tests green, zero skipped
- Aggregation tests catch a deliberately introduced math bug (manual verification)
- GBFS contract test would fail if a required field were removed from the fixture (manual verification)
