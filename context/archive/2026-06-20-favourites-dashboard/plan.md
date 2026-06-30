# Favourites Dashboard Implementation Plan

## Overview

Registered users can toggle stations as favourites from the station detail page and see their favourited stations — with live availability for the current day/time slot — on the homepage, replacing the "Popular Stations" section. If the user has no favourites, the homepage falls back to displaying popular stations.

## Current State Analysis

All prerequisites are complete: S-01 (station availability page), S-02 (user auth), B-01 (auth session fix). The backend uses raw asyncpg queries in FastAPI route handlers with cookie-based JWT auth via fastapi-users. The frontend uses React 19 + TanStack Query + Tailwind CSS with a card-grid pattern in `PopularStations.tsx`. No favourites code exists anywhere — this is entirely greenfield.

### Key Discoveries:

- `PopularStations.tsx` is the direct UI template — card grid with `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, each card a clickable `<Link>` to station detail
- `apiDelete` does not exist in `frontend/src/api/client.ts` — needs to be added
- No `ProtectedRoute` or auth-guarded route exists — but since favourites live on the homepage (not a separate page), no route guard is needed
- `current_active_user` dependency is exported from `app/auth/config.py:40` and ready for protecting endpoints
- `clean_tables` fixture in `tests/conftest.py:154` truncates 5 tables — `favourites` must be added
- Auth test helpers `_register_and_login` and `_cookie_header` in `tests/test_auth.py:17-32` can be reused
- E2E tests follow Playwright patterns in `e2e/` with Polish UI labels, `getByRole`/`getByLabel` locators, unique email via `Date.now()`, and risk-tied test names per `e2e/e2e-rules.md`

## Desired End State

A registered user can:
1. Visit any station detail page and toggle a heart/star to add or remove it from favourites
2. Return to the homepage and see their favourited stations displayed in a card grid (replacing "Popular Stations"), where each card shows the station name, address, average bikes + ebikes + reliability label for the current day-of-week and 15-minute time slot
3. Remove a favourite directly from the homepage card via an X button
4. If they have no favourites, the homepage shows the existing "Popular Stations" section

**Verification**: All backend integration tests pass, all frontend unit tests pass, E2E tests cover the full favourites lifecycle against a running app. Account deletion cascades to favourites (ON DELETE CASCADE).

## What We're NOT Doing

- **Separate `/favourites` page** — favourites live on the homepage only, replacing Popular Stations
- **Nav link for favourites** — no new header navigation; favourites are the homepage for authenticated users
- **Redirect after login** — no login redirect; homepage is the landing page for everyone
- **Favourite limit** — no cap on how many stations a user can favourite
- **GDPR data export** — deferred to a separate change; only ON DELETE CASCADE is included
- **Favourite toggle on search results** — only on station detail page and homepage cards
- **Real-time availability** — cards show historical averages from `station_availability`, not live Mevo API data

## Implementation Approach

Backend-first: migration + 3 API endpoints + backend tests, then frontend toggle + homepage integration + frontend tests, then E2E tests. Each phase is independently verifiable. The favourites API returns station data joined with availability for the current time slot, so the frontend doesn't need to make separate availability calls per station.

## Phase 1: Database & Backend API

### Overview

Create the `favourites` table, add three API endpoints (list, add, remove), register the new router. The list endpoint joins `station_availability` to return current-slot availability per favourite.

### Changes Required:

#### 1. Migration

**File**: `alembic/versions/007_create_favourites.py`

**Intent**: Create the `favourites` table linking users to stations, with ON DELETE CASCADE on the user FK for GDPR compliance.

**Contract**: New migration with `revision = "007"`, `down_revision = "006"`. Table `favourites` with columns: `id SERIAL PRIMARY KEY`, `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`, `station_id TEXT NOT NULL REFERENCES stations(station_id)`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Unique constraint on `(user_id, station_id)`. Index on `user_id` for fast lookups. Downgrade drops the table.

#### 2. Pydantic Response Models

**File**: `app/api/models.py`

**Intent**: Add response model for favourite stations that includes current-slot availability data.

**Contract**: New `FavouriteStationResponse` model with fields: `station_id: str`, `name: str`, `address: str | None`, `lat: float`, `lon: float`, `capacity: int | None`, `avg_bikes: float | None`, `avg_ebikes: float | None`, `reliability_label: str | None`. The availability fields are nullable because the current time slot may have no data.

#### 3. Favourites Router

**File**: `app/api/favourites.py` (new file)

**Intent**: Three endpoints for managing favourites. The list endpoint joins station data with `station_availability` for the current day-of-week and 15-minute time slot. Add is idempotent (200 on duplicate). Remove returns 204 on success.

**Contract**:

- `GET /favourites` — requires auth, returns `list[FavouriteStationResponse]`. Queries `favourites JOIN stations LEFT JOIN station_availability` filtered to current day-of-week and current 15-minute slot. Uses `_reliability_label()` from `stations.py` (or a shared helper) for the label. Returns empty list if no favourites.
- `POST /favourites/{station_id}` — requires auth, returns 200. Validates station exists (404 if not). Uses `INSERT ... ON CONFLICT DO NOTHING` for idempotency.
- `DELETE /favourites/{station_id}` — requires auth, returns 204. Deletes the row. Returns 204 even if the favourite didn't exist (idempotent).

All endpoints use the asyncpg pool via `_get_pool(request)` pattern and `Depends(current_active_user)` for auth.

#### 4. Router Registration

**File**: `app/api/__init__.py`

**Intent**: Register the favourites router so endpoints are available under `/api/v1/favourites/...`.

**Contract**: Import `router` from `app.api.favourites` and call `router.include_router(favourites_router)`.

### Success Criteria:

#### Automated Verification:

- Migration applies and rolls back cleanly: `uv run alembic upgrade head && uv run alembic downgrade 006 && uv run alembic upgrade head`
- Ruff passes: `uv run ruff check app/api/favourites.py app/api/models.py`
- Mypy passes: `uv run mypy app/api/favourites.py app/api/models.py`

#### Manual Verification:

- Endpoints respond correctly when tested via curl or httpie against a running dev server (add, list with availability, remove)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Backend Integration Tests

### Overview

Full lifecycle integration tests covering add, list, remove, re-add, idempotent add, remove non-existent, unauthenticated access, and the availability join.

### Changes Required:

#### 1. Test Cleanup Fixture Update

**File**: `tests/conftest.py`

**Intent**: Include the new `favourites` table in the autouse TRUNCATE so tests don't leak state.

**Contract**: Add `favourites` to the TRUNCATE statement at line 154.

#### 2. Favourites Integration Tests

**File**: `tests/test_favourites.py` (new file)

**Intent**: Comprehensive lifecycle tests for the favourites API. Reuse `_register_and_login` and `_cookie_header` from `test_auth.py` (or extract to conftest).

**Contract**: Test cases:
- `test_add_favourite` — register + login, add station, assert 200
- `test_list_favourites_empty` — register + login, list, assert empty list
- `test_list_favourites_with_station` — add station, list, assert station data in response
- `test_list_favourites_with_availability` — insert station + availability data for current slot, add favourite, list, assert `avg_bikes`/`avg_ebikes`/`reliability_label` populated
- `test_list_favourites_no_availability_data` — add favourite for station with no availability, assert availability fields are null
- `test_remove_favourite` — add then remove, list, assert empty
- `test_add_favourite_idempotent` — add same station twice, assert 200 both times, list shows one entry
- `test_remove_nonexistent_favourite` — remove station that isn't favourited, assert 204
- `test_add_favourite_station_not_found` — add non-existent station_id, assert 404
- `test_unauthenticated_access` — call all three endpoints without auth cookie, assert 401

All tests use `pytestmark = [pytest.mark.asyncio(loop_scope="session"), pytest.mark.integration]` and require `db_pool` + `api_client` fixtures. Station test data inserted via `insert_test_snapshots` helper from conftest.

### Success Criteria:

#### Automated Verification:

- All favourites tests pass: `uv run pytest tests/test_favourites.py -v`
- Full test suite passes: `uv run pytest -m integration`
- Ruff passes: `uv run ruff check tests/test_favourites.py`

#### Manual Verification:

- Test output reviewed — all 10 test cases present and passing

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Frontend API & Station Detail Toggle

### Overview

Add `apiDelete` to the API client, create favourites API functions and a `useFavourites` hook, then add a favourite toggle button to the station detail page.

### Changes Required:

#### 1. API Client — apiDelete

**File**: `frontend/src/api/client.ts`

**Intent**: Add DELETE method support to the API client, needed for removing favourites.

**Contract**: New `apiDelete(path: string): Promise<void>` function following the same pattern as `apiPost` — `method: 'DELETE'`, `credentials: 'include'`, error handling via `throwApiError`.

#### 2. Favourites API Functions

**File**: `frontend/src/api/favourites.ts` (new file)

**Intent**: Type-safe API functions for favourites CRUD operations.

**Contract**:
- `FavouriteStation` type: matches `FavouriteStationResponse` from backend — `station_id`, `name`, `address`, `lat`, `lon`, `capacity`, `avg_bikes`, `avg_ebikes`, `reliability_label` (availability fields nullable)
- `fetchFavourites(): Promise<FavouriteStation[]>` — GET `/favourites`
- `addFavourite(stationId: string): Promise<void>` — POST `/favourites/{stationId}`
- `removeFavourite(stationId: string): Promise<void>` — DELETE `/favourites/{stationId}`

#### 3. useFavourites Hook

**File**: `frontend/src/hooks/useFavourites.ts` (new file)

**Intent**: TanStack Query hook for favourites state and mutations, following the pattern of `useAuth.ts`.

**Contract**:
- Query key: `['favourites']`, calls `fetchFavourites`, enabled only when `isAuthenticated` is true
- `addMutation` — calls `addFavourite`, invalidates `['favourites']` on success
- `removeMutation` — calls `removeFavourite`, invalidates `['favourites']` on success
- Returns: `favourites`, `isLoading`, `addMutation`, `removeMutation`, `isFavourite(stationId: string): boolean`

#### 4. FavouriteToggleButton Component

**File**: `frontend/src/components/FavouriteToggleButton.tsx` (new file)

**Intent**: A heart/star toggle button that adds or removes a station from favourites. Shown on station detail page for authenticated users.

**Contract**: Props: `stationId: string`. Uses `useAuth` for auth state and `useFavourites` for toggle logic. Renders nothing if not authenticated. Shows filled heart/star when favourited, outline when not. Click toggles: if favourited → remove, if not → add. Disabled while mutation is pending.

#### 5. Station Detail Page Integration

**File**: `frontend/src/pages/StationDetailPage.tsx`

**Intent**: Add the favourite toggle button to the station metadata section.

**Contract**: Import and render `<FavouriteToggleButton stationId={station.station_id} />` inside the station metadata `<div>` (after line 79, inside the `mt-4 mb-6` block).

### Success Criteria:

#### Automated Verification:

- TypeScript compiles: `cd frontend && npx tsc --noEmit`
- ESLint passes: `cd frontend && npx eslint src/api/favourites.ts src/hooks/useFavourites.ts src/components/FavouriteToggleButton.tsx`
- Frontend builds: `cd frontend && npm run build`

#### Manual Verification:

- On station detail page (logged in): heart/star button visible, clicking toggles favourite state
- On station detail page (logged out): no heart/star button visible
- Toggle persists across page reload

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Homepage Integration

### Overview

Create a `FavouriteStations` component that displays favourite stations with current-slot availability, and modify the homepage to conditionally render it instead of `PopularStations` for authenticated users with favourites.

### Changes Required:

#### 1. FavouriteStations Component

**File**: `frontend/src/components/FavouriteStations.tsx` (new file)

**Intent**: Card grid displaying the user's favourite stations with current-slot availability data and a remove button. Modeled on `PopularStations.tsx`.

**Contract**:
- Uses `useFavourites` hook for data and remove mutation
- Same grid layout as `PopularStations`: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3`
- Each card is a `<Link>` to `/stations/{station_id}` (entire card clickable)
- Card content: station name, address, availability line showing avg bikes + avg ebikes + reliability label for current slot (e.g. "≈ 3 rowery + 1 e-rower · Niezawodna"), or "Brak danych" in gray if availability fields are null
- Each card has a small remove button (X icon) in the top-right corner that calls `removeMutation` with `stationId`. The remove button must stop event propagation so clicking it doesn't navigate to the station detail page.
- Section heading: "Twoje ulubione stacje"
- Returns `null` if favourites list is empty (parent component handles fallback to popular)

