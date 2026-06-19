# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (S1-S5); cookbook patterns at the bottom (S6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see S8).
>
> Last updated: 2026-06-19

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost x signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   area Y" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* -- drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `app/`, `frontend/src/`, `tests/`.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact x likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* -- never a specific file as "where the failure lives" (that is
research's job, see S1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence -- not anchor) |
|---|------------------------|--------|------------|-------------------------------|
| 1 | Collector dies or aggregation stops running -- station pages show stale or no data without any alert | High | High | PRD FR-001 + NFR data-freshness; interview Q1 (top fear); interview Q2 (200s sync caught by accident); hot-spot dir `app/collector/` -- 11 commits/30d |
| 2 | Aggregation produces plausible but incorrect averages -- commuter makes decisions based on wrong numbers | High | Medium | PRD FR-003 + business logic section; interview Q3 (aggregation math not trusted); hot-spot `app/` -- `aggregation.py` 4 commits/30d |
| 3 | Station API returns incorrect, empty, or stale data -- visitor searches and gets wrong results or blank page | High | Medium | PRD US-01, FR-004, FR-006; interview Q4 (no API tests); hot-spot dir `app/api/` -- 6 commits/30d |
| 4 | Deploy-time configuration or migration state diverges from local -- auth, DB connections, or CORS fail silently in production | High | High | PRD FR-008, FR-009; three production incidents (PgBouncer statement_cache_size → 500 on auth, missing users table despite Alembic recording migration, cookie domain mismatch → browser rejects session); research 2026-06-18 §1 (5 production-vs-local gaps); hot-spot dir `app/auth/` -- 8 commits/30d |
| 5 | Frontend silently breaks after a change -- heatmap, search, or station detail renders incorrectly or errors out | Medium | Medium | PRD US-01, FR-007; interview Q3 (new to React, changes feel fragile); hot-spot dir `frontend/src/components/` -- 10 commits/30d; Phase 3 mitigated with component tests (710 LOC, 11 files); residual risk is cross-component/E2E flows |
| 6 | Mevo GBFS API format changes undetected -- collector silently stores wrong data or crashes | High | Low | PRD FR-001; archive data-collection-pipeline risk note (API format undocumented); interview Q5 (user wants contract monitoring) |
| 7 | Unvalidated user input in station search or geocode reaches database or Nominatim -- injection or proxy abuse | High | Low | PRD FR-004 (station search); archive station-availability-page (Nominatim geocode proxy). Abuse lens: untrusted input |
| 8 | Unbounded snapshot growth exhausts DB storage -- Supabase pauses the database, entire app goes down | High | High | Issue #25 (already triggered in production); issue #11 (snapshot retention policy, open); no purge/retention code exists in `app/` |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | A test detects when no new snapshots appear within the expected 5-min interval, and when aggregation has not updated within the expected hourly window | "If /health returns 200, the collector is healthy" -- health endpoint may not check data freshness | How the scheduler runs, what triggers aggregation, how staleness is detected (or not), what /health actually checks | Integration test (scheduler mock + DB state assertion) | Testing that the scheduler is *configured* (implementation mirror) instead of testing that data actually *arrives* |
| #2 | Given a known set of snapshots, aggregation produces the mathematically correct weighted average after incremental runs (including first run, single snapshot, gap in collection) | "The existing sample_count is correct" -- a bug in initial seeding corrupts all future incremental merges | Watermark logic, weighted average formula, edge cases (first run, single snapshot, overlapping timeslots, gap after long downtime) | Unit test with known fixture data and independently computed expected values | Asserting current output is correct (oracle problem) -- expected values must be computed independently from the code under test |
| #3 | Station search returns matching results for known data; stats endpoint returns correct aggregated values; nearby endpoint returns stations sorted by actual distance | "If the endpoint returns 200 with JSON, it's correct" -- empty arrays and zero values are valid JSON but wrong answers | Query patterns, how search filters work, how stats are fetched, how nearby distance is calculated | Integration test with seeded DB | Testing only HTTP status codes without asserting response content and data correctness |
| #4 | Assertions that production-like env config (cookie domain, CORS origins, PgBouncer connection, Secure flag) produces correct behavior; smoke tests against deployed instance confirm auth + API + CORS work end-to-end | "If /health returns 200, production is healthy" -- health endpoint doesn't check auth, CORS, or cookie config; three separate production failures went undetected by /health | Cookie transport config (cookie_domain, SameSite, Secure), CORS origins vs production domain, asyncpg statement_cache_size with PgBouncer, Alembic migration state vs actual tables, deploy.sh health check scope | Smoke test against deployed instance + env-specific integration tests | Testing only against in-process ASGI transport with localhost defaults -- production uses different domains, HTTPS, and PgBouncer |
| #5 | Station search renders results for known props, heatmap renders with correct data bindings and color mappings, navigation between pages works | "If the component renders without throwing, it works" -- a component can render empty or with wrong data silently | Component props and API response shapes, routing setup, color-mapping logic for reliability labels | Component tests with testing-library/react | Snapshot tests that pass by default and break on any cosmetic change (noise, not signal) |
| #6 | A contract test validates that a real or recorded GBFS response matches the schema fields the collector actually uses | "The API hasn't changed in months so it won't change" -- undocumented APIs change without notice | Expected schema fields, which fields the collector reads and depends on | Contract/schema test against a recorded fixture + optional periodic live check | Mocking the API with our own fixtures (circular -- tests only our assumptions about the format) |
| #7 | Malformed or adversarial search/geocode inputs are rejected or sanitized before reaching the database or Nominatim | "Pydantic validates all input" -- Pydantic validates types, not semantic safety (SQL fragments pass as valid strings) | How search/geocode endpoints process the query parameter, whether raw SQL or parameterized queries are used | Integration test with adversarial inputs | Testing only valid inputs and assuming invalid ones are handled |
| #8 | A test that seeds old snapshots, runs a cleanup/retention function, and verifies rows beyond the retention window are deleted while recent data and aggregated availability are preserved | "Supabase has enough storage" -- the free plan has a hard 500MB limit; already exceeded in production (issue #25) | Current table sizes and growth rate, which table/index consumes most space, whether Supabase counts WAL/system catalogs toward the limit, interaction between retention purge and aggregation watermark | Integration test (seed old data + run purge + assert deletion + verify recent data intact) | Testing that a cron job is scheduled rather than that data is actually deleted |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|-----------|-----------------|---------------|-----------|--------|--------------|
| 1 | Data integrity -- aggregation + collector | Prove the numbers are correct and the pipeline stays alive | #1, #2, #6 | Unit tests (aggregation math), integration tests (collector to DB), contract test (GBFS schema) | complete | context/archive/2026-06-16-testing-data-integrity/ |
| 2 | API + auth integration | Prove endpoints return correct data and auth flows work end-to-end | #3, #4, #7 | Integration tests (FastAPI TestClient with seeded DB, cookie-aware auth, adversarial input) | complete | context/archive/2026-06-16-testing-api-auth/ |
| 3 | Frontend regression safety | Prove critical UI components render correctly with real data shapes | #5 | Component tests (testing-library/react), optional visual regression for heatmap | complete | context/archive/2026-06-18-testing-frontend/ |
| 4 | DB storage retention | Research retention policies, implement chosen solution, prove snapshots are purged and recent data preserved | #8 | Integration test (seed + purge + assert) | complete | context/archive/2026-06-19-db-storage-retention/ |
| 5 | Quality gates -- comprehensive CI pipeline | Lock lint + typecheck + full test suite in CI on every push; add pre-commit hooks | cross-cutting | GitHub Actions workflow, pre-commit hooks | complete | context/changes/testing-quality-gates/ |
| 6 | Deployment parity testing | Prove deployed artifact works -- Docker build, cookie/CORS under prod env, smoke tests, frontend-backend contract | #4, #8 (deploy verification) | Docker image test, env-specific integration, smoke test wiring, API contract tests | complete | context/archive/testing-deployment-parity/ |

