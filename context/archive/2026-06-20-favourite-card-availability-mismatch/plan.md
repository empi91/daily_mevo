# Favourite Card Availability Mismatch — Implementation Plan

## Overview

Fix a timezone bug in `_current_slot()` (`app/api/favourites.py`) that causes the favourites
API to look up the wrong `station_availability` row. The aggregation stores slots in
`Europe/Warsaw` local time; the favourites API was computing the slot in UTC, producing a 2-slot
(30-min) drift in CEST and a wrong day near midnight Warsaw.

## Current State Analysis

- `app/aggregation.py:6` defines `LOCAL_TZ = "Europe/Warsaw"`.
- `app/aggregation.py:52` converts `collected_at AT TIME ZONE 'Europe/Warsaw'` before extracting
  `day_of_week` and `time_slot`, so every row in `station_availability` is keyed on Warsaw time.
- `app/api/favourites.py:13-18` — `_current_slot()` calls `datetime.now(timezone.utc)`, then
  reads `.weekday()`, `.hour`, and `.minute` directly from that UTC object and issues a DB query
  with those values. **This is the bug.**
- `tests/test_favourites.py:36-56` — `_insert_availability_for_current_slot()` has the same UTC
  bug in the test helper; it inserts availability at the UTC-derived slot. After the API fix this
  test would become unreliable in CEST (passes in winter, silently misses in summer).

### Key Discoveries

- `zoneinfo.ZoneInfo` (stdlib, Python 3.9+) is already used in `scripts/verify_availability.py`
  — no new dependency needed.
- All other hypotheses (day-of-week encoding, data source, caching) were ruled out with zero
  supporting evidence in the frame brief.
- The station detail page reads browser local time (`StationDetailPage.tsx:13-16`), which for
  Polish users matches Warsaw time — explaining why the detail page shows correct data.

## Desired End State

`_current_slot()` returns the Warsaw-local day-of-week and time slot, matching exactly the keys
stored by `aggregate_availability`. The favourites API returns avg_bikes/avg_ebikes values that
are consistent with what the aggregation would produce for the same moment.

Unit tests cover the normal case and the midnight-Warsaw edge case (22:00–00:00 UTC window where
the day flips). The existing integration test `test_list_favourites_with_availability` is
trustworthy year-round (Warsaw slot inserted, Warsaw slot queried).

To verify: in CEST (summer), call `/api/v1/favourites` and compare `avg_bikes` against a direct
DB query `SELECT avg_bikes FROM station_availability WHERE station_id=? AND day_of_week=? AND
time_slot=?` using the Warsaw-local time values for the same moment. They must match.

## What We're NOT Doing

