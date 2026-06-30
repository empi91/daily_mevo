---
date: "2026-06-19T00:21:36+02:00"
researcher: Claude
git_commit: 8476cf7ec04b4c1b6e242a96d256039763d9ec7f
branch: main
repository: daily_mevo
topic: "Supabase DB storage exceeding 0.5GB free plan — diagnosis, retention strategy, and resolution options"
tags: [research, codebase, database, storage, retention, supabase, snapshots, aggregation]
status: complete
last_updated: "2026-06-19"
last_updated_by: Claude
last_updated_note: "Added user decisions, Supabase historical usage research, cold storage enhancement note"
---

# Research: DB Storage & Retention

**Date**: 2026-06-19T00:21:36+02:00
**Researcher**: Claude
**Git Commit**: 8476cf7
**Branch**: main
**Repository**: daily_mevo

## Research Question

Supabase DB has exceeded the 0.5GB free plan limit (issue #25). Investigate what's consuming storage, how retention interacts with the aggregation system, and what the resolution options are — including retention policies, cleanup mechanics, and cost/upgrade analysis.

## Summary

The `snapshots` table is almost certainly the sole storage driver. With ~827 stations × 288 cycles/day = **~238K rows/day**, the original estimate of "50-80MB for 6 months" (issue #11) was off by roughly **10-20×**. Realistic growth is **~30-50 MB/day** (data + indexes), meaning the 500MB free tier fills in **10-17 days** — aligning with the ~14 days since the collector went live on 2026-06-05.

The aggregation system uses an ID-based watermark. Once snapshots are processed (folded into `station_availability` weighted averages), old rows are **safe to delete** without affecting current averages. The tradeoff: deleting old snapshots means losing the ability to do a full recalculation from raw data beyond the retention window.

Three viable paths exist: (A) retention policy deleting old snapshots, (B) Supabase Pro upgrade ($25/month, 8GB), or (C) both. Each has clear tradeoffs detailed below.

## Detailed Findings

### 1. Storage Diagnosis

#### Table inventory

| Table | Est. rows/day | Row size (bytes) | Purpose |
|---|---|---|---|
| `snapshots` | ~238,000 | ~90 | Raw availability data (INSERT-only) |
| `station_availability` | 0 (UPSERT) | ~60 | Aggregated averages (~827 stations × 7 days × 96 slots = ~556K rows max) |
| `stations` | 0 | ~100 | Station metadata (~827 rows, static) |
| `agg_watermark` | 0 | ~20 | Singleton row |
| `users` | negligible | ~350 | User accounts |

**`snapshots` dominates storage.** All other tables combined are under 50 MB even at scale.

#### Growth rate calculation

- **Raw data**: 238K rows/day × ~90 bytes/row ≈ **21 MB/day**
- **Index overhead**: Two indexes (`station_id, collected_at` composite + `collected_at`) add ~50-80% ≈ **11-17 MB/day**
- **Total**: **~32-38 MB/day**, or **~960 MB - 1.1 GB/month**

The original estimate (issue #11, plan.md line 20) assumed 50-80MB for 6 months. That was ~10-20× too low, likely due to underestimating row count or ignoring index overhead.

#### Why the original estimate was wrong

The F-01 plan (archived) stated: "Supabase free tier has 500MB storage; estimated raw snapshot storage is ~50-80MB for 6 months." This appears to have used a much lower station count or smaller row size. The actual station count (~827) combined with index overhead makes the real growth rate roughly 1 GB/month.

#### Index details on `snapshots`

| Index name | Columns | Estimated overhead |
|---|---|---|
| `snapshots_pkey` | `id` (BIGSERIAL) | ~8 bytes/row |
| `idx_snapshots_station_collected` | `(station_id, collected_at)` | ~30-40 bytes/row |
| `idx_snapshots_collected_at` | `(collected_at)` | ~16 bytes/row |

All three indexes grow linearly with the snapshots table. The composite index is the largest.

#### Dead tuple / bloat assessment

The `snapshots` table is INSERT-only (no UPDATEs or DELETEs), so dead tuple bloat should be **negligible** currently. Supabase runs autovacuum automatically. However, once a retention policy starts DELETEing old rows, dead tuples will spike temporarily after each cleanup batch. Standard VACUUM marks the space as reusable within the table but does **not** shrink disk size. `VACUUM FULL` or `pg_repack` is needed to actually reclaim on-disk space.

#### TOAST

All columns are small fixed-size types (integers, booleans, timestamps, short text). TOAST overhead is **negligible**.

### 2. Aggregation System & Retention Safety

#### How aggregation works

Defined in `app/aggregation.py:1-91`:

1. Reads `last_processed_id` from singleton `agg_watermark` table
2. Queries `SELECT MAX(id) FROM snapshots` to find the current ceiling
3. Aggregates all snapshots where `id > last_processed_id AND id <= current_max`
4. For each (station_id, day_of_week, 15-min time_slot): computes SUM(bikes), SUM(ebikes), COUNT
5. UPSERTs into `station_availability` using **weighted average merge**:
   ```sql
   avg_bikes = (old_avg * old_count + new_avg * new_count) / (old_count + new_count)
   ```
6. Advances watermark to `current_max`
7. Everything runs in a single transaction

**Scheduling**: Runs every 1 hour via APScheduler (`app/main.py:99-117`).

#### Which snapshot columns aggregation reads

- `id` — watermark filtering
- `station_id` — grouping key
- `collected_at` — timezone conversion to derive day_of_week and time_slot
- `bikes_available`, `ebikes_available` — summed for averages

Does **not** read: `docks_available`, `is_installed`, `is_renting`, `is_returning`.

#### Safe deletion boundary

**Snapshots with `id <= agg_watermark.last_processed_id` are safe to delete.** Their data has already been folded into `station_availability` weighted averages. The aggregation only processes `id > watermark`, so deleting below the watermark has zero effect on future aggregation runs.

#### What you lose by deleting old snapshots

1. **Full recalculation** — The documented runbook (data-pipeline-performance plan, lines 196-201) requires all historical snapshots:
   ```
   TRUNCATE station_availability;
   UPDATE agg_watermark SET last_processed_id = 0;
   -- trigger aggregation to reprocess everything
   ```
   After retention purges, recalculation can only go back to the oldest surviving snapshot.

2. **Ad-hoc historical queries** — Any future analysis on raw data (e.g., "what was station X's actual availability on June 10 at 8:15am?") loses access to purged rows.

3. **Schema/formula changes** — If the aggregation formula changes (e.g., adding median or percentile), you can only recompute from surviving raw data.

#### Watermark coordination

The roadmap warns: "Deleting old snapshots could break aggregation if the watermark references purged rows." This is **not a real risk** — the watermark tracks the last *processed* ID. Deleting rows with `id <= watermark` is safe because those rows will never be queried again. The only dangerous scenario would be resetting the watermark to 0 after purging, which would try to re-aggregate deleted rows and produce incorrect (lower) averages due to missing data.

**Safe retention rule**: `DELETE FROM snapshots WHERE id <= (SELECT last_processed_id FROM agg_watermark) AND collected_at < <cutoff_date>`

### 3. Retention Strategy Options

#### Option A: Time-based retention (DELETE old snapshots)

| Retention window | Est. rows kept | Est. storage (data + indexes) | Fits free tier? |
|---|---|---|---|
| 7 days | ~1.7M | ~170-240 MB | Yes |
| 14 days | ~3.3M | ~330-470 MB | Tight |
| 30 days | ~7.1M | ~710 MB - 1 GB | No |
| 90 days | ~21M | ~2.1-3 GB | No (needs Pro) |

**Recommended retention for free tier**: **7-14 days**. Since aggregation has already folded old data into averages, the raw snapshots beyond 1-2 weeks provide diminishing value — their main use is full recalculation, which can be scoped to the retention window.

**Implementation approach**:
- Scheduled job (APScheduler, alongside existing jobs) runs daily
- `DELETE FROM snapshots WHERE collected_at < now() - interval '<N> days' AND id <= (SELECT last_processed_id FROM agg_watermark)`
- The `idx_snapshots_collected_at` index was designed for exactly this query (noted in F-01 plan, line 172)
- After bulk delete: run `VACUUM snapshots` to mark space reusable, or `VACUUM FULL snapshots` / `pg_repack` to actually shrink disk
- On Supabase, standard VACUUM runs automatically via autovacuum. For immediate disk reclamation after a large purge, `VACUUM FULL` or `pg_repack` may be needed

**One-time cleanup**: Before the scheduled job helps, a one-time purge of historical data is needed to get back under 500MB.

#### Option B: Supabase Pro upgrade ($25/month)

| Aspect | Free tier | Pro plan |
|---|---|---|
| DB storage | 500 MB | 8 GB |
| File storage | 1 GB | 100 GB |
| MAUs | 50,000 | 100,000 |
| Bandwidth | 5 GB | 250 GB |
| Price | $0 | $25/month |
| Project pausing | Yes (7 days inactivity) | No |

**At ~1 GB/month growth**, Pro's 8 GB gives **~8 months of headroom** without any retention policy. With a 90-day retention policy on Pro, storage would stabilize at ~2-3 GB — sustainable indefinitely.

#### Option C: Retention + Pro (belt and suspenders)

Upgrade to Pro for headroom and add a 30-90 day retention policy to keep storage bounded long-term. This is the most sustainable approach if the project expects to run for months/years.

### 4. Cost/Upgrade Analysis

| Approach | Monthly cost | Max storage | Maintenance effort | Data loss |
|---|---|---|---|---|
| Free + 7-day retention | $0 | ~240 MB | Medium (implement + monitor retention job) | High (only 7 days of raw data) |
| Free + 14-day retention | $0 | ~470 MB | Medium | Medium (14 days of raw data) |
| Pro only (no retention) | $25 | Grows ~1 GB/month, hits 8 GB in ~8 months | Low (just upgrade) | None |
| Pro + 30-day retention | $25 | ~1 GB stable | Medium | Low (30 days) |
| Pro + 90-day retention | $25 | ~3 GB stable | Medium | Very low (90 days) |

**If budget allows**: Pro + 30-day retention is the sweet spot — eliminates the immediate crisis, provides generous headroom, and keeps raw data long enough for any reasonable recalculation.

**If staying free**: 7-day retention is the only option that fits comfortably. 14 days is possible but leaves little margin.

### 5. Implementation Considerations

#### One-time cleanup steps

1. Run diagnostic queries to confirm actual table sizes:
   ```sql
   SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) AS total,
          pg_size_pretty(pg_relation_size(oid)) AS data,
          pg_size_pretty(pg_indexes_size(oid)) AS indexes
   FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
   ORDER BY pg_total_relation_size(oid) DESC;
   ```
2. Verify watermark is current: `SELECT last_processed_id FROM agg_watermark WHERE id = 1`
3. Delete old snapshots in batches (to avoid long-running transactions):
   ```sql
   DELETE FROM snapshots WHERE id IN (
     SELECT id FROM snapshots
     WHERE collected_at < now() - interval '<N> days'
       AND id <= (SELECT last_processed_id FROM agg_watermark)
     LIMIT 50000
   );
   -- repeat until no rows deleted
   ```
4. Run `VACUUM FULL snapshots` or `pg_repack` to reclaim on-disk space
5. Verify: `SELECT pg_size_pretty(pg_database_size(current_database()))`

#### Ongoing retention job

- New scheduled function in `app/` or addition to existing APScheduler setup
- Runs daily (not every 5 minutes — daily is sufficient)
- Deletes snapshots older than the retention window, bounded by watermark
- Logs rows deleted for observability (Logfire)

#### Columns to drop (minor optimization)

The `docks_available`, `is_installed`, `is_renting`, `is_returning` columns are stored but never read by aggregation. Dropping them would save ~10 bytes/row (~10% of row size). This is a minor optimization — retention policy has far greater impact. Could be considered in a future cleanup.

#### Alembic migration

A new migration would be needed for:
- The retention job (if implemented as a PostgreSQL function/procedure)
- Any column drops
- No migration needed if retention is purely application-side (Python scheduled job)

## Code References

- `alembic/versions/001_create_stations.py:20-31` — stations table schema
- `alembic/versions/002_create_snapshots.py:20-35` — snapshots table schema + indexes
- `alembic/versions/003_create_station_availability.py:20-33` — aggregation target table
- `alembic/versions/004_create_agg_watermark.py:20-28` — watermark singleton table
- `alembic/versions/005_create_users.py:20-28` — users table
- `app/aggregation.py:11-80` — incremental aggregation with watermark pattern
- `app/aggregation.py:34-74` — core aggregation SQL with weighted merge
- `app/main.py:99-117` — APScheduler job definitions (1h aggregation, 5min snapshots)
- `app/collector/snapshot_collector.py` — INSERT into snapshots
- `app/collector/station_sync.py` — UPSERT into stations
- `app/config.py:12` — collector_interval_seconds default (300s)

## Architecture Insights

1. **The watermark pattern makes retention safe.** This is the key architectural insight: because aggregation is incremental and one-directional (only processes `id > watermark`), old snapshots can be deleted without affecting current or future averages. The weighted merge in `station_availability` is a permanent accumulator.

2. **The `idx_snapshots_collected_at` index was designed for retention.** The F-01 plan explicitly noted this index supports "retention/cleanup queries" — the team anticipated this need from day one.

3. **INSERT-only workload means no current bloat.** The snapshots table has no UPDATEs or DELETEs, so dead tuples are negligible today. Once retention DELETEs start, autovacuum will handle ongoing dead tuples, but the initial bulk purge will need manual VACUUM FULL or pg_repack.

4. **No existing cleanup code exists.** The application has zero retention logic — it was explicitly deferred in F-01 to issue #11, which estimated a 6-month revisit timeline. The DB hit the limit in ~2 weeks instead.

## Historical Context (from prior changes)

- `context/archive/2026-06-04-data-collection-pipeline/plan.md:42` — "Data retention / cleanup -- keep all data; retention review tracked as a GitHub issue"
- `context/archive/2026-06-04-data-collection-pipeline/plan.md:20` — "Supabase free tier has 500MB storage; estimated raw snapshot storage is ~50-80MB for 6 months" (incorrect estimate)
- `context/archive/2026-06-04-data-collection-pipeline/plan.md:172` — `collected_at` index noted as supporting "retention/cleanup queries"
- `context/archive/2026-06-04-data-collection-pipeline/plan.md:304-308` — Created GitHub issue #11 for 6-month retention review
- `context/archive/2026-06-11-data-pipeline-performance/plan.md:196-201` — Full recalculation runbook (TRUNCATE station_availability + reset watermark)
- `context/archive/2026-06-11-data-pipeline-performance/research.md:126-178` — Weighted merge formula analysis confirming averages are permanent once folded in

## Related Research

- Issue #25 — "Supabase DB exceeding 0.5GB free plan limit" (OPEN, bug label)
- Issue #11 — "Review raw snapshot data retention policy (6-month check)" (OPEN, no labels)
- `context/foundation/test-plan.md:49` — Risk #8: "Unbounded snapshot growth exhausts DB storage" (High/High)
- `context/foundation/test-plan.md:75` — Phase 4: "DB storage retention" (not started)

## User Decisions (2026-06-19)

1. **Retention window: 14 days.** Tight for the free tier (~330-470 MB estimated) but chosen as a balance between data availability and storage. Must be monitored — if actual storage exceeds ~450 MB, reduce to 7 days.
2. **No Supabase Pro upgrade.** Must stay on the free tier ($0).
3. **No cold storage export for now.** Full recalculation is limited to the 14-day retention window. Accepted tradeoff.
4. **Future enhancement**: Create a GitHub enhancement issue for cold storage export of old snapshots (e.g., to Cloudflare R2 free tier) to enable full-resolution recalculation beyond the retention window.

## Follow-up Research: Supabase Historical Storage Usage (2026-06-19)

### Can Supabase show how storage grew over time?

**Short answer: No.** Supabase does not provide built-in historical storage usage graphs or an API endpoint that returns storage size over time.

### What Supabase offers (and doesn't)

| Source | What it shows | Historical? |
|---|---|---|
| Dashboard → Organization Usage | Current billing period summary per project | No — current period only, no daily breakdown |
| Dashboard → Database Reports | Current database size, disk metrics (updated daily) | Recent hours only, not weeks/months |
| Prometheus Metrics API (`/customer/v1/privileged/metrics`) | ~200 real-time metrics (CPU, memory, disk, WAL, connections) | No — point-in-time snapshot, must scrape yourself into Prometheus/Grafana |
| Management API (`api.supabase.com/v1/...`) | Project/org management, logs (24h windows) | No storage history endpoint exists |
| `pg_stat_user_tables` | Cumulative `n_tup_ins`/`n_tup_upd`/`n_tup_del` counts | Cumulative since last stats reset, not a time series |
| `pg_total_relation_size()` | Current table sizes | Current snapshot only |
| Supabase CLI (`inspect db total-table-sizes`) | Current table sizes | Current snapshot only |

### How to track storage growth going forward

1. **DIY periodic recording** (recommended, simplest): Add an APScheduler job or pg_cron function that records `pg_database_size(current_database())` into a small tracking table daily. This creates the historical trend the dashboard lacks.
2. **Prometheus + Grafana**: Scrape the Supabase Metrics API endpoint into Prometheus, visualize in Grafana. More infrastructure overhead.

### Estimated historical growth curve (reconstructed)

Since Supabase doesn't store history, we can reconstruct the growth curve from the data model:

- **Collector start**: 2026-06-05 (per F-01 archive)
- **Growth rate**: ~35 MB/day (data + indexes)
- **Today**: 2026-06-19 (day 14)

| Date | Estimated DB size | Notes |
|---|---|---|
| 2026-06-05 | ~5 MB | Initial schema + stations table (~827 rows) |
| 2026-06-08 | ~110 MB | Day 3 — first aggregation data accumulating |
| 2026-06-12 | ~250 MB | Day 7 — half of free tier |
| 2026-06-15 | ~355 MB | Day 10 — approaching limit |
| 2026-06-17 | ~425 MB | Day 12 — nearing 500 MB |
| 2026-06-19 | ~495 MB | Day 14 — at/over 500 MB limit (matches issue #25) |

This is a linear estimate (~35 MB/day). Actual growth may vary slightly due to station count changes, collector downtime, or index overhead differences. The curve confirms the 500 MB breach at ~14 days aligns with the collector going live on June 5.

**To get exact numbers**: Run the diagnostic query on production (via Supabase SQL Editor):
```sql
SELECT relname,
       pg_size_pretty(pg_total_relation_size(oid)) AS total,
       pg_size_pretty(pg_relation_size(oid)) AS data,
       pg_size_pretty(pg_indexes_size(oid)) AS indexes
FROM pg_class
WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
ORDER BY pg_total_relation_size(oid) DESC;
```

## Implementation Note: Storage Usage Monitoring & Alerts

The 14-day retention window is tight for the 500 MB free tier. The retention job itself is not enough — active monitoring is needed to catch cases where storage creeps toward the limit (e.g., due to autovacuum not reclaiming space fast enough, index bloat, or station count growth).

### Alerting research

**Logfire alerting**: Available on the free tier, but only supports **Slack-format webhooks** — no native email, Telegram, or Discord. Not practical without Slack.

**Evaluated alternatives**:

| Option | Free limits | Setup | Fit |
|---|---|---|---|
| **ntfy.sh** | Unlimited, no signup | 1 HTTP POST, install phone app | Best — zero infrastructure |
| Telegram bot | Free, no limits | Create bot via BotFather, 1 HTTP GET | Great, slightly more setup |
| Discord webhook | Free, no limits | Create webhook in server, 1 POST | Good if already using Discord |
| Healthchecks.io | 20 checks free | Ping-based (dead-man's switch) | Better for "collector stopped" than "DB full" |
| Email (smtplib/Resend) | Varies | Domain verification, API keys | Overkill for solo dev alerts |

### Decision: ntfy.sh

Chosen for zero-signup simplicity. Install the ntfy app on phone, subscribe to a private topic.

### Recommended implementation (part of B-02):

- Add an APScheduler job (every 6 hours) that queries `pg_database_size(current_database())`
- **Warning at 400 MB** (80%): send ntfy.sh notification with priority 3 (default)
- **Critical at 450 MB** (90%): send ntfy.sh notification with priority 5 (urgent) — phone will ring
- Also log the size via structlog on every check for trend visibility
- Optionally: record the size into a small `db_size_log` table (one row per check, ~1,460 rows/year, negligible storage) for trend visibility without relying on Logfire retention
- ntfy.sh topic name should be configurable via environment variable (e.g., `MEVO_NTFY_TOPIC`)
- If ntfy.sh is unreachable, log a warning but don't crash — alerting failure must not break the app

Code footprint: ~15 lines of Python. Example:
```python
import httpx

async def check_db_size(pool):
    size = await pool.fetchval("SELECT pg_database_size(current_database())")
    size_mb = size / (1024 * 1024)
    if size_mb > 450:
        httpx.post(f"https://ntfy.sh/{topic}", data=f"CRITICAL: DB at {size_mb:.0f}MB", headers={"Priority": "5", "Title": "MevoStats DB Storage"})
    elif size_mb > 400:
        httpx.post(f"https://ntfy.sh/{topic}", data=f"WARNING: DB at {size_mb:.0f}MB", headers={"Priority": "3", "Title": "MevoStats DB Storage"})
```

This monitoring should ship alongside the retention job, not as a separate change — knowing the retention is working correctly is as important as implementing it.

## Future Enhancement Note

**Create a GitHub enhancement issue** for cold storage export of old snapshot data. Scope:
- Daily export of snapshots older than the retention window to compressed CSV (gzip)
- Upload to Cloudflare R2 free tier (10 GB — ~3 years of compressed raw data)
- Enables full-resolution recalculation beyond the 14-day retention window
- Preserves raw data for ad-hoc historical analysis
- Should include a re-import script for recalculation scenarios

This is the long-term sustainable solution that decouples data retention from DB storage constraints. Not needed for the immediate B-02 fix but should be planned.

## Open Questions

1. **What is the actual current DB size breakdown?** The estimates above are based on growth rate calculations. Running `pg_total_relation_size()` on production would confirm exact sizes and whether indexes or other overhead are larger than expected.
2. **Should unused snapshot columns (`docks_available`, `is_installed`, `is_renting`, `is_returning`) be dropped?** Minor optimization (~10% row size reduction) but requires a migration.
3. **Should a storage-tracking job be added?** A simple daily recording of `pg_database_size()` into a small table would provide the historical trend that Supabase doesn't offer natively. Low cost, high visibility.
