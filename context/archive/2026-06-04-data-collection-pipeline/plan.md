# Data Collection Pipeline Implementation Plan

## Overview

Set up the Mevo data collection foundation: reorganize the project into a proper Python package, add PostgreSQL schema for stations and availability snapshots via Alembic migrations, and build an APScheduler-based collector that polls the GBFS feed every 5 minutes — storing bike and e-bike counts separately for each station. This is the foundational data layer that S-01 (station availability page) depends on.

## Current State Analysis

- **Codebase:** Single `main.py` (57 lines) with FastAPI stub, asyncpg pool, and `/health` endpoint
- **Database:** Supabase PostgreSQL connected via asyncpg (pool min=2, max=5, statement_cache_size=0 for transaction pooler compatibility)
- **Dependencies:** fastapi, asyncpg, pydantic-settings, uvicorn — no scheduler, no HTTP client, no migration tool
- **Deployment:** Docker on Mikr.us VPS (1GB RAM, 768MB container cap), SSH-based deploy via `deploy.sh`
- **API source:** Mevo GBFS v2.3 feed at `https://gbfs.urbansharing.com/rowermevo.pl/` — ~827 stations, unauthenticated, TTL 15s

### Key Discoveries:

- GBFS `station_status.json` provides `num_bikes_available`, `num_docks_available`, plus `vehicle_types_available` array with bike/ebike breakdown
- GBFS `station_information.json` provides static metadata: station_id, name, address, lat, lon, capacity, is_virtual_station
- The `station_id` is a string in GBFS (e.g., `"7694"`), and `name` is a station code (e.g., `"GPG019"`), not a human-readable name — `address` is the human-readable location
- Supabase free tier has 500MB storage; estimated raw snapshot storage is ~50-80MB for 6 months
- `statement_cache_size=0` is already set in the pool config for Supabase transaction pooler compatibility

## Desired End State

After this plan is complete:

1. The project is organized as an `app/` Python package with clear module separation (config, db, collector, models)
2. Alembic is configured and two migrations exist: `stations` table and `snapshots` table
3. On app startup, the collector syncs station metadata from `station_information.json` (and refreshes daily)
4. Every 5 minutes, the collector fetches `station_status.json` and inserts one snapshot row per station with bikes_available, ebikes_available, and docks_available
5. API failures are logged and skipped — the next cycle retries naturally
6. The `/health` endpoint reports collector status (last successful run, next scheduled run)
7. The app is deployed and collecting real data on Mikr.us

**Verification:** After deploy, `SELECT count(*) FROM snapshots` shows growing row count; `/health` shows `collector: running` with a recent `last_collected_at` timestamp.

## What We're NOT Doing

- **Aggregation logic** — average per timeslot/day-of-week ships with S-01
- **Free-floating bike tracking** — stations only; free bikes deferred to a future roadmap item
- **Alerting on collection failures** — deferred to F-02 (observability)
- **Data retention / cleanup** — keep all data; retention review tracked as a GitHub issue
- **Extensive test suite** — minimal smoke tests; comprehensive testing deferred
- **Pre-computed materialized views** — raw storage only; aggregation design driven by S-01 UI needs

## Implementation Approach

Reorganize the project into an `app/` package first (Phase 1), then build the schema (Phase 2), then the collector logic (Phase 3), then wire everything together and deploy (Phase 4). Each phase is independently verifiable. The collector runs inside the FastAPI process via APScheduler, sharing the asyncpg pool, controlled by a `MEVO_COLLECTOR_ENABLED` setting (default: true).

## Phase 1: Project Restructure & Dependencies

### Overview

Reorganize from a single `main.py` into an `app/` package structure and add all new dependencies. This phase touches no logic — it's a mechanical restructure that makes the remaining phases clean.

### Changes Required:

#### 1. Create package structure

**Files**: `app/__init__.py`, `app/main.py`, `app/config.py`, `app/db.py`

