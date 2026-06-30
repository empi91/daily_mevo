---
date: 2026-06-16T12:00:00+02:00
researcher: Claude Code
git_commit: fb981a9db7e114db1ca009f2b666eb446e081478
branch: main
repository: daily_mevo
topic: "Data integrity testing — aggregation math, collector pipeline, GBFS contract"
tags: [research, codebase, aggregation, collector, gbfs, testing]
status: complete
last_updated: 2026-06-16
last_updated_by: Claude Code
---

# Research: Data integrity testing — aggregation, collector, GBFS contract

**Date**: 2026-06-16  
**Git Commit**: fb981a9  
**Branch**: main

## Research Question

Ground the test plan's Phase 1 risks with codebase specifics so `/10x-plan` can produce precise, testable specs. The test plan's Risk Response Guidance requires us to understand:

- **Risk #1**: How the scheduler runs, what triggers aggregation, how staleness is detected, what /health checks
- **Risk #2**: Watermark logic, weighted average formula, edge cases (first run, single snapshot, gap, double-run)
- **Risk #6**: GBFS schema fields the collector depends on, parsing strategy, error handling

## Summary

The aggregation system uses an **incremental weighted-average merge** gated by a **single-row watermark table** (`agg_watermark.last_processed_id`). The formula is mathematically correct but has a critical idempotency gap: if the aggregation INSERT succeeds but the watermark UPDATE fails within the same transaction, a retry would double sample counts. The GBFS collector depends on **2 endpoints** with **7 required fields** across StationInfo and StationStatus models; parsing failures are silently swallowed (return None). The health endpoint checks data freshness but **not** aggregation staleness. Existing tests cover model parsing (3 files, 356 LOC) but nothing about aggregation math, watermark logic, or database integration for the collector.

## Detailed Findings

### 1. Scheduler & Collection Pipeline (Risk #1)

**Scheduler**: APScheduler `AsyncIOScheduler`, started in `app/main.py:99-118` during FastAPI lifespan.

Three scheduled jobs:
| Job | Interval | Config source |
|-----|----------|---------------|
| `station_sync` | 24 hours | Hardcoded `app/main.py:100-105` |
| `snapshot_collection` | 300s (5 min) | `app/config.py:11` `collector_interval_seconds` |
| `aggregation` | 1 hour | Hardcoded `app/main.py:112-117` |

On startup, `run_station_sync()` and `run_snapshot_collection()` fire immediately as asyncio tasks (`app/main.py:125-128`).

**Health endpoint** (`/health` at `app/main.py:162-238`):
- Checks DB connectivity (`SELECT 1`)
- Counts active stations
- Checks snapshot freshness: `MAX(collected_at)` vs `freshness_threshold_seconds` (default 3600s, `app/config.py:12`)
- Reports collector status, last collection time, next scheduled run
- **Does NOT check**: aggregation staleness, watermark lag, or snapshot arrival gaps

**Staleness gap**: If the collector stops, the health endpoint will eventually report `data_freshness.fresh = false` after 1 hour (default threshold). But there is no detection of *gaps within* the expected 5-minute interval — a 30-minute outage followed by one collection would reset the freshness flag.

**Aggregation staleness**: Not monitored. `agg_watermark.updated_at` exists in the schema but is not queried by /health. If aggregation stops, it's invisible until a user notices stale availability patterns.

### 2. Aggregation Math & Watermark (Risk #2)

**Watermark table** (`alembic/versions/004_create_agg_watermark.py`):
```sql
CREATE TABLE agg_watermark (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
    last_processed_id BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
```
Migration seeds with `COALESCE(MAX(id), 0)` from snapshots — trusts existing aggregated data.

**Aggregation flow** (`app/aggregation.py:9-90`):
1. Read `watermark_from` from `agg_watermark` (line 11-18)
2. Read `current_max = MAX(id)` from snapshots (line 20-24)
3. Early exit if `current_max <= watermark_from` (line 26)
4. CTE `new_data`: group snapshots where `id > watermark_from` by (station_id, day_of_week, time_slot), compute `SUM(bikes_available)`, `SUM(ebikes_available)`, `COUNT(*)` (lines 35-53)
5. INSERT into `station_availability` with `avg = sum / cnt` (lines 57-64)
6. ON CONFLICT: weighted merge (lines 66-73):
   ```
   new_avg = (old_avg * old_count + batch_avg * batch_count) / (old_count + batch_count)
   ```
7. Update watermark to `current_max` (line 79)

**Time-slot bucketing** (line 40):
```sql
(collected_at AT TIME ZONE 'Europe/Warsaw')::date
    + (INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM local_ts) / 15))
```
Uses `EXTRACT(ISODOW FROM local_ts) - 1` for day_of_week (0=Monday through 6=Sunday).

