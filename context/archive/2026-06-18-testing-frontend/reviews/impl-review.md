<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Frontend Regression Safety

- **Plan**: context/changes/testing-frontend/plan.md
- **Scope**: All phases (1-4 of 4)
- **Date**: 2026-06-18
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

### F1 — CSS class assertions coupled to Tailwind utility names

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend/src/components/AvailabilityHeatmap.test.tsx:25-41
- **Detail**: Tests assert raw Tailwind class names (bg-green-500, bg-yellow-400, bg-red-500, bg-gray-200). The plan explicitly chose "DOM assertions on CSS classes" over visual regression, so coupling is intentional. Fragile only if Tailwind config changes to class hashing.
- **Fix**: Accept as intentional. Revisit only if Tailwind config changes.
- **Decision**: ACCEPTED — intentional per plan design

### F2 — DOM traversal via parentElement! non-null assertion

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend/src/components/AvailabilityHeatmap.test.tsx:54,63
- **Detail**: Uses dayLabel.parentElement! to traverse DOM and find the row element. If the component's DOM nesting changes, the assertion silently targets the wrong element.
- **Fix**: Replace parentElement! with closest('.cursor-pointer') for resilient row selection.
- **Decision**: FIXED — replaced with closest('.cursor-pointer')

### F3 — Duplicated mockAuth helper

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: Layout.test.tsx, LoginPage.test.tsx, RegisterPage.test.tsx
- **Detail**: Near-identical mockAuth helper function duplicated across three test files.
- **Fix**: Extract createMockAuthValue to test/helpers.tsx as shared helper.
- **Decision**: FIXED — extracted to test/helpers.tsx, all three files updated

### F4 — Unplanned tsconfig.app.json exclude

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Scope Discipline
- **Location**: frontend/tsconfig.app.json
- **Detail**: Added exclude for test files to prevent vitest globals from causing TS errors in production config. Not in plan but architecturally correct.
- **Fix**: No action needed.
- **Decision**: ACCEPTED — correct supporting change
