# Frontend Regression Safety — Plan Brief

> Full plan: `context/changes/testing-frontend/plan.md`

## What & Why

Set up frontend testing infrastructure (Vitest + testing-library/react) and write component + page tests for all UI components. This is Phase 3 of the test plan rollout, covering Risk #5: "Frontend silently breaks after a change — heatmap, search, or station detail renders incorrectly or errors out." The developer is new to React and changes feel fragile; these tests provide a safety net.

## Starting Point

The frontend has 7 components and 4 pages with zero testing infrastructure — no test runner, no testing-library, no test files, no test scripts. All critical components receive data as props (not internal fetching), and the heatmap uses pure CSS classes for color mapping, making both straightforward to test with DOM assertions.

## Desired End State

Running `cd frontend && npm test` produces a passing suite covering every component and page. Critical components (AvailabilityHeatmap, StationSearch, DayPartDetail) have multi-case coverage for rendering, interaction, and edge cases. The test plan's §6.4 cookbook is filled in so future contributors know how to add frontend tests.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Component scope | All 7 components + 4 pages | Full regression safety — user chose broad coverage over targeted-only. |
| Data strategy | Props-first; mock react-query only for pages | Most components already take data as props — mocking react-query would add unnecessary complexity. |
| Visual regression | No — DOM assertions on CSS classes | The heatmap's color mapping is a simple label→class lookup, not a canvas render; Playwright screenshots would be overkill. |
| Routing in tests | MemoryRouter wrapper utility | Standard react-router-dom testing pattern; mocking useParams/Link is fragile. |
| React-query in page tests | Real QueryClientProvider with mocked fetch functions | Tests actual loading/error states; catches query key and staleTime issues. |
| DOM environment | jsdom | Most mature, best testing-library compatibility. |
| Polish labels | Assert key labels, not all strings | Catches label mapping bugs (reliable→"dostępne") without brittle tooltip string matching. |
| Auth component testing | Mock useAuth hook | Isolates UI from auth implementation; auth flow already tested by Phase 2 backend tests. |

## Scope

**In scope:**
- Vitest + testing-library/react + jsdom setup
- Component tests for: AvailabilityHeatmap, StationSearch, DayPartDetail, DayOfWeekTabs, EmptyState, PopularStations, Layout
- Page tests for: StationDetailPage, HomePage, LoginPage, RegisterPage
- Shared test helpers (renderWithRouter, renderWithProviders) and fixtures
- Test plan §6.4 cookbook update

**Out of scope:**
- Visual regression / Playwright screenshots
- E2E browser tests
- API client function tests (thin wrappers, covered by backend tests)
- Snapshot tests (anti-pattern per test plan)

## Architecture / Approach

Tests are co-located with source files (`Component.test.tsx` next to `Component.tsx`). A shared `src/test/` directory holds setup, helpers, and fixtures. Components get data as props; pages get a real QueryClientProvider wrapping mocked fetch functions. All router-dependent components use a MemoryRouter wrapper. Auth state is controlled via a mocked useAuth hook.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Testing Infrastructure | Vitest + testing-library installed, configured, smoke test passing | Version incompatibility between React 19 / Vite 8 / Vitest |
| 2. Component Tests | Tests for all 7 components with fixture data | StationSearch geocode mock complexity |
| 3. Page Tests | Tests for all 4 pages with mocked data fetching | StationDetailPage routing + react-query provider setup |
| 4. Cookbook Update | test-plan.md §6.4 filled in, Phase 3 marked complete | None |

**Prerequisites:** Node.js and npm available in `frontend/`
**Estimated effort:** ~2-3 sessions across 4 phases

## Open Risks & Assumptions

- React 19 + @testing-library/react v16 compatibility is confirmed by peer deps but untested in this project
- Tailwind CSS 4 Vite plugin in test environment may need `css: true` in vitest config to avoid import errors

## Success Criteria (Summary)

- `cd frontend && npm test` passes with all component and page tests green
- Critical components (heatmap color mapping, search filtering, day-part reliability labels) have explicit assertions proving correct rendering
- Test plan §6.4 is a complete cookbook entry for adding future frontend tests
