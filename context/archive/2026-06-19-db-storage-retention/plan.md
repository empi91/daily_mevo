# DB Storage Retention & Monitoring Implementation Plan

## Overview

Supabase DB has exceeded the 0.5GB free plan limit (~14 days after collector went live). The `snapshots` table grows at ~35 MB/day and is the sole storage driver. This plan adds a 14-day retention policy (automated batch deletion of old snapshots), DB size monitoring with ntfy.sh alerts, and a size tracking table for trend visibility — all shipped together as a single phase.

## Current State Analysis

- **Snapshots table**: INSERT-only, ~238K rows/day, ~35 MB/day (data + indexes). No retention logic exists anywhere.
- **Aggregation**: Incremental watermark-based (`app/aggregation.py:9-90`). Snapshots with `id <= agg_watermark.last_processed_id` are safe to delete — their data is permanently folded into `station_availability` weighted averages.
- **APScheduler**: 3 existing jobs in `app/main.py:99-117` (station_sync, snapshot_collection, aggregation). Adding a 4th follows the same pattern.
- **Config**: Pydantic settings with `MEVO_` env prefix (`app/config.py`). New settings follow the same pattern.
- **Dependencies**: `httpx>=0.28` already installed — usable for ntfy.sh POST calls.

### Key Discoveries:

- `idx_snapshots_collected_at` index was designed for retention queries (noted in F-01 archive plan, line 172)
- The watermark only advances forward — deleting `id <= watermark` rows is always safe (`app/aggregation.py:51` only queries `id > watermark`)
- Supabase autovacuum handles dead tuples automatically, but won't shrink on-disk size. Manual `VACUUM FULL` needed after initial bulk purge.
- No Supabase API for historical storage usage — must track ourselves

## Desired End State

After this plan is complete:
- A daily APScheduler job deletes snapshots older than 14 days (in batches of 100K, watermark-bounded)
- A 6-hourly APScheduler job checks `pg_database_size()`, logs the result, records it in a `db_size_log` table, and sends ntfy.sh alerts at 400MB (warning) and 450MB (critical)
- Five new config settings control retention and monitoring behavior
- The app self-heals on first run — the retention job catches up and deletes all historical data beyond 14 days
- A step-by-step VACUUM FULL runbook exists for the first-time disk reclamation
- A GitHub enhancement issue tracks future cold storage export

Verification: DB size stays under 500MB on production, ntfy alerts fire at thresholds, `db_size_log` table shows daily trend, structlog entries confirm retention and monitoring runs.

## What We're NOT Doing

- **Supabase Pro upgrade** — staying on free tier ($0)
- **Cold storage export** — deferred to a future enhancement (GitHub issue created)
- **Dropping unused snapshot columns** (`docks_available`, `is_installed`, `is_renting`, `is_returning`) — minor optimization, separate change
- **VACUUM FULL from application code** — too risky (ACCESS EXCLUSIVE lock); handled via manual runbook
- **Partitioning the snapshots table** — retention DELETE is sufficient at this scale

## Implementation Approach

Single-phase delivery: config + migration + retention job + monitoring job + ntfy alerts + APScheduler wiring. The research doc explicitly states monitoring should ship alongside retention. The retention job handles the one-time initial cleanup automatically (loops batch deletes on first run).

## Critical Implementation Details

**Batch deletion ordering**: The DELETE must filter on BOTH `collected_at < cutoff` AND `id <= watermark`. The `collected_at` filter uses the existing `idx_snapshots_collected_at` index for efficient scanning. The `id <= watermark` guard prevents deleting unprocessed snapshots even if the clock is correct.

**ntfy.sh failure isolation**: If ntfy.sh is unreachable, the monitoring job must log a warning and continue — alerting failure must not crash the app or prevent size logging.

## Phase 1: Retention & Monitoring Infrastructure

### Overview

Add all config settings, the `db_size_log` migration, the retention job, the monitoring job with ntfy.sh alerts, and wire everything into APScheduler.

### Changes Required:

#### 1. Config Settings

**File**: `app/config.py`

**Intent**: Add five new settings for retention window, ntfy topic, monitoring thresholds, and monitoring interval. All optional with sensible defaults so the app works without any env changes.

**Contract**: New fields on `Settings` class:
- `snapshot_retention_days: int = 14`
- `ntfy_topic: str | None = None` (alerts disabled when None)
- `db_size_warning_mb: int = 400`
- `db_size_critical_mb: int = 450`
- `db_monitor_interval_hours: int = 6`

#### 2. Alembic Migration — `db_size_log` table

**File**: `alembic/versions/006_create_db_size_log.py`

**Intent**: Create a small tracking table to record DB size over time, providing the historical trend that Supabase doesn't offer natively.

**Contract**: New migration `006`, revises `005`. Table schema:
```sql
CREATE TABLE db_size_log (
    id SERIAL PRIMARY KEY,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    size_bytes BIGINT NOT NULL
)
```
No indexes beyond the PK — the table grows at ~4 rows/day and will be queried rarely.

#### 3. Retention Module

