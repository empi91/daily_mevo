---
date: "2026-06-24T12:00:00+02:00"
researcher: Claude
git_commit: cf09b485f5c1cfbe37762ece6c8e72e22f8d8bd1
branch: main
repository: daily_mevo
topic: "Supabase space tracking & notification issues — why auto-cleaning may not keep DB under limit and why ntfy alerts never fire"
tags: [research, codebase, database, storage, retention, monitoring, ntfy, notifications, supabase]
status: complete
last_updated: "2026-06-24"
last_updated_by: Claude
---

# Research: DB Space Tracking & Notification Issues

**Date**: 2026-06-24T12:00:00+02:00
**Researcher**: Claude
**Git Commit**: cf09b48
**Branch**: main
**Repository**: daily_mevo

## Research Question

Two problems reported:
1. Supabase space tracking and auto-cleaning to stay below the database size limit is not working properly
2. Notifications expected after exceeding certain thresholds were never received

## Summary

**Root cause for notifications: `MEVO_NTFY_TOPIC` was never set in production.** The env var is not in `.env`, not in `.env.example`, and defaults to `None` in `app/config.py:22`. When `None`, the monitoring code silently skips all alerts (`app/monitoring.py:25`). The monitoring job runs and records sizes to `db_size_log`, but never sends a notification. This is the primary reason alerts were never received.

**Root cause for space tracking issues: multiple compounding factors.** The `db_monitor` job does NOT fire at startup (`app/main.py:162-180` — missing from startup tasks), so the first size check is delayed 6 hours. Additionally, all scheduler jobs (including retention and monitoring) are gated behind the `collector_enabled` flag (`app/main.py:37-41`), meaning disabling the collector also silently disables space management. The health endpoint (`app/main.py:288-302`) returns `db_size` data but without timestamps, making it impossible to detect stale/stopped monitoring.

## Detailed Findings

### Problem 1: Notifications Never Received

#### Finding 1.1 — `MEVO_NTFY_TOPIC` never configured (ROOT CAUSE)

**Evidence chain:**
- `app/config.py:22` — `ntfy_topic: str | None = None` (defaults to `None`)
- `.env` (line 1-14) — does NOT contain `MEVO_NTFY_TOPIC`
- `.env.example` (line 1-29) — does NOT document `MEVO_NTFY_TOPIC`
- `app/monitoring.py:25` — `if ntfy_topic and size_mb >= warning_mb:` — when topic is `None`, this short-circuits and the alert is never sent

The monitoring job runs every 6 hours, queries `pg_database_size()`, inserts into `db_size_log`, but the notification branch is dead code in production because the topic was never configured.

#### Finding 1.2 — No warning logged when ntfy is unconfigured

There is no log message at startup or during monitoring runs indicating that alerting is disabled. The code silently skips alerts. A human checking Logfire or stdout would see `"DB size check"` logs with the size but no indication that alerting is off.

#### Finding 1.3 — `.env.example` is stale

The five settings added by the `db-storage-retention` change were never added to `.env.example`:
- `MEVO_SNAPSHOT_RETENTION_DAYS` (default 7)
- `MEVO_NTFY_TOPIC` (default None — **this is the critical one**)
- `MEVO_DB_SIZE_WARNING_MB` (default 400)
- `MEVO_DB_SIZE_CRITICAL_MB` (default 450)
- `MEVO_DB_MONITOR_INTERVAL_HOURS` (default 6)

This makes it easy to deploy without realizing these settings exist.

### Problem 2: Space Tracking & Auto-Cleaning Issues

#### Finding 2.1 — `db_monitor` does NOT fire at startup

`app/main.py:175-180` creates immediate startup tasks for:
- `run_station_sync` (line 175)
- `run_snapshot_collection` (line 177)
- `run_retention` (line 179)

But **NOT** for `run_db_monitor`. The APScheduler `interval` trigger schedules the first run at `now() + interval` (6 hours). So:
- After every app restart, the `db_size_log` table gets no new entries for 6 hours
- The `/health` endpoint's `db_size` field is stale or `null` for 6 hours
- If the app restarts frequently, monitoring could effectively never run

#### Finding 2.2 — All jobs gated behind `collector_enabled`