#### 2. Homepage Conditional Rendering

**File**: `frontend/src/pages/HomePage.tsx`

**Intent**: Show `FavouriteStations` instead of `PopularStations` for authenticated users who have favourites. Fall back to `PopularStations` when not authenticated or no favourites set.

**Contract**: Import `useAuth` and `FavouriteStations`. The rendering logic: if authenticated, render `<FavouriteStations />`. The component returns `null` when there are no favourites, so render `<PopularStations />` as a fallback. When not authenticated, render `<PopularStations />` directly.

### Success Criteria:

#### Automated Verification:

- TypeScript compiles: `cd frontend && npx tsc --noEmit`
- ESLint passes: `cd frontend && npx eslint src/components/FavouriteStations.tsx src/pages/HomePage.tsx`
- Frontend builds: `cd frontend && npm run build`

#### Manual Verification:

- Homepage (logged out): shows "Popularne stacje" with hardcoded featured stations
- Homepage (logged in, no favourites): shows "Popularne stacje"
- Homepage (logged in, with favourites): shows "Twoje ulubione stacje" with favourite cards, each showing availability for current time slot
- Clicking a favourite card navigates to station detail page
- Clicking the X button removes the station from favourites and the card disappears; if last favourite removed, falls back to "Popularne stacje"
- Availability data on cards updates when navigating away and back (different time slot)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Frontend Unit Tests