**Intent**: Move existing code into a proper package. `config.py` owns `Settings`, `db.py` owns pool lifecycle, `main.py` owns the FastAPI app and lifespan.

**Contract**: `app.main:app` is the new uvicorn entry point. `Settings` gains `collector_enabled: bool = True` and `collector_interval_seconds: int = 300`. `db.py` exports `create_pool(dsn) -> asyncpg.Pool` and `close_pool(pool)`.

#### 2. Add dependencies

**File**: `pyproject.toml`

**Intent**: Add alembic, httpx, apscheduler, and pytest as project dependencies.

**Contract**: Add `alembic>=1.16`, `httpx>=0.28`, `apscheduler>=3.11` to `[project.dependencies]`. Add `pytest>=8.0`, `pytest-asyncio>=0.26` to `[project.optional-dependencies] dev`.

#### 3. Set up Alembic

**Files**: `alembic.ini`, `alembic/env.py`, `alembic/versions/` (directory)

**Intent**: Initialize Alembic for async raw-SQL migrations against the Supabase database.

**Contract**: `alembic.ini` reads `sqlalchemy.url` from `MEVO_DATABASE_URL` env var (via `env.py` override). Migrations use raw SQL (no ORM models). `alembic upgrade head` applies all migrations.

#### 4. Update Dockerfile

**File**: `Dockerfile`

**Intent**: Update the build to copy the `app/` package and `alembic/` directory instead of just `main.py`.

**Contract**: `COPY app/ app/` and `COPY alembic/ alembic/` and `COPY alembic.ini .` added to the runtime stage. CMD changes to `uvicorn app.main:app --host 0.0.0.0 --port 8000`.

#### 5. Remove old main.py

**File**: `main.py` (delete)

**Intent**: All code now lives in `app/`. The root `main.py` is replaced by `app/main.py`.

**Contract**: Root `main.py` no longer exists. Uvicorn entry point is `app.main:app`.

### Success Criteria:

#### Automated Verification:

- `uv sync` installs all new dependencies without errors
- `uv run uvicorn app.main:app --host 0.0.0.0 --port 8000` starts the server
- `curl http://localhost:8000/health` returns `{"status":"ok",...}` with correct DB status
- `uv run alembic --help` runs without import errors
- `uv run ruff check .` passes
- `uv run mypy .` passes (or has only pre-existing issues)

#### Manual Verification:

- Docker build succeeds: `docker compose build`
- Container starts and health check passes: `docker compose up -d && docker compose ps` shows healthy

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Database Schema & Migrations

### Overview

Create the `stations` and `snapshots` tables via Alembic migrations with proper indexes for the aggregation queries S-01 will need.

### Changes Required:

#### 1. Stations migration

**File**: `alembic/versions/001_create_stations.py`

**Intent**: Create the `stations` table to hold station metadata synced from the GBFS `station_information.json` feed.