**Phase notes:**

- **Phase 4:** Tied to B-02 (db-storage-fix). Includes a mandatory research phase to evaluate retention policies before implementation. Do not start implementation without completing research.
- **Phase 5:** Comprehensive -- may be sub-phased during planning. Includes GitHub Actions with Postgres 16 service container for integration tests, pre-commit hooks (ruff), and all quality gates from §5.
- **Phase 6:** Covers all 5 production-vs-local gaps from the 2026-06-18 research (cookie domain, CORS origins, PgBouncer parity, health-only deploy check, secure cookies). Includes frontend-backend API contract tests.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

**Classic layer:**

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| Unit + integration (backend) | pytest + pytest-asyncio | pytest >=8.0, pytest-asyncio >=0.26 | In pyproject.toml dev deps; 11 test files in `tests/` |
| API mocking / HTTP | httpx (built-in async test client) | >=0.28 | FastAPI TestClient uses httpx; no additional mock library needed |
| Frontend unit + component | Vitest + testing-library/react | Vitest ^4.1.9, @testing-library/react ^16.3.2, jsdom ^29.1.1 | Installed -- see Phase 3 notes |
| e2e | Playwright | ^1.50.0 | Installed -- `e2e/` dir, 3 spec files (auth-session, stations, seed), Chromium only. Levers: `e2e/seed.spec.ts` + `e2e/e2e-rules.md`. Run: `npx playwright test`. |
| Contract testing | pytest (schema assertion) | >=8.0 | Validate GBFS response schema against recorded fixture |
| Smoke tests | httpx (direct HTTP client) | >=0.28 | Runs against live server; markers: `smoke` |

