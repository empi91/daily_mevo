# Data Pipeline Performance Optimization — Implementation Plan

## Overview

Optimize the two slowest data pipeline operations — station sync (E-03, GitHub #14) and hourly aggregation (E-04, GitHub #15) — to eliminate per-row INSERT overhead and full-table rescans. The station sync drops from 46–200s to sub-second via unnest-based bulk upsert. The aggregation becomes O(new rows) instead of O(all rows) via incremental processing with a high-water mark. Both changes preserve data correctness, idempotency, and stay within the 768MB Mikr.us memory budget.

## Current State Analysis

**Station sync** (`app/collector/station_sync.py:18-41`): Loops over ~827 stations executing individual `INSERT...ON CONFLICT` per station within a single transaction. Each iteration is a separate SQL round-trip. Execution time: 46–200s.

**Aggregation** (`app/aggregation.py:9-40`): Full `GROUP BY` over the entire `snapshots` table with no `WHERE` clause. Recalculates all-time averages from scratch every hour. The `ON CONFLICT DO UPDATE` overwrites previous values entirely — no weighted merge. This works today but execution time grows linearly with table size (~240K rows/day added).

**Snapshot collector** (`app/collector/snapshot_collector.py:42-51`): Already uses `conn.executemany()` — adequate for ~827 rows every 5 minutes. No change needed.

### Key Discoveries:

- `snapshots.id` BIGSERIAL PK is the natural high-water mark — no schema change to the snapshots table needed
- `station_availability` already stores `sample_count`, the denominator needed for weighted average merges
- `statement_cache_size=0` in `app/db.py:7` means asyncpg creates/deallocates prepared statements per call — irrelevant for single-statement unnest approach
- The deactivation step in station_sync (line 44-50) already uses a single bulk `UPDATE...WHERE station_id != ALL($1)` — no optimization needed there
- The API layer (`app/api/stations.py:71-86`) reads `avg_bikes` and `avg_ebikes` directly — no API changes needed since we're keeping the avg columns
- Existing logging pattern uses `logfire.span()` in `app/main.py` scheduler wrappers — new observability follows same pattern

## Desired End State

After this plan is complete:
- Station sync completes in under 1 second (down from 46–200s), using a single SQL round-trip
- Hourly aggregation processes only new snapshots since the last run (~14K rows/hour), keeping execution time constant regardless of table size
- All existing `station_availability` data is preserved — no recalculation needed
- A new `agg_watermark` table tracks the last processed snapshot ID
- Aggregation observability includes rows-processed count and watermark position
- Verification: `uv run ruff check .`, `uv run mypy .`, `uv run pytest` all pass; manual check confirms API responses unchanged

## What We're NOT Doing

- Not changing the `station_availability` schema (no sum columns — keeping avg_bikes/avg_ebikes as-is)
- Not optimizing the snapshot collector (already adequate with executemany)
- Not adding a full-recalculation endpoint or CLI command (documented as manual runbook instead)
- Not adding indexes beyond what already exists (PK index on snapshots.id is sufficient)
- Not changing the API layer — it reads avg_bikes/avg_ebikes which remain unchanged
- Not changing APScheduler job intervals or configuration

## Implementation Approach

**Phase 1** tackles station sync (E-03): replace the Python loop with a single unnest-based INSERT...ON CONFLICT statement. This is a contained change to one function.

**Phase 2** tackles aggregation (E-04): add the watermark migration, rewrite the aggregation function to process incrementally with weighted average merges, and add observability. Bootstrap by setting the initial watermark to the current max snapshot ID (trusting existing averages).

Both phases are independent — they touch different files and can be verified separately.

## Phase 1: Bulk Station Sync (E-03)

### Overview

Replace the per-row INSERT loop in `sync_stations()` with a single unnest-based bulk upsert. One SQL round-trip instead of ~827.

### Changes Required:

#### 1. Rewrite station upsert logic

**File**: `app/collector/station_sync.py`

**Intent**: Replace the `for s in stations` loop (lines 17-41) with a single `conn.execute()` call that passes all station data as PostgreSQL arrays expanded via `unnest()`. The transaction, deactivation step, and function signature remain unchanged.

**Contract**: The unnest call uses typed array parameters (`$1::text[]`, `$2::text[]`, etc.) matching the seven station fields: `station_id`, `name`, `address`, `lat`, `lon`, `capacity`, `is_virtual`. The `unnest()` output is aliased with column names matching the INSERT target. `is_active` and `updated_at` are set as literal `TRUE` and `now()` in the SELECT, not as unnest parameters. The ON CONFLICT clause is identical to the current one.

```sql
INSERT INTO stations (station_id, name, address, lat, lon, capacity, is_virtual, is_active, updated_at)
SELECT u.station_id, u.name, u.address, u.lat, u.lon, u.capacity, u.is_virtual, TRUE, now()
FROM unnest($1::text[], $2::text[], $3::text[], $4::float8[], $5::float8[], $6::int[], $7::boolean[])
    AS u(station_id, name, address, lat, lon, capacity, is_virtual)
ON CONFLICT (station_id) DO UPDATE SET ...
```

The Python side builds one list per column (transposed from the row-oriented `stations` list), then passes all seven lists as positional arguments to `conn.execute()`. The `fetched_ids` list is built from the same station_ids list used for the unnest — no separate loop needed.

### Success Criteria:

#### Automated Verification:

- Linting passes: `uv run ruff check .`
- Type checking passes: `uv run mypy .`
- Tests pass: `uv run pytest`

#### Manual Verification:

- Trigger station sync on dev/staging and confirm it completes in under 10 seconds
- Verify station count in DB matches expected (~827 active stations)
- Verify the deactivation logic still works (stations not in API response get `is_active = FALSE`)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Incremental Aggregation (E-04)

### Overview

Add an `agg_watermark` table, rewrite `aggregate_availability()` to process only new snapshots since the last watermark, merge into existing averages using weighted formula, and add observability spans.

### Changes Required:

#### 1. Create watermark migration

**File**: `alembic/versions/004_create_agg_watermark.py`

**Intent**: Create a single-row `agg_watermark` table to track the last processed snapshot ID. Initialize with the current `max(id)` from snapshots so existing averages are preserved.

**Contract**: Table schema:
- `id INTEGER PRIMARY KEY DEFAULT 1` with a CHECK constraint `(id = 1)` ensuring single-row
- `last_processed_id BIGINT NOT NULL DEFAULT 0`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

The upgrade inserts one row with `last_processed_id = (SELECT COALESCE(MAX(id), 0) FROM snapshots)`. This bootstraps the watermark to trust existing `station_availability` data. Revision chain: `down_revision = "003"`.

#### 2. Rewrite aggregation function

**File**: `app/aggregation.py`

**Intent**: Replace the full-table scan with incremental processing. Read the watermark, aggregate only rows with `id > last_processed_id`, merge into `station_availability` using weighted average formula, then advance the watermark. All three steps in a single transaction for crash safety.

**Contract**: The function signature remains `async def aggregate_availability(pool: asyncpg.Pool) -> int`. The internal flow is:

1. Read watermark: `SELECT last_processed_id FROM agg_watermark WHERE id = 1`
2. Aggregate new rows with a CTE that filters `WHERE id > $1` and groups by `station_id, day_of_week, time_slot`, producing `sum_bikes`, `sum_ebikes`, `cnt`
3. INSERT into `station_availability` with ON CONFLICT DO UPDATE using the weighted merge formula:
   ```
   new_avg = (existing.avg * existing.sample_count + batch.sum / batch.cnt * batch.cnt)
             / (existing.sample_count + batch.cnt)
   ```
   Simplified: `(existing.avg * existing.sample_count + batch.sum) / (existing.sample_count + batch.cnt)`
4. Advance watermark: `UPDATE agg_watermark SET last_processed_id = $1, updated_at = now()`
5. Return the number of rows upserted

The timezone conversion (`AT TIME ZONE 'Europe/Warsaw'`) and time-slot bucketing logic remain identical to the current implementation.

Early exit: if `last_processed_id` equals `max(id)` from snapshots (no new data), log and return 0 without running the aggregation query.

#### 3. Add observability attributes

**File**: `app/aggregation.py`

**Intent**: Add structured log attributes for rows processed, watermark position, and whether the run was a no-op, following the existing `structlog` pattern.

**Contract**: After the aggregation completes, log with attributes: `rows_upserted`, `watermark_from`, `watermark_to`, `snapshots_processed` (difference between old and new watermark). Use the existing `logger.info()` pattern already in the function.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `uv run alembic upgrade head`
- Linting passes: `uv run ruff check .`
- Type checking passes: `uv run mypy .`
- Tests pass: `uv run pytest`

#### Manual Verification:

- After migration, verify `agg_watermark` table exists with one row where `last_processed_id` matches the current max snapshot ID
- Trigger aggregation manually and confirm it processes 0 rows (no new snapshots since watermark was set to max)
- Wait for one snapshot collection cycle (~5 min), then trigger aggregation again — confirm it processes only the new batch (~827 rows)
- Verify API responses for station detail (`/stations/{id}`) still return correct availability data with unchanged averages
- Check logs for new observability attributes (`rows_upserted`, `watermark_from`, `watermark_to`)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- Existing tests in `tests/test_gbfs_client.py` and `tests/test_collector.py` verify data parsing — should pass unchanged
- No new unit tests required for the SQL changes (these are integration-level concerns)

### Integration Tests:

- Station sync: verify bulk upsert produces identical DB state to the old per-row approach
- Aggregation: verify incremental merge produces correct weighted averages

### Manual Testing Steps:

1. Run station sync, check station count and data integrity in DB
2. Run aggregation with no new data — verify 0 rows processed, watermark unchanged
3. Collect one snapshot batch, run aggregation — verify correct row count and watermark advance
4. Compare a sample station's availability data before/after to confirm averages are preserved
5. Hit `/stations/{station_id}` API endpoint and verify response matches expectations

## Performance Considerations

- **Station sync**: Single unnest statement for ~827 rows should complete in 10–50ms (benchmarked). Memory footprint: 7 Python lists of ~827 elements each — negligible.
- **Aggregation**: Processing ~14K rows/hour (827 stations x ~17 snapshots/hour) instead of the full table. The PK index on `snapshots.id` handles the `WHERE id > $1` efficiently. Memory footprint: one batch of aggregated results, not the full history.
- **768MB budget**: Both changes reduce memory usage — fewer in-flight rows, shorter transactions.

## Migration Notes

- Migration 004 bootstraps the watermark to `max(id)` from snapshots. This means the first incremental run processes 0 rows — existing averages are trusted.
- **Full recalculation runbook** (if ever needed):
  1. `TRUNCATE station_availability;`
  2. `UPDATE agg_watermark SET last_processed_id = 0, updated_at = now();`
  3. Trigger aggregation (will process all snapshots from the beginning)
  4. Note: this will be slow on a large snapshots table — run during off-hours

## References

- Research: `context/changes/data-pipeline-performance/research.md`
- Station sync code: `app/collector/station_sync.py:9-53`
- Aggregation code: `app/aggregation.py:9-40`
- Snapshot collector: `app/collector/snapshot_collector.py:11-59`
- DB pool config: `app/db.py:4-10`
- Scheduler jobs: `app/main.py:96-114`
- Station availability schema: `alembic/versions/003_create_station_availability.py`
- API layer: `app/api/stations.py:61-90`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Bulk Station Sync

#### Automated

- [x] 1.1 Linting passes: `uv run ruff check .` — 481ecdc
- [x] 1.2 Type checking passes: `uv run mypy .` — 481ecdc
- [x] 1.3 Tests pass: `uv run pytest` — 481ecdc

#### Manual

- [x] 1.4 Station sync completes in under 10 seconds
- [x] 1.5 Station count in DB matches expected
- [x] 1.6 Deactivation logic works correctly

### Phase 2: Incremental Aggregation

#### Automated

- [x] 2.1 Migration applies cleanly: `uv run alembic upgrade head`
- [x] 2.2 Linting passes: `uv run ruff check .` — ef6b573
- [x] 2.3 Type checking passes: `uv run mypy .` — ef6b573
- [x] 2.4 Tests pass: `uv run pytest` — ef6b573

#### Manual

- [x] 2.5 agg_watermark table exists with correct initial value
- [x] 2.6 Aggregation processes 0 rows when no new snapshots exist
- [x] 2.7 Aggregation processes only new batch after snapshot collection
- [x] 2.8 API responses return correct availability data
- [x] 2.9 Logs show new observability attributes
