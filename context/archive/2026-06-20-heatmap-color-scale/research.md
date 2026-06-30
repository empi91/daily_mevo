---
date: 2026-06-20T00:00:00+02:00
researcher: Claude Sonnet 4.6
git_commit: ebaa03c531fca6ad54915ae785a5967e80d81c8d
branch: main
repository: empi91/daily_mevo
topic: "Heatmap color scale — 5-tier granular implementation"
tags: [research, heatmap, color-scale, frontend, backend, availability]
status: complete
last_updated: 2026-06-20
last_updated_by: Claude Sonnet 4.6
---

# Research: Heatmap Color Scale — 5-Tier Granular Implementation

**Date**: 2026-06-20  
**Researcher**: Claude Sonnet 4.6  
**Git Commit**: ebaa03c531fca6ad54915ae785a5967e80d81c8d  
**Branch**: main  
**Repository**: empi91/daily_mevo

## Research Question

Replace the current 3-tier heatmap color scale (reliable/uncertain/empty) with a more granular 5-tier scale based on average bike counts: 0–1, 2–3, 3–5, 6–9, 10+, using a gradated color ramp.

## Summary

The heatmap is a custom CSS grid component (`AvailabilityHeatmap.tsx`) with Tailwind-only styling. Currently, the backend computes a `reliability_label` string (3 tiers), and the frontend maps that string to a Tailwind class. The new 5-tier scale requires a choice: expand the backend label enum to 5 values, or drop labels entirely and let the frontend compute color directly from `avg_bikes + avg_ebikes` (already available on each slot). The frontend-only approach is simpler and removes config coupling. Both approaches require updating the legend. No test fixtures or existing tests hardcode color classes in a way that would silently pass incorrectly — the test file exists and will need updates.

## Detailed Findings

### Current Color Scale (`AvailabilityHeatmap.tsx:16–27`)

The `cellColor()` function maps a string label → Tailwind class:

| `reliability_label` | Tailwind class | Legend description |
|---|---|---|
| `reliable` | `bg-green-500` | ≥6 rowerów łącznie |
| `uncertain` | `bg-yellow-400` | 2–5 rowerów łącznie |
| `empty` | `bg-red-500` | ≤1 rower łącznie |
| `insufficient_data` / default | `bg-gray-200` | brak danych |

Legend rendered at lines 104–115. The selected-row highlight is separate (`bg-blue-50 ring-1 ring-blue-300`, line 78) and is unaffected.

### Data Flow and Available Fields

**Frontend type** (`frontend/src/api/stations.ts:12–19`):

```typescript
interface AvailabilitySlot {
  day_of_week: number
  time_slot: string        // "HH:MM"
  avg_bikes: number
  avg_ebikes: number
  sample_count: number
  reliability_label: string
}
```

`avg_bikes` and `avg_ebikes` are already sent to the frontend — the combined total (`avg_bikes + avg_ebikes`) is available for frontend-side bucketing without any backend changes.

### Backend Label Computation (`app/api/stations.py:21–28`)

```python
def _reliability_label(avg_bikes: float, sample_count: int) -> str:
    if sample_count < settings.min_sample_count:  # default: 1
        return "insufficient_data"
    if avg_bikes >= settings.reliability_threshold_reliable:   # default: 6
        return "reliable"
    if avg_bikes >= settings.reliability_threshold_uncertain:  # default: 2
        return "uncertain"
    return "empty"
```

Called at `stations.py:97–99` with `r["avg_bikes"] + r["avg_ebikes"]`.

### Config Thresholds (`app/config.py:13–15`)

| Setting | Default |
|---|---|
| `reliability_threshold_reliable` | `6` |
| `reliability_threshold_uncertain` | `2` |
| `min_sample_count` | `1` |

### Test File

`frontend/src/components/AvailabilityHeatmap.test.tsx` exists and will need updates when color classes or label logic changes.

### Grid Geometry (unchanged by this feature)

- Time range: 05:00–23:00 (`START_HOUR=5`, `END_HOUR=23`)
- Resolution: 4 slots/hour → 72 slots/day
- Days: Mon–Sun, Polish short labels (`['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz']`)
- Cell size: `h-6`
- Entry point: `StationDetailPage.tsx:95–99`

