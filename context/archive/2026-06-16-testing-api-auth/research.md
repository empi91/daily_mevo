---
date: 2026-06-16T12:00:00+02:00
researcher: Claude
git_commit: 58f600dae27f0fbe69da76e47803ae60729b0617
branch: main
repository: daily_mevo
topic: "API and auth integration tests — Phase 2 research"
tags: [research, codebase, api, auth, input-validation, testing]
status: complete
last_updated: 2026-06-16
last_updated_by: Claude
---

# Research: API and Auth Integration Tests (Phase 2)

**Date**: 2026-06-16T12:00:00+02:00
**Researcher**: Claude
**Git Commit**: 58f600dae27f0fbe69da76e47803ae60729b0617
**Branch**: main
**Repository**: daily_mevo

## Research Question

Ground the Phase 2 test plan (risks #3, #4, #7) in actual codebase state: which endpoints exist, how auth works, how user input flows, and what test infrastructure from Phase 1 can be reused.

## Summary

The codebase has 5 station/geocode endpoints and 5 auth endpoints (via fastapi-users). All SQL queries use asyncpg parameterized placeholders — no SQL injection risk. The geocode endpoint passes user input directly to Nominatim with no rate limiting (main abuse vector). Auth uses cookie-based JWT with proper HttpOnly/SameSite/Secure flags. Existing auth tests (11 tests in `test_auth.py`) already cover the core register→login→me→logout flow but use a separate SQLAlchemy in-memory DB, not the asyncpg pool. Phase 2 needs: station endpoint data-correctness tests, adversarial input tests for geocode and station_id, and a decision on whether to extend the existing auth tests or build new ones on the asyncpg infrastructure.

## Detailed Findings

### Risk #3 — Station API Returns Incorrect/Empty/Stale Data

**Endpoints to test:**

| HTTP | Path | Handler | File:Line | Params | Response |
|------|------|---------|-----------|--------|----------|
| GET | /api/v1/stations | `list_stations()` | `app/api/stations.py:31` | none | `list[StationResponse]` |
| GET | /api/v1/stations/nearby | `nearby_stations()` | `app/api/stations.py:42` | `lat`, `lon`, `limit` (1-20) | `list[NearbyStationResponse]` |
| GET | /api/v1/stations/{station_id} | `get_station()` | `app/api/stations.py:71` | path: `station_id` | `StationDetailResponse` |

**Response models** defined in `app/api/models.py`:
- `StationResponse`: station_id, name, address, lat, lon, capacity
- `NearbyStationResponse`: adds `distance_m` (haversine, integer meters)
- `StationDetailResponse`: adds `availability: list[AvailabilitySlot]`
- `AvailabilitySlot`: day_of_week, time_slot, avg_bikes, avg_ebikes, sample_count, reliability_label

**Reliability labeling** (`app/api/stations.py:21-28`):
- `sample_count < min_sample_count` → "insufficient_data"
- `avg_bikes + avg_ebikes >= reliability_threshold_reliable` (default 6) → "reliable"
- `avg_bikes + avg_ebikes >= reliability_threshold_uncertain` (default 2) → "uncertain"
- else → "empty"

**What to prove:**
1. `/stations` returns only active stations (filters `is_active = TRUE`)
2. `/stations/{id}` returns correct availability data and correct reliability labels at threshold boundaries
3. `/stations/{id}` returns 404 for nonexistent station
4. `/stations/nearby` returns stations sorted by actual distance; haversine formula produces correct meters
5. `/stations/nearby` respects `limit` parameter
6. Empty availability table → all slots show "insufficient_data"

**DB query pattern:** All endpoints use `pool.acquire()` → `conn.fetch()` with `$N` placeholders. Pool obtained via `_get_pool(request)` helper (`app/api/stations.py:14-18`) which raises 503 if pool is None.

### Risk #4 — Auth Flow Breaks in Production

**Auth stack:**
- Library: fastapi-users v14+ with cookie transport + JWT strategy
- Files: `app/auth/__init__.py`, `config.py`, `models.py`, `manager.py`, `db.py`

**Endpoints (all under `/api/v1`):**

| HTTP | Path | Behavior |
|------|------|----------|
| POST | /auth/register | JSON body `{email, password}` → 201 + UserRead |
| POST | /auth/cookie/login | Form-encoded `username` + `password` → 204 + Set-Cookie |
| POST | /auth/cookie/logout | Requires cookie → 204 + clears cookie |
| GET | /users/me | Requires cookie → 200 + UserRead |
| PATCH | /users/{id} | Requires cookie → 200 + updated UserRead |

**Cookie configuration** (`app/auth/config.py:14-19`):
- `cookie_httponly = True`
- `cookie_samesite = "lax"`
- `cookie_secure = (environment != "development")`
- `cookie_max_age = jwt_lifetime_seconds` (default 30 days)

**CORS** (`app/main.py:149-155`):
- `allow_origins = settings.cors_origins` (default `["http://localhost:5173"]`)
- `allow_credentials = True`
- `allow_methods = ["*"]`, `allow_headers = ["*"]`

**Password policy** (`app/auth/manager.py:15-23`): minimum 8 characters, no complexity.

**Existing auth tests** (`tests/test_auth.py`, 11 tests):
- Uses `ASGITransport(app=app)` + `httpx.AsyncClient` — tests real ASGI app
- DB: SQLAlchemy async engine (in-memory or from `MEVO_DATABASE_URL`), NOT the asyncpg pool
- Scope: module-scoped with separate `setup_db` fixture
- Coverage: register, duplicate email, short password, login, wrong password, nonexistent email, /me with/without cookie, logout, /me after logout

**Gaps in existing tests:**
- No test for cookie persistence across multiple requests (simulated "refresh")
- No test for CORS preflight behavior
- No test for expired JWT
- No test for auth on non-auth endpoints (if any are protected)

**Decision point:** Extend `test_auth.py` with additional scenarios, or rewrite on asyncpg infrastructure? Current tests work and are passing — extending is likely cheaper.

### Risk #7 — Unvalidated User Input

**Geocode endpoint** (`app/api/geocode.py:16-43`):
- `q: str = Query(..., min_length=2)` — only constraint is min 2 chars
- User input passed directly to Nominatim: `params={"q": q, "format": "json", "limit": 1, "countrycodes": "pl"}`
- httpx handles URL encoding (safe from URL injection)
- No max length constraint on `q`
- No rate limiting
- Timeout: 5 seconds
- Error handling: 502 on service error, 404 on empty results

**Station ID path parameter** (`app/api/stations.py:71`):
- `station_id: str` — no length or pattern constraint
- Used in parameterized query `$1` — safe from SQL injection
- Arbitrarily long strings accepted (potential minor DoS via oversized queries)

**Nearby station params** (`app/api/stations.py:42-48`):
- `lat: float`, `lon: float` — type-enforced by FastAPI
- `limit: int = Query(5, ge=1, le=20)` — bounded
- All parameterized — safe

**SQL safety:**
- All API queries use asyncpg `$N` placeholders — no SQL injection possible
- One f-string in `app/aggregation.py:34` interpolates `LOCAL_TZ = "Europe/Warsaw"` (hardcoded constant) — safe but code smell
- No string concatenation with user input anywhere

**What to prove:**
1. Geocode rejects empty/single-char queries (min_length=2)
2. Geocode handles very long query strings gracefully
3. Geocode handles special characters (SQL fragments, HTML, Unicode) without error
4. Station ID with nonexistent value returns 404
5. Station ID with very long string doesn't crash
6. Nearby endpoint rejects non-numeric lat/lon (FastAPI validation)
7. Nearby endpoint rejects `limit` outside 1-20 range

### Existing Test Infrastructure (Phase 1)

**Fixtures in `tests/conftest.py`:**

| Fixture | Scope | Purpose |
|---------|-------|---------|
| `station_info_payload` | function | Hardcoded GBFS station_information (2 stations) |
| `station_status_payload` | function | Hardcoded GBFS station_status (2 stations) |
| `db_pool` | session | asyncpg pool with Alembic migrate up/down |
| `clean_tables` | session (autouse for `integration` marker) | TRUNCATE stations, snapshots, station_availability CASCADE; reset watermark |

**Helper:** `insert_test_snapshots(conn, station_id, snapshots_data)` — inserts station + snapshots, returns snapshot IDs.

**Recorded fixtures:** `tests/fixtures/gbfs_station_information.json`, `tests/fixtures/gbfs_station_status.json`

**Pytest config** (`pyproject.toml`): `asyncio_mode = "auto"`, marker `integration`.

**HTTP testing patterns used:**
1. `httpx.MockTransport` — unit tests (no network)
2. `monkeypatch` on `httpx.AsyncClient.__init__` — integration tests
3. `ASGITransport(app=app)` — auth tests (real ASGI dispatch)

**Key gap for Phase 2:** Auth tests use SQLAlchemy + ASGITransport, while station tests will need the asyncpg pool + seeded data. Phase 2 station endpoint tests need ASGITransport (to hit real FastAPI endpoints) but also need the asyncpg pool to be populated with test data. This requires ensuring `app.state.db_pool` is set during the test — the current auth test pattern overrides the DB engine but doesn't set the asyncpg pool.

## Code References

- `app/api/stations.py:14-18` — `_get_pool()` helper; raises 503 if pool is None
- `app/api/stations.py:21-28` — reliability label logic
- `app/api/stations.py:31-39` — `list_stations()` endpoint
- `app/api/stations.py:42-68` — `nearby_stations()` with haversine SQL
- `app/api/stations.py:71-107` — `get_station()` with availability join
- `app/api/geocode.py:10-13` — httpx client config (5s timeout, User-Agent)
- `app/api/geocode.py:16-43` — `geocode()` endpoint
- `app/api/models.py:1-45` — all Pydantic response models
- `app/auth/__init__.py:6-24` — auth router registration
- `app/auth/config.py:14-19` — cookie transport config
- `app/auth/config.py:40` — `current_active_user` dependency
- `app/auth/manager.py:15-23` — password validation
- `app/auth/db.py:1-28` — async engine, session, user DB
- `app/main.py:28-34` — lifespan (pool creation)
- `app/main.py:149-155` — CORS middleware
- `app/config.py:19-20` — JWT settings
- `app/db.py:4-10` — `create_pool()` (asyncpg, min=2, max=5)
- `tests/conftest.py:126-142` — `db_pool` fixture
- `tests/conftest.py:145-157` — `clean_tables` fixture
- `tests/conftest.py:159-205` — `insert_test_snapshots()` helper
- `tests/test_auth.py:10-33` — auth test setup (ASGITransport pattern)

## Architecture Insights

1. **Dual DB access pattern:** The app uses asyncpg pool for station/collector operations and SQLAlchemy async engine for auth (fastapi-users requirement). Both connect to the same PostgreSQL database but through different drivers. Tests must account for this — station endpoint tests need the asyncpg pool populated via `insert_test_snapshots()`, while auth tests use SQLAlchemy.

2. **ASGITransport for endpoint tests:** The auth tests already demonstrate the correct pattern — `httpx.AsyncClient(transport=ASGITransport(app=app))`. Phase 2 station tests should use the same approach but must additionally ensure `app.state.db_pool` points to the test database.

3. **No search endpoint exists:** Despite Risk #7 mentioning "station search," there is no search/filter endpoint. The `/stations` endpoint returns all active stations with no query parameter. The input validation risk concentrates on the geocode proxy and the station_id path parameter.

4. **Geocode is the main attack surface:** The only endpoint where user-controlled free text reaches an external service. httpx URL-encodes automatically, but there's no rate limiting, no max length, and no content filtering.

5. **Reliability label is a computed property:** Not stored in DB — derived in Python from `sample_count` and threshold settings. Tests should verify threshold boundary behavior with known data.

## Historical Context

- `context/changes/testing-data-integrity/` — Phase 1 (complete). Established the conftest.py infrastructure, TRUNCATE pattern, Alembic migration fixtures, and `insert_test_snapshots()` helper. Phase 2 should extend these, not duplicate.
- `context/archive/` — Contains user-auth and station-availability-page slices referenced in the risk map as evidence sources.

## Open Questions

1. **ASGITransport + asyncpg pool integration:** How to wire `app.state.db_pool` to the test database when using ASGITransport? The auth tests bypass this by using SQLAlchemy directly. Station endpoint tests need the pool. Options: (a) set `app.state.db_pool` in a fixture before creating the client, (b) use the app's lifespan with `MEVO_DATABASE_URL` pointed at test DB, (c) mock `_get_pool()`.
2. **Geocode mock strategy:** Should Phase 2 mock Nominatim (via `respx` or `MockTransport`) or hit it live? Mocking is faster/deterministic; live tests are flaky but catch API changes. Recommendation: mock for integration tests, optional live check in a separate marked test.
3. **Auth test extension vs. rewrite:** Existing auth tests are passing and well-structured. Phase 2 should extend them with additional scenarios (cookie persistence, expired JWT) rather than rewriting on asyncpg infrastructure.
4. **`clean_tables` fixture scope:** Currently session-scoped and only cleans before integration-marked tests. If Phase 2 endpoint tests also need clean state, they should use the `integration` marker or the fixture needs adjustment.