### Overview

Component and hook tests for all new frontend code, following existing patterns (Vitest + @testing-library/react + `renderWithProviders` helper).

### Changes Required:

#### 1. FavouriteToggleButton Tests

**File**: `frontend/src/components/FavouriteToggleButton.test.tsx` (new file)

**Intent**: Test that the toggle renders correctly based on auth and favourite state, and that clicking it triggers the appropriate mutation.

**Contract**: Test cases:
- Renders nothing when not authenticated
- Shows outline (not favourited) state when station is not in favourites
- Shows filled (favourited) state when station is in favourites
- Click on unfavourited station calls add mutation
- Click on favourited station calls remove mutation

#### 2. FavouriteStations Tests

**File**: `frontend/src/components/FavouriteStations.test.tsx` (new file)

**Intent**: Test the favourites card grid rendering, including availability display and remove button.

**Contract**: Test cases:
- Returns null when favourites list is empty
- Renders cards with station names and addresses
- Renders availability data (avg bikes + ebikes + reliability label) when available
- Shows "Brak danych" when availability fields are null
- Remove button click calls removeMutation
- Cards link to correct station detail URLs

#### 3. HomePage Tests Update

**File**: `frontend/src/pages/HomePage.test.tsx`

**Intent**: Add tests for the conditional rendering of favourites vs popular sections.