**File**: `app/retention.py` (new file)

**Intent**: Implement the snapshot retention logic — batch deletion of snapshots older than the retention window, bounded by the aggregation watermark. Returns the total number of rows deleted for logging.

**Contract**: Single async function `purge_old_snapshots(pool: asyncpg.Pool, retention_days: int) -> int`. Internally:
- Reads `last_processed_id` from `agg_watermark`
- Loops: `DELETE FROM snapshots WHERE collected_at < now() - interval '<N> days' AND id <= $watermark LIMIT 100000` until no rows deleted
- Returns total deleted count
- Uses `structlog` for per-batch logging (rows deleted, batches completed)

#### 4. Monitoring Module

**File**: `app/monitoring.py` (new file)

**Intent**: Implement DB size checking, recording to `db_size_log`, and ntfy.sh alerting. Isolated from retention so each job has a clear responsibility.

**Contract**: Single async function `check_db_size(pool: asyncpg.Pool, ntfy_topic: str | None, warning_mb: int, critical_mb: int) -> float`. Internally:
- Queries `SELECT pg_database_size(current_database())`
- Inserts a row into `db_size_log`
- If `ntfy_topic` is set and thresholds exceeded, sends POST to `https://ntfy.sh/{topic}` via `httpx.AsyncClient`
  - 450MB+: priority 5 (urgent), title "MevoStats DB Storage CRITICAL"
  - 400MB+: priority 3 (default), title "MevoStats DB Storage WARNING"
- If ntfy POST fails, logs warning and continues
- Returns size in MB

#### 5. APScheduler Wiring

**File**: `app/main.py`

**Intent**: Add two new scheduled jobs to the existing APScheduler setup — retention (daily) and monitoring (every N hours). Follow the exact same pattern as the existing three jobs (structlog contextvars, logfire span, try/except).

**Contract**: Two new jobs added to the scheduler at `app/main.py` (after line 117):
- `retention` job: interval `hours=24`, calls `purge_old_snapshots(pool, settings.snapshot_retention_days)`
- `db_monitor` job: interval `hours=settings.db_monitor_interval_hours`, calls `check_db_size(pool, settings.ntfy_topic, settings.db_size_warning_mb, settings.db_size_critical_mb)`

Both jobs follow the existing wrapper pattern: `run_retention()` and `run_db_monitor()` async functions with structlog contextvars, logfire spans, and exception handling.

The retention job should also fire immediately at startup (like `station_sync` and `snapshot_collection` do at lines 125-128) to handle initial cleanup on first deploy.

#### 6. Health Endpoint Enhancement

**File**: `app/main.py`

**Intent**: Add retention and monitoring status to the `/health` endpoint response, so operational health is visible without checking logs.

**Contract**: Add to the health response dict:
- `"retention": {"enabled": True, "retention_days": N}` — static info
- `"db_size": {"last_check_mb": N, "warning_threshold_mb": N, "critical_threshold_mb": N}` — from most recent `db_size_log` entry (if table exists and has data), otherwise `null`

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `uv run alembic upgrade head`
- Linting passes: `uv run ruff check .`
- Formatting passes: `uv run ruff format --check .`
- Type checking passes: `uv run mypy .`
- Existing tests pass: `uv run pytest`
- New retention module has unit tests covering: batch deletion logic, watermark boundary, empty table case
- New monitoring module has unit tests covering: size recording, ntfy alert thresholds, ntfy failure handling
- App starts without errors: `uv run uvicorn app.main:app` with `MEVO_NTFY_TOPIC` unset (alerts disabled by default)

#### Manual Verification:

- Deploy to production and verify retention job runs on startup (check Logfire for `job_name=retention` spans)
- Verify DB size decreases after retention runs (run diagnostic SQL in Supabase SQL Editor)
- Verify `db_size_log` table receives entries every 6 hours
- Set `MEVO_NTFY_TOPIC` to a test topic and verify ntfy alerts arrive on phone when thresholds are crossed
- Verify `/health` endpoint includes retention and db_size sections
- After initial cleanup, run `VACUUM FULL snapshots` via Supabase SQL Editor using the runbook, then verify disk size dropped

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Documentation & Follow-up

### Overview

Write the manual VACUUM FULL runbook for first-time disk reclamation and create a GitHub enhancement issue for future cold storage export.

### Changes Required:

#### 1. VACUUM FULL Runbook

**File**: `context/changes/db-storage-retention/VACUUM_RUNBOOK.md` (new file)

**Intent**: Provide a step-by-step guide for the one-time manual VACUUM FULL operation needed after the initial bulk purge. This is critical because autovacuum marks space reusable but doesn't shrink on-disk size — and the Supabase free tier measures on-disk size.

**Contract**: The runbook must include:
- Pre-flight checks (verify retention job has completed, check current table sizes)
- Exact SQL commands to run in Supabase SQL Editor
- Diagnostic queries before and after
- Expected duration and lock implications (ACCESS EXCLUSIVE — blocks all queries)
- When to run (low-traffic window)
- What to do if it times out
- Post-verification (confirm disk size dropped)

