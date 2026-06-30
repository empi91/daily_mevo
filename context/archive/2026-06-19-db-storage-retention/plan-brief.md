# DB Storage Retention & Monitoring — Plan Brief

> Full plan: `context/changes/db-storage-retention/plan.md`
> Research: `context/changes/db-storage-retention/research.md`

## What & Why

The Supabase DB exceeded the 0.5GB free plan limit ~14 days after the data collector went live. The `snapshots` table grows at ~35 MB/day (~1 GB/month) — the original estimate of 50-80MB for 6 months was off by 10-20×. We need an automated retention policy to keep storage bounded and monitoring to catch future threshold breaches.

## Starting Point

The collector inserts ~238K snapshot rows/day into a table with no cleanup mechanism. Three APScheduler jobs exist (station_sync, snapshot_collection, aggregation) but no retention job. The aggregation system uses an ID-based watermark that makes old snapshot deletion safe — data is permanently folded into `station_availability` weighted averages. No storage monitoring or alerting exists.

## Desired End State

A daily retention job automatically deletes snapshots older than 14 days (in safe batches, watermark-bounded). A 6-hourly monitoring job checks DB size, records it for trend tracking, and sends phone alerts via ntfy.sh at 400MB (warning) and 450MB (critical). DB storage stabilizes at ~330-470 MB, safely within the free tier. A runbook guides the one-time manual VACUUM FULL needed after initial bulk purge.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Retention window | 14 days | Balance between data availability and free tier fit (~330-470 MB estimated) | Research |
| Supabase plan | Stay on free tier | $0 cost constraint | Research |
| Cold storage export | Deferred (GitHub issue) | Not needed for immediate fix; planned as future enhancement | Research |
| Alert mechanism | ntfy.sh | Zero-signup, zero-infrastructure, phone app notification | Research |
| Deletion strategy | Batch DELETE with LIMIT 100K | Avoids long-running transactions while being simple to implement | Plan |
| Vacuum approach | Autovacuum + manual VACUUM FULL runbook | App-level VACUUM FULL too risky (ACCESS EXCLUSIVE lock); manual step with runbook | Plan |
| Size tracking | Small `db_size_log` table | Supabase offers no historical storage data; 4 rows/day is negligible | Plan |
| Phasing | Retention + monitoring ship together | Knowing retention works is as important as doing it | Plan |
| Initial cleanup | Retention job self-heals on first run | Automated — deploy and it catches up via batch loop | Plan |

## Scope

**In scope:**
- Daily retention job (batch DELETE, watermark-bounded)
- 6-hourly DB size monitoring with ntfy.sh alerts
- `db_size_log` tracking table (Alembic migration)
- 5 new config settings (retention days, ntfy topic, size thresholds, monitor interval)
- Health endpoint enhancement (retention + db_size status)
- Unit tests for retention and monitoring
- Manual VACUUM FULL runbook
- GitHub issue for cold storage export

**Out of scope:**
- Supabase Pro upgrade
- Cold storage export implementation
- Dropping unused snapshot columns
- Table partitioning
- VACUUM FULL from application code

## Architecture / Approach

Two new modules (`app/retention.py`, `app/monitoring.py`) wired as APScheduler jobs alongside the existing three. Retention reads the aggregation watermark and batch-deletes old snapshots using the existing `idx_snapshots_collected_at` index. Monitoring queries `pg_database_size()`, records to `db_size_log`, and POSTs to ntfy.sh via httpx (already a dependency). Both fire at startup for immediate effect on first deploy.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Retention & Monitoring Infrastructure | Config, migration, retention job, monitoring job, ntfy alerts, APScheduler wiring, tests | 14-day retention is tight for 500MB — may need to reduce to 7 days if actual storage exceeds estimates |
| 2. Documentation & Follow-up | VACUUM FULL runbook, GitHub cold storage issue, RUNNING_TESTS.md update | Runbook accuracy — SQL commands must be verified against Supabase environment |

**Prerequisites:** Production access to Supabase SQL Editor (for manual VACUUM FULL after deploy)
**Estimated effort:** ~1-2 sessions across 2 phases

## Open Risks & Assumptions

- 14-day retention leaves ~330-470 MB — tight for the 500MB free tier. If actual index overhead exceeds estimates, may need to reduce to 7 days.
- Supabase autovacuum timing is not guaranteed — initial bulk purge may not reclaim disk space quickly enough, requiring manual VACUUM FULL.
- ntfy.sh is a third-party service with no SLA — alerts are best-effort.
- `pg_database_size()` may include WAL/system catalog overhead not accounted for in per-table estimates.

## Success Criteria (Summary)

- DB storage stays sustainably under 500MB on production after retention job runs
- Phone alerts arrive when storage crosses 400MB or 450MB thresholds
- `db_size_log` provides a visible trend of storage over time
