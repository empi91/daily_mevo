# Add "Statystycznie o tej godzinie:" Label on Fav Cards — Implementation Plan

## Overview

Add a static label row "Statystycznie o tej godzinie:" above the e-bike and bike count rows on favourite station cards. The label gives users context that the displayed numbers are historical averages for the current timeslot, not live data.

## Current State Analysis

`FavouriteStations.tsx` renders three data states inside each card:
- `avg_bikes === null || avg_ebikes === null` → `<p>Brak danych</p>` (label not needed)
- Both round to 0 → `<p className="text-gray-400">Brak rowerów</p>`
- At least one > 0 → individual `<p>` rows for e-bikes and bikes

The label should appear in the second and third cases — i.e., any time avg data is present (not null). The surrounding `<div className="mt-2 text-sm text-gray-700">` at line 28 already scopes exactly this condition.

## Desired End State

Every fav station card that has availability data shows "Statystycznie o tej godzinie:" as the first line inside the stats block, above whatever count rows (or "Brak rowerów") follow. Cards with `null` data continue to show "Brak danych" unchanged.

### Key Discoveries

- `frontend/src/components/FavouriteStations.tsx:25-43` — sole location to edit; no other component renders fav card stats
- Tailwind classes cascade: a `<p>` inside `<div className="mt-2 text-sm text-gray-700">` inherits text size and colour, so no additional class needed on the label element
- No API, hook, or data-model changes required

## What We're NOT Doing

- Changing the "Brak danych" state (null data) — it stays as-is
- Adding any new API fields, types, or hooks
- Styling the label differently from the surrounding text

## Implementation Approach

Insert a single `<p>` with the label text as the first child of the stats `<div>` at line 28. Because the label should appear for all non-null data (including the "Brak rowerów" empty state), placing it unconditionally inside the outer `<div>` is the correct and simplest position.

## Phase 1: Add label to FavouriteStations component

### Overview

Single JSX insertion in `FavouriteStations.tsx`.

### Changes Required

#### 1. Insert label `<p>` element

**File**: `frontend/src/components/FavouriteStations.tsx`

**Intent**: Add "Statystycznie o tej godzinie:" as the first child of the `<div className="mt-2 text-sm text-gray-700">` at line 28, so it renders above the bike/e-bike counts (or "Brak rowerów") whenever availability data is present.

**Contract**: New `<p>` element with no additional Tailwind classes (inherits `text-sm text-gray-700` from parent div). Inserted immediately after the opening `<div className="mt-2 text-sm text-gray-700">` tag, before the IIFE.

### Success Criteria

#### Automated Verification

- Type check passes: `cd frontend && npx tsc --noEmit`
- Lint passes: `cd frontend && npx eslint src/`

#### Manual Verification

- Open the app as a logged-in user with at least one favourite station that has availability data → label "Statystycznie o tej godzinie:" appears above the bike counts
- A favourite station with both counts = 0 shows label above "Brak rowerów"
- A favourite station with null data shows "Brak danych" and no label
- No visual regressions on cards without the label condition (null case)

**Implementation Note**: After automated checks pass, do a quick visual check in the browser before marking complete.

---

## Testing Strategy

### Manual Testing Steps

1. Log in, add a favourite station that has historical data for the current timeslot
2. Confirm "Statystycznie o tej godzinie:" appears as the first line in the stats block
3. If possible, test a station in a slot with zero bikes (e.g., early morning) — label should still appear above "Brak rowerów"
4. Confirm stations with null data still show "Brak danych" with no label

## References

- Component: `frontend/src/components/FavouriteStations.tsx`
- GitHub issue: #37 ([E-15])

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Add label to FavouriteStations component

#### Automated

- [x] 1.1 Type check passes: `cd frontend && npx tsc --noEmit` — 04d63a8
- [x] 1.2 Lint passes: `cd frontend && npx eslint src/` — 04d63a8

#### Manual

- [x] 1.3 Label visible above counts on station with data — 04d63a8
- [x] 1.4 Label visible above "Brak rowerów" on zero-count station — 04d63a8
- [x] 1.5 "Brak danych" card unchanged (no label) — 04d63a8