**Contract**: Additional test cases:
- Shows "Popularne stacje" when not authenticated
- Shows "Twoje ulubione stacje" when authenticated with favourites
- Falls back to "Popularne stacje" when authenticated with no favourites

#### 4. useFavourites Hook Tests

**File**: `frontend/src/hooks/useFavourites.test.ts` (new file)

**Intent**: Test the hook's query and mutation behavior.

**Contract**: Test cases:
- Does not fetch when not authenticated
- Fetches and returns favourites when authenticated
- `isFavourite` returns correct boolean
- Add mutation calls API and invalidates query
- Remove mutation calls API and invalidates query

### Success Criteria:

#### Automated Verification:

- All frontend tests pass: `cd frontend && npx vitest run`
- No regressions in existing tests
- TypeScript compiles: `cd frontend && npx tsc --noEmit`

#### Manual Verification:

- Test output reviewed — all new test files present with expected test cases passing

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 6: E2E Tests

### Overview

Playwright end-to-end tests covering the full favourites lifecycle in a browser against a running app. Follow existing patterns in `e2e/` — risk-tied test names, `getByRole`/`getByLabel`/`getByText` locators, unique emails via `Date.now()`, Polish UI labels, no `waitForTimeout`.

### Changes Required:

#### 1. Favourites E2E Tests

