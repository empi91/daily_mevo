# API and Auth Integration Tests — Implementation Plan

## Overview

Integration tests for Phase 2 of the test plan rollout, covering risks #3 (station API returns incorrect/empty/stale data), #4 (auth flow breaks in production), and #7 (unvalidated user input). Includes migrating existing auth tests from SQLAlchemy `create_all` to the Alembic-migrated test DB, adding a post-deploy smoke test, and filling in the test-plan cookbook.

## Current State Analysis

The test infrastructure from Phase 1 provides a solid foundation:
- `tests/conftest.py` has a session-scoped `db_pool` fixture that runs Alembic migrations on a test Postgres (port 5433), a `clean_tables` autouse fixture for integration-marked tests, and an `insert_test_snapshots()` helper for seeding station/snapshot data
- `tests/test_auth.py` has 11 passing auth tests using `ASGITransport(app=app)` + `httpx.AsyncClient`, but with a self-managed SQLAlchemy engine (`create_all`) instead of Alembic migrations — meaning it won't catch schema/migration mismatches that cause 500s in production
- No station endpoint tests exist
- No geocode/input-validation tests exist
- HTTP mocking uses `httpx.MockTransport` pattern (no external mock library)

### Key Discoveries:

- `app/auth/db.py:10-14` creates a module-level SQLAlchemy `engine` from `settings.database_url` at import time — tests must replace this engine to point auth at the test DB
- `app/main.py:28-34` lifespan creates `app.state.db_pool` from `settings.database_url` — with `settings.collector_enabled = False`, the lifespan skips the scheduler and only creates the pool
- `app/api/stations.py:21-28` reliability label is computed from `settings.min_sample_count`, `settings.reliability_threshold_reliable`, `settings.reliability_threshold_uncertain` — tests use actual settings defaults
- `app/api/geocode.py:10-13` has a module-level `_http_client` singleton — tests must mock this or its transport to avoid hitting real Nominatim
- `alembic/versions/005_create_users.py` exists — Alembic already manages the users table, so the Alembic-migrated test DB has the correct schema
- All SQL queries use asyncpg `$N` parameterized placeholders — no SQL injection risk, but adversarial inputs can still cause unexpected behavior (very long strings, Unicode edge cases)

## Desired End State

After this plan completes:
1. Station endpoint tests prove that `/stations`, `/stations/{id}`, and `/stations/nearby` return correct data, correct reliability labels at threshold boundaries, and correct haversine distances — all against an Alembic-migrated test DB populated via the real app lifespan
2. Auth tests run against the Alembic-migrated test DB (not `create_all`), catching migration mismatches. New tests cover cookie persistence, expired JWT, and CORS preflight
3. Adversarial input tests prove the geocode proxy and station_id path parameter handle malicious/malformed input without 500s
4. A smoke test script (marked `@pytest.mark.smoke`) can run against any BASE_URL (local or production) to catch env/infra 500s after deploy
5. Test-plan cookbook §6.2 and §6.5 are filled in with patterns from this phase

**Verification:** `uv run pytest tests/test_stations_api.py tests/test_geocode.py tests/test_auth.py tests/test_smoke.py -v` passes with `MEVO_TEST_DATABASE_URL` set.

## What We're NOT Doing

- **Post-deploy CI integration** — the smoke test script exists but wiring it into CI (e.g., post-deploy GitHub Action) is Phase 4's job
- **Rate limiting on geocode** — identified as a gap but is a code change, not a test concern
- **Browser-level CORS testing** — TestClient can test preflight headers but not real browser CORS enforcement; that requires Playwright (Phase 3 or later)
- **Load/performance testing** — out of scope for integration tests
- **Debugging the current production 500** — tests will prevent recurrence; root-cause investigation is separate

## Implementation Approach

All endpoint tests use the same pattern: `httpx.AsyncClient` with `ASGITransport(app=app)`, running the real FastAPI lifespan with `settings.database_url` pointed at the test DB and `settings.collector_enabled = False`. This means the app's actual pool creation, middleware, and routing are exercised — no mocking of internal plumbing.

Auth tests are migrated from SQLAlchemy `create_all` to the same Alembic-migrated test DB, so they catch the exact class of failure (schema mismatch) that causes 500s in production.

Geocode tests mock the external Nominatim dependency using `httpx.MockTransport` (existing project pattern from collector tests), keeping tests fast and deterministic.

