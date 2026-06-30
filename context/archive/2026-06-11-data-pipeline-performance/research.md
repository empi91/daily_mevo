---
date: 2026-06-11T12:00:00+02:00
researcher: Claude
git_commit: bb8e937df786e4ef49c67fb0b2f692ba0fd476dd
branch: main
repository: daily_mevo
topic: "Data pipeline performance: bulk upsert and incremental aggregation"
tags: [research, codebase, performance, asyncpg, postgresql, aggregation]
status: complete
last_updated: 2026-06-11
last_updated_by: Claude
---

# Research: Data pipeline performance optimization

**Date**: 2026-06-11
**Git Commit**: bb8e937
**Branch**: main
**Repository**: daily_mevo

## Research Question

What are the industry-standard solutions for (1) replacing per-row INSERT...ON CONFLICT with bulk operations in asyncpg/PostgreSQL, and (2) optimizing full-table GROUP BY aggregation on a growing time-series table?

## Summary

**E-03 (station sync)**: The current code does 827 individual `conn.execute()` calls in a Python loop. The simplest effective fix is switching to **unnest-based single-statement upsert** — one SQL round-trip instead of 827. Expected improvement: 46–200s → 10–50ms. Alternative: COPY to temp table + merge (more boilerplate, marginally faster). `executemany()` is a minimal-change option that would also meet the <10s target.

**E-04 (aggregation)**: The current code does a full GROUP BY over the entire `snapshots` table every hour. The fix is **incremental aggregation with a high-water mark** — process only new rows since last run, merge into existing averages using a weighted formula. This makes the hourly job O(new rows) instead of O(all rows), keeping execution time constant as data grows.

**Snapshot collector** (`collect_snapshots`): Already uses `executemany()` which pipelines prepared statement executions. For 827 rows every 5 minutes this is adequate — no change needed unless PgBouncer transaction pooling is added later.

## Detailed Findings

### E-03: Station sync bulk upsert

**Current code** (`app/collector/station_sync.py:18-41`): Loops over ~827 stations, executing individual `INSERT...ON CONFLICT` per station within a single transaction. Each iteration is a separate SQL round-trip.

#### Option A: Unnest-based single-statement upsert (RECOMMENDED)

Passes all data as PostgreSQL arrays, expands with `unnest()` in a single INSERT...ON CONFLICT. One round-trip, one query plan.

```python
station_ids = [s.station_id for s in stations]
names = [s.name for s in stations]
addresses = [s.address for s in stations]
lats = [s.lat for s in stations]
lons = [s.lon for s in stations]
capacities = [s.capacity for s in stations]
is_virtuals = [s.is_virtual_station for s in stations]

await conn.execute("""
    INSERT INTO stations (station_id, name, address, lat, lon, capacity, is_virtual, is_active, updated_at)
    SELECT * FROM unnest(
        $1::text[], $2::text[], $3::text[],
        $4::float8[], $5::float8[], $6::int[],
        $7::boolean[]
    ), TRUE, now()
    ON CONFLICT (station_id) DO UPDATE SET
        name = EXCLUDED.name,
        address = EXCLUDED.address,
        lat = EXCLUDED.lat,
        lon = EXCLUDED.lon,
        capacity = EXCLUDED.capacity,
        is_virtual = EXCLUDED.is_virtual,
        is_active = TRUE,
        updated_at = now()
""", station_ids, names, addresses, lats, lons, capacities, is_virtuals)
```

- **Performance**: 10–50ms for ~800 rows (benchmarked)
- **ON CONFLICT**: Fully supported, no tricks needed
- **Gotcha**: One Python list per column (transposed from row-oriented data). Type annotations (`$1::text[]`) are required.

#### Option B: COPY to temp table + merge

Uses PostgreSQL's binary COPY protocol (single streaming transfer), then a single INSERT...SELECT...ON CONFLICT from the temp table.

```python
async with conn.transaction():
    await conn.execute(
        "CREATE TEMPORARY TABLE _stations_staging (LIKE stations INCLUDING ALL) ON COMMIT DROP"
    )
    await conn.copy_records_to_table(
        '_stations_staging',
        records=[(s.station_id, s.name, s.address, s.lat, s.lon, s.capacity, s.is_virtual_station) for s in stations],
        columns=['station_id', 'name', 'address', 'lat', 'lon', 'capacity', 'is_virtual']
    )
    await conn.execute("""
        INSERT INTO stations (station_id, name, address, lat, lon, capacity, is_virtual, is_active, updated_at)
        SELECT station_id, name, address, lat, lon, capacity, is_virtual, TRUE, now()
        FROM _stations_staging
        ON CONFLICT (station_id) DO UPDATE SET
            name = EXCLUDED.name, address = EXCLUDED.address,
            lat = EXCLUDED.lat, lon = EXCLUDED.lon,
            capacity = EXCLUDED.capacity, is_virtual = EXCLUDED.is_virtual,
            is_active = TRUE, updated_at = now()
    """)
```