**File**: `e2e/favourites.spec.ts` (new file)

**Intent**: Browser-level tests for the favourites lifecycle: add from detail page, verify on homepage, remove, verify fallback.

**Contract**: Test cases:

- `favourite toggle appears on station detail for authenticated user` — register + login, navigate to a station detail page, assert the favourite toggle button is visible
- `favourite toggle hidden for anonymous user` — navigate to station detail page without login, assert no toggle button
- `adding a favourite shows station on homepage` — register + login, navigate to station detail, click favourite toggle, navigate home, assert the station name appears under "Twoje ulubione stacje" heading
- `removing favourite from homepage falls back to popular` — continuing from previous state (or fresh setup), click the remove (X) button on a favourite card on homepage, assert the card disappears, assert "Popularne stacje" heading reappears (if it was the only favourite)
- `favourite persists across page reload` — add a favourite, reload the homepage, assert the favourite station is still visible

Each test uses a unique email via `e2e-fav-<label>-${Date.now()}@test.local`. Tests clean up by logging out at the end. Tests must not depend on specific station availability data — they verify the favourite toggle and card rendering, not availability values.

#### 2. Update Existing Station E2E Test

**File**: `e2e/stations.spec.ts`

**Intent**: The existing test `station detail page loads from popular stations list` clicks a station link under "Popularne stacje". Since authenticated users with favourites won't see this heading, the test should continue to work for anonymous users (which it does — no auth setup). No code change needed, but verify it still passes.

### Success Criteria:

#### Automated Verification:

- All E2E tests pass: `npx playwright test`
- Existing E2E tests still pass (no regressions): `npx playwright test e2e/auth-session.spec.ts e2e/stations.spec.ts`

#### Manual Verification:

- E2E test report reviewed — all favourites tests green, no flakiness on re-run

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Backend: Full lifecycle integration tests in `tests/test_favourites.py` (10 cases)
- Frontend components: FavouriteToggleButton, FavouriteStations (rendering, interactions, edge cases)
- Frontend hook: useFavourites (query behavior, mutations, auth gating)
- Frontend page: HomePage conditional rendering (authenticated vs anonymous, favourites vs popular)

### Integration Tests:

- Backend: favourites endpoints with real DB (asyncpg + Alembic migrations)
- Backend: availability join query with real station_availability data

### E2E Tests:

- Full browser lifecycle: register → login → add favourite → verify on homepage → remove → verify fallback
- Auth gating: toggle visibility for authenticated vs anonymous users
- Persistence: favourite survives page reload

### Manual Testing Steps:

