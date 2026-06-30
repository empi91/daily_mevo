# Frame Brief: Favourite card availability values mismatch

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Availability numbers displayed on favourite station cards (homepage) show
different values than the station detail page for the same station at the same
moment.

## Initial Framing (preserved)

- **User's stated cause or approach**: Unknown — multiple candidates listed:
  data source difference, wrong time window, day-of-week misalignment, timezone
  handling, caching layer.
- **User's proposed direction**: Direct comparison — card display vs station
  detail page vs raw DB query for a sample of stations.
- **Pre-dispatch narrowing**: Card shows different numbers than detail page
  (side-by-side confirmed); card is supposed to display historical average for
  the current 15-min time slot; unknown whether this ever worked correctly.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Timezone in slot lookup** — `_current_slot()` uses UTC to look up a slot
   that was stored in Warsaw local time, so the wrong row is fetched.  ← **actual root cause**
2. **Day-of-week encoding mismatch** — Python `weekday()` vs JS `getDay()` vs
   SQL `ISODOW` could produce off-by-one for Sunday.
3. **Data source divergence** — card and detail page might query different tables
   or aggregations entirely.
4. **Caching** — one path serves a stale cached response while the other is live.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **Timezone mismatch** — `_current_slot()` uses UTC; `station_availability` rows are keyed by `Europe/Warsaw` local time (aggregation.py:6,52) | `aggregation.py:52`: `collected_at AT TIME ZONE 'Europe/Warsaw'`; `favourites.py:14`: `datetime.now(timezone.utc)` — 2-hour drift in CEST, wrong day near midnight | **STRONG** |
| **Day-of-week encoding mismatch** | Aggregation uses `ISODOW-1` (Mon=0); favourites API uses `now.weekday()` (Mon=0); frontend converts JS Sunday=0 → Mon=0. All aligned. | **NONE** |
| **Data source divergence** | Both paths read from `station_availability` via the same column names. Station detail page returns all rows; favourites API does a filtered JOIN. Same table. | **NONE** |
| **Caching** | No caching middleware visible in either path. Both hit the DB pool directly. | **NONE** |

## Narrowing Signals

- The aggregation explicitly converts to `Europe/Warsaw` before extracting
  `day_of_week` and `time_slot` (`aggregation.py:41-43`).
- The favourites API computes the slot in UTC (`favourites.py:14`), then queries
  `station_availability` with those UTC values.
- In CEST (UTC+2), the mismatch is consistently 2 slots (30 min) on time, and
  flips the day during the 22:00–00:00 UTC window (midnight Warsaw).
- The station detail page uses browser local time for day selection
  (`StationDetailPage.tsx:13-15`), which for Polish users matches Warsaw time —
  so it reads the correct slot, making the discrepancy visible.

## Cross-System Convention

Historical data apps serving a single timezone (Poland) consistently aggregate
and serve in local time. The aggregation correctly uses `Europe/Warsaw`. The
slot-lookup helper in the favourites API is the sole deviation from that
convention.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: `_current_slot()` in
> `app/api/favourites.py` computes the current 15-min slot in UTC, but
> `station_availability` stores slots in Europe/Warsaw local time, causing the
> wrong row to be fetched.

The fix is narrow and surgical: replace `datetime.now(timezone.utc)` in
`_current_slot()` with a Warsaw-aware datetime (using `zoneinfo.ZoneInfo` or
`pytz`). No schema changes, no aggregation changes, no frontend changes needed.

## Confidence

**HIGH** — the timezone mismatch is directly readable in two files with matching
line references. No ambiguity remains. All other hypotheses have zero supporting
evidence.

## What Changes for /10x-plan

The plan should fix `_current_slot()` in `app/api/favourites.py` to use
`Europe/Warsaw` local time instead of UTC, add a unit test for the slot
calculation (including a midnight-Warsaw edge case), and add a regression test
that verifies the favourites endpoint returns a value consistent with the slot
the aggregation would produce for the same moment.

## References

- `app/api/favourites.py:13-18` — `_current_slot()` (bug location)
- `app/aggregation.py:6,41-53` — `LOCAL_TZ = "Europe/Warsaw"`, local-time slot extraction
- `frontend/src/pages/StationDetailPage.tsx:13-16` — `currentDayOfWeek()` uses browser local time
- `app/api/stations.py` — station detail endpoint (returns all slots, no slot selection)
