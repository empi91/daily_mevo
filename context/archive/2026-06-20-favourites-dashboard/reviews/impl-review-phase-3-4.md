<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Favourites Dashboard

- **Plan**: context/changes/favourites-dashboard/plan.md
- **Scope**: Phases 3-4 of 6
- **Date**: 2026-06-20
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — No error feedback on mutation failure

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: FavouriteToggleButton.tsx & FavouriteStations.tsx
- **Detail**: Neither component handled addMutation.isError / removeMutation.isError. If the API call fails, the button silently returns to its prior state with no user feedback.
- **Fix**: Added inline error text to both components — "Blad" next to toggle, "Nie udalo sie usunac stacji" above card grid.
- **Decision**: FIXED

### F2 — Shared removeMutation.isPending across all cards

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend/src/components/FavouriteStations.tsx:44
- **Detail**: useFavourites() returns a single removeMutation. Its isPending disables ALL card remove buttons when any one is in-flight.
- **Fix**: Changed disabled condition to compare removeMutation.variables against station.station_id.
- **Decision**: FIXED

### F3 — HomePage uses useFavourites instead of relying on component null-return

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: frontend/src/pages/HomePage.tsx:7
- **Detail**: Plan said render FavouriteStations unconditionally (when auth'd) and let it return null as fallback. Actual: imports useFavourites directly and uses explicit showFavourites ternary. Functionally equivalent, arguably cleaner.
- **Decision**: ACCEPTED — explicit conditional is clearer than relying on child null return

### F4 — No remove confirmation on homepage cards

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: frontend/src/components/FavouriteStations.tsx:41
- **Detail**: The X button immediately removes a favourite. Action is easily reversible (user can re-add). Plan did not specify confirmation UX.
- **Decision**: SKIPPED
