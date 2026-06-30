# Favourite Cards Polish UI — Implementation Plan

## Overview

Fix three UX bugs on the favourite station cards (homepage): uniform card height via Tailwind flex utilities, removal of the reliability label and `≈` prefix, and replacement of the inline pluralisation logic with the correct Polish grammar helpers from `polish.ts`. Availability displays as two stacked rows — e-bikes first, then regular bikes — using the full Polish noun forms.

## Current State Analysis

- `FavouriteStations.tsx` renders a grid of cards. Each card is a `<Link>` inside a `<div className="relative">`. The Link has `block` but no height constraint, so card heights diverge when content varies.
- `formatAvailability()` (lines 9–18) uses inline pluralisation (`bikes < 5 ? 'y' : 'ów'`) that is grammatically wrong for numbers like 22–24, 32–34 (should get "rowery", get "rowerów"). It also prefixes `≈` and appends the `reliability_label` string.
- `reliability_label` from the backend is an English key (`"reliable"`, `"uncertain"`, `"empty"`, `"insufficient_data"`); the current component renders it raw, producing English text on a Polish UI.
- `frontend/src/polish.ts` already exports `bikesLabel(n)` and `ebikesLabel(n)` with the correct Polish grammar algorithm (handles 12–14 edge case). `ebikesLabel` uses the full form: "rower elektryczny / rowery elektryczne / rowerów elektrycznych".

### Key Discoveries:

- `FavouriteStation` type (frontend/src/api/favourites.ts:3-13) has no `status` field; the "English text" the issue refers to is the `reliability_label` string.
- The existing test fixture (FavouriteStations.test.tsx:22) has `reliability_label: 'Niezawodna'` — the old format assertion at line 73 (`≈ 5 rowerów + 3 e-rowery · Niezawodna`) will break once the component is updated; tests must be rewritten.
- `polish.ts:25-33` — the `pluralize()` function correctly handles the 12–14 "many" exception; `ebikesLabel` delegates to it with the full-form `PluralForms`.
- Grid items stretch to fill row height by default, but that only helps when the direct grid child fills its height. The `<div className="relative">` wrapper is the grid child; the `<Link>` inside it needs `h-full` to fill it.

## Desired End State

Each favourite station card:
- Has the same height as its row-siblings regardless of address/content length.
- Shows two lines of availability when data is present: e-bikes count + full Polish noun (first), regular bikes count + full Polish noun (second). Lines with count = 0 are hidden.
- Shows "Brak danych" when `avg_bikes` or `avg_ebikes` is null.
- Shows no prefix symbol and no reliability label.

### Key Discoveries:

- `bikesLabel` and `ebikesLabel` in `polish.ts` cover all required cases; no new exports needed.
- The remove button uses `absolute top-2 right-2`, so it sits outside the Link flow — the flex layout change on Link does not interfere.

## What We're NOT Doing

- Not changing the backend `_reliability_label()` function — the field remains English in the API.
- Not adding a translation map for `reliability_label` — we simply stop displaying it.
- Not changing `PopularStations.tsx` or any other component.
- Not changing the `FavouriteStation` TypeScript interface (the `reliability_label` field stays but is ignored in rendering).

## Implementation Approach

Single-file frontend change in `FavouriteStations.tsx`: drop `formatAvailability`, import `bikesLabel`/`ebikesLabel`, inline two-row availability JSX, and add `h-full flex flex-col` to the Link. Then update the unit tests to match the new output.

---

## Phase 1: Refactor FavouriteStations.tsx

### Overview

Replace the `formatAvailability` helper with inline two-row JSX. Import the two `polish.ts` helpers. Fix card height by adding flex utilities to the Link. Drop `≈` prefix and reliability label.

### Changes Required:

#### 1. Import bikesLabel and ebikesLabel

**File**: `frontend/src/components/FavouriteStations.tsx`

**Intent**: Add named imports for the two pluralisation helpers so the component can build grammatically correct Polish strings.

**Contract**: Add `import { bikesLabel, ebikesLabel } from '../polish'` alongside the existing imports.

#### 2. Remove formatAvailability and replace with inline JSX

**File**: `frontend/src/components/FavouriteStations.tsx`

**Intent**: Delete the `formatAvailability` function entirely and inline the availability display directly in JSX as two `<p>` elements — e-bikes row first, regular bikes row second. Count = 0 rows are suppressed. Null data shows "Brak danych". No `≈` prefix, no reliability label.

**Contract**:
- When `avg_bikes === null || avg_ebikes === null`: render `<p className="text-sm text-gray-400">Brak danych</p>`
- Otherwise compute `bikes = Math.round(avg_bikes)`, `ebikes = Math.round(avg_ebikes)`.
- Render `<div className="mt-2 text-sm text-gray-700">` containing:
  - If `ebikes > 0`: `<p>{ebikes} {ebikesLabel(ebikes)}</p>`
  - If `bikes > 0`: `<p>{bikes} {bikesLabel(bikes)}</p>`
  - If both = 0: `<p className="text-gray-400">Brak rowerów</p>`

