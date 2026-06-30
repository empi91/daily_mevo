<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Basic Observability

- **Plan**: context/changes/basic-observability/plan.md
- **Scope**: Phase 3 of 4
- **Date**: 2026-06-05
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS (after fixes) |
| Architecture | PASS |
| Pattern Consistency | PASS (after fixes) |
| Success Criteria | PASS |

## Findings

### F1 — Spurious freshness warning when no DB configured

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: app/main.py:173
- **Detail**: `data_freshness["fresh"]` defaulted to `False`, causing `data_freshness_degraded` warning on every /health request even when no DB is configured (age_seconds=None).
- **Fix**: Guarded warning with `data_freshness["last_snapshot_at"] is not None` check.
- **Decision**: FIXED

### F2 — Triple pool acquire in /health endpoint

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: app/main.py:112, 141, 159
- **Detail**: Health endpoint acquired DB connection three separate times for three queries.
- **Fix**: Consolidated into a single `async with pool.acquire() as conn:` block running all three queries.
- **Decision**: FIXED

### F3 — Silent exception in DB connectivity probe

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: app/main.py:114
- **Detail**: Pre-existing silent exception in DB probe. Resolved by F2 consolidation — the single except block now logs.
- **Decision**: SKIPPED (resolved by F2)

### F4 — .gitignore change outside plan scope

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Scope Discipline
- **Location**: .gitignore
- **Detail**: Added `.logfire/` — not in plan. Benign housekeeping bundled at user request.
- **Decision**: SKIPPED

### F5 — %-style log format in snapshot_collector

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: app/collector/snapshot_collector.py:53
- **Detail**: Used %-style format strings instead of structlog keyword arguments.
- **Fix**: Converted to keyword-argument style (`snapshot_count=`, `duration_ms=`).
- **Decision**: FIXED
