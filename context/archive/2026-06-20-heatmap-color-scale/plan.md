# Heatmap Color Scale — 5-Tier Granular Implementation Plan

## Overview

Replace the current 3-tier `reliability_label`-driven heatmap color scale with a 5-tier scale computed entirely in the frontend from `avg_bikes + avg_ebikes`. No backend or API changes.

## Current State Analysis

The `cellColor()` function in `AvailabilityHeatmap.tsx` takes a `reliability_label` string from the backend and maps it to one of 3 Tailwind classes. The backend computes the label using 2 configurable thresholds. Both `avg_bikes` and `avg_ebikes` are already present on each `AvailabilitySlot` — the frontend can bucket the combined total directly without any backend involvement.

### Key Discoveries:

- `frontend/src/components/AvailabilityHeatmap.tsx:16–27` — `cellColor(label: string)` current signature and 3-case switch
- `frontend/src/components/AvailabilityHeatmap.tsx:93` — call site: `cellColor(slot?.reliability_label ?? 'insufficient_data')`
- `frontend/src/components/AvailabilityHeatmap.tsx:30` — `cellTitle()` also checks `slot.reliability_label === 'insufficient_data'` for tooltip; needs to match the new "no data" condition
- `frontend/src/components/AvailabilityHeatmap.tsx:103–115` — legend: 3 colour swatches + no-data
- `frontend/src/components/AvailabilityHeatmap.test.tsx:25–79` — 3 colour tests + 1 legend test that will fail; other tests (interaction, empty grid, hour labels) are unaffected
- `frontend/src/test/fixtures.ts:38–53` — existing fixture slots cover all 5 new buckets without additions: total 1 (12:00), total 3 (08:00), total 5 (09:00 Tue), total 8 (06:00), total 12 (14:00 Sat)

## Desired End State

The heatmap displays 5 colour tiers based on combined average bike count, with a red→orange→yellow→lime→green gradient. Cells with no recorded data remain gray. The legend reflects all 5 tiers with Polish labels. All test cases exercise every bucket.

### Key Discoveries:

- No backend, config, or API contract changes needed
- `reliability_label` field stays on the API response but is no longer read by the frontend for colour
- `cellTitle()` no-data check must change from `reliability_label === 'insufficient_data'` to `sample_count < 1` for consistency with the new approach

## What We're NOT Doing

- No backend label expansion or config threshold changes
- No changes to `app/api/stations.py` or `app/config.py`
- No changes to the `AvailabilitySlot` TypeScript interface
- No changes to grid geometry, interaction behaviour, or row-highlight colours
- No i18n changes — legend text stays in Polish

## Implementation Approach

Rewrite `cellColor()` to accept `(total: number, sampleCount: number)` and return a class based on the 5 buckets. Update the single call site and `cellTitle()`'s no-data guard. Rewrite the legend. Update tests.

## Critical Implementation Details

**No-data condition**: `!slot || slot.sample_count < 1`. Undefined slots (no data point for a time slot) are the common case; `sample_count === 0` covers slots that exist in the DB with zero snapshots. Keep `bg-gray-200` for both.

---

## Phase 1: Component — cellColor, cellTitle, legend, call site

### Overview

Update `AvailabilityHeatmap.tsx` with the new `cellColor()` signature, fix the `cellTitle()` no-data guard, update the call site, and rewrite the legend.

### Changes Required:

#### 1. `cellColor()` function

**File**: `frontend/src/components/AvailabilityHeatmap.tsx`

**Intent**: Replace the 3-case string switch with a 5-bucket numeric range check.

**Contract**: New signature `cellColor(total: number, sampleCount: number): string`. Buckets and return values:

| Condition | Tailwind class |
|---|---|
| `sampleCount < 1` | `bg-gray-200` |
| `total <= 1` | `bg-red-500` |
| `total <= 3` | `bg-orange-400` |
| `total <= 6` | `bg-yellow-400` |
| `total <= 9` | `bg-lime-400` |
| else (≥ 10) | `bg-green-500` |

#### 2. Call site update

**File**: `frontend/src/components/AvailabilityHeatmap.tsx` (line 93)

**Intent**: Pass the numeric total and sample count instead of the string label.

**Contract**: Change `cellColor(slot?.reliability_label ?? 'insufficient_data')` to `cellColor((slot?.avg_bikes ?? 0) + (slot?.avg_ebikes ?? 0), slot?.sample_count ?? 0)`.

#### 3. `cellTitle()` no-data guard

**File**: `frontend/src/components/AvailabilityHeatmap.tsx` (line 30)

**Intent**: Keep tooltip behaviour consistent with the new no-data condition so gray cells still show "brak danych".

**Contract**: Change `slot.reliability_label === 'insufficient_data'` to `slot.sample_count < 1`.

#### 4. Legend

**File**: `frontend/src/components/AvailabilityHeatmap.tsx` (lines 103–115)

**Intent**: Replace 3-entry legend with 5-entry legend reflecting the new buckets.

**Contract**: 6 entries in display order (best → worst → no data):