`app/main.py:37-41`:
```python
if (
    settings.collector_enabled
    and hasattr(app.state, "db_pool")
    and app.state.db_pool
):
```

Retention and monitoring jobs are inside this block. If someone sets `MEVO_COLLECTOR_ENABLED=false` (e.g., to temporarily stop data collection), retention purging and DB size monitoring also stop. The DB would continue growing (from pre-existing data remaining unpurged) with no alerts.

#### Finding 2.3 — Retention fires at startup but aggregation doesn't

`run_retention` fires immediately at startup (line 179), but `run_aggregation` does NOT (missing from startup tasks). The retention job checks `agg_watermark.last_processed_id` to determine the safe deletion boundary. If a restart happens with unaggregated snapshots, retention correctly won't delete them (bounded by watermark), but the 1-hour aggregation delay means the watermark stays stale for that period.

This is not a bug per se, but means the effective retention window is `retention_days + up to 1 hour` of unaggregated data on each restart.

#### Finding 2.4 — Health endpoint lacks monitoring timestamps

`app/main.py:291-293` queries `db_size_log` for the latest size but does NOT return the `recorded_at` timestamp. The response looks like:
```json
{"db_size": {"last_check_mb": 350, "warning_threshold_mb": 400, "critical_threshold_mb": 450}}
```

You cannot tell from this response whether the check ran 6 hours ago or 6 days ago. A stale value looks identical to a fresh one.

#### Finding 2.5 — No retention audit trail

`app/retention.py` logs batch deletions via structlog but does NOT write to any persistent audit table. There is no way to verify from the database that retention ran, when it ran, or how many rows it deleted. The only evidence is:
- Logfire spans (if `LOGFIRE_TOKEN` is set)
- stdout logs (if someone is watching)

#### Finding 2.6 — Job failure spans appear successful in Logfire

`app/main.py:104-114` (retention wrapper):
```python
with logfire.span("scheduled_job:{job_name}", job_name="retention"):
    try:
        deleted = await purge_old_snapshots(...)
        ...
    except Exception:
        logger.exception("Retention job failed")
```

The `except` catches the error before it propagates out of the `with` block, so the Logfire span closes normally. Failed jobs look like successful jobs in the Logfire dashboard — you'd have to search for the error log events specifically.

#### Finding 2.7 — `snapshot_retention_days` defaults to 7, plan specified 14

`app/config.py:21` — `snapshot_retention_days: int = 7`

The original `db-storage-retention` plan specified 14 days as the chosen retention window, but the code default is 7 days. If `MEVO_SNAPSHOT_RETENTION_DAYS` is not set in the production `.env`, the app uses 7 days (more aggressive than intended). This might actually help stay under the limit, but it contradicts the documented decision.

### What IS Working Correctly

1. **Retention purge logic** (`app/retention.py`): The batch deletion with watermark boundary is correctly implemented. The safety guard (`id <= watermark`) prevents deleting unaggregated data.
2. **DB size recording** (`app/monitoring.py:18-20`): The `db_size_log` table gets rows inserted every 6 hours (assuming the job runs).
3. **ntfy alert code** (`app/monitoring.py:31-47`): The alert sending logic itself is correct with proper error handling — it just never gets called because the topic is `None`.
4. **Retention fires at startup** (`app/main.py:179`): The initial cleanup runs on deploy, catching up on any backlog.

## Architecture Insights

The core retention and monitoring implementations are sound. The problems are all in the **operational wiring**:
- Missing env var deployment
- Missing startup fire for monitoring
- Coupling unrelated jobs to a single feature flag
- Silent degradation with no warnings

This is a classic "works in tests, broken in prod" pattern — unit tests pass specific parameters directly, bypassing the config/scheduler/env-var chain that fails in production.

## Code References

- `app/config.py:22` — `ntfy_topic: str | None = None` (defaults to disabled)
- `app/monitoring.py:25` — notification guard that short-circuits on `None` topic
- `app/main.py:37-41` — `collector_enabled` gate covering all scheduler jobs
- `app/main.py:162-167` — `db_monitor` scheduler registration (no startup fire)
- `app/main.py:175-180` — startup tasks (missing `db_monitor`)
- `app/main.py:288-302` — `/health` db_size section (no timestamp)
- `app/main.py:104-114` — retention wrapper swallowing exceptions inside logfire span
- `app/retention.py:6` — `BATCH_SIZE = 100_000`
- `.env` — production env file missing all monitoring/retention vars
- `.env.example` — stale, missing 5 new settings

