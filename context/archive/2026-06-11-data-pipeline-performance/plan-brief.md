# Data Pipeline Performance Optimization — Plan Brief

> Full plan: `context/changes/data-pipeline-performance/plan.md`
> Research: `context/changes/data-pipeline-performance/research.md`

## What & Why

Station sync (E-03) takes 46–200s per run because it executes ~827 individual INSERT statements in a loop. Hourly aggregation (E-04) does a full GROUP BY over the entire snapshots table, which grows by ~240K rows/day and will eventually exceed the 768MB memory budget on Mikr.us. Both need to be fixed for the pipeline to remain viable.

## Starting Point

Station sync (`app/collector/station_sync.py`) loops over stations with individual `conn.execute()` calls. Aggregation (`app/aggregation.py`) recalculates all-time averages from scratch every hour with no WHERE filter. The snapshot collector already uses efficient `executemany()` and needs no change.

## Desired End State

Station sync completes in under 1 second using a single unnest-based SQL statement. Aggregation processes only new snapshots since the last run (~14K rows/hour), keeping execution time constant as the table grows. Existing availability averages are preserved — no data reset needed.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Bulk upsert method | Unnest-based single statement | Best performance-to-complexity ratio: one round-trip, ~10 lines changed | Research |
| Schema for averages | Keep avg columns, multiply-back for merge | Zero migration risk, API untouched, float drift negligible for bike counts | Plan |
| Bootstrap strategy | Set watermark to current max(id) | Avoids slow full reprocessing; trusts existing averages computed by full scan | Plan |
| Watermark index | Use existing PK index on snapshots.id | PK B-tree is optimal for range scan; no extra index on high-write table | Plan |
| Full recalc | Document runbook, no code | 3 SQL statements; adding an endpoint is out of scope | Plan |
| Observability | Add structured log attributes | Follows existing logfire/structlog pattern; confirms optimization worked | Plan |

## Scope

**In scope:**
- Unnest-based bulk upsert for station sync
- New `agg_watermark` table + migration
- Incremental aggregation with weighted average merge
- Observability attributes for aggregation
- Full-recalculation runbook (documented, not coded)

**Out of scope:**
- Snapshot collector optimization
- Schema changes to station_availability (no sum columns)
- Admin recalculation endpoint
- APScheduler interval changes
- API layer changes

## Architecture / Approach

Two independent, contained changes. Phase 1 replaces the station sync loop with a single `INSERT...SELECT FROM unnest(...)` statement — pure SQL optimization, no schema changes. Phase 2 introduces a single-row `agg_watermark` table, rewrites the aggregation to read the watermark, process only `WHERE id > last_processed_id`, and merge results using `(old_avg * old_count + new_sum) / (old_count + new_count)`. Both changes stay within existing transaction and error-handling patterns.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Bulk Station Sync | Single-statement upsert, sub-second execution | Unnest type annotations must match schema exactly |
| 2. Incremental Aggregation | Watermark table + weighted merge, constant-time execution | Weighted average formula must be correct to preserve data accuracy |

**Prerequisites:** Database access for migration; existing station_availability data trusted as correct
**Estimated effort:** ~1-2 sessions across 2 phases

## Open Risks & Assumptions

- Existing `station_availability` averages are assumed correct (computed by the current full-scan approach)
- The weighted average multiply-back (`avg * count`) introduces minor float drift — acceptable for bike count averages (integer source data, ~1-2 decimal precision needed)
- First aggregation run after migration processes 0 rows by design — new data starts accumulating from the next snapshot collection

## Success Criteria (Summary)

- Station sync completes in under 10 seconds (target: sub-second)
- Aggregation execution time stays constant regardless of snapshots table size
- API responses for station availability remain correct and unchanged