- **Performance**: Sub-second for 827 rows. COPY is 5–6x faster than executemany per benchmarks.
- **ON CONFLICT**: Supported via the final INSERT...SELECT step.
- **Gotcha**: More boilerplate. Column order must match exactly. Temp table DDL overhead is non-zero.

#### Option C: executemany() (minimal change)

```python
await conn.executemany(
    "INSERT INTO stations (...) VALUES ($1, $2, ...) ON CONFLICT (station_id) DO UPDATE SET ...",
    [(s.station_id, s.name, ...) for s in stations]
)
```

- **Performance**: asyncpg pipelines all bind+execute messages — not truly N round-trips. For 827 rows, likely 1–5 seconds. Would meet <10s target.
- **Gotcha**: With `statement_cache_size=0` (current config), asyncpg still creates and deallocates prepared statements per call — adds overhead. Cannot use RETURNING.

#### Recommendation for E-03

**Unnest-based approach (Option A)** — best performance-to-complexity ratio. Single SQL statement, single round-trip, ~10 lines of code change. The COPY approach is overkill for 827 rows and adds temp table management.

---

### E-04: Aggregation query optimization

**Current code** (`app/aggregation.py:9-40`): Full GROUP BY over entire `snapshots` table, no WHERE clause. Recalculates all-time averages from scratch every hour.

#### Option 1: Incremental aggregation with high-water mark (RECOMMENDED)

**Mechanism**: Track the last processed snapshot `id` in an `agg_watermark` table. Each run processes only `WHERE id > last_processed_id`, then merges into `station_availability` using a weighted average formula.

**Merge formula**:
```
new_avg = (old_avg * old_count + batch_sum) / (old_count + batch_count)
new_count = old_count + batch_count
```

Since `station_availability` already stores `sample_count` and `avg_bikes`, the weighted merge is straightforward.

**SQL pattern**:
```sql
-- 1. Read watermark
SELECT last_processed_id FROM agg_watermark;

-- 2. Aggregate only new rows
WITH batch AS (
    SELECT station_id,
           (EXTRACT(ISODOW FROM (collected_at AT TIME ZONE 'Europe/Warsaw')) - 1)::SMALLINT AS day_of_week,
           (date_trunc('hour', collected_at AT TIME ZONE 'Europe/Warsaw')
            + INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM collected_at AT TIME ZONE 'Europe/Warsaw') / 15))::TIME AS time_slot,
           SUM(bikes_available) AS sum_bikes,
           SUM(ebikes_available) AS sum_ebikes,
           COUNT(*) AS cnt
    FROM snapshots
    WHERE id > $1  -- high-water mark
    GROUP BY station_id, day_of_week, time_slot
)
INSERT INTO station_availability (station_id, day_of_week, time_slot, avg_bikes, avg_ebikes, sample_count, updated_at)
SELECT station_id, day_of_week, time_slot,
       sum_bikes::float8 / cnt, sum_ebikes::float8 / cnt, cnt, now()
FROM batch
ON CONFLICT (station_id, day_of_week, time_slot) DO UPDATE SET
    avg_bikes = (station_availability.avg_bikes * station_availability.sample_count + EXCLUDED.avg_bikes * EXCLUDED.sample_count)
               / (station_availability.sample_count + EXCLUDED.sample_count),
    avg_ebikes = (station_availability.avg_ebikes * station_availability.sample_count + EXCLUDED.avg_ebikes * EXCLUDED.sample_count)
                / (station_availability.sample_count + EXCLUDED.sample_count),
    sample_count = station_availability.sample_count + EXCLUDED.sample_count,
    updated_at = now();

-- 3. Advance watermark
UPDATE agg_watermark SET last_processed_id = (SELECT MAX(id) FROM snapshots WHERE id > $1);
```

All three steps must be in a single transaction for idempotency.

- **Performance**: O(new rows since last run) — ~14K rows/hour (827 stations × ~17 snapshots/hour), vs. the full table. Execution time stays constant as data grows.
- **Preserves all-time averages**: Yes — weighted merge accumulates into existing totals permanently.
- **Idempotency**: If the job crashes, the watermark never advances — next run re-processes the same window. Safe to re-run.
- **Full recalculation**: Reset watermark to 0 and truncate `station_availability` to rebuild from scratch.
- **Complexity**: Low — one new table, modified SQL query. No extensions.

#### Option 2: Materialized views with REFRESH CONCURRENTLY

Does NOT help. `REFRESH CONCURRENTLY` still recalculates the entire view — it only avoids locking reads during refresh. PostgreSQL has no built-in incremental refresh for materialized views. Same O(all rows) cost.

#### Option 3: Table partitioning by time range

Does not fix the aggregation problem. The GROUP BY needs rows from all partitions for all-time averages. Partitioning helps with data management (purging old data) but not with this query pattern. Adds schema complexity with no aggregation benefit.

#### Option 4: Running sum + count (schema enhancement)

