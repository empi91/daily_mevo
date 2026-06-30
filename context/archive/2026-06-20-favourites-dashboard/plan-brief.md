# Favourites Dashboard — Plan Brief

> Full plan: `context/changes/favourites-dashboard/plan.md`
> Research: `context/changes/favourites-dashboard/research.md`

## What & Why

Registered users can favourite stations and see them on the homepage — replacing the "Popular Stations" section — with live availability for the current day/time slot. This is the core feature that justifies user accounts (S-02) and the last roadmap slice (S-03) before the product is feature-complete for MVP. PRD refs: US-02, FR-010, FR-011, FR-012.

## Starting Point

All prerequisites are done. Backend has cookie-based JWT auth, raw asyncpg queries, 6 Alembic migrations. Frontend has React 19 + TanStack Query with a `PopularStations` card grid on the homepage. No favourites code exists — entirely greenfield. `apiDelete` and auth-guarded routes don't exist yet in the frontend.

## Desired End State

A logged-in user visits a station detail page and clicks a heart/star to favourite it. Returning to the homepage, they see their favourited stations in a card grid — each card showing station name, address, and "≈ 3 rowery + 1 e-rower · Niezawodna" for the current time slot. They can remove favourites via an X button on cards. If they have no favourites, the homepage falls back to showing popular stations.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Quick-view content | Avg bikes + ebikes + reliability label for current slot | User wants dynamically-changing availability per current day/time | Plan |
| Where favourites appear | Homepage, replacing Popular Stations | No need for a separate page; favourites are the homepage for authenticated users | Plan |
| Post-login redirect | No redirect; homepage for everyone | Simplest UX, avoids empty-state confusion | Plan |
| Favourite toggle placement | Station detail page + remove on homepage cards | Add where you discover, remove where you manage | Plan |
| Duplicate add behavior | 200 OK (idempotent) | Client doesn't need to track state before toggling | Plan |
| Favourite limit | No limit | ~827 stations total, practical abuse is unlikely | Plan |
| GDPR scope | ON DELETE CASCADE in migration; data export deferred | Cascade is one-line FK, export is a separate feature | Plan |
| Empty slot handling | Show "Brak danych" with neutral styling | Honest, clear for stations with gaps in data | Plan |
| Backend test depth | Full lifecycle + edge cases (10 cases) | Comprehensive coverage catching join query and auth bugs | Plan |
| Nav link | None — favourites are on the homepage | No separate page, so no new nav element needed | Plan |

## Scope

**In scope:**
- `favourites` DB table + migration 007 (ON DELETE CASCADE)
- 3 backend endpoints: list (with availability join), add (idempotent), remove
- Backend integration tests (10 cases)
- `apiDelete` in frontend API client
- `useFavourites` hook + favourites API functions
- `FavouriteToggleButton` on station detail page
- `FavouriteStations` component on homepage (replacing Popular Stations)
- Frontend unit tests for all new components/hooks
- E2E Playwright tests for full favourites lifecycle

**Out of scope:**
- Separate `/favourites` page or route
- GDPR data export endpoint
- Favourite toggle on search results
- Favourite count limit
- Real-time (non-historical) availability data
- Nav link for favourites

## Architecture / Approach

Backend: new `app/api/favourites.py` router with 3 endpoints using asyncpg pool + `current_active_user` auth dependency. The list endpoint does a single SQL join: `favourites JOIN stations LEFT JOIN station_availability` filtered to current day-of-week and 15-min time slot — no N+1. Frontend: new `useFavourites` hook wraps TanStack Query; `HomePage` conditionally renders `<FavouriteStations />` (which returns `null` when empty, falling back to `<PopularStations />`).

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Database & Backend API | Migration + 3 endpoints with availability join | Join query correctness for current time slot |
| 2. Backend Integration Tests | 10 lifecycle + edge case tests | Test fixtures for availability data at specific time slots |
| 3. Frontend API & Station Detail Toggle | apiDelete, useFavourites hook, toggle button on detail page | First auth-aware interactive UI component |
| 4. Homepage Integration | FavouriteStations component replacing PopularStations | Conditional rendering logic, remove button event propagation |
| 5. Frontend Unit Tests | Component + hook tests for all new code | Mocking useFavourites and useAuth together |
| 6. E2E Tests | Playwright browser tests for full favourites flow | Tests depend on station data existing in the running app |

**Prerequisites:** S-01 (done), S-02 (done), B-01 (done). Running Postgres for backend tests. Running dev server for E2E tests.
**Estimated effort:** ~3-4 sessions across 6 phases.

## Open Risks & Assumptions

- The availability join query uses server-side current time — if the server timezone differs from Poland (Europe/Warsaw), the "current slot" will be wrong. Assumption: server time is set correctly or the query uses `AT TIME ZONE`.
- E2E tests assume station data exists in the running app (populated by the real collector or test fixtures). If running against a fresh database, some availability-related assertions may see "Brak danych".
- The `PopularStations` component uses hardcoded `FEATURED_IDS` — if those stations don't exist in the database, the fallback for users without favourites shows nothing. This is a pre-existing issue, not introduced by this change.

## Success Criteria (Summary)

- A logged-in user can toggle favourites on station detail pages and see them with current-slot availability on the homepage
- Homepage gracefully falls back to popular stations when not authenticated or no favourites set
- All backend integration tests (10 cases), frontend unit tests, and E2E tests pass with no regressions
