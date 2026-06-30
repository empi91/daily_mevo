---
date: 2026-06-21T12:00:00+02:00
researcher: Claude
git_commit: deaa4cb
branch: main
repository: daily_mevo
topic: "Auto-expand current time-of-day tab on station page"
tags: [research, codebase, frontend, station-page, day-part-detail, ux]
status: complete
last_updated: 2026-06-21
last_updated_by: Claude
---

# Research: Auto-expand current time-of-day tab on station page

**Date**: 2026-06-21
**Researcher**: Claude
**Git Commit**: deaa4cb
**Branch**: main
**Repository**: daily_mevo

## Research Question

GitHub issue #36 [E-14]: The "Rano" (Morning) accordion section is always expanded by default on the station detail page. Instead, the section matching the current time of day should be auto-expanded on load.

## Summary

The fix is a **frontend-only change** to a single component: `DayPartDetail.tsx`. The hardcoded default `new Set([0])` (always Morning) on line 64 needs to be replaced with a function that determines the current hour and returns the matching `DAY_PARTS` index. The `DAY_PARTS` array already defines the time boundaries needed for the lookup. No backend changes are required — the day-part concept exists only in the frontend.

One existing unit test (`DayPartDetail.test.tsx:28`) asserts "first section is expanded by default" and will need updating.

## Detailed Findings

### 1. The accordion component — `DayPartDetail.tsx`

The station detail page (`StationDetailPage.tsx`) renders `<DayPartDetail>` which implements a multi-expand accordion for four time-of-day sections:

| Index | Polish label | English   | Hours       |
|-------|-------------|-----------|-------------|
| 0     | Rano        | Morning   | 06:00–12:00 |
| 1     | Popołudnie  | Afternoon | 12:00–18:00 |
| 2     | Wieczór     | Evening   | 18:00–22:00 |
| 3     | Noc         | Night     | 22:00–06:00 |

These are defined in the `DAY_PARTS` constant (`DayPartDetail.tsx:12-17`).

**The hardcoded default** is on line 64:

```tsx
const [expandedParts, setExpandedParts] = useState<Set<number>>(new Set([0]))
```

`new Set([0])` means index 0 (Rano/Morning) is always expanded on mount. This is the single line that needs to change.

### 2. The `inRange` helper already exists

`DayPartDetail.tsx:24-30` defines `inRange(timeSlot, part)` which correctly handles the Night wrap-around (endHour 30 → hours >= 22 OR < 6). A similar lookup function can determine the current period index from the current hour.

### 3. No backend time-of-day concept

The backend works exclusively with raw 15-minute time slots and day-of-week integers. The only "current time" function is `_current_slot()` in `app/api/favourites.py:17-23`, which returns `(day_of_week, time.time)` in Warsaw timezone. The morning/afternoon/evening/night grouping is purely a frontend presentation concern.

### 4. Timezone considerations

The backend uses `Europe/Warsaw` consistently (`app/config.py:32`). The frontend currently has **no timezone handling** — it would use the browser's local time via `new Date().getHours()`. For the vast majority of users (commuters in Tricity), browser timezone matches Warsaw time. Edge case: a user in a different timezone would see the "wrong" tab expanded — acceptable for an MVP, and fixable later if needed.

### 5. Existing test coverage

`DayPartDetail.test.tsx:28-31` explicitly tests the current behavior:

```tsx
test('DayPartDetail first section (Rano) is expanded by default', () => {
  renderDetail()
  expect(screen.getByText('06:00')).toBeInTheDocument()
})
```

This test will need to be updated to either:
- Mock `Date` to a specific time and assert the corresponding section is expanded, or
- Accept the function that computes the default index and test it in isolation.

### 6. Day-of-week tabs already auto-select current day

`StationDetailPage.tsx` already defaults `selectedDay` to the current day of week via `currentDayOfWeek()` (line 13-16). This is the exact pattern to follow — day tabs auto-select by day, day-part accordion should auto-expand by hour.

## Code References

- `frontend/src/components/DayPartDetail.tsx:64` — hardcoded `new Set([0])` default (the line to change)
- `frontend/src/components/DayPartDetail.tsx:12-17` — `DAY_PARTS` array with time boundaries
- `frontend/src/components/DayPartDetail.tsx:24-30` — `inRange()` helper with wrap-around logic
- `frontend/src/components/DayPartDetail.test.tsx:28-31` — test asserting Morning is expanded by default
- `frontend/src/pages/StationDetailPage.tsx:13-16` — `currentDayOfWeek()` pattern to follow
- `app/api/favourites.py:17-23` — backend `_current_slot()` (not needed for this change)
- `app/config.py:32` — `WARSAW_TZ = "Europe/Warsaw"` constant

## Architecture Insights

- **Frontend-only change**: The day-part grouping is a purely presentational concept. No API changes needed.
- **Pattern precedent**: `currentDayOfWeek()` already implements "auto-select by current time" for day tabs. A `currentDayPartIndex()` function follows the same pattern.
- **`inRange` reuse**: The existing `inRange(timeSlot, part)` works on time slot strings. A new helper should work on hour integers instead, but the `DAY_PARTS` boundaries and wrap-around logic are already defined.
- **Multi-expand accordion**: The component uses `Set<number>` (not a single index), so the initial set just needs the right index instead of hardcoded `0`.

## Historical Context (from prior changes)

- `context/archive/2026-06-05-station-availability-page/plan.md:367` — original design spec: "Morning section expanded by default; others collapsed." The current behavior was an intentional design choice, now being revised.
- `context/archive/2026-06-05-station-availability-page/plan.md:359` — "Default selection: current day of week" for DayOfWeekTabs — the precedent for time-aware defaults.

## Open Questions

1. **Timezone strategy**: Should the frontend use browser local time (simplest, correct for 99% of users) or call the backend for Warsaw time? Recommendation: browser local time, with a potential future enhancement for explicit timezone.
2. **Night period edge case**: At 3 AM, the "Noc" (Night 22-6) section should expand. The `inRange` wrap-around logic handles this, but testing should cover it.
3. **No-match fallback**: All 24 hours are covered by the four periods, so there's no gap. However, should the function default to index 0 as a safety net?