**AI-native layer:**

| Layer | Tool | When NOT to use | checked |
|-------|------|-----------------| --------|
| Post-edit AI review | Claude Code post-edit hook -- checked: 2026-06-13 | When the change is cosmetic (formatting, comments, renames) or touches only test files | 2026-06-13 |
| Visual regression review | Deterministic screenshot diff (Percy, Playwright screenshot) -- checked: 2026-06-13 | When the change does not touch frontend rendering code; prefer deterministic diff over vision model | 2026-06-13 |

**Test-base profile:** `mature` -- pytest configured, 13 backend test files in `tests/` (deployment parity + API contract added), 11 frontend test files (710 LOC) co-located in `frontend/src/`, 3 Playwright E2E spec files in `e2e/`. Covers aggregation math, collector pipeline, GBFS contract, station API, geocode, auth endpoints, all critical UI components, production config regression (cookie/CORS/PgBouncer/migrations), API contract shapes, and browser-level auth cookie round-trip. CI automated (GitHub Actions, parallel backend + frontend jobs, Docker build verification). Post-deploy smoke tests + auto-rollback wired into deploy job.

**Stack grounding tools (current session):**
- Docs: Context7 MCP available -- can validate pytest, FastAPI, React testing guidance; checked: 2026-06-13
- Search: not available in current session
- Runtime/browser: not available in current session
- Provider/platform: not available in current session

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate | Command | Where | Required? | Catches |
|------|---------|-------|-----------|---------|
| Lint -- backend (ruff check) | `uv run ruff check .` | local + CI | required | Style violations, import errors, unused variables |
| Format -- backend (ruff format) | `uv run ruff format --check .` | local + CI | required | Inconsistent formatting |
| Type check -- backend (mypy) | `uv run mypy .` | local + CI | required | Type drift, missing annotations |
| Lint -- frontend (eslint) | `cd frontend && npm run lint` | local + CI | required | JS/TS lint violations, React hook rules |
| Type check -- frontend (tsc) | `cd frontend && npm run typecheck` | local + CI | required | TypeScript type errors |
| Unit + integration -- backend (pytest) | `uv run pytest` | local + CI (with Postgres service) | required after §3 Phase 1 | Logic regressions in aggregation, collector, API, auth |
| Frontend component tests (Vitest) | `cd frontend && npm test` | local + CI | required after §3 Phase 3 | UI rendering regressions |
| Frontend build | `cd frontend && npm run build` | CI | required after §3 Phase 5 | Build failures, dead code |
| Pre-commit hooks (ruff check + format) | via pre-commit framework | local | required after §3 Phase 5 | Catches lint/format before commit |
| Post-deploy smoke tests | `uv run pytest -m smoke` | deploy pipeline | required after §3 Phase 6 | Production config, auth, API health |
| Post-edit hook (AI review) | Claude Code post-edit hook | local (agent loop) | recommended after §3 Phase 5 | Regressions at edit time |
| Visual diff (deterministic) | Playwright screenshot | CI on PR | optional after §3 Phase 6 | Heatmap rendering regressions |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD."

