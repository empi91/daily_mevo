<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Data Collection Pipeline

- **Plan**: context/changes/data-collection-pipeline/plan.md
- **Mode**: Deep
- **Date**: 2026-06-04
- **Verdict**: SOUND (after triage — 3 of 4 findings dismissed as based on incorrect API data)
- **Findings**: 1 critical (fixed), 2 warnings (dismissed), 1 observation (dismissed)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | PASS (after fix) |

## Grounding

6/6 paths ✓ (alembic.ini absent — expected, plan creates it), 3/3 symbols ✓ (Settings, create_pool pattern, /health), brief↔plan ✓

## Findings

### F1 — Phase 3 success criteria reference test files created in Phase 4

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Success Criteria vs Phase 4 — Changes item 5
- **Detail**: Phase 3 automated verification requires running `pytest tests/test_gbfs_client.py` and `pytest tests/test_collector.py`, but these test files (plus `tests/conftest.py`) are created in Phase 4, item 5. Phase 3 cannot be verified as written — the implementer would either skip the tests or create them out of sequence.
- **Fix**: Move test file creation (Phase 4 item 5 — the three test files and conftest.py) into Phase 3. Phase 4 then only runs the full `pytest` suite as integration confirmation, not file creation.
- **Decision**: FIXED — moved test files from Phase 4 item 5 to Phase 3 item 6

### F2 — station_id type mismatch: GBFS returns integer, plan assumes string

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 — Schema, Phase 3 — Pydantic models
- **Detail**: The GBFS `station_information.json` feed returns `station_id` as an integer (e.g., `7694`), not a string. The plan documents it as a string ("e.g. '7694'"), defines the DB column as `TEXT PRIMARY KEY`, and specifies the Pydantic model as `station_id: str`. The plan also says "Strict parsing catches API format changes early" — but with strict Pydantic validation, `int → str` coercion is disabled and parsing will fail at runtime.
- **Fix A ⭐ Recommended**: Keep TEXT in DB, use non-strict Pydantic models
  - Strength: TEXT PK is more future-proof (GBFS spec says station_id is a string; Mevo happens to use numeric ones). Pydantic default mode coerces int→str seamlessly.
  - Tradeoff: Loses the "strict catches format changes" benefit the plan explicitly calls out.
  - Confidence: HIGH — Pydantic v2 default mode handles this correctly.
  - Blind spot: None significant.
- **Fix B**: Use INTEGER PK in DB and int in Pydantic models
  - Strength: Matches what the API actually returns. Simpler type flow.
  - Tradeoff: GBFS spec defines station_id as string. If Mevo ever uses non-numeric IDs, this breaks schema + queries.
  - Confidence: MEDIUM — depends on Mevo staying numeric-only.
  - Blind spot: Other GBFS providers' ID formats not surveyed.
- **Decision**: DISMISSED — sub-agent incorrectly reported station_id as integer; live API confirms it is a string (`"7694"`). No type mismatch exists.

### F3 — Station info/status feed gap: ~230 stations will never be collected

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Snapshot Collector, Phase 2 — Schema FK constraint
- **Detail**: Live API shows ~270 stations in `station_information.json` but ~501 in `station_status.json`. The plan's FK constraint (`REFERENCES stations(station_id)`) plus the documented behavior "Skips stations not in the stations table" means ~230 stations present in status but absent from information will silently never have snapshots collected. These may be virtual stations, inactive stations, or stations the info feed excludes for other reasons. The plan doesn't acknowledge this gap.
- **Fix**: Add a note in Phase 3's snapshot_collector.py contract: log a warning with count of skipped station_ids on each collection cycle. This makes the gap visible in logs without changing the FK design. Add a one-time investigation step to Phase 3 manual verification: check what those extra ~230 status entries are (likely virtual stations or stations missing from the info feed).
- **Decision**: DISMISSED — sub-agent incorrectly reported 270 vs 501 stations; live API confirms both feeds have exactly 827 stations. No gap exists.

### F4 — Station count in success criteria is wrong (~827 vs actual ~270–501)

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Current State Analysis, Success Criteria 4.9, Performance Considerations
- **Detail**: The plan states "~827 stations" in three places: Current State Analysis, success criterion 4.9 ("Station count matches expected (~827 active stations)"), and Performance Considerations (~827 rows/snapshot). Live API shows ~270 stations in information and ~501 in status. The estimate is 2–3x off. Storage estimates are conservative so they're still safe, but success criterion 4.9 will fail as written.
- **Fix**: Update all three references to "~270 stations (from station_information feed)" and adjust success criterion 4.9 accordingly.
- **Decision**: DISMISSED — sub-agent miscounted; live API confirms 827 stations in both feeds. Plan's ~827 figure is correct.
