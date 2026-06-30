# VACUUM FULL Runbook — Post-Retention Disk Reclamation

After the retention job deletes old snapshots, PostgreSQL marks the space as reusable but does **not** shrink on-disk size. Supabase's free tier measures on-disk size, so a manual `VACUUM FULL` is needed to actually reclaim disk space.

## When to Run

- **After the first retention job run** (initial bulk purge of ~14 days of accumulated data)
- **During a low-traffic window** — `VACUUM FULL` takes an `ACCESS EXCLUSIVE` lock, blocking ALL reads and writes on the table for the duration
- Recommended: early morning (02:00–05:00 CET) when Mevo usage is minimal

## Pre-flight Checks

Run these in the Supabase SQL Editor to confirm the retention job has completed and understand current sizes.

### 1. Verify retention job has run

```sql
-- Check if old snapshots have been purged (should return 0 rows older than 14 days)
SELECT count(*)
FROM snapshots
WHERE collected_at < now() - interval '14 days';
```

If this returns a non-zero count, the retention job hasn't finished yet. Wait for it to complete (check Logfire for `job_name=retention` spans).

### 2. Check current table sizes

```sql
SELECT relname,
       pg_size_pretty(pg_total_relation_size(oid)) AS total,
       pg_size_pretty(pg_relation_size(oid)) AS data,
       pg_size_pretty(pg_indexes_size(oid)) AS indexes
FROM pg_class
WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
ORDER BY pg_total_relation_size(oid) DESC;
```

Record the `snapshots` row — this is the "before" measurement.

### 3. Check total database size

```sql
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;
```

Record this as the "before" database size.

### 4. Check watermark is ahead of remaining snapshots

```sql
SELECT
    (SELECT last_processed_id FROM agg_watermark WHERE id = 1) AS watermark,
    (SELECT min(id) FROM snapshots) AS oldest_snapshot_id,
    (SELECT max(id) FROM snapshots) AS newest_snapshot_id,
    (SELECT count(*) FROM snapshots) AS total_snapshots;
```

The `watermark` should be ≥ `oldest_snapshot_id` (all remaining snapshots should be processed).

## Execute VACUUM FULL

```sql
VACUUM FULL snapshots;
```

### Expected behavior

- **Duration**: 1–5 minutes depending on table size (typically under 2 minutes for ~3M rows)
- **Lock**: `ACCESS EXCLUSIVE` — no other queries can read or write `snapshots` during this time
- **Effect**: Rewrites the entire table and indexes to a new file, reclaiming all dead space
- The app's snapshot collector and aggregation jobs will block (not fail) during the VACUUM — they'll resume automatically when the lock is released

### If it times out

Supabase SQL Editor has a statement timeout (typically 60s for free tier). If `VACUUM FULL` times out:

1. Try running it via the Supabase CLI instead:
   ```bash
   supabase db execute --project-ref <project-ref> "VACUUM FULL snapshots;"
   ```

2. If that also fails, use regular `VACUUM` (no `FULL`) which is faster but only marks space as reusable without shrinking on-disk size:
   ```sql
   VACUUM snapshots;
   ```

3. As a last resort, contact Supabase support or use `pg_repack` (available as an extension on Supabase) which can reclaim space without the heavy lock:
   ```sql
   -- Check if pg_repack is available
   CREATE EXTENSION IF NOT EXISTS pg_repack;
   -- Then run from CLI:
   -- pg_repack --table snapshots --no-superuser-check
   ```

## Post-Verification

### 1. Confirm table size dropped

```sql
SELECT relname,
       pg_size_pretty(pg_total_relation_size(oid)) AS total,
       pg_size_pretty(pg_relation_size(oid)) AS data,
       pg_size_pretty(pg_indexes_size(oid)) AS indexes
FROM pg_class
WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
ORDER BY pg_total_relation_size(oid) DESC;
```

Compare with the "before" measurement. The `snapshots` total size should have dropped significantly (expected: from ~400–500 MB down to ~150–250 MB for 14 days of data).

### 2. Confirm database size dropped

```sql
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;
```

Compare with the "before" database size. Should be well under 500 MB.

### 3. Verify app is healthy

- Check the `/health` endpoint returns successfully
- Check Logfire for any errors during or after the VACUUM window
- Verify the snapshot collector is still inserting new rows:
  ```sql
  SELECT count(*), max(collected_at)
  FROM snapshots
  WHERE collected_at > now() - interval '10 minutes';
  ```

### 4. Check db_size_log recorded the change

```sql
SELECT recorded_at, pg_size_pretty(size_bytes) AS size
FROM db_size_log
ORDER BY recorded_at DESC
LIMIT 5;
```

The next monitoring job run should record the reduced size.

## Ongoing Maintenance

After the initial VACUUM FULL, ongoing maintenance should be minimal:

- **Autovacuum** handles dead tuples from daily retention deletes automatically
- **VACUUM FULL is not needed regularly** — only after the initial bulk purge or if a large backlog accumulates (e.g., after extended downtime)
- Monitor the `db_size_log` table and ntfy alerts for storage trending upward
- If storage creeps above 400 MB, consider reducing `MEVO_SNAPSHOT_RETENTION_DAYS` from 14 to 7