### 6.1 Adding a unit test (backend)

**Location:** `tests/test_<module>.py`
**Naming:** `test_<function>_<scenario>` (e.g., `test_aggregation_weighted_merge_correct`)
**Marker:** `pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="session")]`

**Pattern (data-correctness test with DB fixtures):**

1. Seed known data via `insert_test_snapshots(conn, station_id, snapshots_data)` from `tests/conftest.py`.
2. Call the function under test (e.g., `aggregate_availability(db_pool)`).
3. Query the result table and assert against **independently hand-computed expected values** — never assert "current output equals expected" without computing the expected value yourself (oracle problem).
4. Use `pytest.approx` for float comparisons, never exact equality.

**Reference test:** `tests/test_aggregation.py::test_aggregation_weighted_merge_correct`

**Run command:**
```bash
uv run pytest tests/test_aggregation.py -v
```

### 6.2 Adding an integration test (backend API)

**Location:** `tests/test_<endpoint_group>.py` (e.g., `test_stations_api.py`, `test_geocode.py`, `test_auth.py`)
**Naming:** `test_<endpoint>_<scenario>` (e.g., `test_list_stations_returns_active_only`, `test_geocode_adversarial_input`)
**Marker:** `pytestmark = [pytest.mark.asyncio(loop_scope="session"), pytest.mark.integration]`

**Pattern (endpoint test with seeded DB):**

1. Use the `api_client` fixture (session-scoped `httpx.AsyncClient` with `ASGITransport(app=app)`) — it runs the real FastAPI lifespan, creates the app pool, and points both asyncpg and SQLAlchemy auth at the test DB.
2. Seed data via `insert_test_snapshots(conn, station_id, snapshots_data)` using the `db_pool` fixture. For availability data, insert directly into `station_availability`.
3. Make requests with `await api_client.get("/api/v1/...")` or `.post(...)`.
4. Assert response **content**, not just status codes — verify field values, list lengths, data correctness.
5. Use `pytest.approx` for float comparisons (coordinates, averages).

**Pattern (mocking external dependencies):**

For endpoints that call external services (e.g., geocode → Nominatim), use `httpx.MockTransport` in a fixture:

1. Create a function-scoped fixture that monkeypatches the module-level HTTP client (e.g., `app.api.geocode._http_client`).
2. The mock handler returns canned responses for normal queries and simulates errors for special trigger values (e.g., `"__error__"` → 502, `"__network_error__"` → `httpx.RequestError`).
3. Use the fixture alongside `api_client` in tests.

**Reference test:** `tests/test_stations_api.py::test_list_stations_returns_active_only`

**Run command:**
```bash
uv run pytest tests/test_stations_api.py -v
uv run pytest tests/test_geocode.py -v
uv run pytest tests/test_auth.py -v
```

### 6.3 Adding a contract test

**Location:** `tests/test_<api>_contract.py`
**Fixtures:** `tests/fixtures/<api>_<endpoint>.json` — recorded real API responses (full envelope, trimmed to 3-5 items, all fields intact)
**Naming:** `test_<model>_fixture_parses_to_model`, `test_<computed_property>`, `test_response_envelope_structure`

**Pattern (recorded fixture + Pydantic validation):**

1. Capture a real API response via `curl` and save to `tests/fixtures/`. Keep the full response envelope, trim to 3-5 items for readability.
2. Load fixture in a pytest fixture function: `json.loads((FIXTURES_DIR / "file.json").read_text())`.
3. Extract the data array (e.g., `payload["data"]["stations"]`) and validate each item with `Model.model_validate(item)`.
4. Assert structural invariants: required fields non-empty, value ranges valid, computed properties match raw data.
5. Test the response envelope separately (`"data"` key, `"stations"` key, is a list).

**Reference test:** `tests/test_gbfs_contract.py::test_station_info_fixture_parses_to_model`

**Run command:**
```bash
uv run pytest tests/test_gbfs_contract.py -v
```

### 6.4 Adding a frontend component test

