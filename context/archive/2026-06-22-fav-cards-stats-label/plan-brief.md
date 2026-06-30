# Add "Statystycznie o tej godzinie:" Label — Plan Brief

> Full plan: `context/changes/fav-cards-stats-label/plan.md`

## What & Why

Add a static label "Statystycznie o tej godzinie:" above the e-bike and bike count rows on favourite station cards. The label tells users the numbers are historical averages for the current timeslot, not real-time live data.

## Starting Point

`FavouriteStations.tsx` currently renders counts (or "Brak rowerów" / "Brak danych") with no contextual heading. A user seeing "2 e-rowery / 1 rower" has no indication these are statistical averages rather than live readings.

## Desired End State

Every fav card with non-null availability data shows "Statystycznie o tej godzinie:" as the first line of the stats block. Cards with null data continue to show "Brak danych" unchanged.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Label scope | Always when data non-null | Covers both counts > 0 and "Brak rowerów" with zero extra branching |
| Styling | Inherit `text-sm text-gray-700` from parent div | Matches surrounding text; no new style tokens |
| Placement | First child of existing stats `<div>` | Unconditional placement is simpler and correct for the chosen scope |

## Scope

**In scope:** Single `<p>` insertion in `FavouriteStations.tsx`

**Out of scope:** API changes, data model changes, styling variations, changes to "Brak danych" state

## Architecture / Approach

One-line JSX insertion. The existing `<div className="mt-2 text-sm text-gray-700">` at line 28 of `FavouriteStations.tsx` already wraps exactly the right condition (non-null data). A `<p>` placed as its first child inherits all needed styles.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Add label | "Statystycznie o tej godzinie:" visible on all data-bearing cards | None — zero logic change |

**Prerequisites:** None  
**Estimated effort:** ~5 minutes

## Open Risks & Assumptions

- None — purely additive, no logic change, no data dependencies

## Success Criteria (Summary)

- Label appears above counts on every fav card with non-null data
- "Brak danych" cards unchanged
- TypeScript and lint checks pass
