# API and Auth Integration Tests — Plan Brief

> Full plan: `context/changes/testing-api-auth/plan.md`
> Research: `context/changes/testing-api-auth/research.md`

## What & Why

Integration tests for Phase 2 of the test plan rollout — proving station API endpoints return correct data, auth flows work end-to-end against the real migrated schema, and adversarial user input doesn't cause 500s. Motivated by a production 500 on register/login: the existing auth tests use SQLAlchemy `create_all` (bypassing Alembic migrations), so they can't catch schema mismatches that cause failures in production.

## Starting Point

Phase 1 established test infrastructure: `conftest.py` with session-scoped `db_pool` (Alembic migrations on test Postgres), `clean_tables`, and `insert_test_snapshots()`. Existing auth tests (11 in `test_auth.py`) pass locally but use a self-managed DB — disconnected from the real migration pipeline. No station API or geocode tests exist.

## Desired End State

All API endpoints have data-correctness tests running against the Alembic-migrated test DB via the real app lifespan. Auth tests catch migration mismatches. A smoke test script can run against any URL (including production) to verify no 500s after deploy. The test-plan cookbook has concrete patterns for adding endpoint tests.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Pool wiring for endpoint tests | Run real app lifespan with test DATABASE_URL | Tests the full startup path including pool creation — monkeypatching settings + replacing auth engine. | Plan |
| Geocode mock strategy | httpx.MockTransport (no respx) | Reuses existing project pattern from collector tests; avoids new dependency. | Plan |
| Auth test migration | Migrate to Alembic-migrated DB | Catches the exact failure class (schema mismatch) causing production 500s. | Plan |
| Auth gap coverage | Cookie persistence + expired JWT + CORS preflight | All three — covers real production failure modes comprehensively. | Plan |
| Adversarial input depth | Targeted set (SQL, HTML, Unicode, long strings) | Covers realistic attack vectors without exhaustive fuzzing. | Plan |
| Reliability label thresholds | Use actual settings defaults | Tests real production behavior; if defaults change, tests break (good signal). | Plan |
| Haversine verification | Both exact distance + sort order | Full coverage of formula correctness and ORDER BY behavior. | Plan |
| Post-deploy smoke test | Separate @pytest.mark.smoke against configurable BASE_URL | Catches env/infra 500s that integration tests can't detect. | Plan |
| Scheduler in tests | COLLECTOR_ENABLED=false | Uses existing feature toggle; lifespan still creates DB pool. | Plan |
| Clean tables scope | Add users to TRUNCATE, use integration marker | Zero-change to fixture pattern; auth tests join existing cleanup mechanism. | Plan |

## Scope

**In scope:**
- Station endpoint tests (list, detail, nearby, reliability labels, haversine distance)
- Auth test migration to Alembic DB + new tests (cookie persistence, expired JWT, CORS)
- Adversarial input tests (geocode, station_id, nearby params)
- Health endpoint smoke test
- Post-deploy smoke script
- Test-plan cookbook §6.2, §6.5, §6.6 updates

**Out of scope:**
- Rate limiting on geocode (code change, not test)
- Browser-level CORS testing (needs Playwright)
- Debugging the current production 500 (separate investigation)
- CI pipeline wiring (Phase 4)

## Architecture / Approach

All endpoint tests share a session-scoped `api_client` fixture: monkeypatch settings → run real FastAPI lifespan → get asyncpg pool + SQLAlchemy engine both pointing at test DB → `httpx.AsyncClient` with `ASGITransport`. Geocode tests swap the module-level httpx client with a `MockTransport`. Smoke tests use plain `httpx.AsyncClient` against a real HTTP URL, independent of test DB.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Infrastructure + Station API | Shared ASGI fixture + 7 station endpoint tests | Lifespan wiring complexity (dual DB drivers) |
| 2. Auth Migration + Extensions | Migrated auth tests + 3 new tests (cookie, JWT, CORS) | Regression risk from changing existing test fixture |
| 3. Adversarial Input + Extras | Geocode + station_id adversarial tests + smoke script | Mock transport must handle all adversarial inputs without leaking to real Nominatim |
| 4. Cookbook + Docs | Test-plan §6.2, §6.5, §6.6 + RUNNING_TESTS.md | Patterns must match actual implementation |

**Prerequisites:** Docker Postgres running on port 5433, `MEVO_TEST_DATABASE_URL` set, `MEVO_JWT_SECRET` set
**Estimated effort:** ~2-3 sessions across 4 phases

## Open Risks & Assumptions

- The production 500 root cause is assumed to be a migration/env mismatch — if it's a code bug, integration tests will catch it when auth tests migrate to Alembic DB
- Session-scoped `api_client` with lifespan means the app pool lives for the entire test session — any state leak between tests must be caught by `clean_tables`
- Module-level `app.auth.db.engine` replacement may need careful ordering to ensure it happens before the lifespan references it

## Success Criteria (Summary)

- All station endpoint tests prove data correctness against Alembic-migrated DB
- Auth tests catch migration mismatches by running against real schema (not `create_all`)
- Smoke tests detect 500s when run against production URL
