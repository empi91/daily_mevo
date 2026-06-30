# Frontend Regression Safety — Implementation Plan

## Overview

Set up Vitest + @testing-library/react frontend testing infrastructure from scratch and write component + page tests for all 7 components and 4 pages. This covers Risk #5 from the test plan: "Frontend silently breaks after a change — heatmap, search, or station detail renders incorrectly or errors out."

## Current State Analysis

The frontend is a React 19 + Vite 8 + TypeScript 6 app with Tailwind CSS 4 and @tanstack/react-query 5. There are 7 components, 4 pages, and zero testing infrastructure — no test runner, no testing-library, no test files, no test scripts.

### Key Discoveries:

- All critical components (AvailabilityHeatmap, StationSearch, DayPartDetail) receive data as props — no internal data fetching. This makes them easy to test by passing fixture data directly.
- The heatmap is pure CSS (Tailwind utility classes on divs), not canvas/SVG — DOM assertions can verify color mapping via CSS class names.
- StationSearch has two-tier logic: local filter on passed-in stations array, then geocode fallback calling `geocodeAddress` + `fetchNearbyStations`. The geocode path needs mocking.
- Pages (HomePage, StationDetailPage) use react-query for data fetching. PopularStations also fetches independently via useQuery.
- Auth pages (LoginPage, RegisterPage) and Layout use the `useAuth` hook which wraps react-query mutations. These should be tested by mocking useAuth.
- react-router-dom Links and useParams are used by StationSearch, StationDetailPage, Layout, LoginPage, RegisterPage, PopularStations — need MemoryRouter wrapper.
- `frontend/src/polish.ts` provides pluralization helpers used in heatmap tooltips and DayPartDetail labels.

## Desired End State

Every UI component and page has at least one test proving it renders correctly with known data. The critical components (AvailabilityHeatmap, StationSearch, DayPartDetail, StationDetailPage) have multiple tests covering happy path, edge cases (empty data, no results), and key interactions (day selection, search filtering, day-part expansion). Running `npm test` in `frontend/` produces a passing suite that catches rendering regressions.

**Verification:** `cd frontend && npm test` passes. All component and page test files exist under `src/`.

## What We're NOT Doing

- Visual regression testing (Playwright screenshots) — DOM assertions on CSS classes are sufficient for the heatmap's label→color mapping
- E2E browser tests — component tests with testing-library cover the rendering risk; browser-to-server flows are Phase 4's concern
- Testing API client functions (`api/client.ts`, `api/stations.ts`, `api/auth.ts`) — those are thin fetch wrappers already exercised by Phase 2 backend tests
- Testing `polish.ts` pluralization helpers in isolation — they're exercised through component tests that assert rendered labels
- Snapshot tests — explicitly excluded per test plan anti-pattern guidance

## Implementation Approach

Props-first testing: components that take data as props (Heatmap, Search, DayPartDetail, DayOfWeekTabs) get fixture data passed directly. Pages that fetch via react-query get a real QueryClientProvider with mocked fetch functions (vi.mock on api/stations and api/auth modules). Auth components mock the useAuth hook. All components using react-router Links/params are wrapped in MemoryRouter via a shared helper.

---

## Phase 1: Testing Infrastructure

### Overview

Install dependencies, create Vitest config, setup file, TypeScript test config, and package.json scripts. Add a single smoke test to verify the setup works.

### Changes Required:

#### 1. Install dev dependencies

**Intent**: Add Vitest, testing-library, and jsdom as dev dependencies so the test runner and DOM assertions work.

**Contract**: `npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event` in `frontend/`. These are devDependencies only.

#### 2. Vitest configuration

**File**: `frontend/vitest.config.ts`

**Intent**: Configure Vitest to use jsdom, enable globals, register the setup file, and extend the existing Vite config so React and Tailwind plugins are available in tests.

**Contract**: Export a merged config (vitest `mergeConfig` over the existing `vite.config.ts`) with `test.globals: true`, `test.environment: 'jsdom'`, `test.setupFiles: ['./src/test/setup.ts']`, `test.css: true`.

#### 3. Setup file

**File**: `frontend/src/test/setup.ts`

**Intent**: Register @testing-library/jest-dom matchers (toBeInTheDocument, toHaveTextContent, etc.) with Vitest's expect.

**Contract**: Single import: `import '@testing-library/jest-dom/vitest'`.

#### 4. TypeScript test config

**File**: `frontend/tsconfig.test.json` (new)
**File**: `frontend/tsconfig.json` (modify)

**Intent**: Add TypeScript types for `vitest/globals` and `@testing-library/jest-dom` without polluting the production tsconfig.

**Contract**: New `tsconfig.test.json` with `types: ["vitest/globals", "@testing-library/jest-dom"]`, includes `src/**/*.test.tsx` and `src/test/setup.ts`. Add a reference to it from `tsconfig.json`.

