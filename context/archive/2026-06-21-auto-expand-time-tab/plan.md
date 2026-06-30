# Auto-Expand Current Time-of-Day Tab Implementation Plan

## Overview

Replace the hardcoded "always Morning" default in the `DayPartDetail` accordion with a `currentDayPartIndex()` function that auto-expands the section matching the user's current hour. This gives commuters immediate visibility into the time period most relevant to them.

## Current State Analysis

The `DayPartDetail` component (`frontend/src/components/DayPartDetail.tsx`) renders four accordion sections — Rano (6-12), Popołudnie (12-18), Wieczór (18-22), Noc (22-6). The expanded state is managed via `useState<Set<number>>(new Set([0]))` on line 64, which always defaults to index 0 (Morning).

The `DAY_PARTS` array (lines 12-17) already defines `startHour` / `endHour` for each period, and `inRange()` (lines 24-30) handles the Night wrap-around (`endHour: 30`). The pattern to follow is `currentDayOfWeek()` in `StationDetailPage.tsx:13-16`, which auto-selects the current day tab using `new Date()`.

### Key Discoveries:

- `DayPartDetail.tsx:64` — the single line to change (`new Set([0])` → `new Set([currentDayPartIndex()])`)
- `DayPartDetail.tsx:12-17` — `DAY_PARTS` array with `startHour`/`endHour` boundaries to reuse
- `StationDetailPage.tsx:13-16` — `currentDayOfWeek()` is the established pattern for time-aware defaults
- `DayPartDetail.test.tsx:28-31` — existing test asserts Morning is always expanded; needs updating
- Test fixtures (`test/fixtures.ts:38-53`) have slots for Monday in Morning (06:00, 06:15, 08:00), Afternoon (12:00), and Evening (18:00)

## Desired End State

When a user opens a station page, the accordion section matching the current time of day is expanded by default. At 15:00, the "Popołudnie" section is open. At 03:00, "Noc" is open. The user still sees all four sections and can expand/collapse any of them manually. Tests verify all four time periods including the Night wrap-around.

To verify: open the station page during different parts of the day and confirm the correct section is expanded. Run the test suite — all existing and new tests pass.

## What We're NOT Doing

- No backend changes — day-part grouping is a frontend-only concept
- No timezone conversion (using browser local time, not Warsaw-pinned time)
- No changes to the `inRange()` function — the new helper works on hours, not time slot strings
- No changes to `DayOfWeekTabs` or `AvailabilityHeatmap`
- No new utility files — function lives in `DayPartDetail.tsx` alongside `DAY_PARTS`

## Implementation Approach

Add an exported `currentDayPartIndex()` function to `DayPartDetail.tsx` that gets the current hour from `new Date().getHours()` and finds the matching `DAY_PARTS` index using the same start/end hour logic as `inRange()`. Use it as the `useState` initializer. Update existing tests and add unit tests for the pure function covering all four periods and the Night wrap-around.

---

## Phase 1: Add Helper Function and Wire Up Default

### Overview

Add `currentDayPartIndex()` to `DayPartDetail.tsx` and use it as the initial expanded section instead of the hardcoded `0`.

### Changes Required:

#### 1. Add `currentDayPartIndex()` and update state initializer

**File**: `frontend/src/components/DayPartDetail.tsx`

**Intent**: Add an exported pure function `currentDayPartIndex()` that determines which `DAY_PARTS` index matches the current hour. Replace the hardcoded `new Set([0])` with `new Set([currentDayPartIndex()])`.

**Contract**: `export function currentDayPartIndex(): number` — returns the index (0-3) into `DAY_PARTS` matching `new Date().getHours()`. Uses the same wrap-around logic as `inRange()` (for Night: hour >= 22 OR hour < 6). Falls back to `0` if no match (defensive, though all 24 hours are covered).

### Success Criteria:

#### Automated Verification:

