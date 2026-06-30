<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Basic Observability

- **Plan**: context/changes/basic-observability/plan.md
- **Scope**: Phase 1 of 4
- **Date**: 2026-06-05
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — log_level pulled forward from Phase 4

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: app/config.py:12
- **Detail**: Phase 4 step 2 specifies adding log_level to Settings, but it was implemented in Phase 1 because setup_logging() reads settings.log_level. This is a necessary dependency — the alternative would be reading a raw env var.
- **Fix**: Accept the pull-forward and note it in the plan so Phase 4 step 2 is already done when we get there.
- **Decision**: FIXED — accepted pull-forward; Phase 4 steps 2-3 will be no-ops

### F2 — setup_logging() at module import time

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: app/main.py:14
- **Detail**: setup_logging() runs at module import time. If logfire.configure() raises (transient network issue, bad config), the entire module fails to import and the app won't start. The plan specified module-level call, so this matches intent, but a try/except fallback to stdlib would add resilience.
- **Fix**: Wrap the logfire.configure() call inside setup_logging() in a try/except that falls back to configuring without Logfire.
- **Decision**: FIXED — added try/except with graceful fallback

### F3 — Printf-style log formatting in scheduler jobs

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: app/main.py:45,54
- **Detail**: logger.info("Scheduled station sync: %d stations", count) uses printf-style formatting. structlog prefers keyword args for structured output. Phase 2 will migrate these modules anyway.
- **Decision**: SKIPPED

### F4 — Broad logfire version pin

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: pyproject.toml:17
- **Detail**: logfire[fastapi]>=1.0 has no upper bound. The uv.lock file protects against surprise upgrades in practice. Low risk.
- **Decision**: FIXED — tightened to logfire[fastapi]>=1.0,<3