#### 5. Package.json scripts

**File**: `frontend/package.json`

**Intent**: Add test runner scripts.

**Contract**: Add `"test": "vitest run"` and `"test:watch": "vitest"` to the scripts object.

#### 6. Test helpers

**File**: `frontend/src/test/helpers.tsx`

**Intent**: Create shared render utilities that wrap components in MemoryRouter and QueryClientProvider, avoiding boilerplate in every test file.

**Contract**: Export `renderWithRouter(ui, { initialEntries? })` — wraps in MemoryRouter. Export `renderWithProviders(ui, { initialEntries?, queryClient? })` — wraps in both MemoryRouter and QueryClientProvider (retry: false, gcTime: 0). Export `createTestQueryClient()`.

#### 7. Smoke test

**File**: `frontend/src/components/EmptyState.test.tsx`

**Intent**: Verify the testing setup works end-to-end by testing the simplest component.

**Contract**: Test that EmptyState renders its heading text "Dane wciąż zbierane".

### Success Criteria:

#### Automated Verification:

- Dependencies install cleanly: `cd frontend && npm install`
- TypeScript compiles with test config: `cd frontend && npx tsc -b`
- Smoke test passes: `cd frontend && npm test`

#### Manual Verification:

- None for this phase.

**Implementation Note**: After completing this phase and all automated verification passes, proceed to Phase 2.

---

## Phase 2: Component Tests

### Overview

Write tests for all 7 components. Critical components (AvailabilityHeatmap, StationSearch, DayPartDetail) get thorough coverage; simpler components (DayOfWeekTabs, EmptyState, PopularStations, Layout) get focused tests.

### Changes Required:

#### 1. Test fixtures

**File**: `frontend/src/test/fixtures.ts`

**Intent**: Define shared test data (stations, availability slots) used across component and page tests, so all tests use consistent, realistic data shapes.

**Contract**: Export `TEST_STATIONS: StationResponse[]` (3-4 stations with realistic data), `TEST_AVAILABILITY: AvailabilitySlot[]` (slots covering all reliability labels: reliable, uncertain, empty, insufficient_data, across multiple days and time slots), `TEST_STATION_DETAIL: StationDetailResponse` (a complete station with availability). All values should be hand-crafted with known expected outputs.

#### 2. AvailabilityHeatmap tests

**File**: `frontend/src/components/AvailabilityHeatmap.test.tsx`

**Intent**: Prove the heatmap renders correct colors for each reliability label, highlights the selected day, and calls onSelectDay when a row is clicked.

**Contract**: Tests to write:
- Renders 7 day rows (Pon through Ndz)
- Cells with `reliable` data have `bg-green-500` class
- Cells with `uncertain` data have `bg-yellow-400` class
- Cells with `empty` data have `bg-red-500` class
- Cells with no data have `bg-gray-200` class
- Selected day row has `ring-1 ring-blue-300` classes
- Clicking a different day row calls `onSelectDay` with the correct day index
- Renders hour labels (5:00 through 22:00)
- Legend text is present (≥6, 2–5, ≤1, brak danych)

#### 3. StationSearch tests

**File**: `frontend/src/components/StationSearch.test.tsx`

**Intent**: Prove local filtering works by station ID, name, and address, and that the component shows results as links to station pages. Test the geocode fallback path with mocked API calls.

**Contract**: Tests to write:
- Typing a station name shows matching results from the stations prop
- Typing a station ID shows matching results
- Typing an address substring shows matching results
- Results are links to `/stations/{station_id}`
- Shows max 10 local results
- Empty query shows no results
- Query with no local matches and >= 3 chars triggers geocode fallback (mock `geocodeAddress` and `fetchNearbyStations`)
- Nearby results show distance
- Geocode error shows Polish error message

Mock strategy: `vi.mock('../api/stations')` for geocode/nearby functions only. Local filtering uses the stations prop directly.

#### 4. DayPartDetail tests

**File**: `frontend/src/components/DayPartDetail.test.tsx`

**Intent**: Prove day-part sections render with correct names and time ranges, show correct per-slot data, display reliability badges with correct Polish labels, and support expand/collapse.

**Contract**: Tests to write:
- Renders 4 day-part sections: Rano (6–12), Popołudnie (12–18), Wieczór (18–22), Noc (22–6)
- First section (Rano) is expanded by default
- Clicking a collapsed section expands it
- Expanded section shows per-slot time, bike counts, and reliability badge
- Reliability labels render correct Polish text: reliable→"dostępne", uncertain→"niepewne", empty→"puste", insufficient_data→"brak danych"
- Section header shows average bike count for that day-part
- No data for a period shows "Brak danych dla tego okresu"

#### 5. DayOfWeekTabs tests

**File**: `frontend/src/components/DayOfWeekTabs.test.tsx`

