# Auto-Expand Current Time-of-Day Tab — Plan Brief

> Full plan: `context/changes/auto-expand-time-tab/plan.md`
> Research: `context/changes/auto-expand-time-tab/research.md`

## What & Why

The station detail page always expands the "Rano" (Morning) accordion section regardless of the actual time. Commuters opening the page at 15:00 have to manually expand "Popołudnie" to see relevant data. Auto-expanding the section matching the current time gives users immediate visibility into the period they care about.

## Starting Point

`DayPartDetail.tsx` renders four accordion sections with `useState<Set<number>>(new Set([0]))` — hardcoded to index 0 (Morning). The `DAY_PARTS` array already defines the time boundaries (6-12, 12-18, 18-22, 22-6) with wrap-around handling. A precedent exists: `currentDayOfWeek()` in `StationDetailPage.tsx` already auto-selects the current day tab.

## Desired End State

Opening a station page at any time of day expands the matching accordion section. At 15:00 → Popołudnie is open. At 03:00 → Noc is open. Users can still expand/collapse any section manually. Tests cover all four periods including the Night wrap-around.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|----------|--------|-------------------|--------|
| Timezone source | Browser local time | 99%+ users are Tricity commuters; no API overhead for a negligible edge case | Research |
| Function location | In `DayPartDetail.tsx` | Co-locate with `DAY_PARTS` it depends on; follows `currentDayOfWeek()` pattern | Plan |
| Testing approach | Exported pure function + mocked Date in component test | Pure function tests cover all periods cleanly; component test verifies integration | Plan |

## Scope

**In scope:**
- `currentDayPartIndex()` helper function in `DayPartDetail.tsx`
- Updated `useState` initializer
- Updated + new unit tests covering all 4 periods and Night wrap-around

**Out of scope:**
- Backend changes (day-parts are frontend-only)
- Timezone conversion to Warsaw time
- Changes to `inRange()`, `DayOfWeekTabs`, or `AvailabilityHeatmap`

## Architecture / Approach

Add an exported `currentDayPartIndex()` function that maps `new Date().getHours()` to a `DAY_PARTS` index using the same start/end hour boundaries. Replace the hardcoded `new Set([0])` with `new Set([currentDayPartIndex()])`. All changes in one file + its test file.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|-----------------|----------|
| 1. Add helper + wire up | `currentDayPartIndex()` function, updated state initializer | Minimal — straightforward hour-to-index mapping |
| 2. Update tests | Updated "expanded by default" test, new pure function tests for all periods | Test fixture coverage for Night period slots |

**Prerequisites:** None — the component and test infrastructure are already in place.
**Estimated effort:** ~1 session, single phase could be done in minutes.

## Open Risks & Assumptions

- Browser timezone matches Warsaw for target users (Tricity commuters) — acceptable assumption for MVP
- All 24 hours are covered by the four periods, so the fallback-to-0 is defensive only

## Success Criteria (Summary)

- Opening a station page auto-expands the section matching the current hour
- All unit tests pass, covering Morning, Afternoon, Evening, Night (including 3 AM wrap-around)
- No regressions in accordion toggle behavior