**Location:** `frontend/src/<dir>/<Component>.test.tsx` (co-located with source — components in `components/`, pages in `pages/`)
**Naming:** `test('<Component> <scenario>', ...)` (e.g., `test('AvailabilityHeatmap renders 7 day rows', ...)`)
**Environment:** Vitest + jsdom + `@testing-library/react` (globals enabled, setup in `frontend/vitest.config.ts`)

**Pattern (props-based component test):**

1. Import `render`, `screen` from `@testing-library/react` and `userEvent` from `@testing-library/user-event`.
2. Import shared fixture data from `frontend/src/test/fixtures.ts` (`TEST_STATIONS`, `TEST_AVAILABILITY`, `TEST_STATION_DETAIL`).
3. If the component uses `<Link>` or `useParams` from react-router-dom, use `renderWithRouter(ui, { initialEntries })` from `frontend/src/test/helpers.tsx`.
4. If the component uses react-query (`useQuery`/`useMutation`), use `renderWithProviders(ui, { initialEntries, queryClient })` — wraps in both `QueryClientProvider` (retry: false, gcTime: 0) and `MemoryRouter`.
5. For pages that read route params (e.g., `:stationId`), wrap in `<Routes><Route path="..." element={<Page />} /></Routes>` inside `renderWithProviders` with matching `initialEntries`.
6. Assert rendered content with `screen.getByText()`, `screen.getByRole()`, CSS class assertions via `element.className`.

**Mock patterns:**

- **API functions:** `vi.mock('../api/stations')` — mock only the functions needed (e.g., `fetchStationDetail`, `fetchStations`). Use `vi.mocked(fn)` for type-safe mock control.
- **Auth hook:** `vi.mock('../hooks/useAuth')` — return controlled auth state for Layout, LoginPage, RegisterPage.
- **Geocode:** `vi.mock('../api/stations')` — mock `geocodeAddress` and `fetchNearbyStations` for StationSearch geocode fallback path.
- Reset mocks with `vi.clearAllMocks()` in `beforeEach`.

**Reference tests:**
- Props-based component: `frontend/src/components/AvailabilityHeatmap.test.tsx`
- Page with data fetching: `frontend/src/pages/StationDetailPage.test.tsx`
- Component with auth mock: `frontend/src/components/Layout.test.tsx`
- Search with geocode mock: `frontend/src/components/StationSearch.test.tsx`

**Run command:**
```bash
cd frontend && npm test                          # all frontend tests
cd frontend && npx vitest run src/components/AvailabilityHeatmap.test.tsx  # single file
cd frontend && npm run test:watch                # watch mode
```

### 6.5 Adding a test for a new API endpoint

**Location:** `tests/test_<endpoint_group>.py` — add to an existing file if the endpoint belongs to a group, or create a new file for a new group.
**Naming:** `test_<endpoint>_<scenario>` — one test per behavior (happy path, edge case, error).
**Marker:** `pytestmark = [pytest.mark.asyncio(loop_scope="session"), pytest.mark.integration]`

**Steps to add a test for a new endpoint:**

1. **Seed data** via `insert_test_snapshots()` or direct SQL using `db_pool`. Use known, deterministic values so expected results can be computed independently.
2. **Call the endpoint** via `api_client.get(...)` / `.post(...)`. Use `params=` for query params, `json=` for request bodies.
3. **Assert response content** — verify field values, list ordering, data correctness. Never assert only status codes.
4. **Add boundary/edge case tests** — empty results, not-found (404), invalid params (422). Use `@pytest.mark.parametrize` for multiple cases.
5. **Add adversarial input tests** — parametrize with SQL fragments, HTML/script tags, very long strings, Unicode edge cases (RTL override, zero-width joiner, null bytes). Assert `status_code != 500` for each.
6. **If the endpoint calls an external service** — add a `mock_<service>` fixture using `httpx.MockTransport` (see §6.2). Include error-path tests (service returns 5xx → endpoint returns 502).

**Reference tests:**
- Happy path + data correctness: `tests/test_stations_api.py::test_get_station_returns_availability`
- Adversarial input: `tests/test_geocode.py::test_geocode_adversarial_input`
- External service mock: `tests/test_geocode.py::test_geocode_service_error_returns_502`