**Intent**: Prove all 7 day tabs render and the selected tab is visually distinct.

**Contract**: Tests to write:
- Renders 7 buttons with Polish day labels (Pon, Wt, Śr, Czw, Pt, Sob, Ndz)
- Selected day button has `bg-blue-600` class
- Clicking a tab calls `onSelectDay` with correct index

#### 6. PopularStations tests

**File**: `frontend/src/components/PopularStations.test.tsx`

**Intent**: Prove featured stations render when data is available and the component returns null when no featured stations match.

**Contract**: Tests to write:
- Renders featured station cards as links when station data includes featured IDs
- Each card shows station name and address
- Returns null when no stations match featured IDs

Mock strategy: `vi.mock('../api/stations')` — mock `fetchStations` to return test data. Wrap in QueryClientProvider + MemoryRouter.

#### 7. Layout tests

**File**: `frontend/src/components/Layout.test.tsx`

**Intent**: Prove the layout shows correct auth controls based on authentication state.

**Contract**: Tests to write:
- Shows "Zaloguj się" and "Zarejestruj się" links when unauthenticated
- Shows user email and "Wyloguj" button when authenticated
- Shows "MevoStats" brand link
- Renders the footer text "Dane z Mevo Open Data API (GBFS)"

Mock strategy: `vi.mock('../hooks/useAuth')` — return controlled auth state.

### Success Criteria:

#### Automated Verification:

- All component tests pass: `cd frontend && npm test`
- TypeScript compiles: `cd frontend && npx tsc -b`

#### Manual Verification:

- None for this phase.

**Implementation Note**: After completing this phase and all automated verification passes, proceed to Phase 3.

---

## Phase 3: Page Tests

### Overview