#### 2. GitHub Enhancement Issue — Cold Storage Export

**Intent**: Create a GitHub issue tracking the future cold storage export enhancement (daily export of old snapshots to compressed CSV on Cloudflare R2 free tier).

**Contract**: Issue with title matching the project's naming convention, body covering the scope from the research doc's "Future Enhancement Note" section.

#### 3. Update RUNNING_TESTS.md

**File**: `context/RUNNING_TESTS.md`

**Intent**: Add the new test commands for retention and monitoring modules to the project's test reference.

**Contract**: Append section for db-storage-retention tests with the relevant `uv run pytest` commands.

### Success Criteria:

#### Automated Verification:

- Runbook file exists and is well-structured markdown
- GitHub issue created successfully with correct labels

#### Manual Verification:

- Runbook steps are accurate and complete (verify SQL commands are correct against Supabase documentation)
- GitHub issue is properly labelled and linked to issue #25

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- `tests/test_retention.py`:
  - Batch deletion respects watermark boundary (won't delete `id > watermark`)
  - Batch deletion respects retention window (won't delete recent snapshots)
  - Returns 0 when no snapshots qualify for deletion
  - Handles empty snapshots table gracefully
  - Multiple batches process correctly (mock > 100K qualifying rows)

- `tests/test_monitoring.py`:
  - Records size to `db_size_log` table
  - Sends ntfy alert at warning threshold (400MB+)
  - Sends ntfy alert at critical threshold (450MB+) with priority 5
  - No alert sent below warning threshold
  - No alert sent when `ntfy_topic` is None
  - Handles ntfy.sh failure gracefully (logs warning, doesn't raise)

### Integration Tests:

- Retention + aggregation coordination: run aggregation, then retention, verify watermark is respected
- Full lifecycle: insert snapshots → aggregate → purge → verify averages unchanged

### Manual Testing Steps:

1. Deploy to production, check Logfire for retention and monitoring job spans
2. Run `SELECT count(*) FROM snapshots` before and after retention job runs
3. Run diagnostic SQL to verify table sizes dropped
4. Test ntfy alerts by temporarily lowering thresholds
5. Check `/health` endpoint for new sections
6. Execute VACUUM FULL runbook and verify disk size reduction

## Performance Considerations

- Batch DELETE with LIMIT 100K prevents long-running transactions. Each batch takes ~1-2 seconds.
- Initial cleanup of ~14 days of data (~3.3M rows) requires ~33 batches — the startup task handles this automatically.
- The `idx_snapshots_collected_at` index ensures the DELETE WHERE clause is index-scanned, not sequential.
- Monitoring queries (`pg_database_size`, `INSERT INTO db_size_log`) are lightweight (<10ms each).
- ntfy.sh POST is async via httpx — non-blocking.

## Migration Notes

- Migration `006` is additive (new table only) — no data migration needed.
- No changes to existing tables or indexes.
- Rollback: `alembic downgrade 005` drops `db_size_log`. Retention job removal is a code revert.

## References

- Research: `context/changes/db-storage-retention/research.md`
- Aggregation watermark pattern: `app/aggregation.py:9-90`
- Existing APScheduler setup: `app/main.py:99-128`
- Config pattern: `app/config.py:1-25`
- Snapshots index for retention queries: `alembic/versions/002_create_snapshots.py:33` (`idx_snapshots_collected_at`)
- GitHub issue #25 (Supabase DB exceeding 0.5GB)
- GitHub issue #11 (retention policy review)

## Progress

### Phase 1: Retention & Monitoring Infrastructure

#### Automated

- [x] 1.1 Migration applies cleanly: `uv run alembic upgrade head` — 74abe75
- [x] 1.2 Linting passes: `uv run ruff check .` — 74abe75
- [x] 1.3 Formatting passes: `uv run ruff format --check .` — 74abe75
- [x] 1.4 Type checking passes: `uv run mypy .` — 74abe75
- [x] 1.5 Existing tests pass: `uv run pytest` — 74abe75
- [x] 1.6 New retention unit tests pass — 74abe75
- [x] 1.7 New monitoring unit tests pass — 74abe75
- [x] 1.8 App starts without errors with `MEVO_NTFY_TOPIC` unset — 74abe75

#### Manual

- [ ] 1.9 Retention job runs on startup in production (Logfire spans)
- [ ] 1.10 DB size decreases after retention runs (diagnostic SQL)
- [ ] 1.11 `db_size_log` table receives entries every 6 hours
- [ ] 1.12 ntfy alerts arrive on phone when thresholds crossed
- [ ] 1.13 `/health` endpoint includes retention and db_size sections
- [ ] 1.14 VACUUM FULL executed via runbook, disk size drops

### Phase 2: Documentation & Follow-up

#### Automated

- [x] 2.1 Runbook file exists and is well-structured
- [x] 2.2 GitHub issue created with correct labels

#### Manual

- [x] 2.3 Runbook SQL commands verified against Supabase
- [x] 2.4 GitHub issue properly labelled and linked to #25
