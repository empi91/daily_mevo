# Data Integrity Tests — Implementation Plan

## Overview

Add the first layer of automated tests for the MevoStats data pipeline, covering aggregation math correctness (Risk #2), collector-to-DB integration (Risk #1), and GBFS API contract validation (Risk #6). This is Phase 1 of the test plan rollout.

## Current State Analysis

- **3 test files exist** (`tests/test_auth.py`, `tests/test_collector.py`, `tests/test_gbfs_client.py`) — 356 LOC total
- **Zero tests** for aggregation math, watermark logic, DB integration for the collector, or GBFS contract shape
- `test_auth.py` establishes the async DB testing pattern (pytest-asyncio, module-scoped fixtures, create_all/drop_all)
- All aggregation logic lives in a single SQL statement (`app/aggregation.py:34-74`) using raw asyncpg — tests must hit a real database
- GBFS collector silently returns None on any parse failure (`app/collector/gbfs_client.py:27-29`) — contract tests catch schema drift before it causes silent data loss
- No pytest configuration in `pyproject.toml` (relies on defaults)

### Key Discoveries:

- Aggregation uses weighted average merge: `(old_avg * old_count + batch_avg * batch_count) / (old_count + batch_count)` — `app/aggregation.py:66-73`
- Watermark is a singleton row in `agg_watermark` table — `app/aggregation.py:11-18`
- Time-slot bucketing uses Warsaw timezone and 15-min intervals — `app/aggregation.py:38-40`
- GBFS client depends on 7 required fields across `StationInfo` and `StationStatus` models — `app/collector/models.py:4-27`
- `StationStatus.bikes_count` and `.ebikes_count` are computed properties filtering `vehicle_types_available` — `app/collector/models.py:30-39`
- Alembic `env.py` reads `MEVO_DATABASE_URL` env var — `alembic/env.py:13-16`

## Desired End State

After this plan is complete:

1. `uv run pytest tests/test_aggregation.py` passes 6 tests proving aggregation math is correct for all identified edge cases
2. `uv run pytest tests/test_collector_integration.py` passes tests proving snapshots persist to DB and station sync works correctly
3. `uv run pytest tests/test_gbfs_contract.py` passes tests proving recorded GBFS responses match our Pydantic models
4. All tests use a dedicated Docker Postgres via `TEST_DATABASE_URL`, never touching the main database
5. Tests skip gracefully with a clear message when `TEST_DATABASE_URL` is not set
6. Test plan §6.1, §6.3, and §6.6 are updated with cookbook patterns

Verification: `uv run pytest` with `TEST_DATABASE_URL` set runs all existing + new tests green.

## What We're NOT Doing

- Not testing the APScheduler configuration or timing (implementation mirror — not a data correctness test)
- Not testing the `/health` endpoint (Phase 2: API integration tests)
- Not adding aggregation staleness detection to `/health` (feature work, not testing)
- Not testing DST edge cases (documented in research as open question; negligible risk for initial coverage)
- Not writing a live GBFS API check (network-dependent; the recorded fixture covers the contract)
- Not modifying any production code — this is purely additive test infrastructure + test files
- Not adding CI configuration (Phase 4 of the test plan rollout)

## Implementation Approach

Tests are organized by risk area: one file per risk, each self-contained. A shared `conftest.py` provides the DB pool and migration fixtures. Aggregation tests seed known snapshot data, run the aggregation function, and assert results against independently computed expected values (no oracle problem — we compute expected averages by hand). The GBFS contract test validates a recorded real API response against our Pydantic models.

## Critical Implementation Details

**Alembic migration in tests**: The test fixture must run Alembic migrations against the test DB, not raw SQL. Since `alembic/env.py` reads `MEVO_DATABASE_URL`, the fixture needs to temporarily set this env var to `TEST_DATABASE_URL` before calling `alembic upgrade head`. Use `alembic.command.upgrade(alembic_cfg, "head")` programmatically rather than subprocess.

**asyncpg pool vs Settings**: The aggregation function takes `asyncpg.Pool` as its sole argument (`app/aggregation.py:9`). Test fixtures can create a pool directly from `TEST_DATABASE_URL` without instantiating the full app or Settings object.

---

## Phase 1: Test Infrastructure

### Overview

Set up the shared test infrastructure: Docker Postgres instructions, `TEST_DATABASE_URL` config, shared DB fixtures, pytest configuration, and recorded GBFS fixture files.

### Changes Required:

#### 1. Pytest configuration

**File**: `pyproject.toml`

**Intent**: Add `[tool.pytest.ini_options]` with asyncio_mode, test markers (`integration` for DB tests), and filterwarnings to silence known deprecation noise.

**Contract**: `asyncio_mode = "auto"`, markers list includes `integration: requires TEST_DATABASE_URL`.

#### 2. Test database URL setting

**File**: `app/config.py`

**Intent**: Add `test_database_url` field so tests can read it from the same Settings object.

**Contract**: `test_database_url: str | None = None` — optional, defaults to None. Env var: `MEVO_TEST_DATABASE_URL`.

#### 3. Shared DB fixtures

**File**: `tests/conftest.py`

**Intent**: Add session-scoped async fixtures that create an asyncpg pool against `TEST_DATABASE_URL`, run Alembic migrations (upgrade head) in setup, and downgrade + close pool in teardown. Also add a function-scoped fixture that truncates all data tables between tests (stations, snapshots, station_availability, agg_watermark) so each test starts with a clean slate.

**Contract**:
- `db_pool` fixture (session scope): creates pool, runs `alembic upgrade head`, yields pool, runs `alembic downgrade base`, closes pool. Skips with message if `TEST_DATABASE_URL` not set.
- `clean_tables` fixture (function scope, autouse for integration-marked tests): truncates data tables via `TRUNCATE ... CASCADE`, resets `agg_watermark` to `last_processed_id = 0`.
- Alembic config override: temporarily sets `MEVO_DATABASE_URL` env var to `TEST_DATABASE_URL` so `alembic/env.py` picks up the test database.

#### 4. Recorded GBFS fixture files

**Files**: `tests/fixtures/gbfs_station_information.json`, `tests/fixtures/gbfs_station_status.json`

**Intent**: Capture real GBFS API responses to use as contract test fixtures. These represent the "known good" shape from the real API.

**Contract**: Fetch once via curl from `https://gbfs.urbansharing.com/rowermevo.pl/station_information.json` and `station_status.json`. Store the full JSON response (not just the `data.stations` array — the full envelope). Trim to 3-5 stations for readability but keep all fields intact.

#### 5. Development setup documentation

**File**: `CLAUDE.md`

**Intent**: Add a "Testing" section with Docker Postgres setup instructions and the `TEST_DATABASE_URL` value.

**Contract**: Document the `docker run` command and the env var to set.

### Success Criteria:

#### Automated Verification:

- `uv run pytest --collect-only` shows existing tests still collected
- `uv run pytest tests/test_auth.py tests/test_collector.py tests/test_gbfs_client.py` — existing tests still pass
- `tests/fixtures/gbfs_station_information.json` and `tests/fixtures/gbfs_station_status.json` exist and contain valid JSON
- Type checking passes: `uv run mypy .`

#### Manual Verification:

- Docker test DB starts: `docker run -d --name mevo-test-db -p 5433:5432 -e POSTGRES_PASSWORD=test postgres:16`
- `TEST_DATABASE_URL` env var connects to the Docker DB
- A simple `uv run pytest -m integration --collect-only` shows 0 tests (no integration tests written yet) but doesn't error

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Aggregation Tests (Risk #2)

### Overview

Write unit/integration tests for the aggregation math in `test_aggregation.py`. Each test seeds known snapshot data into the test DB, runs `aggregate_availability()`, and asserts results against independently computed expected values.

### Changes Required:

#### 1. Aggregation test file

**File**: `tests/test_aggregation.py`

**Intent**: Create test file with 6 test functions covering all identified edge cases. All tests are marked `integration` and use the `db_pool` fixture.

**Contract**: Test functions and their expected behaviors:

- `test_aggregation_first_run_computes_simple_mean` — Insert multiple snapshots for one station across different timeslots. Run aggregation with watermark at 0. Assert `station_availability` rows contain correct `avg_bikes = sum/count`, `avg_ebikes = sum/count`, and `sample_count = count` per (station_id, day_of_week, time_slot). Use `pytest.approx` for float comparison.

- `test_aggregation_single_snapshot_exact_value` — Insert exactly 1 snapshot. Run aggregation. Assert avg equals the exact value and sample_count = 1.

- `test_aggregation_weighted_merge_correct` — Insert batch A of snapshots, run aggregation (creates initial rows). Insert batch B, run aggregation again (triggers ON CONFLICT merge). Assert final avg matches the independently computed weighted average: `(avg_a * count_a + avg_b * count_b) / (count_a + count_b)`. Assert sample_count = count_a + count_b.

- `test_aggregation_gap_leaves_old_slots_intact` — Insert snapshots for timeslot T1, run aggregation. Insert snapshots for timeslot T2 (simulating collection resuming after gap). Run aggregation. Assert T1 row is unchanged, T2 row is correct.

- `test_aggregation_double_run_is_idempotent` — Insert snapshots, run aggregation. Run aggregation again with no new snapshots. Assert return value is 0, and all `station_availability` rows are unchanged (same avg, same sample_count).

- `test_aggregation_skips_when_no_new_snapshots` — Start with empty DB (watermark at 0, no snapshots). Run aggregation. Assert return value is 0 and `station_availability` is empty.

#### 2. Helper: seed snapshot data

**File**: `tests/conftest.py` (extend)

**Intent**: Add a helper fixture or function that inserts a station + snapshots with known values into the test DB. Abstracts the boilerplate of inserting into `stations` then `snapshots` tables.

**Contract**: A callable `insert_test_snapshots(conn, station_id, snapshots_data)` where `snapshots_data` is a list of dicts with `bikes_available`, `ebikes_available`, `docks_available`, `collected_at`. Must insert the station row first (into `stations` table) if not already present. Returns the list of inserted snapshot IDs.

### Success Criteria:

#### Automated Verification:

- `uv run pytest tests/test_aggregation.py -v` — all 6 tests pass
- `uv run mypy tests/test_aggregation.py` — no type errors

#### Manual Verification:

- Review each test's expected values: confirm they match independent hand-calculation of the weighted average formula
- Confirm `pytest.approx` is used for float comparisons (not exact equality)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Collector Integration Tests (Risk #1)

### Overview

Write integration tests for the collector pipeline in `test_collector_integration.py`. Tests verify that `collect_snapshots()` persists correct data to the DB and that `sync_stations()` correctly upserts and deactivates stations.

### Changes Required:

#### 1. Collector integration test file

**File**: `tests/test_collector_integration.py`

**Intent**: Test the collector's database interactions end-to-end: station sync (upsert + deactivation) and snapshot collection (persistence + correct field mapping). Mock only the HTTP layer (GBFS API responses), let everything else hit the real DB.

**Contract**: Test functions:

- `test_sync_stations_inserts_new_stations` — Provide mock GBFS station_information response with 2 stations. Call `sync_stations(pool)`. Assert both stations exist in DB with correct fields (station_id, name, address, lat, lon, capacity, is_virtual, is_active=True).

- `test_sync_stations_updates_existing` — Insert a station, then sync with updated data (e.g., changed address). Assert the station row is updated, not duplicated.

- `test_sync_stations_deactivates_missing` — Insert 3 stations. Sync with response containing only 2. Assert the missing station has `is_active = FALSE`.

- `test_collect_snapshots_persists_to_db` — Insert active stations. Mock GBFS status response. Call `collect_snapshots(pool)`. Assert `snapshots` table contains rows with correct `station_id`, `bikes_available`, `ebikes_available`, `docks_available`, `is_installed`, `is_renting`, `is_returning`.

- `test_collect_snapshots_skips_inactive_stations` — Insert one active and one inactive station. Mock GBFS status response for both. Call `collect_snapshots(pool)`. Assert only the active station's snapshot is persisted.

**HTTP mocking approach**: Use `httpx.MockTransport` (same pattern as existing `test_gbfs_client.py`) to intercept the GBFS client's HTTP calls. Monkeypatch the transport on the gbfs_client module.

### Success Criteria:

#### Automated Verification:

- `uv run pytest tests/test_collector_integration.py -v` — all 5 tests pass
- `uv run mypy tests/test_collector_integration.py` — no type errors

#### Manual Verification:

- Confirm station deactivation test checks `is_active` column, not row deletion
- Confirm snapshot field mapping matches the production code path in `snapshot_collector.py:25-40`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: GBFS Contract Tests (Risk #6)

### Overview

Write contract tests in `test_gbfs_contract.py` that validate recorded GBFS API responses against the Pydantic models our collector depends on. These catch schema drift — if Mevo changes their API, these tests fail before the collector silently breaks.

### Changes Required:

#### 1. GBFS contract test file

**File**: `tests/test_gbfs_contract.py`

**Intent**: Load the recorded JSON fixture files and validate them against our Pydantic models. Assert that required fields exist, types are correct, and computed properties work.

**Contract**: Test functions:

- `test_station_info_fixture_parses_to_model` — Load `tests/fixtures/gbfs_station_information.json`, extract `data.stations`, validate each station dict with `StationInfo.model_validate()`. Assert no ValidationError raised. Assert all parsed stations have non-empty `station_id`, valid `lat`/`lon` ranges.

- `test_station_status_fixture_parses_to_model` — Load `tests/fixtures/gbfs_station_status.json`, extract `data.stations`, validate each with `StationStatus.model_validate()`. Assert no ValidationError raised.

- `test_vehicle_types_available_contains_bike_types` — From the parsed station_status fixture, assert at least one station has a `vehicle_types_available` entry with `vehicle_type_id` in `{"bike", "ebike"}`. This verifies the field our `bikes_count`/`ebikes_count` properties depend on.

- `test_station_status_computed_properties` — Parse fixture stations, verify `bikes_count` and `ebikes_count` computed properties return integers >= 0. Verify `bikes_count` matches the `count` from the `vehicle_types_available` entry with `vehicle_type_id == "bike"` (or falls back to `num_bikes_available`).

- `test_response_envelope_structure` — Load raw fixture JSON, assert it has `data` key containing `stations` key that is a list. This tests the envelope our `gbfs_client.py:25,39` depends on.

### Success Criteria:

#### Automated Verification:

- `uv run pytest tests/test_gbfs_contract.py -v` — all 5 tests pass
- No network calls made during tests (pure fixture-based)

#### Manual Verification:

- Verify fixture files contain real GBFS data (not hand-crafted)
- Spot-check one station in the fixture against the live API to confirm the fixture is recent

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Test Plan Cookbook Update

### Overview

Update `context/foundation/test-plan.md` §6 with cookbook patterns discovered during Phases 1-4, and mark Phase 1 in the §3 rollout table as complete.

### Changes Required:

#### 1. Update §6.1 — Adding a unit test (backend)

**File**: `context/foundation/test-plan.md`

**Intent**: Fill in the §6.1 placeholder with the pattern established by `test_aggregation.py`: how to write a data-correctness test with DB fixtures, seed data, and `pytest.approx` assertions.

**Contract**: Replace `TBD -- see S3 Phase 1` with a short recipe (location, naming convention, fixture usage, run command).

#### 2. Update §6.3 — Adding a contract test

**File**: `context/foundation/test-plan.md`

**Intent**: Fill in §6.3 with the pattern from `test_gbfs_contract.py`: how to add a contract test using recorded fixtures and Pydantic model validation.

**Contract**: Replace `TBD -- see S3 Phase 1` with the recipe.

#### 3. Update §6.6 — Per-rollout-phase notes

**File**: `context/foundation/test-plan.md`

**Intent**: Add Phase 1 completion notes with key decisions made (Docker Postgres, Alembic fixtures, recorded GBFS fixtures) and any lessons learned.

#### 4. Update §3 — Phase 1 status

**File**: `context/foundation/test-plan.md`

**Intent**: Update Phase 1 row status from `change opened` to `complete` and fill in the change folder path.

### Success Criteria:

#### Automated Verification:

- `test-plan.md` is valid markdown (no broken formatting)
- §6.1 and §6.3 no longer contain `TBD`

#### Manual Verification:

- Cookbook patterns are clear enough for a new contributor to follow
- §3 rollout table accurately reflects current state

**Implementation Note**: After completing this phase, the testing-data-integrity change is complete and can be archived.

---

## Testing Strategy

### Unit Tests (Phase 2):

- Aggregation math correctness with known fixture data
- All 5 edge cases: first run, single snapshot, weighted merge, gap, idempotency
- Expected values computed independently from code (no oracle problem)

### Integration Tests (Phases 2-3):

- Aggregation function against real PostgreSQL (asyncpg pool)
- Collector snapshot persistence and station sync against real PostgreSQL
- HTTP mocking only for GBFS API calls (httpx.MockTransport)

### Contract Tests (Phase 4):

- Recorded GBFS response validated against Pydantic models
- Response envelope structure verified
- Computed properties verified against raw fixture data

### Manual Testing Steps:

1. Start Docker test DB, set `TEST_DATABASE_URL`
2. Run full suite: `uv run pytest -v`
3. Verify no tests are silently skipped (check for "skipped" in output)
4. Stop Docker container, run again — confirm integration tests skip with clear message

## Performance Considerations

- Session-scoped DB pool avoids reconnection overhead between tests
- `TRUNCATE ... CASCADE` between tests is faster than drop/recreate
- Alembic migrations run once per session, not per test
- Fixture files are small (3-5 stations) — no performance concern

## References

- Research: `context/changes/testing-data-integrity/research.md`
- Test plan: `context/foundation/test-plan.md` (Phase 1 in §3)
- Aggregation code: `app/aggregation.py:9-90`
- GBFS client: `app/collector/gbfs_client.py`
- Collector models: `app/collector/models.py`
- Existing test pattern: `tests/test_auth.py:16-26` (DB fixture)
- Archived pipeline plan: `context/archive/2026-06-04-data-collection-pipeline/plan.md`
- Archived performance research: `context/archive/2026-06-11-data-pipeline-performance/research.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Test Infrastructure

#### Automated

- [x] 1.1 `uv run pytest --collect-only` shows existing tests still collected — 4275bad
- [x] 1.2 Existing tests still pass: `uv run pytest tests/test_auth.py tests/test_collector.py tests/test_gbfs_client.py` — 4275bad
- [x] 1.3 GBFS fixture files exist and contain valid JSON — 4275bad
- [x] 1.4 Type checking passes: `uv run mypy .` — 4275bad

#### Manual

- [x] 1.5 Docker test DB starts and TEST_DATABASE_URL connects — 4275bad
- [x] 1.6 `uv run pytest -m integration --collect-only` works without error — 4275bad

### Phase 2: Aggregation Tests (Risk #2)

#### Automated

- [x] 2.1 `uv run pytest tests/test_aggregation.py -v` — all 6 tests pass — b697e60
- [x] 2.2 `uv run mypy tests/test_aggregation.py` — no type errors — b697e60

#### Manual

- [x] 2.3 Expected values match independent hand-calculation — b697e60
- [x] 2.4 `pytest.approx` used for float comparisons — b697e60

### Phase 3: Collector Integration Tests (Risk #1)

#### Automated

- [x] 3.1 `uv run pytest tests/test_collector_integration.py -v` — all 5 tests pass — 7dd3bec
- [x] 3.2 `uv run mypy tests/test_collector_integration.py` — no type errors — 7dd3bec

#### Manual

- [x] 3.3 Deactivation test checks is_active column — 7dd3bec
- [x] 3.4 Snapshot field mapping matches production code path — 7dd3bec

### Phase 4: GBFS Contract Tests (Risk #6)

#### Automated

- [x] 4.1 `uv run pytest tests/test_gbfs_contract.py -v` — all 5 tests pass — acf8971
- [x] 4.2 No network calls made during contract tests — acf8971

#### Manual

- [x] 4.3 Fixture files contain real GBFS data — acf8971
- [x] 4.4 Spot-check fixture against live API — acf8971

### Phase 5: Test Plan Cookbook Update

#### Automated

- [x] 5.1 test-plan.md is valid markdown
- [x] 5.2 §6.1 and §6.3 no longer contain TBD

#### Manual

- [x] 5.3 Cookbook patterns are clear for new contributors
- [x] 5.4 §3 rollout table reflects current state