1. Log in, navigate to a station detail page, click the favourite toggle — verify it fills
2. Return to homepage — verify the station appears under "Twoje ulubione stacje" with availability data
3. Click the X on the favourite card — verify the card disappears
4. Remove all favourites — verify "Popularne stacje" reappears
5. Log out — verify homepage shows "Popularne stacje"
6. Log back in — verify favourites are still there
7. Test with station that has no availability data — verify "Brak danych" appears on card

## Performance Considerations

- The favourites list endpoint joins `station_availability` filtered to current day-of-week + time slot — this is a single query, not N+1
- No limit on favourites count, but even with many favourites the join is bounded by `station_availability` rows (one per slot per station)
- TanStack Query caches the favourites list; mutations invalidate the cache
- The homepage fetches either favourites or stations (popular), not both — no unnecessary network requests

## Migration Notes

- Migration 007 adds `favourites` table with FK constraints
- `ON DELETE CASCADE` on `user_id` FK ensures account deletion cleans up favourites
- `ON DELETE` behavior for `station_id` FK: stations are never deleted in practice (only `is_active` flag), but a simple `RESTRICT` is safest to prevent accidental data inconsistency
- Downgrade drops the table entirely — no data migration needed

## References

- Research: `context/changes/favourites-dashboard/research.md`
- PRD requirements: US-02, FR-010, FR-011, FR-012
- PopularStations card pattern: `frontend/src/components/PopularStations.tsx`
- Station endpoint pattern: `app/api/stations.py`
- Auth dependency: `app/auth/config.py:40`
- E2E test patterns: `e2e/seed.spec.ts`, `e2e/e2e-rules.md`
- Test fixtures: `tests/conftest.py:147-158`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database & Backend API

#### Automated

- [x] 1.1 Migration applies and rolls back cleanly — 55cade0
- [x] 1.2 Ruff passes on new files — 55cade0
- [x] 1.3 Mypy passes on new files — 55cade0

#### Manual

- [x] 1.4 Endpoints respond correctly via curl/httpie (add, list with availability, remove) — 55cade0

### Phase 2: Backend Integration Tests

#### Automated

- [x] 2.1 All favourites tests pass — 0b6beea
- [x] 2.2 Full integration test suite passes — 0b6beea
- [x] 2.3 Ruff passes on test file — 0b6beea

#### Manual

- [x] 2.4 Test output reviewed — all 10 test cases present and passing — 0b6beea

### Phase 3: Frontend API & Station Detail Toggle

#### Automated

- [x] 3.1 TypeScript compiles — 77267e5
- [x] 3.2 ESLint passes on new files — 77267e5
- [x] 3.3 Frontend builds — 77267e5

#### Manual

- [x] 3.4 Toggle visible on station detail (logged in), hidden (logged out) — 77267e5
- [x] 3.5 Toggle persists across page reload — 77267e5

### Phase 4: Homepage Integration

#### Automated

- [x] 4.1 TypeScript compiles — ad6df41
- [x] 4.2 ESLint passes on modified files — ad6df41
- [x] 4.3 Frontend builds — ad6df41

#### Manual

- [x] 4.4 Homepage shows favourites with availability for authenticated user — ad6df41
- [x] 4.5 Remove button works, falls back to popular when no favourites — ad6df41
- [x] 4.6 Homepage shows popular stations for anonymous user — ad6df41

### Phase 5: Frontend Unit Tests

#### Automated

- [x] 5.1 All frontend tests pass (npx vitest run) — 3792c51
- [x] 5.2 No regressions in existing tests — 3792c51
- [x] 5.3 TypeScript compiles — 3792c51

#### Manual

- [x] 5.4 Test output reviewed — all new test files and cases present — 3792c51

### Phase 6: E2E Tests

#### Automated

- [x] 6.1 All E2E tests pass (npx playwright test) — 0072104
- [x] 6.2 Existing E2E tests still pass (no regressions) — 0072104

#### Manual

- [x] 6.3 E2E test report reviewed — all favourites tests green, no flakiness — 0072104