**Run command:**
```bash
uv run pytest tests/test_<your_file>.py -v
```

### 6.6 Per-rollout-phase notes

**Phase 1 — Data integrity (completed 2026-06-16)**

Key decisions:
- **Docker Postgres on port 5433** for test isolation — never touches the main database. Session-scoped pool avoids reconnection overhead.
- **Alembic migrations in fixtures** — `conftest.py` runs `alembic upgrade head` at session start, `downgrade base` at teardown. Temporarily sets `MEVO_DATABASE_URL` to `MEVO_TEST_DATABASE_URL` so `alembic/env.py` picks up the test DB.
- **TRUNCATE between tests** — `clean_tables` fixture (function-scoped, autouse for `integration` marker) truncates all data tables via `TRUNCATE ... CASCADE`. Faster than drop/recreate.
- **Recorded GBFS fixtures** — real API responses saved to `tests/fixtures/`, trimmed to 3-5 stations. Contract tests validate these against Pydantic models — no network calls.
- **`insert_test_snapshots()` helper** — shared callable in `conftest.py` that inserts a station + snapshots with known values. Handles station upsert automatically.
- **`httpx` fixture for async client** — `conftest.py` provides a session-scoped `httpx.AsyncClient` for collector integration tests that need HTTP mocking via `respx`.

Files added: `tests/conftest.py`, `tests/test_aggregation.py`, `tests/test_collector_integration.py`, `tests/test_gbfs_contract.py`, `tests/fixtures/gbfs_station_information.json`, `tests/fixtures/gbfs_station_status.json`.

**Phase 2 — API + auth integration (completed 2026-06-18)**

Key decisions:
- **Session-scoped `api_client` fixture** — runs the real FastAPI lifespan with `ASGITransport(app=app)`. Both asyncpg pool (stations) and SQLAlchemy engine (auth) point at the test DB. Pool creation and Alembic migrations happen once per session.
- **Auth migration from `create_all` to Alembic** — `test_auth.py` no longer manages its own SQLAlchemy engine. All auth tests use the shared `api_client` fixture with the Alembic-migrated test DB, catching schema/migration mismatches that caused production 500s.
- **`httpx.MockTransport` for geocode** — `mock_nominatim` fixture monkeypatches `app.api.geocode._http_client` with a mock that returns canned Nominatim responses. Special trigger values (`"__error__"`, `"__network_error__"`) simulate service failures.
- **Adversarial input pattern** — `@pytest.mark.parametrize` over SQL fragments, HTML/XSS, very long strings, Unicode edge cases (RTL, ZWJ, combining diacriticals, null bytes). Assert `status_code != 500`.
- **Smoke test marker** — `@pytest.mark.smoke` on `test_smoke.py` tests. Run with `-m smoke` against a configurable `MEVO_SMOKE_BASE_URL`. Uses plain `httpx.AsyncClient` (no ASGITransport — hits real HTTP).
- **`clean_tables` expanded** — now truncates `users` table in addition to `stations, snapshots, station_availability`.

Files added: `tests/test_stations_api.py`, `tests/test_geocode.py`, `tests/test_smoke.py`. Files modified: `tests/conftest.py`, `tests/test_auth.py`.

**Phase 3 — Frontend regression safety (completed 2026-06-18)**

Key decisions:
- **Vitest + jsdom** — natural fit for React 19 + Vite 8. Merged config via `mergeConfig(viteConfig, ...)` so React and Tailwind plugins are available in tests. Globals enabled (`test.globals: true`) to avoid per-file Vitest imports.
- **Props-first testing strategy** — all critical components (AvailabilityHeatmap, StationSearch, DayPartDetail) receive data as props with no internal fetching. Tests pass fixture data directly, avoiding API mocking for pure rendering tests.
- **Shared render helpers** — `renderWithRouter` (MemoryRouter only) and `renderWithProviders` (MemoryRouter + QueryClientProvider with retry: false, gcTime: 0). Pages that read route params use `<Routes><Route>` wrappers with matching `initialEntries`.
- **Shared fixtures** — `frontend/src/test/fixtures.ts` exports `TEST_STATIONS`, `TEST_AVAILABILITY`, `TEST_STATION_DETAIL` with hand-crafted data covering all reliability labels (reliable, uncertain, empty, insufficient_data).
- **Mock boundaries** — `vi.mock('../api/stations')` for pages that fetch data, `vi.mock('../hooks/useAuth')` for auth-dependent components. Mocks are reset in `beforeEach` via `vi.clearAllMocks()`.
- **Co-located test files** — `<Component>.test.tsx` next to source. No separate `__tests__/` directory.
- **DOM-based heatmap assertions** — heatmap uses Tailwind utility classes on divs (not canvas/SVG), so CSS class assertions (`bg-green-500`, `bg-red-500`) verify color mapping directly.