## Historical Context (from prior changes)

- `context/archive/2026-06-19-db-storage-retention/plan.md` — original implementation plan specifying ntfy.sh alerts, 14-day retention, immediate startup fire for db_monitor
- `context/archive/2026-06-19-db-storage-retention/research.md:349-361` — ntfy.sh chosen as alerting mechanism
- `context/archive/2026-06-19-db-storage-retention/plan.md:124` — plan specified "db_monitor job fires immediately at startup" but this was not implemented

## Fix Concepts

### Fix A — Critical: Enable ntfy notifications (5 min)

1. Add `MEVO_NTFY_TOPIC=<your-topic>` to the production `.env` on Mikr.us
2. Add all 5 missing vars to `.env.example` for documentation
3. Optionally: add a startup log warning when `ntfy_topic` is `None` so silent mode is visible

### Fix B — Critical: Fire `db_monitor` at startup (2 lines)

Add `run_db_monitor` to the startup tasks in `app/main.py:175-180`:
```python
monitor_task = asyncio.create_task(run_db_monitor())
monitor_task.add_done_callback(_log_task_exception)
```
This ensures the first size check happens immediately, not after 6 hours.

### Fix C — Medium: Decouple retention/monitoring from `collector_enabled`

Restructure the scheduler gate so retention and monitoring run even when data collection is disabled. These are maintenance jobs, not collection jobs.

Options:
- Move retention and monitoring scheduler setup outside the `collector_enabled` gate
- Add separate flags (`MEVO_RETENTION_ENABLED`, `MEVO_MONITORING_ENABLED`) if granular control is needed
- Simplest: just gate only the collector-specific jobs (`station_sync`, `snapshot_collection`) behind `collector_enabled`

### Fix D — Medium: Add timestamps to /health db_size response

Include `recorded_at` from the `db_size_log` query so stale monitoring is detectable:
```python
row = await conn.fetchrow(
    "SELECT size_bytes, recorded_at FROM db_size_log ORDER BY id DESC LIMIT 1"
)
```

### Fix E — Low: Add aggregation to startup tasks

Fire `run_aggregation` at startup to minimize the watermark staleness window. This is a minor improvement — the 1-hour delay is not a correctness issue.

### Fix F — Low: Log warning when ntfy is unconfigured

Add a startup log message: `logger.warning("ntfy alerting disabled — set MEVO_NTFY_TOPIC to enable")` so the silent mode is visible in logs/Logfire.

### Fix G — Low: Mark failed logfire spans as errors

Set a span attribute or re-raise after logging so Logfire can distinguish failed from successful job runs:
```python
except Exception:
    logfire.span.set_attribute("error", True)
    logger.exception("Retention job failed")
```

## Verification Suggestions

To confirm these findings against live production:

1. **Check Logfire** for `scheduled_job:db_monitor` spans — do they exist? How frequent? Any gaps?
2. **Query `db_size_log`** via Supabase SQL Editor: `SELECT * FROM db_size_log ORDER BY id DESC LIMIT 20` — is the table populated? What's the latest entry? What size does it show?
3. **Check current DB size**: `SELECT pg_size_pretty(pg_database_size(current_database()))`
4. **Check production .env on Mikr.us** via SSH: does it contain `MEVO_NTFY_TOPIC`?
5. **Check `/health` endpoint**: does `db_size` return data or `null`?

## Open Questions

1. **What is the actual current DB size?** Need to run diagnostic SQL on production to verify whether retention is keeping it under control or if it has exceeded the limit again.
2. **Is `LOGFIRE_TOKEN` set on production?** If not, there's no observability into job execution at all.
3. **Has the Supabase project been paused?** Free tier projects pause after 7 days of inactivity — but with active writes this shouldn't apply. Worth checking.
4. **What ntfy topic should be used?** The user needs to choose a topic name and install the ntfy app on their phone.