## Code References

- `frontend/src/components/AvailabilityHeatmap.tsx:16–27` — `cellColor()` function, current 3-tier mapping
- `frontend/src/components/AvailabilityHeatmap.tsx:104–115` — legend rendering
- `frontend/src/components/AvailabilityHeatmap.tsx:78` — selected-row highlight (unchanged)
- `frontend/src/api/stations.ts:12–19` — `AvailabilitySlot` type with `avg_bikes`, `avg_ebikes`
- `frontend/src/components/AvailabilityHeatmap.test.tsx` — test file to update
- `app/api/stations.py:21–28` — `_reliability_label()` backend function
- `app/api/stations.py:97–99` — call site (passes `avg_bikes + avg_ebikes`)
- `app/config.py:13–15` — configurable thresholds

## Architecture Insights

**Two implementation paths for the 5-tier scale:**

**Option A — Expand backend labels (keep current architecture)**
- Add 2 new label values, e.g. `very_low`, `low`, `moderate`, `high`, `very_high`
- Add 2 new config thresholds to `app/config.py`
- Update `_reliability_label()` in `stations.py`
- Update `cellColor()` in `AvailabilityHeatmap.tsx` to handle 5 strings
- Update legend
- Pro: thresholds remain server-configurable via env vars
- Con: more backend churn, label enum grows, API contract changes

**Option B — Frontend bucketing (simpler, recommended)**
- Remove `reliability_label` dependency in `cellColor()`
- Pass `avg_bikes + avg_ebikes` directly to a frontend bucketing function
- 5 buckets: `<= 1`, `<= 3`, `<= 5`, `<= 9`, `>= 10` (still use `sample_count < 1` for no-data)
- Keep `reliability_label` on the API response (don't break the contract) but stop using it for color
- Update `cellColor()` signature to accept `(total: number, sampleCount: number)`
- Update legend
- Pro: no backend changes, no API changes, simpler
- Con: thresholds are now hardcoded in the frontend (acceptable — they're display bucketing, not business logic)

**Recommended color ramp for 5 tiers** (red → amber → green gradient):

| Bucket | avg total | Suggested Tailwind | Visual meaning |
|---|---|---|---|
| No data | sample_count < 1 | `bg-gray-200` | no data |
| Very low | 0–1 | `bg-red-500` | effectively empty |
| Low | 2–3 | `bg-orange-400` | risky |
| Moderate | 3–5 | `bg-yellow-400` | uncertain |
| Good | 6–9 | `bg-lime-400` | good |
| High | 10+ | `bg-green-500` | reliable |

Note: the user's spec says 0–1, 2–3, 3–5, 6–9, 10+ — "3–5" overlaps with "2–3" at 3. Clarify intended bucket boundaries during planning (likely: `< 2`, `2–3`, `4–5`, `6–9`, `≥ 10`).

## Historical Context (from prior changes)

- `context/archive/2026-06-05-station-availability-page/plan-brief.md:33` — Thresholds were deliberately set high (≥6 reliable) because "avg 2 bikes can mean 0 on arrival due to variance." The new 5-tier scale doesn't invalidate this reasoning — it just gives more visual nuance.
- `context/foundation/prd.md:153` — Thresholds were always flagged as tunable: "can be tuned after first data." The 5-tier change is exactly this kind of post-launch tuning.
- `context/archive/2026-06-05-station-availability-page/reviews/impl-review.md` — Recharts was dropped in favor of a custom CSS grid (positive drift). Any new color handling must stay CSS/Tailwind — no charting library dependency.

## Open Questions

1. **Exact bucket boundaries**: The issue says "0–1, 2–3, 3–5, 6–9, 10+" — value 3 appears in two buckets. Confirm intended boundaries before planning (likely `0–1`, `2–3`, `4–5`, `6–9`, `≥10`).
2. **`reliability_label` API field**: Keep it on the response (Option B) or clean it up entirely? Keeping it avoids a breaking API change.
3. **Color palette**: Confirm the red→amber→green ramp, or specify a different palette.
4. **Legend language**: Keep Polish text (`rowerów łącznie`) or align with any i18n direction?
5. **Test strategy**: `AvailabilityHeatmap.test.tsx` will need updated fixtures — scope of test changes?