## Critical Implementation Details

### Dual DB driver coordination

The app uses two DB drivers pointing at the same database: asyncpg pool (stations/collector) and SQLAlchemy async engine (auth/fastapi-users). Both are created from `settings.database_url`. In tests, both must point at the test DB. The asyncpg pool is created by the lifespan (runtime — monkeypatching `settings.database_url` before entering the ASGI client context is sufficient). The SQLAlchemy engine is created at module import time (`app/auth/db.py:10-14`) — the test fixture must replace `app.auth.db.engine` and `app.auth.db.async_session_maker` with instances pointing at the test URL. The conftest `db_pool` fixture's Alembic migrations must run before either driver connects, since both depend on the schema being present.

---

## Phase 1: Infrastructure + Station API Tests

### Overview

Build the shared ASGI test client fixture and write station endpoint data-correctness tests covering Risk #3.

### Changes Required:

#### 1. Shared ASGI client fixture

**File**: `tests/conftest.py`

**Intent**: Add a session-scoped fixture that creates an `httpx.AsyncClient` backed by `ASGITransport(app=app)`, with `settings.database_url` pointed at the test DB and `settings.collector_enabled` set to `False`. This fixture depends on `db_pool` (ensures Alembic migrations have run). It must also replace `app.auth.db.engine` and `app.auth.db.async_session_maker` so auth endpoints hit the test DB. The fixture yields the client and cleans up on teardown.

**Contract**: `api_client` fixture, session-scoped, yields `httpx.AsyncClient` with `base_url="http://test"`. Requires `MEVO_TEST_DATABASE_URL` (skips if absent). Restores original settings/engine on teardown.

#### 2. Station list endpoint test

**File**: `tests/test_stations_api.py`

**Intent**: Verify `GET /api/v1/stations` returns only active stations with correct fields. Seed two stations (one active, one inactive) via `insert_test_snapshots`, then assert the response contains exactly the active one with correct `station_id`, `name`, `lat`, `lon`, `capacity`.

**Contract**: `test_list_stations_returns_active_only` — integration-marked, uses `api_client` and `db_pool` fixtures.

#### 3. Station detail endpoint test

**File**: `tests/test_stations_api.py`

**Intent**: Verify `GET /api/v1/stations/{station_id}` returns the station with its availability data. Seed a station and insert availability rows in `station_availability` with known `avg_bikes`, `avg_ebikes`, `sample_count` values. Assert the response includes correct availability slots.

**Contract**: `test_get_station_returns_availability` — asserts `availability` list is non-empty with correct `day_of_week`, `time_slot`, `avg_bikes`, `avg_ebikes`, `sample_count` values.

#### 4. Reliability label boundary tests

**File**: `tests/test_stations_api.py`

**Intent**: Verify the reliability label computation at exact threshold boundaries using actual `settings` defaults. Seed availability rows with `sample_count` values at and below `settings.min_sample_count`, and `avg_bikes + avg_ebikes` values at exact boundary points for "reliable", "uncertain", and "empty" labels. Assert each slot returns the correct `reliability_label`.

**Contract**: `test_reliability_label_at_boundaries` — tests four boundary cases: `insufficient_data` (low sample_count), `reliable` (avg >= threshold_reliable), `uncertain` (avg >= threshold_uncertain but < reliable), `empty` (avg < threshold_uncertain). Uses `pytest.approx` for float comparisons.

#### 5. Station not found test

**File**: `tests/test_stations_api.py`

**Intent**: Verify `GET /api/v1/stations/nonexistent-id` returns 404.

**Contract**: `test_get_station_not_found` — asserts 404 status and `"Station not found"` detail.

#### 6. Nearby stations — haversine distance test

**File**: `tests/test_stations_api.py`

**Intent**: Seed two stations at known GPS coordinates. Query `/api/v1/stations/nearby` from a third known point. Assert `distance_m` for each station is within ±1m of an independently pre-computed haversine value. Use real Tricity coordinates for realism (e.g., Gdańsk Główny → two known Mevo station locations).

**Contract**: `test_nearby_stations_distance_correct` — asserts `distance_m` matches pre-computed values within tolerance. Pre-computed values must be documented in the test as comments with the source formula/calculator used.

#### 7. Nearby stations — sort order and limit test

