# Favourite Card Availability Mismatch — Plan Brief

> Full plan: `context/changes/favourite-card-availability-mismatch/plan.md`
> Frame brief: `context/changes/favourite-card-availability-mismatch/frame.md`

## What & Why

The favourites homepage cards show wrong availability numbers because `_current_slot()` in
`app/api/favourites.py` computes the current 15-min slot in UTC, while `station_availability`
stores slots in `Europe/Warsaw` local time. The fix is to use Warsaw time in `_current_slot()`.

## Starting Point

`aggregation.py` correctly converts `collected_at` to Warsaw local time before extracting
`day_of_week` and `time_slot`. The favourites API is the sole deviation from that convention.

## Desired End State

`_current_slot()` returns the Warsaw-local slot. The favourites API returns `avg_bikes` values
that match a direct DB query using Warsaw-local day and time for the same moment. A unit test
covers the midnight-Warsaw edge case (UTC 22:30 Mon → Warsaw 00:30 Tue), the scenario most
likely to go unnoticed in manual testing.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Root cause | Timezone mismatch in `_current_slot()` | Direct evidence in two files; all other hypotheses had zero support | Frame |
| Timezone library | `zoneinfo.ZoneInfo` (stdlib) | Python 3.12 in use; already used in `scripts/`; no extra dep | Plan |
| Testability | `now=` optional parameter | Cleaner than mocking; matches the `_utc()` pattern in `test_aggregation.py` | Plan |
| Test helper | Fix `_insert_availability_for_current_slot()` | Same UTC bug; would produce silent false passes in CEST without the fix | Plan |

## Scope

**In scope:** `_current_slot()` fix, `now=` injection param, test helper fix, unit tests for
normal and midnight-Warsaw edge cases.

**Out of scope:** Schema changes, aggregation changes, frontend changes, any other endpoint,
caching layer.

## Architecture / Approach

Single-function fix: replace `datetime.now(timezone.utc)` with
`datetime.now(ZoneInfo("Europe/Warsaw"))` and add `now=None` parameter. Update the companion test
helper to insert at the Warsaw slot. Add a pure-unit test file for the midnight edge case.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Fix `_current_slot()` + test helper | Production bug gone; existing integration test trustworthy | Forgetting to fix the test helper (silent failure in CEST) |
| 2. Unit tests | Midnight-Warsaw edge case covered; regression guard | None — pure Python, no DB needed |

**Prerequisites:** None — no migrations, no config changes, no new dependencies.  
**Estimated effort:** ~1 session, 2 phases.

## Open Risks & Assumptions

- In CET (winter, UTC+1) the offset is 1 hour not 2 — the fix handles this correctly because
  `ZoneInfo` applies the correct offset for the current DST state; no hardcoded offset.
- The `timezone` import in `favourites.py` becomes unused after the fix — it should be removed to
  keep the import clean (mypy/ruff will flag it).

## Success Criteria (Summary)

- `GET /api/v1/favourites` returns `avg_bikes` values matching a direct DB query using Warsaw-local
  slot keys for the same moment, including in CEST.
- Unit test for midnight-Warsaw edge case passes (day_of_week reflects Warsaw next-day).
- All existing favourites integration tests pass unchanged.
