---
date: 2026-06-30T21:30:00+02:00
researcher: Claude (AI assistant)
git_commit: 02f293acc9f65bdd4404e11c9d12ad399db658b1
branch: main
repository: daily_mevo
topic: "Supabase RLS security alert — is it real or stale?"
tags: [research, security, rls, supabase, database]
status: complete
last_updated: 2026-06-30
last_updated_by: Claude (AI assistant)
---

# Research: Supabase RLS Security Alert — Is It Real or Stale?

**Date**: 2026-06-30T21:30:00+02:00
**Researcher**: Claude (AI assistant)
**Git Commit**: 02f293a
**Branch**: main
**Repository**: daily_mevo

## Research Question

Supabase sent a critical security email on 2026-06-30 (reporting issues "as of 28 Jun 2026") saying `rls_disabled_in_public` on the `daily-mevo` project (ID: `kpsjscdakuxtlqoddxql`). Is this a real, current vulnerability or a stale advisory? What existing work addresses it?

## Summary

**Confirmed resolved.** Migrations 008 and 009 enable RLS on all 8 tables in the `public` schema. These were committed on 2026-06-28 and deployed via CI/CD the same evening. The original email was a **stale advisory from a scan that ran before the deployment**.

User verified on 2026-06-30:
- SQL query `SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'` returns `rowsecurity = true` for **all tables**.
- Supabase Security Advisor re-run shows no `rls_disabled_in_public` findings.
- Remaining advisory: "RLS enabled but no policies exist" on every table — this is **expected and intentional** (see Architecture Insights).

## Detailed Findings

### 1. The Supabase Email

- **Received**: 2026-06-30
- **Check date**: "as of 28 Jun 2026" — this is when Supabase's security advisor last scanned
- **Finding**: `rls_disabled_in_public` — tables in `public` schema without RLS
- **Project**: daily-mevo (`kpsjscdakuxtlqoddxql`)

The email did **not** specify which table(s) triggered the alert.

### 2. Existing RLS Migrations

Two migrations were committed on 2026-06-28:

**Migration 008** (`alembic/versions/008_enable_rls_all_tables.py`, commit `fb5e0ee`):
- Enables RLS on all 7 application tables: `stations`, `snapshots`, `station_availability`, `agg_watermark`, `users`, `db_size_log`, `favourites`
- No permissive policies created — this effectively blocks all access via Supabase's PostgREST/anon key
- App connects via `asyncpg` as the `postgres` superuser role, which bypasses RLS

**Migration 009** (`alembic/versions/009_enable_rls_alembic_version.py`, commit `ea4efd8`):
- Enables RLS on the `alembic_version` table (Alembic's internal tracking table)
- Added separately because 008 missed this system table

### 3. Deployment Timeline

| Time (CEST) | Event |
|---|---|
| 2026-06-28, unknown | Supabase security advisor scan ("as of 28 Jun 2026") |
| 2026-06-28, 21:04 | Commit `fb5e0ee` — migration 008 (RLS on 7 tables) |
| 2026-06-28, 21:05 | Commit `6de4eb7` — deployment parity test update |
| 2026-06-28, 21:12 | Commit `ea4efd8` — migration 009 (RLS on alembic_version) |
| 2026-06-28, ~21:15-21:20 | CI deploy completes (all 4 jobs pass, health check + smoke OK) |

The entrypoint (`scripts/entrypoint.sh`) runs `alembic upgrade head` on every container start, so both migrations were applied during deployment.

### 4. Table Coverage Analysis

| Table | Created by | RLS enabled by | Verified |
|---|---|---|---|
| `stations` | 001 | 008 | true |
| `snapshots` | 002 | 008 | true |
| `station_availability` | 003 | 008 | true |
| `agg_watermark` | 004 | 008 | true |
| `users` | 005 | 008 | true |
| `db_size_log` | 006 | 008 | true |
| `favourites` | 007 | 008 | true |
| `alembic_version` | Alembic auto | 009 | true |

### 5. "No Policies" Advisory — Expected Behavior

After re-running the Security Advisor, Supabase shows for every table:

> *Table public.X has RLS enabled, but no policies exist — Detects cases where row level security (RLS) has been enabled on a table but no RLS policies have been created.*

This is **intentional and correct** for this project's architecture:
- The app connects as `postgres` (superuser), which **bypasses RLS entirely**
- Supabase's PostgREST API uses `anon`/`authenticated` roles, which are **completely blocked** by RLS with zero policies
- This project does not use Supabase client-side SDKs — "RLS + no policies = full lockdown via PostgREST" is the correct posture
- Creating policies would actually *weaken* security by opening access paths through PostgREST

### 6. Why the Email Was Sent

**Confirmed: stale advisory.** Supabase's security advisor scanned on June 28 before the evening deployment (~21:00 CEST). The email was batched and sent on June 30 with outdated findings. After re-running the advisor on June 30, the `rls_disabled_in_public` finding is gone.

## Code References

- `alembic/versions/008_enable_rls_all_tables.py` — RLS on 7 app tables
- `alembic/versions/009_enable_rls_alembic_version.py` — RLS on alembic_version
- `scripts/entrypoint.sh:3` — `alembic upgrade head` runs on every deploy
- `tests/test_deployment_parity.py:80-89` — test verifying migration head is 009
- `app/auth/models.py` — User model (no extra tables)

## Architecture Insights

- The app connects as `postgres` (superuser) which **bypasses RLS** — enabling RLS doesn't affect the application
- Supabase's PostgREST API uses the `anon` and `authenticated` roles, which **are blocked by RLS with no policies** — correct security posture for a server-side app
- "Enable RLS + zero policies" = complete lockdown via PostgREST
- The "no policies" Supabase advisory can be safely dismissed

## Resolution

**No action required.** The original critical alert (`rls_disabled_in_public`) is resolved by migrations 008/009, confirmed live in production. The informational "no policies" advisory is expected and intentional for this architecture.
