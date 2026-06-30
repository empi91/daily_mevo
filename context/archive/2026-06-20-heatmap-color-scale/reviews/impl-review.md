<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Heatmap Color Scale — 5-Tier

- **Plan**: context/changes/heatmap-color-scale/plan.md
- **Scope**: All phases (Phase 1 + Phase 2)
- **Date**: 2026-06-20
- **Verdict**: APPROVED (after triage fixes applied)
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Float total causes color/tooltip mismatch at bucket boundaries

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: frontend/src/components/AvailabilityHeatmap.tsx:89
- **Detail**: cellColor() received raw float sum; cellTitle() used Math.round(). A slot with avg_bikes=0.6, avg_ebikes=0.6 (total=1.2) would show tooltip "śr. 1 rower" but render bg-orange-400.
- **Fix**: Added Math.round() at the cellColor call site so color bucket always matches displayed count.
- **Decision**: FIXED — commit 458a2a2

### F2 — Unplanned E2E spec with CSS class locators (violates project rules)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline / Pattern Consistency
- **Location**: e2e/heatmap-color-scale.spec.ts
- **Detail**: File added during Phase 1 manual verification (not in plan). Used `[class*="h-6 flex-1 rounded-sm"]` CSS class substring selectors — CLAUDE.md explicitly bans CSS selectors. Two tests also used silent if(count > 0) guards enabling vacuous passes.
- **Fix A Applied**: Replaced CSS class locators with `[title*="..."]` attribute selectors; replaced silent conditional with toBeVisible() + test.skip() guard.
- **Decision**: FIXED — commit 458a2a2

### F3 — Two E2E tests pass vacuously when no matching cells found

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/heatmap-color-scale.spec.ts
- **Detail**: Subsumed by F2 fix — resolved when locators were rewritten.
- **Decision**: SKIPPED (resolved by F2)

### F4 — Unit test row-traversal uses .closest('.cursor-pointer')

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: frontend/src/components/AvailabilityHeatmap.test.tsx:63,71
- **Detail**: Pre-existing pattern, not introduced by this change. Row container has no semantic role or testid.
- **Decision**: SKIPPED (pre-existing, out of scope)

### F5 — sample_count < 1 could be === 0 for clarity

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend/src/components/AvailabilityHeatmap.tsx:16,26
- **Detail**: sample_count is a DB integer; < 1 and === 0 are equivalent. Plan specified < 1 explicitly.
- **Decision**: SKIPPED (matches plan contract)