#### 3. Add h-full flex flex-col to the Link for uniform card height

**File**: `frontend/src/components/FavouriteStations.tsx`

**Intent**: Make the Link fill the full height of its grid-cell wrapper so all cards in a row align to the tallest card.

**Contract**: Change the Link's `className` from `"block p-4 ..."` to `"flex flex-col h-full p-4 ..."`. No other layout classes change.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `cd frontend && npx tsc --noEmit`
- Unit tests pass (FavouriteStations suite): `cd frontend && npx vitest run src/components/FavouriteStations.test.tsx`
- Full frontend test suite passes: `cd frontend && npx vitest run`
- Linting passes: `cd frontend && npx eslint src/`

#### Manual Verification:

- Log in, add at least two stations as favourites — one with data and one without — and confirm cards in the same row have equal height.
- Confirm availability shows e-bikes on the first line and regular bikes on the second.
- Confirm no `≈` prefix and no English/Polish reliability label appears anywhere on the cards.
- Confirm "Brak danych" appears for stations with no availability data.

**Implementation Note**: After completing Phase 1 automated verification, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Update Unit Tests

### Overview

Rewrite the availability assertion in `FavouriteStations.test.tsx` to match the new two-row format (e-bikes first, regular bikes second, no prefix, no label). Verify the "Brak danych" case still works.

### Changes Required:

#### 1. Update the availability test assertion

**File**: `frontend/src/components/FavouriteStations.test.tsx`

**Intent**: Replace the old combined-string assertion (`≈ 5 rowerów + 3 e-rowery · Niezawodna`) with two separate `getByText` checks — one for the e-bikes row and one for the bikes row.

**Contract**:
- Remove: `expect(screen.getByText(/≈ 5 rowerów \+ 3 e-rowery · Niezawodna/)).toBeInTheDocument()`
- Add: `expect(screen.getByText('3 rowery elektryczne')).toBeInTheDocument()` and `expect(screen.getByText('5 rowerów')).toBeInTheDocument()`
- Test fixture has `avg_bikes: 5`, `avg_ebikes: 3` — `bikesLabel(5)` → "rowerów", `ebikesLabel(3)` → "rowery elektryczne".

#### 2. Verify the null-data test still passes

**File**: `frontend/src/components/FavouriteStations.test.tsx`

**Intent**: Confirm the "Brak danych" test (line 76-80) requires no change — the rendered text is the same.

**Contract**: No edit needed; just verify the test passes with the new component code.

### Success Criteria:

#### Automated Verification:

- FavouriteStations test suite passes: `cd frontend && npx vitest run src/components/FavouriteStations.test.tsx`
- Full frontend test suite passes: `cd frontend && npx vitest run`

#### Manual Verification:

- All assertions in FavouriteStations.test.tsx are green and correspond to real rendered output (no accidental false-positives from over-broad matchers).

---

## Testing Strategy

### Unit Tests:

- Two updated assertions in `FavouriteStations.test.tsx` for the new availability display.
- Existing remove-button, empty-list, link-URL, and "Brak danych" tests remain unchanged.

### Manual Testing Steps:

1. Start the frontend dev server (`cd frontend && npx vite`).
2. Log in with a test account; add two stations as favourites — pick one with recent data and one without.
3. On the homepage, visually verify uniform card height within any grid row.
4. Verify e-bikes line appears above bikes line on a card that has both.
5. Verify no `≈` and no reliability label on any card.
6. Verify "Brak danych" for the station with no data.

## References

- Related change: `context/changes/favourites-dashboard/` (original favourites dashboard implementation)
- Component under test: `frontend/src/components/FavouriteStations.tsx`
- Polish helpers: `frontend/src/polish.ts`
- Unit tests: `frontend/src/components/FavouriteStations.test.tsx`
- GitHub issue: [B-06] #34

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Refactor FavouriteStations.tsx

#### Automated

- [x] 1.1 Type checking passes: `cd frontend && npx tsc --noEmit` — af9be40
- [x] 1.2 FavouriteStations unit tests pass: `cd frontend && npx vitest run src/components/FavouriteStations.test.tsx` — af9be40
- [x] 1.3 Full frontend test suite passes: `cd frontend && npx vitest run` — af9be40
- [x] 1.4 Linting passes: `cd frontend && npx eslint src/` — af9be40

#### Manual

- [x] 1.5 Cards in same grid row have equal height with different content volumes — af9be40
- [x] 1.6 E-bikes row appears above bikes row; no `≈` prefix; no reliability label — af9be40
- [x] 1.7 "Brak danych" shown for stations without availability data — af9be40

### Phase 2: Update Unit Tests

#### Automated

- [x] 2.1 FavouriteStations test suite passes: `cd frontend && npx vitest run src/components/FavouriteStations.test.tsx` — af9be40
- [x] 2.2 Full frontend test suite passes: `cd frontend && npx vitest run` — af9be40

#### Manual

- [x] 2.3 All FavouriteStations assertions match real rendered output — af9be40