- TypeScript compiles without errors: `cd frontend && npx tsc --noEmit`
- Linting passes: `cd frontend && npx eslint src/`
- Existing tests still pass (except the "Rano expanded by default" test which will be updated in Phase 2): `cd frontend && npx vitest run`

#### Manual Verification:

- Open a station page — the accordion section matching the current time of day is expanded
- Other sections are collapsed but clickable
- Expanding/collapsing still works normally

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Update Tests

### Overview

Update the existing "Rano is expanded by default" test and add unit tests for `currentDayPartIndex()` covering all four periods and the Night wrap-around edge case.

### Changes Required:

#### 1. Update existing component test

**File**: `frontend/src/components/DayPartDetail.test.tsx`

**Intent**: Replace the "first section (Rano) is expanded by default" test with a test that mocks `Date` to a specific hour and verifies the corresponding section is expanded. This validates the integration between `currentDayPartIndex()` and the component's `useState` initializer.

**Contract**: Mock `Date` (via `vi.useFakeTimers` / `vi.setSystemTime`) to a known hour (e.g., 14:00 for Afternoon), render the component, assert the Afternoon section's slot data is visible. Restore real timers in cleanup.

#### 2. Add pure function tests for `currentDayPartIndex()`

**File**: `frontend/src/components/DayPartDetail.test.tsx`

**Intent**: Test the exported `currentDayPartIndex()` function in isolation across all four time periods plus the Night wrap-around boundary. These tests are fast, deterministic, and cover edge cases that would be verbose to test through component rendering.

**Contract**: Import `currentDayPartIndex` from `./DayPartDetail`. Use `vi.useFakeTimers` + `vi.setSystemTime` to set the hour. Test cases:
- Morning: hour 8 → index 0
- Afternoon: hour 14 → index 1
- Evening: hour 20 → index 2
- Night (late): hour 23 → index 3
- Night (early/wrap-around): hour 3 → index 3
- Boundary: hour 6 → index 0 (start of Morning), hour 12 → index 1 (start of Afternoon)

### Success Criteria:

#### Automated Verification:

- All tests pass: `cd frontend && npx vitest run`
- TypeScript compiles: `cd frontend && npx tsc --noEmit`
- Linting passes: `cd frontend && npx eslint src/`

#### Manual Verification:

- No regressions on station detail page — accordion sections render correctly, toggle works

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- `currentDayPartIndex()` tested in isolation for all 4 periods + boundaries
- Night wrap-around (hour 3 and hour 23 both return index 3)
- Boundary hours (6 → Morning, 12 → Afternoon, 18 → Evening, 22 → Night)

### Integration Tests:

- Component test: mock Date to 14:00, render `DayPartDetail`, assert Afternoon section is expanded

### Manual Testing Steps:

1. Open a station page during the current time period — correct section is expanded
2. Toggle sections — expand/collapse still works
3. Switch day tabs — accordion state persists correctly
4. No visual regressions in the accordion layout

## References

- Research: `context/changes/auto-expand-time-tab/research.md`
- Component: `frontend/src/components/DayPartDetail.tsx`
- Pattern: `frontend/src/pages/StationDetailPage.tsx:13-16` (`currentDayOfWeek()`)
- Original design: `context/archive/2026-06-05-station-availability-page/plan.md:367`
- GitHub issue: #36 [E-14]

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Add Helper Function and Wire Up Default

#### Automated

- [x] 1.1 TypeScript compiles without errors — 8f27361
- [x] 1.2 Linting passes — 8f27361
- [x] 1.3 Existing tests pass — 8f27361

#### Manual

- [x] 1.4 Correct accordion section is expanded based on current time — 8f27361
- [x] 1.5 Expanding/collapsing still works normally — 8f27361

### Phase 2: Update Tests

#### Automated

- [x] 2.1 All tests pass (including new tests) — 2a495ec
- [x] 2.2 TypeScript compiles — 2a495ec
- [x] 2.3 Linting passes — 2a495ec

#### Manual

- [x] 2.4 No regressions on station detail page — 2a495ec