Write tests for all 4 pages. StationDetailPage gets thorough coverage (it's the integration point for the three critical components). HomePage, LoginPage, and RegisterPage get focused tests.

### Changes Required:

#### 1. StationDetailPage tests

**File**: `frontend/src/pages/StationDetailPage.test.tsx`

**Intent**: Prove the page fetches station data, renders the full station detail (metadata + heatmap + tabs + day-part detail), handles loading/error/404 states, and shows EmptyState when data is insufficient.

**Contract**: Tests to write:
- Renders loading skeleton initially
- Renders station name, ID, address, and capacity after data loads
- Renders AvailabilityHeatmap with data (verify heatmap section heading "Dostępność w ciągu tygodnia" is present)
- Renders DayOfWeekTabs and DayPartDetail (verify "Szczegóły dnia" heading)
- Shows EmptyState when availability array is empty or all samples below threshold
- Shows 404 message when station not found (fetch throws 404 error)
- Shows error message on fetch failure
- Back link "Wróć do wyszukiwania" links to "/"

Mock strategy: `vi.mock('../api/stations')` — mock `fetchStationDetail`. Use `renderWithProviders` with `initialEntries: ['/stations/4076']` and wrap in a Route to provide `:stationId` param.

#### 2. HomePage tests

**File**: `frontend/src/pages/HomePage.test.tsx`

**Intent**: Prove the home page renders the search component with station data and the popular stations section.

**Contract**: Tests to write:
- Renders the heading "MevoStats"
- Renders the search input placeholder "Wpisz numer stacji, nazwę lub adres..."
- Renders the "Popularne stacje" section when station data is available

Mock strategy: `vi.mock('../api/stations')` — mock `fetchStations`.

#### 3. LoginPage tests

**File**: `frontend/src/pages/LoginPage.test.tsx`

**Intent**: Prove the login form renders, submits credentials, shows error on failure, and navigates on success.

**Contract**: Tests to write:
- Renders email and password fields with correct labels
- Renders "Zaloguj się" submit button
- Shows "Nieprawidłowy email lub hasło" on LOGIN_BAD_CREDENTIALS error
- Shows link to register page
- Submit button shows "Logowanie..." while pending

Mock strategy: `vi.mock('../hooks/useAuth')`.

#### 4. RegisterPage tests

**File**: `frontend/src/pages/RegisterPage.test.tsx`

**Intent**: Prove the register form renders, validates password length client-side, shows error for duplicate email, and navigates on success.

**Contract**: Tests to write:
- Renders email and password fields
- Shows "Hasło musi mieć co najmniej 8 znaków" for short password (client-side validation)
- Shows "Ten adres email jest już zarejestrowany" on REGISTER_USER_ALREADY_EXISTS error
- Shows link to login page
- Submit button shows "Rejestracja..." while pending

Mock strategy: `vi.mock('../hooks/useAuth')`.

### Success Criteria:

#### Automated Verification:

- All tests pass: `cd frontend && npm test`
- TypeScript compiles: `cd frontend && npx tsc -b`

#### Manual Verification:

- None for this phase.

**Implementation Note**: After completing this phase and all automated verification passes, proceed to Phase 4.

---

## Phase 4: Cookbook & Test Plan Update

### Overview

Update the test plan's §6.4 with frontend testing patterns, update §3 to mark Phase 3 complete, and update RUNNING_TESTS.md.

### Changes Required:

#### 1. Update §6.4 in test-plan.md

**File**: `context/foundation/test-plan.md`

**Intent**: Fill in the "Adding a frontend component test" cookbook entry with the patterns established in this phase — location, naming, fixtures, render helpers, reference tests.

**Contract**: Replace the "TBD" placeholder in §6.4 with:
- Location: `frontend/src/<dir>/<Component>.test.tsx` (co-located with source)
- Naming: `test('<Component> <scenario>', ...)`
- Render helpers: `renderWithRouter` for components with Links, `renderWithProviders` for pages with react-query
- Fixture data: import from `frontend/src/test/fixtures.ts`
- Mock patterns: `vi.mock('../api/stations')` for API, `vi.mock('../hooks/useAuth')` for auth
- Reference tests and run command

#### 2. Update §3 Phase 3 status

**File**: `context/foundation/test-plan.md`

**Intent**: Mark Phase 3 row as complete with the change folder path.

**Contract**: Update the Phase 3 row: Status → `complete`, Change folder → `context/changes/testing-frontend/`.

#### 3. Update §6.6 with Phase 3 notes

**File**: `context/foundation/test-plan.md`

**Intent**: Add Phase 3 key decisions to the per-rollout-phase notes section, following the pattern of Phase 1 and Phase 2 notes.

**Contract**: Add a "Phase 3 — Frontend regression safety" subsection documenting key decisions: Vitest + jsdom environment, props-first testing strategy, MemoryRouter wrapper, mocked useAuth for auth components, shared test fixtures, co-located test files.

#### 4. Update RUNNING_TESTS.md

**File**: `context/RUNNING_TESTS.md`

**Intent**: Add frontend test commands so the team knows how to run them.

**Contract**: Add a "Frontend tests" section with `cd frontend && npm test` and `cd frontend && npm run test:watch`.

### Success Criteria:

#### Automated Verification:

- All tests still pass: `cd frontend && npm test`
- Backend tests still pass: `uv run pytest`

#### Manual Verification:

- §6.4 in test-plan.md reads as a complete, actionable cookbook entry
- §3 Phase 3 row shows `complete`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Component Tests:

- AvailabilityHeatmap: color mapping per reliability label, selected day highlight, click handler, hour labels, legend
- StationSearch: local filter by ID/name/address, max results cap, geocode fallback with mocked API, error display
- DayPartDetail: day-part sections with correct time ranges, expand/collapse, per-slot data, reliability badge labels
- DayOfWeekTabs: 7 tabs render, selected state, click handler
- EmptyState: renders heading text
- PopularStations: renders featured stations, returns null when no matches
- Layout: auth state controls, brand link, footer

### Page Tests:

- StationDetailPage: loading/error/404/empty/happy states, station metadata, sub-component integration
- HomePage: heading, search input, popular stations
- LoginPage: form fields, submit, error messages, navigation link
- RegisterPage: form fields, client-side validation, error messages, navigation link

### Key Edge Cases:

- Heatmap with empty availability array (all cells gray)
- StationSearch with no matching stations and short query (< 3 chars, no geocode triggered)
- DayPartDetail with no slots for selected day (shows "Brak danych" in all sections)
- StationDetailPage with availability where all sample_counts are 0 (shows EmptyState)

## References

- Test plan: `context/foundation/test-plan.md` §3 Phase 3, §2 Risk #5
- Frontend source: `frontend/src/components/`, `frontend/src/pages/`
- API types: `frontend/src/api/stations.ts:1-45`
- Auth hook: `frontend/src/hooks/useAuth.ts`
- Archived frontend build: `context/archive/2026-06-05-station-availability-page/`
- Archived auth build: `context/archive/2026-06-11-user-auth/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Testing Infrastructure

#### Automated

- [x] 1.1 Dependencies install cleanly — f437ab6
- [x] 1.2 TypeScript compiles with test config — f437ab6
- [x] 1.3 Smoke test passes — f437ab6

### Phase 2: Component Tests

#### Automated

- [x] 2.1 All component tests pass — 58e22b3
- [x] 2.2 TypeScript compiles — 58e22b3

### Phase 3: Page Tests

#### Automated

- [x] 3.1 All tests pass — ab0c467
- [x] 3.2 TypeScript compiles — ab0c467

### Phase 4: Cookbook & Test Plan Update

#### Automated

- [x] 4.1 All frontend tests still pass
- [x] 4.2 Backend tests still pass

#### Manual

- [x] 4.3 §6.4 reads as complete cookbook entry
- [x] 4.4 §3 Phase 3 row shows complete