Files added: `frontend/vitest.config.ts`, `frontend/tsconfig.test.json`, `frontend/src/test/setup.ts`, `frontend/src/test/helpers.tsx`, `frontend/src/test/fixtures.ts`, `frontend/src/components/AvailabilityHeatmap.test.tsx`, `frontend/src/components/StationSearch.test.tsx`, `frontend/src/components/DayPartDetail.test.tsx`, `frontend/src/components/DayOfWeekTabs.test.tsx`, `frontend/src/components/EmptyState.test.tsx`, `frontend/src/components/PopularStations.test.tsx`, `frontend/src/components/Layout.test.tsx`, `frontend/src/pages/StationDetailPage.test.tsx`, `frontend/src/pages/HomePage.test.tsx`, `frontend/src/pages/LoginPage.test.tsx`, `frontend/src/pages/RegisterPage.test.tsx`. Files modified: `frontend/package.json`, `frontend/tsconfig.json`.

**Phase 4 — DB storage retention (completed 2026-06-19)**

Key decisions:
- **7-day retention window** — `purge_old_snapshots()` deletes snapshots older than `retention_days=7` (default), bounded by the aggregation watermark so rows that haven't been aggregated yet are never purged.
- **Watermark guard** — purge skips when `watermark = 0` (no aggregation has run); prevents data loss on a fresh deployment.
- **Batch DELETE pattern** — `DELETE FROM snapshots WHERE captured_at < $1 AND captured_at < $2` (cutoff + watermark) run in a single round-trip; no chunking needed at current data volumes.
- **Integration test fixtures** — `seeded_retention_data` fixture inserts two groups of snapshots: `old` (beyond cutoff) and `recent` (within window). Tests assert old rows are deleted and recent rows survive.
- **Edge cases covered** — empty table (no-op), watermark zero (skip), watermark inside retention window (purge bounded by watermark, not cutoff).

Files added: `tests/test_retention.py`. Implementation in `app/retention.py`.

**Phase 5 — Quality gates / CI pipeline (completed 2026-06-19)**

