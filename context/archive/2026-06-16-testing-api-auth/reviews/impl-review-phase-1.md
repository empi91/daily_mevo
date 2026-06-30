<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: API and Auth Integration Tests

- **Plan**: context/changes/testing-api-auth/plan.md
- **Scope**: Phase 1 of 4
- **Date**: 2026-06-16
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Reliability label test never exercises avg_ebikes > 0

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/test_stations_api.py:64-75
- **Detail**: All four parametrize cases set avg_ebikes=0.0. The reliability label is computed from avg_bikes + avg_ebikes, but a bug where avg_ebikes is ignored would pass silently.
- **Fix**: Add a 5th parametrize case: (4.0, 2.0, 5, "reliable").
- **Decision**: FIXED

### F2 — api_client teardown not wrapped in try/finally

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/conftest.py:193-197
- **Detail**: If test_engine.dispose() raises, settings and auth_db are never restored. Low practical risk (session-scoped), but try/finally is a structural improvement.
- **Fix**: Wrap teardown in try/finally with restore logic in `finally`.
- **Decision**: FIXED

### F3 — Station list test checks filtering but not field shape

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/test_stations_api.py:31-35
- **Detail**: Plan says assert correct station_id, name, lat, lon, capacity but the test only checked station_ids are present/absent.
- **Fix**: Assert one station object has expected name/lat/lon/capacity values.
- **Decision**: FIXED
