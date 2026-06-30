# Data Collection Pipeline — Plan Brief

> Full plan: `context/changes/data-collection-pipeline/plan.md`

## What & Why

Build the data foundation that the entire product depends on: a scheduled collector that polls the Mevo GBFS feed every 5 minutes and stores station availability snapshots in PostgreSQL. Without historical data accumulating now, the north star (S-01: station availability page) has nothing to show. Every day this isn't running is a day of patterns lost.

## Starting Point

A FastAPI stub with a single `/health` endpoint and an asyncpg connection pool to Supabase. No schema, no models, no scheduled jobs, no HTTP client. The project is a single `main.py` file with 4 dependencies.

## Desired End State

The app is deployed on Mikr.us, organized as a proper Python package, with two PostgreSQL tables (stations, snapshots), Alembic migrations, and a collector that silently accumulates ~827 station snapshots every 5 minutes. `/health` reports collector status. Data grows automatically — ready for S-01 to query.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Bike/ebike storage | Separate columns | GBFS provides the breakdown; losing it means re-collecting from scratch |
| Station metadata sync | Startup + daily refresh | Balances freshness with API courtesy; stations rarely change |
| Scheduler | APScheduler in-process | Single process fits 1GB VPS; shares DB pool; simplest deployment |
| Error handling | Log and skip | A missed 5-min snapshot is negligible for historical averages |
| Migration tool | Alembic (raw SQL mode) | Industry standard, versioned, rollback support, CI-friendly |
| Data retention | Keep all, revisit at 6 months | 500MB Supabase free tier lasts ~6 months at current volume |
| Free-floating bikes | Stations only | PRD is station-based; free bikes deferred to future roadmap item |
| Aggregation | Not in F-01 | Raw storage only; aggregation ships with S-01, driven by UI needs |
| Testing | Minimal smoke tests | First code with logic; extensive testing deferred |
| Project structure | `app/` package | Clean separation; scales to S-01+ without restructuring |
| Collector activation | Auto-start with disable flag | Production-ready by default; `MEVO_COLLECTOR_ENABLED=false` for dev/test |

## Scope

**In scope:**
- Project restructure from single file to `app/` package
- Alembic setup + 2 migrations (stations, snapshots tables)
- GBFS HTTP client with typed Pydantic models
- Station sync service (upsert on startup + daily)
- Snapshot collector (bulk insert every 5 min)
- APScheduler integration in FastAPI lifespan
- Enhanced `/health` with collector status
- Docker entrypoint with auto-migration
- Smoke tests (parsing + collection logic)
- Deploy to Mikr.us
- GitHub issue for 6-month retention review

**Out of scope:**
- Aggregation / averages / reliability labels (S-01)
- Free-floating bike tracking (future roadmap item)
- Alerting on failures (F-02)
- Data retention automation
- Comprehensive test suite

## Architecture / Approach

```
APScheduler (in-process)
  ├─ every 24h: sync_stations() ─→ GBFS station_information.json ─→ UPSERT stations table
  └─ every 5m:  collect_snapshots() ─→ GBFS station_status.json ─→ INSERT snapshots table
                                                                      ↓
FastAPI                                                         asyncpg pool ─→ Supabase PostgreSQL
  └─ GET /health ─→ {db: connected, collector: {status, last_collected_at, stations_count}}
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Project Restructure & Dependencies | `app/` package, Alembic + httpx + APScheduler deps, updated Dockerfile | Breaking existing deploy by changing entry point |
| 2. Database Schema & Migrations | `stations` + `snapshots` tables with indexes | Schema design choices that are hard to change later |
| 3. GBFS Client & Collector Service | HTTP client, station sync, snapshot collector | GBFS response format assumptions; parsing edge cases |
| 4. Integration & Deployment | Scheduler wired in, auto-migrations, deploy to Mikr.us | Memory on 1GB VPS; collector health in production |

**Prerequisites:** Working Supabase database connection (confirmed), Mikr.us VPS with Docker (confirmed)
**Estimated effort:** ~2-3 sessions across 4 phases

## Open Risks & Assumptions

- GBFS response format is assumed stable based on v2.3 spec; format changes would break parsing
- Supabase transaction pooler may have edge cases with bulk inserts — `statement_cache_size=0` is already set
- 1GB VPS should be sufficient (~100-150MB expected usage) but no alerting until F-02
- Station `name` in GBFS is a code like "GPG019", not a human-readable name — `address` is the readable field; S-01 will need to handle display accordingly

## Success Criteria (Summary)

- Collector is running on Mikr.us, accumulating ~827 snapshots every 5 minutes
- `/health` shows collector running with timestamps
- Schema supports the aggregation queries S-01 will need (station × time range)
