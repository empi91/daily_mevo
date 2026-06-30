# Favourite Cards Polish UI — Plan Brief

> Full plan: `context/changes/fav-cards-polish-ui/plan.md`

## What & Why

Fix three UX bugs in the favourite station cards on the homepage (GitHub issue [B-06] #34): cards have inconsistent heights, availability text contains English reliability labels and a `≈` prefix, and the inline pluralisation uses a simplified rule that produces grammatically incorrect Polish for numbers like 22–24. The project already has a correct `polish.ts` utility with the right algorithm — this plan wires it up and cleans up the card layout.

## Starting Point

`FavouriteStations.tsx` renders a grid with a local `formatAvailability()` function that uses `bikes < 5` as the only plural boundary (wrong for 22–24 etc.), prepends `≈`, and appends the raw English `reliability_label` from the backend (`"reliable"`, `"uncertain"`, etc.). The Link card uses `block` with no height constraint, so rows diverge when content varies.

## Desired End State

Each favourite card: same height as its row-siblings; availability displayed as two stacked rows (e-bikes first, then regular bikes) using full Polish noun forms from `bikesLabel()`/`ebikesLabel()`; no prefix symbol; no reliability label. "Brak danych" for null data.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Translation layer | Frontend only | Drop the label entirely on cards — no translation map needed; limits blast radius to one component | Plan |
| Reliability label on cards | Hidden | User wants clean card without a label; the backend returns English keys which would need translation | Plan |
| `≈` prefix | Removed | User preference — plain count is clearer | Plan |
| E-bike row order | E-bikes first, bikes second | User decision | Plan |
| E-bike noun form | Full form ("rowery elektryczne") | Aligns with existing `ebikesLabel()` in polish.ts; avoids adding a new short-form helper | Plan |
| Card height | `h-full flex flex-col` on Link | Standard Tailwind approach; responsive, no fixed pixel values | Plan |

## Scope

**In scope:**
- `FavouriteStations.tsx` — layout and availability rendering
- `FavouriteStations.test.tsx` — update assertions to match new output
- Import of `bikesLabel`/`ebikesLabel` from `polish.ts`

**Out of scope:**
- Backend `_reliability_label()` function — stays English
- `FavouriteStation` TypeScript interface — `reliability_label` field stays, just unused in rendering
- `PopularStations.tsx` or any other component
- New exports to `polish.ts`

## Architecture / Approach

Single-component frontend change. Delete `formatAvailability`, import the two existing `polish.ts` helpers, inline a small JSX block for the two availability rows, and add Tailwind flex utilities to the Link. Tests are updated to match the new rendered text.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Refactor FavouriteStations.tsx | New two-row layout, correct pluralisation, uniform card height | Existing unit test breaks until Phase 2 — run both phases before committing |
| 2. Update unit tests | Green test suite matching new rendered output | Over-broad matchers could produce false positives — check assertions are specific |

**Prerequisites:** Frontend dev server runnable (`cd frontend && npx vite`); test DB not required (tests are mocked).
**Estimated effort:** ~1 session, 2 phases, mostly mechanical changes.

## Open Risks & Assumptions

- The `≈ 5 rowerów + 3 e-rowery · Niezawodna` test assertion (line 73 of the test file) is the only assertion that needs rewriting; the other four tests are unaffected.
- If `avg_bikes` is 0 and `avg_ebikes` is 0 (both non-null), neither row renders — the "Brak rowerów" fallback covers this edge case.

## Success Criteria (Summary)

- All cards in a homepage grid row share the same height regardless of content.
- Availability shows as two Polish noun-declined rows with no prefix or label.
- `npx vitest run` passes with zero failures.