**File**: `tests/test_stations_api.py`

**Intent**: Seed three stations at varying distances from a query point. Assert the response is sorted by `distance_m` ascending. Query with `limit=2` and assert only two stations returned.

**Contract**: `test_nearby_stations_sorted_and_limited` — asserts ordering and limit constraint.

#### 8. Empty availability test

**File**: `tests/test_stations_api.py`

**Intent**: Verify that a station with no availability data returns an empty `availability` list (not an error).

**Contract**: `test_get_station_empty_availability` — seed station with no availability rows, assert `availability == []`.

### Success Criteria:

#### Automated Verification:

- `uv run pytest tests/test_stations_api.py -v` passes with `MEVO_TEST_DATABASE_URL` set
- `uv run ruff check tests/test_stations_api.py` passes
- `uv run mypy tests/test_stations_api.py` passes (or no new errors)

#### Manual Verification:

- Review fixture wiring: confirm `api_client` uses the real lifespan (pool created by app, not injected manually)
- Review haversine expected values: verify the pre-computed distances match an independent source (e.g., online calculator or Python `math` module)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Auth Migration + Extensions

### Overview

Migrate existing auth tests from SQLAlchemy `create_all` to the Alembic-migrated test DB, then add tests for cookie persistence, expired JWT, and CORS preflight — covering Risk #4.

### Changes Required:

#### 1. Migrate test_auth.py to use shared infrastructure

**File**: `tests/test_auth.py`

**Intent**: Remove the `setup_db` fixture that creates its own SQLAlchemy engine with `Base.metadata.create_all`. Replace it with the `api_client` fixture from conftest.py. All existing tests should work unchanged with the new fixture — the `ASGITransport(app=app)` pattern is the same, only the DB setup changes. The `integration` marker must be added so `clean_tables` fires. The module-scoped `client` fixture is replaced by the session-scoped `api_client`.

**Contract**: All 11 existing tests pass with the new fixture. `pytestmark` includes both `pytest.mark.asyncio` and `pytest.mark.integration`. The `setup_db` fixture and its `create_engine` import are removed.

#### 2. Cookie persistence across requests test

**File**: `tests/test_auth.py`

**Intent**: Verify that a cookie obtained from login works across multiple sequential requests (simulating a user navigating between pages without re-authenticating). Register → login → hit `/users/me` → hit `/users/me` again with the same cookie → both return 200 with correct email.

**Contract**: `test_cookie_persists_across_requests` — two sequential `/users/me` calls with the same cookie both succeed.

#### 3. Expired JWT test

**File**: `tests/test_auth.py`

**Intent**: Verify that an expired or tampered JWT returns 401 on `/users/me`. Craft a JWT with a past expiration time (or tamper with a valid cookie string) and send it. Assert 401.

**Contract**: `test_expired_jwt_returns_401` — uses `PyJWT` or manual string manipulation to create an expired token. Does not require waiting for real expiration.

#### 4. CORS preflight test

**File**: `tests/test_auth.py`

**Intent**: Send an `OPTIONS` request to `/api/v1/auth/cookie/login` with `Origin: http://localhost:5173` and `Access-Control-Request-Method: POST` headers. Assert the response includes `Access-Control-Allow-Origin: http://localhost:5173` and `Access-Control-Allow-Credentials: true`.

**Contract**: `test_cors_preflight_allows_configured_origin` — verifies the CORS middleware responds correctly to preflight. Also test with an unconfigured origin and assert it is NOT reflected in `Access-Control-Allow-Origin`.

#### 5. Clean tables adjustment for auth

**File**: `tests/conftest.py`

**Intent**: The `clean_tables` fixture currently truncates `stations, snapshots, station_availability`. Auth tests need the `users` table cleaned between tests too. Add `users` to the TRUNCATE statement. Since auth tests now use the `integration` marker, the fixture fires for them automatically.

**Contract**: `TRUNCATE stations, snapshots, station_availability, users CASCADE` in `clean_tables`. The `agg_watermark` reset remains.

### Success Criteria:

#### Automated Verification:

- `uv run pytest tests/test_auth.py -v` passes with `MEVO_TEST_DATABASE_URL` set (all 11 original + 3 new tests)
- `uv run ruff check tests/test_auth.py` passes
- `uv run mypy tests/test_auth.py` passes (or no new errors)