Key decisions:
- **GitHub Actions CI with two parallel jobs** — `backend` (ubuntu-latest + Postgres 16 service container on port 5432) and `frontend` (ubuntu-latest + Node 20). Both trigger on push to any branch and PRs to main.
- **Backend CI gates (in order):** `uv run ruff check .` → `uv run ruff format --check .` → `uv run mypy .` → `uv run pytest -v` (with `MEVO_TEST_DATABASE_URL` and `MEVO_JWT_SECRET` set for integration tests).
- **Frontend CI gates (in order):** `npm ci` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run build`. Working directory: `frontend/`.
- **Auto-deploy on merge to main** — `deploy` job runs after both `backend` and `frontend` pass, gated by `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`. Uses `appleboy/ssh-action` to SSH to Mikr.us and run `git pull && docker compose build && docker compose up -d`. Polls `/health` for up to 90s, then runs smoke tests (`uv run pytest tests/test_smoke.py -v` with `MEVO_SMOKE_BASE_URL`).
- **Pre-commit hooks** — `pre-commit` framework (`.pre-commit-config.yaml`) with three hooks: `ruff` (lint + auto-fix), `ruff-format`, and a local `related-tests` hook (`scripts/run-related-tests.sh`) that maps staged source files to their test files and runs only those.
- **Claude Code per-edit hooks** — `.claude/settings.json` `PostToolUse` hook triggers `.claude/hooks/post-edit-lint.sh` on `Edit|Write` events. Routes to `ruff check --fix` + `mypy --follow-imports=silent` for `.py` files, `eslint` for `.ts`/`.tsx` files.
- **GitHub Secrets required for deploy:** `SSH_PRIVATE_KEY`, `MIKRUS_SERVER`, `MIKRUS_SSH_PORT`, `SMOKE_BASE_URL`.

Files added: `.github/workflows/ci.yml`, `.pre-commit-config.yaml`, `scripts/run-related-tests.sh`, `.claude/hooks/post-edit-lint.sh`. Files modified: `.claude/settings.json`, `CLAUDE.md`, `pyproject.toml`.

**Phase 6 — Deployment parity (completed 2026-06-19)**

Key decisions:
- **Config regression tests** — `tests/test_deployment_parity.py` verifies PgBouncer `statement_cache_size=0` (both asyncpg pool and SQLAlchemy engine), Alembic migration chain (single head, linear, expected revision `006`), cookie attributes under production settings (`environment="production"`, `cors_origins=["https://dailymevo.pl"]`), and CORS headers for production origin. Pure pytest, no external dependencies.
- **API contract tests** — `tests/test_api_contract.py` validates backend response shapes against the TypeScript interfaces in `frontend/src/api/stations.ts` for all four endpoint groups (stations list, station detail, nearby, geocode). Uses the `api_client` fixture with seeded test data.
- **Smoke test expansion** — `tests/test_smoke.py` expanded from 3 to 9 tests: full auth lifecycle (register → login → `/users/me` → logout → 401), station detail, and CORS preflight with production origin. All against the deployed instance via `MEVO_SMOKE_BASE_URL`. Existing register test strengthened to assert 201 + response shape.
- **Docker build CI job** — `docker-build` job added to `.github/workflows/ci.yml`, runs in parallel with `backend` and `frontend`, gates the `deploy` job. Catches Dockerfile regressions before merge.
- **Automated rollback on smoke failure** — `if: failure()` step in the deploy job SSH-runs `rollback.sh` on the server if health check or smoke tests fail. Reduces MTTR from manual intervention to seconds.
- **Rollback.sh polling loop** — replaced the single `sleep 10` + one-shot curl with an 18×5s polling loop (90s total) matching `deploy.sh`'s pattern.
- **Playwright E2E foundation** — `playwright.config.ts` (Chromium, `baseURL=http://localhost:5173`, `webServer` auto-start for both uvicorn and Vite), `e2e/auth-session.spec.ts` (3 tests: register→reload→logout, login→logout, cookie attribute inspection via `context.cookies()`), `e2e/stations.spec.ts` (home page loads, station detail), `e2e/seed.spec.ts` (exemplar). Root bug found during verification: test emails used `@test.local` (rejected by email validator) — fixed to `@example.com`.
- **Production run command** — `E2E_BASE_URL=https://dailymevo.pl npx playwright test e2e/auth-session.spec.ts` is the acceptance test for issue #24. The cookie attribute test reveals exactly what the browser receives.

Files added: `tests/test_deployment_parity.py`, `tests/test_api_contract.py`, `e2e/auth-session.spec.ts`, `e2e/stations.spec.ts`, `e2e/seed.spec.ts`, `e2e/e2e-rules.md`, `playwright.config.ts`, `package.json`, `package-lock.json`, `rollback.sh` (upgraded). Files modified: `tests/test_smoke.py`, `.github/workflows/ci.yml`, `docker-compose.yml`.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **GBFS client parsing** -- already tested (3 test files), API format is stable. Re-evaluate if the GBFS spec version changes or the collector starts parsing new fields. (Source: interview Q5.)
- **Mevo API end-to-end mocking** -- no point maintaining a full mock of an external API we do not control. Contract tests (Risk #6) monitor the schema shape instead. Re-evaluate if the API starts requiring authentication or versioning. (Source: interview Q5.)
- **Config/environment variable parsing** -- pydantic-settings handles validation; testing it is testing the framework. Re-evaluate if custom validators are added to the Settings class. (Source: general cost x signal principle.)

## 8. Freshness Ledger

- Strategy (S1-S5) last reviewed: 2026-06-18
- Risk map last updated: 2026-06-18
- Stack versions last verified: 2026-06-19
- AI-native tool references last verified: 2026-06-18

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- S7 negative-space no longer matches what the team believes.