**Data types**: `avg_bikes` and `avg_ebikes` are `DOUBLE PRECISION` (IEEE 754 float64). `sample_count` is `INTEGER`. No explicit rounding.

**Edge cases analysis**:

| Edge case | Behavior | Testable? |
|-----------|----------|-----------|
| First run (watermark=0) | All snapshots aggregated, simple mean per slot | Yes — seed snapshots, verify averages |
| Single snapshot per slot | avg = exact value, sample_count = 1 | Yes — trivial fixture |
| Gap in collection | Old slots untouched; new slots created normally | Yes — two batches with gap |
| Overlapping timeslots | Not possible — 15-min bucketing is deterministic | N/A |
| Double-run on same data | Watermark prevents reprocessing | Yes — run twice, verify no change |
| Transaction partial failure | If INSERT succeeds but watermark UPDATE fails: **sample_count doubles** | Yes — critical to verify both are in same transaction |

**Transaction safety**: The entire flow runs inside `async with conn.transaction()` (line 10), so INSERT + watermark UPDATE are atomic. The double-count scenario only arises if the transaction isolation is broken or if the watermark is manually reset without truncating `station_availability`.

### 3. GBFS Contract Surface (Risk #6)

**Client**: `app/collector/gbfs_client.py`  
**Base URL**: `https://gbfs.urbansharing.com/rowermevo.pl` (line 8)  
**HTTP**: `httpx.AsyncClient`, 30s timeout, `Client-Identifier: mevostats-datacollector` header  
**Endpoints**: `/station_information.json`, `/station_status.json`  
**Response shape**: `response.json()["data"]["stations"]` (lines 25, 39)

**Required fields per model** (`app/collector/models.py`):

| Model | Required fields | Optional fields (with defaults) |
|-------|----------------|-------------------------------|
| `StationInfo` (lines 4-11) | `station_id: str`, `name: str`, `lat: float`, `lon: float` | `address: str\|None`, `capacity: int\|None`, `is_virtual_station: bool = False` |
| `StationStatus` (lines 19-27) | `station_id: str`, `num_bikes_available: int`, `num_docks_available: int` | `vehicle_types_available: list = []`, `is_installed: bool = True`, `is_renting: bool = True`, `is_returning: bool = True` |
| `VehicleTypeAvailability` (lines 14-16) | `vehicle_type_id: str`, `count: int` | (none) |

**Computed properties** on `StationStatus`:
- `bikes_count` (line 30-32): filters `vehicle_types_available` for `vehicle_type_id == "bike"`, falls back to `num_bikes_available`
- `ebikes_count` (line 36-39): filters for `vehicle_type_id == "ebike"`, defaults to 0

**Error handling**: Both fetch methods wrap everything in `try/except Exception` → log + return `None`. Callers (`station_sync.py:11-13`, `snapshot_collector.py:13-15`) skip processing when fetch returns None. A missing required field triggers a Pydantic `ValidationError` caught by the blanket except — the entire fetch silently returns None (no partial results).

**Station sync** (`app/collector/station_sync.py`):
- Upserts using `station_id` as unique key (line 31: `ON CONFLICT (station_id) DO UPDATE`)
- Stations not in the fetched list are marked `is_active = FALSE` (lines 50-57)

### 4. Existing Test Coverage

**3 test files, ~356 LOC** in `tests/`:

| File | What's tested | Pattern |
|------|--------------|---------|
| `test_gbfs_client.py` | StationInfo/StationStatus parsing from mock HTTP, one error case (HTTP 500) | httpx.MockTransport, sync assertions on async fetch |
| `test_collector.py` | Snapshot row generation from StationStatus models, unknown-station filtering | Sync-only, no DB, no async |
| `test_auth.py` | Full auth flow (register/login/logout/cookie) | pytest-asyncio, real DB via SQLAlchemy, AsyncClient ASGI transport |

**Fixtures** (`tests/conftest.py`):
- `station_info_payload`: 2 stations with all fields including extras (station_area, rental_uris)
- `station_status_payload`: 2 stations with vehicle_types_available containing bike + ebike entries

**Gaps relevant to Phase 1**:
- Zero tests for aggregation math or watermark logic
- Zero DB integration tests for collector (only model parsing)
- No contract/schema tests for GBFS response shape
- No test for station_sync upsert or deactivation logic
- No parametrized tests for edge cases
- No pytest configuration in pyproject.toml (relying on defaults)
- `test_auth.py` establishes the DB testing pattern (pytest-asyncio + AsyncClient + create_all/drop_all) that Phase 1 can follow

### 5. Historical Context from Archived Changes