#### Manual Verification:

- Confirm old auth tests still pass with the new fixture (no regressions from migration)
- Confirm expired JWT test actually tests an expired token (not just a malformed one)
- Confirm CORS test sends a real OPTIONS request, not just a GET with CORS headers

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Adversarial Input + Extras

### Overview

Adversarial input tests for geocode and station_id (Risk #7), health endpoint smoke test, and a post-deploy smoke script.

### Changes Required:

#### 1. Geocode mock transport fixture

**File**: `tests/conftest.py`

**Intent**: Add a fixture that monkeypatches the module-level `_http_client` in `app.api.geocode` with a client using `httpx.MockTransport`. The mock handler returns a canned Nominatim JSON response for known queries and an empty list for unknown ones. This follows the existing `MockTransport` pattern from `test_collector_integration.py`.

**Contract**: `mock_nominatim` fixture, function-scoped. Returns canned `[{"lat": "54.35", "lon": "18.65", "display_name": "Gdańsk, PL"}]` for any query that doesn't trigger an error. Handles `httpx.RequestError` simulation for error path tests.

#### 2. Geocode valid query test

**File**: `tests/test_geocode.py`

**Intent**: Verify `GET /api/v1/geocode?q=Gdansk` returns 200 with `lat`, `lon`, `display_name` fields populated from the mock.

**Contract**: `test_geocode_valid_query` — uses `api_client` + `mock_nominatim`. Asserts correct response model fields.

#### 3. Geocode adversarial input tests

**File**: `tests/test_geocode.py`

**Intent**: Parametrized test with adversarial inputs. Each input must return either a valid response or a 4xx error — never a 500. Inputs to test:
- Single character (should fail `min_length=2` → 422)
- SQL fragment: `"'; DROP TABLE stations; --"` 
- HTML/script: `"<script>alert('xss')</script>"`
- Very long string (2000 chars)
- Unicode edge cases: RTL override char `"‮"`, zero-width joiner `"‍"`, combining diacriticals
- Null bytes: `"test\x00query"`
- Empty-after-strip whitespace: `"   "` (3 spaces, length ≥ 2 but semantically empty)

**Contract**: `test_geocode_adversarial_input` — `@pytest.mark.parametrize` over input cases. Asserts `response.status_code != 500` for each. For single-char, asserts 422 specifically.

#### 4. Geocode service error test

**File**: `tests/test_geocode.py`

**Intent**: Verify that when Nominatim returns a 5xx error, the geocode endpoint returns 502 (not 500). Mock transport raises `httpx.HTTPStatusError`.

**Contract**: `test_geocode_service_error_returns_502` — asserts 502 status and `"Geocoding service error"` detail.

#### 5. Station ID adversarial tests

**File**: `tests/test_stations_api.py`

**Intent**: Verify station_id path parameter handles adversarial values without 500. Test with: very long string (1000 chars), SQL fragment, HTML/script tags, Unicode. All should return 404 (station not found, parameterized query is safe).

**Contract**: `test_station_id_adversarial_input` — `@pytest.mark.parametrize`. Asserts 404 for all cases (not 500).

#### 6. Nearby endpoint validation tests

**File**: `tests/test_stations_api.py`

**Intent**: Verify FastAPI parameter validation rejects invalid inputs to `/stations/nearby`: non-numeric `lat`/`lon` → 422, `limit=0` → 422, `limit=21` → 422.

**Contract**: `test_nearby_rejects_invalid_params` — parametrized over invalid param combinations, asserts 422.

#### 7. Health endpoint smoke test

**File**: `tests/test_stations_api.py`

**Intent**: Verify `GET /health` returns 200 with expected top-level keys (`status`, `version`, `database`, `collector`, `data_freshness`).

**Contract**: `test_health_returns_ok` — uses `api_client`. Asserts 200 and key presence.

#### 8. Post-deploy smoke test script

**File**: `tests/test_smoke.py`

**Intent**: A standalone test file marked `@pytest.mark.smoke` that hits a configurable `BASE_URL` (default `http://localhost:8000`, overridable via `MEVO_SMOKE_BASE_URL` env var) and verifies critical endpoints don't return 500. Tests: `/health` returns 200, `POST /api/v1/auth/register` returns non-500 (400 for duplicate is fine), `GET /api/v1/stations` returns 200. Uses plain `httpx.AsyncClient` (no ASGITransport — hits real HTTP). Does NOT require `MEVO_TEST_DATABASE_URL`.

**Contract**: Three tests marked `@pytest.mark.smoke`, skipped by default in normal test runs. Run with `uv run pytest tests/test_smoke.py -m smoke -v`. Register test uses a unique timestamped email to avoid collisions.

### Success Criteria:

#### Automated Verification:

- `uv run pytest tests/test_geocode.py -v` passes with `MEVO_TEST_DATABASE_URL` set
- `uv run pytest tests/test_stations_api.py -v` passes (all Phase 1 + Phase 3 tests)
- `uv run pytest tests/test_smoke.py -m smoke -v` passes against the local dev server
- `uv run ruff check tests/test_geocode.py tests/test_smoke.py` passes
- `uv run mypy tests/test_geocode.py tests/test_smoke.py` passes (or no new errors)
- No 500 status codes in any adversarial test

#### Manual Verification:

- Review adversarial inputs: confirm the parametrized set covers SQL, HTML, Unicode, and length edge cases
- Run smoke tests against the actual production URL to verify they catch the current 500

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Cookbook + Docs Update

### Overview

Fill in test-plan.md cookbook sections §6.2 and §6.5 with patterns from this phase, and update RUNNING_TESTS.md.

### Changes Required:

#### 1. Fill in §6.2 — Adding an integration test (backend API)

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the "TBD" placeholder in §6.2 with the endpoint test pattern established in this phase: location, naming convention, fixture usage (`api_client`, `db_pool`, `insert_test_snapshots`), marker (`integration`), mock transport pattern for external dependencies, and reference test.

**Contract**: §6.2 follows the same structure as §6.1 (Location, Naming, Marker, Pattern steps, Reference test, Run command).

#### 2. Fill in §6.5 — Adding a test for a new API endpoint

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the "TBD" placeholder in §6.5 with a concise recipe for adding tests for a new API endpoint: use `api_client`, seed data, assert response content (not just status codes), include adversarial input parametrized test.

**Contract**: §6.5 follows the same structure as other cookbook sections.

#### 3. Add Phase 2 notes to §6.6

**File**: `context/foundation/test-plan.md`

**Intent**: Add a "Phase 2 — API + auth integration" entry to §6.6 documenting key decisions: Alembic DB for auth tests, MockTransport for geocode, adversarial input pattern, smoke test marker. List files added.

**Contract**: Same format as the existing Phase 1 entry in §6.6.

#### 4. Update test plan §3 status

**File**: `context/foundation/test-plan.md`

**Intent**: Update Phase 2 row in the §3 rollout table: status → `complete`, change folder → `context/changes/testing-api-auth/`.

**Contract**: Single row update in the table.

#### 5. Update RUNNING_TESTS.md

**File**: `context/RUNNING_TESTS.md`

**Intent**: Add commands for running the new test files: `test_stations_api.py`, `test_geocode.py`, updated `test_auth.py`, and `test_smoke.py` with the smoke marker.

**Contract**: New entries following the existing format in RUNNING_TESTS.md.

### Success Criteria:

#### Automated Verification:

- `context/foundation/test-plan.md` §6.2 and §6.5 no longer contain "TBD"
- `context/foundation/test-plan.md` §3 Phase 2 status is `complete`
- `context/RUNNING_TESTS.md` includes all new test commands

#### Manual Verification:

- Review cookbook entries: verify the patterns match what was actually implemented in Phases 1-3
- Verify a developer unfamiliar with the project could add a new endpoint test by following §6.5

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None added — this phase is integration-focused by design (test plan §3 Phase 2)

### Integration Tests:

- Station endpoint data correctness (list, detail, nearby, reliability labels, haversine)
- Auth flow end-to-end on Alembic-migrated DB (register, login, me, logout, cookie persistence, expired JWT, CORS)
- Adversarial input handling (geocode, station_id, nearby params)
- Health endpoint structure

### Smoke Tests:

- Post-deploy smoke against configurable BASE_URL (health, register, stations)

### Manual Testing Steps:

1. Run `uv run pytest -m integration -v` and verify all pass
2. Start the local dev server, run `uv run pytest tests/test_smoke.py -m smoke -v` and verify all pass
3. Run smoke tests against the production URL to verify they catch the current 500 (expected: register test fails with 500 status — proving the test works)

## Performance Considerations

- Session-scoped `api_client` fixture: the lifespan runs once per test session, not per test. Pool creation and Alembic migrations happen once.
- `clean_tables` truncates between tests — fast (TRUNCATE, not DROP/CREATE).
- MockTransport for geocode: no network calls, sub-millisecond response times.
- Smoke tests hit real HTTP — add a timeout (5s per request) to prevent hanging.

## Migration Notes

- `tests/test_auth.py` is rewritten to use the shared `api_client` fixture. The `setup_db` fixture and its `create_async_engine` import are removed. If any downstream code depends on the auth test's `client` fixture, it must switch to `api_client`.
- The `clean_tables` fixture now truncates the `users` table too. This is safe because auth tests previously managed their own cleanup via `Base.metadata.drop_all`.
- Pytest config in `pyproject.toml` needs a new marker: `smoke` (in addition to existing `integration`).

## References

- Research: `context/changes/testing-api-auth/research.md`
- Phase 1 infrastructure: `tests/conftest.py` (fixtures), `tests/test_aggregation.py` (pattern reference)
- Test plan: `context/foundation/test-plan.md` §3 Phase 2, §6.2, §6.5
- Auth implementation: `app/auth/` (config.py:14-19 cookie transport, db.py:10-14 engine, manager.py:15-23 password validation)
- Station endpoints: `app/api/stations.py` (14-18 pool helper, 21-28 reliability labels, 42-68 haversine SQL)
- Geocode endpoint: `app/api/geocode.py` (10-13 http client singleton, 16-43 handler)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Infrastructure + Station API Tests

#### Automated

- [x] 1.1 `uv run pytest tests/test_stations_api.py -v` passes with MEVO_TEST_DATABASE_URL set — 7c55f12
- [x] 1.2 `uv run ruff check tests/test_stations_api.py` passes — 7c55f12
- [x] 1.3 `uv run mypy tests/test_stations_api.py` passes (or no new errors) — 7c55f12

#### Manual

- [x] 1.4 Review fixture wiring: confirm api_client uses the real lifespan — 7c55f12
- [x] 1.5 Review haversine expected values against independent source — 7c55f12

### Phase 2: Auth Migration + Extensions

#### Automated

- [x] 2.1 `uv run pytest tests/test_auth.py -v` passes with MEVO_TEST_DATABASE_URL (all 11 original + 3 new tests) — 97eec2d
- [x] 2.2 `uv run ruff check tests/test_auth.py` passes — 97eec2d
- [x] 2.3 `uv run mypy tests/test_auth.py` passes (or no new errors) — 97eec2d

#### Manual

- [x] 2.4 Confirm old auth tests pass with new fixture (no regressions) — 97eec2d
- [x] 2.5 Confirm expired JWT test uses an actually expired token — 97eec2d
- [x] 2.6 Confirm CORS test sends real OPTIONS request — 97eec2d

### Phase 3: Adversarial Input + Extras

#### Automated

- [x] 3.1 `uv run pytest tests/test_geocode.py -v` passes with MEVO_TEST_DATABASE_URL
- [x] 3.2 `uv run pytest tests/test_stations_api.py -v` passes (Phase 1 + Phase 3 tests)
- [x] 3.3 `uv run pytest tests/test_smoke.py -m smoke -v` passes against local dev server
- [x] 3.4 `uv run ruff check tests/test_geocode.py tests/test_smoke.py` passes
- [x] 3.5 `uv run mypy tests/test_geocode.py tests/test_smoke.py` passes (or no new errors)
- [x] 3.6 No 500 status codes in any adversarial test

#### Manual

- [x] 3.7 Review adversarial input set covers SQL, HTML, Unicode, length
- [x] 3.8 Run smoke tests against production URL to verify 500 detection — 0d82f38

### Phase 4: Cookbook + Docs Update

#### Automated

- [x] 4.1 test-plan.md §6.2 and §6.5 no longer contain "TBD"
- [x] 4.2 test-plan.md §3 Phase 2 status is `complete`
- [x] 4.3 RUNNING_TESTS.md includes all new test commands

#### Manual

- [x] 4.4 Cookbook patterns match actual implementation
- [x] 4.5 A developer could add an endpoint test by following §6.5