Store `sum_bikes` and `sum_ebikes` in `station_availability` instead of (or alongside) `avg_bikes`/`avg_ebikes`. Avoids the float multiply-back step (`old_avg * old_count`) in the merge formula, reducing floating-point drift. Compute `avg_bikes` at query time as `sum_bikes / sample_count`. This is a minor but clean enhancement to Option 1.

#### Option 5: Intermediate daily summary table

Pre-aggregate into a daily summary table, then roll up. Useful if you want to query "how did this station perform last Tuesday specifically" — but adds an extra aggregation layer and job. The high-water mark approach alone is sufficient for the stated requirements.

#### Recommendation for E-04

**Incremental aggregation with high-water mark (Option 1)**, optionally enhanced with stored running sums (Option 4) for cleaner math. This is the standard industry pattern for exactly this problem.

---

### Snapshot collector (no change needed)

**Current code** (`app/collector/snapshot_collector.py:42-51`): Already uses `conn.executemany()` for plain INSERT (no ON CONFLICT). asyncpg's `executemany()` pipelines all bind+execute messages in a single batch over the wire — it is NOT 827 sequential round-trips.

- For 827 rows every 5 minutes, `executemany()` is adequate (20–80ms expected).
- `copy_records_to_table()` would be 3–10x faster (5–15ms) but the absolute gain is negligible.
- Switch to COPY only if PgBouncer transaction pooling is added (prepared statement interaction) or station count grows significantly.

## Code References

- `app/collector/station_sync.py:9-53` — station sync function with per-row upsert loop
- `app/aggregation.py:9-40` — full-table aggregation query
- `app/collector/snapshot_collector.py:11-59` — snapshot collector with executemany
- `app/db.py:4-10` — connection pool creation (statement_cache_size=0)
- `alembic/versions/001_create_stations.py` — stations table schema
- `alembic/versions/002_create_snapshots.py` — snapshots table schema (BIGSERIAL PK, indexes on station_id+collected_at and collected_at)
- `alembic/versions/003_create_station_availability.py` — availability table schema (composite PK: station_id, day_of_week, time_slot)
- `app/main.py:96-114` — APScheduler job configuration (station_sync: 24h, snapshots: 5min, aggregation: 1h)

## Architecture Insights

- The `snapshots.id` BIGSERIAL PK is the natural high-water mark for incremental aggregation — no schema change needed to the snapshots table.
- `station_availability` already stores `sample_count`, which is the denominator needed for weighted average merges.
- `statement_cache_size=0` in `db.py` means asyncpg prepared statements are created and deallocated per call — a minor overhead for `executemany()` but irrelevant for single-statement approaches (unnest) or COPY.
- The deactivation step in station_sync (`UPDATE stations SET is_active = FALSE WHERE station_id != ALL($1)`) is already a single bulk operation and doesn't need optimization.

## Historical Context

- F-01 (data-collection-pipeline) established the current schema and collector architecture. The per-row insert pattern was a correct-first-fast-later choice for the initial implementation.
- S-01 (station-availability-page) added the aggregation layer and hourly job. The full-scan approach was appropriate when the table had days of data.

## Open Questions

1. **Schema migration for running sums**: Should `station_availability` be migrated to store `sum_bikes`/`sum_ebikes` alongside or instead of `avg_bikes`/`avg_ebikes`? The API layer (`app/api/stations.py`) would need to compute averages at query time if raw sums are stored. Trade-off: cleaner aggregation math vs. slightly more query-time computation.
2. **Watermark reset procedure**: Document a runbook for full recalculation (reset watermark to 0, truncate availability table, re-run). This is the recovery path for data corrections.
3. **Monitoring**: Add Logfire spans for aggregation duration and rows-processed to track the improvement and detect future degradation.

## Sources

- [Using staging tables for faster bulk upserts with Python and PostgreSQL (Overflow, 2025)](https://overflow.no/blog/2025/1/5/using-staging-tables-for-faster-bulk-upserts-with-python-and-postgresql/)
- [asyncpg and upserting bulk data (Schinckel.net)](https://schinckel.net/2019/12/13/asyncpg-and-upserting-bulk-data/)
- [asyncpg Discussion #801 — best bulk upsert method](https://github.com/MagicStack/asyncpg/discussions/801)
- [asyncpg Issue #755 — bulk upsert advice](https://github.com/MagicStack/asyncpg/issues/755)
- [asyncpg Issue #1058 — prepared statements with cache disabled](https://github.com/MagicStack/asyncpg/issues/1058)
- [Insert data into Postgres. Fast. (Jacopo Farina)](https://jacopofarina.eu/posts/ingest-data-into-postgres-fast/)
- [pg_incremental: Incremental Data Processing in Postgres (Crunchy Data)](https://www.crunchydata.com/blog/pg_incremental-incremental-data-processing-in-postgres)
- [How We Made Real-Time Data Aggregation Faster by 50,000x (Tiger Data)](https://www.tigerdata.com/blog/how-we-made-real-time-data-aggregation-in-postgres-faster-by-50-000)
- [Incremental View Maintenance — PostgreSQL wiki](https://wiki.postgresql.org/wiki/Incremental_View_Maintenance)
