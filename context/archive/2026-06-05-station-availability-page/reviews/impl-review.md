<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Station Availability Page

- **Plan**: context/changes/station-availability-page/plan.md
- **Scope**: All 6 Phases
- **Date**: 2026-06-05
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — min_sample_count threshold mismatch between backend and frontend

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: app/config.py:15, frontend/src/pages/StationDetailPage.tsx:10
- **Detail**: Backend min_sample_count was lowered to 1 (plan says 8). Frontend hardcodes MIN_SAMPLE_COUNT = 8 independently. Split-brain: API returns "reliable" for slots with 2 samples, but frontend may show "data still collecting" because it checks its own threshold of 8.
- **Fix A ⭐ Recommended**: Restore backend default to 8, expose via API
  - Strength: Single source of truth. Plan alignment restored.
  - Tradeoff: Heatmap shows "insufficient data" until ~2 weeks. Requires small API change.
  - Confidence: HIGH — plan explicitly designed for this threshold.
  - Blind spot: None significant.
- **Fix B**: Keep backend at 1, lower frontend to 1
  - Strength: Shows heatmap immediately.
  - Tradeoff: Averages from 1-2 samples are statistically meaningless.
  - Confidence: LOW — defeats the purpose.
  - Blind spot: None.
- **Decision**: FIXED via Fix B — aligned both to 1

### F2 — Geocode proxy has no rate limiting or error handling

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: app/api/geocode.py:11-36
- **Detail**: Nominatim has a strict 1 req/sec policy. No server-side rate limit. raise_for_status() propagates as unhandled 500. New httpx.AsyncClient created per request.
- **Fix**: Add try/except for httpx errors (return 502), reuse client.
  - Strength: Handles most likely failure mode. Connection reuse is simple.
  - Tradeoff: Rate limiting deferred, not solved.
  - Confidence: HIGH — collector/gbfs_client.py handles errors this way.
  - Blind spot: Rate limiting is deferred.
- **Decision**: FIXED — added try/except + reused httpx client

### F3 — Aggregation re-scans entire snapshots table every hour

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: app/aggregation.py:9-28
- **Detail**: Hourly job GROUP BYs over ALL snapshots (~240K rows/day growth). Fine now, will slow over weeks/months.
- **Fix**: Add WHERE clause limiting to last 4 weeks of snapshots.
  - Strength: Bounds query cost. Recent weeks most relevant.
  - Tradeoff: Older data excluded. Acceptable.
  - Confidence: HIGH.
  - Blind spot: None.
- **Decision**: SKIPPED — must be all-time averages. GitHub issue #15 created for future optimization.

### F4 — Aggregation lacks explicit transaction wrapper

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: app/aggregation.py:8-28
- **Detail**: Collector modules use `async with conn.transaction()`. Aggregation doesn't. Single statement is auto-wrapped by PostgreSQL, but breaks established pattern.
- **Fix**: Wrap in `async with conn.transaction()`.
- **Decision**: FIXED — added transaction wrapper

### F5 — Search dropdown has no click-outside dismiss

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend/src/components/StationSearch.tsx
- **Detail**: Results dropdown stays visible when clicking elsewhere on the page.
- **Fix**: Add click-outside listener or clear results on blur.
- **Decision**: SKIPPED

### F6 — Heatmap uses custom CSS grid instead of planned Recharts

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: frontend/src/components/AvailabilityHeatmap.tsx
- **Detail**: Plan specified Recharts. Implementation uses custom CSS grid. Functionally equivalent, lighter, well-implemented. Positive drift.
- **Fix**: None needed.
- **Decision**: SKIPPED — positive drift

### F7 — Search merged into single component vs. planned two-tab design

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: frontend/src/components/StationSearch.tsx
- **Detail**: Plan specified StationNumberSearch + AddressSearch with tabs. Implementation merges into single auto-detecting input. Debounce 500ms vs planned 300ms. Simpler UX.
- **Fix**: None needed unless tabbed UX specifically desired.
- **Decision**: SKIPPED — positive drift
