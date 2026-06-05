<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Basic Observability

- **Plan**: context/changes/basic-observability/plan.md
- **Scope**: All Phases (1-4)
- **Date**: 2026-06-05
- **Verdict**: APPROVED (after fixes)
- **Findings**: 0 critical, 3 warnings, 3 observations

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

### F1 — Fire-and-forget startup tasks

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: app/main.py:83-84
- **Detail**: `asyncio.create_task()` results discarded. BaseException could lead to "Task exception was never retrieved" warning.
- **Fix**: Added done-callback to log task exceptions via structlog.
- **Decision**: FIXED

### F2 — Health endpoint swallows exception traceback

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: app/main.py:143
- **Detail**: `logger.warning("Health check DB query failed")` lacked `exc_info=True`.
- **Fix**: Added `exc_info=True`.
- **Decision**: FIXED

### F3 — %-style log format in station_sync

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: app/collector/station_sync.py:51
- **Detail**: Used %-style formatting instead of structlog keyword arguments.
- **Fix**: Converted to keyword-argument style.
- **Decision**: FIXED

### F4 — Logfire init error swallows traceback

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: app/logging.py:21
- **Detail**: Logfire configuration failure logged without traceback.
- **Fix**: Added `exc_info=True`.
- **Decision**: FIXED

### F5 — logfire version lower-bound higher than plan

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Adherence
- **Location**: pyproject.toml:17
- **Detail**: Plan specified `>=1.0`, implementation uses `>=3.0`. Tighter bound, no regression.
- **Decision**: SKIPPED

### F6 — station_sync upsert lacks explicit transaction

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality
- **Location**: app/collector/station_sync.py:16-49
- **Detail**: Pre-existing: upsert + deactivation ran without explicit transaction.
- **Fix**: Wrapped in `async with conn.transaction():`.
- **Decision**: FIXED