| Swatch | Label |
|---|---|
| `bg-green-500` | ≥10 rowerów łącznie |
| `bg-lime-400` | 7–9 rowerów łącznie |
| `bg-yellow-400` | 4–6 rowerów łącznie |
| `bg-orange-400` | 2–3 rowery łącznie |
| `bg-red-500` | 0–1 rower łącznie |
| `bg-gray-200` | brak danych |

### Success Criteria:

#### Automated Verification:

- TypeScript compiles without errors: `cd frontend && npx tsc --noEmit`
- Linter passes: `cd frontend && npx eslint src/components/AvailabilityHeatmap.tsx`

#### Manual Verification:

- Heatmap renders with visible colour variation across the gradient
- Hovering over cells shows correct tooltips (gray cells say "brak danych", coloured cells show bike counts)
- Legend shows all 6 entries with correct labels

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Tests

### Overview

Update the 3 failing colour tests, add 2 new tests for the 4–6 and 7–9 buckets, add a 10+ test, and fix the legend test.

### Changes Required:

#### 1. Existing colour tests (3 updates)

**File**: `frontend/src/components/AvailabilityHeatmap.test.tsx`

**Intent**: Correct the expected Tailwind class in each of the 3 existing colour tests to match the new bucket mapping.

**Contract**:
- Test `cells with reliable data` (line 25): slot `06:00` has total 8 → now `bg-lime-400`, not `bg-green-500`
- Test `cells with uncertain data` (line 31): slot `08:00` has total 3 → now `bg-orange-400`, not `bg-yellow-400`
- Test `cells with empty data` (line 37): slot `12:00` has total 1 → stays `bg-red-500` ✓ (no change needed — already correct)

#### 2. New colour tests for uncovered buckets (3 additions)

**File**: `frontend/src/components/AvailabilityHeatmap.test.tsx`

**Intent**: Add one test per new bucket that wasn't covered before (4–6, 7–9, 10+).

**Contract**: Use existing fixture slots — no fixture additions needed:
- 4–6 bucket: slot `09:00` on Tuesday has total 5 (`avg_bikes: 3, avg_ebikes: 2`) → `bg-yellow-400`; query by title `/09:00 — śr\. 5 rowerów/`
- 7–9 bucket: repurpose the updated `06:00` test or add a separate assertion → `bg-lime-400`
- 10+ bucket: slot `14:00` on Saturday has total 12 (`avg_bikes: 8, avg_ebikes: 4`) → `bg-green-500`; query by title `/14:00 — śr\. 12 rowerów/`

#### 3. Legend test update

**File**: `frontend/src/components/AvailabilityHeatmap.test.tsx` (lines 74–80)

**Intent**: Update expected legend text strings to match the new 5-entry legend.

**Contract**: Replace the 3 old label assertions with 5 new ones:
- `/≥10 rowerów łącznie/`
- `/7–9 rowerów łącznie/`
- `/4–6 rowerów łącznie/`
- `/2–3 rowery łącznie/`
- `/0–1 rower łącznie/`
- `/brak danych/` (unchanged)

### Success Criteria:

#### Automated Verification:

- All frontend tests pass: `cd frontend && npx vitest run`
- No test skips or pending tests related to heatmap colour

#### Manual Verification:

- Test output shows all 5 colour-bucket tests passing by name

---

## Testing Strategy

### Unit Tests:

- One test per colour bucket (6 total incl. no-data) — each queries a cell by title text and asserts the class
- Legend text test asserts all 6 label strings are present
- Existing interaction, empty grid, and hour-label tests are unchanged

### Manual Testing Steps:

1. Open a station detail page in the dev server
2. Verify the heatmap shows a visible gradient — some hours clearly red, others green
3. Hover over several cells across the range and verify tooltips match the colour (red cells → low avg count, green → high)
4. Verify the legend at the bottom shows all 6 entries with correct Polish text
5. Verify row selection and hover states are visually unaffected

## References

- Research: `context/changes/heatmap-color-scale/research.md`
- Component: `frontend/src/components/AvailabilityHeatmap.tsx`
- Tests: `frontend/src/components/AvailabilityHeatmap.test.tsx`
- Fixtures: `frontend/src/test/fixtures.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Component — cellColor, cellTitle, legend, call site

#### Automated

- [x] 1.1 TypeScript compiles without errors: `cd frontend && npx tsc --noEmit` — c0a9385
- [x] 1.2 Linter passes: `cd frontend && npx eslint src/components/AvailabilityHeatmap.tsx` — c0a9385

#### Manual

- [x] 1.3 Heatmap renders with visible colour variation across the gradient — c0a9385
- [x] 1.4 Hovering cells shows correct tooltips (gray → brak danych, coloured → bike counts) — c0a9385
- [x] 1.5 Legend shows all 6 entries with correct labels — c0a9385

### Phase 2: Tests

#### Automated

- [x] 2.1 All frontend tests pass: `cd frontend && npx vitest run` — 84e47bb
- [x] 2.2 No test skips or pending tests related to heatmap colour — 84e47bb

#### Manual

- [x] 2.3 Test output shows all 5 colour-bucket tests passing by name — 84e47bb