**`context/archive/2026-06-04-data-collection-pipeline/plan.md`**:
- Established the DB schema (stations, snapshots) and GBFS client
- Aggregation explicitly deferred to a later slice
- Station ID is a **string** (e.g., "7694"), not integer
- Station `name` is a code (e.g., "GPG019"); `address` is the human-readable location
- ~827 stations in the Mevo system
- Only "smoke-level" tests shipped; comprehensive testing deferred

**`context/archive/2026-06-11-data-pipeline-performance/`**:
- Research recommended incremental aggregation with watermark (replacing full GROUP BY)
- Weighted average formula documented: `(old_avg * old_count + batch_sum) / (old_count + batch_count)`
- Noted option to store `sum_bikes`/`sum_ebikes` instead of averages (avoids float drift) — **deferred**
- Station sync rewritten from per-row INSERT to unnest-based bulk upsert
- `statement_cache_size=0` for Supabase transaction pooler compatibility

## Code References

- `app/aggregation.py:9-90` — Full aggregation flow (watermark read → CTE → upsert → watermark advance)
- `app/aggregation.py:34-53` — CTE with time-slot bucketing and SUM/COUNT
- `app/aggregation.py:66-73` — Weighted average merge formula (ON CONFLICT)
- `app/aggregation.py:79` — Watermark advancement
- `app/collector/gbfs_client.py:8` — GBFS base URL
- `app/collector/gbfs_client.py:19-29` — fetch_station_info with error handling
- `app/collector/gbfs_client.py:33-43` — fetch_station_status with error handling
- `app/collector/models.py:4-11` — StationInfo model (required/optional fields)
- `app/collector/models.py:14-16` — VehicleTypeAvailability model
- `app/collector/models.py:19-39` — StationStatus model with computed properties
- `app/collector/snapshot_collector.py:8-43` — Snapshot collection flow
- `app/collector/station_sync.py:8-57` — Station upsert and deactivation
- `app/main.py:99-118` — APScheduler job configuration
- `app/main.py:162-238` — /health endpoint (freshness check, no aggregation staleness)
- `app/config.py:11-12` — collector_interval_seconds, freshness_threshold_seconds
- `alembic/versions/003_create_station_availability.py` — Aggregation results schema
- `alembic/versions/004_create_agg_watermark.py` — Watermark table schema
- `tests/conftest.py:4-77` — GBFS fixture data (2 stations)
- `tests/test_auth.py:16-26` — DB fixture pattern (create_all/drop_all)

## Architecture Insights

1. **All aggregation logic is a single SQL statement** wrapped in a transaction. The Python code sets up the watermark bounds and executes the query — no Python-side math. Tests should verify the SQL output, not mock it.

2. **The weighted average formula preserves mathematical correctness** as long as the same snapshots are never processed twice. Transaction atomicity (watermark + insert in one transaction) is the sole guard against double-counting.

3. **GBFS error handling is "all or nothing"** — any parsing failure in a single station causes the entire fetch to return None, skipping the collection cycle. This means a single schema change could silently halt all data collection.

4. **Time-slot bucketing uses Warsaw timezone** (`AT TIME ZONE 'Europe/Warsaw'`). DST transitions (March/October) shift the local hour, which affects day_of_week boundaries around midnight. A snapshot at 2026-10-25 02:30 CEST and 02:30 CET (1 hour later) would both bucket to the same time_slot but the latter is after the DST change.

5. **Station identity is `station_id` (string)**, not an integer. The collector trusts that the GBFS API's station_id values are stable identifiers.

## Historical Context (from prior changes)

- `context/archive/2026-06-04-data-collection-pipeline/plan.md` — Initial schema and collector design, aggregation deferred, smoke tests only
- `context/archive/2026-06-11-data-pipeline-performance/research.md` — Detailed analysis of watermark pattern, weighted average formula, performance improvements
- `context/archive/2026-06-11-data-pipeline-performance/plan.md` — Implementation of incremental aggregation, unnest-based station sync, watermark migration

## Open Questions

1. **DST edge case**: How should tests handle the Warsaw timezone DST transition? A snapshot collected during the "repeated hour" (fall-back) could be bucketed ambiguously. The current SQL uses `AT TIME ZONE 'Europe/Warsaw'` which PostgreSQL handles deterministically, but the expected test values need to account for this.

2. **Float drift**: The deferred decision to store `sum_bikes`/`sum_ebikes` instead of averages means incremental merges accumulate floating-point error over time. For practical bike counts (0-50) and sample sizes (<100k), this is negligible — but tests should use approximate assertions (e.g., `pytest.approx`) rather than exact equality.

3. **Full recalculation path**: The runbook (TRUNCATE + reset watermark) is documented in the archived plan but has no automated test. Should Phase 1 cover this, or defer?