- No schema changes to `station_availability`.
- No changes to `app/aggregation.py` (it's already correct).
- No frontend changes.
- No changes to any endpoint other than `_current_slot()`.
- No changes to `app/api/stations.py` (returns all slots; no current-slot lookup).

## Implementation Approach

Two-file surgical fix:

1. `app/api/favourites.py` — swap `datetime.now(timezone.utc)` for
   `datetime.now(ZoneInfo("Europe/Warsaw"))`, add optional `now=` parameter for testability.
2. `tests/test_favourites.py` — fix `_insert_availability_for_current_slot()` to insert at the
   Warsaw slot; add a new unit test file `tests/test_current_slot.py` covering normal and midnight
   edge cases.

## Phase 1: Fix `_current_slot()` and its test helper

### Overview

Replace the UTC datetime source with a Warsaw-aware one, add `now=` injection parameter, and fix
the test helper that has the same bug.

### Changes Required

#### 1. `_current_slot()` in the favourites router

**File**: `app/api/favourites.py`

**Intent**: Replace `datetime.now(timezone.utc)` with `datetime.now(ZoneInfo("Europe/Warsaw"))`
so the extracted `weekday()`, `hour`, and `minute` reflect Warsaw local time. Add an optional
`now: datetime | None = None` parameter so tests can inject a fixed datetime without mocking.

**Contract**:
```python
from zoneinfo import ZoneInfo

WARSAW = ZoneInfo("Europe/Warsaw")

def _current_slot(now: datetime | None = None) -> tuple[int, time]:
    if now is None:
        now = datetime.now(WARSAW)
    day_of_week = now.weekday()
    minute_slot = (now.minute // 15) * 15
    time_slot = time(now.hour, minute_slot)
    return day_of_week, time_slot
```

The `timezone` import can be dropped from `app/api/favourites.py` after this change (it is no
longer used). Module-level `WARSAW` constant avoids constructing `ZoneInfo` on every request.

#### 2. Fix `_insert_availability_for_current_slot()` in the test helper

**File**: `tests/test_favourites.py`

**Intent**: Mirror the production fix — compute the slot in Warsaw time so the inserted row
matches what the fixed API will query. Without this, `test_list_favourites_with_availability`
becomes unreliable in CEST.

**Contract**: Replace `datetime.now(timezone.utc)` with `datetime.now(ZoneInfo("Europe/Warsaw"))`
inside `_insert_availability_for_current_slot`. Import `ZoneInfo` at the top of the test file.
The `timezone` import can be removed from this file if it is no longer used elsewhere in it
(check: `datetime(2026, 1, 5, 10, 0, tzinfo=timezone.utc)` in `_ensure_station` still uses it —
so keep `timezone` in the import).

### Success Criteria

#### Automated Verification

- `uv run ruff check app/api/favourites.py tests/test_favourites.py`
- `uv run ruff format --check app/api/favourites.py tests/test_favourites.py`
- `uv run mypy app/api/favourites.py`
- Existing integration tests still pass: `uv run pytest tests/test_favourites.py -v`

#### Manual Verification

- Read `app/api/favourites.py` and confirm `timezone.utc` no longer appears in `_current_slot()`.
- Read `tests/test_favourites.py` and confirm `_insert_availability_for_current_slot` uses
  `ZoneInfo("Europe/Warsaw")`.

**Implementation Note**: After this phase passes automated checks, pause for manual confirmation
before proceeding to Phase 2.

---

## Phase 2: Unit tests for `_current_slot()`

### Overview

Add a pure-Python (non-integration) test file that exercises `_current_slot()` with fixed
datetimes, covering the normal case and the midnight-Warsaw edge case.

### Changes Required

#### 1. New unit test file

**File**: `tests/test_current_slot.py`

**Intent**: Verify that `_current_slot()` returns Warsaw-local day-of-week and time slot for two
critical cases:
- A normal CEST hour (UTC 10:00 → Warsaw 12:00, same day).
- The midnight-Warsaw window (UTC 22:30 → Warsaw 00:30 next day) where UTC and Warsaw disagree
  on both the hour and the day.

**Contract**: Tests are pure unit tests (no `pytest.mark.integration`, no DB). Use the `now=`
injection parameter to pass fixed `datetime` objects with `ZoneInfo("Europe/Warsaw")` attached.
Two test functions:

```python
# normal CEST case: UTC 10:00 → Warsaw 12:00, Mon
# midnight case:   UTC 22:30 Mon → Warsaw 00:30 Tue
```

The midnight case should assert `day_of_week == 1` (Tuesday, `weekday()` of the Warsaw datetime)
and `time_slot == time(0, 30)`. This is the scenario that was silently broken before the fix.

### Success Criteria

#### Automated Verification

- New tests run and pass without DB: `uv run pytest tests/test_current_slot.py -v`
- No integration marker needed (pure unit).
- `uv run mypy tests/test_current_slot.py`
- `uv run ruff check tests/test_current_slot.py`

#### Manual Verification

- Confirm the midnight test uses a UTC datetime that maps to the *next* calendar day in Warsaw,
  and the assertion reflects the Warsaw day (not the UTC day).

---

## Testing Strategy

### Unit Tests

- `tests/test_current_slot.py` — normal CEST slot, midnight-Warsaw day-flip edge case.

### Integration Tests

- `tests/test_favourites.py` — existing `test_list_favourites_with_availability` is the
  regression guard: after both fixes it inserts the Warsaw slot and the API queries the Warsaw
  slot, so they match.

### Manual Testing Steps

1. In CEST: call `GET /api/v1/favourites` for a station that has availability data.
2. Independently query the DB:
   `SELECT avg_bikes FROM station_availability WHERE station_id='X' AND day_of_week=Y AND time_slot='Z'`
   using Warsaw-local day and slot for the same moment.
3. Assert the two values are equal.

## References

- Frame brief: `context/changes/favourite-card-availability-mismatch/frame.md`
- Bug location: `app/api/favourites.py:13-18`
- Aggregation convention: `app/aggregation.py:6,41-53`
- Existing integration test: `tests/test_favourites.py:103-123`
- `zoneinfo` usage precedent: `scripts/verify_availability.py`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Fix `_current_slot()` and its test helper

#### Automated

- [x] 1.1 ruff check passes on changed files — 6603c84
- [x] 1.2 ruff format --check passes on changed files — 6603c84
- [x] 1.3 mypy passes on `app/api/favourites.py` — 6603c84
- [x] 1.4 Existing integration tests pass: `uv run pytest tests/test_favourites.py -v` — 6603c84

#### Manual

- [x] 1.5 `timezone.utc` no longer appears in `_current_slot()` — 6603c84
- [x] 1.6 `_insert_availability_for_current_slot` uses `ZoneInfo("Europe/Warsaw")` — 6603c84

### Phase 2: Unit tests for `_current_slot()`

#### Automated

- [x] 2.1 Unit tests pass: `uv run pytest tests/test_current_slot.py -v` — bd9e876
- [x] 2.2 mypy passes on `tests/test_current_slot.py` — bd9e876
- [x] 2.3 ruff check passes on `tests/test_current_slot.py` — bd9e876

#### Manual

- [x] 2.4 Midnight test asserts Warsaw next-day (Tuesday) day_of_week, not UTC Monday — bd9e876
