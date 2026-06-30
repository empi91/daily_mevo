<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Favourites Dashboard

- **Plan**: context/changes/favourites-dashboard/plan.md
- **Scope**: All 6 Phases
- **Date**: 2026-06-20
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — DOM-structure locator in E2E test

- **Severity**: WARNING
- **Impact**: LOW
- **Dimension**: Pattern Consistency
- **Location**: e2e/favourites.spec.ts:24
- **Detail**: navigateToFirstStation used .locator('span').first() to extract station name — a DOM-structure-based locator that e2e-rules.md prohibits.
- **Fix**: Replaced with textContent() + regex extraction to match station name pattern.
- **Decision**: FIXED

### F2 — E2E test cleanup via inline logout (not afterEach)

- **Severity**: WARNING
- **Impact**: LOW
- **Dimension**: Pattern Consistency
- **Location**: e2e/favourites.spec.ts:37,69,88,108
- **Detail**: Tests clean up by clicking logout at the end of the test body. If an assertion fails mid-test, logout is skipped. Matches existing codebase pattern in auth-session.spec.ts.
- **Fix**: Not fixing — matches codebase convention. Future cross-cutting change could move all E2E tests to afterEach.
- **Decision**: SKIPPED

### F3 — E2E email domain @example.com vs planned @test.local

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Plan Adherence
- **Location**: e2e/favourites.spec.ts:6
- **Detail**: Plan specified @test.local but implementation uses @example.com. Justified: backend email validator rejects .local as a special-use TLD. Matches existing E2E tests.
- **Decision**: SKIPPED

### F4 — Cross-module import of private helpers

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Architecture
- **Location**: app/api/favourites.py:6
- **Detail**: Imports _get_pool and _reliability_label from app.api.stations (underscore-prefixed). Creates coupling on internal helpers. Two consumers is below threshold for extraction.
- **Decision**: SKIPPED