**Contract**:
```sql
CREATE TABLE stations (
    station_id TEXT PRIMARY KEY,        -- GBFS station_id (string, e.g. "7694")
    name TEXT NOT NULL,                  -- GBFS name (station code, e.g. "GPG019")
    address TEXT,                        -- human-readable location
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    capacity INTEGER,
    is_virtual BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,  -- soft-delete for removed stations
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### 2. Snapshots migration

**File**: `alembic/versions/002_create_snapshots.py`

**Intent**: Create the `snapshots` table to hold per-station availability data captured every 5 minutes.

**Contract**:
```sql
CREATE TABLE snapshots (
    id BIGSERIAL PRIMARY KEY,
    station_id TEXT NOT NULL REFERENCES stations(station_id),
    collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    bikes_available INTEGER NOT NULL,
    ebikes_available INTEGER NOT NULL,
    docks_available INTEGER NOT NULL,
    is_installed BOOLEAN NOT NULL DEFAULT TRUE,
    is_renting BOOLEAN NOT NULL DEFAULT TRUE,
    is_returning BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_snapshots_station_collected ON snapshots (station_id, collected_at);
CREATE INDEX idx_snapshots_collected_at ON snapshots (collected_at);
```

The compound index on `(station_id, collected_at)` supports the primary aggregation query pattern S-01 will use: filtering snapshots by station and time range. The `collected_at` index supports retention/cleanup queries.

### Success Criteria:

#### Automated Verification:

- `uv run alembic upgrade head` applies both migrations without errors
- `uv run alembic downgrade base` rolls back cleanly
- `uv run alembic upgrade head` re-applies cleanly (idempotent round-trip)

#### Manual Verification:

- Supabase dashboard shows `stations` and `snapshots` tables with correct columns and indexes

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: GBFS Client & Collector Service

### Overview

Build the HTTP client that talks to the Mevo GBFS feed, the station sync logic, and the snapshot collector — all as clean modules under `app/collector/`.

### Changes Required:

#### 1. GBFS client module

**File**: `app/collector/gbfs_client.py`

**Intent**: HTTP client that fetches and parses the two GBFS endpoints (station_information, station_status). Handles HTTP errors gracefully (log and return None).

**Contract**: Exports `GBFSClient` class with async methods `fetch_station_info() -> list[StationInfo] | None` and `fetch_station_status() -> list[StationStatus] | None`. Uses httpx async client. Sends `Client-Identifier: mevostats-datacollector` header. Timeout: 30s.

#### 2. Pydantic models for GBFS responses

**File**: `app/collector/models.py`

**Intent**: Typed Pydantic models for parsing GBFS JSON responses. Strict parsing catches API format changes early.

**Contract**: `StationInfo` model with fields: station_id (str), name (str), address (str | None), lat (float), lon (float), capacity (int | None), is_virtual_station (bool). `StationStatus` model with fields: station_id (str), num_bikes_available (int), num_docks_available (int), vehicle_types_available (list), is_installed (bool), is_renting (bool), is_returning (bool). A helper method on `StationStatus` extracts bike and ebike counts from `vehicle_types_available`.

#### 3. Station sync service

**File**: `app/collector/station_sync.py`

**Intent**: Syncs station metadata from the GBFS feed into the `stations` table. Runs on startup and once daily. Upserts new/changed stations, soft-deletes removed ones (sets `is_active=FALSE`).

**Contract**: Exports `sync_stations(pool: asyncpg.Pool, client: GBFSClient) -> int` returning count of stations upserted. Uses `INSERT ... ON CONFLICT (station_id) DO UPDATE` for upsert.

#### 4. Snapshot collector service

**File**: `app/collector/snapshot_collector.py`

**Intent**: The core 5-minute collection loop. Fetches station_status, maps to snapshot rows, bulk-inserts into the `snapshots` table.

**Contract**: Exports `collect_snapshots(pool: asyncpg.Pool, client: GBFSClient) -> int` returning count of snapshots inserted. Uses `executemany` for bulk insert. Skips stations not in the `stations` table (handles race with station sync). Logs collection time and row count.

#### 5. Collector package init

**File**: `app/collector/__init__.py`

**Intent**: Package init that re-exports the public interface.

**Contract**: Exports `GBFSClient`, `sync_stations`, `collect_snapshots`.

#### 6. Smoke tests

**Files**: `tests/test_gbfs_client.py`, `tests/test_collector.py`, `tests/conftest.py`

**Intent**: Minimal pytest setup with fixture-based smoke tests for the GBFS client and collector logic.

**Contract**: `conftest.py` provides GBFS response fixtures (JSON files or inline dicts). Tests verify parsing and row generation without hitting real API or DB.

### Success Criteria:

#### Automated Verification:

- `uv run pytest tests/test_gbfs_client.py` — smoke test that `GBFSClient` parses a fixture GBFS response correctly
- `uv run pytest tests/test_collector.py` — smoke test that `collect_snapshots` produces the right INSERT given a fixture response
- `uv run ruff check .` passes
- `uv run mypy .` passes

#### Manual Verification:

- Run `sync_stations` once manually (via a temporary script or REPL) and verify stations appear in Supabase
- Run `collect_snapshots` once manually and verify snapshot rows appear in Supabase

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Integration & Deployment

### Overview

Wire the collector into the FastAPI app lifecycle via APScheduler, update the health endpoint, add Docker support for migrations, and deploy to Mikr.us.

### Changes Required:

#### 1. Scheduler setup in lifespan

**File**: `app/main.py`

**Intent**: Start APScheduler in the FastAPI lifespan hook. Schedule station sync (on startup + daily) and snapshot collection (every 5 min). Respect `MEVO_COLLECTOR_ENABLED` setting.

**Contract**: Lifespan creates the asyncpg pool, then if `settings.collector_enabled` is True, starts an `AsyncIOScheduler` with two jobs: `sync_stations` (interval: 24h, run immediately on start) and `collect_snapshots` (interval: from `settings.collector_interval_seconds`, default 300s). Scheduler and last-run timestamps stored on `app.state`.

#### 2. Enhanced health endpoint

**File**: `app/main.py` (update existing `/health`)

**Intent**: Add collector status to the health response so we can verify collection is running after deploy.

**Contract**: Health response gains a `collector` object: `{"enabled": bool, "status": "running"|"stopped"|"disabled", "last_collected_at": ISO timestamp | null, "next_run_at": ISO timestamp | null, "stations_count": int}`.

#### 3. Migration runner in Docker entrypoint

**File**: `scripts/entrypoint.sh`

**Intent**: Run `alembic upgrade head` before starting uvicorn so migrations apply automatically on deploy.

**Contract**: Shell script: `alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000`. Dockerfile CMD changes to `["./scripts/entrypoint.sh"]`.

#### 4. Update docker-compose and .env.example

**Files**: `docker-compose.yml`, `.env.example`

**Intent**: Add the new collector-related env vars to `.env.example`. Ensure docker-compose mounts the entrypoint script.

**Contract**: `.env.example` gains `MEVO_COLLECTOR_ENABLED=true` and `MEVO_COLLECTOR_INTERVAL_SECONDS=300`. No changes to docker-compose volumes needed (entrypoint is baked into the image).

#### 5. Create GitHub issue for data retention review

**Intent**: Track the 6-month retention review as a GitHub issue so it doesn't get lost.

**Contract**: Issue titled "Review raw snapshot data retention policy (6-month check)" with body describing the current keep-all approach and the trigger to revisit.

### Success Criteria:

#### Automated Verification:

- `uv run pytest` — all smoke tests pass
- `uv run ruff check .` passes
- `uv run mypy .` passes
- `docker compose build` succeeds
- Container starts and migrations apply: `docker compose up -d` + `docker compose logs` shows alembic upgrade output

#### Manual Verification:

- Deploy to Mikr.us via `./deploy.sh`
- `/health` returns collector status with `"status": "running"` and a recent `last_collected_at`
- After 10 minutes, verify at least 2 snapshot batches in the database: query `SELECT collected_at, count(*) FROM snapshots GROUP BY collected_at ORDER BY collected_at`
- Verify station count matches expected (~827): `SELECT count(*) FROM stations WHERE is_active = true`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests (smoke level):

- GBFS client correctly parses a valid station_information fixture into `StationInfo` models
- GBFS client correctly parses a valid station_status fixture into `StationStatus` models, including bike/ebike extraction
- GBFS client returns None on HTTP error (mocked 500 response)
- Collector generates correct INSERT parameters from a fixture station_status response

### Manual Testing Steps:

1. Start the app locally with `MEVO_COLLECTOR_ENABLED=true` and valid `MEVO_DATABASE_URL`
2. Check logs for "Station sync completed" and "Snapshot collection completed" messages
3. Wait 5+ minutes and verify a second collection cycle fires
4. Check `/health` for collector status with timestamps
5. Query Supabase for station and snapshot row counts

## Performance Considerations

- ~827 stations × 1 row per snapshot = ~827 rows inserted every 5 minutes — well within asyncpg bulk insert capacity
- The compound index `(station_id, collected_at)` on snapshots is designed for S-01's aggregation queries, not for the collector itself
- At ~240K rows/day, Supabase free tier (500MB) should last ~6 months before needing attention
- APScheduler + httpx + asyncpg add ~20-30MB to the process footprint — comfortable within the 768MB container limit

## Migration Notes

- Alembic migrations run automatically via the entrypoint script on deploy
- First deploy creates both tables from scratch — no data migration needed
- Rollback: `alembic downgrade base` drops both tables (destructive but acceptable for a fresh system)
- The `stations` table uses `station_id TEXT` as PK (matching GBFS string IDs) — not an auto-increment integer

## References

- Change identity: `context/changes/data-collection-pipeline/change.md`
- PRD: `context/foundation/prd.md` — FR-001, FR-002
- Roadmap: `context/foundation/roadmap.md` — F-01
- GBFS spec: `https://gbfs.urbansharing.com/rowermevo.pl/gbfs.json`
- Mevo station info: `https://gbfs.urbansharing.com/rowermevo.pl/station_information.json`
- Mevo station status: `https://gbfs.urbansharing.com/rowermevo.pl/station_status.json`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Project Restructure & Dependencies

#### Automated

- [x] 1.1 `uv sync` installs all new dependencies without errors — fbb6edc
- [x] 1.2 `uv run uvicorn app.main:app` starts the server — fbb6edc
- [x] 1.3 `curl /health` returns correct response — fbb6edc
- [x] 1.4 `uv run alembic --help` runs without import errors — fbb6edc
- [x] 1.5 `uv run ruff check .` passes — fbb6edc
- [x] 1.6 `uv run mypy .` passes — fbb6edc

#### Manual

- [x] 1.7 Docker build succeeds and container starts healthy — fbb6edc

### Phase 2: Database Schema & Migrations

#### Automated

- [x] 2.1 `alembic upgrade head` applies both migrations — bb5f573
- [x] 2.2 `alembic downgrade base` rolls back cleanly — bb5f573
- [x] 2.3 `alembic upgrade head` re-applies cleanly — bb5f573

#### Manual

- [x] 2.4 Supabase dashboard shows correct tables, columns, and indexes — bb5f573

### Phase 3: GBFS Client & Collector Service

#### Automated

- [x] 3.1 `pytest tests/test_gbfs_client.py` passes — 1a245ae
- [x] 3.2 `pytest tests/test_collector.py` passes — 1a245ae
- [x] 3.3 `ruff check .` passes — 1a245ae
- [x] 3.4 `mypy .` passes — 1a245ae

#### Manual

- [x] 3.5 Manual station sync populates stations in Supabase — 1a245ae
- [x] 3.6 Manual snapshot collection inserts rows in Supabase — 1a245ae

### Phase 4: Integration & Deployment

#### Automated

- [x] 4.1 `pytest` — all tests pass — 2cb8cb7
- [x] 4.2 `ruff check .` passes — 2cb8cb7
- [x] 4.3 `mypy .` passes — 2cb8cb7
- [x] 4.4 `docker compose build` succeeds — 2cb8cb7
- [x] 4.5 Container starts and migrations apply — 2cb8cb7

#### Manual

- [x] 4.6 Deploy to Mikr.us via `./deploy.sh` — 2cb8cb7
- [x] 4.7 `/health` shows collector running with recent timestamp — 2cb8cb7
- [x] 4.8 At least 2 snapshot batches visible in database after 10 minutes — 2cb8cb7
- [x] 4.9 Station count matches expected (~827 active stations) — 2cb8cb7
